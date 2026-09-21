//! Workbench probes backing the Redis KV context bar and key-inspector
//! sidebar (`type_distribution`, `key_object_info`).
//!
//! Cost shape is the whole point of this module, so both commands are built
//! from the shared cursor / pipeline primitives instead of per-key round trips:
//!
//! - `type_distribution` fills a bounded sample window with `SCAN`
//!   ([`crate::ops::scan_batch`]) and resolves types with chunked pipelines.
//!   **`KEYS` is never issued** — it blocks the server for the entire keyspace.
//!   The reply carries `sampled` / `dbsize` / `truncated` so the UI is forced
//!   to label an estimate as an estimate (PRD §3.4 hard constraint).
//! - `key_object_info` reads every key attribute in **one** pipeline. Failures
//!   stay per command: a key that expired between two renders, a non-LFU
//!   `maxmemory-policy` (rejects `OBJECT FREQ`), or Redis < 4.0 (no
//!   `MEMORY USAGE`) degrades a single field to `None` instead of failing the
//!   command — the sidebar shows an empty slot, not a red error. On a cluster
//!   connection the same six commands go out one at a time, each addressed to
//!   the shard that owns the key (see below), which keeps the degradation
//!   contract and costs six round trips instead of one.
//!
//! # Why replies are read as a batch, and why Cluster is the exception
//!
//! The crate's existing pipelines (e.g. `ops_tree::list_children_on`) go through
//! `Pipeline::query_async`, which is the right call when no command in the batch
//! may fail: it runs the reply vector through `Value::extract_error_vec`, so the
//! *first* errored command fails the whole batch — exactly the behaviour the
//! degradation contract above forbids.
//! [`redis::aio::ConnectionLike::req_packed_commands`] is what
//! `query_async` calls internally, with the same `offset = 0` / `count = len`
//! arguments `execute_pipelined_async` passes; only the error unwrapping is
//! skipped, which lets the per-command errors survive to be inspected.
//!
//! **That last step is what a cluster connection undoes.** `ClusterConnection`
//! folds the batch *again* in its own dispatch layer
//! (`cluster_async::try_pipeline_request` → `Value::extract_error_vec`) and
//! additionally pins a whole pipeline to one slot (`route_for_pipeline`, so a
//! batch of different keys fails with `CrossSlot`). Since `OBJECT FREQ` errors on
//! every non-LFU server, a cluster pipeline would make `key_object_info` fail
//! always and `type_distribution` fail whenever the sample crosses a slot — i.e.
//! the degradation contract cannot be met with a batch there. So on
//! [`Topology::Cluster`] the very same commands are issued one at a time, each
//! addressed to the shard that owns the key. Degradation semantics are then
//! identical; only the cost differs (one round trip per command), which is why
//! the cluster sample window is bounded far tighter — see
//! [`CLUSTER_TYPE_SAMPLE_LIMIT`].
//!
//! # Cluster: every command names the node it runs on
//!
//! Issuing a command through [`ConnectionLike`] is *not* enough on a cluster
//! connection, because redis derives the target node from its own command-name
//! table (`cluster_routing::RoutingInfo::for_routable`), and that table does not
//! describe these probes:
//!
//! * `MEMORY USAGE` and `OBJECT ENCODING|IDLETIME|FREQ` are two-word commands
//!   that are **absent** from it, so the fallback arm (`_ => arg_idx(1)`) reads
//!   the *subcommand token* as the key and sends the probe to whoever owns
//!   `slot("USAGE")`. The server answers `-MOVED`, the client resends, and — the
//!   expensive part — `RebuildSlots` runs `refresh_slots`, which takes the
//!   connection's write lock and re-queries `CLUSTER SLOTS` on every node. A
//!   sidebar that refreshes per key selection would serialise the whole
//!   connection behind that, so an unaddressed probe is not acceptable here even
//!   though the client does eventually return the right value.
//! * `SCAN` is in the table only as an explicit `None` ⇒ `SingleNode(Random)`,
//!   which would hand every sampling round to a different node and feed one
//!   node's cursor to another.
//!
//! So each probe carries its own address, via [`SlotRoutedConnection`] over the
//! public [`redis::cluster_async::ClusterConnection::route_command`] and
//! [`redis::cluster_routing::get_slot`]. Consequences:
//!
//! * a cluster probe costs exactly one round trip per command — no redirects, no
//!   slot rebuilds;
//! * `type_distribution` pins **every** `SCAN` round to
//!   [`cluster_scan_anchor_slot`], so its sample is one shard's sample and stays
//!   comparable between refreshes instead of mixing nodes;
//! * `DBSIZE` *is* in the table, as `MultiNode(AllMasters, Aggregate(Sum))`, so
//!   `dbsize` on a cluster is the **whole cluster's** count for the selected db
//!   (and one unreachable or non-integer master fails the aggregate). That is
//!   the `M` the "采样 N/M" label needs, so it is deliberately left unrouted.
//!
//! With those three facts, [`is_sample_truncated`] needs no cluster special
//! case: `sampled` counts keys on one shard while `dbsize` counts the whole
//! cluster, so `sampled == dbsize` — the only non-truncated answer — can only
//! mean every key of the cluster lives on the shard that was scanned.
//!
//! Upgrading the `redis` dependency is a documented review point: this module
//! relies on `req_packed_commands` (`#[doc(hidden)]` internal API) answering with
//! exactly one reply per command, and [`key_object_info`] rejects a reply vector
//! of any other length rather than mis-reading the slots.

use std::collections::BTreeMap;

use futures_util::FutureExt;
use redis::aio::ConnectionLike;
use redis::cluster_routing::{get_slot, Route, RoutingInfo, SingleNodeRoutingInfo, SlotAddr};
use redis::RedisFuture;
use redis::Value as RValue;
use serde::Serialize;

use crate::connect::Topology;
use crate::redis_driver::parse_scan_result;

/// Default sample window for `type_distribution` when `sampleLimit` is omitted.
pub const DEFAULT_TYPE_SAMPLE_LIMIT: u64 = 1_000;

/// Hard ceiling for `type_distribution`. Larger requests are clamped to it and
/// never rejected, so a stale UI preference cannot hammer a large keyspace.
pub const MAX_TYPE_SAMPLE_LIMIT: u64 = 5_000;

/// Sample ceiling on a cluster connection. `TYPE` cannot be batched across keys
/// there (see the module docs), so every sampled key costs a round trip and the
/// window is kept an order of magnitude smaller than [`MAX_TYPE_SAMPLE_LIMIT`].
/// `sampled` / `truncated` keep their exact meaning — the sample is just
/// shorter, never presented as more.
pub const CLUSTER_TYPE_SAMPLE_LIMIT: u64 = 200;

/// `SCAN COUNT` used while filling the sample window.
pub const TYPE_SCAN_COUNT: u32 = 500;

/// Key whose hash slot a cluster sample is pinned to. The key is never sent to
/// the server — only its slot is used to pick a node — but it is named so the
/// choice is reproducible and cannot collide with a real workload key.
///
/// `SCAN` carries no cluster route (redis' own table answers `None` ⇒ a random
/// node per round), which would feed one node's cursor to another node. Pinning
/// every round to this slot keeps a cluster sample a *single shard's* sample.
pub const CLUSTER_SCAN_ANCHOR: &str = "datazen:redis:workbench:sample-anchor";

/// The shard a cluster sample covers — see [`CLUSTER_SCAN_ANCHOR`]. Stable
/// across calls, so consecutive `type_distribution` results describe the same
/// node and stay comparable over refreshes.
pub fn cluster_scan_anchor_slot() -> u16 {
    get_slot(CLUSTER_SCAN_ANCHOR.as_bytes())
}

/// Keys per `TYPE` pipeline: one round trip per 500 sampled keys.
pub const TYPE_PIPELINE_CHUNK: usize = 500;

/// Commands in the single `key_object_info` pipeline.
pub const KEY_INFO_PIPELINE_LEN: usize = 6;

/// Absolute cap on `SCAN` round trips per `type_distribution`. Filling the
/// largest window needs `MAX_TYPE_SAMPLE_LIMIT / TYPE_SCAN_COUNT` = 10 rounds;
/// the headroom covers sparse keyspaces, and the cap is what stops a server
/// (proxy, downgraded replica) whose cursor never wraps from pinning this
/// connection forever — the context bar re-runs on every db switch.
pub const MAX_SCAN_ROUNDS: u32 = 64;

/// Stop sampling after this many consecutive `SCAN` rounds that return no new
/// key. A healthy cursor either yields keys or reaches the window; neither
/// happens in a stuck loop, and 16 empty rounds is already long enough to
/// conclude it, well before [`MAX_SCAN_ROUNDS`] would.
pub const MAX_STALLED_SCAN_ROUNDS: u32 = 16;

/// PTTL sentinel: the key does not exist.
pub const TTL_MISSING: i64 = -2;

/// PTTL sentinel: the key exists and has no expiry.
pub const TTL_NO_EXPIRY: i64 = -1;

/// Clamp a requested sample window: `None` / `Some(0)` fall back to the
/// default, anything above [`MAX_TYPE_SAMPLE_LIMIT`] is silently capped.
pub fn resolve_type_sample_limit(requested: Option<u64>) -> u64 {
    match requested {
        None | Some(0) => DEFAULT_TYPE_SAMPLE_LIMIT,
        Some(n) => n.min(MAX_TYPE_SAMPLE_LIMIT),
    }
}

/// Sample window actually used for a topology: same clamping rules, but a
/// cluster connection is additionally capped at [`CLUSTER_TYPE_SAMPLE_LIMIT`]
/// because typing a key there is one round trip.
pub fn sample_window_for(requested: Option<u64>, topology: Topology) -> u64 {
    let limit = resolve_type_sample_limit(requested);
    match topology {
        Topology::Cluster => limit.min(CLUSTER_TYPE_SAMPLE_LIMIT),
        Topology::Standalone | Topology::Sentinel => limit,
    }
}

/// Whether a distribution is an estimate rather than a census.
///
/// Drives the mandatory "采样 N/M" annotation; `sampled >= dbsize` (a small db
/// scanned in full) is the only case the UI may present as an exact count.
///
/// This one rule is also what makes a cluster answer honest, and it is the
/// reason no cluster-only variant is needed any more: on a cluster `sampled`
/// comes from one pinned shard ([`CLUSTER_SCAN_ANCHOR`]) while `dbsize` is the
/// `Aggregate(Sum)` over every master, so equality can only be reached when the
/// whole cluster's keys happen to live on the shard that was scanned.
pub fn is_sample_truncated(sampled: u64, dbsize: u64) -> bool {
    sampled < dbsize
}

/// Payload of the `type_distribution` command (KV context bar).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeDistribution {
    /// `TYPE` token → key count; serializes as a JSON object. Module types
    /// keep their raw server token (e.g. `ReJSON-RL`). On a cluster these come
    /// from the one pinned shard of [`CLUSTER_SCAN_ANCHOR`], not from every
    /// node.
    pub counts: BTreeMap<String, u64>,
    /// Keys whose type was actually resolved. Always equals the sum of
    /// [`Self::counts`], which is what lets the UI label the sample honestly.
    pub sampled: u64,
    /// `DBSIZE` of the selected database, read exactly once per command. On a
    /// cluster redis routes `DBSIZE` to every master and sums the answers, so
    /// this is the whole cluster's count — a different scope than
    /// [`Self::sampled`], which is why [`Self::truncated`] is rarely `false`
    /// there.
    pub dbsize: u64,
    /// `sampled < dbsize` — the distribution is a sample, not a census.
    pub truncated: bool,
}

impl TypeDistribution {
    /// Fold resolved types into the payload, maintaining the
    /// `sampled == counts.values().sum()` invariant.
    ///
    /// Used for every topology: [`is_sample_truncated`] already says the right
    /// thing on a cluster, where the sample covers one shard and `dbsize` the
    /// whole cluster. A non-truncated cluster answer therefore *is* a census —
    /// all of the cluster's keys live on the scanned shard.
    pub fn from_sample(counts: BTreeMap<String, u64>, dbsize: u64) -> Self {
        let sampled = counts.values().sum();
        Self {
            counts,
            sampled,
            dbsize,
            truncated: is_sample_truncated(sampled, dbsize),
        }
    }
}

/// Payload of the `key_object_info` command (key-attribute sidebar).
///
/// Every field except `missing` / `ttlMs` is optional on purpose: the reply is
/// a partial view, not an all-or-nothing read.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyObjectInfo {
    /// Key vanished (expired / deleted) — a success case, not an error.
    pub missing: bool,
    /// Redis `TYPE`; `None` when that one reply errored.
    #[serde(rename = "type")]
    pub key_type: Option<String>,
    /// `MEMORY USAGE` in bytes; `None` on Redis < 4.0 or when unsupported.
    pub memory_bytes: Option<u64>,
    /// `OBJECT ENCODING`; `None` for module types and on error.
    pub encoding: Option<String>,
    /// `OBJECT IDLETIME` in seconds.
    pub idle_seconds: Option<u64>,
    /// `OBJECT FREQ`; `None` unless `maxmemory-policy` is LFU.
    pub freq: Option<u64>,
    /// `PTTL` in milliseconds: -1 no expiry, -2 missing, >0 remaining.
    pub ttl_ms: i64,
}

impl KeyObjectInfo {
    /// A missing key has no attributes worth reporting; `ttl_ms` keeps the
    /// Redis `-2` sentinel so a pill renderer still has a defined value.
    pub fn missing() -> Self {
        Self {
            missing: true,
            ttl_ms: TTL_MISSING,
            ..Self::default()
        }
    }
}

/// Reply slots of [`build_key_info_pipeline`]; keep in sync with its order.
pub mod key_info_slots {
    pub const MEMORY: usize = 0;
    pub const ENCODING: usize = 1;
    pub const IDLE: usize = 2;
    pub const FREQ: usize = 3;
    pub const TTL: usize = 4;
    pub const TYPE: usize = 5;
}

/// Build the single pipeline behind `key_object_info`.
///
/// Public and side-effect free because it *is* the contract surface: which
/// commands, in what order, one batch, and no keyspace-scanning command.
pub fn build_key_info_pipeline(key: &str) -> redis::Pipeline {
    let mut pipe = redis::Pipeline::with_capacity(KEY_INFO_PIPELINE_LEN);
    pipe.cmd("MEMORY")
        .arg("USAGE")
        .arg(key)
        .cmd("OBJECT")
        .arg("ENCODING")
        .arg(key)
        .cmd("OBJECT")
        .arg("IDLETIME")
        .arg(key)
        .cmd("OBJECT")
        .arg("FREQ")
        .arg(key)
        .cmd("PTTL")
        .arg(key)
        .cmd("TYPE")
        .arg(key);
    pipe
}

/// Does this reply carry no value for the slot it fills?
///
/// `Nil` is unambiguous. A structured `ServerError` / `Push` / `Attribute`
/// carries the payload itself, containers that hold nothing (or nothing
/// usable) answer nothing either. Shapes that are simply not part of a scalar
/// answer stay `false` here — "not unusable" is *not* "trusted": the caller
/// must still recognise the value, which is what keeps an unexpected future
/// shape from being read as a type name or as a missing key
/// (see [`parse_key_info`], state 4).
pub fn is_unusable_reply(value: &RValue) -> bool {
    match value {
        RValue::Nil => true,
        RValue::Array(items) | RValue::Set(items) => {
            items.is_empty() || items.iter().any(is_unusable_reply)
        }
        RValue::Map(_) | RValue::Attribute { .. } | RValue::Push { .. } => true,
        RValue::ServerError(_) => true,
        _ => false,
    }
}

/// Parse a `TYPE` reply into a distribution token.
///
/// `None` means "no usable answer": an errored / absent reply or `none` (the
/// key disappeared between SCAN and TYPE). Dropping those keeps `sampled`
/// equal to the sum of the counts.
pub fn parse_type_token(value: &RValue) -> Option<String> {
    if is_unusable_reply(value) {
        return None;
    }
    let raw = match value {
        RValue::BulkString(bytes) => String::from_utf8_lossy(bytes).into_owned(),
        RValue::SimpleString(s) => s.clone(),
        RValue::VerbatimString { text, .. } => text.clone(),
        RValue::Int(n) => n.to_string(),
        _ => return None,
    };
    let token = raw.trim().to_string();
    if token.is_empty() || token.eq_ignore_ascii_case("none") {
        return None;
    }
    Some(token)
}

/// Does `TYPE` positively answer "this key is not there"?
///
/// Narrower than [`parse_type_token`] returning `None`, which also covers
/// replies that simply make no sense: only an explicit `none` (or the empty
/// token some proxies send) may be reported to the user as "the key expired".
/// Anything else is unreadable, not absent — see [`parse_key_info`].
pub fn type_reply_says_absent(value: &RValue) -> bool {
    parse_opt_string(value).is_some_and(|token| {
        let token = token.trim();
        token.is_empty() || token.eq_ignore_ascii_case("none")
    })
}

/// Parse an integer-ish reply, tolerating the bulk-string form some servers use
/// for integer replies. Errors, nil and non-numeric payloads degrade to `None`.
pub fn parse_opt_int(value: &RValue) -> Option<i64> {
    if is_unusable_reply(value) {
        return None;
    }
    match value {
        RValue::Int(n) => Some(*n),
        RValue::BulkString(bytes) => String::from_utf8_lossy(bytes).trim().parse().ok(),
        RValue::SimpleString(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Parse a string-ish reply; errors and nil degrade to `None`.
pub fn parse_opt_string(value: &RValue) -> Option<String> {
    if is_unusable_reply(value) {
        return None;
    }
    match value {
        RValue::BulkString(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
        RValue::SimpleString(s) => Some(s.clone()),
        RValue::VerbatimString { text, .. } => Some(text.clone()),
        _ => None,
    }
}

fn slot(values: &[RValue], index: usize) -> RValue {
    values.get(index).cloned().unwrap_or(RValue::Nil)
}

/// Assemble the sidebar payload from one batch reply vector.
///
/// Slot order is fixed by [`build_key_info_pipeline`]; `TYPE` decides the state:
///
/// 1. usable type token → full payload;
/// 2. explicit `none` / empty → `missing: true`, i.e. "the key expired";
/// 3. errored or absent reply → "attributes unreadable";
/// 4. any other shape → also "attributes unreadable".
///
/// States 3 and 4 are `(missing: false, type: null, ttlMs: -1)`: neither claims
/// the key is gone, which is why an unrecognised protocol shape can never be
/// silently rendered as an expired key.
pub fn parse_key_info(values: &[RValue]) -> KeyObjectInfo {
    let type_reply = slot(values, key_info_slots::TYPE);
    if is_unusable_reply(&type_reply) {
        tracing::debug!("redis key_object_info: TYPE reply unusable, key kept as present");
        return unreadable_key_state();
    }
    if type_reply_says_absent(&type_reply) {
        // TYPE == "none": the key expired or was deleted before this read.
        return KeyObjectInfo::missing();
    }
    let Some(key_type) = parse_type_token(&type_reply) else {
        tracing::warn!(
            type_reply = ?type_reply,
            "redis key_object_info: TYPE answered something that is not a type name"
        );
        return unreadable_key_state();
    };

    let ttl_ms = match parse_opt_int(&slot(values, key_info_slots::TTL)) {
        Some(n) => n,
        None => {
            // PTTL does not exist below Redis 2.6; -1 (no expiry) is the
            // least misleading value, and the event is logged.
            tracing::warn!(
                ttl_reply = ?slot(values, key_info_slots::TTL),
                "redis key_object_info: PTTL unreadable, reporting no-expiry"
            );
            TTL_NO_EXPIRY
        }
    };

    KeyObjectInfo {
        missing: false,
        key_type: Some(key_type),
        memory_bytes: parse_opt_int(&slot(values, key_info_slots::MEMORY))
            .and_then(|n| u64::try_from(n).ok()),
        encoding: parse_opt_string(&slot(values, key_info_slots::ENCODING)),
        idle_seconds: parse_opt_int(&slot(values, key_info_slots::IDLE))
            .and_then(|n| u64::try_from(n).ok()),
        freq: parse_opt_int(&slot(values, key_info_slots::FREQ))
            .and_then(|n| u64::try_from(n).ok()),
        ttl_ms,
    }
}

/// The "we cannot say anything about this key" payload: the key is not claimed
/// to be gone, and no attribute is offered as fact.
fn unreadable_key_state() -> KeyObjectInfo {
    KeyObjectInfo {
        missing: false,
        ttl_ms: TTL_NO_EXPIRY,
        ..KeyObjectInfo::default()
    }
}

/// The transport capability the cluster path needs and [`ConnectionLike`]
/// cannot express: naming the node a command runs on.
///
/// Left to itself, redis' cluster client picks the node from its own command-name
/// table, which does not describe these probes — see the module docs for what
/// that costs. Only [`Topology::Cluster`] asks for it.
///
/// A single-node connection has exactly one node, so the slot is vacuous and the
/// default implementation just sends the command.
pub trait SlotRoutedConnection: ConnectionLike {
    /// Issue `cmd` against the master that owns `slot`.
    fn command_at_slot<'a>(
        &'a mut self,
        cmd: &'a redis::Cmd,
        _slot: u16,
    ) -> RedisFuture<'a, RValue> {
        self.req_packed_command(cmd)
    }
}

impl SlotRoutedConnection for redis::aio::MultiplexedConnection {}

impl<C> SlotRoutedConnection for redis::cluster_async::ClusterConnection<C>
where
    C: ConnectionLike + redis::cluster_async::Connect + Clone + Send + Sync + Unpin + 'static,
{
    fn command_at_slot<'a>(
        &'a mut self,
        cmd: &'a redis::Cmd,
        slot: u16,
    ) -> RedisFuture<'a, RValue> {
        self.route_command(cmd, master_route(slot)).boxed()
    }
}

/// Address a command at the master owning `slot` — the same route shape redis
/// builds for a keyed command, but computed from the real key rather than from
/// whatever token its table happens to read.
fn master_route(slot: u16) -> RoutingInfo {
    RoutingInfo::SingleNode(SingleNodeRoutingInfo::SpecificNode(Route::new(
        slot,
        SlotAddr::Master,
    )))
}

/// Issue a batch and return the raw per-command replies (see module docs).
///
/// The outer `Err` is reserved for failures of the connection itself, i.e. a
/// batch that never happened at all; per-command errors stay inside the
/// returned vector.
///
/// `Pipeline::query_async` cannot be used here: it folds the vector with
/// `Value::extract_error_vec`, so one rejected command would fail the whole
/// probe.
async fn pipeline_raw<C>(conn: &mut C, pipe: &redis::Pipeline) -> Result<Vec<RValue>, String>
where
    C: ConnectionLike + Send,
{
    let count = pipe.cmd_iter().count();
    if count == 0 {
        return Ok(Vec::new());
    }
    conn.req_packed_commands(pipe, 0, count)
        .await
        .map_err(|e| e.to_string())
}

/// Is this failure about the connection rather than about one command?
///
/// Used only on the per-command path, where an answered error (`OBJECT FREQ` on
/// a non-LFU server, `MEMORY USAGE` below Redis 4.0) degrades a single field
/// while an I/O, timeout or topology failure means the probe never ran and must
/// not be dressed up as "no value". A `MOVED` / `ASK` reaching this point means
/// the redirects were exhausted, i.e. the cluster cannot serve the key right
/// now — explicitly addressed probes (see [`SlotRoutedConnection`]) are what
/// keeps that path quiet in the first place.
fn is_connection_level_failure(error: &redis::RedisError) -> bool {
    error.is_io_error()
        || error.is_unrecoverable_error()
        || error.is_cluster_error()
        || matches!(
            error.kind(),
            redis::ErrorKind::CrossSlot
                | redis::ErrorKind::ClientError
                | redis::ErrorKind::InvalidClientConfig
        )
}

/// Shared tail of the per-command paths: sort "the server answered that it has
/// no value for this field" from "the read never happened".
fn fold_command_answer(answer: Result<RValue, redis::RedisError>) -> Result<RValue, String> {
    match answer {
        Ok(value) => Ok(value),
        Err(error) if is_connection_level_failure(&error) => Err(error.to_string()),
        Err(error) => {
            tracing::debug!(
                error = %error,
                "redis workbench: batch item rejected, degrading that field"
            );
            // A server error on the single-command path arrives as `Err`, not as
            // a `ServerError` value; `Nil` puts it back into the vector so the
            // same parsers degrade it exactly as they degrade a pipeline error.
            Ok(RValue::Nil)
        }
    }
}

/// Issue one command per round trip, addressed to `slot`, degrading answered
/// errors to "no value" exactly like a single-node pipeline degrades one item.
async fn routed_single<C>(conn: &mut C, cmd: &redis::Cmd, slot: u16) -> Result<RValue, String>
where
    C: SlotRoutedConnection + Send,
{
    fold_command_answer(conn.command_at_slot(cmd, slot).await)
}

/// Send a batch as one addressed command at a time — the cluster-safe form of
/// [`pipeline_raw`], answering with one value per command.
async fn routed_sequential<C>(
    conn: &mut C,
    pipe: &redis::Pipeline,
    slot: u16,
) -> Result<Vec<RValue>, String>
where
    C: SlotRoutedConnection + Send,
{
    let commands: Vec<&redis::Cmd> = pipe.cmd_iter().collect();
    tracing::debug!(
        slot,
        commands = commands.len(),
        "redis workbench: addressing every probe at one shard master"
    );
    let mut values = Vec::with_capacity(commands.len());
    for cmd in commands {
        values.push(routed_single(conn, cmd, slot).await?);
    }
    Ok(values)
}

/// Run a batch on the transport that keeps per-command errors per command.
///
/// `key_slot` is the slot the probed key hashes to. A single-node connection has
/// one node, so it ignores the address.
async fn issue_batch<C>(
    conn: &mut C,
    pipe: &redis::Pipeline,
    topology: Topology,
    key_slot: u16,
) -> Result<Vec<RValue>, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    match topology {
        Topology::Cluster => routed_sequential(conn, pipe, key_slot).await,
        Topology::Standalone | Topology::Sentinel => pipeline_raw(conn, pipe).await,
    }
}

/// `DBSIZE` of the currently selected database (read once per command).
///
/// Deliberately **not** addressed, on any topology. `DBSIZE` is one of the
/// commands redis' cluster table does describe — `MultiNode(AllMasters,
/// Aggregate(Sum))` — so the client fans it out and adds the answers up, which
/// is the `M` the context bar's "采样 N/M" label needs. Pinning it to the sample
/// shard instead would report a shard's count as if it were the database's.
/// Two consequences of that policy are documented in the module docs and in
/// `progress.md`: the number spans the whole cluster, and one unreachable (or
/// non-integer-answering) master fails the aggregate, so the command errors
/// rather than reporting a partial total.
async fn fetch_dbsize<C>(conn: &mut C) -> Result<u64, String>
where
    C: ConnectionLike + Send,
{
    let raw: RValue = redis::cmd("DBSIZE")
        .query_async(conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_opt_int(&raw).unwrap_or(0).max(0) as u64)
}

/// One `SCAN` round: `(next cursor, keys)`.
///
/// On a cluster the round is addressed to [`cluster_scan_anchor_slot`] because
/// redis gives `SCAN` no route at all and falls back to a random node, which
/// would pass one node's cursor to another. A rejected `SCAN` is a failed read,
/// never an empty page, so — unlike [`routed_single`] — nothing is degraded
/// here: any error aborts the sampling.
async fn scan_round<C>(
    conn: &mut C,
    cursor: u64,
    topology: Topology,
) -> Result<(u64, Vec<String>), String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    if !matches!(topology, Topology::Cluster) {
        return crate::ops::scan_batch(conn, cursor, TYPE_SCAN_COUNT, None, None).await;
    }
    let mut cmd = redis::cmd("SCAN");
    cmd.arg(cursor).arg("COUNT").arg(TYPE_SCAN_COUNT.max(1));
    let raw = conn
        .command_at_slot(&cmd, cluster_scan_anchor_slot())
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_scan_result(&raw))
}

/// Fill a bounded sample window with `SCAN`, stopping as soon as the window is
/// full or the cursor wraps.
///
/// Both guards below exist because the loop's two natural exits can fail to
/// happen against a proxy or a downgraded replica that keeps handing out a
/// non-zero cursor with no keys: `type_distribution` runs on every db switch and
/// holds this connection's write lock while it runs, so an unbounded scan would
/// stall every other command on the connection. Leaving early is always
/// honest — `sampled` stays the number of keys actually typed, which makes
/// `truncated` report the gap.
async fn collect_sample<C>(
    conn: &mut C,
    limit: u64,
    topology: Topology,
) -> Result<Vec<String>, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    let limit = limit as usize;
    let mut keys: Vec<String> = Vec::new();
    let mut cursor = 0u64;
    let mut rounds = 0u32;
    let mut stalled = 0u32;
    loop {
        let (next, batch) = scan_round(conn, cursor, topology).await?;
        rounds += 1;
        let seen_before = keys.len();
        keys.extend(batch);
        cursor = next;
        stalled = if keys.len() == seen_before {
            stalled + 1
        } else {
            0
        };
        if keys.len() >= limit || cursor == 0 {
            break;
        }
        if rounds >= MAX_SCAN_ROUNDS || stalled >= MAX_STALLED_SCAN_ROUNDS {
            tracing::warn!(
                rounds,
                stalled,
                cursor,
                limit,
                "redis type_distribution: SCAN stopped making progress, sampling what we have"
            );
            break;
        }
    }
    // SCAN may hand the same key out twice across iterations; counting it twice
    // would skew the distribution, so the sample window is de-duplicated.
    keys.sort();
    keys.dedup();
    keys.truncate(limit);
    Ok(keys)
}

/// Resolve `TYPE` for the sample: [`TYPE_PIPELINE_CHUNK`]-sized pipelines, or
/// one addressed command per key on a cluster connection (see the module docs).
async fn sample_types<C>(
    conn: &mut C,
    keys: &[String],
    topology: Topology,
) -> Result<BTreeMap<String, u64>, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    if matches!(topology, Topology::Cluster) {
        for key in keys {
            let mut cmd = redis::cmd("TYPE");
            cmd.arg(key);
            // Keys returned by the pinned shard's `SCAN` hash into that shard's
            // slot range, so addressing by the key's own slot keeps the whole
            // sample on one node.
            let slot = get_slot(key.as_bytes());
            if let Some(token) = parse_type_token(&routed_single(conn, &cmd, slot).await?) {
                *counts.entry(token).or_insert(0) += 1;
            }
        }
        return Ok(counts);
    }
    for chunk in keys.chunks(TYPE_PIPELINE_CHUNK) {
        let mut pipe = redis::Pipeline::with_capacity(chunk.len());
        for key in chunk {
            pipe.cmd("TYPE").arg(key);
        }
        let values = pipeline_raw(conn, &pipe).await?;
        if values.len() != chunk.len() {
            tracing::warn!(
                expected = chunk.len(),
                replied = values.len(),
                "redis type_distribution: short TYPE pipeline reply"
            );
        }
        for value in &values {
            if let Some(token) = parse_type_token(value) {
                *counts.entry(token).or_insert(0) += 1;
            }
        }
    }
    Ok(counts)
}

/// Cursor-sampled type distribution for the selected database.
///
/// On a cluster the sample covers the single pinned shard of
/// [`CLUSTER_SCAN_ANCHOR`] while `dbsize` is the whole cluster's count — see
/// [`scan_round`] and [`fetch_dbsize`] for why each is addressed the way it is.
pub async fn type_distribution<C>(
    conn: &mut C,
    requested_limit: Option<u64>,
    topology: Topology,
) -> Result<TypeDistribution, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    let limit = sample_window_for(requested_limit, topology);
    let dbsize = fetch_dbsize(conn).await?;
    let keys = collect_sample(conn, limit, topology).await?;
    let counts = sample_types(conn, &keys, topology).await?;
    let type_round_trips = match topology {
        Topology::Cluster => keys.len(),
        Topology::Standalone | Topology::Sentinel => keys.len().div_ceil(TYPE_PIPELINE_CHUNK),
    };
    let result = TypeDistribution::from_sample(counts, dbsize);
    tracing::info!(
        dbsize = result.dbsize,
        sampled = result.sampled,
        truncated = result.truncated,
        type_round_trips,
        anchor_slot = match topology {
            Topology::Cluster => cluster_scan_anchor_slot(),
            Topology::Standalone | Topology::Sentinel => 0,
        },
        topology = ?topology,
        "redis type_distribution done"
    );
    Ok(result)
}

/// Key attributes for the sidebar, in a single batch.
///
/// On a cluster the six commands go out one at a time, each addressed to the
/// master owning [`get_slot(key)`], so none of them is left to redis'
/// command-name table (see the module docs).
pub async fn key_object_info<C>(
    conn: &mut C,
    key: &str,
    topology: Topology,
) -> Result<KeyObjectInfo, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    let pipe = build_key_info_pipeline(key);
    let values = issue_batch(conn, &pipe, topology, get_slot(key.as_bytes())).await?;
    if values.len() != KEY_INFO_PIPELINE_LEN {
        // `req_packed_commands` is an internal API whose contract is "one reply
        // per command". If that ever stops holding, reading the vector by slot
        // would silently move every attribute into the next field, so refuse
        // rather than hand the sidebar a plausible-looking wrong answer.
        // (The per-command path cannot produce this shape.)
        tracing::warn!(
            %key,
            expected = KEY_INFO_PIPELINE_LEN,
            replied = values.len(),
            "redis key_object_info: reply vector does not match the request"
        );
        return Err(format!(
            "key_object_info: expected {KEY_INFO_PIPELINE_LEN} replies for {KEY_INFO_PIPELINE_LEN} commands, got {}",
            values.len()
        ));
    }
    let info = parse_key_info(&values);
    if info.missing {
        tracing::debug!(%key, "redis key_object_info: key expired or deleted");
    }
    Ok(info)
}

#[cfg(test)]
mod tests;
