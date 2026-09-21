# Track: redis-cmds-p0 — Bug 清单（Tester 首轮登记，2026-09-22）

> 登记人：Tester（全新实例，commit `b1e1f4010` 复测）。状态口径：`待修复` → `修复中` → `待复测` → `已修复`。
> 本轮 **只测不修**：未改任何生产代码；已补 12 条测试（清单见 `progress.md`「Tester 复测记录」阶段 C）。
> redis crate 证据均来自本机实源码 `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/redis-0.27.6/`（`Cargo.lock:6018-6021` 钉 `redis 0.27.6`）。

## 汇总

| ID | 严重级 | 一句话 | 状态 |
| --- | --- | --- | --- |
| redis-cmds-p0-BUG-001 | 高 | Cluster 连接下 `key_object_info` 的"单项降级"整条失效：cluster 层自己就 `extract_error_vec`，默认非 LFU 策略 ⇒ 该命令在 Cluster 上**必然**失败 | 待修复 |
| redis-cmds-p0-BUG-002 | 中 | Cluster 连接下 `type_distribution` 的 500 键 TYPE 批次触发 `CrossSlot` 硬失败；且「契约偏离」第 6 条"cluster 路由不变"的表述不成立，会误导 Wave 2 | 待修复 |
| redis-cmds-p0-BUG-003 | 中 | 绕开 `query_async` 依赖 `#[doc(hidden)]` 内部 API，但缺长度校验兜底：`key_object_info` 对"回复条数 ≠ 请求条数"完全裸奔，redis 升级即静默把侧栏读成空态 | 待修复 |
| redis-cmds-p0-BUG-004 | 低 | `is_unusable_reply` 的 `_ => false` 兜底与模块文档承诺相反：未知回复形状会被静默读成"键已过期" | 待修复 |
| redis-cmds-p0-BUG-005 | 低 | `collect_sample` 无轮次上界/进展守卫：异常服务端（游标不归零 + 空批）可让一次高频上下文条调用无界 SCAN | 待修复 |
| redis-cmds-p0-BUG-006 | 低 | "侧栏恰 1 次往返"断言口径夸大：`ScriptedConn` 只喂 op 层，把 `with_live_op!` 每次必发的 `SELECT` mock 掉了 ⇒ 命令级真实成本 2 次往返 | 待修复 |

---

## redis-cmds-p0-BUG-001 · 高 · Cluster 下 `key_object_info` 单项降级失效（默认配置即必失败）

**现象 / 量级**
`ops_workbench.rs:301-312` 的 `pipeline_raw` 用 `ConnectionLike::req_packed_commands` 替掉 `Pipeline::query_async`，理由是后者经 `Value::extract_error_vec` 会让"首个单项错误即整批失败"。这个理由对 **standalone / sentinel**（`MultiplexedConnection`）成立，但 **Cluster 不成立**：redis 0.27.6 在 cluster 分发层**又做一次**同样的折叠。

- `redis-0.27.6/src/aio/multiplexed_connection.rs:196-235`（`send_result` 的 `ResponseAggregate::Pipeline` 分支）：`Ok(item)`（含 `Value::ServerError`）→ `buffer.push(item)`，`first_err` 只在传输级 `Err` 或事务里被赋值 ⇒ 单命令错误作为**值**存活。⇒ standalone 降级成立（与实测一致）。
- `redis-0.27.6/src/cluster_async/mod.rs:668-681`（`try_pipeline_request`）：
  `conn.req_packed_commands(&pipeline, offset, count).await.and_then(Value::extract_error_vec)` ⇒ **任意单项错误即整批 `Err`**。
- 本驱动 Cluster 走的正是这条：`packages/drivers/redis/src/connect.rs:93-99` `RedisLiveConn::Cluster(ClusterConnection)`，`redis_driver.rs:24-48` + `connect.rs:820-828` `with_redis_conn!` 直接把该 `ClusterConnection` 交给 op。

后果：`OBJECT FREQ` 在 `maxmemory-policy` 非 LFU 时服务端**必定**报错（Redis 默认 `noeviction` ⇒ 所有非 LFU 实例）。standalone 下按契约降级为 `freq: null`；Cluster 下整条 `key_object_info` 返回 `DriverError::QueryFailed`。即 **P0 键属性侧栏在 Cluster 连接上 100% 不可用、且以红色错误呈现**，与本轨任务书"降级要求（关键，别做成报错）"直接冲突。`MEMORY USAGE`（Redis < 4.0）在 Cluster 下同形失效。

**可复现步骤**
1. 真连一个 Redis Cluster（7.x，`maxmemory-policy` 保持默认 `noeviction`），db0 建任意键 `foo`。
2. `execute_driver_command { command: "key_object_info", input: { dbIndex: 0, key: "foo" } }`。
3. 期望（契约）：`missing:false, type:"string", freq:null, memoryBytes/encoding/idleSeconds/ttlMs` 正常。
   实际（推断自源码，待 R 真连证实）：整条命令 `Err`，错误串含 `an object access frequency counter is not available`（或 aggregate error）。
   对照：同一输入在 standalone 下返回成功（已有单测 `key_object_info_uses_one_round_trip_and_survives_a_rejected_field` 覆盖）。

**为何单测测不出来**：`ops_workbench/tests.rs:192-215` 的 `ScriptedConn` 自己实现 `req_packed_commands`，等于把被测行为（错误折叠发生在哪一层）mock 掉了；任何进程内测试都无法触达 redis 的 cluster 分发层。

**建议修法（择一，勿由 Tester 代改）**
- (a) 推荐：让 op 感知拓扑。`plugin_on_db!` 传入 `is_cluster`（或把 `RedisLiveConn` 的分支信息带进 op 签名）：standalone/sentinel 继续 `req_packed_commands`（或改用**公开** API `MultiplexedConnection::send_packed_commands`，`multiplexed_connection.rs:545`，语义等价且不算内部依赖）；Cluster 下退化为 6 次单命令 `req_packed_command`（单命令路径 cluster 逐条路由正确、可逐条降级），并在文档标注 6 RTT。
- (b) 保留 pipeline 但整批失败时按项重发一次（`execute_pipelined_async` + 失败重试），代价是 Cluster 上最坏 1+6 次往返。
- (c) 最低要求：本轨不得在 Cluster 上"看似成功、实则常红"。若裁定 Cluster 暂不支持，必须在 `progress.md`「契约偏离」显式写明"Cluster 下 `key_object_info` 可能整体失败"，并要求 Wave 2 侧栏按 §3.4 的失败空态渲染。
- 无论哪种：在 `packages/drivers/redis/tests/` 或 `e2e`/R 清单里加一条 Cluster 真连回归（现有 R 项 9 的措辞需按 BUG-002 一并加强）。

---

## redis-cmds-p0-BUG-002 · 中 · Cluster 下 `type_distribution` 跨 slot 批次硬失败 + 契约偏离表述不实

**现象 / 量级**
`sample_types`（`ops_workbench.rs:353-378`）把最多 500 个**不同键**的 `TYPE` 装进一个 pipeline。redis 0.27.6 的 cluster pipeline 有单 slot 约束：

- `redis-0.27.6/src/cluster_async/mod.rs:1057-1067`：`req_packed_commands` 先 `route_for_pipeline(pipeline)?`。
- `redis-0.27.6/src/cluster_async/routing.rs:71-105`（折叠首个具体 slot，`:95`）：一旦后续命令 slot 不同 ⇒ `Err((ErrorKind::CrossSlot, "Received crossed slots in pipeline"))`。

⇒ Cluster 上只要采样窗口里有 2 个键落在不同 slot（键数稍多的 db 几乎必然），`type_distribution` 整条命令失败；即使只有 1 个键能侥幸通过。

**归属判定（避免误伤）**：本驱动的既有 `list_children` 也用了跨键 pipeline（`packages/drivers/redis/src/ops_tree.rs:148-156`，经 `query_async`），因此"跨 slot 失败"这一**故障类别在本仓已有先例、不是本轨新造**；本轨的真实增量是：(1) 把该形态搬到**每次切 db / 每次刷新都会跑**的上下文条路径；(2) `progress.md`「契约偏离」第 6 条写下"`offset=0 / count=len` 与 `execute_pipelined_async` 一致 ⇒ 线路字节、传输与 **cluster 路由不变**"，这句**不成立**（cluster 对 pipeline 有额外的单 slot 路由约束，且 `req_packed_commands` 在 cluster 上还多一层错误折叠，见 BUG-001）。Wave 2 会据此认为 Cluster 下 chips 可用。

**可复现步骤**：Cluster 真连，db0 写入 `k1`、`k2`（确保不同 slot；必要时写十几个键提高命中率）⇒ `execute_driver_command { command: "type_distribution", input: { dbIndex: 0, sampleLimit: 100 } }` ⇒ 预期 `Err(CrossSlot …)`。standalone 同输入返回成功（已由单测覆盖）。

**建议修法**
1. 必修：更正「契约偏离」第 6 条，改为"cluster 路由与错误折叠语义**不同**：见 BUG-001/002"，并把 Cluster 支持状态写清（可用 / 需按拓扑分支 / 明确不支持）。
2. 实现侧与 BUG-001 同一处收口：Cluster 下按 slot 分组批发（redis 0.27 未公开 `route_for_pipeline`，需自行按 `redis::cluster_routing::slot_of(key)` 预分组）或退化为逐键单命令 `TYPE`（接受 RTT，`truncated`/`sampled` 语义不变）。
3. 若裁定 Cluster 暂不支持：UI 侧（§3.4"采样失败 ⇒ 整组 chips 不渲染"）需能吃到错误，且 Wave 2 不得把"chips 不渲染"实现成"chips 显示 0"。
4. `list_children` 的同形问题**另立新条**（建议交协调者登记为基线既有缺陷，不并入本轨整改面，以免污染 diff）。

---

## redis-cmds-p0-BUG-003 · 中 · 依赖 `#[doc(hidden)]` 内部 API 却无回复条数兜底

**现象**
`ConnectionLike::req_packed_commands` 在 redis 0.27.6 被明确标注为内部用：`redis-0.27.6/src/aio/mod.rs:75-79`
> `/// Important - this function is meant for internal usage, since it's easy to pass incorrect `offset` & `count` parameters, which might cause the connection to enter an erroneous state. Users shouldn't`
> `/// call it, instead using the Pipeline::query_async function.` + `#[doc(hidden)]`

本轨 `offset=0 / count=len` 用法本身正确（与 `execute_connection_pipeline`、`pipeline.rs:336-338` 内部一致），但依赖它是**未公开承诺**的：offset/count 语义、回复顺序、跨版本行为都可能变。真正的风险在于**没有任何校验把这种变化变成可见错误**：

- `sample_types`（`ops_workbench.rs:364-370`）只在 `values.len() != chunk.len()` 时 `tracing::debug!` 一笔（降级为计数变少，尚可接受）。
- `key_object_info`（`ops_workbench.rs:404-415` + `slot():245-247`）**完全不校验**：`values` 短于 6 时 `slot()` 返回 `RValue::Nil` ⇒ 经 `is_unusable_reply` 直接落到"第四态未知"或单字段 `null`。也就是说：一旦 redis 版本改变了回复排布，侧栏会**静默**从"有数据"退化为"全空态/未知态"，无 warn、无错误、无测试可红 —— 与 BUG-001 不同的是，这个连日志都没有。
- 现有测试无法暴露：`ScriptedConn::req_packed_commands`（tests.rs:192-215）**恒**每命令回一条（回复条数与请求条数天然相等）。

**复现（可粘贴，无需真连）**：Tester 已提交 `test_tester_short_type_reply_never_inflates_the_sample`（tests.rs，`ShortReplyConn` 只回 2/5 条），证明采样侧可容忍；但同形状的 `key_object_info` 短回复路径当前**无任何断言覆盖**，可按下例补齐（留给 Coder 与修复一并落地）：
```rust
#[tokio::test]
async fn key_object_info_survives_a_truncated_reply_vector() {
    let mut conn = ShortReplyConn { replies: 3 };   // 只回 3 条，但请求 6 条
    let info = key_object_info(&mut conn, "k").await.expect("…");
    // 期望：显式可观测（warn 或明确的"未知态"），而不是静默按槽位错位解读
    assert!(!info.missing);
    assert!(info.idle_seconds.is_none());
}
```

**建议修法**
1. `pipeline_raw` 返回后在 `key_object_info` 内加 `values.len() != KEY_INFO_PIPELINE_LEN` 的 `tracing::warn!`（带 expected/replied），并考虑按"整条读取失败"上抛 —— 至少要让日志可定位。
2. 把内部依赖显式记录：在 `progress.md` 或模块文档加"升级 redis 必查项：`req_packed_commands` 的 offset/count 与回复排布"，并给 `Cargo.toml` 的 `redis = "0.27"` 评估是否应锁小版本（本仓 `Cargo.lock` 已钉 0.27.6，但 `= "0.27"` 允许 0.27.x 漂移）。
3. 若愿意换实现：standalone/sentinel 可改用**公开**方法 `MultiplexedConnection::send_packed_commands`（`multiplexed_connection.rs:545`，同一实现、非 `#[doc(hidden)]`），把内部 API 依赖面缩到零 —— 但这要求 op 不再对 `ConnectionLike` 泛型化，需与 BUG-001 的拓扑分支一起设计。

---

## redis-cmds-p0-BUG-004 · 低 · `is_unusable_reply` 兜底与模块文档承诺相反

**现象**
`ops_workbench.rs:177-193` 的文档写：
> A structured `ServerError` / `Push` / `Attribute` carries the payload itself, and **unknown future shapes are also treated as errors, so a new server-side reply type can never be silently read as "the key is missing"**.

但实现是 `match … { 明确列出的变体 => …, _ => false }`：`Value::Okay` / `Double` / `Boolean` / `BigNumber` 都落到 `_ => false` ⇒ 被判为**可用**。于是它们在 `parse_type_token`（`ops_workbench.rs:204-210`，只认识 BulkString/SimpleString/Verbatim/Int）里返回 `None`，`parse_key_info:257-268` 的顺序是"先 `is_unusable_reply` ⇒ 第四态；否则 `key_type.is_none()` ⇒ **missing: true**" ⇒ 这些形状恰好被读成**"键已过期"**，即文档声称绝不会发生的那件事。

**当前可达性**：今日 Redis 的 `TYPE` 不会回 `+OK` / double / bool，故**非现网缺陷**；属"未来协议变化 ⇒ 静默假过期"的健壮性缺口。列低。

**建议修法**：把"键不存在"的判定从"token 解析不出来"收窄为"TYPE 明确回答 none/空"。例如新增
```rust
/// TYPE 是否明确回答"键不存在"（区别于"读不出来"）。
pub fn type_reply_says_absent(value: &RValue) -> bool {
    parse_opt_string(value).is_some_and(|t| t.trim().eq_ignore_ascii_case("none") || t.trim().is_empty())
}
```
`parse_key_info` 改为：`is_unusable_reply ⇒ 第四态`；`type_reply_says_absent ⇒ missing()`；`parse_type_token.is_some() ⇒ 正常`；**其余 ⇒ 第四态**（保守）。补一条断言 `parse_key_info(&[.., RValue::Okay])` 非 missing 的测试（Tester 未代为提交，因该断言与现实现相冲突）。

---

## redis-cmds-p0-BUG-005 · 低 · `collect_sample` 缺轮次上界与进展守卫

**现象**
`ops_workbench.rs:328-350` 的 SCAN 循环只有两个退出条件：`keys.len() >= limit` 与 `cursor == 0`。若服务端（代理、异常实现、被降权的 replica）持续返回**非零游标 + 空/零新增键批次**，两个条件都不满足 ⇒ **无界循环**，命令永不返回。`type_distribution` 是"每次切 db / 每次刷新"都跑的高频路径（PRD §3.4 上下文条），且 `MultiplexedConnection` 侧无语句级超时 ⇒ 上下文条永久 pending，并长期占用 `with_live_op!` 的 `connections.write()` 写锁（`redis_driver.rs:30`），会连带阻塞该连接上的其他命令。

**归属**：既有 `scan_keys`（`ops.rs:109-134`）同形状（继承，非本轨引入），但既有路径有 UI 侧 `scan_abort`（`ops_value_search`）可中断，`type_distribution` 没有任何中断位。

**建议修法**
1. 加轮次上界：`max_rounds = (limit / TYPE_SCAN_COUNT).max(1) + 16`（或常量 64），超限即停止采样、按现有语义置 `truncated = sampled < dbsize`（语义自洽，无需新契约字段）。
2. 加进展守卫：连续 N 轮 `keys.len()` 无变化 ⇒ 提前结束（游标不推进的坏循环同样防住）。
3. 配套测试（可由 Coder 直接落地，无需真连）：
```rust
#[tokio::test]
async fn type_distribution_stops_after_the_round_cap() {
    let mut conn = ScriptedConn::new();
    conn.push_int("DBSIZE", 10_000);
    for _ in 0..10_000 { conn.push_scan(7, &[]); }   // 游标永不归零、恒空批
    let dist = type_distribution(&mut conn, Some(1_000)).await.expect("must not hang");
    assert_eq!(dist.sampled, 0);
    assert!(dist.truncated);
    assert!(conn.journal().count_single("SCAN") <= 64, "必须有轮次上界");
}
```

---

## redis-cmds-p0-BUG-006 · 低 · "恰 1 次往返"断言把 `SELECT` mock 掉了（口径夸大）

**现象**
`ops_workbench/tests.rs:480-488` 断言 `journal.round_trips() == 1` / `journal.singles.is_empty()`，文案是"the whole sidebar payload must cost exactly one round trip"。该测试直接调用 op（`key_object_info(&mut conn, …)`），而命令真实路径是 `commands_exec_dispatch.rs` → `plugin_key_object_info`（`redis_driver.rs` `plugin_on_db!`）→ `with_live_op!`，其中 `RedisDriver::select_db` **每次无条件**发 `SELECT`（`redis_driver_on.rs:14-23` 无"游标已在本 db 则跳过"短路，`redis_driver.rs:32`）。
⇒ 命令级真实成本：`key_object_info` = **2** 次往返（SELECT + 1 pipeline）；`type_distribution` = `2 + SCAN 轮数 + ceil(n/500)`。断言本身对 op 层成立，但"整条命令 1 次往返"不成立，且 Sentinel 断线重连分支（`redis_driver.rs:36-45`）会**整体重放**一次。

**影响**：不影响契约字段，但 Wave 2 依 PRD §3.2 的往返/扫描预算模型做自动刷新间隔与并发设计时，会按被夸大的数字估预算；R 回归项 4 的 MONITOR 抓包若按"只有 DBSIZE/SCAN/TYPE"核对，会被 `SELECT` 判成不符。

**建议修法**
1. 把该断言文案改为"op 层恰 1 次 pipeline 往返（不含 `with_live_op!` 的 db SELECT）"，避免口径外溢。
2. `progress.md`「留待 R 回归」第 4、9 条补注"另有 1 次 SELECT（Sentinel 重连时整条重放）"。
3. 可选（属另一条产品判断，交协调者裁定）：`select_db_on` 增加 `live.current_db` 缓存短路 —— 全驱动受益，但会改既有行为，**不建议在本轨顺手做**。

---

## 环境性既有红（非本轨缺陷，不计入 Bug）

1. `cargo clippy -p datazen-driver-redis --all-targets` **exit ≠ 0**：2 条 deny 级 `approx_constant`
   —— 实测位置 `packages/drivers/redis/src/ops.rs:905:38`、`packages/drivers/redis/src/ops_exec.rs:260:57`。
   证据：`git diff --stat ae65ae375 b1e1f4010 -- .../ops.rs .../ops_exec.rs` **零输出**（两文件本轨未触碰）⇒ 基线红，与本轨无关。
   复测方法学：以"`-->` 命中文件/行是否落在本轨 diff 内"为判据；本轨 diff 文件为
   `commands.rs`、`commands_exec_dispatch.rs`、`lib.rs`、`redis_driver.rs`、`ops_workbench.rs`、`ops_workbench/tests.rs`、`tests/workbench_commands.rs`。
   其中 `commands_exec_dispatch.rs:419/426/433`（3 条 `redundant_closure`）经 `git show ae65ae375:… | sed -n '405p;412p;419p'` 比对，确认为**基线代码整体下移 14 行**（本轨在 `@@ -384,6 +384,20 @@` 纯插入），非新增命中。
   `ops_workbench*` 与本轨新增 dispatch/definition 代码 **零命中**（Coder 声称成立；Tester 补的 12 条测试同样零命中 —— `cargo clippy` 诊断集在补测前后逐行相同）。
2. 其余 17 warning 分布：`redis_driver*.rs`、`ops_value_search.rs`、`ops_io.rs`、`decode/pickle.rs`、`redis_driver_on.rs`、`redis_value_preview.rs` + `packages/driver-api`（3 条），全部在本轨 diff 之外。
3. `cargo llvm-cov --branch` 在本机不可用（`-Z coverage-options=branch` 需 nightly；`rustup toolchain list` 只有 `stable` 与 `1.96.1`）⇒ 分支覆盖改用 stable 可行范围内的行/区域覆盖 + 人工逐分支枚举（见 `progress.md` 阶段 C）。
