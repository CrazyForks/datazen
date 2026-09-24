# Track: redis-cmds-p0 — Bug 清单（Tester 首轮登记，2026-09-22 · Coder 修复第 1 轮回写，同一日 · Tester 复测轮回写，同一日 · Coder 修复第 3 轮 + 收尾轮回写，同一日）

> 登记人：Tester（全新实例，commit `b1e1f4010` 复测）。状态口径：`待修复` → `修复中` → `待复测` → `已修复`。
> 首轮 **只测不修**：未改任何生产代码；已补 12 条测试（清单见 `progress.md`「Tester 复测记录」阶段 C）。
> redis crate 证据均来自本机实源码 `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/redis-0.27.6/`（`Cargo.lock:6018-6021` 钉 `redis 0.27.6`）。
> **修复第 1 轮（Coder @ `346ebc979`，Bug 循环 1/5）**：BUG-001~005 已改生产码并落回归测试，BUG-006 按 Tester 修法 1+2 只改测试口径（修法 3 交协调者）⇒ 六条全部置 **待复测**，每条下方新增「修复备注（第 1 轮）」给出落点行号与守它的用例名。原「现象 / 建议修法」正文保留不动，作为裁定依据存档。
> **收尾轮（Coder 第 2 实例，同一 Bug 循环 1/5）**：补上 BUG-003 / 004 / 005 / 006 四条缺失的分节「修复备注 · 状态 → 待复测」（上一轮只写了汇总表与 BUG-001/002 两节），并按 BUG-006 建议口径 1 把剩余两处夸大措辞（`tests.rs` 第二个裸 `round_trips() == 1`、`commands.rs` 两条面向 UI 的 description）改如实；`progress.md`「契约偏离」第 6 条正文改写为修复后的真实口径并保留 Tester 裁定原文，R 项 9a/9b 补 `SELECT`。同时逐条自查 `346ebc979` 对 Tester 12 条 `test_tester_` 用例的影响：**无放宽、无注释掉、无删除**（详见 `progress.md`「Coder 收尾记录」）。

> **复测第 1 轮（全新 Tester 实例 @ HEAD `c844b6804`，Bug 循环 1/5 的复测）**：BUG-001 ~ 006 六条**逐条独立验证通过**（见下节「复测判定」），全部流转为 **已修复**；真连部分仍归 R 项，不由单测替代。**同时登记 1 条新 Bug**：`redis-cmds-p0-BUG-007`（中）—— 本轨修复轮写下的三条 Cluster 口径（往返成本 / `dbsize` 语义 / "分片视图"）与 redis 0.27.6 自己的路由表不符，方向是"低估成本 + 把全集群求和说成分片数字"，且现有 cluster 测试替身在路由这一点上**比真实客户端更乐观**，故修复轮用例无法证伪。⇒ 本轮整体判定 **FAILED**（新 Bug 是口径与成本面，非契约字段错误，严重级中）。Tester 仍**只测不修**：生产码零改动，新增 7 条 `test_tester_` 用例（`ops_workbench/tests/fix_round1_retest.rs`）。
> **复测第 1 轮 · 第 2 实例接手（同一 HEAD `2c1f77134`，turn 现场恢复）**：上一任复测实例跑到 turn 上限被中断，**现场未提交**（`bugs.md` / `progress.md` 的复测裁定 + `fix_round1_retest.rs` 七条用例全部悬在工作区）。本实例（1）**逐条独立核实其结论**（不接受其自述）：BUG-007 的四条事实断言全部对 redis-0.27.6 本机源码逐行复核成立（见「BUG-007 事实独立复核」），其新增 7 条用例经变异实测证明**是真断言而非装饰**（M11/M13 变异只有它红）；(2) 补做上一任**完全没做**的两项本轨最高风险检验 —— 13 项**变异实测**（反自证循环）与**契约冻结逐字节核对**；(3) 新登记 `redis-cmds-p0-BUG-008`（低）⇒ 本轮判定仍为 **FAILED**（循环 2/5）。其未提交的测试代码与文档由本实例核实后一并提交，归属在 `progress.md`「Tester 复测轮 · 第 2 实例」如实标注。

> **修复第 3 轮（Coder @ `81cc58a90` + `286d917c4`，Bug 循环 2/5 · 收尾轮第 2 实例接手）**：按协调者第 3 轮七条裁定施工 —— BUG-007 走**实现 + 口径 + 测试面**三条（Cluster 探测按槽显式寻址走**公开**的 `route_command`，`BLOCKED` 前置条件经源码核实不成立；`SCAN` 定桩单分片；`DBSIZE` 有意不寻址；`from_sharded_view` 删除、`truncated` 按新事实重推；三条 Cluster 口径与 description 全部重写），BUG-008 用**字面量 + 文案由常量渲染**双侧钉死。两条状态均流转为 **待复测**，各节末尾新增「修复备注（第 3 轮）」给出落点行号、守它的用例名与**收尾轮复跑的变异实测结果**（本条的负面事实 `M-addr 全绿` 也写在里面）。第 1 轮 Coder 实例在 turn 上限被强杀（本轨第三次），两笔代码 commit 已在 HEAD、台账三件未做 ⇒ 由收尾轮补齐并**独立复证**（未采信前任自述）。原「现象 / 建议修法」正文与上两轮裁定一律保留为存档。

## 复测判定（Tester 复测轮 · 2026-09-22 · HEAD `c844b6804`）

方法：不照抄 Coder 数字 —— 重跑完整套件 + 逐条读修复落点代码 + 自己新增用例（含用 redis **公开** API `cluster_routing::RoutingInfo::for_routable` / `get_slot` 直接问"这条命令被投到哪个分片"，而不是问 mock）。全部判定均为**进程内**结论；真连项仍留在 `progress.md`「留待 R 回归」。

| Bug | 复测结论 | 独立证据（Tester 实测，非 Coder 自述） |
| --- | --- | --- |
| BUG-001 高 | **已修复** | `issue_batch`（`ops_workbench.rs:476-488`）确按 `Topology::Cluster ⇒ sequential_raw`、`Standalone \| Sentinel ⇒ pipeline_raw` 分支；`single_command`（`:442`）的分类表此前只被自造错误对象走过一次，Tester 用 `test_tester_connection_failure_classifier_matches_real_reply_kinds` 逐类钉住（`-ERR` / `-WRONGTYPE` / `-NOPERM` / `-LOADING` 降级，`-MOVED` / `-ASK` / `-TRYAGAIN` / `-CLUSTERDOWN` / `-CROSSSLOT` + Io / Client 上抛；错误对象由 redis 自己的 `parse_redis_value` + `Value::extract_error` 生成，非手写枚举）。Cluster 6 单发 + `freq: null` 由既有 `cluster_key_object_info_degrades_per_field_over_six_singles` 守住，本回合复跑通过。 |
| BUG-002 中 | **已修复（原症状），但派生 BUG-007** | 跨 slot `CrossSlot` 已不可达（Cluster 逐键单命令 + 采样窗 200），`cluster_type_distribution_types_keys_one_at_a_time` / `cluster_sample_window_is_bounded_because_every_key_costs_a_round_trip` 复跑通过；`sample_window_for` 的 **Sentinel 臂此前无人断言** ⇒ Tester 补 `test_tester_sample_window_honours_every_topology_arm`，证明 Sentinel 仍走单节点 1000/5000 预算、未被误并进 200。但"Cluster 往返成本 / `dbsize` 是该分片数字 / 分片视图"这三条新口径本身被 redis 路由表证伪 ⇒ BUG-007。 |
| BUG-003 中 | **已修复** | `:641-656` 的条数守卫实测在 `ShortReplyConn { replies: 3 }` 下返回同时含 `expected 6` 与 `got 3` 的 `Err`（`fix_round1::key_object_info_refuses_a_truncated_reply_vector_instead_of_guessing` 复跑通过），换喂满 6 条的 `ScriptedConn` 后正常读取 ⇒ 不再是静默空态。修法 3（公开 `send_packed_commands`）已由协调者裁定 2 转依赖治理条，不属本条失效。 |
| BUG-004 低 | **已修复** | 四态顺序实测（`parse_key_info` `:346`）：`Okay` / `Double` / `Boolean` 三形状 ⇒ `!missing` 且整体 `== unreadable_key_state()`；只有 `TYPE` 明确答 `none`/空串才 `missing: true`（`fix_round1::only_an_explicit_none_answers_that_the_key_is_absent` + `…unrecognised_type_reply_is_unknown_state_and_not_an_expired_key` 复跑通过）。首轮刻意未提交的 `RValue::Okay` 断言已按原文意图存在。 |
| BUG-005 低 | **已修复** | 两守卫实测生效且不是"≤"式弱断言：恒空批 ⇒ `SCAN` 恰 16 轮、游标空转（每轮重复返回同 3 个键）⇒ 恰 64 轮且 `sampled == 3`（`fix_round1::type_distribution_stops_*` 复跑通过）；`collect_sample`（`:512-553`）触发时 `warn!` 带 `rounds/stalled/cursor/limit`；无新增契约字段，`sampled == Σcounts` 不变式保持。 |
| BUG-006 低 | **已修复（Tester 修法 1+2 全部落地；修法 3 由协调者裁定另立轨）** | `tests.rs:459` 与 `:516-518` 两处 `round_trips() == 1` 均带"不含 `with_live_op!` 的 SELECT"定语；`commands.rs` 两条 description 不再宣传 "One pipeline"；R 项 4 的 MONITOR 表含 `SELECT` 并区分两拓扑。"op 自身绝不发 `SELECT`"仍由 `test_tester_keys_is_issued_in_neither_shape_on_either_path` 的反向白名单钉住（本回合复跑通过）。**注意**：本条修正后的 Cluster 数字（"1 SELECT + 6 = 7"）被 BUG-007 再次低估 ⇒ 本条判关闭，但口径由 BUG-007 继续追。 |

三条"仍待真连"的判据（BUG-001 / 002 的 R 项 9a / 9b、BUG-005 的 R 项 13）**未因本轮单测通过而撤销** —— 进程内替身只能防形状回归。

## 变异实测：修复轮的"回归守卫"是不是装饰性的（Tester 复测轮 · 第 2 实例）

**为什么必须做这一步**：本轨的 Cluster 修复全部建立在进程内替身 `ClusterFoldingConn` 之上，而**替身完全可能只是把期望演一遍**。判定手段只有一种 —— 把生产码改回缺陷形态，看测试是否变红。**上一任复测实例没有做这件事**（它做的是路由表事实核查），本回合补齐。

**方法**：独立构建目录 `target/cargo-wt-retest2`（APFS clone 复用，未与他人争锁），脚本对 `ops_workbench.rs` 逐条施加语义反转，跑 `cargo test -p datazen-driver-redis --lib`，记录 `test result:` 与变红的用例名，**每次立即复原**（`md5` 逐次核对，最终 `RESTORED-OK c4f17415fbb738502f7513d664ab8956` 与 HEAD blob 一致，生产码零残留）。M0 未变异基线 = **217 passed / 0 failed / 1 ignored**。

| # | 变异（把哪条修复改回缺陷） | 结果 | 变红的用例（实测名） |
| --- | --- | --- | --- |
| M1 | `issue_batch` 取消拓扑分支，统一走 `pipeline_raw`（⇒ BUG-001 修复失效） | **红 (2)** | `cluster_key_object_info_degrades_per_field_over_six_singles`、`…keeps_working_when_the_key_is_gone` |
| M2 | 删掉 `key_object_info` 的回复条数守卫（⇒ BUG-003 修复失效） | **红 (1)** | `fix_round1::key_object_info_refuses_a_truncated_reply_vector_instead_of_guessing` |
| M3 | `from_sharded_view` 不再强制 `truncated`（⇒ BUG-002 的 PRD §3.4 守卫失效） | **红 (1)** | `a_small_full_scan_is_a_census_on_a_single_node_but_not_on_a_cluster` |
| M3b | 另一侧：`type_distribution` 的 Cluster 调用点换成 `from_sample` | **红 (1)** | 同上（两条路径都被钉住，不是只守一处） |
| M4 | `sample_window_for` 的 Cluster 臂不再钳 200 | **红 (2)** | `cluster_sample_window_is_bounded_…`、`test_tester_sample_window_honours_every_topology_arm` |
| M5 | `sample_types` 取消 Cluster 逐键 `TYPE` 分支 | **红 (4)** | 4 条 cluster 用例（含 `…types_keys_one_at_a_time`） |
| M6 | `single_command` 把连接级错误也一律降级（分类器废掉） | **红 (1)** | `a_transport_failure_on_the_single_command_path_aborts_the_probe` |
| M7 | `parse_key_info` 第四态退回 `missing()`（⇒ BUG-004 修复失效） | **红 (4)** | 含 **Tester 原用例** `test_tester_expired_and_unknown_key_states_are_distinguishable` |
| M7b | `type_reply_says_absent` 退回"解析不出即视为不存在" | **红 (2)** | `only_an_explicit_none_answers_…`、`unrecognised_type_reply_…` |
| M8a | 关闭"游标无进展"守卫 | **红 (1)** | `type_distribution_stops_when_the_cursor_stops_making_progress` |
| M11 | 分类器去掉 `is_cluster_error()` | **红 (2)** | **仅**上一任新增的 `test_tester_connection_failure_classifier_…` + `…moved_redirect_…` |
| M12 | 分类器去掉 `is_io_error()` | **红 (2)** | `a_transport_failure_…` + `test_tester_connection_failure_classifier_…` |
| M13 | 分类器去掉 `ErrorKind::CrossSlot` 臂 | **红 (1)** | `test_tester_connection_failure_classifier_matches_real_reply_kinds` |
| **M8b** | **`MAX_SCAN_ROUNDS` 64 → 65** | **全绿** | **无** ⇒ 见 BUG-008 |
| **M8d** | **`MAX_STALLED_SCAN_ROUNDS` 16 → 8** | **全绿** | **无** ⇒ 见 BUG-008 |
| **M8e** | **`CLUSTER_TYPE_SAMPLE_LIMIT` 200 → 201** | **全绿** | **无** ⇒ 见 BUG-008 |
| M8c | `MAX_SCAN_ROUNDS` 64 → 1000 | 红 (1) | 但红因是"窗口先填满"（3 键/轮 × 334 轮 ≥ 1000）而非"64 被钉住"⇒ 不能反证 M8b |
| M8f | `MAX_TYPE_SAMPLE_LIMIT` 5000 → 5001 | **红 (1)** | `type_distribution_clamps_an_oversized_window_instead_of_erroring`（该用例里有字面量 `10` 批）⇒ **5000 这个契约预算是真钉住的**，与本表末三行形成对照 |

**结论（正面）**：任务书点名的三个方向（M1 / M2 / M3）**全部立刻变红**，且 M3b / M4 / M5 / M6 / M7 / M7b / M8a / M11~M13 共 13 项变异全部有红 ⇒ **`ClusterFoldingConn` 不是"把期望演一遍"的装饰替身**，BUG-001 / 002 / 003 / 004 的修复是真守卫。同时上一任新增的 7 条用例中，分类表那两条（M11/M12/M13 **只有它们红**）与 Sentinel 臂（M4）证明其有独立证伪能力，不是重复劳动。

**结论（负面，登记为 BUG-008）**：M8b / M8d / M8e 三项全绿 —— **三个预算数字（64 / 16 / 200）在测试里只以常量自身出现，没有任何字面量锁定**，改数字零反馈；而 `200` 已被写进面向 UI 的 `commands.rs` description，`64 / 16` 是 `progress.md` R 项 13 的真连判据字面值。

## BUG-007 事实独立复核（第 2 实例逐条对源码，不采信上一任自述）

BUG-007 是"关于 redis 路由表的事实断言"，因此可被任何人用本机源码证伪。本回合逐条复核 `~/.cargo/registry/src/…/redis-0.27.6/`：

| BUG-007 断言 | 本机源码实测 | 判定 |
| --- | --- | --- |
| 两词探测命令按子命令 token 路由 | `cluster_routing.rs:522-533` `Routable::command()` 确实把 `MEMORY` / `OBJECT` 拼成 `"MEMORY USAGE"` 形态，而 `for_routable` 的表里**没有** `MEMORY USAGE` / `OBJECT *` 臂（只有 `MEMORY PURGE/MALLOC-STATS/DOCTOR/STATS`、`XGROUP *`、`XINFO *`、`PUBSUB *`、`ACL *`、`CLUSTER *`、`SLOWLOG *`、`LATENCY *`）⇒ 落到 `:503-507` 的 `_ => match r.arg_idx(1)`，即 `USAGE` / `ENCODING` / `IDLETIME` / `FREQ` 被当作"键" | **成立** |
| 于是必吃 `-MOVED` + 重发 + 全集群槽位刷新 | `cluster_async/request.rs:212-220` `(_, RetryMethod::MovedRedirect) => (Retry::Immediately{request}, PollFlushAction::RebuildSlots)`；`mod.rs:394-395` `refresh_slots` 首行即 `conn_lock.write().await` | **成立** |
| Cluster 的 `DBSIZE` 是所有主节点之和 | `cluster_routing.rs:321-322` `b"DBSIZE" ⇒ Aggregate(AggregateOp::Sum)`，`:366-387` `b"DBSIZE"` 在 `MultiNode(AllMasters, …)` 臂内 | **成立** |
| `SCAN` 无路由 ⇒ 每轮可能换分片 | `cluster_routing.rs:477-478` `// TODO - special handling - b"SCAN"` + `b"SCAN" | b"SHUTDOWN" | … => None`；`cluster_async/mod.rs:1052-1053` `for_routable(cmd).unwrap_or(SingleNode(Random))` | **成立** |
| （排除项）不存在"从从节点读滞后数据" | 全 crate grep `read_from_replicas` / `ClusterParams` / `.params(` ⇒ **零命中**；`connect.rs:373-397` 只用 `ClusterClient::builder()` + username/password/tls ⇒ 取默认 `false` | **成立**（BUG-007 不主张它，措辞准确） |

⇒ **BUG-007 维持 `待修复`，四条事实无一夸大**；其"后果分级"（口径面有害 / 契约面无害）与本回合契约冻结核对一致。

## 契约冻结独立核对（Wave 2 可继续按此冻结）

手段：直接对**已提交 blob** 做逐字节比较（不受工作区变异影响）。

| 冻结面 | 核对方法 | 实测 |
| --- | --- | --- |
| 返回体结构 | `git show b1e1f4010:` vs `HEAD:` 提取 `pub struct TypeDistribution` / `pub struct KeyObjectInfo`（去掉 doc 注释后）逐字节比较 | **273 vs 273 / 267 vs 267 字节，IDENTICAL** —— 字段名、类型、`#[serde(rename = "type")]`、`dbsize` 全小写、`Option<…>` 可空性零改动；`git diff b1e1f4010 HEAD -- ops_workbench.rs` 中 `serde|pub struct|pub field` 命中集**只含新增函数签名**，无任何字段行 |
| 输出线形 | `test_tester_*_json_shape_is_the_wave2_contract` 断言的是**排序后的完整 key 向量**（`["counts","dbsize","sampled","truncated"]` / `["encoding","freq","idleSeconds","memoryBytes","missing","ttlMs","type"]`）+ `json.get("dbSize").is_none()` + `freq` 以 `null` **存在**而非缺字段 | 复跑通过 ⇒ 与规格 §范围 逐字一致，**无缺字段/无新增字段** |
| 入参 schema | `git diff b1e1f4010 HEAD -- commands.rs` 全文仅 **3 行**改动，逐行读：两条 `description` + `sampleLimit` 的 `description` | `required`（`&[]` / `&["key"]`）、`"type": "integer"`、`"minimum": 0`、**`maximum` 仍不存在**（"钳制不报错"口径保留）、`permissions`、`output_schema: None` 全部未动 |
| 契约用例是否真在守 | `tests/workbench_commands.rs` 4 条逐条读：`assert_eq!(def.input_schema["required"], json!([]))` / `json!(["key"])`、`[…]["type"] == "integer"`、`[…]["maximum"].is_null()`、`validate_command_input` 双向、`CommandCategory::Observe` + `required_access_level() == Read`、`execute_command` 以 `ConnectionFailed` 而非 `Unsupported` 失败（含反例臂） | **均为真断言**（不是 `contains` 式弱断言）⇒ Coder "只改 description" 的声称**成立** |
| 本轨 diff 面 | `git diff --name-only ae65ae375 HEAD` = 12 文件；grep `Cargo.toml|Cargo.lock|/ui/|locales/|^src/|driver-sdk|resolve-drivers` | **零命中** ⇒ 禁止事项合规，Wave 2 的 TS 类型无需返工 |

## 汇总

| ID | 严重级 | 一句话 | 状态 |
| --- | --- | --- | --- |
| redis-cmds-p0-BUG-001 | 高 | Cluster 连接下 `key_object_info` 的"单项降级"整条失效：cluster 层自己就 `extract_error_vec`，默认非 LFU 策略 ⇒ 该命令在 Cluster 上**必然**失败 | **已修复**（复测通过 @ `c844b6804`；真连仍挂 R 项 9a） |
| redis-cmds-p0-BUG-002 | 中 | Cluster 连接下 `type_distribution` 的 500 键 TYPE 批次触发 `CrossSlot` 硬失败；且「契约偏离」第 6 条"cluster 路由不变"的表述不成立，会误导 Wave 2 | **已修复**（跨 slot 症状复测通过；但修复轮写下的新口径派生 BUG-007） |
| redis-cmds-p0-BUG-003 | 中 | 绕开 `query_async` 依赖 `#[doc(hidden)]` 内部 API，但缺长度校验兜底：`key_object_info` 对"回复条数 ≠ 请求条数"完全裸奔，redis 升级即静默把侧栏读成空态 | **已修复**（复测通过；修法 3 按协调者裁定 2 转依赖治理条） |
| redis-cmds-p0-BUG-004 | 低 | `is_unusable_reply` 的 `_ => false` 兜底与模块文档承诺相反：未知回复形状会被静默读成"键已过期" | **已修复**（复测通过） |
| redis-cmds-p0-BUG-005 | 低 | `collect_sample` 无轮次上界/进展守卫：异常服务端（游标不归零 + 空批）可让一次高频上下文条调用无界 SCAN | **已修复**（复测通过；真连仍挂 R 项 13） |
| redis-cmds-p0-BUG-006 | 低 | "侧栏恰 1 次往返"断言口径夸大：`ScriptedConn` 只喂 op 层，把 `with_live_op!` 每次必发的 `SELECT` mock 掉了 ⇒ 命令级真实成本 2 次往返 | **已修复**（修法 1+2 复测通过；修法 3 另立 `redis-select-shortcircuit` 轨） |
| **redis-cmds-p0-BUG-007** | **中** | 修复轮新写的三条 Cluster 口径被 redis 0.27.6 **自己的路由表**证伪：两词探测命令按**子命令 token** 而非键路由（⇒ 每次侧栏探测必吃 `-MOVED` 重发 + 全集群槽位刷新，"7 次往返"是低估）；Cluster 的 `DBSIZE` 是**所有主节点之和**而非"该分片数字"；`SCAN` 无路由 ⇒ 每轮可能换分片（"分片视图"应为"随机多分片混合视图"）。现有 `ClusterFoldingConn` 用"最后一个参数即键"建模路由，比真实客户端**更乐观** ⇒ 修复轮用例结构上测不到这件事 | **已修复（进程内复测通过）** —— Tester 第 3 实例 @ `a6304a4fb`：七条裁定逐条对到行、契约面 `cmp` 逐字节相同、六项寻址变异各红 1~5 条与台账同向同数；`route_command` 那一行经覆盖率独立确认为 0-count 函数体（结构性盲区，非漏测）⇒ **真连 R 项 9a 未过不关闭**。本条另补 2 条 hash-tag 用例，使"标签失聪"由**完全不可证伪**（反向对照 226 全绿）转为各红 1 条。〔原状态 **待复测** 及其正文如下，照档保留〕（`81cc58a90` + 收尾轮：三条探测通道改为**按槽位显式寻址**（走 redis **公开**的 `route_command` + `get_slot`，裁定 2 设的 `BLOCKED` 前置条件经源码核实**不成立**）、`SCAN` 定桩单一分片、`DBSIZE` **有意不寻址**、`from_sharded_view` **删除**、三条口径与 description 全部重写；替身路由改从 `RoutingInfo::for_routable` 取，不再比客户端乐观。**闭合判据移交 R 项 9a 真连**：production 里 `route_command` 那一行**进程内不可证伪**（收尾轮 M-addr 变异 226 条全绿），真连须见"`-MOVED` 计数 0 + 任何分片零 `CLUSTER SLOTS` + 6 条探测全部落在键所属分片"） |
| **redis-cmds-p0-BUG-008** | **低** | 三个预算常量 `MAX_SCAN_ROUNDS = 64` / `MAX_STALLED_SCAN_ROUNDS = 16` / `CLUSTER_TYPE_SAMPLE_LIMIT = 200` 在测试里**只以常量自身出现**，无字面量锁定 ⇒ 变异实测（64→65、16→8、200→201）**全绿零反馈**，而这些数字正是面向 UI 的 description（"clamps further to 200"）、协调者裁定 1 的往返预算与 R 项 13 真连判据（"`SCAN` ≤ 64"）的字面依据；同一轮里 `MAX_TYPE_SAMPLE_LIMIT = 5000` 反倒被字面量钉住（5001 即红）⇒ 属可修缺口而非普遍现象 | **已修复（复测通过 @ Tester 第 3 实例 `a6304a4fb`）** —— 本实例自行复跑四项数值变异：64→65 红 1、16→8 红 1、200→201 红 2、500→600 红 2，对照项 5000→5001 红 2 ⇒ 上轮 M8b/M8d/M8e 的"全绿零反馈"确已闭合，且红的是**字面量锁定用例**（不是碰巧被别的行为用例带红）。〔原状态 **待复测** 及其正文如下，照档保留〕（`286d917c4` + 收尾轮：修法 1 字面量锁定（64 / 16 / 200 各一条 `assert_eq!` + 两条守卫次序 + "最大窗口 10 轮可填满"标定）+ 修法 2 改为"description 由常量 `format!` 渲染"再叠一条字面量核对文案用例；修法 3 措辞已收窄；修法 4 遵守（未碰生产配置面）。**收尾轮复跑本条四项数值变异：64→65 / 16→8 / 200→201 / 500→600 全部由绿转红**（红条数 1 / 1 / 2 / 2），对照项 5000→5001 仍红 ⇒ Tester 复测只需复跑这四项） |

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

**修复备注（Coder 第 1 轮 · `346ebc979`）· 状态 → 待复测**
- 采纳修法 **(a)**，且把"感知拓扑"做成显式参数而非布尔：`connect.rs:112 RedisLiveConn::topology()` → `redis_driver.rs:31 with_live_op_topo!`（在 `select_db` 之前读一次，Sentinel 重连换连接不换变体，重试期间仍有效）→ `:99 plugin_on_db_topo!` → `:488 plugin_key_object_info`，op 签名收 `Topology`。既有 `with_live_op!` 改为委托该宏（`_topology` 丢弃），其余调用点零改动。
- `ops_workbench.rs:631 key_object_info` 走 `:476 issue_batch`：`Standalone | Sentinel` ⇒ 原一条 `pipeline_raw`；`Cluster` ⇒ `:464 sequential_raw` 把**同一条** `build_key_info_pipeline` 的 6 条命令逐条 `req_packed_command`（未另写命令集，槽位顺序与线形完全复用）。
- 降级语义两拓扑一致的关键在 `:442 single_command` + `:429 is_connection_level_failure`：服务端按项报错（`ResponseError` 等）折回 `RValue::Nil`，交给既有 `parse_key_info` 走与 pipeline 路径同一个"该项不可用"分支；连接级错误（Io / unrecoverable / `is_cluster_error` / CrossSlot / ClientError / InvalidClientConfig）整条上抛 ⇒ 掉线不会被读成"这个键没有属性"。
- **对 Tester"mock 把被测行为 mock 掉了"这一条方法论批评的正面回应**：新增 `ops_workbench/tests/cluster_topology.rs` 的 `ClusterFoldingConn`，用 redis **公开**的 `cluster_routing::get_slot` 复现分发层两件事 —— 批内任一项 `Value::ServerError` 即整批 `Err`（照抄 `extract_error_vec`，含把 `ServerError` 原样转成 `RedisError` 以保留服务端 detail）、批内出现第二个 slot 即 `Err(CrossSlot "Received crossed slots in pipeline")` 且**不发出**该批；单命令路径亦折叠。⇒ BUG-001/002 现在**进程内可证伪**：`a_cluster_batch_folds_the_freq_error_and_a_cross_key_batch_is_not_routable` 就是"旧批形态在 cluster 上必红"的前提用例，若有人把 `issue_batch` 改回统一 pipeline，这条与下面两条立刻红。
- 守住修复的用例：`cluster_key_object_info_degrades_per_field_over_six_singles`（`freq: null` + 其余四项有值 + `batches.is_empty()` + `total() == 6`）、`cluster_key_object_info_keeps_working_when_the_key_is_gone`（missing 分支同路径）、`a_transport_failure_on_the_single_command_path_aborts_the_probe`（连接级错误被吞成就红）、`sentinel_uses_the_single_node_batch_and_its_per_item_errors`（Sentinel 不得被误并进逐条路径）。
- **仍待真连**：R 项 9a（期望值已改写为"修复后应成功 + MONITOR 侧证 6 条单命令"）。mock 无法证伪 redis 分发层的重试/重定向细节，此项不得由单测替代。

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

**修复备注（Coder 第 1 轮 · `346ebc979`）· 状态 → 待复测**
- 修法建议 1（更正文档）：`progress.md`「契约偏离」第 6 条已**整条重写**为"cluster 分发层再折叠一次 + 单 slot 约束 ⇒ 本轨必须按拓扑分支"，并新增三条打〔修复第 1 轮新增〕标记的 Cluster 口径条（Cluster 往返成本：6 次往返 / Cluster 采样窗：钳到 200 / Cluster 分布不是普查：分片视图 `truncated` 恒真）；§范围 里"TYPE 一律 pipeline 批量、禁止逐键 RTT"与"一次 pipeline"两句原话也已就地加更正标记，避免 Wave 2 只读上半页就按旧口径写预算。
- 修法建议 2（实现侧与 BUG-001 同一处收口）：`ops_workbench.rs:557 sample_types` 的 Cluster 分支按键逐条 `TYPE`（**未**自行按 slot 预分组批发 —— 那要在驱动里复刻 `route_for_pipeline`，redis 0.27 未公开它，属把不变量搬到我们这边维护，收益只是省几次往返）；`:114 sample_window_for` 对 Cluster 再钳到 `:72 CLUSTER_TYPE_SAMPLE_LIMIT = 200`，`:599 type_distribution` 全程用它，`:611` 处按拓扑如实记录往返数（`type_round_trips` 日志字段）。
- `truncated` 口径（本条的 PRD §3.4 风险面）：Cluster 走 `:166 TypeDistribution::from_sharded_view` ⇒ 恒 `truncated: true`，只有"该分片本身为空（`sampled == 0 && dbsize == 0`）"才允许 `false`。理由：cluster 的 `DBSIZE`/`SCAN` 只覆盖被路由到的那一个分片，游标归零不等于全库扫完。**这是与修法建议 2 独立的加强**：不这么做，Cluster 上小库会显示成"精确分布"。
- 守住修复的用例：`cluster_type_distribution_types_keys_one_at_a_time`（5 键逐条、0 批、`Σcounts == sampled`、`truncated` 真）、`cluster_sample_window_is_bounded_because_every_key_costs_a_round_trip`（`sampleLimit = u64::MAX` ⇒ `sampled == 200` 且 `TYPE` 单发恰 200 次；standalone 同输入 ⇒ 500 键 1 批、0 单发）、`a_small_full_scan_is_a_census_on_a_single_node_but_not_on_a_cluster`（同一份 mock 回复，两拓扑的 `truncated` 相反）、`an_empty_cluster_shard_still_reports_an_empty_census`。
- 修法建议 3（Wave 2 侧）：错误形状与"chips 不渲染"仍归 Wave 2，本轨只保证 Cluster 上不再产生 `CrossSlot` 这一类错误。修法建议 4 已登记：`progress.md`「交回协调者」第 2 条 + R 项 9e。
- **仍待真连**：R 项 9b / 9b-补（期望值已改写为"成功 + `sampled ≤ 200` + `truncated: true`"）。

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

**修复备注（Coder 第 1 轮 · `346ebc979`）· 状态 → 待复测**
- 修法建议 1（已做）：`ops_workbench.rs:641` 在 `issue_batch` 之后校验 `values.len() != KEY_INFO_PIPELINE_LEN` ⇒ `tracing::warn!`（带 `key` / expected / replied，`:647`）+ 整条 `Err("key_object_info: expected 6 replies for 6 commands, got N")`（`:653-656`），不再按槽位猜测。采样侧（`sample_types:582`）保持可容忍：短回复只 `warn!` 并少计，因该路径按值逐个计数、`sampled == Σcounts` 不变式仍成立。
- 修法建议 2（已做，文档部分）：升级必查项已写进模块文档 `ops_workbench.rs:47-50`（"relies on `req_packed_commands` answering with exactly one reply per command, and `key_object_info` rejects a reply vector of any other length"）与 `progress.md`「留待 R 回归」项 15。**未**改 `Cargo.toml` 的 `redis = "0.27"` 为锁小版本 —— 本轨禁止碰 `Cargo.toml`（见任务书禁止事项），该裁定属依赖治理轨。
- 修法建议 3（未做，交协调者）：`send_packed_commands` 是 `MultiplexedConnection` 的固有方法，采纳即要求 `key_object_info` / `type_distribution` 不再对 `ConnectionLike` 泛型化 ⇒ 现有 12 + 14 条进程内 mock 用例全部失效，且与 BUG-001 的"同一批命令在两拓扑上共用解析器"设计冲突。已在 `progress.md`「交回协调者」登记。
- 守住修复的用例：`fix_round1::key_object_info_refuses_a_truncated_reply_vector_instead_of_guessing`（`ShortReplyConn { replies: 3 }` ⇒ 错误串同时含 `expected 6` 与 `got 3`；随后换一个喂满 6 条的 `ScriptedConn` 证明守卫只在条数不符时触发，正常读取不受影响）。Tester 原文给出的用例骨架已按"整条上抛"这一更强的修法落地，故断言从"warn 或未知态"收紧为"必须 Err"。

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

**修复备注（Coder 第 1 轮 · `346ebc979`）· 状态 → 待复测**
- 按建议原文落地：`type_reply_says_absent`（`ops_workbench.rs:296`，与骨架同形，多做了 `trim`）+ `parse_key_info`（`:346`）四态顺序改为 不可用 ⇒ 明确 absent ⇒ 可解析类型 ⇒ **其余一律第四态**（`unreadable_key_state()`，`:393`，进入前 `warn!` 打出原始 reply 形状）。
- `is_unusable_reply`（`:255`）的 `_ => false` **保留**，但其文档（`:246-254`）改写为实现真正承诺的事（"not unusable" ≠ "trusted"，并指向 `parse_key_info` 第四态）⇒ 原文所指"文档与实现相反"这一矛盾从两侧同时消除，且不改动 `parse_opt_int` / `parse_opt_string` 对容器的既有判定（`test_tester_unusable_reply_covers_the_container_shapes` 语义未动）。
- 守住修复的用例：`fix_round1::only_an_explicit_none_answers_that_the_key_is_absent`（8 判：`bulk("none")` / `SimpleString("none")` / `bulk(" NONE ")` / `bulk("")` 为真，`string` / 模块 token `ReJSON-RL` / 错误回复 / `Nil` 为假）+ `fix_round1::unrecognised_type_reply_is_unknown_state_and_not_an_expired_key`（`Okay` / `Double` / `Boolean` 三形状 ⇒ `!missing` 且整体 `== unreadable_key_state()`）。Tester 刻意未提交的那条 `RValue::Okay` 断言即按原文意图实现。
- 契约影响：无。判别三元组 `(missing, type, ttlMs)` 与 Wave 2 渲染口径不变（已过期 `(true, null, -2)` / 未知 `(false, null, -1)`），`progress.md`「契约偏离」第 2 条已加更正标记。

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

**修复备注（Coder 第 1 轮 · `346ebc979`）· 状态 → 待复测**
- 修法建议 1 + 2 **同时**落地（不是二选一）：`MAX_SCAN_ROUNDS = 64`（`ops_workbench.rs:88`，采纳建议里的"或常量 64"而非 `(limit / TYPE_SCAN_COUNT).max(1) + 16` —— 后者在 `limit = 5000` 时恰为 26，对"每 500 键一批却只回 1 个键"的稀疏库会误伤，而 64 = 10 轮理论值 × 6 余量）与 `MAX_STALLED_SCAN_ROUNDS = 16`（`:94`，连续 16 轮 `keys.len()` 无变化即判定游标卡住）；守卫在 `collect_sample`（`:536`）触发并 `warn!`（带 `rounds` / `stalled` / `cursor` / `limit`，`:537-543`）。
- 语义未新增契约字段：超限即停手，`sampled` 仍是"真实定类型的去重键数"，`truncated` 按既有 `sampled < dbsize`（Cluster 另按 `from_sharded_view`）自然为真 —— 与建议修法 1 的"语义自洽"要求一致。
- 修法建议 3 的用例已落地并按"恰 N 轮"收紧（不是建议里的 `<= 64` 弱断言）：`fix_round1::type_distribution_stops_at_the_round_cap_on_a_spinning_cursor`（游标恒为 7、每轮重复返回同一批 3 个键 ⇒ 对"原始批次计数"算进展、只有硬上界能结束；断言 `SCAN` 恰 64 轮且 `sampled == 3` 去重后诚实）与 `fix_round1::type_distribution_stops_when_the_cursor_stops_making_progress`（恒空批 ⇒ `SCAN` 恰 16 轮、`batches` 为空，即无进展守卫先生效）。
- **归属重申**：既有 `scan_keys`（`ops.rs:109-134`）的同形状未改（本轨禁止扩大 diff），它仍有 UI 侧 `scan_abort` 中断位；本条只闭合 `type_distribution` 这个无中断位的高频路径。
- **仍待真连**：R 项 13（判据已更新为"MONITOR 上 `SCAN` 条数 ≤ 64 且命令在有限时间内返回"）。

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

**修复备注（Coder 第 1 轮 · `346ebc979` + 收尾轮）· 状态 → 待复测（修法 3 交协调者）**
- 修法建议 1（已做，收尾轮补齐剩余两处口径）：`ops_workbench/tests.rs:459` 那条用例现在在函数开头写明"这是 **op** 直接调用，命令层另有 `with_live_op!` 每次必发的 `SELECT` ⇒ 真实 2 次往返，Sentinel 故障转移后整条重放"，断言文案改为 `"the op's own payload must cost exactly one pipeline round trip, excluding the db SELECT issued by with_live_op!"`（`:492-497`）；`key_object_info_reports_missing_over_the_wire` 里第二处裸 `round_trips() == 1`（`:516-518`）也加了同口径注释，避免只剩一个无定语的"1"。
- **面向 UI 的口径同样已改**（收尾轮）：`commands.rs:456` / `:469` 两条命令的 description 之前写 `"One pipeline of MEMORY USAGE / …"` 与 `"… with pipelined TYPE"`，在 Cluster 上不成立、在命令层也漏了 `SELECT` ⇒ 现改为"单节点一条 pipeline / Cluster 逐条 + 采样窗 200"，并显式写出"命令层每次调用多 1 次 `SELECT` ⇒ 一次调用 2 个往返"。仅动英文描述串与 `sampleLimit` 的 schema `description`，**字段名、类型、可空性、`required`、`maximum` 全未动**（`tests/workbench_commands.rs` 的 4 条契约用例逐字通过即是证据）。
- 修法建议 2（已做）：`progress.md`「留待 R 回归」项 4 的 MONITOR 核对表已含 `SELECT`（并区分 standalone/sentinel 与 Cluster 两张表），项 9a / 9b 由收尾轮补注"另有 1 次 `SELECT`（Sentinel 重连时整条重放）"，与项 4 对齐；「契约偏离」新增"Cluster 往返成本"一条。
- 建议补断言？**不需要，且已被更强的既有断言覆盖**：`test_tester_keys_is_issued_in_neither_shape_on_either_path` 用反向白名单 `allowed = {DBSIZE, SCAN, TYPE, MEMORY, OBJECT, PTTL}` 扫 `singles` **与** `batches` ⇒ `SELECT` 一旦被搬进 op 自身就会立刻变红。op 层不越界这一事实因此已是可证伪断言而非注释，收尾轮未重复添加。
- **修法建议 3 未做**：`select_db_on` 的 `current_db` 短路属全驱动行为变更（Tester 原文亦标"不建议在本轨顺手做"），已登记 `progress.md`「交回协调者」第 1 条。⇒ 本条的"命令级 2 次往返"仍是现状，Wave 2 的刷新/并发预算必须按 2 起步（Cluster 上 `key_object_info` 为 1 + 6 = 7）。

---

## redis-cmds-p0-BUG-007 · 中 · 修复轮写下的三条 Cluster 口径被 redis 自己的路由表证伪（成本被低估、`dbsize` 语义写反、测试替身比客户端更乐观）

**登记人 / 归属**：Tester 复测轮新登记（Bug 循环 2/5）。**这是修复轮引入的新 Bug**，不是首轮遗漏 —— 首轮裁定"cluster 路由不变"不成立时，redis 具体怎么路由并未被任何人问过一次；修复轮把新口径写成"Cluster = 1 SELECT + 6 单命令 = 7 次往返 / `dbsize` 只是被路由到的那一个分片 / 单分片视图"，这三句话都是**关于 redis 路由表的事实断言**，本回合用 redis 公开的 `cluster_routing::RoutingInfo::for_routable` 逐条问了一遍，**三条全不成立**。

**现象 / 量级**

1. **四条两词探测命令按"子命令 token"路由，不按键** ⇒ Cluster 上每次侧栏探测**必吃 `-MOVED` + 重发 + 全集群槽位刷新**。
   - redis 0.27.6 `cluster_routing.rs:503-507` 的兜底臂是 `_ => match r.arg_idx(1) { Some(key) => for_key(cmd, key), None => Random }`，`:510-514` 的 `for_key` 就是 `SpecificNode(get_route(is_readonly_cmd(cmd), key))`。它只对**自己表格里列出的**两词命令（`XGROUP *`、`XINFO *`、`PUBSUB *`、`SLOWLOG *`、`ACL *` …）取正确位置的键；`MEMORY USAGE` / `OBJECT ENCODING` / `OBJECT IDLETIME` / `OBJECT FREQ` **不在那张表里** ⇒ 传给 `get_route` 的"键"是 `arg_idx(1)`，即 `USAGE` / `ENCODING` / `IDLETIME` / `FREQ` 这四个字面量。
   - 于是这 4 条命令被投到 **`slot("USAGE")` 的主人**，而服务端会按真实键的 slot 拒绝 ⇒ 回 `-MOVED <真实 slot> <addr>`；`cluster_async/mod.rs:1052-1053` 的单命令路径随后走 `request.rs:212-220`：`MovedRedirect ⇒ (Retry::Immediately{request}, PollFlushAction::RebuildSlots)`，`:861-869` 立即重发（**+1 RTT/条**），`:1008-1012` 把连接切进 `Recover(RecoverSlots)`，而 `refresh_slots`（`mod.rs:394-412`）**持 `conn_lock` 写锁、对连接池里每个节点依次**发 `CLUSTER SLOTS`/`SHARDS` ⇒ 一次侧栏打开最坏触发 4 次重发 + 至多 4 次全集群槽位刷新，且刷新期间其余命令排队。
   - ⇒ `progress.md`「契约偏离 · Cluster 往返成本」与**协调者裁定 1 的硬口径"Cluster 下 `key_object_info` = 7 次"是下界而非期望值**：`TYPE`/`PTTL` 2 条按键正常，其余 4 条在多分片集群上按子命令 token 命中错误节点。Wave 2 若按"7 次"设自动刷新间隔，实际付出 9–11 次 RTT + 槽位刷新。
   - `commands.rs` 两条 description 现在宣传 "a call is two round trips"（收尾轮只把 "One pipeline" 改掉了，没覆盖 Cluster 分支），同属本条。
2. **Cluster 的 `DBSIZE` 是"所有主节点之和"，不是"该分片的数字"** —— 方向与文档写反。
   - `cluster_routing.rs:321-322` 把 `b"DBSIZE"` 归入 `ResponsePolicy::Aggregate(AggregateOp::Sum)`，`:366-387` 把它归入 `MultiNode(AllMasters, policy)` ⇒ `fetch_dbsize`（`ops_workbench.rs:491-500`，走 `query_async` ⇒ 同一张路由表）拿到的是**整个集群所有主节点的键数之和**（任一主节点失败则整条 `Err`，Sum 聚合无容错）。
   - 后果分两面：**(a) 无害面** —— `from_sharded_view` 恒置 `truncated: true` 因此**更保守**，不会把采样谎称普查，`sampled == Σcounts` 不变式不受影响 ⇒ 契约字段仍然可用。**(b) 有害面** —— UI 的"采样 N/M"里 M 被系统性放大（M = 全集群，N = 只来自若干随机分片的采样），比例失真；且 `progress.md`「Cluster 分布不是普查」条里"`M` 只是该分片的 DBSIZE"这句、`TypeDistribution::from_sharded_view` 的**命名与注释**都在传达一个正好相反的事实。R 项 9d 的判据"空分片 ⇒ `dbsize: 0` 且 `truncated: false`"在 ≥2 个非空分片的集群上**永不成立** ⇒ 会把正确实现判成回归。
3. **`SCAN` 在 cluster 没有路由 ⇒ 每轮可能落到不同分片，"分片视图"这个说法本身不成立。**
   - `cluster_routing.rs:478` 显式 `b"SCAN" | b"SHUTDOWN" | … => None`（同处还有 `// TODO - special handling - b"SCAN"`），而 `cluster_async/mod.rs:1052-1053` 对 `None` 的处理是 `unwrap_or(SingleNode(Random))` ⇒ `get_random_connection`（`:1156`）。
   - ⇒ `collect_sample`（`:522-523`）的游标是在**不同节点之间**传递的：某一轮随机命中已被扫完的分片即拿到 `cursor == 0` ⇒ 提前结束，`sampled` 可远小于窗口；整体是"随机多分片混合视图 + 混合游标"，不是"单分片视图"。`truncated` 恒真仍然正确（偏保守），故本条也是口径缺陷而非数据错误。
4. **测试替身在这一点上比真实客户端更乐观**：`ops_workbench/tests/cluster_topology.rs:21-33` 的 `slot_key_of` 用 `args_iter().last()` 当路由键 —— 对 `MEMORY USAGE <key>` 恰好等于"按键路由"，因此该替身**结构上不可能**发现第 1 点。这与首轮对"`ScriptedConn` 把被 mock 掉的正是被测行为"的批评是同一类方法论问题，在修复轮复发。

**复现（可粘贴，无需真连）**：Tester 已提交 4 条用例，全部**通过**，它们是上述事实的钉板与绊线（若 redis 将来修正路由，它们会红，提醒同时回收口径）：
`fix_round1_retest::test_tester_cluster_routing_ignores_the_key_for_two_word_probes`（同一命令换键 ⇒ 路由**不变**，证明按 token 走）、
`…cluster_routing_follows_the_key_for_keyed_probes`（控制臂：`TYPE`/`PTTL` 换键即换路由）、
`…dbsize_on_cluster_is_an_all_master_sum_not_a_shard_view`（`DBSIZE == MultiNode(AllMasters, Aggregate(Sum))`）、
`…scan_has_no_cluster_route_so_each_round_may_change_shard`（`SCAN ⇒ None`）。
真连复现：Cluster（≥2 主节点，键分散在不同 slot）上打开任意键的侧栏，在**目标键所在分片**上 `MONITOR` ⇒ 应看到 4 条命令先落到别的分片、再重发，以及 `CLUSTER SLOTS` 刷新。

**建议修法（择一或组合，勿由 Tester 代改）**
1. **必修（口径）**：更正 `progress.md`「契约偏离」三条 Cluster 新条 —— 「往返成本」写成"≥7，且 4 条按子命令 token 路由 ⇒ 必带 `-MOVED` 重发与槽位刷新，真连实测为准"；「分布不是普查」里 `dbsize` 改写成"全集群所有主节点之和（redis 的 `Aggregate(Sum)`）"；把"分片视图"改成"随机多分片混合视图"。同步 `commands.rs` 两条 description、`from_sharded_view` 的文档注释与（若愿意）改名、R 项 4 / 9a / 9b-补 / 9d 的 MONITOR 判据（9d 的"空分片"判据必须换成"整个集群为空"）。
2. **可选（实现）**：把 Cluster 分支从 `req_packed_command` 改为 **`ClusterConnection::route_command(cmd, RoutingInfo::SingleNode(SingleNodeRoutingInfo::SpecificNode((get_slot(key), SlotAddr::Master))))`**（`cluster_async/mod.rs:140` 是**公开** API，`get_slot`/`SlotAddr`/`RoutingInfo` 均从 `redis::cluster_routing` 公开导出 ⇒ 零新依赖，不破本轨禁令）。代价与本条第 4 点绑定：`route_command` 是 `ClusterConnection` 的固有方法，采纳即要求这两个 op 不再对 `ConnectionLike` 泛型化 —— 与 BUG-003 修法 3 **同一形态的冲突**（三个进程内替身需重写），故应作为设计裁定交协调者，不宜由 Coder 在修复轮内顺手改。
3. **必修（测试面）**：把 `slot_key_of` 从"最后一个参数"换成 redis 自己的 `RoutingInfo::for_routable`（公开 API，Tester 新用例已在用）⇒ 让"替身的路由假设"不再是自由变量。此项不做，第 1 点的 MONITOR 判据改完仍会被下一次回归悄悄绕过。
4. **若裁定"只改口径、不动实现"**：最低要求是给 `key_object_info` 的 Cluster 分支加一条 `tracing::debug!`（记录 4 条按 token 路由的命令名），否则真连时无法从日志区分"重发是 MOVED 造成"还是"网络抖动造成"。

**不算本条的部分（已核，避免夸大）**：`is_readonly_cmd`（`commands/mod.rs:40+`）确实把 `TYPE` / `PTTL` / `MEMORY USAGE` / `OBJECT *` 标为只读 ⇒ 路由目标是 `SlotAddr::ReplicaOptional`，但本驱动用 `ClusterClient::builder()` 且未调 `.params()`（`connect.rs:380-396`）⇒ `read_from_replicas` 取默认 `false`，`SlotAddrs::slot_addr`（`cluster_routing.rs:641-650`）在该配置下回落到 **primary/master** ⇒ 不存在"侧栏从从节点读到滞后数据"的额外风险，本条不主张它。另：本条三件事都**不影响**契约字段名/可空性/`sampled == Σcounts`/`truncated` 的自洽性 ⇒ Wave 2 已冻结的 TS 类型无需返工，受影响的只是预算与"采样 N/M"的 M 的含义。

**修复备注（Coder 第 3 轮 · 代码 `81cc58a90`，收尾轮补 1 条用例 · 状态 → 待复测）**

- **裁定 2 设的 `BLOCKED` 前置条件不成立 ⇒ 走"实现 + 口径 + 测试面"三条，不是"只改口径"**：本机 redis-0.27.6 里 `ClusterConnection::route_command`、`cluster_routing::get_slot`、`Route::new`、`SlotAddr` **全部 `pub`**（收尾轮独立复核，未采信前任自述）⇒ 新增**本 crate 局部** trait `SlotRoutedConnection::command_at_slot`（`ops_workbench.rs:471-495`，默认实现即"单节点上寻址是空话"，直接 `req_packed_command`），Cluster 实现体为 `route_command(cmd, master_route(slot))`（`:493`，`master_route:500-505`）；**三条探测通道**全部改按槽寻址 —— `key_object_info` 的 6 条（`issue_batch:605` → `routed_sequential:580` → `routed_single:571`，槽位 `get_slot(key)` 于 `:823`）、`sample_types` 的逐键 `TYPE`（`:743`）、`scan_round` 的每轮 `SCAN`（`:649`）。
- **建议修法 2 预告的"与三个替身正面冲突"用 trait 接缝绕开，代价已如实登记**：没有重写 `ScriptedConn` / `ShortReplyConn` / `ClusterFoldingConn` 的发送路径，而是让替身各自实现该 trait。收益 = diff 小、pipeline 分支一行不动；**代价 = production 那一行 `route_command` 在进程内不可证伪** —— 收尾轮变异 **M-addr**（把实现体改回 `req_packed_command`）**226 条全绿**。⇒ 本条复测重心从"跑单测"移交给 **R 项 9a 真连**（按分片看 MONITOR、`-MOVED` 计数必须为 **0**、任何分片都不得出现 `CLUSTER SLOTS` / `CLUSTER SHARDS`）；寻址**决策**与地址**形状**是真钉住的（M-scanaddress / M-callslot / M-typeslot 各红 **2 / 2 / 5** 条；M-slotaddr 即 `SlotAddr::Master → ReplicaOptional` **只有**收尾轮新增的 `the_address_we_build_names_exactly_the_master_of_the_given_slot` 会红）。
- **建议修法 3 已做**：替身的路由假设从 `args_iter().last()` 换成 redis 自己的 `RoutingInfo::for_routable`（`cluster_topology.rs:49 keyed_probe_slot` / `:75 table_route` / `:111 route_for_batch`），并加"寻址到错误分片也照样回 `-MOVED` 并记一次槽表刷新"的规则 ⇒ 替身不再比真实客户端乐观；`redis_table_routes_the_two_word_probes_to_a_shard_that_does_not_hold_the_key`（事实）、`an_unaddressed_two_word_probe_is_moved_and_rebuilds_the_slot_map`（不修的后果）、`addressing_a_probe_at_the_wrong_shard_is_refused_too`（新规则的绊线）三条钉板。
- **建议修法 1（口径）全部落地**：`progress.md`「契约偏离」三条 Cluster bullet 按事实重写（往返成本改为"1 SELECT + 6 条**已寻址**单命令 ⇒ 7 次，且不再有 MOVED/刷新项"、`dbsize` 明确"全集群所有主节点之和"、"分片视图"改为"**锚定单分片采样**"），面向 UI 的两条 description 与 `sampleLimit` description 改为**常量 `format!` 渲染**；R 项 4 的 MONITOR 表按分片重写、9a/9b/9b-补/9d 全部改写（**9d 的"空分片"判据按裁定 4 换成"整个集群为空"**）。
- **`SCAN` 定桩（裁定 3）**：`CLUSTER_SCAN_ANCHOR`（`:127`）+ `cluster_scan_anchor_slot()`（`:132`）⇒ 每轮同一分片同一游标空间（`every_cluster_scan_round_shares_one_shard_and_cursor_space`）；锚定分片为空时 `sampled = 0` 且命令**成功**属正常形态（已写进 R 项 9b/9d，避免误判回归）。
- **`DBSIZE` 有意不寻址（裁定 4）**：`fetch_dbsize:631` 仍走 `query_async` ⇒ 吃 redis 表里的 `MultiNode(AllMasters, Aggregate(Sum))`；`dbsize_is_left_to_the_clients_all_master_fan_out` 断言 `conn.addressed` 为空 + `slot_refreshes == 0`。`from_sharded_view` **已删除**，三拓扑统一 `TypeDistribution::from_sample:225` + `is_sample_truncated:191 = sampled < dbsize`（M-trunc 反转后红 **11** 条 ⇒ 该位不是装饰）。**"cluster 上 `truncated` 几乎恒真"这一结论按裁定 4 重判后不变，但理由换成"分子是单分片采样、分母是全集群求和"两个 scope 不同**，不再依赖"分片视图"这个已被证伪的说法。
- **状态**：代码与口径已闭合，但**真连 9a 未过之前不自行关闭** ⇒ 维持严重级"中"、状态 **已修复（进程内复测通过）· 真连挂 R 项 9a**（原 **待复测**）。

**复测备注（Tester 第 3 实例 · 2026-09-22 · 起始 HEAD `e8582e71f` · 代码 `a6304a4fb`）· 状态 → 已修复（进程内复测通过）**

- 复跑本条全部六项寻址变异：M-scanaddress 红 2、M-callslot 红 2、M-typeslot 红 5、M-slotaddr 红 1、M-dbsize-addressed 红 2、M-seq 红 2，与「Coder 修复记录（第 3 轮）」变异表**同向同数**；M-addr（Cluster 实现体退回 `req_packed_command`）**再次 226 全绿** ⇒ 负面事实成立。
- 覆盖率侧独立佐证（收尾轮没跑通的 profdata 手工导出）：`ops_workbench.rs` 里**整段 count=0 的函数体只有两处**，正是 `:473-479`（trait 默认实现）与 `:488-494`（Cluster 实现体）⇒ 与 M-addr 是同一件事，防线归 R 项 9a（Cluster 投递）与 9c（默认实现未被绕过）；除此之外**无新增未覆盖逻辑分支**。
- **本条新发现的测试面空档（已自行闭合，未另开 Bug）**：既有 cluster 用例**无一使用带 `{}` 标签的键**，而 BUG-007 的全部寻址都建在"`get_slot` 先 `get_hashtag` 再 CRC"这一行上 ⇒ 手工剥括号 / 整键 CRC 一类的标签失聪改动在旧套件下**226 全绿**（本实例反向对照实测）。已补 `test_tester_cluster_addressing_follows_the_hash_tag_not_the_whole_key` 与 `test_tester_a_hash_tagged_sample_is_typed_at_the_tag_slot` 各钉一处调用点，两个对应变异现**各红 1 条**（且只红这两条 ⇒ 独有证伪能力）。
- 排除项（登记以免重复怀疑）：`scan_round` 的非 cluster 分支直接委托 `crate::ops::scan_batch`，cluster 分支与它共用同一个宽松 `parse_scan_result` ⇒ **不存在**"两拓扑 SCAN 回复解析不对称"；`commands.rs` 文案里 "2 round trips" 的 `2` 是字面量但被 `the_ui_descriptions_still_promise_those_same_numbers` 一并核对 ⇒ 无漂移面，仅 nit。

**修复后新增的对外硬口径（Wave 2 必读）**：Cluster 下 `type_distribution` 的 `counts` 只描述**锚定分片**，`dbsize` 描述**整个集群** ⇒ "采样 N/M"的分子分母不同 scope，UI 文案必须显式带 Cluster 限定语；`truncated: false` 在 Cluster 上只在"整个集群为空/全被扫完"时才成立。

---

## redis-cmds-p0-BUG-008 · 低 · 三个预算常量无字面量锁定：改成什么测试都绿，而 200/64/16 正是对外口径的字面依据

**登记人 / 归属**：Tester 复测轮 · 第 2 实例，变异实测新登记（Bug 循环 2/5）。**这不是实现缺陷，而是本轨修复轮的回归守卫缺口**，与 BUG-007 建议修法 3 属同一方法论问题（"替身/断言把要守的东西自己声明了一遍"）的另一种形态。

**现象 / 量级**

`ops_workbench/tests/fix_round1.rs` 与 `ops_workbench/tests/cluster_topology.rs` 里，三个预算数字**只以常量自身出现**，因此"断言值"会跟着常量一起漂移：

```rust
// fix_round1.rs:92,105      → 期望值 = MAX_STALLED_SCAN_ROUNDS as usize
// fix_round1.rs:122,136     → 期望值 = MAX_SCAN_ROUNDS      as usize
// cluster_topology.rs:289,295,300 → 期望值 = CLUSTER_TYPE_SAMPLE_LIMIT
```

变异实测（每项跑完整 lib 套件，M0 基线 217 全绿）：

| 变异 | 期望 | 实测 |
| --- | --- | --- |
| `MAX_SCAN_ROUNDS` 64 → 65 | 若有字面量锁定则红 | **217 passed / 0 failed（全绿）** |
| `MAX_STALLED_SCAN_ROUNDS` 16 → 8 | 同上 | **全绿**（且这是**行为回归**：稀疏库会更早停止采样，`sampled` 变小，用户看到的分布无声变差） |
| `CLUSTER_TYPE_SAMPLE_LIMIT` 200 → 201 | 同上 | **全绿**（`commands.rs` 的 description 仍在宣传 "clamps further to **200**" ⇒ 对外文案与实际钳制值可以任意漂移而无人发现） |
| 对照：`MAX_TYPE_SAMPLE_LIMIT` 5000 → 5001 | — | **红**（`type_distribution_clamps_an_oversized_window_instead_of_erroring` 里有字面量 `assert_eq!(journal.batches.len(), 10)`）⇒ 证明"加一条字面量断言"确实能守住，本条可修 |

**为什么算 Bug 而不是"测试风格问题"**：这三处数字都在**对外承诺**里被逐字引用 ——
1. `commands.rs` 面向 UI 的 description 写了 "clamps further to 200"；
2. `progress.md`「契约偏离 · Cluster 采样窗」写 `CLUSTER_TYPE_SAMPLE_LIMIT = 200`，并据此给 Wave 2 出 `sampled ≤ 200` 的口径；
3. `progress.md`「留待 R 回归」项 13 的真连判据是"`SCAN` 条数 ≤ 64"，且该处明写"**单测已按'恰 16 / 恰 64 轮'钉死，不是'≤'式弱断言**" —— 这句**与实测不符**：单测钉的是"哪条守卫先生效"，不是"16 与 64 这两个数"。R 阶段若有人顺手把 64 调成 200，单测不会红，而 MONITOR 核对表会按 200 判"正常"，守卫强度实际退化为"有界"而非"有界且 ≤64"。

**复现（可粘贴，无需真连）**
```bash
export CARGO_TARGET_DIR=$PWD/target/cargo-wt-retest2
sed -i '' 's/pub const MAX_SCAN_ROUNDS: u32 = 64;/pub const MAX_SCAN_ROUNDS: u32 = 65;/' \
    packages/drivers/redis/src/ops_workbench.rs
cargo test -p datazen-driver-redis --lib -- --quiet   # ⇒ 217 passed / 0 failed
git checkout -- packages/drivers/redis/src/ops_workbench.rs
```
另两项同理（`16 → 8`、`200 → 201`），均全绿。

**建议修法（勿由 Tester 代改；三处合计约 4 行）**
1. 在既有断言**旁边**补字面量锁定（保留原断言，二者互补）：`assert_eq!(MAX_SCAN_ROUNDS, 64, "对外口径写在 R 项 13：MONITOR 上 SCAN ≤ 64")`、`assert_eq!(MAX_STALLED_SCAN_ROUNDS, 16, …)`、`assert_eq!(CLUSTER_TYPE_SAMPLE_LIMIT, 200, "commands.rs 的 description 与 Wave 2 预算都写死了 200")`。放在 `fix_round1.rs` / `cluster_topology.rs` 各自的用例内即可，不必新增文件。
2. 更进一步（可选，且与 BUG-007 建议修法 1 合并做最省）：把 description 与常量的一致性也钉成一条断言 —— 在 `tests/workbench_commands.rs` 里 `assert!(def.description.contains("200") == (CLUSTER_TYPE_SAMPLE_LIMIT == 200))` 这类形式不优雅，更好的是**从 description 里抽数字**或干脆在文档常量旁写 `// keep in sync with commands.rs description`。若裁定不做，至少修法 1 要做。
3. `progress.md` R 项 13 与「契约偏离 · Cluster 采样窗」两处措辞需同步收窄为"单测钉的是守卫身份，数字由本条修法 1 锁定"，避免 R 阶段照抄一句过强的话。
4. **不建议**为守这个数字而改生产码（例如把 64 挪进配置）—— 那会新增契约面，本轨禁止。

**严重级判据（低，不是中）**：不改任何今天的正确性 —— 契约字段、`truncated` 语义、`sampled == Σcounts` 不变式、两拓扑降级形状均不受影响（本回合契约冻结核查已逐字节确认）；风险面是"未来漂移不可见 + 文档口径与断言强度不符"，且修复成本是 3~4 行测试。

**修复备注（Coder 第 3 轮 · 代码 `286d917c4` + 收尾轮 · 状态 → 待复测）**

- **修法 1（字面量锁定）已做**：新增 `fix_round1::scan_budgets_are_the_numbers_the_docs_quoted` —— `MAX_SCAN_ROUNDS = 64` / `MAX_STALLED_SCAN_ROUNDS = 16` 各一条 `assert_eq!` 字面量，另钉**两条守卫的次序**（停滞守卫必须先于轮帽生效，否则 `MAX_STALLED >= MAX_SCAN` 会把它吞掉）与"最大窗口只需 10 轮即可填满"的标定关系（`MAX_TYPE_SAMPLE_LIMIT / TYPE_SCAN_COUNT == 10` ⇒ 轮帽 64 有 6 倍余量）；`cluster_topology::cluster_sample_window_is_bounded_because_every_key_costs_a_round_trip` 内补 `200` 字面量。**收尾轮复跑本条变异**：64→65 红 **1** 条、16→8 红 **1** 条、200→201 红 **2** 条 ⇒ 本条上表三行"全绿"全部转为有反馈（红因从"窗口先填满"变成"字面量不符"，M8c 的干扰已排除）。
- **修法 2（description ↔ 常量一致性）用了比"抽数字"更硬的形态**：`commands.rs` 的两条 description 与 `sampleLimit` 的 schema description 改为 `format!` **引用常量本身**渲染（`TYPE_PIPELINE_CHUNK` / `DEFAULT_TYPE_SAMPLE_LIMIT` / `MAX_TYPE_SAMPLE_LIMIT` / `CLUSTER_TYPE_SAMPLE_LIMIT` / `KEY_INFO_PIPELINE_LEN` 与 `+1`），漂移在源头即消失；再加 `fix_round1::the_ui_descriptions_still_promise_those_same_numbers` 用字面量核对渲染结果仍逐字承诺 `500` / `1000` / `5000` / `200` 与 `"2 round trips on a single node and 7 on Cluster"` ⇒ 任一边漂移都红（实测 `TYPE_PIPELINE_CHUNK` 500→600 红 **2** 条、对照项 `MAX_TYPE_SAMPLE_LIMIT` 5000→5001 红 **2** 条）。既有 `// keep in sync` 注释方案未被采纳，因为它是**劝告**而非断言。
- **修法 3（措辞收窄）已做**：`progress.md` R 项 13 与「契约偏离 · Cluster 采样窗」两条按"数字由字面量锁定、原用例钉的是守卫身份"改写，并注明 Cluster 侧 MONITOR 必须打在**锚定分片**上才数得到 `SCAN`。
- **修法 4（不为此改生产码）遵守**：未新增配置面、未动 `Cargo.toml`、未扩契约。
- **收尾轮补的一处回归**：前任在本文件写入的 `assert!(true)` 形态触发 clippy `assertions_on_constants`，使 `(lib test)` 诊断从基线 18 涨到 19 ⇒ 收尾轮改为先把两常量绑定为局部变量再断言，语义不变，诊断集回到基线（`(lib) 17` / `(lib test) 18 (17 dup)` / `driver-api (lib) 3` / 2 条 deny 均在 `ops_workbench*` 之外）。
- **状态 → 已修复（复测通过）**：本条为纯测试面缺口，Tester 只需复跑 `cargo test -p datazen-driver-redis --lib` 与上表四项数值变异（64→65、16→8、200→201、500→600）即可判定；四项**全部应由绿转红**，若仍绿则本条未闭合。

**复测备注（Tester 第 3 实例 · 2026-09-22 · 起始 HEAD `e8582e71f` · 代码 `a6304a4fb`）· 状态 → 已修复**

- 按本条自设的判据逐项执行：`cargo test -p datazen-driver-redis --lib` ⇒ **226 / 0 / 1 ignored**（与门禁表一致），四项变异实测 **64→65 红 1、16→8 红 1、200→201 红 2、500→600 红 2**，对照项 `MAX_TYPE_SAMPLE_LIMIT` 5000→5001 红 2 ⇒ **四项全部由绿转红**，本条闭合。
- 红的是哪条用例也核了：64/16 两项红 `fix_round1::scan_budgets_are_the_numbers_the_docs_quoted`（**字面量** `assert_eq!`，非行为副作用），200 与 500/5000 三项红 `the_ui_descriptions_still_promise_those_same_numbers` + 各自的行为用例 ⇒ 修法 1 与修法 2 各自按其设计的机制生效，不是"随便改什么都红"的假阳性。
- 本条不再需要测试面补强；R 项 13 的措辞（"钉死守卫身份"）经核对已是修法 3 收窄后的版本，无需再改。


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
4. **复测轮复述（Tester @ `c844b6804` + 本回合新增 7 条测试后）**：`cargo clippy -p datazen-driver-redis --all-targets` 诊断集与修复轮**逐行相同** —— `(lib) 17 warnings` + `(lib test) 18 warnings (17 duplicates)` + 2 条 deny `approx_constant`（`ops.rs:905:38`、`ops_exec.rs:260:57`，均在 `ops_workbench*` 之外，`git blame` 归因 `5afb0930` / `bf8f8bca`）+ `datazen-driver-api (lib) 3 warnings` ⇒ Tester 本回合的 7 条用例**零新增诊断**。`cargo fmt -p datazen-driver-redis -- --check` **exit 0**（workspace 级仍 exit 1，两处 diff 在 `src-tauri/`，见上）。
5. **非红但需登记的口径缺口（建议另立条目，不属本轨 diff）**：Cluster 连接下 `dbIndex > 0` 无法工作 —— `with_live_op_topo!` 每次无条件 `SELECT`，服务端在集群模式对非 0 库回 `SELECT is not allowed in cluster mode` ⇒ 本驱动两条 P0 命令在 Cluster + `dbIndex>0` 时必然 `QueryFailed`。属全驱动既有形态（首轮的 R 项 14 只覆盖"越界"，未覆盖"集群禁多库"），建议协调者并入 `redis-select-shortcircuit` 或另立 R 项。
6. **门禁复跑实测（Tester 复测轮 · 第 2 实例 @ HEAD `2c1f77134` + 工作区 7 条继承用例，独立目录 `target/cargo-wt-retest2`）**：`cargo test -p datazen-driver-redis` ⇒ **lib 217 passed / 0 failed / 1 ignored**（= Coder 自报的 210 + 上一任新增 7 条）+ **集成 4 passed / 0 failed** + doc-test 0；唯一 ignored 是 `connect.rs:1015` 的既有真连用例（`git grep "#\[ignore" HEAD -- packages/drivers/redis` **仅此一处**，与 `1e6b9cf4a` 时代的 `connect.rs:1002` 同一条，无新增静音）。`cargo fmt -p datazen-driver-redis -- --check` **exit 0**；workspace 级 `cargo fmt --all -- --check` **exit 1**，diff 只有 2 个文件且都在本轨之外（`src-tauri/src/commands/ai/integration_tests.rs:1244` 与 **gitignored codegen** `src-tauri/src/driver_init.rs:4,19`）⇒ 与既有登记一致，属基线/环境红。`cargo clippy -p datazen-driver-redis --all-targets` exit 101：`(lib) 17 warnings` + `(lib test) 18 warnings (17 duplicates)` + `datazen-driver-api (lib) 3 warnings` + **2 条 deny**，实测位置 `ops.rs:905:38`、`ops_exec.rs:260:57`（与基线逐字相同），`ops_workbench*` / `connect.rs` / `commands.rs` **零命中**（20 个命中点全部枚举核对）⇒ **不劣于基线，本轨与两轮补测零新增诊断**。`npx tsc --noEmit -p tsconfig.json` **exit 0**。`node scripts/check-driver-import-boundaries.mjs` **exit 0 · 1403 files · 0 blocking · 4 advisory · 2 allow-listed**（4 条 advisory 全在本轨未触碰的宿主文件）⇒ **边界护栏 0 blocking 保持**。未跑 `pnpm install` / `pnpm build` / `pnpm e2e`（任务书禁止项）。
