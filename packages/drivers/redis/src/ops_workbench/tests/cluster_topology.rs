// Cluster / Sentinel topology tests for `ops_workbench` — declared from
// `tests.rs`, so it reuses `ScriptedConn`, `args_of`, `normalized` and the
// journal helpers there.
//
// Two bugs live in this file, and the second one is a bug about what a *double*
// may assume:
//
// * BUG-001 / BUG-002 — a `ClusterConnection` folds item errors a *second* time
//   (`cluster_async/mod.rs:668-681`, `:658-662`) and pins a pipeline to one slot
//   (`cluster_async/routing.rs:71-105`). `ClusterFoldingConn` reproduces both
//   behaviours on top of the scripted replies instead of hiding them.
// * BUG-007 — the first version of this double routed a command by "its last
//   argument", i.e. it *assumed* the client routes by key. redis does not for
//   `MEMORY USAGE` / `OBJECT *`: its table falls through to `arg_idx(1)`, so the
//   shard is picked from the subcommand token. The optimistic assumption made
//   that class of defect unobservable in-process, which is exactly what the
//   round's cost claims were built on. The double now keeps the two facts apart:
//
//     - [`keyed_probe_slot`] is the **server's** truth — where the data lives. It
//       reads the argument the ops place the key in, a shape pinned by
//       `key_info_pipeline_is_one_batch_and_never_scans_the_keyspace`;
//     - [`table_route`] is the **client's** notion of where to send it, answered
//       by redis' own public `RoutingInfo::for_routable`, never by a guess.
//
//   Where the two disagree the double answers the way the server does: `-MOVED`,
//   which the client would then act on with `RebuildSlots`
//   (`cluster_async/request.rs:212-220`, and `refresh_slots` starts by taking the
//   connection's write lock). That is what makes "the probes are addressed"
//   falsifiable instead of decorative.

use super::*;

use redis::aio::ConnectionLike;
use redis::cluster_routing::{
    get_slot, MultipleNodeRoutingInfo, Routable, Route, RoutingInfo, SingleNodeRoutingInfo,
    SlotAddr,
};
use redis::{ErrorKind, RedisError, RedisFuture};

/// Redis' own slot count; used only to pick "some shard that is not this one".
const LAST_SLOT: u16 = 16_383;

/// Which shard the **data** of a keyed probe lives on.
///
/// `None` for the commands that have no key (`SCAN`, `DBSIZE`), and for any
/// unexpected shape — an argument the ops do not document must not be silently
/// treated as a key. The exact arities are asserted in `tests.rs`, so this is a
/// statement about the server, not about routing.
fn keyed_probe_slot(cmd: &redis::Cmd) -> Option<u16> {
    let args = args_of(cmd);
    let name = args.first()?.to_ascii_uppercase();
    let key_index = match name.as_str() {
        "TYPE" | "PTTL" if args.len() == 2 => 1,
        "MEMORY" | "OBJECT" if args.len() == 3 => 2,
        _ => return None,
    };
    Some(get_slot(Routable::arg_idx(cmd, key_index)?))
}

/// Where redis' own routing table sends a command.
#[derive(Debug, Clone, PartialEq)]
enum TableRoute {
    /// A specific node, picked by the table.
    Shard(Route),
    /// Every master (`MultiNode(AllMasters, …)`) — `DBSIZE`'s aggregate.
    FanOut,
    /// Nothing in the table ⇒ `req_packed_command` falls back to
    /// `SingleNodeRoutingInfo::Random`, i.e. an arbitrary node.
    ArbitraryNode,
}

/// `RoutingInfo::for_routable`, i.e. redis' answer to "where would the client put
/// this command if we did not say". Public API, so the double's routing model is
/// no longer a free variable (BUG-007 修法 3).
fn table_route(cmd: &redis::Cmd) -> TableRoute {
    match RoutingInfo::for_routable(cmd) {
        Some(RoutingInfo::SingleNode(SingleNodeRoutingInfo::SpecificNode(route))) => {
            TableRoute::Shard(route)
        }
        Some(RoutingInfo::MultiNode((
            MultipleNodeRoutingInfo::AllMasters | MultipleNodeRoutingInfo::AllNodes,
            _,
        ))) => TableRoute::FanOut,
        _ => TableRoute::ArbitraryNode,
    }
}

/// Does a table route name the shard that actually holds the command's key?
///
/// `Route`'s slot is private (`slot()` is `pub(crate)` in redis 0.27.6), so the
/// answer comes from equality against the only two routes `get_route` can build
/// for that key: `is_readonly_cmd` selects `Master` or `ReplicaOptional`, and
/// this driver never enables `read_from_replicas` (`connect.rs` builds a plain
/// `ClusterClient`), so both resolve to the primary — checked in `bugs.md`'s
/// BUG-007 排除项.
fn table_names_the_key_shard(cmd: &redis::Cmd, route: &Route) -> bool {
    keyed_probe_slot(cmd).is_some_and(|slot| {
        *route == Route::new(slot, SlotAddr::Master)
            || *route == Route::new(slot, SlotAddr::ReplicaOptional)
    })
}

/// `route_for_pipeline` (`cluster_async/routing.rs:71-105`), rebuilt from
/// [`table_route`]: the first command with a specific route picks the shard, and
/// any later command routed to a *different* shard fails the whole batch.
///
/// redis compares slots and keeps the `SlotAddr` only to break ties; this
/// compares whole routes, which is equivalent for every batch built here because
/// all six probes are read-only per `is_readonly_cmd`, so their `SlotAddr` is
/// uniform.
fn route_for_batch(pipe: &redis::Pipeline) -> Result<Option<Route>, RedisError> {
    let specific = |cmd: &redis::Cmd| match table_route(cmd) {
        TableRoute::Shard(route) => Some(route),
        _ => None,
    };
    pipe.cmd_iter().map(specific).try_fold(
        None,
        |chosen: Option<Route>, next: Option<Route>| match (chosen, next) {
            (None, _) => Ok(next),
            (_, None) => Ok(chosen),
            (Some(chosen), Some(next)) if chosen != next => Err(RedisError::from((
                ErrorKind::CrossSlot,
                "Received crossed slots in pipeline",
            ))),
            // Same slot: redis would prefer a `Master` route here, which never
            // happens among read-only probes, so the batch stays routable.
            (Some(_), next) => Ok(next),
        },
    )
}

fn cmd_name(args: &[String]) -> String {
    args.first().cloned().unwrap_or_default()
}

fn transport_error(detail: &str) -> RedisError {
    RedisError::from((ErrorKind::IoError, "Connection failed", detail.to_string()))
}

/// The reply a server gives when the command arrived at a shard that does not
/// hold the key — and with it the `RebuildSlots` the client performs afterwards.
fn moved_error(slot: u16) -> RedisError {
    RedisError::from((
        ErrorKind::Moved,
        "An existing key was moved to a different node",
        format!("{slot} 127.0.0.1:7001"),
    ))
}

/// What the dispatch layer decides a command is going to hit.
enum Delivery {
    /// Run it and answer from the script.
    Run,
    /// The node has no such key: `-MOVED`, and one slot rebuild follows.
    Moved(u16),
    /// No route in the table ⇒ an arbitrary node answers. `SCAN` landing here is
    /// how one node's cursor ends up on another; nothing errors, which is the
    /// dangerous part, so it is counted instead.
    ArbitraryNode,
}

/// A `ScriptedConn` that answers like redis' async cluster connection.
struct ClusterFoldingConn {
    inner: ScriptedConn,
    /// Command name whose dispatch fails at the transport level, i.e. the probe
    /// never ran — as opposed to being answered with an error.
    transport_failure_for: Option<String>,
    /// `(args, slot)` for every command the ops **addressed** themselves.
    addressed: Vec<(Vec<String>, u16)>,
    /// Commands that reached a shard without the key, whether because the table
    /// picked the token's shard or because an address named the wrong one.
    misrouted: Vec<Vec<String>>,
    /// `RebuildSlots` triggered by the above — the cost BUG-007 is about, since
    /// `refresh_slots` holds the connection's write lock while it re-queries
    /// every node.
    slot_refreshes: usize,
    /// `SCAN` rounds left to the table, i.e. rounds whose shard is unknown.
    unpinned_rounds: usize,
}

impl ClusterFoldingConn {
    fn new() -> Self {
        Self {
            inner: ScriptedConn::new(),
            transport_failure_for: None,
            addressed: Vec::new(),
            misrouted: Vec::new(),
            slot_refreshes: 0,
            unpinned_rounds: 0,
        }
    }

    fn journal(&self) -> Journal {
        self.inner.journal()
    }

    /// Names of the addressed commands, in order.
    fn addressed_names(&self) -> Vec<String> {
        self.addressed
            .iter()
            .map(|(args, _)| cmd_name(args))
            .collect()
    }

    fn slots_for(&self, name: &str) -> Vec<u16> {
        self.addressed
            .iter()
            .filter(|(args, _)| cmd_name(args) == name)
            .map(|(_, slot)| *slot)
            .collect()
    }

    /// The cluster dispatch layer for one command, addressed or not.
    ///
    /// Both shapes end in `try_cmd_request` (`cluster_async/mod.rs:633-655`):
    /// `req_packed_command` gets its route from the table, `route_command` from
    /// the caller, and in both cases an errored reply is folded into `Err` by
    /// `Value::extract_error`.
    async fn deliver(
        &mut self,
        cmd: &redis::Cmd,
        addressed_slot: Option<u16>,
    ) -> Result<RValue, RedisError> {
        let args = normalized(&args_of(cmd));
        let name = cmd_name(&args);
        let key_slot = keyed_probe_slot(cmd);
        let delivery = match addressed_slot {
            // We named the node, so the only way to be wrong is to name a shard
            // that does not hold the key — which is what a blanket "address
            // everything at one slot" shortcut would do.
            Some(slot) => match key_slot {
                Some(real) if real != slot => Delivery::Moved(real),
                _ => Delivery::Run,
            },
            None => match table_route(cmd) {
                TableRoute::FanOut => Delivery::Run,
                TableRoute::Shard(route) if table_names_the_key_shard(cmd, &route) => Delivery::Run,
                // The table named a shard that does not hold the key.
                TableRoute::Shard(_) => match key_slot {
                    Some(real) => Delivery::Moved(real),
                    // A command whose key this file cannot locate is not given a
                    // fabricated `-MOVED`; it is only counted.
                    None => Delivery::ArbitraryNode,
                },
                TableRoute::ArbitraryNode => Delivery::ArbitraryNode,
            },
        };
        match delivery {
            Delivery::Moved(real) => {
                self.misrouted.push(args);
                self.slot_refreshes += 1;
                tracing::debug!(
                    command = %name,
                    key_slot = real,
                    "cluster double: the node that received this command does not hold the key"
                );
                return Err(moved_error(real));
            }
            Delivery::ArbitraryNode => {
                if name == "SCAN" {
                    self.unpinned_rounds += 1;
                } else {
                    self.misrouted.push(args.clone());
                }
            }
            Delivery::Run => {}
        }
        if self
            .transport_failure_for
            .as_deref()
            .is_some_and(|bad| bad.eq_ignore_ascii_case(&name))
        {
            return Err(transport_error("connection reset by peer"));
        }
        let value = self.inner.req_packed_command(cmd).await?;
        match value {
            // redis' own `Value::extract_error` turns the reply into the error it
            // carries, so the detail the server wrote is what reaches us.
            RValue::ServerError(error) => Err(error.into()),
            other => Ok(other),
        }
    }
}

impl ConnectionLike for ClusterFoldingConn {
    /// Left to the table: `ClusterConnection::req_packed_command` =
    /// `for_routable(cmd).unwrap_or(Random)` + one folded answer.
    fn req_packed_command<'a>(&'a mut self, cmd: &'a redis::Cmd) -> RedisFuture<'a, RValue> {
        async move { self.deliver(cmd, None).await }.boxed()
    }

    /// `ClusterConnection::req_packed_commands` = `route_for_pipeline` (one slot
    /// for the whole batch) + `extract_error_vec` (any item error fails it).
    fn req_packed_commands<'a>(
        &'a mut self,
        pipe: &'a redis::Pipeline,
        offset: usize,
        count: usize,
    ) -> RedisFuture<'a, Vec<RValue>> {
        // `route_for_pipeline` really does fail before anything is written.
        if let Err(error) = route_for_batch(pipe) {
            return async move { Err(error) }.boxed();
        }
        async move {
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
        }
        .boxed()
    }

    fn get_db(&self) -> i64 {
        0
    }
}

impl SlotRoutedConnection for ClusterFoldingConn {
    /// `ClusterConnection::route_command(cmd, SpecificNode(Route(slot, Master)))`
    /// — same delivery and same error folding, only the *address* differs, so
    /// this is where the double can see what the ops asked for.
    fn command_at_slot<'a>(
        &'a mut self,
        cmd: &'a redis::Cmd,
        slot: u16,
    ) -> RedisFuture<'a, RValue> {
        async move {
            self.addressed.push((normalized(&args_of(cmd)), slot));
            self.deliver(cmd, Some(slot)).await
        }
        .boxed()
    }
}

// --- the routing facts the cluster path is built on ---------------------

/// Premise for every test below, asked of redis' own table rather than asserted
/// by hand: the four two-word probes are routed by their **subcommand token**, so
/// sending them unaddressed is not a cost question but a correctness one.
#[test]
fn redis_table_routes_the_two_word_probes_to_a_shard_that_does_not_hold_the_key() {
    let key = "kvbar:user:1001";
    let real = get_slot(key.as_bytes());
    for segments in [
        ["MEMORY", "USAGE"],
        ["OBJECT", "ENCODING"],
        ["OBJECT", "IDLETIME"],
        ["OBJECT", "FREQ"],
    ] {
        let mut cmd = redis::cmd(segments[0]);
        for segment in &segments[1..] {
            cmd.arg(*segment);
        }
        cmd.arg(key);
        let TableRoute::Shard(route) = table_route(&cmd) else {
            panic!(
                "{} {} should still route to one specific node, got {:?}",
                segments[0],
                segments[1],
                table_route(&cmd)
            );
        };
        // (1) the question the *server* asks, and (2) which shard the table
        // really named — recovered from `get_slot` because `Route::slot` is
        // `pub(crate)` in redis 0.27.6.
        assert!(
            !table_names_the_key_shard(&cmd, &route),
            "{} {} is routed by its key after all: {route:?} vs slot {real}",
            segments[0],
            segments[1]
        );
        let token = segments[1];
        let token_slot = get_slot(token.as_bytes());
        assert_ne!(
            token_slot, real,
            "{token} coincidentally hashes to the key's shard — this fixture proves nothing"
        );
        assert!(
            route == Route::new(token_slot, SlotAddr::Master)
                || route == Route::new(token_slot, SlotAddr::ReplicaOptional),
            "{} {} is routed to a shard this test cannot explain: {route:?}, token slot {token_slot}",
            segments[0],
            segments[1]
        );
    }

    // The keyed probes are the control arm: the table *does* send these to the
    // shard that holds the key, so addressing them is only about skipping the
    // table, not about fixing a wrong answer.
    for name in ["TYPE", "PTTL"] {
        let mut cmd = redis::cmd(name);
        cmd.arg(key);
        let TableRoute::Shard(route) = table_route(&cmd) else {
            panic!("{name} must route to a specific node");
        };
        assert!(
            table_names_the_key_shard(&cmd, &route),
            "{name} is keyed: got {route:?} against slot {real}"
        );
    }
}

/// The other half of the addressing fact: what **we** hand redis once we do say.
///
/// No in-process double can observe `impl SlotRoutedConnection for
/// ClusterConnection` — the doubles implement the trait themselves, so the use of
/// the public `route_command` is a real-cluster item (R 项 9a). What *is* checkable is the
/// only value that impl produces: the route built from a slot must name that
/// slot's master and nothing else. A drift to `ReplicaOnly`, to `Any`, or to a
/// different slot would otherwise surface only as `-MOVED` storms on a real
/// cluster, which is the cost BUG-007 is about.
#[test]
fn the_address_we_build_names_exactly_the_master_of_the_given_slot() {
    for slot in [0u16, 1, LAST_SLOT, cluster_scan_anchor_slot()] {
        let built = master_route(slot);
        let RoutingInfo::SingleNode(SingleNodeRoutingInfo::SpecificNode(route)) = &built else {
            panic!("a probe address must name exactly one node, got {built:?}");
        };
        assert_eq!(
            *route,
            Route::new(slot, SlotAddr::Master),
            "slot {slot} must be addressed at its master: {built:?}"
        );
    }
}

/// The tripwire that replaces the old optimistic double: an **unaddressed** probe
/// is refused by the shard that received it, at the price of a slot rebuild. If
/// production ever stops addressing, `cluster_key_object_info_*` turns red for
/// this reason.
#[tokio::test]
async fn an_unaddressed_two_word_probe_is_moved_and_rebuilds_the_slot_map() {
    let key = "kvbar:user:1001";
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("MEMORY", 104);

    let error = conn
        .req_packed_command(&{
            let mut cmd = redis::cmd("MEMORY");
            cmd.arg("USAGE").arg(key);
            cmd
        })
        .await
        .expect_err("the node owning slot(USAGE) has no such key");
    assert_eq!(
        error.kind(),
        ErrorKind::Moved,
        "redis answers -MOVED and `request.rs:212-220` turns that into RebuildSlots"
    );
    assert_eq!(
        conn.slot_refreshes, 1,
        "one slot rebuild per misrouted probe"
    );
    assert_eq!(conn.misrouted.len(), 1);
    assert!(
        conn.journal().singles.is_empty(),
        "the scripted value is never read: the key is not on that node"
    );

    // Addressed, the same command runs on the shard that has the key — one round
    // trip, no redirect, no rebuild.
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("MEMORY", 104);
    let mut cmd = redis::cmd("MEMORY");
    cmd.arg("USAGE").arg(key);
    let value = conn
        .command_at_slot(&cmd, get_slot(key.as_bytes()))
        .await
        .expect("addressed at the key's own shard");
    assert_eq!(value, RValue::Int(104));
    assert_eq!(conn.addressed.len(), 1);
    assert_eq!(conn.slot_refreshes, 0);
    assert!(conn.misrouted.is_empty());
}

/// Addressing is *checked*, not just recorded: pinning every command at one
/// convenient slot would satisfy a "did you pass a slot?" assertion while
/// quietly reading attributes of keys that are not there.
#[tokio::test]
async fn addressing_a_probe_at_the_wrong_shard_is_refused_too() {
    let key = "kvbar:session:abcd";
    let real = get_slot(key.as_bytes());
    let wrong = if real == LAST_SLOT {
        real - 1
    } else {
        real + 1
    };

    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_str("TYPE", "string");
    let mut cmd = redis::cmd("TYPE");
    cmd.arg(key);
    let error = conn
        .command_at_slot(&cmd, wrong)
        .await
        .expect_err("slot {wrong} does not hold this key");
    assert_eq!(error.kind(), ErrorKind::Moved);
    assert_eq!(
        conn.misrouted,
        vec![vec!["TYPE".to_string(), key.to_string()]]
    );
    assert_eq!(conn.slot_refreshes, 1);
    assert!(
        conn.journal().singles.is_empty(),
        "a refused command must not be answered from the script"
    );
}

/// The `SCAN` round `collect_sample` issues on a cluster, built the same way.
fn scan_round_cmd(cursor: u64) -> redis::Cmd {
    let mut cmd = redis::cmd("SCAN");
    cmd.arg(cursor).arg("COUNT").arg(TYPE_SCAN_COUNT);
    cmd
}

/// `SCAN` is the silent case: no `-MOVED`, just a different shard per round.
#[tokio::test]
async fn an_unaddressed_scan_round_has_no_pinned_shard() {
    let mut conn = ClusterFoldingConn::new();
    assert_eq!(
        table_route(&scan_round_cmd(0)),
        TableRoute::ArbitraryNode,
        "redis' table must still answer 'no route' for SCAN, or the anchor wording can be relaxed"
    );

    conn.inner.push_scan(0, &["a"]);
    let mut cmd = redis::cmd("SCAN");
    cmd.arg(0u64).arg("COUNT").arg(TYPE_SCAN_COUNT);
    conn.req_packed_command(&cmd)
        .await
        .expect("an arbitrary node answers a scan round happily — that is the problem");
    assert_eq!(conn.unpinned_rounds, 1);
    assert_eq!(
        conn.misrouted,
        Vec::<Vec<String>>::new(),
        "no error is raised, so only a counted shard change can catch this"
    );

    // Addressed at the anchor, the same round contributes to one shard's cursor.
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_scan(0, &["a"]);
    conn.command_at_slot(&cmd, cluster_scan_anchor_slot())
        .await
        .expect("addressed scan round");
    assert_eq!(conn.unpinned_rounds, 0);
    assert_eq!(conn.slots_for("SCAN"), vec![cluster_scan_anchor_slot()]);
}

/// `DBSIZE` is deliberately left to the table, because the table is right about
/// it: fan-out to every master plus a sum (`fix_round1_retest`'s `test_tester_`
/// case pins the routing itself; this pins that the ops kept using it).
#[tokio::test]
async fn dbsize_is_left_to_the_clients_all_master_fan_out() {
    let cmd = redis::cmd("DBSIZE");
    assert_eq!(
        table_route(&cmd),
        TableRoute::FanOut,
        "the 口径 depends on DBSIZE being summed over masters"
    );

    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("DBSIZE", 40_000);
    let total = fetch_dbsize(&mut conn).await.expect("dbsize");
    assert_eq!(total, 40_000);
    assert!(
        conn.addressed.is_empty(),
        "pinning DBSIZE to the sample shard would report one shard as the database: {:?}",
        conn.addressed
    );
    assert_eq!(conn.slot_refreshes, 0);
}

// --- the ops on that transport -----------------------------------------

/// Premise for the topology branch: on this transport the *old* batch shape
/// cannot work at all, so a regression back to it must be caught here.
#[tokio::test]
async fn a_cluster_batch_is_not_even_routable_for_the_key_info_probes() {
    // `route_for_pipeline` stops at the first pair of different shards and the
    // batch is never written: the key-info pipeline mixes the token-routed
    // probes (`slot("USAGE")`, `slot("ENCODING")`, …) with `PTTL`/`TYPE` at the
    // key's own shard, so it fails on the very first pair.
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("MEMORY", 10);
    let err = pipeline_raw(&mut conn, &build_key_info_pipeline("k"))
        .await
        .expect_err("a batch the table cannot route to one shard never runs");
    assert!(
        err.contains("crossed slots"),
        "expected the CrossSlot the cluster client raises, got {err}"
    );
    assert!(
        conn.journal().batches.is_empty(),
        "a batch that cannot be routed is never sent: {:?}",
        conn.journal().batches
    );

    // Same shard for every command, one errored item: still fatal, because
    // `try_pipeline_request` folds the vector with `extract_error_vec`. That is
    // BUG-001's original symptom, and it is why per-item degradation needs the
    // one-at-a-time path on a cluster.
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_str("TYPE", "string");
    conn.inner
        .push("TYPE", err_reply("freq counter is not available"));
    let mut pipe = redis::Pipeline::new();
    pipe.cmd("TYPE").arg("one-key").cmd("TYPE").arg("one-key");
    let err = pipeline_raw(&mut conn, &pipe)
        .await
        .expect_err("OBJECT FREQ-class errors are folded into the whole batch");
    assert!(err.contains("freq counter"), "got {err}");
    assert_eq!(
        conn.journal().batches.len(),
        1,
        "the batch was sent and then folded, not skipped"
    );

    // Contrast: the same two commands on a single node keep their error per item.
    let mut single = ScriptedConn::new();
    single.push_str("TYPE", "string");
    single.push("TYPE", err_reply("freq counter is not available"));
    let values = pipeline_raw(&mut single, &pipe)
        .await
        .expect("a `MultiplexedConnection` leaves item errors inside the vector");
    assert_eq!(values.len(), 2);
    assert!(is_unusable_reply(&values[1]));

    // A cross-key TYPE batch — the shape `sample_types` used to build — is not
    // routable either.
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
async fn cluster_key_object_info_degrades_per_field_over_six_addressed_singles() {
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("MEMORY", 88);
    conn.inner.push_str("OBJECT", "listpack");
    conn.inner.push_int("OBJECT", 12);
    conn.inner
        .push("OBJECT", err_reply("freq counter is not available"));
    conn.inner.push_int("PTTL", 60_000);
    conn.inner.push_str("TYPE", "list");

    let key = "lqueue";
    let info = key_object_info(&mut conn, key, Topology::Cluster)
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
    // BUG-007: the six round trips must be six *addressed* round trips. A
    // regression to `req_packed_command` would still return the right values (the
    // client retries after -MOVED) but would double the cost and rebuild the slot
    // map, so both counters are part of the contract.
    assert_eq!(
        conn.addressed_names(),
        vec!["MEMORY", "OBJECT", "OBJECT", "OBJECT", "PTTL", "TYPE"],
        "every probe must go through the addressed path, in pipeline order"
    );
    let expected = get_slot(key.as_bytes());
    assert!(
        conn.addressed.iter().all(|(_, slot)| *slot == expected),
        "all six belong to slot {expected}: {:?}",
        conn.addressed
    );
    assert_eq!(conn.misrouted, Vec::<Vec<String>>::new());
    assert_eq!(
        conn.slot_refreshes, 0,
        "an addressed probe must never trigger a slot rebuild"
    );
    assert_eq!(conn.unpinned_rounds, 0);
}

#[tokio::test]
async fn cluster_key_object_info_keeps_working_when_the_key_is_gone() {
    // `TYPE` answers `none` while the attribute commands answer with an error —
    // the missing branch has to be reached through the addressed path too.
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
    assert_eq!(conn.addressed.len(), KEY_INFO_PIPELINE_LEN);
    assert_eq!(conn.slot_refreshes, 0);
}

#[tokio::test]
async fn cluster_type_distribution_types_keys_one_at_a_time_on_their_own_shards() {
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
    assert!(dist.truncated, "5 of 40000 keys is a sample");
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
    // The keys a shard's SCAN returned hash to that shard's range, so typing them
    // by their own slot keeps the sample on one node — and proves the ops did not
    // take the shortcut of pinning every TYPE at the anchor slot.
    assert_eq!(conn.slots_for("SCAN"), vec![cluster_scan_anchor_slot()]);
    // `collect_sample` sorts and de-duplicates before typing, so the addressed
    // order is the sorted window, not the SCAN page order.
    let mut window: Vec<&str> = keys.to_vec();
    window.sort_unstable();
    let typed_slots: Vec<u16> = window.iter().map(|k| get_slot(k.as_bytes())).collect();
    assert_eq!(
        conn.addressed
            .iter()
            .filter(|(args, _)| cmd_name(args) == "TYPE")
            .map(|(_, slot)| *slot)
            .collect::<Vec<_>>(),
        typed_slots,
        "each TYPE must be addressed at its own key's shard"
    );
    assert!(
        typed_slots.iter().any(|slot| *slot != typed_slots[0]),
        "test fixture must straddle two shards, otherwise this proves nothing"
    );
    assert_eq!(conn.misrouted, Vec::<Vec<String>>::new());
    assert_eq!(conn.slot_refreshes, 0);
}

#[tokio::test]
async fn cluster_sample_window_is_bounded_because_every_key_costs_a_round_trip() {
    // 500 keys on the first SCAN page: standalone would type them in one batch,
    // a cluster connection may not be left with 500 sequential round trips.
    //
    // BUG-008: 200 is pinned by its literal, not by the constant, because the
    // number is quoted outside this crate — `commands.rs` advertises it in the
    // `sampleLimit` description and Wave 2 budgets `sampled ≤ 200` from it.
    assert_eq!(
        CLUSTER_TYPE_SAMPLE_LIMIT, 200,
        "changing the cluster budget means re-deriving the UI wording and the \
         per-key round-trip cost the clamp exists to bound"
    );
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
    assert_eq!(
        journal.count_single("SCAN"),
        1,
        "one pinned round trip is enough to fill the window"
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
async fn a_cluster_census_requires_the_whole_cluster_to_have_been_scanned() {
    // `truncated` is the bit the context bar's "采样 N/M" label depends on. On a
    // cluster `sampled` comes from one pinned shard while `dbsize` is the
    // `Aggregate(Sum)` over every master, so `sampled == dbsize` can only mean
    // the cluster's keys all live on the scanned shard — a census. It is *not*
    // forced to true any more, which is why both directions are pinned here.
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
        !dist.truncated,
        "one shard held every key of the cluster and was scanned in full: that is a census"
    );

    // One key on another master and the same sample is an estimate again.
    let mut cluster = ClusterFoldingConn::new();
    cluster.inner.push_int("DBSIZE", 3);
    cluster.inner.push_scan(0, &["a", "b"]);
    cluster.inner.push_types(&["string", "hash"]);
    let dist = type_distribution(&mut cluster, Some(100), Topology::Cluster)
        .await
        .expect("cluster distribution");
    assert!(
        dist.truncated,
        "2 sampled on one shard against 3 in the cluster must never read as exact"
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
async fn an_empty_cluster_reports_an_empty_census() {
    // `DBSIZE` is the cluster-wide sum, so `dbsize: 0` on a cluster means *every*
    // master is empty — the only case in which an empty sample is not an
    // estimate. (R 项 9d's earlier wording, "an empty shard ⇒ dbsize 0 and
    // truncated false", cannot hold on a multi-shard cluster and is replaced by
    // this.)
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("DBSIZE", 0);
    conn.inner.push_scan(0, &[]);
    let dist = type_distribution(&mut conn, None, Topology::Cluster)
        .await
        .expect("an empty keyspace is not an error");
    assert_eq!(dist.dbsize, 0);
    assert_eq!(dist.sampled, 0);
    assert!(
        !dist.truncated,
        "nothing was withheld from an empty cluster"
    );
    assert_eq!(conn.journal().count_single("DBSIZE"), 1);
}

#[tokio::test]
async fn every_cluster_scan_round_shares_one_shard_and_cursor_space() {
    // Three pages whose cursor only wraps on the last one: a single cursor must
    // run through them, so all three rounds go to the anchor shard.
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("DBSIZE", 6);
    conn.inner.push_scan_batches(&[
        (1, vec!["a".to_string(), "b".to_string()]),
        (2, vec!["c".to_string(), "d".to_string()]),
        (0, vec!["e".to_string(), "f".to_string()]),
    ]);
    conn.inner
        .push_types(&["string", "string", "string", "hash", "hash", "zset"]);

    let dist = type_distribution(&mut conn, Some(500), Topology::Cluster)
        .await
        .expect("cluster sampling");
    assert_eq!(dist.sampled, 6);
    assert_eq!(dist.counts.get("zset"), Some(&1));

    let scan_slots = conn.slots_for("SCAN");
    assert_eq!(scan_slots.len(), 3, "one addressed round per page");
    assert!(
        scan_slots.windows(2).all(|pair| pair[0] == pair[1]),
        "a cursor from one shard must never be handed to another: {scan_slots:?}"
    );
    assert_eq!(scan_slots[0], cluster_scan_anchor_slot());
    assert_eq!(
        conn.unpinned_rounds, 0,
        "no round may be left to the table's random node"
    );
    // BUG-008, second half: the anchor is a slot we chose, so pin its value too.
    assert_eq!(
        cluster_scan_anchor_slot(),
        get_slot(CLUSTER_SCAN_ANCHOR.as_bytes()),
        "the anchor slot must come from the named key"
    );
}

#[tokio::test]
async fn a_transport_failure_on_the_addressed_path_aborts_the_probe() {
    // Per-command degradation must not swallow the connection: a dropped link is
    // a failed read, not a key with no attributes. This exercises the addressed
    // leg, which is where the cluster path now spends every round trip.
    let mut conn = ClusterFoldingConn::new();
    conn.inner.push_int("DBSIZE", 10);
    conn.inner.push_scan(0, &["a", "b"]);
    conn.inner.push_type("string");
    conn.transport_failure_for = Some("TYPE".to_string());

    let err = type_distribution(&mut conn, Some(10), Topology::Cluster)
        .await
        .expect_err("a dropped connection must reach the caller");
    assert!(err.contains("connection"), "got {err}");
    assert!(
        conn.journal().batches.is_empty(),
        "nothing may be batched on this path either way"
    );
    assert!(
        conn.addressed
            .iter()
            .any(|(args, _)| cmd_name(args) == "TYPE"),
        "the failure must come from the addressed path: {:?}",
        conn.addressed
    );
    assert_eq!(
        conn.slot_refreshes, 0,
        "a transport failure is not a routing failure: {:?}",
        conn.misrouted
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
