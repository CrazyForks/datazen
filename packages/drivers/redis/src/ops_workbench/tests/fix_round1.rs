// Regression surface added by the first bug-fix round — BUG-003 / BUG-004 /
// BUG-005. Declared from `tests.rs`, so it reuses `ScriptedConn`,
// `ShortReplyConn`, `full_key_info_replies()` and the journal helpers there.
//
// The topology-dependent half of the same round (`Topology::Cluster`) lives in
// `cluster_topology`, which emulates redis' cluster dispatch layer instead of
// hiding it behind a single-node mock.

use super::*;

#[test]
fn only_an_explicit_none_answers_that_the_key_is_absent() {
    // BUG-004: "cannot parse a type" and "the server says the key is gone" are
    // different facts, and only the second may be rendered as 键已过期.
    assert!(type_reply_says_absent(&bulk("none")));
    assert!(type_reply_says_absent(&RValue::SimpleString("none".into())));
    assert!(type_reply_says_absent(&bulk(" NONE ")));
    assert!(type_reply_says_absent(&bulk("")));
    assert!(!type_reply_says_absent(&bulk("string")));
    // A module type token is a real answer about a real key.
    assert!(!type_reply_says_absent(&bulk("ReJSON-RL")));
    // An error / absent reply does not claim anything about the key either.
    assert!(!type_reply_says_absent(&err_reply("ERR unknown command")));
    assert!(!type_reply_says_absent(&RValue::Nil));
}

#[test]
fn unrecognised_type_reply_is_unknown_state_and_not_an_expired_key() {
    // BUG-004: these shapes are neither "unusable" nor a type name. Before the
    // fix they fell through `parse_type_token() == None` and were reported as
    // `missing: true`, i.e. the sidebar claimed a live key had expired.
    for shape in [RValue::Okay, RValue::Double(1.5), RValue::Boolean(true)] {
        let mut values = full_key_info_replies();
        values[key_info_slots::TYPE] = shape.clone();
        let info = parse_key_info(&values);
        assert!(
            !info.missing,
            "an unrecognised TYPE reply ({shape:?}) must not be read as an expired key"
        );
        assert_eq!(info.key_type, None, "no type may be invented");
        assert_eq!(info.ttl_ms, TTL_NO_EXPIRY);
        // Unknown key state ⇒ no attribute is offered as fact.
        assert_eq!(info.memory_bytes, None);
        assert_eq!(info.encoding, None);
        assert_eq!(info.idle_seconds, None);
        assert_eq!(info.freq, None);
        assert_eq!(info, unreadable_key_state());
    }
}

#[tokio::test]
async fn key_object_info_refuses_a_truncated_reply_vector_instead_of_guessing() {
    // BUG-003: the reply vector is read by slot, so a transport that answers
    // fewer commands than it was given would silently shift every attribute
    // into the next field — a sidebar that reads as "全空/未知" with no log at
    // all. `req_packed_commands` is `#[doc(hidden)]` internal API, which is
    // exactly the case that must become a loud failure instead.
    let mut conn = ShortReplyConn { replies: 3 };
    let err = key_object_info(&mut conn, "k", Topology::Standalone)
        .await
        .expect_err("a short reply vector must not be served as data");
    assert!(
        err.contains("expected 6") && err.contains("got 3"),
        "the message must name both counts so an upgrade breakage is locatable: {err}"
    );

    // The guard fires only on a mismatch: a complete reply vector is still read
    // slot by slot, with no degradation of its own.
    let mut conn = ScriptedConn::new();
    conn.push_int("MEMORY", 10);
    conn.push_str("OBJECT", "embstr");
    conn.push_int("OBJECT", 1);
    conn.push_int("OBJECT", 2);
    conn.push_int("PTTL", -1);
    conn.push_str("TYPE", "string");
    let info = key_object_info(&mut conn, "k", Topology::Standalone)
        .await
        .expect("a full reply vector is read normally");
    assert_eq!(info.key_type.as_deref(), Some("string"));
    assert_eq!(info.idle_seconds, Some(1));
    assert_eq!(info.freq, Some(2));
}

#[tokio::test]
async fn type_distribution_stops_when_the_cursor_stops_making_progress() {
    // BUG-005: a proxy / downgraded replica that keeps returning a non-zero
    // cursor with no keys used to spin here forever, holding the connection's
    // write lock and leaving the context bar pending. Stopping early is honest:
    // `sampled` stays 0 and `truncated` reports the gap.
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 10_000);
    for _ in 0..(MAX_STALLED_SCAN_ROUNDS * 4) {
        conn.push_scan(7, &[]);
    }

    let dist = type_distribution(&mut conn, Some(1_000), Topology::Standalone)
        .await
        .expect("a stalled SCAN must end in a sample, not a hang");

    assert_eq!(dist.sampled, 0);
    assert!(dist.truncated, "an unfinished scan is never a census");
    let journal = conn.journal();
    assert_eq!(
        journal.count_single("SCAN"),
        MAX_STALLED_SCAN_ROUNDS as usize,
        "the stall guard, not the keyspace, must end the loop"
    );
    assert!(
        journal.batches.is_empty(),
        "nothing sampled means no TYPE traffic: {:?}",
        journal.batches
    );
}

#[tokio::test]
async fn type_distribution_stops_at_the_round_cap_on_a_spinning_cursor() {
    // BUG-005, second guard: the same keys on every page *is* progress for the
    // raw batch counter, so only the hard round cap can end this. Dedup keeps
    // the sample honest at three keys.
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 10_000);
    for _ in 0..(MAX_SCAN_ROUNDS * 2) {
        conn.push_scan(7, &["a", "b", "c"]);
    }
    conn.push_types(&["string", "hash", "list"]);

    let dist = type_distribution(&mut conn, Some(1_000), Topology::Standalone)
        .await
        .expect("a spinning cursor must still terminate");

    assert_eq!(dist.sampled, 3, "the sample is de-duplicated");
    assert!(dist.truncated);
    let journal = conn.journal();
    assert_eq!(
        journal.count_single("SCAN"),
        MAX_SCAN_ROUNDS as usize,
        "the hard cap bounds the worst case"
    );
}
