//! Unit tests for [`ops_tree_scan`](crate::ops_tree_scan) and its tree
//! consumers — declared there under `#[cfg(test)] mod tests`.
//!
//! The scripted connection double below is this module's own (the
//! `ScriptedConn` of `ops_workbench/tests.rs` is private to that module). It
//! journals every request with its arguments — and on a cluster every
//! *addressed* request together with the slot it was aimed at — so the tests
//! can assert the cost shape without a live server: `DBSIZE` exactly once per
//! command, two batches per page, one single-key batch per key on a cluster,
//! and slot addressing that a `{hash-tag}` counterfactual turns red if tag
//! handling regresses.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use futures_util::FutureExt;
use redis::{Cmd, Pipeline, RedisFuture};

use crate::ops_key_probe::{key_probe, parse_key_probe, KeyProbe};
use crate::ops_tree::{list_children_page, ChildEntry};
use crate::ops_tree_budget::{
    DEFAULT_TREE_BUDGET, HARD_MAX_TREE_BUDGET, MAX_TREE_SCAN_ROUNDS, MAX_TREE_STALLED_ROUNDS,
    MIN_TREE_SCAN_COUNT, TREE_BUDGET_DBSIZE_FACTOR, TREE_SCAN_MIN_ROUND_COUNT,
};
use crate::ops_workbench::SlotRoutedBatchFuture;

use super::*;

// ---------------------------------------------------------------------------
// Scripted connection double
// ---------------------------------------------------------------------------

fn args_of(cmd: &Cmd) -> Vec<String> {
    cmd.args_iter()
        .map(|arg| match arg {
            redis::Arg::Simple(bytes) => String::from_utf8_lossy(bytes).into_owned(),
            redis::Arg::Cursor => "@cursor".into(),
        })
        .collect()
}

fn bulk(s: &str) -> RValue {
    RValue::BulkString(s.as_bytes().to_vec())
}

/// The reply shape both `parse_scan_result` implementations accept.
fn scan_reply(cursor: u64, keys: &[String]) -> RValue {
    let items: Vec<RValue> = keys.iter().map(|k| bulk(k)).collect();
    RValue::Array(vec![
        RValue::BulkString(cursor.to_string().into_bytes()),
        RValue::Array(items),
    ])
}

/// Journal form of one request line: `["TYPE", "app:a"]` → `"TYPE app:a"`.
fn joined(requests: &[Vec<String>]) -> Vec<String> {
    requests.iter().map(|args| args.join(" ")).collect()
}

#[derive(Default)]
struct TreeState {
    dbsize: i64,
    /// Replies handed out by successive `SCAN` rounds; an exhausted script
    /// wraps the cursor (the honest end of a keyspace).
    scan_script: VecDeque<(u64, Vec<String>)>,
    types: HashMap<String, String>,
    /// Keys whose `TYPE` reply arrives as `Nil` — an *unreadable* answer, not
    /// an absent key.
    nil_types: HashSet<String>,
    ttls: HashMap<String, i64>,
    ptls: HashMap<String, i64>,
    mems: HashMap<String, u64>,
    lens: HashMap<String, i64>,
    previews: HashMap<String, RValue>,
    singles: Vec<Vec<String>>,
    batches: Vec<Vec<Vec<String>>>,
    /// `(slot, commands)` of every `command_at_slot` / `pipeline_at_slot`.
    addressed: Vec<(u16, Vec<Vec<String>>)>,
}

impl TreeState {
    fn reply(&mut self, args: &[String]) -> RValue {
        let Some(name) = args.first().map(String::as_str) else {
            return RValue::Nil;
        };
        match name {
            "DBSIZE" => RValue::Int(self.dbsize),
            "SCAN" => match self.scan_script.pop_front() {
                Some((cursor, keys)) => scan_reply(cursor, &keys),
                None => scan_reply(0, &[]),
            },
            "EXISTS" => {
                let exists = args
                    .get(1)
                    .is_some_and(|key| self.types.get(key).is_some_and(|t| t != "none"));
                RValue::Int(i64::from(exists))
            }
            "TYPE" => {
                let key = args[1].as_str();
                if self.nil_types.contains(key) {
                    RValue::Nil
                } else {
                    bulk(self.types.get(key).map_or("none", String::as_str))
                }
            }
            "TTL" => RValue::Int(self.ttls.get(&args[1]).copied().unwrap_or(-2)),
            "PTTL" => RValue::Int(self.ptls.get(&args[1]).copied().unwrap_or(-2)),
            "MEMORY" => match args.get(2).and_then(|key| self.mems.get(key)) {
                Some(bytes) => RValue::Int(i64::try_from(*bytes).unwrap_or(i64::MAX)),
                None => RValue::Nil,
            },
            "STRLEN" | "LLEN" | "SCARD" | "ZCARD" | "HLEN" | "XLEN" => {
                RValue::Int(self.lens.get(&args[1]).copied().unwrap_or(0))
            }
            "GET" => self
                .previews
                .get(&args[1])
                .cloned()
                .unwrap_or_else(|| bulk("")),
            _ => RValue::Nil,
        }
    }
}

#[derive(Clone, Default)]
struct TreeConn {
    state: Arc<Mutex<TreeState>>,
}

impl TreeConn {
    fn new() -> Self {
        Self::default()
    }

    fn state(&self) -> std::sync::MutexGuard<'_, TreeState> {
        self.state.lock().expect("state lock")
    }

    /// Seed one existing string key with TTL / length / preview answers.
    fn seed_string(&mut self, key: &str, len: i64, preview: &str) {
        let mut st = self.state();
        st.types.insert(key.to_string(), "string".to_string());
        st.ttls.insert(key.to_string(), -1);
        st.lens.insert(key.to_string(), len);
        st.previews.insert(key.to_string(), bulk(preview));
    }
}

impl ConnectionLike for TreeConn {
    /// The scripted double holds no logical database index; `dbIndex` is
    /// resolved before the connection is picked, so `0` is honest here.
    fn get_db(&self) -> i64 {
        0
    }

    fn req_packed_command<'a>(&'a mut self, cmd: &'a Cmd) -> RedisFuture<'a, RValue> {
        let args = args_of(cmd);
        (async move {
            let mut st = self.state();
            st.singles.push(args.clone());
            let reply = st.reply(&args);
            drop(st);
            Ok(reply)
        })
        .boxed()
    }

    fn req_packed_commands<'a>(
        &'a mut self,
        pipe: &'a Pipeline,
        _offset: usize,
        _count: usize,
    ) -> RedisFuture<'a, Vec<RValue>> {
        let batch: Vec<Vec<String>> = pipe.cmd_iter().map(args_of).collect();
        (async move {
            let mut st = self.state();
            let mut values = Vec::with_capacity(batch.len());
            for args in &batch {
                values.push(st.reply(args));
            }
            st.batches.push(batch);
            drop(st);
            Ok(values)
        })
        .boxed()
    }
}

/// The cluster path must *see* what the ops asked for, so this double
/// implements the routing capability itself and journals the slot.
impl SlotRoutedConnection for TreeConn {
    fn command_at_slot<'a>(&'a mut self, cmd: &'a Cmd, slot: u16) -> RedisFuture<'a, RValue> {
        let args = args_of(cmd);
        (async move {
            let mut st = self.state();
            let reply = st.reply(&args);
            st.addressed.push((slot, vec![args]));
            drop(st);
            Ok(reply)
        })
        .boxed()
    }

    fn pipeline_at_slot<'a>(
        &'a mut self,
        pipe: &'a Pipeline,
        slot: u16,
    ) -> SlotRoutedBatchFuture<'a> {
        let batch: Vec<Vec<String>> = pipe.cmd_iter().map(args_of).collect();
        (async move {
            let mut st = self.state();
            let mut values = Vec::with_capacity(batch.len());
            for args in &batch {
                values.push(st.reply(args));
            }
            st.addressed.push((slot, batch));
            drop(st);
            Ok(values)
        })
        .boxed()
    }
}

// ---------------------------------------------------------------------------
// Pure batch shapes
// ---------------------------------------------------------------------------

#[test]
fn meta_pipeline_is_type_ttl_per_key_with_optional_memory() {
    let keys = vec!["app:a".to_string(), "app:b".to_string()];
    let (pipe, sizes) = build_meta_pipeline(&keys, false);
    assert_eq!(sizes, vec![2, 2]);
    let flat: Vec<Vec<String>> = pipe.cmd_iter().map(args_of).collect();
    assert_eq!(
        flat,
        [
            vec!["TYPE".to_string(), "app:a".to_string()],
            vec!["TTL".to_string(), "app:a".to_string()],
            vec!["TYPE".to_string(), "app:b".to_string()],
            vec!["TTL".to_string(), "app:b".to_string()],
        ],
        "TYPE + TTL per key, in key order"
    );
    assert_eq!(meta_fields_per_key(false), 2);

    let (pipe, sizes) = build_meta_pipeline(&keys, true);
    assert_eq!(sizes, vec![3, 3]);
    let flat: Vec<Vec<String>> = pipe.cmd_iter().map(args_of).collect();
    assert_eq!(
        flat,
        [
            vec!["TYPE".to_string(), "app:a".to_string()],
            vec!["TTL".to_string(), "app:a".to_string()],
            vec![
                "MEMORY".to_string(),
                "USAGE".to_string(),
                "app:a".to_string()
            ],
            vec!["TYPE".to_string(), "app:b".to_string()],
            vec!["TTL".to_string(), "app:b".to_string()],
            vec![
                "MEMORY".to_string(),
                "USAGE".to_string(),
                "app:b".to_string()
            ],
        ],
        "MEMORY USAGE joins each key's group only when asked for"
    );
    assert_eq!(meta_fields_per_key(true), 3);
}

#[test]
fn value_pipeline_shapes_follow_the_type_and_never_read_streams() {
    let items = vec![
        PageKey {
            key: "a".to_string(),
            key_type: "string".to_string(),
        },
        PageKey {
            key: "h".to_string(),
            key_type: "hash".to_string(),
        },
        PageKey {
            key: "s".to_string(),
            key_type: "stream".to_string(),
        },
        PageKey {
            key: "m".to_string(),
            key_type: "ReJSON-RL".to_string(),
        },
    ];
    let (pipe, sizes) = build_value_pipeline(&items);
    // A stream answers only its cardinality (XLEN) — its preview is a fixed
    // label, so no payload read; a module type (ReJSON-RL) answers nothing at
    // all rather than being read blind.
    assert_eq!(sizes, vec![2, 2, 1, 0]);
    let flat: Vec<Vec<String>> = pipe.cmd_iter().map(args_of).collect();
    assert_eq!(
        flat,
        [
            vec!["STRLEN".to_string(), "a".to_string()],
            vec!["GET".to_string(), "a".to_string()],
            vec!["HLEN".to_string(), "h".to_string()],
            vec![
                "HSCAN".to_string(),
                "h".to_string(),
                "0".to_string(),
                "COUNT".to_string(),
                "3".to_string(),
            ],
            vec!["XLEN".to_string(), "s".to_string()],
        ]
    );
}

#[test]
fn short_reply_vector_is_nil_filled_not_the_next_keys_answers() {
    let groups = scatter(vec![RValue::Int(7)], &[2, 2]);
    assert_eq!(
        groups,
        vec![
            vec![RValue::Int(7), RValue::Nil],
            vec![RValue::Nil, RValue::Nil],
        ],
        "a short batch must degrade, never borrow a neighbour's replies"
    );
}

#[test]
fn parse_meta_group_tells_absent_apart_from_unreadable() {
    let absent = parse_meta_group(&[bulk("none"), RValue::Int(-2)], false);
    assert!(absent.absent, "TYPE 'none' is positive absence");
    assert_eq!(absent.key_type, "none");

    let degraded = parse_meta_group(&[RValue::Nil, RValue::Nil, RValue::Nil], true);
    assert!(
        !degraded.absent,
        "an unreadable TYPE must not claim the key is gone"
    );
    assert_eq!(degraded.key_type, "none");
    assert_eq!(degraded.ttl, crate::ops_workbench::TTL_MISSING);
    assert_eq!(
        crate::ops_workbench::TTL_MISSING,
        -2,
        "Redis's missing-key TTL"
    );
    assert_eq!(degraded.mem_bytes, None);

    let present = parse_meta_group(&[bulk("hash"), RValue::Int(-1), RValue::Int(64)], true);
    assert!(!present.absent);
    assert_eq!(present.ttl, -1, "-1 means no expiry, not missing");
    assert_eq!(present.mem_bytes, Some(64));
}

// ---------------------------------------------------------------------------
// Standalone pages: the cost shape
// ---------------------------------------------------------------------------

#[tokio::test]
async fn page_reads_dbsize_once_and_answers_in_two_batches() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 1_000;
    conn.seed_string("app:a", 3, "hey");
    conn.seed_string("app:b", 5, "hello");
    conn.state().ttls.insert("app:b".to_string(), 5);
    conn.state()
        .scan_script
        .push_back((0, vec!["app:a".to_string(), "app:b".to_string()]));

    let page = scan_keys_page(
        &mut conn,
        "app:*",
        0,
        100,
        None,
        false,
        false,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("standalone page");

    {
        let st = conn.state();
        assert_eq!(
            joined(&st.singles)
                .iter()
                .filter(|line| line.starts_with("DBSIZE"))
                .count(),
            1,
            "DBSIZE is read once per command, never per page or batch"
        );
        assert_eq!(
            joined(&st.singles)
                .iter()
                .filter(|line| line.starts_with("SCAN"))
                .count(),
            1
        );
        assert_eq!(
            st.batches.len(),
            2,
            "one meta batch + one value batch for the whole page"
        );
        assert_eq!(
            joined(&st.batches[0]),
            ["TYPE app:a", "TTL app:a", "TYPE app:b", "TTL app:b"]
        );
        assert_eq!(
            joined(&st.batches[1]),
            ["STRLEN app:a", "GET app:a", "STRLEN app:b", "GET app:b"]
        );
    }

    assert_eq!(page.dbsize, 1_000);
    assert!(!page.exact, "a glob pattern is not an exact key");
    assert!(!page.truncated, "the cursor wrapped inside the budget");
    assert_eq!(page.next_cursor, 0);
    assert_eq!(page.entries.len(), 2);
    assert_eq!(
        page.entries[0].size, 3,
        "size comes from the length command"
    );
    assert_eq!(page.entries[0].preview, "hey");
    assert_eq!(page.entries[0].ttl, -1);
    assert_eq!(page.entries[1].ttl, 5);
    // The count hint (100) is floored by TREE_SCAN_MIN_ROUND_COUNT, so one
    // round spends exactly 1 000 of the default 50 000 budget.
    assert_eq!(page.consumed, 1_000);
}

#[tokio::test]
async fn budget_exhaustion_stops_the_scan_and_reports_truncated() {
    let mut conn = TreeConn::new();
    {
        let mut st = conn.state();
        st.dbsize = 90_000;
        st.scan_script
            .push_back((3, (1..=3).map(|i| format!("k:{i}")).collect()));
        st.scan_script
            .push_back((7, (4..=5).map(|i| format!("k:{i}")).collect()));
    }
    for i in 1..=5 {
        conn.seed_string(&format!("k:{i}"), 1, "x");
    }

    let page = scan_keys_page(
        &mut conn,
        "k:*",
        0,
        100,
        None,
        false,
        false,
        Some(1_500),
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("budgeted page");

    {
        let st = conn.state();
        assert_eq!(
            joined(&st.singles)
                .iter()
                .filter(|line| line.starts_with("SCAN"))
                .count(),
            2,
            "1500 budget = one 1000-count round + one 500-count round, then stop"
        );
    }
    assert_eq!(page.consumed, 1_500, "the ledger never overspends its cap");
    assert!(
        page.truncated,
        "an open cursor when the budget ran out is data the caller did not see"
    );
    assert_eq!(page.next_cursor, 7, "the resume cursor must survive");
    assert_eq!(page.entries.len(), 5);
    assert_eq!(page.dbsize, 90_000);
    // An explicitly requested tier means what it says: no DBSIZE scaling.
    assert_eq!(page.consumed, 1_500);
}

#[tokio::test]
async fn a_full_page_with_an_open_cursor_is_pagination_not_truncation() {
    let mut conn = TreeConn::new();
    conn.seed_string("p:1", 1, "a");
    conn.seed_string("p:2", 1, "b");
    conn.state()
        .scan_script
        .push_back((5, vec!["p:1".to_string(), "p:2".to_string()]));

    let page = scan_keys_page(
        &mut conn,
        "p:*",
        0,
        2,
        None,
        false,
        false,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("pagination page");

    assert_eq!(page.entries.len(), 2, "page filled to its count");
    assert_eq!(page.next_cursor, 5, "caller resumes from here");
    assert!(
        !page.truncated,
        "reaching the page limit with the cursor open is pagination, not loss"
    );
}

// ---------------------------------------------------------------------------
// Exact-key short circuit (PRD §4 I-3)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn exact_key_bypasses_scan_and_reapplies_the_type_filter() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 42;
    conn.state()
        .types
        .insert("app:users:42".to_string(), "hash".to_string());
    conn.state().ttls.insert("app:users:42".to_string(), -1);
    conn.state().lens.insert("app:users:42".to_string(), 4);

    let page = scan_keys_page(
        &mut conn,
        "app:users:42",
        0,
        100,
        Some("hash"),
        false,
        false,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("exact page");

    {
        let st = conn.state();
        assert!(
            !joined(&st.singles)
                .iter()
                .any(|line| line.starts_with("SCAN")),
            "an exact key name must never touch SCAN"
        );
        assert_eq!(
            joined(&st.singles)
                .iter()
                .filter(|line| line.starts_with("DBSIZE"))
                .count(),
            1
        );
        assert_eq!(st.batches.len(), 2, "meta + value batches, as for any page");
    }
    assert!(page.exact);
    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].key_type, "hash");
    assert_eq!(page.entries[0].key, "app:users:42");
    assert_eq!(page.consumed, 0, "no SCAN round means no COUNT spent");

    // The exact path never sent `SCAN … TYPE`, so a *mismatching* filter the
    // server would have applied must be re-applied client-side — otherwise a
    // filtered tree would show a key the glob path would hide.
    let mut conn2 = TreeConn::new();
    conn2.state().dbsize = 42;
    conn2
        .state()
        .types
        .insert("app:users:42".to_string(), "hash".to_string());
    conn2.state().lens.insert("app:users:42".to_string(), 4);
    let page2 = scan_keys_page(
        &mut conn2,
        "app:users:42",
        0,
        100,
        Some("string"),
        false,
        false,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("filtered exact page");
    assert!(page2.exact);
    assert!(
        page2.entries.is_empty(),
        "keyType must exclude a non-matching exact key, exactly like SCAN TYPE"
    );
}

#[tokio::test]
async fn a_degraded_type_reply_is_kept_by_the_exact_filter_rather_than_hidden() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 42;
    conn.state().nil_types.insert("app:users:42".to_string());
    conn.state().lens.insert("app:users:42".to_string(), 4);

    let page = scan_keys_page(
        &mut conn,
        "app:users:42",
        0,
        100,
        Some("string"),
        false,
        false,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("degraded TYPE page");

    assert_eq!(
        page.entries.len(),
        1,
        "an unreadable TYPE is not a filter result: hiding the key would lie"
    );
    assert_eq!(page.entries[0].key_type, "none");
}

// ---------------------------------------------------------------------------
// count_matching: { count, truncated, consumed, dbsize }
// ---------------------------------------------------------------------------

#[tokio::test]
async fn count_star_answers_from_dbsize_without_a_scan() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 777;

    let outcome = count_budgeted(&mut conn, "*", None, Topology::Standalone)
        .await
        .expect("count *");

    {
        let st = conn.state();
        assert_eq!(
            joined(&st.singles),
            ["DBSIZE"],
            "counting everything is one command"
        );
        assert!(st.batches.is_empty());
        assert!(st.addressed.is_empty());
    }
    assert_eq!(outcome.count, 777);
    assert!(!outcome.truncated);
    assert_eq!(outcome.consumed, 0);
    assert_eq!(outcome.dbsize, 777);

    // The wire shape the UI contract freeze pins: exactly these four fields.
    let json = serde_json::to_value(&outcome).expect("CountOutcome serializes");
    assert_eq!(
        json,
        serde_json::json!({
            "count": 777,
            "truncated": false,
            "consumed": 0,
            "dbsize": 777
        })
    );
}

#[tokio::test]
async fn count_exact_is_one_exists_never_a_scan() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 42;
    conn.state()
        .types
        .insert("app:users:42".to_string(), "hash".to_string());

    let hit = count_budgeted(&mut conn, "app:users:42", None, Topology::Standalone)
        .await
        .expect("exact count");
    assert_eq!(hit.count, 1, "PRD §4 I-3: a known key answers 1, not n+");
    assert!(!hit.truncated);
    assert_eq!(hit.consumed, 0);
    {
        let st = conn.state();
        assert_eq!(joined(&st.singles), ["DBSIZE", "EXISTS app:users:42"]);
        assert!(st.batches.is_empty(), "no batch, no SCAN, no value read");
    }

    let mut miss_conn = TreeConn::new();
    miss_conn.state().dbsize = 42;
    let miss = count_budgeted(&mut miss_conn, "app:users:42", None, Topology::Standalone)
        .await
        .expect("exact count of a missing key");
    assert_eq!(miss.count, 0);
    assert!(!miss.truncated);
}

#[tokio::test]
async fn count_cluster_addresses_the_existence_probe_to_the_keys_slot() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 42;
    conn.state()
        .types
        .insert("{user1000}:profile".to_string(), "string".to_string());

    let outcome = count_budgeted(&mut conn, "{user1000}:profile", None, Topology::Cluster)
        .await
        .expect("cluster exact count");
    assert_eq!(outcome.count, 1);

    {
        let st = conn.state();
        assert_eq!(
            joined(&st.singles),
            ["DBSIZE"],
            "DBSIZE stays unrouted on every topology (redis sums all masters)"
        );
        assert_eq!(st.addressed.len(), 1, "the probe is one addressed command");
        let (slot, cmds) = &st.addressed[0];
        assert_eq!(joined(cmds), ["EXISTS {user1000}:profile"]);
        assert_eq!(
            *slot,
            get_slot(b"{user1000}:profile"),
            "the probe must run on the shard owning the key"
        );
    }
}

#[tokio::test]
async fn count_partial_is_a_floor_the_ui_must_label_n_plus() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 10;
    conn.state()
        .scan_script
        .push_back((5, vec!["app:a".to_string()]));
    conn.seed_string("app:a", 1, "x");

    let outcome = count_budgeted(&mut conn, "app:*", Some(10), Topology::Standalone)
        .await
        .expect("budgeted count");

    {
        let st = conn.state();
        assert_eq!(
            joined(&st.singles)
                .iter()
                .filter(|line| line.starts_with("SCAN"))
                .count(),
            1,
            "a 10-unit budget buys exactly one 10-count round"
        );
    }
    assert_eq!(outcome.count, 1, "the floor is what was actually seen");
    assert_eq!(outcome.consumed, 10);
    assert_eq!(outcome.dbsize, 10);
    let json = serde_json::to_value(&outcome).expect("CountOutcome serializes");
    assert_eq!(
        json["truncated"], true,
        "truncated=true is the `n+` signal the UI contract freezes"
    );
}

// ---------------------------------------------------------------------------
// list_children: budget trio appended, folders never typed
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_children_appends_the_budget_trio_and_types_only_leaves() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 10;
    conn.seed_string("app:top", 6, "hello world");
    {
        let mut st = conn.state();
        st.types.insert("app:u:1".to_string(), "string".to_string());
        st.types.insert("app:u:2".to_string(), "string".to_string());
        st.scan_script.push_back((
            0,
            vec![
                "app:top".to_string(),
                "app:u:1".to_string(),
                "app:u:2".to_string(),
            ],
        ));
    }

    let page = list_children_page(
        &mut conn,
        "app:",
        0,
        100,
        None,
        false,
        None,
        false,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("children page");

    {
        let st = conn.state();
        assert_eq!(
            joined(&st.singles)
                .iter()
                .filter(|line| line.starts_with("DBSIZE"))
                .count(),
            1,
            "list_children reads DBSIZE once, too"
        );
        assert_eq!(
            st.batches.len(),
            2,
            "meta + value batches for the whole level"
        );
        assert_eq!(
            joined(&st.batches[0]),
            ["TYPE app:top", "TTL app:top"],
            "a virtual folder's keys are never typed — only the leaf is"
        );
        assert_eq!(joined(&st.batches[1]), ["STRLEN app:top", "GET app:top"]);
    }

    // Append-only contract: entries + cursor stay, the budget trio joins.
    assert_eq!(page.entries.len(), 2);
    assert!(
        matches!(
            &page.entries[0],
            ChildEntry::Folder { prefix, count } if prefix == "app:u:" && *count == 2
        ),
        "folders sort first and carry their floor count"
    );
    match &page.entries[1] {
        ChildEntry::Key {
            key,
            key_type,
            ttl,
            logical_len,
            ..
        } => {
            assert_eq!(key, "app:top");
            assert_eq!(key_type, "string");
            assert_eq!(*ttl, -1);
            assert_eq!(*logical_len, 6);
        }
        other => panic!("expected a leaf key, got {other:?}"),
    }
    assert_eq!(page.next_cursor, 0);
    assert_eq!(page.dbsize, 10);
    assert_eq!(page.consumed, 1_000, "one round at the 1 000-count floor");
    assert!(!page.truncated);
}

// ---------------------------------------------------------------------------
// Cluster discipline: one slot per key, SCAN pinned to the anchor
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cluster_pages_address_one_single_key_batch_per_key_to_its_own_slot() {
    const TAGGED_A: &str = "app:{user1000}:profile";
    const TAGGED_B: &str = "session:{user1000}:token";
    const SOLO: &str = "solo:key";

    let mut conn = TreeConn::new();
    conn.state().dbsize = 3;
    for key in [TAGGED_A, TAGGED_B, SOLO] {
        conn.seed_string(key, 2, "v");
    }
    conn.state().scan_script.push_back((
        0,
        vec![TAGGED_A.to_string(), TAGGED_B.to_string(), SOLO.to_string()],
    ));

    let page = scan_keys_page(
        &mut conn,
        "*",
        0,
        100,
        None,
        false,
        false,
        None,
        Topology::Cluster,
        Instant::now(),
    )
    .await
    .expect("cluster page");
    assert_eq!(page.entries.len(), 3);

    {
        let st = conn.state();
        assert_eq!(
            joined(&st.singles),
            ["DBSIZE"],
            "only the unrouted DBSIZE is a plain single on a cluster"
        );
        assert!(
            st.batches.is_empty(),
            "a cross-key pipeline on a cluster is a CROSSSLOT waiting to fail \
             the whole command: every batch must be slot-addressed instead"
        );

        let scans: Vec<(u16, Vec<Vec<String>>)> = st
            .addressed
            .iter()
            .filter(|(_, cmds)| cmds[0][0] == "SCAN")
            .cloned()
            .collect();
        assert_eq!(scans.len(), 1, "one wrapped round is one addressed SCAN");
        assert_eq!(
            scans[0].0,
            cluster_scan_anchor_slot(),
            "SCAN must stay pinned to the anchor shard or the cursor hops nodes"
        );

        let batches: Vec<(u16, Vec<Vec<String>>)> = st
            .addressed
            .iter()
            .filter(|(_, cmds)| cmds[0][0] != "SCAN")
            .cloned()
            .collect();
        assert_eq!(batches.len(), 6, "3 keys × (meta + value), one batch each");

        for key in [TAGGED_A, TAGGED_B, SOLO] {
            let for_key: Vec<&(u16, Vec<Vec<String>>)> = batches
                .iter()
                .filter(|(_, cmds)| cmds.iter().any(|cmd| cmd.get(1).is_some_and(|a| a == key)))
                .collect();
            assert_eq!(
                for_key.len(),
                2,
                "one meta batch + one value batch for {key}"
            );
            for (slot, cmds) in for_key {
                assert_eq!(
                    *slot,
                    get_slot(key.as_bytes()),
                    "{key} must run on the shard owning its slot"
                );
                for cmd in cmds {
                    assert_eq!(
                        cmd.get(1).map(String::as_str),
                        Some(key),
                        "every command in an addressed batch is about {key} only \
                         (batch: {cmd:?}) — anything else risks CROSSSLOT"
                    );
                }
            }
        }

        // Both {hash-tag} keys land on one slot through their tag.
        let slot_of = |key: &str| {
            batches
                .iter()
                .find(|(_, cmds)| cmds.iter().any(|cmd| cmd.get(1).is_some_and(|a| a == key)))
                .map(|(slot, _)| *slot)
                .expect("key was addressed")
        };
        assert_eq!(
            slot_of(TAGGED_A),
            slot_of(TAGGED_B),
            "one tag, one slot — both keys, hence every batch, must agree"
        );
    }
}

#[test]
fn hash_tag_slotting_is_the_routing_contract_and_breaks_without_tag_handling() {
    // Counterfactual (BUG-008 style): every equality here becomes a full-key
    // hash the moment tag extraction is removed, so the test turns red on the
    // exact regression it guards.
    let profile = get_slot(b"app:{user1000}:profile");
    let session = get_slot(b"session:{user1000}:token");
    assert_eq!(
        profile, session,
        "two keys sharing the user1000 hash tag must hash to one slot"
    );
    assert_eq!(
        profile,
        get_slot(b"user1000"),
        "the tag's content — not the whole key — picks the slot"
    );
    assert_eq!(
        get_slot(b"{user1000}"),
        get_slot(b"user1000"),
        "the braces themselves carry no hash weight"
    );
    // …and the equality above would be vacuous if two different tags collided.
    assert_ne!(
        get_slot(b"user1000"),
        get_slot(b"user2000"),
        "different tags are expected to differ; same-tag equality means nothing otherwise"
    );
    // The anchor SCAN slot is a legal slot number.
    assert!(cluster_scan_anchor_slot() < 16_384);
}

#[tokio::test]
async fn key_probe_is_one_addressed_batch_that_never_reads_a_value() {
    const KEY: &str = "app:{user1000}:session";
    let mut conn = TreeConn::new();
    {
        let mut st = conn.state();
        st.types.insert(KEY.to_string(), "hash".to_string());
        st.ptls.insert(KEY.to_string(), 1_500);
        st.mems.insert(KEY.to_string(), 64);
        st.lens.insert(KEY.to_string(), 2);
    }

    let probe = key_probe(&mut conn, KEY, Topology::Cluster)
        .await
        .expect("key probe");

    assert!(probe.exists);
    assert_eq!(probe.key_type.as_deref(), Some("hash"));
    assert_eq!(probe.ttl_ms, 1_500, "ttlMs is milliseconds (PTTL)");
    assert_eq!(probe.memory_bytes, Some(64));

    {
        let st = conn.state();
        assert!(
            st.singles.is_empty(),
            "the probe issues no unaddressed command at all"
        );
        assert!(st.batches.is_empty(), "and no cross-key pipeline either");
        assert_eq!(st.addressed.len(), 1, "one addressed batch, one round trip");
        let (slot, cmds) = &st.addressed[0];
        assert_eq!(
            joined(cmds),
            [
                format!("EXISTS {KEY}"),
                format!("TYPE {KEY}"),
                format!("PTTL {KEY}"),
                format!("MEMORY USAGE {KEY}"),
            ],
            "attributes only — a value command here would be a contract break"
        );
        assert_eq!(*slot, get_slot(KEY.as_bytes()));
        assert_eq!(
            *slot,
            get_slot(b"user1000"),
            "the hash tag decides the shard"
        );
    }
}

// ---------------------------------------------------------------------------
// Literal-pinned constants (BUG-008 style)
// ---------------------------------------------------------------------------

#[test]
fn tree_scan_constants_are_pinned_by_literal() {
    // The PRD §3.2 ladder and the loop guards are a contract; re-deriving any
    // of them from value search (or vice versa) must go red here.
    assert_eq!(DEFAULT_TREE_BUDGET, 50_000);
    assert_eq!(HARD_MAX_TREE_BUDGET, 1_000_000);
    assert_eq!(TREE_BUDGET_DBSIZE_FACTOR, 2);
    assert_eq!(TREE_SCAN_MIN_ROUND_COUNT, 1_000);
    assert_eq!(MIN_TREE_SCAN_COUNT, 10);
    assert_eq!(MAX_TREE_SCAN_ROUNDS, 64);
    assert_eq!(MAX_TREE_STALLED_ROUNDS, 16);
    assert_eq!(TREE_KEYS_PER_PIPELINE, 256);
    assert_eq!(meta_fields_per_key(false), 2);
    assert_eq!(meta_fields_per_key(true), 3);
    // The key-tree cap must never be the value-search cap.
    assert_ne!(HARD_MAX_TREE_BUDGET, crate::ops_value_search::HARD_MAX_KEYS);
}

// ---------------------------------------------------------------------------
// [tester] Round-1 coverage of the fail-soft / degradation contract.
//
// The track's cluster claim is not only "one addressed batch per key" but also
// "a rejected *field* degrades alone, a transport failure does not" — the
// replay arm (`fetch_key_group` → `replay_per_command` → `fold_command_answer`)
// was entirely unexercised by the delivered suite, so these tests pin it.
// Declared in this file's existing `mod tests` scope via `super::*`.
// ---------------------------------------------------------------------------

/// How the addressed dispatch layer behaves, mirroring what a real
/// `ClusterConnection` does to a batch.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
enum BatchOutcome {
    /// One reply per command (the happy path), and the un-scripted default.
    #[default]
    Full,
    /// `try_pipeline_request` folds the batch into one error (BUG-001 shape).
    Rejected,
    /// A short reply vector — the `#[doc(hidden)]` layout drift of BUG-003.
    Short(usize),
}

#[derive(Clone, Default)]
struct RoutingConn {
    state: Arc<Mutex<TreeState>>,
    outcome: Arc<Mutex<BatchOutcome>>,
    /// Command names whose *addressed single* answer arrives as a server error.
    answered_errors: Arc<Mutex<HashSet<String>>>,
    /// Command names whose addressed single fails at transport level.
    transport_errors: Arc<Mutex<HashSet<String>>>,
    replays: Arc<Mutex<usize>>,
    replay_slots: Arc<Mutex<Vec<u16>>>,
}

impl RoutingConn {
    fn new() -> Self {
        Self::default()
    }

    fn set_outcome(&self, outcome: BatchOutcome) {
        *self.outcome.lock().expect("outcome lock") = outcome;
    }

    fn answer_error(&self, name: &str) {
        self.answered_errors
            .lock()
            .expect("lock")
            .insert(name.to_string());
    }

    fn fail_transport(&self, name: &str) {
        self.transport_errors
            .lock()
            .expect("lock")
            .insert(name.to_string());
    }

    fn replay_count(&self) -> usize {
        *self.replays.lock().expect("lock")
    }

    fn replayed_slots(&self) -> Vec<u16> {
        self.replay_slots.lock().expect("lock").clone()
    }

    fn batch_commands(&self, pipe: &Pipeline) -> Vec<Vec<String>> {
        pipe.cmd_iter().map(args_of).collect()
    }

    /// The addressed-single answer, shared by the two dispatch shapes.
    fn single(&self, args: &[String]) -> Result<RValue, redis::RedisError> {
        let name = args.first().map(String::as_str).unwrap_or_default();
        let errors = self.answered_errors.lock().expect("lock");
        if errors.contains(name) {
            return Err(redis::RedisError::from((
                ErrorKind::ResponseError,
                "ERR unknown subcommand or wrong number of args",
            )));
        }
        drop(errors);
        let fails = self.transport_errors.lock().expect("lock");
        if fails.contains(name) {
            return Err(redis::RedisError::from((
                ErrorKind::IoError,
                "connection reset",
            )));
        }
        drop(fails);
        let mut st = self.state.lock().expect("lock");
        Ok(st.reply(args))
    }
}

impl ConnectionLike for RoutingConn {
    fn get_db(&self) -> i64 {
        0
    }

    fn req_packed_command<'a>(&'a mut self, cmd: &'a Cmd) -> RedisFuture<'a, RValue> {
        let args = args_of(cmd);
        (async move {
            let mut st = self.state.lock().expect("lock");
            st.singles.push(args.clone());
            Ok(st.reply(&args))
        })
        .boxed()
    }

    fn req_packed_commands<'a>(
        &'a mut self,
        pipe: &'a Pipeline,
        _offset: usize,
        _count: usize,
    ) -> RedisFuture<'a, Vec<RValue>> {
        let batch = self.batch_commands(pipe);
        (async move {
            let mut st = self.state.lock().expect("lock");
            let values = batch.iter().map(|a| st.reply(a)).collect();
            st.batches.push(batch);
            Ok(values)
        })
        .boxed()
    }
}

impl SlotRoutedConnection for RoutingConn {
    fn command_at_slot<'a>(&'a mut self, cmd: &'a Cmd, slot: u16) -> RedisFuture<'a, RValue> {
        let args = args_of(cmd);
        (async move {
            *self.replays.lock().expect("lock") += 1;
            self.replay_slots.lock().expect("lock").push(slot);
            let mut st = self.state.lock().expect("lock");
            st.addressed.push((slot, vec![args.clone()]));
            drop(st);
            self.single(&args)
        })
        .boxed()
    }

    fn pipeline_at_slot<'a>(
        &'a mut self,
        pipe: &'a Pipeline,
        slot: u16,
    ) -> SlotRoutedBatchFuture<'a> {
        let batch = self.batch_commands(pipe);
        let len = batch.len();
        (async move {
            match *self.outcome.lock().expect("lock") {
                BatchOutcome::Rejected => {
                    Err(redis::RedisError::from((ErrorKind::CrossSlot, "CROSSSLOT")).to_string())
                }
                BatchOutcome::Short(n) => {
                    let mut st = self.state.lock().expect("lock");
                    Ok(batch.iter().take(n.min(len)).map(|a| st.reply(a)).collect())
                }
                BatchOutcome::Full => {
                    let mut st = self.state.lock().expect("lock");
                    let values = batch.iter().map(|a| st.reply(a)).collect();
                    st.addressed.push((slot, batch));
                    Ok(values)
                }
            }
        })
        .boxed()
    }
}

use redis::ErrorKind;

fn seeded_probe_conn(conn: &RoutingConn, key: &str) {
    let mut st = conn.state.lock().expect("lock");
    st.types.insert(key.to_string(), "hash".to_string());
    st.ptls.insert(key.to_string(), 1_500);
    st.mems.insert(key.to_string(), 64);
}

#[tokio::test]
async fn test_tester_a_rejected_addressed_batch_replays_that_key_command_by_command() {
    const KEY: &str = "app:{user1000}:session";
    let conn = RoutingConn::new();
    seeded_probe_conn(&conn, KEY);
    // The dispatch layer folds the whole batch into one error, exactly as a
    // cluster connection folds `OBJECT FREQ`'s rejection (redis-cmds-p0 BUG-001).
    conn.set_outcome(BatchOutcome::Rejected);

    let mut routed = conn.clone();
    let probe = key_probe(&mut routed, KEY, Topology::Cluster)
        .await
        .expect("a folded batch must degrade to singles, not fail the probe");

    assert!(probe.exists);
    assert_eq!(probe.key_type.as_deref(), Some("hash"));
    assert_eq!(probe.ttl_ms, 1_500);
    assert_eq!(probe.memory_bytes, Some(64));
    assert_eq!(
        conn.replay_count(),
        crate::ops_key_probe::KEY_PROBE_PIPELINE_LEN,
        "the replay costs one round trip per command of *this* key only"
    );
    // Every replay stays on the key's own slot: the fallback must not silently
    // un-address the batch (that is what caused the MOVED/slot-rebuild storm).
    let expected = get_slot(KEY.as_bytes());
    assert!(
        conn.replayed_slots().iter().all(|s| *s == expected),
        "replayed commands must keep the key's slot: {:?}",
        conn.replayed_slots()
    );
    // And the batch itself was never taken as an answer.
    assert!(conn.state.lock().expect("lock").batches.is_empty());
}

#[tokio::test]
async fn test_tester_a_short_addressed_batch_replays_instead_of_misreading_slots() {
    const KEY: &str = "app:{user1000}:session";
    let conn = RoutingConn::new();
    seeded_probe_conn(&conn, KEY);
    // Only 2 of 4 replies come back: reading them positionally would answer
    // `exists` from `EXISTS`, `type` from `TYPE`, and then *invent* ttl/memory.
    conn.set_outcome(BatchOutcome::Short(2));

    let mut routed = conn.clone();
    let probe = key_probe(&mut routed, KEY, Topology::Cluster)
        .await
        .expect("a short vector must trigger the replay, not a half-read probe");

    assert_eq!(
        probe.ttl_ms, 1_500,
        "ttl must come from PTTL, not from a shifted slot"
    );
    assert_eq!(probe.memory_bytes, Some(64));
    assert_eq!(
        conn.replay_count(),
        crate::ops_key_probe::KEY_PROBE_PIPELINE_LEN
    );
}

#[tokio::test]
async fn test_tester_an_answered_error_degrades_one_field_and_keeps_the_rest() {
    const KEY: &str = "app:{user1000}:session";
    let conn = RoutingConn::new();
    seeded_probe_conn(&conn, KEY);
    conn.set_outcome(BatchOutcome::Rejected);
    // MEMORY USAGE below Redis 4.0 (or under an ACL): a *server* answer, so only
    // that field degrades.
    conn.answer_error("MEMORY");

    let mut routed = conn.clone();
    let probe = key_probe(&mut routed, KEY, Topology::Cluster)
        .await
        .expect("one rejected field must not fail the probe");

    assert!(probe.exists);
    assert_eq!(probe.key_type.as_deref(), Some("hash"));
    assert_eq!(probe.ttl_ms, 1_500);
    assert_eq!(
        probe.memory_bytes, None,
        "the rejected field alone becomes null"
    );
}

#[tokio::test]
async fn test_tester_a_transport_failure_during_replay_aborts_the_command() {
    const KEY: &str = "app:{user1000}:session";
    let conn = RoutingConn::new();
    seeded_probe_conn(&conn, KEY);
    conn.set_outcome(BatchOutcome::Rejected);
    // An I/O failure means the command never ran: reporting "no value" for it
    // would dress a lost connection up as an empty keyspace.
    conn.fail_transport("TYPE");

    let mut routed = conn.clone();
    let err = key_probe(&mut routed, KEY, Topology::Cluster)
        .await
        .expect_err("a transport failure must surface, not degrade silently");
    assert!(
        err.contains("connection reset"),
        "the transport error must survive verbatim: {err}"
    );
}

#[test]
fn test_tester_the_tree_classifier_splits_a_lost_connection_from_a_rejected_command() {
    // Connection-level: aborts the page (never rendered as "no such key").
    for (kind, detail) in [
        (ErrorKind::IoError, "connection reset"),
        (ErrorKind::ClusterDown, "CLUSTERDOWN"),
        (ErrorKind::CrossSlot, "CROSSSLOT"),
        (
            ErrorKind::ClusterConnectionNotFound,
            "no connection to a valid node",
        ),
    ] {
        let error = redis::RedisError::from((kind, detail));
        assert!(
            is_connection_level_failure(&error),
            "{detail} is a transport/topology failure and must abort the batch"
        );
    }
    // Command-level: degrades one field only.
    for (kind, detail) in [
        (ErrorKind::ResponseError, "ERR unknown command 'PTTL'"),
        (ErrorKind::TypeError, "WRONGTYPE"),
        (ErrorKind::ExtensionError, "NOPERM"),
        (ErrorKind::ReadOnly, "READONLY"),
    ] {
        let error = redis::RedisError::from((kind, detail));
        assert!(
            !is_connection_level_failure(&error),
            "{detail} is an answered error and must degrade one field"
        );
    }
}

#[test]
fn test_tester_fold_command_answer_maps_a_server_error_to_a_missing_value() {
    let rejected = redis::RedisError::from((ErrorKind::ResponseError, "ERR nope"));
    assert!(matches!(
        fold_command_answer(Err(rejected)),
        Ok(RValue::Nil)
    ));
    let lost = redis::RedisError::from((ErrorKind::IoError, "connection reset"));
    assert!(fold_command_answer(Err(lost)).is_err());
    assert!(matches!(
        fold_command_answer(Ok(RValue::Int(3))),
        Ok(RValue::Int(3))
    ));
}

#[tokio::test]
async fn test_tester_standalone_pages_chunk_at_the_pipeline_limit() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 300;
    let keys: Vec<String> = (0..300).map(|i| format!("chunk:{i}")).collect();
    for key in &keys {
        conn.seed_string(key, 1, "v");
    }

    let metas = fetch_key_meta(&mut conn, &keys, true, Topology::Standalone)
        .await
        .expect("chunked meta batch");
    {
        let st = conn.state();
        assert_eq!(
            st.batches.len(),
            2,
            "300 keys at TREE_KEYS_PER_PIPELINE={TREE_KEYS_PER_PIPELINE} = two batches"
        );
        assert_eq!(st.batches[0].len(), TREE_KEYS_PER_PIPELINE * 3);
        assert_eq!(st.batches[1].len(), (300 - TREE_KEYS_PER_PIPELINE) * 3);
    }
    assert_eq!(metas.len(), 300, "one group per key, in key order");
    assert!(metas
        .iter()
        .all(|m| m.mem_bytes == Some(64) || m.mem_bytes.is_none()));
}

#[tokio::test]
async fn test_tester_sentinel_uses_the_node_batch_and_never_addressed_singles() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 4;
    conn.seed_string("s:a", 1, "v");
    conn.seed_string("s:b", 2, "w");
    let keys = vec!["s:a".to_string(), "s:b".to_string()];

    let metas = fetch_key_meta(&mut conn, &keys, false, Topology::Sentinel)
        .await
        .expect("sentinel page meta");
    {
        let st = conn.state();
        assert_eq!(st.batches.len(), 1, "sentinel is a single node: one batch");
        assert!(
            st.addressed.is_empty(),
            "addressing is meaningless on a sentinel and must not appear: {:?}",
            st.addressed
        );
    }
    assert_eq!(metas.len(), 2);
}

#[tokio::test]
async fn test_tester_a_stalled_cursor_reports_truncated_before_the_budget_is_spent() {
    let mut conn = TreeConn::new();
    {
        let mut st = conn.state();
        st.dbsize = 100_000;
        // The cursor never wraps and never yields a key: a proxy or a replica
        // that is not making progress.
        for _ in 0..(MAX_TREE_STALLED_ROUNDS + 8) {
            st.scan_script.push_back((7, Vec::new()));
        }
    }

    let page = scan_keys_page(
        &mut conn,
        "stalled:*",
        0,
        100,
        None,
        false,
        false,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("stalled page");

    {
        let st = conn.state();
        assert_eq!(
            joined(&st.singles)
                .iter()
                .filter(|line| line.starts_with("SCAN"))
                .count(),
            MAX_TREE_STALLED_ROUNDS as usize,
            "the stall guard, not the budget, must end the loop"
        );
    }
    assert!(page.truncated, "an abandoned open cursor is hidden data");
    assert_eq!(
        page.next_cursor, 7,
        "the caller must still be able to resume"
    );
    assert!(
        page.consumed < DEFAULT_TREE_BUDGET,
        "the guard must fire while budget remains: {}",
        page.consumed
    );
}

#[tokio::test]
async fn test_tester_the_round_cap_stops_a_cursor_that_never_wraps() {
    let mut conn = TreeConn::new();
    {
        let mut st = conn.state();
        // A big budget so only the round cap can end the walk, and one new key
        // per round so the stall guard never fires.
        st.dbsize = 100_000;
        for round in 0..(MAX_TREE_SCAN_ROUNDS + 10) {
            st.scan_script.push_back((9, vec![format!("loop:{round}")]));
        }
    }

    let page = scan_budgeted(
        &mut conn,
        0,
        TREE_SCAN_MIN_ROUND_COUNT,
        usize::MAX,
        Some("loop:*"),
        None,
        &mut ScanBudget::new(HARD_MAX_TREE_BUDGET),
        Topology::Standalone,
    )
    .await
    .expect("capped walk");

    assert_eq!(
        page.consumed,
        u64::from(MAX_TREE_SCAN_ROUNDS) * u64::from(TREE_SCAN_MIN_ROUND_COUNT),
        "exactly the capped number of rounds may be charged"
    );
    assert!(page.truncated);
    assert!(!page.exhausted);
    assert_eq!(page.keys.len(), MAX_TREE_SCAN_ROUNDS as usize);
}

#[test]
fn test_tester_preview_rendering_covers_every_key_type() {
    // string: the payload, truncated to the preview budget.
    assert_eq!(render_preview("string", Some(&bulk("plain"))), "plain");
    // list / set / zset: the array form the flat browser already renders.
    assert_eq!(
        render_preview("list", Some(&RValue::Array(vec![bulk("a"), bulk("b")]))),
        r#"["a", "b"]"#
    );
    assert_eq!(
        render_preview("zset", Some(&RValue::Array(vec![bulk("m"), bulk("1")]))),
        r#"["m", "1"]"#
    );
    // hash: pairs come out of the HSCAN envelope, never a raw array.
    assert_eq!(
        render_preview(
            "hash",
            Some(&RValue::Array(vec![
                bulk("0"),
                RValue::Array(vec![bulk("f1"), bulk("v1"), bulk("f2"), bulk("v2")])
            ]))
        ),
        r#"["f1: v1", "f2: v2"]"#
    );
    // stream: no read is issued, the label is fixed.
    assert_eq!(render_preview("stream", None), "(stream)");
    // module / unknown: nothing is invented, and nothing is read.
    assert_eq!(render_preview("ReJSON-RL", Some(&bulk("{}"))), "");
    // A missing reply degrades to the empty rendering for that type.
    assert_eq!(render_preview("list", None), "[]");
    // Long payloads are truncated, not streamed to the IPC layer.
    let long = "x".repeat(400);
    let rendered = render_preview("string", Some(&bulk(&long)));
    assert!(
        rendered.chars().count() < 400,
        "preview must truncate: {rendered}"
    );
}

#[test]
fn test_tester_hscan_envelopes_that_are_not_pairs_answer_empty() {
    // A malformed envelope (short member list / odd length) must not panic and
    // must not fabricate a `field: value` pair.
    assert!(extract_hscan_preview(&RValue::Array(vec![bulk("0")])).is_empty());
    assert!(extract_hscan_preview(&RValue::Array(vec![
        bulk("0"),
        RValue::Array(vec![bulk("only-field")])
    ]))
    .is_empty());
    assert!(extract_hscan_preview(&RValue::Nil).is_empty());
    assert!(extract_hscan_preview(&bulk("not-an-array")).is_empty());
}

#[test]
fn test_tester_value_group_readers_stay_aligned_with_their_builders() {
    // A type with a length command but no preview read (stream): slot 0 is the
    // length and there is no preview slot to steal.
    let stream = parse_value_group(&[RValue::Int(9)], "stream");
    assert_eq!(stream.logical_len, 9);
    assert_eq!(stream.preview, "(stream)");
    // A module type issues nothing at all.
    let module = parse_value_group(&[], "ReJSON-RL");
    assert_eq!(module.logical_len, 0);
    assert_eq!(module.preview, "");
    // An absent length reply degrades to 0 rather than to a plausible number.
    let degraded = parse_value_group(&[RValue::Nil, bulk("v")], "string");
    assert_eq!(degraded.logical_len, 0);
    assert_eq!(degraded.preview, "v");
    // Every type the builder knows about must round-trip through the reader.
    for key_type in ["string", "list", "set", "zset", "hash", "stream"] {
        let items = vec![PageKey {
            key: "k".to_string(),
            key_type: key_type.to_string(),
        }];
        let (_, sizes) = build_value_pipeline(&items);
        let expected = usize::from(length_command_for(key_type).is_some())
            + usize::from(has_preview_command(key_type));
        assert_eq!(sizes, vec![expected], "{key_type} builder arity");
    }
}

/// A standalone page whose batch answers with fewer values than commands: the
/// `#[doc(hidden)]` reply-layout drift BUG-003 warned about. The tail must
/// degrade, and the *shape* of the page must survive.
#[derive(Clone, Default)]
struct ShortBatchConn {
    state: Arc<Mutex<TreeState>>,
    /// Replies the pipeline hands back, however many commands were sent.
    replies: usize,
}

impl ConnectionLike for ShortBatchConn {
    fn get_db(&self) -> i64 {
        0
    }
    fn req_packed_command<'a>(&'a mut self, cmd: &'a Cmd) -> RedisFuture<'a, RValue> {
        let args = args_of(cmd);
        (async move {
            let mut st = self.state.lock().expect("lock");
            st.singles.push(args.clone());
            Ok(st.reply(&args))
        })
        .boxed()
    }
    fn req_packed_commands<'a>(
        &'a mut self,
        pipe: &'a Pipeline,
        _offset: usize,
        _count: usize,
    ) -> RedisFuture<'a, Vec<RValue>> {
        let batch: Vec<Vec<String>> = pipe.cmd_iter().map(args_of).collect();
        let replies = self.replies;
        (async move {
            let mut st = self.state.lock().expect("lock");
            let values = batch.iter().take(replies).map(|a| st.reply(a)).collect();
            st.batches.push(batch);
            Ok(values)
        })
        .boxed()
    }
}

impl SlotRoutedConnection for ShortBatchConn {}

#[tokio::test]
async fn test_tester_a_short_standalone_batch_degrades_the_tail_without_shifting_keys() {
    // 3 keys × 2 meta commands = 6, but only the first key's 2 replies arrive.
    let mut conn = ShortBatchConn {
        state: Arc::new(Mutex::new(TreeState::default())),
        replies: 2,
    };
    let keys = vec!["sh:1".to_string(), "sh:2".to_string(), "sh:3".to_string()];
    let metas = fetch_key_meta(&mut conn, &keys, false, Topology::Standalone)
        .await
        .expect("a short batch must not fail the page");

    assert_eq!(
        metas.len(),
        3,
        "one group per key, whatever the reply count"
    );
    assert_eq!(
        metas[0].key_type, "none",
        "no key was seeded, so even the answered slot reads as 'none'"
    );
    // The point of `scatter`: the trailing keys must not borrow key #1's replies.
    assert_eq!(
        metas[1], metas[2],
        "both unanswered keys degrade identically, not shift by one reply"
    );
}

/// `noTtlOnly` on the flat browser: rows are filtered *after* enrichment, so the
/// surviving keys keep their own attributes and the dropped one disappears.
#[tokio::test]
async fn test_tester_scan_keys_no_ttl_only_keeps_only_permanent_keys() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 5;
    for (key, ttl) in [("nt:p", -1i64), ("nt:e", 30)] {
        let mut st = conn.state();
        st.types.insert(key.to_string(), "string".to_string());
        st.ttls.insert(key.to_string(), ttl);
        st.lens.insert(key.to_string(), 2);
        st.previews.insert(key.to_string(), bulk("v"));
    }
    conn.state()
        .scan_script
        .push_back((0, vec!["nt:p".to_string(), "nt:e".to_string()]));

    let page = scan_keys_page(
        &mut conn,
        "nt:*",
        0,
        100,
        None,
        false,
        true,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("noTtlOnly page");

    let keys: Vec<&str> = page.entries.iter().map(|e| e.key.as_str()).collect();
    assert_eq!(keys, vec!["nt:p"], "only keys without expiry survive");
    assert_eq!(page.entries[0].ttl, -1, "and it keeps its OWN ttl");
}

/// [tester pin, committed RED-by-ignore] `list_children` refills leaf attributes
/// positionally after dropping rows, so the `noTtlOnly` filter (and any key that
/// vanishes between SCAN and the meta batch) mislabels the whole tail. This
/// passes once redis-tree-backend-BUG-001 is fixed — remove the `#[ignore]` then.
#[tokio::test]
#[ignore = "RED: redis-tree-backend-BUG-001 — list_children fills leaves by position, so a dropped row shifts every later key's type/TTL/size"]
async fn test_tester_list_children_no_ttl_only_keeps_rows_aligned() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 6;
    for (key, ttl, len) in [("app:a", -1i64, 1i64), ("app:b", 7, 2), ("app:c", 9, 3)] {
        let mut st = conn.state();
        st.types.insert(key.to_string(), "string".to_string());
        st.ttls.insert(key.to_string(), ttl);
        st.lens.insert(key.to_string(), len);
        st.previews.insert(key.to_string(), bulk("v"));
    }
    conn.state().scan_script.push_back((
        0,
        vec![
            "app:a".to_string(),
            "app:b".to_string(),
            "app:c".to_string(),
        ],
    ));

    let page = list_children_page(
        &mut conn,
        "app:",
        0,
        100,
        None,
        true,
        None,
        false,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("noTtlOnly children page");

    let leaves: Vec<(String, String, i64, u64)> = page
        .entries
        .iter()
        .filter_map(|e| match e {
            ChildEntry::Key {
                key,
                key_type,
                ttl,
                logical_len,
                ..
            } => Some((key.clone(), key_type.clone(), *ttl, *logical_len)),
            _ => None,
        })
        .collect();
    assert_eq!(
        leaves,
        vec![
            ("app:a".to_string(), "string".to_string(), -1, 1),
            ("app:c".to_string(), "string".to_string(), -1, 3),
        ],
        "noTtlOnly must return exactly the non-expiring leaves, each with its OWN attributes"
    );
}

/// The same defect reached through the other door: a key that expires between
/// the SCAN and the meta batch is dropped by `absent`, with identical fallout.
#[tokio::test]
#[ignore = "RED: redis-tree-backend-BUG-001 — a leaf dropped as `absent` shifts every later leaf's attributes"]
async fn test_tester_list_children_survives_a_key_that_vanished_mid_page() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 6;
    for (key, ttl, len) in [("gone:a", -1i64, 1i64), ("gone:b", 7, 2), ("gone:c", 9, 3)] {
        let mut st = conn.state();
        st.types.insert(key.to_string(), "string".to_string());
        st.ttls.insert(key.to_string(), ttl);
        st.lens.insert(key.to_string(), len);
        st.previews.insert(key.to_string(), bulk("v"));
    }
    // The server now answers `none` for app b: it expired after the SCAN.
    conn.state()
        .types
        .insert("gone:b".to_string(), "none".to_string());
    conn.state().scan_script.push_back((
        0,
        vec![
            "gone:a".to_string(),
            "gone:b".to_string(),
            "gone:c".to_string(),
        ],
    ));

    let page = list_children_page(
        &mut conn,
        "gone:",
        0,
        100,
        None,
        false,
        None,
        false,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("page with a vanished leaf");

    let leaves: Vec<(String, String, u64)> = page
        .entries
        .iter()
        .filter_map(|e| match e {
            ChildEntry::Key {
                key,
                key_type,
                logical_len,
                ..
            } => Some((key.clone(), key_type.clone(), *logical_len)),
            _ => None,
        })
        .collect();
    assert_eq!(
        leaves,
        vec![
            ("gone:a".to_string(), "string".to_string(), 1),
            ("gone:c".to_string(), "string".to_string(), 3),
        ],
        "the vanished key must disappear and its neighbours keep their own sizes"
    );
}

/// #56 discipline, made checkable in-process: `list_children` must not add a
/// second way to fail on a cluster. The delivered suite only exercises the
/// hierarchical scan standalone, so "this track did not worsen the existing
/// CrossSlot defect" had no counter-proof. On a cluster every batch this op
/// issues is one key's own attributes, addressed to *that key's* slot (not the
/// scan anchor), and there is no cross-key pipeline to be rejected.
#[tokio::test]
async fn test_tester_list_children_on_cluster_addresses_every_batch_by_key() {
    // `sep = "."` keeps these three keys leaves at the requested level, so the
    // leaf batches (the only place a CROSSSLOT could come from) are exercised.
    const TAGGED_A: &str = "app:{user1000}:profile";
    const TAGGED_B: &str = "app:{user1000}:token";
    const OTHER: &str = "app:{other9}:token";

    let mut conn = TreeConn::new();
    conn.state().dbsize = 3;
    for key in [TAGGED_A, TAGGED_B, OTHER] {
        conn.seed_string(key, 2, "v");
    }
    conn.state().scan_script.push_back((
        0,
        vec![
            TAGGED_A.to_string(),
            TAGGED_B.to_string(),
            OTHER.to_string(),
        ],
    ));

    let page = list_children_page(
        &mut conn,
        "app:",
        0,
        100,
        Some("."),
        false,
        None,
        true,
        None,
        Topology::Cluster,
        Instant::now(),
    )
    .await
    .expect("cluster children page");
    assert_eq!(page.entries.len(), 3, "all three are leaves at this level");

    {
        let st = conn.state();
        assert_eq!(
            joined(&st.singles),
            ["DBSIZE"],
            "DBSIZE is the only unrouted command in this op"
        );
        assert!(
            st.batches.is_empty(),
            "no cross-key pipeline may be issued on a cluster (that is #56's shape): {:?}",
            st.batches
        );

        let scans: Vec<u16> = st
            .addressed
            .iter()
            .filter(|(_, cmds)| cmds[0][0] == "SCAN")
            .map(|(slot, _)| *slot)
            .collect();
        assert_eq!(scans, vec![cluster_scan_anchor_slot()], "SCAN anchored");

        let batches: Vec<&(u16, Vec<Vec<String>>)> = st
            .addressed
            .iter()
            .filter(|(_, cmds)| cmds[0][0] != "SCAN")
            .collect();
        assert_eq!(batches.len(), 6, "3 leaves x (meta + value)");
        let all_keys = [TAGGED_A, TAGGED_B, OTHER];
        for (slot, cmds) in &batches {
            // The subject is wherever the command puts it: `TYPE k` names it at
            // index 1, `MEMORY USAGE k` at index 2 — the two-word form is the
            // whole reason the batch has to be *explicitly* addressed.
            let subject = all_keys
                .iter()
                .find(|key| cmds.iter().any(|cmd| cmd.iter().any(|a| a == *key)))
                .expect("a batch must name a key");
            for cmd in cmds.iter() {
                assert!(
                    cmd.iter().any(|arg| arg == subject),
                    "every command of the batch is about {subject}: {cmd:?}"
                );
                for other in all_keys.iter().filter(|k| *k != subject) {
                    assert!(
                        !cmd.iter().any(|arg| arg == other),
                        "{subject}'s batch leaked {other} — a cross-slot batch: {cmds:?}"
                    );
                }
            }
            assert_eq!(
                *slot,
                get_slot(subject.as_bytes()),
                "{subject} must run on the shard owning it, not on the scan anchor"
            );
        }
        // Counter-proof for tag-blind addressing: both hash-tag keys share a
        // shard, the third does not. If `get_slot` were bypassed (or everything
        // were pinned to the anchor), the per-key equality above turns red.
        assert_eq!(get_slot(TAGGED_A.as_bytes()), get_slot(TAGGED_B.as_bytes()));
        assert_ne!(get_slot(TAGGED_A.as_bytes()), get_slot(OTHER.as_bytes()));
    }
    assert_eq!(page.dbsize, 3);
    assert!(!page.truncated);
}

/// Delivered unit 4 says `withMemory` makes `size` the `MEMORY USAGE` answer.
/// The delivered suite only asserted that claim on the batch builder, never on
/// an assembled page — so a page that quietly kept the logical length would
/// have stayed green. One key answers memory, one does not (Redis < 4.0 or
/// `NOPERM`), and the fallback must be the logical length, not zero.
#[tokio::test]
async fn test_tester_scan_keys_page_with_memory_reports_bytes_and_falls_back_to_length() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 4;
    conn.seed_string("mem:bytes", 12, "payload");
    conn.state().mems.insert("mem:bytes".to_string(), 96);
    conn.seed_string("mem:unsupported", 7, "other");
    // `mem:unsupported` has no MEMORY USAGE answer at all → the double replies Nil.
    conn.state().scan_script.push_back((
        0,
        vec!["mem:bytes".to_string(), "mem:unsupported".to_string()],
    ));

    let page = scan_keys_page(
        &mut conn,
        "mem:*",
        0,
        100,
        None,
        true,
        false,
        None,
        Topology::Standalone,
        Instant::now(),
    )
    .await
    .expect("withMemory page");

    assert_eq!(page.entries.len(), 2);
    assert_eq!(
        page.entries[0].size, 96,
        "withMemory makes `size` the MEMORY USAGE byte count"
    );
    assert_eq!(
        page.entries[1].size, 7,
        "an unsupported MEMORY USAGE falls back to the logical length, never to 0"
    );
    let st = conn.state();
    assert_eq!(
        joined(&st.batches[0]),
        [
            "TYPE mem:bytes",
            "TTL mem:bytes",
            "MEMORY USAGE mem:bytes",
            "TYPE mem:unsupported",
            "TTL mem:unsupported",
            "MEMORY USAGE mem:unsupported",
        ],
        "MEMORY USAGE rides the same meta batch (no extra round trip)"
    );
}

/// A cluster `SCAN` must carry `MATCH` and `TYPE` into the *addressed* command:
/// the anchor routing and the server-side filter are two independent
/// requirements, and the round trip is built from scratch on this arm, so the
/// filter could silently be dropped.
#[tokio::test]
async fn test_tester_cluster_scan_round_carries_match_and_type_to_the_anchor() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 2;
    conn.state()
        .types
        .insert("h:{user1000}:a".to_string(), "string".to_string());
    conn.state().ttls.insert("h:{user1000}:a".to_string(), -1);
    conn.state().lens.insert("h:{user1000}:a".to_string(), 1);
    conn.state()
        .previews
        .insert("h:{user1000}:a".to_string(), bulk("v"));
    conn.state()
        .scan_script
        .push_back((0, vec!["h:{user1000}:a".to_string()]));

    let page = scan_keys_page(
        &mut conn,
        "h:*",
        0,
        100,
        Some("string"),
        false,
        false,
        None,
        Topology::Cluster,
        Instant::now(),
    )
    .await
    .expect("cluster filtered page");
    assert_eq!(page.entries.len(), 1);

    let st = conn.state();
    let (_, scan) = st
        .addressed
        .iter()
        .find(|(_, cmds)| cmds[0][0] == "SCAN")
        .expect("the SCAN round was addressed");
    let line = scan[0].join(" ");
    assert!(
        line.contains("MATCH h:*"),
        "the pattern must survive into the addressed SCAN: {line}"
    );
    assert!(
        line.contains("TYPE string"),
        "the type filter must be applied server-side, not client-side: {line}"
    );
    let unaddressed: Vec<String> = st
        .batches
        .iter()
        .flat_map(|batch| batch.iter().map(|cmd| cmd.join(" ")))
        .collect();
    assert!(
        !unaddressed.iter().any(|l| l.contains("SCAN")),
        "SCAN must never leave as an unaddressed batch on a cluster: {unaddressed:?}"
    );
}

/// `key_probe` on a single node is the common production shape: one pipeline,
/// one round trip, and no addressing at all. The delivered suite pins the
/// cluster arm only, so `fetch_key_group`'s non-cluster branch was never run.
#[tokio::test]
async fn test_tester_key_probe_on_a_single_node_is_one_pipeline_round_trip() {
    const KEY: &str = "app:users:42";
    let mut conn = TreeConn::new();
    {
        let mut st = conn.state();
        st.types.insert(KEY.to_string(), "hash".to_string());
        st.ptls.insert(KEY.to_string(), 2_500);
        st.mems.insert(KEY.to_string(), 88);
    }

    let probe = key_probe(&mut conn, KEY, Topology::Standalone)
        .await
        .expect("standalone probe");
    assert!(probe.exists);
    assert_eq!(probe.key_type.as_deref(), Some("hash"));
    assert_eq!(probe.ttl_ms, 2_500);
    assert_eq!(probe.memory_bytes, Some(88));

    let st = conn.state();
    assert_eq!(st.batches.len(), 1, "one batch, one round trip");
    assert_eq!(
        joined(&st.batches[0]),
        [
            format!("EXISTS {KEY}"),
            format!("TYPE {KEY}"),
            format!("PTTL {KEY}"),
            format!("MEMORY USAGE {KEY}"),
        ],
        "the frozen four, in order, no value read"
    );
    assert!(st.singles.is_empty(), "and nothing issued one at a time");
    assert!(
        st.addressed.is_empty(),
        "addressing is meaningless on a single node and must not appear"
    );
}

/// Presence decided by `TYPE` alone: `EXISTS` was folded away and `TYPE`
/// positively answers `none`. That is an absence the probe must report as a
/// fact, not as "unreadable".
#[test]
fn test_tester_probe_reports_absence_when_only_type_answers() {
    let values = vec![
        crate::ops_key_probe::err_reply("connection reset"),
        bulk("none"),
        RValue::Int(-2),
        RValue::Nil,
    ];
    assert_eq!(
        parse_key_probe(&values),
        Some(KeyProbe {
            exists: false,
            key_type: None,
            ttl_ms: -2,
            memory_bytes: None,
        }),
        "TYPE saying `none` is enough to say the key is gone"
    );
}
