// Unit tests for `ops_workbench` — declared by `ops_workbench.rs` under
// `#[cfg(test)]`. Kept in its own file so the implementation module stays
// readable; `ScriptedConn` is a scripted `ConnectionLike` that journals every
// request, which is what lets these tests assert the round-trip shape
// (one pipeline per key, one TYPE pipeline per 500 keys, no KEYS) without a
// live Redis.

use super::*;

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use futures_util::FutureExt;
use redis::RedisFuture;

/// A RESP error line parsed into a `Value` — `ServerError` itself is not
/// nameable in redis 0.27, and the parser is how a real reply arrives.
fn err_reply(detail: &str) -> RValue {
    let line = format!("-ERR {detail}\r\n");
    match redis::parse_redis_value(line.as_bytes()) {
        Ok(v) => v,
        Err(e) => panic!("test fixture produced an invalid error reply: {e}"),
    }
}

/// Replay journal: what the connection was asked to do.
#[derive(Clone, Debug, Default, PartialEq)]
struct Journal {
    /// Commands sent one at a time (`req_packed_command`).
    singles: Vec<Vec<String>>,
    /// Pipelines sent (`req_packed_commands`), one vector per batch.
    batches: Vec<Vec<Vec<String>>>,
}

impl Journal {
    fn total(&self) -> usize {
        self.singles.len() + self.batches.len()
    }
    fn single_names(&self) -> Vec<String> {
        self.singles
            .iter()
            .map(|c| c.first().cloned().unwrap_or_default())
            .collect()
    }
    /// How many one-at-a-time commands were issued with this name — used to
    /// prove e.g. that DBSIZE is read once and SCAN stops at the window.
    fn count_single(&self, name: &str) -> usize {
        self.single_names()
            .iter()
            .filter(|n| n.as_str() == name)
            .count()
    }
    fn flat(&self) -> Vec<Vec<String>> {
        self.singles
            .iter()
            .cloned()
            .chain(self.batches.iter().flatten().cloned())
            .collect()
    }
    /// How many commands were issued for one logical probe, i.e. round trips.
    fn round_trips(&self) -> usize {
        self.total()
    }
}

/// Scripted in-memory stand-in for a `redis::aio::ConnectionLike`.
///
/// Replies are queued per command name (FIFO, case-insensitive), so a
/// pipeline of six `OBJECT`/`MEMORY`/`PTTL`/`TYPE` commands reads them back
/// in the order they were queued. Every request is journaled so tests can
/// assert the round-trip shape.
#[derive(Clone)]
struct ScriptedConn {
    queues: Arc<Mutex<HashMap<String, VecDeque<RValue>>>>,
    journal: Arc<Mutex<Journal>>,
    db: i64,
}

fn args_of(cmd: &redis::Cmd) -> Vec<String> {
    cmd.args_iter()
        .map(|arg| match arg {
            redis::Arg::Simple(bytes) => String::from_utf8_lossy(bytes).into_owned(),
            redis::Arg::Cursor => "@cursor".into(),
        })
        .collect()
}

/// Journal form of a request: servers treat the command name
/// case-insensitively, so only that token is normalized. Arguments are kept
/// verbatim — a journaled `SCAN 0 COUNT 500` must still read as one.
fn normalized(args: &[String]) -> Vec<String> {
    let mut entry = args.to_vec();
    if let Some(name) = entry.first_mut() {
        *name = name.to_ascii_uppercase();
    }
    entry
}

impl ScriptedConn {
    fn new() -> Self {
        Self {
            queues: Arc::new(Mutex::new(HashMap::new())),
            journal: Arc::new(Mutex::new(Journal::default())),
            db: 0,
        }
    }

    /// Queue one reply for the next command named `name`.
    fn push(&mut self, name: &str, value: RValue) -> &mut Self {
        let key = name.to_ascii_uppercase();
        self.queues
            .lock()
            .expect("reply queue lock")
            .entry(key)
            .or_default()
            .push_back(value);
        self
    }

    /// Queue one `SCAN` reply: `[cursor, [keys]]`.
    fn push_scan(&mut self, cursor: u64, keys: &[&str]) -> &mut Self {
        let items: Vec<RValue> = keys
            .iter()
            .map(|k| RValue::BulkString(k.as_bytes().to_vec()))
            .collect();
        self.push(
            "SCAN",
            RValue::Array(vec![
                RValue::BulkString(cursor.to_string().into_bytes()),
                RValue::Array(items),
            ]),
        )
    }

    /// Queue a batch of SCAN replies from owned key lists.
    fn push_scan_batches(&mut self, batches: &[(u64, Vec<String>)]) -> &mut Self {
        for (cursor, keys) in batches {
            let refs: Vec<&str> = keys.iter().map(String::as_str).collect();
            self.push_scan(*cursor, &refs);
        }
        self
    }

    fn push_type(&mut self, ty: &str) -> &mut Self {
        self.push("TYPE", RValue::BulkString(ty.as_bytes().to_vec()))
    }

    fn push_types(&mut self, types: &[&str]) -> &mut Self {
        for ty in types {
            self.push_type(ty);
        }
        self
    }

    fn push_int(&mut self, name: &str, n: i64) -> &mut Self {
        self.push(name, RValue::Int(n))
    }

    fn push_str(&mut self, name: &str, s: &str) -> &mut Self {
        self.push(name, RValue::BulkString(s.as_bytes().to_vec()))
    }

    fn take_reply(&self, name: &str) -> RValue {
        self.queues
            .lock()
            .expect("reply queue lock")
            .get_mut(&name.to_ascii_uppercase())
            .and_then(VecDeque::pop_front)
            .unwrap_or(RValue::Nil)
    }

    fn journal(&self) -> Journal {
        self.journal.lock().expect("journal lock").clone()
    }
}

impl ConnectionLike for ScriptedConn {
    fn req_packed_command<'a>(&'a mut self, cmd: &'a redis::Cmd) -> RedisFuture<'a, RValue> {
        let args = args_of(cmd);
        let name = args.first().cloned().unwrap_or_default();
        (async move {
            self.journal
                .lock()
                .expect("journal lock")
                .singles
                .push(normalized(&args));
            Ok(self.take_reply(&name))
        })
        .boxed()
    }

    fn req_packed_commands<'a>(
        &'a mut self,
        pipe: &'a redis::Pipeline,
        _offset: usize,
        _count: usize,
    ) -> RedisFuture<'a, Vec<RValue>> {
        let batch: Vec<Vec<String>> = pipe.cmd_iter().map(args_of).collect();
        (async move {
            let mut values = Vec::with_capacity(batch.len());
            let mut journaled = Vec::with_capacity(batch.len());
            for args in &batch {
                let name = args.first().cloned().unwrap_or_default();
                values.push(self.take_reply(&name));
                journaled.push(normalized(args));
            }
            self.journal
                .lock()
                .expect("journal lock")
                .batches
                .push(journaled);
            Ok(values)
        })
        .boxed()
    }

    fn get_db(&self) -> i64 {
        self.db
    }
}

// --- contract helpers (pure) ------------------------------------------

#[test]
fn sample_limit_defaults_and_clamps_without_erroring() {
    assert_eq!(resolve_type_sample_limit(None), DEFAULT_TYPE_SAMPLE_LIMIT);
    assert_eq!(
        resolve_type_sample_limit(Some(0)),
        DEFAULT_TYPE_SAMPLE_LIMIT
    );
    assert_eq!(resolve_type_sample_limit(Some(200)), 200);
    assert_eq!(resolve_type_sample_limit(Some(5_000)), 5_000);
    // Oversized requests are capped, never rejected.
    assert_eq!(
        resolve_type_sample_limit(Some(5_001)),
        MAX_TYPE_SAMPLE_LIMIT
    );
    assert_eq!(
        resolve_type_sample_limit(Some(u64::MAX)),
        MAX_TYPE_SAMPLE_LIMIT
    );
}

#[test]
fn truncated_flag_is_the_sample_vs_census_bit() {
    assert!(is_sample_truncated(1_000, 52_000));
    assert!(!is_sample_truncated(52, 52));
    assert!(!is_sample_truncated(0, 0));

    let mut counts = BTreeMap::new();
    counts.insert("string".to_string(), 30);
    counts.insert("hash".to_string(), 12);
    let full = TypeDistribution::from_sample(counts.clone(), 42);
    assert_eq!(full.sampled, 42);
    assert!(!full.truncated, "a fully scanned db reads as a census");

    let sample = TypeDistribution::from_sample(counts, 1_000);
    assert!(sample.truncated);
    // Invariant the "采样 N/M" label relies on.
    assert_eq!(sample.sampled, sample.counts.values().sum::<u64>());
}

#[test]
fn key_info_pipeline_is_one_batch_and_never_scans_the_keyspace() {
    let pipe = build_key_info_pipeline("app:cache:session:1");
    let batch: Vec<Vec<String>> = pipe.cmd_iter().map(args_of).collect();
    assert_eq!(batch.len(), KEY_INFO_PIPELINE_LEN);
    let names: Vec<&str> = batch.iter().map(|c| c[0].as_str()).collect();
    assert_eq!(
        names,
        vec!["MEMORY", "OBJECT", "OBJECT", "OBJECT", "PTTL", "TYPE"]
    );
    assert!(
        !names.iter().any(|n| n.eq_ignore_ascii_case("KEYS")),
        "KEYS is forbidden: it blocks the server for the whole keyspace"
    );
    let object_subs: Vec<&str> = batch
        .iter()
        .filter(|c| c[0] == "OBJECT")
        .map(|c| c[1].as_str())
        .collect();
    assert_eq!(object_subs, vec!["ENCODING", "IDLETIME", "FREQ"]);
    for args in &batch {
        assert_eq!(args.last().map(String::as_str), Some("app:cache:session:1"));
    }
}

#[test]
fn error_and_absent_replies_are_distinguishable() {
    assert!(is_unusable_reply(&RValue::Nil));
    assert!(is_unusable_reply(&err_reply("no such key")));
    assert!(is_unusable_reply(&RValue::Map(vec![])));
    assert!(!is_unusable_reply(&RValue::Int(0)), "0 is a value");
    assert!(!is_unusable_reply(&RValue::Int(-1)));
    assert!(!is_unusable_reply(&RValue::BulkString(b"embstr".to_vec())));
    // An unrecognised shape must not be read as "the key is gone".
    assert!(is_unusable_reply(&RValue::Set(vec![])));
}

#[test]
fn type_token_parsing_drops_missing_and_errored_replies() {
    assert_eq!(
        parse_type_token(&RValue::BulkString(b"hash".to_vec())),
        Some("hash".to_string())
    );
    assert_eq!(
        parse_type_token(&RValue::SimpleString("ReJSON-RL".into())),
        Some("ReJSON-RL".to_string())
    );
    assert_eq!(
        parse_type_token(&RValue::BulkString(b"  string ".to_vec())),
        Some("string".to_string())
    );
    assert_eq!(
        parse_type_token(&RValue::BulkString(b"none".to_vec())),
        None
    );
    assert_eq!(parse_type_token(&RValue::Nil), None);
    assert_eq!(parse_type_token(&err_reply("ERR wrong")), None);
}

#[test]
fn numeric_parsing_tolerates_bulk_form_and_rejects_garbage() {
    assert_eq!(parse_opt_int(&RValue::Int(7)), Some(7));
    assert_eq!(
        parse_opt_int(&RValue::BulkString(b"12000".to_vec())),
        Some(12_000)
    );
    assert_eq!(parse_opt_int(&err_reply("not supported")), None);
    assert_eq!(parse_opt_int(&RValue::Nil), None);
    assert_eq!(parse_opt_int(&RValue::BulkString(b"embstr".to_vec())), None);
    assert_eq!(
        parse_opt_string(&RValue::BulkString(b"ziplist".to_vec())),
        Some("ziplist".to_string())
    );
    assert_eq!(parse_opt_string(&err_reply("no such key")), None);
}

// --- key_object_info -------------------------------------------------

fn full_key_info_replies() -> Vec<RValue> {
    vec![
        RValue::Int(104),                       // MEMORY USAGE
        RValue::BulkString(b"embstr".to_vec()), // OBJECT ENCODING
        RValue::Int(37),                        // OBJECT IDLETIME
        RValue::Int(9),                         // OBJECT FREQ
        RValue::Int(12_000),                    // PTTL
        RValue::BulkString(b"string".to_vec()), // TYPE
    ]
}

#[test]
fn key_info_reads_every_field_when_the_server_supports_them() {
    assert_eq!(
        parse_key_info(&full_key_info_replies()),
        KeyObjectInfo {
            missing: false,
            key_type: Some("string".to_string()),
            memory_bytes: Some(104),
            encoding: Some("embstr".to_string()),
            idle_seconds: Some(37),
            freq: Some(9),
            ttl_ms: 12_000,
        }
    );
}

#[test]
fn key_info_reports_missing_as_success() {
    let mut values = full_key_info_replies();
    values[key_info_slots::TYPE] = RValue::BulkString(b"none".to_vec());
    values[key_info_slots::MEMORY] = RValue::Nil;
    values[key_info_slots::ENCODING] = err_reply("no such key");
    values[key_info_slots::TTL] = RValue::Int(-2);

    let info = parse_key_info(&values);
    assert_eq!(info, KeyObjectInfo::missing());
    assert!(info.missing);
    assert_eq!(info.ttl_ms, TTL_MISSING);
    assert_eq!(info.key_type, None);
    assert_eq!(info.memory_bytes, None);
}

#[test]
fn key_info_degrades_freq_and_memory_independently() {
    // maxmemory-policy is not LFU and MEMORY USAGE is unavailable
    // (Redis < 4.0): those two fields go None, everything else survives.
    let mut values = full_key_info_replies();
    values[key_info_slots::MEMORY] =
        err_reply("unknown subcommand or wrong number of args for 'USAGE'");
    values[key_info_slots::FREQ] =
        err_reply("an object access frequency counter is not available with this configuration");
    values[key_info_slots::TTL] = RValue::Int(-1);
    values[key_info_slots::TYPE] = RValue::BulkString(b"list".to_vec());

    let info = parse_key_info(&values);
    assert!(!info.missing);
    assert_eq!(info.key_type.as_deref(), Some("list"));
    assert_eq!(info.memory_bytes, None);
    assert_eq!(info.freq, None);
    assert_eq!(info.encoding.as_deref(), Some("embstr"));
    assert_eq!(info.idle_seconds, Some(37));
    assert_eq!(info.ttl_ms, TTL_NO_EXPIRY);
}

#[test]
fn key_info_keeps_a_live_key_when_only_type_errors() {
    let mut values = full_key_info_replies();
    values[key_info_slots::TYPE] = err_reply("ERR unknown command 'TYPE'");
    let info = parse_key_info(&values);
    assert!(
        !info.missing,
        "an errored TYPE must not claim the key is gone"
    );
    assert_eq!(info.key_type, None);
    assert_eq!(info.ttl_ms, TTL_NO_EXPIRY);
    // Without a type the key's state is unknown, so per-key attributes are
    // not reported either — a partly-trusted payload would read as fact.
    assert_eq!(info.idle_seconds, None);
    assert_eq!(info.memory_bytes, None);
    assert_eq!(info.encoding, None);
    assert_eq!(info.freq, None);
}

#[test]
fn key_info_survives_a_short_or_empty_reply_vector() {
    // An absent slot is not a server answer, so a truncated vector reads as
    // "attributes unreadable" rather than falsely claiming the key is gone.
    let empty = parse_key_info(&[]);
    assert!(!empty.missing);
    assert_eq!(
        empty,
        KeyObjectInfo {
            ttl_ms: TTL_NO_EXPIRY,
            ..KeyObjectInfo::default()
        }
    );
    assert_eq!(
        empty.ttl_ms, TTL_NO_EXPIRY,
        "a live-but-unreadable key still reports a defined ttl"
    );

    let short = vec![RValue::Int(10), RValue::BulkString(b"intset".to_vec())];
    let info = parse_key_info(&short);
    assert!(!info.missing);
    assert_eq!(info.key_type, None);
    assert_eq!(
        info.memory_bytes, None,
        "no type means no trusted attributes"
    );
}

#[tokio::test]
async fn key_object_info_uses_one_round_trip_and_survives_a_rejected_field() {
    let mut conn = ScriptedConn::new();
    conn.push_int("MEMORY", 88);
    conn.push_str("OBJECT", "listpack");
    conn.push_int("OBJECT", 12);
    conn.push("OBJECT", err_reply("freq counter is not available"));
    conn.push_int("PTTL", 60_000);
    conn.push_str("TYPE", "list");

    let info = key_object_info(&mut conn, "lqueue")
        .await
        .expect("key_object_info must not fail because one field errored");

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
    assert_eq!(
        journal.round_trips(),
        1,
        "the whole sidebar payload must cost exactly one round trip"
    );
    assert!(journal.singles.is_empty(), "no per-command round trips");
    assert_eq!(journal.batches[0].len(), KEY_INFO_PIPELINE_LEN);
}

#[tokio::test]
async fn key_object_info_reports_missing_over_the_wire() {
    let mut conn = ScriptedConn::new();
    conn.push("MEMORY", RValue::Nil);
    conn.push("OBJECT", err_reply("no such key"));
    conn.push("OBJECT", err_reply("no such key"));
    conn.push("OBJECT", err_reply("no such key"));
    conn.push_int("PTTL", -2);
    conn.push_str("TYPE", "none");

    let info = key_object_info(&mut conn, "gone:soon")
        .await
        .expect("a missing key is a success case");
    assert_eq!(info, KeyObjectInfo::missing());
    assert_eq!(conn.journal().round_trips(), 1);
}

// --- type_distribution -----------------------------------------------

#[tokio::test]
async fn type_distribution_counts_a_fully_scanned_small_db() {
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 6);
    conn.push_scan(0, &["a", "b", "c", "d", "e", "f"]);
    conn.push_types(&["string", "string", "hash", "list", "string", "stream"]);

    let dist = type_distribution(&mut conn, Some(100))
        .await
        .expect("type distribution");

    assert_eq!(dist.dbsize, 6);
    assert_eq!(dist.sampled, 6);
    assert!(!dist.truncated, "52/52 must not be flagged as a sample");
    assert_eq!(dist.counts.get("string"), Some(&3));
    assert_eq!(dist.counts.get("hash"), Some(&1));
    assert_eq!(dist.counts.get("list"), Some(&1));
    assert_eq!(dist.counts.get("stream"), Some(&1));
    assert_eq!(dist.counts.get("zset"), None);

    let journal = conn.journal();
    assert_eq!(
        journal.count_single("DBSIZE"),
        1,
        "DBSIZE is read exactly once per action"
    );
    assert_eq!(journal.batches.len(), 1, "TYPE is pipelined");
    assert_eq!(journal.flat().iter().filter(|c| c[0] == "TYPE").count(), 6);
}

#[tokio::test]
async fn type_distribution_flags_truncated_when_the_sample_is_partial() {
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 50_000);
    // Non-zero cursor and a full window after the first batch.
    conn.push_scan(4_096, &["k1", "k2", "k3"]);
    conn.push_types(&["string", "hash", "hash"]);

    let dist = type_distribution(&mut conn, Some(3))
        .await
        .expect("type distribution");

    assert_eq!(dist.dbsize, 50_000);
    assert_eq!(dist.sampled, 3);
    assert!(dist.truncated, "3 of 50000 must be reported as a sample");
    assert_eq!(dist.counts.get("hash"), Some(&2));
    let journal = conn.journal();
    assert_eq!(
        journal.count_single("SCAN"),
        1,
        "scanning stops as soon as the window is full"
    );
    assert_eq!(journal.batches.len(), 1);
}

#[tokio::test]
async fn type_distribution_pipelines_types_in_chunks_and_never_calls_keys() {
    let keys: Vec<String> = (0..(TYPE_PIPELINE_CHUNK + 7))
        .map(|i| format!("key:{i}"))
        .collect();
    let flat: Vec<&str> = keys.iter().map(String::as_str).collect();

    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", keys.len() as i64);
    conn.push_scan(0, &flat);
    conn.push_types(&vec!["string"; keys.len()]);

    let dist = type_distribution(&mut conn, Some(MAX_TYPE_SAMPLE_LIMIT))
        .await
        .expect("type distribution");

    assert_eq!(dist.sampled, keys.len() as u64);
    assert!(!dist.truncated);
    let journal = conn.journal();
    let expected_batches = keys.len().div_ceil(TYPE_PIPELINE_CHUNK);
    assert_eq!(
        journal.batches.len(),
        expected_batches,
        "one TYPE round trip per {TYPE_PIPELINE_CHUNK} keys"
    );
    assert_eq!(
        journal.batches.iter().map(|b| b.len()).collect::<Vec<_>>(),
        vec![TYPE_PIPELINE_CHUNK, 7]
    );
    let names = journal.single_names();
    assert!(
        !names.iter().any(|n| n == "KEYS"),
        "KEYS is forbidden, got {names:?}"
    );
    assert!(
        !names.iter().any(|n| n == "TYPE"),
        "TYPE must never be issued one key at a time"
    );
}

#[tokio::test]
async fn type_distribution_continues_scanning_until_the_cursor_wraps() {
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 6);
    conn.push_scan_batches(&[
        (1, vec!["a".to_string(), "b".to_string()]),
        (2, vec!["c".to_string(), "d".to_string()]),
        (0, vec!["e".to_string(), "f".to_string()]),
    ]);
    conn.push_types(&["string", "string", "string", "hash", "hash", "zset"]);

    let dist = type_distribution(&mut conn, Some(500))
        .await
        .expect("type distribution");

    let journal = conn.journal();
    assert_eq!(
        journal.count_single("SCAN"),
        3,
        "the loop follows the cursor until it returns to 0"
    );
    assert_eq!(dist.sampled, 6);
    assert_eq!(dist.counts.get("zset"), Some(&1));
    assert!(!dist.truncated);
}

#[tokio::test]
async fn type_distribution_clamps_an_oversized_window_instead_of_erroring() {
    // Fifteen batches of 500 unique keys; the window must stop at the clamp.
    let batches: Vec<(u64, Vec<String>)> = (0..15)
        .map(|b| {
            (
                7,
                (0..TYPE_SCAN_COUNT as usize)
                    .map(|i| format!("k{b}:{i}"))
                    .collect(),
            )
        })
        .collect();
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 100_000);
    conn.push_scan_batches(&batches);
    conn.push_types(&vec!["string"; MAX_TYPE_SAMPLE_LIMIT as usize * 2]);

    let dist = type_distribution(&mut conn, Some(u64::MAX))
        .await
        .expect("an oversized sampleLimit is clamped, not rejected");

    assert_eq!(dist.sampled, MAX_TYPE_SAMPLE_LIMIT);
    assert!(dist.truncated);
    let journal = conn.journal();
    assert_eq!(
        journal.count_single("SCAN"),
        (MAX_TYPE_SAMPLE_LIMIT / TYPE_SCAN_COUNT as u64) as usize,
        "SCAN stops at the clamped window, not at the keyspace"
    );
    assert_eq!(journal.batches.len(), 10);
}

#[tokio::test]
async fn type_distribution_skips_keys_that_vanished_before_type() {
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 4);
    conn.push_scan(0, &["a", "b", "c", "d"]);
    conn.push_type("string");
    conn.push_type("none"); // evicted between SCAN and TYPE
    conn.push_type("string");
    conn.push("TYPE", err_reply("ERR unknown key"));

    let dist = type_distribution(&mut conn, Some(10))
        .await
        .expect("type distribution");

    // Dropped keys leave both `counts` and `sampled`, so the sum invariant
    // holds while `truncated` still warns about the gap.
    assert_eq!(dist.sampled, 2);
    assert_eq!(dist.counts.get("string"), Some(&2));
    assert_eq!(dist.counts.len(), 1);
    assert!(dist.truncated);
}

#[tokio::test]
async fn type_distribution_on_an_empty_db_is_not_truncated() {
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 0);
    conn.push_scan(0, &[]);

    let dist = type_distribution(&mut conn, None)
        .await
        .expect("type distribution");

    assert_eq!(dist.dbsize, 0);
    assert_eq!(dist.sampled, 0);
    assert!(!dist.truncated);
    assert!(dist.counts.is_empty());
    let journal = conn.journal();
    assert!(
        journal.batches.is_empty(),
        "no sampled keys means no TYPE pipeline at all"
    );
    assert_eq!(journal.total(), 2, "DBSIZE + one SCAN");
}

#[tokio::test]
async fn type_distribution_deduplicates_repeated_scan_results() {
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 2);
    // SCAN is a hint-based cursor: the same key may be returned twice.
    conn.push_scan(1, &["a", "b"]);
    conn.push_scan(0, &["a", "b"]);
    conn.push_types(&["string", "hash", "string", "hash"]);

    let dist = type_distribution(&mut conn, Some(100))
        .await
        .expect("type distribution");

    assert_eq!(dist.sampled, 2, "each key is typed once");
    assert_eq!(dist.counts.get("string"), Some(&1));
    assert_eq!(dist.counts.get("hash"), Some(&1));
    assert!(!dist.truncated);
}

/// Per-command degradation must never turn into "swallow the transport".
/// A rejected DBSIZE or SCAN is a failed read, not an empty database, so
/// the command aborts before it starts sampling.
#[tokio::test]
async fn rejected_dbsize_aborts_the_distribution_instead_of_reading_zero() {
    let mut conn = ScriptedConn::new();
    conn.push("DBSIZE", err_reply("ERR unknown command"));

    let err = type_distribution(&mut conn, Some(10))
        .await
        .expect_err("a rejected DBSIZE must reach the caller");
    assert!(!err.is_empty(), "the failure reason must be carried over");
    assert_eq!(
        conn.journal().singles.len(),
        1,
        "nothing may be sampled against a failed probe: {:?}",
        conn.journal()
    );
}

#[tokio::test]
async fn rejected_scan_aborts_the_distribution_before_typing_anything() {
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 1_000);
    conn.push("SCAN", err_reply("ERR not allowed on this replica"));

    let err = type_distribution(&mut conn, None)
        .await
        .expect_err("a rejected SCAN must reach the caller");
    assert!(!err.is_empty());
    let journal = conn.journal();
    assert_eq!(journal.singles.len(), 2, "DBSIZE + one SCAN, then stop");
    assert!(
        journal.batches.is_empty(),
        "a failed scan must not type a partial key list"
    );
}

#[tokio::test]
async fn a_missing_reply_stream_is_read_as_empty_not_as_data() {
    // Regression guard for the degenerate case: a connection that answers
    // nothing yields an empty census instead of invented counts, and the
    // `sampled == counts.sum()` invariant still holds.
    let mut conn = ScriptedConn::new();
    let dist = type_distribution(&mut conn, Some(10))
        .await
        .expect("silent nil replies stay parseable");
    assert_eq!(dist.dbsize, 0);
    assert_eq!(dist.sampled, 0);
    assert!(dist.counts.is_empty());
    assert!(!dist.truncated);
}
