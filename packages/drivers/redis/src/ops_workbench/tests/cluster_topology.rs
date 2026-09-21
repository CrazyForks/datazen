// Cluster / Sentinel topology tests for `ops_workbench` — declared from
// `tests.rs`, so it reuses `ScriptedConn` and its journal.
//
// The bug this file exists for (redis-cmds-p0-BUG-001 / BUG-002) is invisible to
// a plain `ConnectionLike` mock: a `MultiplexedConnection` genuinely does keep
// per-command errors inside the reply vector, which is what `ScriptedConn`
// models. A `ClusterConnection` then folds them a *second* time in its dispatch
// layer and pins a pipeline to one slot. `ClusterFoldingConn` reproduces those
// two behaviours (redis 0.27.6 `cluster_async/mod.rs:668-681`,
// `cluster_async/routing.rs:71-105`) on top of the same scripted replies, so
// the ops are tested against the transport they will actually run on.

use super::*;

use redis::aio::ConnectionLike;
use redis::{ErrorKind, RedisError, RedisFuture};

/// Commands whose *last* argument is the key a cluster routes by. The probes
/// only ever issue keyed commands inside a batch, and `DBSIZE` / `SCAN` reach
/// the single-command path, where no slot constraint applies.
fn slot_key_of(cmd: &redis::Cmd) -> Option<u16> {
    let name = cmd.args_iter().next().and_then(|arg| match arg {
        redis::Arg::Simple(bytes) => Some(String::from_utf8_lossy(bytes).to_ascii_uppercase()),
        redis::Arg::Cursor => None,
    })?;
    if !["TYPE", "MEMORY", "OBJECT", "PTTL"].contains(&name.as_str()) {
        return None;
    }
    match cmd.args_iter().last()? {
        redis::Arg::Simple(bytes) => Some(redis::cluster_routing::get_slot(bytes)),
        redis::Arg::Cursor => None,
    }
}

fn transport_error(detail: &str) -> RedisError {
    RedisError::from((ErrorKind::IoError, "Connection failed", detail.to_string()))
}

/// A `ScriptedConn` that answers like redis' async cluster connection.
struct ClusterFoldingConn {
    inner: ScriptedConn,
    /// Command name whose single-command dispatch fails at the transport level,
    /// i.e. the probe never ran — as opposed to being answered with an error.
    transport_failure_for: Option<String>,
}

impl ClusterFoldingConn {
    fn new() -> Self {
        Self {
            inner: ScriptedConn::new(),
            transport_failure_for: None,
        }
    }

    fn journal(&self) -> Journal {
        self.inner.journal()
    }
}

impl ConnectionLike for ClusterFoldingConn {
    /// `ClusterConnection::req_packed_command` routes per command and folds the
    /// one answer: an errored reply surfaces as `Err`, never as a value.
    fn req_packed_command<'a>(&'a mut self, cmd: &'a redis::Cmd) -> RedisFuture<'a, RValue> {
        let name = cmd
            .args_iter()
            .next()
            .and_then(|arg| match arg {
                redis::Arg::Simple(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
                redis::Arg::Cursor => None,
            })
            .unwrap_or_default();
        let fatal = self
            .transport_failure_for
            .as_deref()
            .is_some_and(|bad| bad.eq_ignore_ascii_case(&name));
        (async move {
            let value = self.inner.req_packed_command(cmd).await?;
            if fatal {
                return Err(transport_error("connection reset by peer"));
            }
            match value {
                // redis' own `Value::extract_error` turns the reply into the error
                // it carries, so the detail the server wrote is what reaches us.
                RValue::ServerError(error) => Err(error.into()),
                other => Ok(other),
            }
        })
        .boxed()
    }

    /// `ClusterConnection::req_packed_commands` = `route_for_pipeline` (one slot
    /// for the whole batch) + `extract_error_vec` (any item error fails it).
    fn req_packed_commands<'a>(
        &'a mut self,
        pipe: &'a redis::Pipeline,
        offset: usize,
        count: usize,
    ) -> RedisFuture<'a, Vec<RValue>> {
        let mut route: Option<u16> = None;
        for cmd in pipe.cmd_iter() {
            let Some(slot) = slot_key_of(cmd) else {
                continue;
            };
            match route {
                None => route = Some(slot),
                Some(chosen) if chosen != slot => {
                    return async move {
                        Err(RedisError::from((
                            ErrorKind::CrossSlot,
                            "Received crossed slots in pipeline",
                        )))
                    }
                    .boxed();
                }
                Some(_) => {}
            }
        }
        (async move {
            // `extract_error_vec` again: the first item error aborts the batch.
            let mut values = Vec::new();
            for value in self.inner.req_packed_commands(pipe, offset, count).await? {
                match value {
                    RValue::ServerError(server_error) => {
                        // `Value::extract_error` is what turns the reply into an
                        // error here; the cluster layer then aborts the batch.
                        let error: RedisError = server_error.into();
                        tracing::debug!(
                            %error,
                            "cluster dispatch folds this item into the batch error"
                        );
                        return Err(error);
                    }
                    other => values.push(other),
                }
            }
            Ok(values)
        })
        .boxed()
    }

    fn get_db(&self) -> i64 {
        0
    }
}

/// Premise for the two tests below: on this transport the *old* batch shape
/// really does fail, so a regression back to it must be caught here.
#[tokio::test]
async fn a_cluster_batch_folds_the_freq_error_and_a_cross_key_batch_is_not_routable() {
    // The exact replies a non-LFU server gives for the key-info pipeline: only
    // the `OBJECT FREQ` slot errors, which is harmless on a standalone
    // connection and fatal on a cluster one.
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("MEMORY", 10);
    conn.inner.push_str("OBJECT", "embstr");
    conn.inner.push_int("OBJECT", 12);
    conn.inner
        .push("OBJECT", err_reply("freq counter is not available"));
    conn.inner.push_int("PTTL", -1);
    conn.inner.push_str("TYPE", "string");

    let err = pipeline_raw(&mut conn, &build_key_info_pipeline("k"))
        .await
        .expect_err("OBJECT FREQ is rejected on a non-LFU server, and the cluster layer folds that into a batch error");
    assert!(err.contains("freq counter"), "got {err}");
    assert!(
        conn.journal().batches.len() == 1,
        "the batch was sent and then folded, not skipped"
    );

    let mut conn = ClusterFoldingConn::new();
    let mut pipe = redis::Pipeline::new();
    for key in ["slot-a-key", "slot-b-key"] {
        pipe.cmd("TYPE").arg(key);
    }
    let err = pipeline_raw(&mut conn, &pipe)
        .await
        .expect_err("a cross-key TYPE batch cannot be routed to one slot");
    assert!(
        err.contains("crossed slots"),
        "expected the CrossSlot failure the cluster client raises, got {err}"
    );
    assert!(
        conn.journal().batches.is_empty(),
        "a batch that cannot be routed is never sent: {:?}",
        conn.journal().batches
    );
}

#[tokio::test]
async fn cluster_key_object_info_degrades_per_field_over_six_singles() {
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("MEMORY", 88);
    conn.inner.push_str("OBJECT", "listpack");
    conn.inner.push_int("OBJECT", 12);
    conn.inner
        .push("OBJECT", err_reply("freq counter is not available"));
    conn.inner.push_int("PTTL", 60_000);
    conn.inner.push_str("TYPE", "list");

    let info = key_object_info(&mut conn, "lqueue", Topology::Cluster)
        .await
        .expect("the sidebar must survive a non-LFU cluster, not show a red error");

    assert_eq!(
        info,
        KeyObjectInfo {
            missing: false,
            key_type: Some("list".to_string()),
            memory_bytes: Some(88),
            encoding: Some("listpack".to_string()),
            idle_seconds: Some(12),
            freq: None,
            ttl_ms: 60_000,
        }
    );
    let journal = conn.journal();
    assert!(
        journal.batches.is_empty(),
        "no batch may be sent through a cluster connection: {:?}",
        journal.batches
    );
    assert_eq!(
        journal.total(),
        KEY_INFO_PIPELINE_LEN,
        "the same six commands, one round trip each"
    );
}

#[tokio::test]
async fn cluster_key_object_info_keeps_working_when_the_key_is_gone() {
    // `TYPE` answers `none` while the attribute commands answer with an error —
    // the missing branch has to be reached through the single-command path too.
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push("MEMORY", RValue::Nil);
    conn.inner.push("OBJECT", err_reply("no such key"));
    conn.inner.push("OBJECT", err_reply("no such key"));
    conn.inner.push("OBJECT", err_reply("no such key"));
    conn.inner.push_int("PTTL", -2);
    conn.inner.push_str("TYPE", "none");

    let info = key_object_info(&mut conn, "gone:soon", Topology::Cluster)
        .await
        .expect("a missing key is a success case on every topology");
    assert_eq!(info, KeyObjectInfo::missing());
}

#[tokio::test]
async fn cluster_type_distribution_types_keys_one_at_a_time() {
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("DBSIZE", 40_000);
    let keys = ["user:1", "session:ab", "cart:9", "flag:x", "metric:qps"];
    conn.inner.push_scan(0, &keys);
    conn.inner
        .push_types(&["string", "hash", "list", "string", "zset"]);

    let dist = type_distribution(&mut conn, Some(100), Topology::Cluster)
        .await
        .expect("a multi-key sample must not die on slot routing");

    assert_eq!(dist.counts.get("string"), Some(&2));
    assert_eq!(dist.sampled, 5);
    assert_eq!(dist.sampled, dist.counts.values().sum::<u64>());
    assert!(dist.truncated, "one shard's scan is never a census");
    let journal = conn.journal();
    assert!(
        journal.batches.is_empty(),
        "TYPE is never batched across keys here: {:?}",
        journal.batches
    );
    assert_eq!(
        journal.count_single("TYPE"),
        keys.len(),
        "one TYPE command per sampled key"
    );
}

#[tokio::test]
async fn cluster_sample_window_is_bounded_because_every_key_costs_a_round_trip() {
    // 500 keys on the first SCAN page: standalone would type them in one batch,
    // a cluster connection may not be left with 500 sequential round trips.
    let page: Vec<String> = (0..500).map(|i| format!("k{i}")).collect();
    let flat: Vec<&str> = page.iter().map(String::as_str).collect();

    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("DBSIZE", 100_000);
    conn.inner.push_scan(0, &flat);
    conn.inner
        .push_types(&vec!["string"; CLUSTER_TYPE_SAMPLE_LIMIT as usize]);

    let dist = type_distribution(&mut conn, Some(u64::MAX), Topology::Cluster)
        .await
        .expect("an oversized window is clamped to the cluster budget");

    assert_eq!(dist.sampled, CLUSTER_TYPE_SAMPLE_LIMIT);
    assert!(dist.truncated);
    let journal = conn.journal();
    assert_eq!(
        journal.count_single("TYPE"),
        CLUSTER_TYPE_SAMPLE_LIMIT as usize,
        "the clamp must actually bound the round trips"
    );

    // Contrast: the same keyspace on a single node keeps the pipeline shape and
    // the wider window — it types all 500 keys in one round trip per chunk.
    let mut single = ScriptedConn::new();
    single.push_int("DBSIZE", 100_000);
    single.push_scan(0, &flat);
    single.push_types(&vec!["string"; page.len()]);
    let dist = type_distribution(&mut single, Some(u64::MAX), Topology::Standalone)
        .await
        .expect("standalone keeps the full window");
    assert_eq!(dist.sampled, page.len() as u64, "no cluster budget here");
    assert!(dist.truncated, "500 typed keys of 100000 is still a sample");
    let journal = single.journal();
    assert_eq!(
        journal.batches.len(),
        page.len().div_ceil(TYPE_PIPELINE_CHUNK),
        "one round trip per chunk, none per key"
    );
    assert_eq!(journal.count_single("TYPE"), 0);
}

#[tokio::test]
async fn a_small_full_scan_is_a_census_on_a_single_node_but_not_on_a_cluster() {
    // `truncated` is the bit the context bar's "采样 N/M" label depends on, so
    // the same numbers must not read as exact just because the cursor wrapped.
    let mut cluster = ClusterFoldingConn::new();
    cluster.inner.push_int("DBSIZE", 2);
    cluster.inner.push_scan(0, &["a", "b"]);
    cluster.inner.push_types(&["string", "hash"]);
    let dist = type_distribution(&mut cluster, Some(100), Topology::Cluster)
        .await
        .expect("cluster distribution");
    assert_eq!(dist.dbsize, 2);
    assert_eq!(dist.sampled, 2);
    assert!(
        dist.truncated,
        "a cluster sample covers one node, so it may never be presented as a census"
    );

    let mut single = ScriptedConn::new();
    single.push_int("DBSIZE", 2);
    single.push_scan(0, &["a", "b"]);
    single.push_types(&["string", "hash"]);
    let dist = type_distribution(&mut single, Some(100), Topology::Standalone)
        .await
        .expect("standalone distribution");
    assert!(!dist.truncated, "2/2 on one node is a census");
}

#[tokio::test]
async fn an_empty_cluster_shard_still_reports_an_empty_census() {
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("DBSIZE", 0);
    conn.inner.push_scan(0, &[]);
    let dist = type_distribution(&mut conn, None, Topology::Cluster)
        .await
        .expect("an empty shard is not an error");
    assert_eq!(dist.dbsize, 0);
    assert_eq!(dist.sampled, 0);
    assert!(
        !dist.truncated,
        "nothing was withheld from an empty keyspace"
    );
}

#[tokio::test]
async fn a_transport_failure_on_the_single_command_path_aborts_the_probe() {
    // Per-command degradation must not swallow the connection: a dropped link is
    // a failed read, not a key with no attributes.
    let mut conn = ClusterFoldingConn {
        inner: {
            let mut scripted = ScriptedConn::new();
            scripted.push_int("DBSIZE", 10);
            scripted.push_scan(0, &["a", "b"]);
            scripted.push_type("string");
            scripted
        },
        transport_failure_for: Some("TYPE".to_string()),
    };

    let err = type_distribution(&mut conn, Some(10), Topology::Cluster)
        .await
        .expect_err("a dropped connection must reach the caller");
    assert!(err.contains("connection"), "got {err}");
    assert!(
        conn.journal().batches.is_empty(),
        "nothing may be batched on this path either way"
    );
}

#[tokio::test]
async fn sentinel_uses_the_single_node_batch_and_its_per_item_errors() {
    // A sentinel-backed master is a `MultiplexedConnection`, so it keeps the one
    // pipeline shape (and the one-round-trip budget the sidebar assumes).
    let mut conn = ScriptedConn::new();
    conn.push_int("MEMORY", 10);
    conn.push_str("OBJECT", "embstr");
    conn.push_int("OBJECT", 1);
    conn.push("OBJECT", err_reply("freq counter is not available"));
    conn.push_int("PTTL", -1);
    conn.push_str("TYPE", "string");

    let info = key_object_info(&mut conn, "k", Topology::Sentinel)
        .await
        .expect("sentinel degrades the freq field like standalone");
    assert_eq!(info.freq, None);
    assert_eq!(info.key_type.as_deref(), Some("string"));
    let journal = conn.journal();
    assert_eq!(journal.total(), 1, "one pipeline, no per-command traffic");
    assert!(journal.singles.is_empty());
}
