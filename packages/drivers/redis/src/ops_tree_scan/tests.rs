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

use crate::ops_key_probe::key_probe;
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
