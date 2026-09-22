//! Budgeted key-tree scan pages and the cluster-safe batches behind them.
//!
//! This module owns the *cost shape* of the key tree (PRD §3.2, §4 I-2/I-3):
//!
//! - [`scan_budgeted`] walks `SCAN` under a [`ScanBudget`] ledger, so one action
//!   can never spend more cumulative `COUNT` than its budget, and anything it
//!   could not reach is reported as `truncated` rather than silently missing.
//! - [`read_dbsize`] is called **once per command**, both to scale that budget
//!   and to fill the reply's `dbsize` — the flat browser used to re-send it on
//!   every page.
//! - [`fetch_key_meta`] / [`fetch_key_values`] resolve a page's per-key
//!   attributes in **two batches per page** (type / expiry / memory, then
//!   logical-length / preview) instead of one round trip per key per attribute.
//! - [`count_budgeted`] is the same loop for `count_matching`, which is what
//!   lets a partial answer be labelled `n+`.
//!
//! # Cluster discipline (do not regress this)
//!
//! A single-node `Pipeline` cannot be used as-is on a cluster connection:
//! `ClusterConnection` pins a batch to one slot (`route_for_pipeline` →
//! `CrossSlot`) and re-folds per-command errors into one batch error, so a
//! cross-key page batch would fail the whole command whenever the page crosses a
//! slot, and one rejected command (e.g. `MEMORY USAGE` below Redis 4.0) would
//! take the page down with it. [`fetch_key_group`] is the unit of the fix, and it
//! is the same shape `ops_workbench::fetch_memory_sample_fields` already uses:
//!
//! * standalone / sentinel: one chunked pipeline per
//!   [`TREE_KEYS_PER_PIPELINE`] keys;
//! * cluster: **one addressed batch per key** (all of a key's commands hash to
//!   that key's own slot, so the batch is never cross-slot) aimed at the shard
//!   owning it, replayed command-by-command if the batch is rejected — so a bad
//!   field degrades alone instead of failing the page.
//!
//! `SCAN` is pinned on a cluster too: redis gives it no route at all, which would
//! hand one node's cursor to another node, so every round of one action goes to
//! [`cluster_scan_anchor_slot`]. The consequence Wave 4 must render honestly: a
//! cluster page covers **one shard**, while `dbsize` is `DBSIZE` fanned out over
//! all masters and summed (redis' own routing table; deliberately *not* addressed
//! here — see `ops_workbench`'s module docs). That is `type_distribution`'s
//! established 口径, and it is strictly better than the pre-budget behaviour,
//! where a multi-page tree walk mixed shards cursor by cursor.

use std::time::Instant;

use datazen_driver_api::{DriverError, KeyEntry};
use redis::aio::ConnectionLike;
use redis::cluster_routing::get_slot;
use redis::Value as RValue;

use crate::connect::Topology;
use crate::ops_key_probe::key_exists;
use crate::ops_tree_budget::{is_exact_key_pattern, tree_scan_budget, ScanBudget, ScanLoopGuard};
use crate::ops_workbench::{
    cluster_scan_anchor_slot, parse_opt_int, parse_type_token, type_reply_says_absent,
    SlotRoutedConnection, TTL_MISSING,
};
use crate::redis_driver_on::normalize_type_filter;
use crate::redis_value::{
    parse_scan_result, preview_value_to_string, truncate_preview, value_to_string,
};

/// Keys resolved per batch on a single node. A 200-key page is one round trip.
pub const TREE_KEYS_PER_PIPELINE: usize = 256;

/// Commands per key in the meta batch: `TYPE` + `TTL`.
pub const META_FIELDS_BASE: usize = 2;

/// Extra commands per key when the caller asked for `withMemory` (`MEMORY USAGE`).
pub const META_FIELDS_MEMORY: usize = 1;

/// Commands per key in the value batch when both exist (`length` + `preview`).
pub const VALUE_FIELDS_MAX: usize = 2;

/// Preview truncation, identical to the pre-pipeline implementation.
const PREVIEW_MAX: usize = 120;

/// What the value batch renders for a stream, where no read is issued at all.
const STREAM_PREVIEW: &str = "(stream)";

// ---------------------------------------------------------------------------
// Cluster-safe batches
// ---------------------------------------------------------------------------

/// Issue a batch and answer with one value per command, keeping per-command
/// errors *inside* the vector.
///
/// `Pipeline::query_async` is unusable here: it folds the reply vector through
/// `Value::extract_error_vec`, so a single rejected command would fail the batch.
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

/// Is this failure about the transport rather than about one command?
///
/// An answered error (`MEMORY USAGE` on Redis < 4.0) degrades one field; an I/O,
/// timeout or topology failure means the batch never ran and must not be dressed
/// up as "no value" — the same split `ops_workbench` draws.
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

/// Turn one command's answer into a reply slot: a server error becomes `Nil`, so
/// the shared parsers degrade that field exactly as they degrade a pipeline item.
fn fold_command_answer(answer: Result<RValue, redis::RedisError>) -> Result<RValue, String> {
    match answer {
        Ok(value) => Ok(value),
        Err(error) if is_connection_level_failure(&error) => Err(error.to_string()),
        Err(error) => {
            tracing::debug!(
                error = %error,
                "redis key tree: batch item rejected, degrading that field"
            );
            Ok(RValue::Nil)
        }
    }
}

/// Send a batch one addressed command at a time — the cluster form of
/// [`pipeline_raw`], answering with one value per command.
async fn replay_per_command<C>(
    conn: &mut C,
    pipe: &redis::Pipeline,
    slot: u16,
) -> Result<Vec<RValue>, String>
where
    C: SlotRoutedConnection + Send,
{
    let mut values = Vec::new();
    for cmd in pipe.cmd_iter() {
        values.push(fold_command_answer(conn.command_at_slot(cmd, slot).await)?);
    }
    Ok(values)
}

/// Read one key's whole batch, whatever the topology.
///
/// On a cluster the batch is addressed to the master owning [`get_slot(key)`],
/// which is what keeps a key's commands from ever being a cross-slot pipeline.
/// `route_pipeline` folds a rejected command into one batch error, so a rejection
/// — or a short vector — replays *this key* command by command, restoring the
/// "one bad field degrades alone" contract at the cost of de-batching one key.
///
/// The outer `Err` is reserved for transport failures: a page that never ran.
pub(crate) async fn fetch_key_group<C>(
    conn: &mut C,
    key: &str,
    pipe: &redis::Pipeline,
    topology: Topology,
) -> Result<Vec<RValue>, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    let count = pipe.cmd_iter().count();
    if count == 0 {
        return Ok(Vec::new());
    }
    if !matches!(topology, Topology::Cluster) {
        return pipeline_raw(conn, pipe).await;
    }
    let slot = get_slot(key.as_bytes());
    match conn.pipeline_at_slot(pipe, slot).await {
        Ok(values) if values.len() == count => Ok(values),
        Ok(partial) => {
            tracing::debug!(
                %key,
                replied = partial.len(),
                expected = count,
                "redis key tree: addressed batch answered a short vector, replaying per command"
            );
            replay_per_command(conn, pipe, slot).await
        }
        Err(error) => {
            tracing::debug!(
                %key,
                error = %error,
                "redis key tree: addressed batch rejected, replaying per command"
            );
            replay_per_command(conn, pipe, slot).await
        }
    }
}

/// One key plus the type that decides which follow-up commands it needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageKey {
    /// The key name as `SCAN` reported it.
    pub key: String,
    /// Redis `TYPE` token already resolved for it (lower-cased).
    pub key_type: String,
}

/// Cut a flat reply vector into groups of the sizes the builder declared.
///
/// A group that ran out of replies gets `Nil` fillers rather than borrowing the
/// next key's answers, which is what keeps a short vector from being rendered as
/// plausible-looking wrong data. Keys that issued no commands at all still get a
/// group, so caller-side index arithmetic stays valid.
fn scatter(values: Vec<RValue>, sizes: &[usize]) -> Vec<Vec<RValue>> {
    let mut groups: Vec<Vec<RValue>> = Vec::with_capacity(sizes.len());
    let mut rest = values.into_iter();
    for size in sizes {
        let mut group = Vec::with_capacity(*size);
        for _ in 0..*size {
            group.push(rest.next().unwrap_or(RValue::Nil));
        }
        groups.push(group);
    }
    groups
}

/// Run one logical page batch and hand back one reply group per item.
///
/// `build` turns items into `(pipeline, commands-per-item)`; the per-item counts
/// let a variable-arity batch (a vanished key asks for nothing) still land one
/// group per item.
async fn fetch_page_groups<C, I, B>(
    conn: &mut C,
    items: &[I],
    topology: Topology,
    build: B,
) -> Result<Vec<Vec<RValue>>, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
    I: GroupItem,
    B: Fn(&[I]) -> (redis::Pipeline, Vec<usize>),
{
    let mut groups: Vec<Vec<RValue>> = Vec::with_capacity(items.len());
    if items.is_empty() {
        return Ok(groups);
    }

    if matches!(topology, Topology::Cluster) {
        for item in items {
            let (pipe, sizes) = build(std::slice::from_ref(item));
            let values = fetch_key_group(conn, item.key(), &pipe, topology).await?;
            for group in scatter(values, &sizes) {
                groups.push(group);
            }
        }
        return Ok(groups);
    }

    for chunk in items.chunks(TREE_KEYS_PER_PIPELINE) {
        let (pipe, sizes) = build(chunk);
        let expected = sizes.iter().sum::<usize>();
        let values = pipeline_raw(conn, &pipe).await?;
        if values.len() != expected {
            tracing::warn!(
                expected,
                replied = values.len(),
                keys = chunk.len(),
                "redis key tree: page batch answered a short vector, degrading the trailing keys"
            );
        }
        groups.extend(scatter(values, &sizes));
    }
    Ok(groups)
}

/// The key a group's commands are about — needed to address it on a cluster.
///
/// The small overloads keep [`fetch_page_groups`] usable for both batches: the
/// meta batch is keyed by the bare key name, the value batch by key + type.
trait GroupItem: Clone {
    fn key(&self) -> &str;
}

impl GroupItem for String {
    fn key(&self) -> &str {
        self
    }
}

impl GroupItem for PageKey {
    fn key(&self) -> &str {
        &self.key
    }
}

// ---------------------------------------------------------------------------
// SCAN under a budget
// ---------------------------------------------------------------------------

/// One `SCAN` round: `SCAN cursor COUNT n [MATCH p] [TYPE t]`.
///
/// Cluster rounds are addressed to [`cluster_scan_anchor_slot`] so a multi-round
/// page stays one shard's scan instead of feeding one node's cursor to another.
pub(crate) async fn scan_round<C>(
    conn: &mut C,
    cursor: u64,
    count: u32,
    pattern: Option<&str>,
    type_filter: Option<&str>,
    topology: Topology,
) -> Result<(u64, Vec<String>), String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    if !matches!(topology, Topology::Cluster) {
        return crate::ops::scan_batch(conn, cursor, count, pattern, type_filter).await;
    }
    let mut cmd = redis::cmd("SCAN");
    cmd.arg(cursor).arg("COUNT").arg(count.max(1));
    if let Some(p) = pattern {
        cmd.arg("MATCH").arg(p);
    }
    if let Some(t) = type_filter {
        cmd.arg("TYPE").arg(t);
    }
    let raw: RValue = conn
        .command_at_slot(&cmd, cluster_scan_anchor_slot())
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_scan_result(&raw))
}

/// What one budgeted scan pass collected.
#[derive(Debug, Clone)]
pub struct ScannedPage {
    /// Keys seen, de-duplicated across rounds (`SCAN` may repeat a key).
    pub keys: Vec<String>,
    /// Cursor to resume from; `0` means the keyspace was walked to the end.
    pub next_cursor: u64,
    /// Cumulative `COUNT` actually spent — the reply's `consumed`.
    pub consumed: u64,
    /// The pass stopped on a cap (budget or round guard) with the cursor still
    /// open, so there is data the caller did not see.
    pub truncated: bool,
    /// The cursor wrapped: everything reachable was seen.
    pub exhausted: bool,
}

/// Walk `SCAN` until the page is full, the cursor wraps, or the budget is spent.
///
/// * `count_hint` — `SCAN COUNT` the loop aims for per round. For a page it is
///   the caller's `count`, so `count` keeps meaning "keys per page" exactly as it
///   did when one `SCAN` served one page; for a full count the hint is small, so
///   the budget is spent over many rounds instead of one.
/// * `stop_at` — how many keys make the page full. `usize::MAX` means "scan until
///   the cursor wraps or the budget is gone" (the `count_matching` shape).
///
/// Reaching `stop_at` with the cursor still open is *pagination*, not
/// truncation: `truncated` stays `false` and `next_cursor` resumes. Only a cap
/// (budget spent, or the round/stall guard) reports `truncated`.
// Every parameter is an independent loop input (cursor, COUNT hint, stop
// condition, filters, ledger, topology); bundling them would hide which one a
// caller actually varies.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn scan_budgeted<C>(
    conn: &mut C,
    start_cursor: u64,
    count_hint: u32,
    stop_at: usize,
    pattern: Option<&str>,
    type_filter: Option<&str>,
    budget: &mut ScanBudget,
    topology: Topology,
) -> Result<ScannedPage, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    let mut keys: Vec<String> = Vec::new();
    let mut cursor = start_cursor;
    let mut guard = ScanLoopGuard::new();
    let mut exhausted = false;

    loop {
        let Some(count) = budget.next_count(count_hint) else {
            break;
        };
        budget.charge(count);
        let (next, batch) = scan_round(conn, cursor, count, pattern, type_filter, topology).await?;
        guard.record_round(!batch.is_empty());
        keys.extend(batch);
        cursor = next;
        if cursor == 0 {
            exhausted = true;
            break;
        }
        if keys.len() >= stop_at {
            break;
        }
        if guard.cap_hit() {
            tracing::warn!(
                rounds = guard.rounds(),
                cursor,
                stop_at,
                consumed = budget.consumed(),
                "redis key tree: SCAN stopped making progress, reporting what we have"
            );
            break;
        }
    }

    dedup_keys(&mut keys);
    let page_filled = keys.len() >= stop_at;
    Ok(ScannedPage {
        keys,
        next_cursor: cursor,
        consumed: budget.consumed(),
        truncated: !(exhausted || page_filled),
        exhausted,
    })
}

/// Drop duplicate keys `SCAN` may hand out twice across rounds, keeping the
/// first occurrence so the page order stays the server's.
fn dedup_keys(keys: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::with_capacity(keys.len());
    keys.retain(|key| seen.insert(key.clone()));
}

/// `DBSIZE` of the selected database. Read **once per command** by every op in
/// this module — it both scales the budget and fills the reply's `dbsize`.
///
/// Deliberately unrouted on every topology: redis' own cluster table fans
/// `DBSIZE` out to all masters and sums the answers, which is the whole-database
/// number the UI's "共 M 个 key" needs (see `ops_workbench`'s module docs).
///
/// **It cannot fail**, and that is a contract, not a convenience (redis-tree-backend-BUG-003):
/// `DBSIZE` is routinely refused — an ACL profile without the flag (`-NOPERM`), a
/// managed/proxy tier that hides the command, or one unreachable master under the
/// cluster fan-out above. This value is an *input to a budget* and a *display
/// number*; neither is worth a failed page, and the pre-budget code agreed
/// (`8981d3078`'s `redis_driver_on.rs:138` read it as `unwrap_or(0)`). An
/// unusable reply therefore yields `0`, which makes the budget fall back to
/// [`DEFAULT_TREE_BUDGET`] via [`tree_scan_budget`] — the "DBSIZE 不可得 ⇒ 默认档"
/// degradation `## 契约冻结` promises. The signature has no `Result` so a future
/// caller cannot re-raise it into a hard dependency again.
pub(crate) async fn read_dbsize<C>(conn: &mut C) -> u64
where
    C: ConnectionLike + Send,
{
    let raw: Result<RValue, _> = redis::cmd("DBSIZE").query_async(conn).await;
    match raw {
        // A reply we could not read as a number is the same degraded case as an
        // error, so it warns too rather than quietly reporting an empty database.
        Ok(value) => match parse_opt_int(&value) {
            Some(n) if n >= 0 => n as u64,
            _ => {
                tracing::warn!(
                    "redis key tree: DBSIZE reply was unusable, budget falls back to the default tier"
                );
                0
            }
        },
        Err(err) => {
            tracing::warn!(
                error = %err,
                "redis key tree: DBSIZE refused, budget falls back to the default tier"
            );
            0
        }
    }
}

// ---------------------------------------------------------------------------
// Page batch 1: TYPE / TTL / (MEMORY USAGE)
// ---------------------------------------------------------------------------

/// Attributes of one key that need no knowledge of its type.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct KeyMeta {
    /// Redis `TYPE`, lower-cased. `"none"` when the key is gone *or* the answer
    /// was unusable — [`KeyMeta::absent`] is what tells those apart.
    pub key_type: String,
    /// `TTL` in **seconds**: `-1` no expiry, `-2` missing, `>=0` remaining.
    pub ttl: i64,
    /// `MEMORY USAGE` in bytes; `None` when not requested or unsupported.
    pub mem_bytes: Option<u64>,
    /// `TYPE` positively answered `none`: the key expired or was deleted between
    /// the scan and this read. An unreadable reply is *not* absence.
    pub absent: bool,
}

/// Commands one key contributes to the meta batch.
pub fn meta_fields_per_key(with_memory: bool) -> usize {
    META_FIELDS_BASE + if with_memory { META_FIELDS_MEMORY } else { 0 }
}

/// Reply slots inside one key's meta group.
pub mod meta_slots {
    /// `TYPE`.
    pub const TYPE: usize = 0;
    /// `TTL`.
    pub const TTL: usize = 1;
    /// `MEMORY USAGE`, only present when `withMemory` was requested.
    pub const MEMORY: usize = 2;
}

/// Build the meta batch: per key `TYPE` + `TTL` (+ `MEMORY USAGE`).
///
/// Side-effect free, so it *is* the contract surface: which commands, in what
/// order, in one batch.
pub fn build_meta_pipeline(keys: &[String], with_memory: bool) -> (redis::Pipeline, Vec<usize>) {
    let per_key = meta_fields_per_key(with_memory);
    let mut pipe = redis::Pipeline::with_capacity(keys.len() * per_key);
    for key in keys {
        pipe.cmd("TYPE").arg(key).cmd("TTL").arg(key);
        if with_memory {
            pipe.cmd("MEMORY").arg("USAGE").arg(key);
        }
    }
    (pipe, vec![per_key; keys.len()])
}

fn reply_at(values: &[RValue], index: usize) -> RValue {
    values.get(index).cloned().unwrap_or(RValue::Nil)
}

/// Assemble one key's meta replies. Every slot degrades through the shared
/// parsers, so a reply that is simply not there is never invented into a type
/// name or an expiry.
pub fn parse_meta_group(values: &[RValue], with_memory: bool) -> KeyMeta {
    let type_reply = reply_at(values, meta_slots::TYPE);
    KeyMeta {
        key_type: parse_type_token(&type_reply)
            .unwrap_or_else(|| "none".to_string())
            .to_ascii_lowercase(),
        ttl: parse_opt_int(&reply_at(values, meta_slots::TTL)).unwrap_or(TTL_MISSING),
        mem_bytes: if with_memory {
            parse_opt_int(&reply_at(values, meta_slots::MEMORY)).and_then(|n| u64::try_from(n).ok())
        } else {
            None
        },
        absent: type_reply_says_absent(&type_reply),
    }
}

/// Resolve type / TTL (+ memory) for a page in one batch per chunk.
pub(crate) async fn fetch_key_meta<C>(
    conn: &mut C,
    keys: &[String],
    with_memory: bool,
    topology: Topology,
) -> Result<Vec<KeyMeta>, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    let groups = fetch_page_groups(conn, keys, topology, |chunk| {
        build_meta_pipeline(chunk, with_memory)
    })
    .await?;
    Ok(groups
        .iter()
        .map(|group| parse_meta_group(group, with_memory))
        .collect())
}

// ---------------------------------------------------------------------------
// Page batch 2: logical length + preview (both type-dependent)
// ---------------------------------------------------------------------------

/// Value-derived attributes of one key.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ValueFields {
    /// Logical length (`STRLEN` / `HLEN` / …) in elements or bytes; `0` when the
    /// type has no length command or the reply was unusable.
    pub logical_len: u64,
    /// Truncated preview text; `""` for module / unknown types.
    pub preview: String,
}

/// `O(1)` length command for a type, or `None` when there is none.
pub fn length_command_for(key_type: &str) -> Option<&'static str> {
    match key_type {
        "string" => Some("STRLEN"),
        "list" => Some("LLEN"),
        "set" => Some("SCARD"),
        "zset" => Some("ZCARD"),
        "hash" => Some("HLEN"),
        "stream" => Some("XLEN"),
        _ => None,
    }
}

/// Does this type get a preview read at all?
///
/// Mirrors the pre-pipeline `preview_on` exactly, including the deliberate
/// omissions: `stream` needs no read (a fixed label), and any other type —
/// modules such as `ReJSON-RL` included — is reported without a preview rather
/// than read blind.
pub fn has_preview_command(key_type: &str) -> bool {
    matches!(key_type, "string" | "list" | "hash" | "set" | "zset")
}

/// Append this key's preview command to `pipe`.
fn push_preview_cmd(pipe: &mut redis::Pipeline, key_type: &str, key: &str) {
    match key_type {
        "string" => {
            pipe.cmd("GET").arg(key);
        }
        "list" => {
            pipe.cmd("LRANGE").arg(key).arg(0).arg(2);
        }
        // `HSCAN COUNT 3`, never `HGETALL`: a large hash must not be loaded just
        // to show two fields.
        "hash" => {
            pipe.cmd("HSCAN").arg(key).arg(0).arg("COUNT").arg(3);
        }
        "set" => {
            pipe.cmd("SRANDMEMBER").arg(key).arg(3);
        }
        "zset" => {
            pipe.cmd("ZRANGE").arg(key).arg(0).arg(2).arg("WITHSCORES");
        }
        _ => {}
    }
}

/// Build the second batch: per key `[length] + [preview]`, only for the types
/// that answer those questions. `types` is index-aligned with `keys`.
pub fn build_value_pipeline(keys: &[PageKey]) -> (redis::Pipeline, Vec<usize>) {
    let mut pipe = redis::Pipeline::with_capacity(keys.len() * VALUE_FIELDS_MAX);
    let mut sizes = Vec::with_capacity(keys.len());
    for item in keys {
        let mut commands = 0usize;
        if let Some(cmd) = length_command_for(&item.key_type) {
            pipe.cmd(cmd).arg(&item.key);
            commands += 1;
        }
        if has_preview_command(&item.key_type) {
            push_preview_cmd(&mut pipe, &item.key_type, &item.key);
            commands += 1;
        }
        sizes.push(commands);
    }
    (pipe, sizes)
}

/// Array reply → list of strings, `[]` for anything that is not an array.
fn reply_array(value: &RValue) -> Vec<String> {
    match value {
        RValue::Array(items) => items.iter().map(value_to_string).collect(),
        RValue::Nil => Vec::new(),
        other => vec![value_to_string(other)],
    }
}

/// Extract field/value pairs from an `HSCAN` reply for the preview.
///
/// Moved verbatim from `redis_driver_on`, where it served the per-key preview
/// loop; `HSCAN` answers `[cursor, [field, value, …]]`.
pub fn extract_hscan_preview(raw: &RValue) -> Vec<String> {
    if let RValue::Array(items) = raw {
        if items.len() >= 2 {
            if let RValue::Array(members) = &items[1] {
                let mut result = Vec::new();
                for chunk in members.chunks(2) {
                    if chunk.len() == 2 {
                        let field = value_to_string(&chunk[0]);
                        let value = value_to_string(&chunk[1]);
                        result.push(format!("{field}: {value}"));
                    }
                }
                return result;
            }
        }
    }
    Vec::new()
}

/// Render one key's preview from its type and the replies the batch collected.
pub fn render_preview(key_type: &str, preview_reply: Option<&RValue>) -> String {
    let raw = match key_type {
        "string" => preview_value_to_string(preview_reply.unwrap_or(&RValue::Nil), "string"),
        "list" | "set" => {
            let vals = preview_reply.map(reply_array).unwrap_or_default();
            format!("{vals:?}")
        }
        "zset" => {
            let vals = preview_reply.map(reply_array).unwrap_or_default();
            format!("{vals:?}")
        }
        "hash" => {
            let vals = preview_reply.map(extract_hscan_preview).unwrap_or_default();
            format!("{vals:?}")
        }
        "stream" => STREAM_PREVIEW.to_string(),
        _ => return String::new(),
    };
    truncate_preview(&raw, PREVIEW_MAX)
}

/// Assemble one key's length/preview replies. Slot order is fixed by
/// [`build_value_pipeline`], and both presence checks are re-derived from the
/// type, so the group is read the same way it was written.
pub fn parse_value_group(values: &[RValue], key_type: &str) -> ValueFields {
    let has_len = length_command_for(key_type).is_some();
    let has_preview = has_preview_command(key_type);
    let logical_len = if has_len {
        parse_opt_int(&reply_at(values, 0))
            .and_then(|n| u64::try_from(n).ok())
            .unwrap_or(0)
    } else {
        0
    };
    let preview_index = usize::from(has_len);
    let preview_reply = if has_preview {
        match values.get(preview_index) {
            Some(RValue::Nil) | None => None,
            Some(value) => Some(value),
        }
    } else {
        None
    };
    ValueFields {
        logical_len,
        preview: render_preview(key_type, preview_reply),
    }
}

/// Fetch logical length + preview for a page whose types are already known.
pub(crate) async fn fetch_key_values<C>(
    conn: &mut C,
    items: &[PageKey],
    topology: Topology,
) -> Result<Vec<ValueFields>, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    let groups = fetch_page_groups(conn, items, topology, build_value_pipeline).await?;
    Ok(groups
        .iter()
        .zip(items.iter())
        .map(|(group, item)| parse_value_group(group, &item.key_type))
        .collect())
}

// ---------------------------------------------------------------------------
// Command-level pages
// ---------------------------------------------------------------------------

/// One flat `scan_keys` page.
#[derive(Debug, Clone)]
pub struct ScanKeysPage {
    /// Keys with type / TTL / size / preview resolved.
    pub entries: Vec<KeyEntry>,
    /// Resume cursor (`0` = end of this pass).
    pub next_cursor: u64,
    /// Cumulative `COUNT` spent.
    pub consumed: u64,
    /// Budget or round cap hit before the cursor wrapped.
    pub truncated: bool,
    /// `DBSIZE`, read exactly once for this call.
    pub dbsize: u64,
    /// The exact-key short circuit (PRD §4 I-3) served this page.
    pub exact: bool,
}

/// Assemble the reply rows once both batches are in.
///
/// `size` keeps its established meaning: `MEMORY USAGE` bytes when
/// `with_memory` was asked for and answered, otherwise the logical length.
fn build_entries(
    rows: Vec<(String, KeyMeta)>,
    values: &[ValueFields],
    with_memory: bool,
) -> Vec<KeyEntry> {
    rows.into_iter()
        .enumerate()
        .map(|(index, (key, meta))| {
            let logical_len = values
                .get(index)
                .map(|value| value.logical_len)
                .unwrap_or(0);
            KeyEntry {
                key,
                key_type: meta.key_type,
                ttl: meta.ttl,
                size: if with_memory {
                    meta.mem_bytes.unwrap_or(logical_len)
                } else {
                    logical_len
                },
                preview: values
                    .get(index)
                    .map(|value| value.preview.clone())
                    .unwrap_or_default(),
            }
        })
        .collect()
}

/// One page of the flat key browser.
///
/// `budget` is the optional cumulative COUNT cap for this action; `None` lets
/// [`tree_scan_budget`] derive it from the `DBSIZE` read here. An exact key name
/// (no glob character) never touches `SCAN` (PRD §4 I-3), and no value is read
/// for it beyond the same preview commands every other row uses.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn scan_keys_page<C>(
    conn: &mut C,
    pattern: &str,
    cursor: u64,
    count: u32,
    key_type: Option<&str>,
    with_memory: bool,
    no_ttl_only: bool,
    budget: Option<u64>,
    topology: Topology,
    t0: Instant,
) -> Result<ScanKeysPage, DriverError>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    let dbsize = read_dbsize(conn).await;
    let mut ledger = ScanBudget::new(tree_scan_budget(budget, dbsize));
    let exact = is_exact_key_pattern(pattern);

    let (keys, next_cursor, consumed, truncated) = if exact {
        (vec![pattern.to_string()], 0u64, 0u64, false)
    } else {
        let match_pat = (!pattern.is_empty() && pattern != "*").then_some(pattern);
        let page = scan_budgeted(
            conn,
            cursor,
            count.max(1),
            usize::try_from(count.max(1)).unwrap_or(usize::MAX),
            match_pat,
            normalize_type_filter(key_type),
            &mut ledger,
            topology,
        )
        .await
        .map_err(DriverError::QueryFailed)?;
        (page.keys, page.next_cursor, page.consumed, page.truncated)
    };

    let metas = fetch_key_meta(conn, &keys, with_memory, topology)
        .await
        .map_err(DriverError::QueryFailed)?;
    let mut rows: Vec<(String, KeyMeta)> = keys.into_iter().zip(metas).collect();
    // A key the server now says is gone is not a row; a *degraded* reply is
    // (see [`KeyMeta::absent`]), so a short batch cannot silently shrink a page.
    rows.retain(|(_, meta)| !meta.absent);
    // The exact-name short circuit never sent `SCAN … TYPE`, so a caller's type
    // filter the server would have applied has to be re-applied here. A `none`
    // still in the row set (positive `none` was just retained out) means the
    // TYPE reply was unreadable: keep the row rather than hide a real key
    // behind a broken answer.
    if exact {
        if let Some(wanted) = normalize_type_filter(key_type) {
            rows.retain(|(_, meta)| meta.key_type == wanted || meta.key_type == "none");
        }
    }
    if no_ttl_only {
        rows.retain(|(_, meta)| meta.ttl == -1);
    }

    let items: Vec<PageKey> = rows
        .iter()
        .map(|(key, meta)| PageKey {
            key: key.clone(),
            key_type: meta.key_type.clone(),
        })
        .collect();
    let values = fetch_key_values(conn, &items, topology)
        .await
        .map_err(DriverError::QueryFailed)?;
    let entries = build_entries(rows, &values, with_memory);

    tracing::info!(
        elapsed_ms = t0.elapsed().as_millis() as u64,
        keys = entries.len(),
        with_memory,
        exact,
        consumed,
        truncated,
        dbsize,
        // The ledger's own view of the action: which cap applied (default tier
        // vs requested), and whether it is fully spent after this page.
        budget_limit = ledger.limit(),
        budget_spent = ledger.truncated(),
        "redis scan_keys page done"
    );
    Ok(ScanKeysPage {
        entries,
        next_cursor,
        consumed,
        truncated,
        dbsize,
        exact,
    })
}

/// Payload of the `count_matching` command.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountOutcome {
    /// Keys matched so far — a *partial* count when [`Self::truncated`].
    pub count: u64,
    /// The budget ran out before the cursor wrapped: the UI must label this
    /// `n+` rather than present it as a census.
    pub truncated: bool,
    /// Cumulative `COUNT` spent.
    pub consumed: u64,
    /// `DBSIZE`, read exactly once for this call.
    pub dbsize: u64,
}

/// Count keys matching `pattern` under one action budget.
///
/// Two shapes normally skip the scan entirely: `*` answers from `DBSIZE` (as
/// before, and at strictly less cost — one command instead of a full walk), and
/// an exact key name answers `0` or `1` with a single `EXISTS` (PRD §4 I-3,
/// "计数显示 1/1 而非 n+"). The `*` shortcut has one exception (see
/// [`read_dbsize`]): a `dbsize` of `0` is ambiguous between "this database is
/// empty" and "`DBSIZE` was refused", so it is verified by a real scan pass
/// before being published as a census.
pub(crate) async fn count_budgeted<C>(
    conn: &mut C,
    pattern: &str,
    budget: Option<u64>,
    topology: Topology,
) -> Result<CountOutcome, String>
where
    C: ConnectionLike + SlotRoutedConnection + Send,
{
    let dbsize = read_dbsize(conn).await;
    if pattern.is_empty() || (pattern == "*" && dbsize > 0) {
        return Ok(CountOutcome {
            count: dbsize,
            truncated: false,
            consumed: 0,
            dbsize,
        });
    }
    if is_exact_key_pattern(pattern) {
        return Ok(CountOutcome {
            count: u64::from(key_exists(conn, pattern, topology).await?),
            truncated: false,
            consumed: 0,
            dbsize,
        });
    }

    // `pattern == "*"` reaching here means `dbsize == 0`: spend one real scan
    // round instead of short-circuiting, so an unread DBSIZE cannot be sold to
    // the UI as "0 keys" (redis-tree-backend-BUG-003). A genuinely empty
    // database pays one extra round and the cursor wraps immediately.
    let mut ledger = ScanBudget::new(tree_scan_budget(budget, dbsize));
    let page = scan_budgeted(
        conn,
        0,
        crate::ops_tree_budget::TREE_SCAN_MIN_ROUND_COUNT,
        usize::MAX,
        Some(pattern),
        None,
        &mut ledger,
        topology,
    )
    .await?;
    // With `stop_at = usize::MAX` a page is never "full", so `truncated` is
    // exactly "the cursor did not wrap": reading `exhausted` directly keeps the
    // `n+` signal tied to its definition rather than to the loop's arithmetic.
    let truncated = !page.exhausted;
    Ok(CountOutcome {
        count: page.keys.len() as u64,
        truncated,
        consumed: page.consumed,
        dbsize,
    })
}

#[cfg(test)]
mod tests;
