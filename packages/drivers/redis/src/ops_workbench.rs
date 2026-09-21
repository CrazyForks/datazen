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
//!   connection the same six commands go out one at a time (see below), which
//!   keeps the degradation contract and costs six round trips instead of one.
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
//! [`Topology::Cluster`] the very same commands are issued one at a time with
//! [`redis::aio::ConnectionLike::req_packed_command`], which the cluster client
//! routes per key and whose errors are per command by construction. Degradation
//! semantics are then identical; only the cost differs (one round trip per
//! command), which is why the cluster sample window is bounded far tighter — see
//! [`CLUSTER_TYPE_SAMPLE_LIMIT`].
//!
//! Upgrading the `redis` dependency is a documented review point: this module
//! relies on `req_packed_commands` (`#[doc(hidden)]` internal API) answering with
//! exactly one reply per command, and [`key_object_info`] rejects a reply vector
//! of any other length rather than mis-reading the slots.

use std::collections::BTreeMap;

use redis::aio::ConnectionLike;
use redis::Value as RValue;
use serde::Serialize;

use crate::connect::Topology;

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
pub fn is_sample_truncated(sampled: u64, dbsize: u64) -> bool {
    sampled < dbsize
}

/// Payload of the `type_distribution` command (KV context bar).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeDistribution {
    /// `TYPE` token → key count; serializes as a JSON object. Module types
    /// keep their raw server token (e.g. `ReJSON-RL`).
    pub counts: BTreeMap<String, u64>,
    /// Keys whose type was actually resolved. Always equals the sum of
    /// [`Self::counts`], which is what lets the UI label the sample honestly.
    pub sampled: u64,
    /// `DBSIZE` of the selected database, read exactly once per command.
    pub dbsize: u64,
    /// `sampled < dbsize` — the distribution is a sample, not a census.
    pub truncated: bool,
}

impl TypeDistribution {
    /// Fold resolved types into the payload, maintaining the
    /// `sampled == counts.values().sum()` invariant.
    pub fn from_sample(counts: BTreeMap<String, u64>, dbsize: u64) -> Self {
        let sampled = counts.values().sum();
        Self {
            counts,
            sampled,
            dbsize,
            truncated: is_sample_truncated(sampled, dbsize),
        }
    }

    /// [`Self::from_sample`] for a view that can never see the whole database.
    ///
    /// A cluster connection samples the one node its unkeyed `SCAN` / `DBSIZE`
    /// happened to route to, so `dbsize` is a shard's count and the types are a
    /// shard's sample: wrapping the cursor proves nothing about the keyspace.
    /// `truncated` is therefore forced on (PRD §3.4 — a sample must never read
    /// as an exact distribution), except when there is nothing to claim at all.
    pub fn from_sharded_view(counts: BTreeMap<String, u64>, dbsize: u64) -> Self {
        let mut dist = Self::from_sample(counts, dbsize);
        if dist.sampled > 0 || dist.dbsize > 0 {
            dist.truncated = true;
        }
        dist
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
/// not be dressed up as "no value".
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

/// Issue one command per round trip, degrading answered errors to "no value".
async fn single_command<C>(conn: &mut C, cmd: &redis::Cmd) -> Result<RValue, String>
where
    C: ConnectionLike + Send,
{
    match conn.req_packed_command(cmd).await {
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

/// Send a batch one command at a time — the cluster-safe form of
/// [`pipeline_raw`], answering with one value per command.
async fn sequential_raw<C>(conn: &mut C, pipe: &redis::Pipeline) -> Result<Vec<RValue>, String>
where
    C: ConnectionLike + Send,
{
    let mut values = Vec::with_capacity(pipe.cmd_iter().count());
    for cmd in pipe.cmd_iter() {
        values.push(single_command(conn, cmd).await?);
    }
    Ok(values)
}

/// Run a batch on the transport that keeps per-command errors per command.
async fn issue_batch<C>(
    conn: &mut C,
    pipe: &redis::Pipeline,
    topology: Topology,
) -> Result<Vec<RValue>, String>
where
    C: ConnectionLike + Send,
{
    match topology {
        Topology::Cluster => sequential_raw(conn, pipe).await,
        Topology::Standalone | Topology::Sentinel => pipeline_raw(conn, pipe).await,
    }
}

/// `DBSIZE` of the currently selected database (read once per command).
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
async fn collect_sample<C>(conn: &mut C, limit: u64) -> Result<Vec<String>, String>
where
    C: ConnectionLike + Send,
{
    let limit = limit as usize;
    let mut keys: Vec<String> = Vec::new();
    let mut cursor = 0u64;
    let mut rounds = 0u32;
    let mut stalled = 0u32;
    loop {
        let (next, batch) =
            crate::ops::scan_batch(conn, cursor, TYPE_SCAN_COUNT, None, None).await?;
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
/// one command per key on a cluster connection (see the module docs).
async fn sample_types<C>(
    conn: &mut C,
    keys: &[String],
    topology: Topology,
) -> Result<BTreeMap<String, u64>, String>
where
    C: ConnectionLike + Send,
{
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    if matches!(topology, Topology::Cluster) {
        for key in keys {
            let mut cmd = redis::cmd("TYPE");
            cmd.arg(key);
            if let Some(token) = parse_type_token(&single_command(conn, &cmd).await?) {
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
pub async fn type_distribution<C>(
    conn: &mut C,
    requested_limit: Option<u64>,
    topology: Topology,
) -> Result<TypeDistribution, String>
where
    C: ConnectionLike + Send,
{
    let limit = sample_window_for(requested_limit, topology);
    let dbsize = fetch_dbsize(conn).await?;
    let keys = collect_sample(conn, limit).await?;
    let counts = sample_types(conn, &keys, topology).await?;
    let type_round_trips = match topology {
        Topology::Cluster => keys.len(),
        Topology::Standalone | Topology::Sentinel => keys.len().div_ceil(TYPE_PIPELINE_CHUNK),
    };
    let result = match topology {
        Topology::Cluster => TypeDistribution::from_sharded_view(counts, dbsize),
        Topology::Standalone | Topology::Sentinel => TypeDistribution::from_sample(counts, dbsize),
    };
    tracing::info!(
        dbsize = result.dbsize,
        sampled = result.sampled,
        truncated = result.truncated,
        type_round_trips,
        topology = ?topology,
        "redis type_distribution done"
    );
    Ok(result)
}

/// Key attributes for the sidebar, in a single batch.
pub async fn key_object_info<C>(
    conn: &mut C,
    key: &str,
    topology: Topology,
) -> Result<KeyObjectInfo, String>
where
    C: ConnectionLike + Send,
{
    let pipe = build_key_info_pipeline(key);
    let values = issue_batch(conn, &pipe, topology).await?;
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
