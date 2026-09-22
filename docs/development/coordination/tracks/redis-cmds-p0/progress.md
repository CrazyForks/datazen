# Track: redis-cmds-p0 — KV 上下文条与键属性侧栏所需的两条 P0 后端命令

- 分支: `feature/redis-cmds-p0`（基准 `feat/redis-workspace-ux` @ ae65ae375）
- 角色: Coder → Tester → **Coder（Bug 修复第 1 轮 + 收尾）** → **Tester（复测 · 第 1 实例中断 → 第 2 实例接手，已完成 · FAILED）** → **Coder（修复第 2 轮 = 台账所称"修复第 3 轮"· BUG-007 / BUG-008：第 1 实例落地两笔代码后被 turn 上限中断 → 收尾轮第 2 实例接手，已完成 · 待复测）** → Tester（复测第 2 轮，待派）
- 任务: 两条 P0 后端命令（`type_distribution` / `key_object_info`）
- 状态: MERGED（2026-09-22 · 第 3 轮复测 TEST_DONE）
- 编码 commit: `81cc58a90` + `286d917c4` + `a6304a4fb`
- 测试 commit: `77cec65c3`（Tester 第 3 轮裁定 + 门禁复跑台账）
- 合并 commit: `f3d396292`
- 代理: 无活跃子代理（Tester 第 3 轮已交付）
- 心跳: 2026-09-22 已合流至 `feat/redis-workspace-ux`
- Worktree: `.worktrees/datazen-redis-cmds-p0`
> 状态详情（历史）：**Bug 循环 2/5 的修复轮已落地**，代码 `81cc58a90` + `286d917c4` + 收尾轮，2026-09-22）—— 协调者第 3 轮裁定的两条新 Bug 全部按裁定施工：**BUG-007** —— Cluster 探测命令**按槽位显式寻址**（新增本地 trait `SlotRoutedConnection`，Cluster 实现体走 redis **公开**的 `ClusterConnection::route_command` + `cluster_routing::get_slot`，裁定 2 设的 `BLOCKED` 前置条件经源码核实**不成立**）、`SCAN` 采样**游标定桩**在 `CLUSTER_SCAN_ANCHOR` 的单一分片、`DBSIZE` **有意不寻址**（表里是 `MultiNode(AllMasters, Aggregate(Sum))` ⇒ `dbsize` 是全集群之和）、`truncated` 强制位按裁定 4 **整条重推后删除**（`from_sharded_view` 已移除，三拓扑共用 `from_sample`）、三条旧 Cluster 口径与面向 UI 的 description 全部按事实重写（description 数字现由常量 `format!` 渲染）；**BUG-008** —— `MAX_SCAN_ROUNDS = 64` / `MAX_STALLED_SCAN_ROUNDS = 16` / `CLUSTER_TYPE_SAMPLE_LIMIT = 200` 改用**字面量**钉住。**契约面零改动**（`TypeDistribution` / `KeyObjectInfo` 的**声明面**（属性行 + 字段声明行，剔除 doc 注释）与 `b1e1f4010` **逐字节相同** 209 B / 8 行 与 358 B / 12 行，md5 相等；结构体整块从 573 B 涨到 934 B，增量全是字段文档 ⇒ 不触契约，方法见「契约冻结核对」）。收尾轮（第 2 实例）实测：lib **226 passed / 0 failed / 1 ignored** + 集成 **4**、fmt `-p` exit 0、clippy **与基线逐字相同**、`tsc` exit 0、边界护栏 **0 blocking**；**独立变异复证 11 项**（BUG-008 四项 64→65 / 16→8 / 200→201 / 500→600 **全部由上一回合的全绿变红**；BUG-007 三条"寻址调用点"变异各使 2~5 条用例变红；`is_sample_truncated` 反转 11 条红），并修掉上一任遗留的 **1 条新增 clippy 诊断**（`fix_round1.rs` 的 `assert!(true)` 常量折叠）+ 补 **1 条** `master_route` 形状用例（`SlotAddr::Master → ReplicaOptional` 只有它会红）。**如实登记的边界**：production 里"`route_command` 而非 `req_packed_command`"这一行**进程内不可证伪**（三个替身各自实现该 trait），只能由 R 项 9a 真连 MONITOR 侧证，变异实测已证实这一点（M-addr 全绿）。上一阶段的 Tester FAILED 裁定**原样存档**于下方「Tester 复测轮 · 第 2 实例」一节，本轮只做增量与新节。
- 规格: `docs/todo/redis-workbench-ux/PRD.md` §3.4、§6（P0 两行）、§7、§8

## 背景

P0 把 Redis 顶部 48px 空带换成**全量 KV 上下文条**（PRD 裁定 8-2 = 全量），并把右上角的死按钮换成**键属性侧栏**（裁定 8-3 = M）。两者各自缺一条后端命令。本轨只补这两条命令 + 契约 + Rust 测试，**不写任何 UI**（UI 属 Wave 2）。

## 范围（两条命令，契约必须逐字对齐，Wave 2 直接按此消费）

### 1. `type_distribution`

- 入参：`{ dbIndex?: number, sampleLimit?: number }`（`sampleLimit` 默认 1000，硬上限 5000，超出即钳制且**不报错**）
- 返回：`{ counts: Record<String, u64>, sampled: u64, dbsize: u64, truncated: bool }`
- 语义：**游标采样**，绝不允许用 `KEYS`。复用既有 SCAN 原语 `packages/drivers/redis/src/ops.rs:86 scan_batch`；TYPE 一律 **pipeline 批量**取，禁止逐键 RTT。〔修复第 1 轮更正：此句只对 standalone / sentinel 成立。Cluster 的 pipeline 有单 slot 约束且分发层会再折叠一次错误，跨键 TYPE 批在 Cluster 上根本不可路由 ⇒ Cluster 改为逐键单命令 `TYPE`，并把采样窗压到 `CLUSTER_TYPE_SAMPLE_LIMIT = 200`；`KEYS` 禁令与 `sampled`/`truncated` 语义不变。见下方「契约偏离」的〔回复读取按拓扑分支〕条（本句更正的来源）与三条 Cluster 新口径〔往返成本〕〔采样窗〕〔分布不是普查〕。〕
- `truncated = sampled < dbsize`。**这个位是硬要求**：Wave 2 必须在 `truncated` 为真时显式渲染"采样 N/M"标注，否则采样分布会被读成精确分布（PRD §3.4 硬约束）。
- `dbsize` 走既有 DBSIZE 通道，一次动作内只取一次。
- 只读命令，不受 SafeMode 写门闸影响。

### 2. `key_object_info`

- 入参：`{ key: String, dbIndex?: number }`
- 返回：`{ missing: bool, type: Option<String>, memoryBytes: Option<u64>, encoding: Option<String>, idleSeconds: Option<u64>, freq: Option<u64>, ttlMs: i64 }`
- 语义：**一次 pipeline** 打 `MEMORY USAGE` + `OBJECT ENCODING` + `OBJECT IDLETIME` + `OBJECT FREQ` + `PTTL` + `TYPE`。〔修复第 1 轮更正：单节点仍是一次 pipeline；Cluster 改为**同一批 6 条命令逐条发出**（6 次往返），因为 cluster 分发层会对整批再做一次错误折叠，pipeline 形态在该拓扑上无法履行下面的"单项降级"。契约字段与取值不变。〕
- 降级要求（关键，别做成报错）：
  - 键不存在 ⇒ `missing: true` + 其余为 `None`，**返回成功而非 error**（侧栏要显示"键已过期"而不是红色错误）。
  - `OBJECT FREQ` 在 `maxmemory-policy` 非 LFU 时服务端会报错 ⇒ 单项降级为 `None`，不得让整条命令失败。
  - `MEMORY USAGE` 在 Redis < 4.0 报错 ⇒ 同上单项降级。
- 复用既有实现：`ops_observe.rs:188 memory_usage_key`、`redis_driver_on.rs:179 memory_usage_on`。权限沿用 `redis:allow-memory-sample`（与 `memory_usage_key` 同，见 `commands.rs:445-448`）。

## 已侦察落点（仅供参考，务必自行核实）

- `packages/drivers/redis/src/commands.rs:22-23`（已知命令名 match 臂）、`:44-45`（`DriverCommandDefinition` 构造 helper）、`:93`（`db_sizes` 定义样板）、`:438`（`memory_sample` 权限位）、`:445-448`（`memory_usage_key` 定义 + 权限样板）、`:466`（`slowlog_get`）
- `packages/drivers/redis/src/commands_exec_dispatch.rs`（dispatch 分臂，`noTtlOnly` 等参数解析形态在此）、`commands_exec_all_arms.rs`、`commands_exec_ops.rs`
- `packages/drivers/redis/src/ops.rs:86`（`scan_batch` SCAN 原语）、`ops_observe.rs:142,179-188`、`redis_driver_on.rs:78-80,179,303`
- `packages/drivers/redis/src/lib.rs`（若新建模块需在此声明）、`types.rs`（结果结构体落点，`types.rs:32` 是 `MEMORY USAGE` 字段的既有注释）
- 测试落点（AGENTS.md「驱动测试落点」硬规则）：同文件 `#[cfg(test)]` 或 `packages/drivers/redis/tests/`；**禁止**把测试加到 Host。

## 禁止事项（防跨轨冲突）

- **只碰 `packages/drivers/redis/src/**` 与该 crate 的 tests**。
- 不碰 `packages/drivers/redis/ui/**`、`locales/**`（Wave 2 / 其他轨范围）。
- 不碰 `src/**`（宿主）、`packages/driver-sdk/**`、`scripts/resolve-drivers.mjs`（`redis-host-slots` 轨范围）。
- 不改 `Cargo.toml` / `Cargo.lock`；不新增第三方 crate。
- 生产路径禁裸 `unwrap()`/`expect()`（`#[cfg(test)]` 除外）；错误一律 `CommandError`/`thiserror`，`tracing` 记日志。

## 验收标准

1. 两条命令在 `command_definitions()` 注册、在 `execute_command()` 可达，JSON Schema 与实际解析参数一致。
2. `cargo test -p datazen-driver-redis` 全绿；新增 Rust 测试至少覆盖：`sampleLimit` 钳制、`truncated` 真假两路、pipeline 批量（可用 mock/record 连接断言往返次数）、`key_object_info` 的 missing 分支、FREQ 单项失败不整体失败、MEMORY USAGE 不支持时单项降级。
3. `npx tsc --noEmit -p tsconfig.json` 不因本轨变红（本轨不应影响 TS）。
4. 新增/变更的 i18n 文案（若有）**只改 `locales/en.ts`**；预期本轨零文案改动。
5. 命令契约（字段名、可空性）与本文件逐字一致 —— Wave 2 会按此写类型，任何偏离须在下方「契约偏离」小节显式记录并说明理由。

## 契约偏离

**字段名与可空性：无偏离。** 两条命令的返回体逐字按上文定义落地（`counts/sampled/dbsize/truncated`；`missing/type/memoryBytes/encoding/idleSeconds/freq/ttlMs`），`dbsize` 保持全小写（`serde` 的 `rename_all = "camelCase"` 对无下划线词不生效，故不会被写成 `dbSize`），`type` 由 `#[serde(rename = "type")]` 显式改名。Wave 2 可直接按本文件写 TS 类型。

以下为**实现口径**（不改契约字段，但侧栏/上下文条渲染需要知道）：

- `sampleLimit` 传 `0` 与不传等价 ⇒ 回落默认 1000（规格只定义了"缺省=1000"，`0` 按"无意义窗口"处理而非"采样 0 个键"）。
- `key_object_info` 存在**第四种状态**：`TYPE` 本身报错（非 `none`）时返回 `missing: false` + `type: null` + 全部属性 `null` + `ttlMs: -1`，即"键状态未知、属性不可信"，既不谎称键已消失，也不给出半可信属性。侧栏应渲染为"读取失败/未知"空态，而不是过期态。〔修复第 1 轮加强（BUG-004）：进入第四态的路径被扩到**所有**"读不出类型"的形状 —— 只有 `TYPE` 明确回答 `none`/空串才算"键不存在"（`type_reply_says_absent`），`+OK` / double / bool / `BigNumber` 等既非可用值也非类型名的形状现在落第四态并 `warn!`，不再被静默读成"键已过期"。判别三元组 `(missing, type, ttlMs)` 与 Wave 2 渲染口径不变。〕
- `counts` 的 key 是服务端 `TYPE` 原样 token（含模块类型如 `ReJSON-RL`），未做白名单归一；UI 若只画 6 种内置类型，需要"其他类型"兜底桶。
- 采样窗口内 SCAN 结果会 `sort + dedup`（SCAN 允许跨游标重复返回同一键），因此 `sampled` 是去重后真实类型成功的键数，且恒等于 `counts` 各项之和（`truncated` 标注依赖此不变式）。
- `key_object_info` 未调用 `ops_observe.rs:188 memory_usage_key`（那会多一次独立 RTT），而是把 `MEMORY USAGE` 折进同一条 pipeline，以满足上文"一次 pipeline"；复用点落在权限位与定义样板。
- 回复读取按**拓扑分支**（本条原文写"cluster 路由不变"，经 Tester 首轮复测判定为**不实**并已就地更正，见 redis-cmds-p0-BUG-001 / BUG-002）：redis 0.27 的 `Pipeline::query_async` 末端会经 `Value::extract_error_vec`（`pipeline.rs:336-338`、`types.rs:533-537`），**首个单项错误即整批失败**，与"单项降级"要求直接冲突 ⇒ 改用 `ConnectionLike::req_packed_commands`（即 `query_async` 内部所调者，`offset=0 / count=len` 与 `execute_pipelined_async` 一致），只跳过末端那次解包。**这只在单节点上够用**：`MultiplexedConnection` 确实把 `Value::ServerError` 当**值**留在批里（`aio/multiplexed_connection.rs:196-235`）⇒ standalone / sentinel 单项降级成立；而 `ClusterConnection` 在 `req_packed_commands` 之后**又折叠一次**（`cluster_async/mod.rs:668-681` `try_pipeline_request` → `.and_then(Value::extract_error_vec)`），并对整条 pipeline 施加单 slot 路由（`cluster_async/mod.rs:1057-1067` → `cluster_async/routing.rs:71-105`，跨 slot 即 `ErrorKind::CrossSlot`）⇒ 在 Cluster 上"绕开一层却撞上另一层"。**修复后的口径（已落地）**：单节点继续一条 pipeline，Cluster 一律逐条 `req_packed_command`（cluster 单命令路径本就逐条路由、错误按项），两条 op 的降级语义在两拓扑上因此一致，只有往返成本不同 ⇒ 下面打了〔修复第 1 轮新增〕标记的条目（Cluster 往返成本 / Cluster 采样窗 / Cluster 分布不是普查 / 单命令路径的错误分类 / 回复条数兜底 / SCAN 有界 / 测试替身）为 Wave 2 必须知道的新口径，**其中的 Cluster 三条在修复第 3 轮被按 redis 路由表事实整条重写，并新增两条〔修复第 3 轮新增〕（按槽显式寻址 / 采样游标定桩）**。**〔Tester 首轮裁定原文（按原样保留为存档）：本条前半段成立（绕开 `query_async` 有实据），末句"cluster 路由不变"不成立且会误导 Wave 2 —— cluster 分发层自己再做一次错误折叠、并对 pipeline 施加单 slot 约束，见 `bugs.md` redis-cmds-p0-BUG-001 / BUG-002；修复时必须一并更正本条。〕** ⇒ 收尾轮据此把正文中"线路字节、传输与 cluster 路由不变"这句**删除**，替换为上面这段"单节点够用 / Cluster 必须逐条"的真实口径；线路字节层面 `req_packed_commands` 与 `query_async` 仍等价（同一条 pipeline 序列化），变化的只有 cluster 分发层的**路由与折叠**语义。
- 〔修复第 1 轮新增 · **修复第 3 轮（BUG-007）按事实重写** · Cluster 往返成本〕`key_object_info` 在 Cluster 上是 **6 次单命令往返**（非 standalone 的 1 次 pipeline），命令层再 +1 次 `SELECT` ⇒ **命令级 7 次往返**；Sentinel 与 standalone 同型（1 次 pipeline、命令级 2 次）。**这 7 次的性质在 BUG-007 后变了**：修复轮原文只说"6 次单命令"，漏了那 6 条**未被寻址** ⇒ 每条真实成本是 `-MOVED` + 全集群 `CLUSTER SLOTS` 重取 + 重发（见下条）；现在 6 条全部**按槽位显式投到持有该键的分片主节点**，故 7 就是 7 —— 零 `-MOVED`、零槽表刷新、零重发。Wave 2 的刷新/并发预算不得再按"侧栏恒 1 次往返"估算（原 BUG-006 的口径纠偏同向）。
- 〔修复第 3 轮新增 · Cluster 探测命令按槽显式寻址，对应 BUG-007〕redis 0.27.6 的路由表里**没有** `MEMORY USAGE` / `OBJECT ENCODING|IDLETIME|FREQ` 这几条两词命令的臂 ⇒ 兜底臂 `_ => r.arg_idx(1)`（`cluster_routing.rs:503-507`）会把**子命令名**（`USAGE` / `ENCODING` / …）当键算槽，于是每条探测命令的路由都落在"不持该键的分片"上：服务端回 `-MOVED <slot> <addr>`，客户端按 `MovedRedirect ⇒ Retry::Immediately + PollFlushAction::RebuildSlots`（`cluster_async/request.rs:212-220`）先重取整张槽表再重发，而 `refresh_slots` **首行**就取 `conn_lock.write()`（`cluster_async/mod.rs:394-395`）⇒ 上下文条每次自动刷新抢一次**全局写锁**。修复不是"容忍这条开销"，而是**让命令不再走到那条兜底臂**：新增本地 trait `SlotRoutedConnection`（`ops_workbench.rs:471`），Cluster 实现体把命令交给 redis **公开**的 `ClusterConnection::route_command(cmd, Route::new(slot, SlotAddr::Master))`（`cluster_async/mod.rs:140`），槽位由同样公开的 `cluster_routing::get_slot` 从**真正的键**算出（`routed_single` `:571` / `routed_sequential` `:580` / `issue_batch` `:605`）；`MultiplexedConnection` 走默认实现（单节点上"寻址"是空话，仍委托 `req_packed_command`）。⇒ 两个 op 的函数签名与泛型约束不变，`Topology` 仍只决定"批形态 vs 逐条 + 是否寻址"。协调者裁定的 `BLOCKED` 前置条件（"没有公开的按节点发送通道"）**经源码核实不成立**，故未退化为"逐条发 + 容忍 MOVED 风暴"。
- 〔修复第 3 轮新增 · Cluster 采样游标定桩在单一分片，对应 BUG-007 裁定 3〕`SCAN` 在路由表里是 `None`（`cluster_routing.rs:477-478`，源码带 `// TODO - special handling`）⇒ `req_packed_command` 会 `unwrap_or(SingleNode(Random))`（`cluster_async/mod.rs:1051-1055`），**每一轮都可能被投到不同分片**，游标空间因此不连续。修复：cluster 的采样轮改为 `command_at_slot(SCAN <cursor> COUNT 500, cluster_scan_anchor_slot())`（`scan_round` `ops_workbench.rs:649`），锚点是常量哨兵键 `CLUSTER_SCAN_ANCHOR`（`:127`）算出的**固定槽** ⇒ 整次采样共享一个分片与一个游标空间，`cursor == 0` 才真的意味着"该分片扫完"。该锚定路径**任何错误都直接上抛**，不折成"游标 0 + 空批"（`-ERR invalid cursor` 若被折成 `Nil` 会被读成"扫完了"，属数据正确性陷阱）。
- 〔修复第 1 轮新增 · Cluster 采样窗〕`type_distribution` 的采样窗是拓扑感知：`sample_window_for(requested, topology)`（`ops_workbench.rs:173`）在既有 1000 默认 / 5000 硬上限之上，对 Cluster 再钳到 `CLUSTER_TYPE_SAMPLE_LIMIT = 200`（`ops_workbench.rs:115`）—— 因为在 Cluster 上"给一个键定类型"就是一次往返（BUG-007 后这次往返不再叠加 `-MOVED`，但仍是一次完整的 RTT，且 `sampled` 个键可能落在不同分片 ⇒ 无法合批）。契约字段、语义与"钳制不报错"全部不变，只是 Cluster 上 `sampled ≤ 200`。
- 〔修复第 1 轮新增 · **修复第 3 轮（BUG-007 裁定 4）整条重推** · Cluster 分布不是普查〕**旧结论作废**：修复轮写的是"cluster 的 `DBSIZE`/`SCAN` 只覆盖被路由到的那一个分片 ⇒ 需要一个专门的 `from_sharded_view` 构造器把 `truncated` **恒置真**"。两个前提都错：`DBSIZE` 在 redis 0.27.6 路由表里是 `MultiNode(AllMasters, Aggregate(Sum))`（`cluster_routing.rs:361-387` 选 `AllMasters` + `:321-322` 给 `Aggregate(Sum)`）⇒ 它是**整个集群所有主节点键数之和**，不是"被连分片的数字"；`SCAN` 则被钉在单一分片（见上条）。**重推后的口径**：`sampled` = 锚定分片里被真实定类型的键数（≤ 该分片键数），`dbsize` = 全集群键数，`truncated = sampled < dbsize`（`TypeDistribution::from_sample`，`ops_workbench.rs:225`；`from_sharded_view` 已**删除**，三拓扑共用这一个构造器）。强制位**不再需要**且**不成立**：`sampled ≤ |锚定分片| ≤ dbsize`，等号只在 `dbsize == 0`（整个集群为空）时成立 —— 那时 `sampled` 也为 0，`counts` 为空对象，"空集群的精确分布就是空分布"，说 `false` 才是诚实的；反之只要集群里有任何一个键，`sampled < dbsize` 自动为真 ⇒ **不存在"把单分片扫描读成全集群普查"的路径**。守卫也因此从"恒真"换成**双向**钉死（见 R 项 9b-补）。**Wave 2 必读**：Cluster 上"采样 N/M"里的 `M` 是**整个集群**的键数、`N` 只是**一个分片**的采样数 ⇒ 二者之比天然偏小，这是"采样"的本义而非缺陷；想给用户"这个分片有多少键"需要另立命令（本轨契约未扩）。
- 〔修复第 1 轮新增 · **修复第 3 轮改名** · 单命令路径的错误分类〕原 `single_command` 现为 `routed_single`（`ops_workbench.rs:571`）/ `routed_sequential`（`:580`）+ 折叠函数 `fold_command_answer`（`:552`），分流判据 `is_connection_level_failure`（`:538`）未变（Io / unrecoverable / `is_cluster_error`（Moved/Ask/TryAgain/ClusterDown）/ CrossSlot / ClientError / InvalidClientConfig）：**连接级** ⇒ 整条 `Err` 上抛（掉线不能被读成"这个键没有属性"）；**服务端按项报错** ⇒ 折回 `RValue::Nil` 交给既有解析器降级，与 pipeline 路径逐字段一致。**注意折叠层与路由无关**：redis 的 `try_cmd_request` 对**已寻址**与**未寻址**的单命令同样 `.and_then(|v| v.extract_error())`（`cluster_async/mod.rs:633-655`）⇒ 寻址只消灭 `-MOVED` 风暴，不改变"服务端拒绝单字段"的降级形状（`freq: null` 等断言逐字未动）。
- 〔修复第 1 轮新增 · 回复条数兜底，对应 BUG-003〕`key_object_info` 现在拒绝"回复条数 ≠ `KEY_INFO_PIPELINE_LEN`"：`tracing::warn!`（带 expected/replied）+ `Err("key_object_info: expected 6 replies for 6 commands, got N")`（`ops_workbench.rs:824-838`）。`req_packed_commands` 是 `#[doc(hidden)]` 内部 API，redis 小版本漂移导致排布变化时必须**大声失败**，而不是把侧栏静默读成"全空/未知"。采样侧（`sample_types`）保持可容忍：短回复只 `warn!` 并少计，因该路径本就按值逐个计数。
- 〔修复第 1 轮新增 · SCAN 有界，对应 BUG-005〕`collect_sample`（`ops_workbench.rs:679`）新增两个守卫并在触发时 `warn!`：`MAX_SCAN_ROUNDS = 64`（硬轮次上界；最大窗口只需 10 轮，余量给稀疏库）与 `MAX_STALLED_SCAN_ROUNDS = 16`（连续 16 轮零新增键即判定游标卡住）。超限即停止采样、按既有语义置 `truncated`，`sampled` 恒等于真实定类型键数 ⇒ 坏游标代理不再能永久占住 `with_live_op!` 的 `connections.write()` 写锁。
- 〔修复第 1 轮新增 · **修复第 3 轮（BUG-007）加厚** · 测试替身〕`ops_workbench/tests/cluster_topology.rs` 的 `ClusterFoldingConn` 用 redis 公开的 `cluster_routing::get_slot` 忠实复现分发层的两次折叠与单 slot 路由（含 `err_reply` 走 `Value::ServerError` 的真路径），使 BUG-001 / BUG-002 在**进程内**即可证伪；`ScriptedConn` 的"每命令恒回一条"不再被当成 cluster 行为的替身。真连 R 项 9a/9b 仍保留。**BUG-007 后新增的部分**：替身现在把**分发层的路由决策**也建成事实（`table_route` 直接调 `RoutingInfo::for_routable`，`keyed_probe_slot` 从**真实键**算槽作为服务端判据，`route_for_batch` 复刻 `route_for_pipeline`（`cluster_async/routing.rs:71-105`）的"取首个具体路由 + 跨 slot 即 `CrossSlot`"），投递规则是"客户端寻址的槽 ≠ 持有该键的槽 ⇒ `-MOVED` 并让 `slot_refreshes += 1`；`SCAN` 未指定槽 ⇒ `unpinned_rounds += 1`"，另加"**寻址到错误分片也照样拒**"一条（⇒ 把全部探测钉在一个方便但错误的槽上**不能**蒙过用例）。⇒ 双向可证伪：改回未寻址会红（MOVED 计数），寻址但算错槽也会红。三替身（`ScriptedConn` / `ShortReplyConn` / `ClusterFoldingConn`）现各以一行 `impl SlotRoutedConnection` 接入生产 trait（前两个取默认实现 = 单节点上寻址为空话）。
- 〔修复第 3 轮新增 · 面向 UI 的 description 数字改由**常量渲染**〕`commands.rs` 两条命令的 description 与 `sampleLimit` 的 schema description 不再手抄数字，而是 `format!` 引用 `TYPE_PIPELINE_CHUNK` / `DEFAULT_TYPE_SAMPLE_LIMIT` / `MAX_TYPE_SAMPLE_LIMIT` / `CLUSTER_TYPE_SAMPLE_LIMIT` / `KEY_INFO_PIPELINE_LEN`（`+1` 即"1 SELECT + 6"的 7）⇒ 改常量时文案自动跟随，"文案与实现漂移"这一类缺陷从线形上消失。副作用是文案不再是自由字符串，故 BUG-008 的锁定改挂在对侧：`fix_round1::the_ui_descriptions_still_promise_those_same_numbers` 用**字面量**核对文案仍逐字承诺 `500` / `1000` / `5000` / `200` 与 `"2 round trips on a single node and 7 on Cluster"` ⇒ 值与文案任一边漂移都会红（变异实测：`TYPE_PIPELINE_CHUNK` 500→600 与 `CLUSTER_TYPE_SAMPLE_LIMIT` 200→201 各使该用例变红）。**仍只动描述字符串**，`input_schema` 属性名 / `required` / `"type": "integer"` / `"minimum": 0` / `maximum`（仍不存在）/ `permissions` / `output_schema` / 返回体字段名与可空性零改动。
- 〔收尾轮 · `c844b6804` · 命令描述文本（非契约字段）〕`commands.rs` 里两条命令的 `description` 与 `sampleLimit` 的 schema `description` 按新口径改写：原文对 UI 宣传 "One pipeline of MEMORY USAGE / …" 与 "… with pipelined TYPE"，在 Cluster 上不成立（已逐条发出）且漏了命令层的 `SELECT`。**改动仅限英文描述字符串**：`input_schema` 的属性名 / `required` / `type` / `minimum` / `maximum`（仍不写 `maximum`，保持"钳制不报错"）与返回体字段名、可空性**零改动**，`tests/workbench_commands.rs` 的 4 条契约用例逐字通过。**本回合未新增任何可选字段** ⇒ 契约冻结面（Wave 2 已按本节写好的 TS 类型）无需返工。
- 权限位：`key_object_info` = `redis:allow-memory-sample`（按本文件要求）；`type_distribution` = `redis:allow-info`（本文件未指定，与同为库级观测的 `scan_keys`/`db_sizes`/`list_children` 对齐）。两者均派生为 `CommandAccessLevel::Read`、`CommandCategory::Observe`，不受 SafeMode 写门闸影响（已有断言测试锁定）。

## 自验记录

Worktree：`/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-cmds-p0`（分支 `feature/redis-cmds-p0`，基准 `ae65ae375`）
独立构建目录（gitignored，`.gitignore:13 /target` 覆盖）：`CARGO_TARGET_DIR=/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-cmds-p0/target/cargo-wt`

1. `CARGO_TARGET_DIR=$PWD/target/cargo-wt cargo test -p datazen-driver-redis` ⇒ **188 passed / 0 failed / 1 ignored**
   - lib 单测：`184 passed; 0 failed; 1 ignored`（其中本轨新增 `ops_workbench::tests` **24** 项，基线 160 项）
   - 新增集成测试 `packages/drivers/redis/tests/workbench_commands.rs`：**4 passed / 0 failed**
   - 文档测试：0 项
   - 验收标准 2 的六项场景逐条对应：`sampleLimit` 钳制 → `sample_limit_defaults_and_clamps_without_erroring` + `type_distribution_clamps_an_oversized_window_instead_of_erroring`；`truncated` 真假两路 → `truncated_flag_is_the_sample_vs_census_bit` + `type_distribution_flags_truncated_when_the_sample_is_partial`（真）+ `type_distribution_counts_a_fully_scanned_small_db` / `type_distribution_on_an_empty_db_is_not_truncated`（假）；pipeline 批量往返次数 → `ScriptedConn`（record 型 `ConnectionLike`）journal 断言：`key_object_info_uses_one_round_trip_and_survives_a_rejected_field`（恰 1 次往返、0 单发）〔**口径更正 · BUG-006**：此处的"恰 1 次"只指 **op 自身**的一条 pipeline，命令级真实成本是 `SELECT` + 1 = **2 次往返**（Cluster 上 1 + 6 = 7），断言文案与注释已按此收窄，见「契约偏离」"Cluster 往返成本"条〕；`type_distribution_pipelines_types_in_chunks_and_never_calls_keys`（`ceil(n/500)` 批 + 无 `KEYS` + 无逐键 `TYPE`）、DBSIZE 每动作恰 1 次；`missing` 分支 → `key_info_reports_missing_as_success` + `key_object_info_reports_missing_over_the_wire`；FREQ 单项失败不整体失败 → `key_info_degrades_freq_and_memory_independently`；MEMORY USAGE 不支持单项降级 → 同上 + `rejected_*_aborts_*`（区分"服务端拒绝单字段"与"整条命令失败"）。
2. `npx tsc --noEmit -p tsconfig.json` ⇒ **exit 0，0 错误**（本轨零 TS/零文案改动，未跑 `pnpm install`）
3. `node scripts/check-driver-import-boundaries.mjs` ⇒ **exit 0，0 blocking**（`1403 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s) · 2 allow-listed reference(s) skipped`）；4 条 R3 advisory 全为本轨未触碰的既有宿主→driver internals 引用（`src/locales/locales.test.ts`、`src/test/driverUiSetup.ts` ×2、`src/windows/connection/DocumentConnectionView.tsx`）。注：worktree 缺 gitignored 的外部 git 驱动，属已知盲区，本轨只保证**无新增** blocking。
4. 附加（AGENTS.md §5.1）：`cargo fmt -p datazen-driver-redis -- --check` ⇒ 无 diff。`cargo clippy -p datazen-driver-redis --all-targets` ⇒ 2 error + 17 warning，**全部落在本轨未修改的文件**（deny 级 `approx_constant`：`ops.rs:905`、`ops_exec.rs:260`；其余在 `redis_driver*.rs`/`ops_value_search.rs`/`ops_io.rs`/`decode/pickle.rs` 等），`ops_workbench*` 与新增 dispatch/definition 代码零命中 —— 属基线问题，未在本轨顺手改动以免污染 diff。

## Tester 复测记录（首轮 · 2026-09-22 · commit `b1e1f4010` · 结论 **FAILED**）

Tester 全新实例，工作目录 `/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-cmds-p0`（`feature/redis-cmds-p0`，起始 `git status --porcelain` 干净，基准 `ae65ae375`）。独立构建目录 `CARGO_TARGET_DIR=$PWD/target/cargo-wt-test`（与 Coder 的 `target/cargo-wt` 分开以免争锁，`/target` 已 gitignored）。**只测不修**：生产码零改动，仅向 `ops_workbench/tests.rs` 追加用例。

### 阶段 A · 逐行审查（`ops_workbench.rs` 418 行 + `ops_workbench/tests.rs` 777 行 + `tests/workbench_commands.rs` 134 行）

1. **本轨最大风险：绕开 `Pipeline::query_async` 改用 `ConnectionLike::req_packed_commands` 的独立判定。**
   - Coder 的前提**成立**（非臆造偏离）：`Pipeline::query_async` 末端确实经 `Value::extract_error_vec`（`redis-0.27.6/src/pipeline.rs:336-338`、`types.rs:533-537`），首个单项错误即整批 `Err`，与任务书"单项降级（关键，别做成报错）"直接冲突。
   - 但**只解决了一半**：standalone / sentinel（`MultiplexedConnection`）的 pipeline 缓冲确实把 `Value::ServerError` 当**值**留在数组里（`aio/multiplexed_connection.rs:196-235`，`first_err` 仅由传输级 `Err` 或事务置位）⇒ 单项降级成立；且 Coder 确实构造了"1 项报错、其余取值"的真实用例（`key_object_info_uses_one_round_trip_and_survives_a_rejected_field`），不是自证循环。Tester 另补 PTTL 单槽位报错、TYPE 单槽位报错两臂。
   - **Cluster 不成立**：`cluster_async/mod.rs:668-681`（`try_pipeline_request`）在 `req_packed_commands` 之后**又做一次** `.and_then(Value::extract_error_vec)` ⇒ 绕开 pipeline 层却撞上分发层同款折叠。默认 `maxmemory-policy noeviction` 下 `OBJECT FREQ` 服务端必报错 ⇒ **Cluster 连接上 `key_object_info` 必然整条失败**（本驱动 Cluster 分支实证：`connect.rs:93-99`、`redis_driver.rs:24-48`、`connect.rs:820-828`）⇒ **BUG-001（高）**。
   - `type_distribution` 的 500 键 TYPE 批在 cluster 还另有单 slot 约束（`cluster_async/mod.rs:1057-1067` → `cluster_async/routing.rs:71-105`，`:95` ⇒ `ErrorKind::CrossSlot`）。该故障类别**本仓已有先例**（`ops_tree.rs:148-156` 的 `list_children` 亦用跨键 pipeline），故不整体归罪本轨；但本轨把它搬到"每次切 db / 每次刷新"的上下文条路径，并写下"cluster 路由不变"的错误结论 ⇒ **BUG-002（中）**。
   - 修法建议（三案：拓扑分支 / `execute_pipelined_async` + 失败重试 / 显式声明 Cluster 不支持）已写进 `bugs.md`，**Tester 未改码**。
   - **mock 是否把被测行为 mock 掉：是。** `ScriptedConn`（tests.rs:192-215）自行实现 `req_packed_commands`，等于把"错误折叠发生在哪一层"这一被审查对象替掉；任何进程内测试都无法触达 redis 的 cluster 分发层 ⇒ BUG-001/002 只能真连证伪，已加强 R 项 9。
2. **`KEYS` 禁令**：生产路径零 `KEYS`（两条新命令不走 `ops_exec.rs:9-51` 危险分类器，该处仍把 `KEYS` 列为 ultra-danger 未动）；采样侧确用 `ops.rs:86 scan_batch` 游标循环（`collect_sample`）。**但** Coder 原有两条 KEYS 断言只扫 `journal.single_names()`（单发路径），"把 `KEYS` 塞进 pipeline 批"这种形态测不到 ⇒ Tester 补 `test_tester_keys_is_issued_in_neither_shape_on_either_path`：同时扫 `singles` + `batches`，并反向白名单断言"发出的命令名 ⊆ {DBSIZE, SCAN, TYPE, MEMORY, OBJECT, PTTL}"，未来加任何新命令名都会红 ⇒ 防回归能力已补齐。
3. **7 条「契约偏离」逐条裁定**：

   | # | 偏离条目 | 裁定 | 依据 |
   | --- | --- | --- | --- |
   | 1 | `sampleLimit=0` 回落 1000 而非报错 | **合理澄清** | 规格只定义"缺省=1000"；`sample_limit_defaults_and_clamps_without_erroring` + Tester `test_tester_sample_window_is_clamped_to_the_limit_not_the_batch` |
   | 2 | `key_object_info` 第四态（TYPE 报错 ⇒ 未知） | **合理澄清，Wave 2 可判别 ⇒ 不记 Bug** | 契约无独立状态位，但 `(missing, type, ttlMs)` 三元组唯一区分：已过期 `(true, null, -2)` vs 未知 `(false, null, -1)`；Tester 已用 `test_tester_expired_and_unknown_key_states_are_distinguishable` 钉死，另由 `test_tester_key_object_info_json_shape_is_the_wave2_contract` 锁线形 |
   | 3 | `counts` 键为服务端原样 token（含模块类型） | **合理澄清** | 归一会丢信息；Tester 补 `test_tester_module_type_tokens_survive_the_whole_command`（`ReJSON-RL` 全链路 + 作为 JSON object key 合法）；UI 兜底桶属 Wave 2 责任 |
   | 4 | 采样窗口 sort+dedup、`sampled == Σcounts` | **合理澄清** | SCAN 允许跨游标重复返回；`type_distribution_deduplicates_repeated_scan_results` 已证，`truncated` 标注依赖此不变式 |
   | 5 | 未复用 `ops_observe.rs:188 memory_usage_key` | **合理澄清** | 复用会多一次独立 RTT，与"一次 pipeline"冲突；复用点落在权限位与定义样板 |
   | 6 | 改用 `req_packed_commands` | **实质偏离契约** | 理由成立，但"cluster 路由不变"结论错误 ⇒ BUG-001/002/003，文档必须更正（已在上文「契约偏离」条内就地标注） |
   | 7 | `type_distribution` 权限位 `redis:allow-info` | **合理澄清，家族一致** | 与 `scan_keys`/`db_sizes`/`list_children`/`get_key`/`get_key_raw`/`scan_values`/`scan_abort`/`decode_value` 同位；**未放宽任何危险命令**（危险分类器零改动，两命令均 `CommandCategory::Observe`）；SafeMode 只读门闸确被断言锁定 —— `workbench_commands_are_read_only_observations` 直接调 `required_access_level()` 与 `category` 断言 `Read`/`Observe`，非自证 |
4. **数值断言真实性 / 自证循环核查**：5000 硬上限钳制（`type_distribution_clamps_an_oversized_window_instead_of_erroring`，断言实际取窗而非只断常量）、`truncated = sampled < dbsize` 两臂（`truncated_flag_is_the_sample_vs_census_bit` + 空库假臂 `type_distribution_on_an_empty_db_is_not_truncated`）、DBSIZE 每动作恰 1 次（`count_single("DBSIZE") == 1` 且 `total == 1` ⇒ 唯一一次，非互斥伪证）、TYPE 批次 `ceil(n/500)`（`flat()` 按批切片计数）、侧栏"恰 1 次往返"（`round_trips() == 1` 且 `singles` 为空）—— 前四项**为真且可证伪**；末项**口径夸大**：op 层为真，命令层还含 `with_live_op!` 每次无条件 `SELECT`（`redis_driver_on.rs:14-23` 无短路、`redis_driver.rs:32`）⇒ **BUG-006（低）**。Tester 另发现"回复条数 == 请求条数"这一前提被 mock 天然满足（`ScriptedConn` 恒每命令回一条）⇒ **BUG-003（中）**，已补 `ShortReplyConn` 打采样侧。
5. **边界**：空库（有测试）；`dbIndex` 越界 ⇒ 由 `select_db` 的 `SELECT` 报错上抛（`commands_exec.rs:49-55` 无上界校验，属全驱动既有形态、非本轨新增面，登记 R 项 14 真连核对错误文案）；非 UTF-8 键名 ⇒ `SCAN` 侧 `String::from_utf8_lossy`（`ops.rs:86-107` 既有解码点，本轨未新增解码），lossy 后键名再喂 `TYPE`/`MEMORY USAGE` 可能读到别的键或 `nil` —— mock 无法证伪，登记 R 项 12（不记 Bug 的理由：本轨未引入新解码点，属既有 SCAN 通道形态）；Cluster ⇒ BUG-001/002；Sentinel ⇒ 与 standalone 同型（`RedisLiveConn::Sentinel{connection: MultiplexedConnection}`）但断线重连会**整条重放** ⇒ R 项 9c；模块类型 ⇒ 已覆盖。
6. **两处健壮性缺口（低）**：`is_unusable_reply` 的 `_ => false` 与该函数自身文档承诺相反 ⇒ **BUG-004（低）**（今日 Redis 的 `TYPE` 不回 `+OK`/double/bool，非现网可达，但会静默假"已过期"）；`collect_sample` SCAN 循环无轮次上界/进展守卫 ⇒ **BUG-005（低）**（异常服务端可让上下文条永久 pending，并长期占用 `with_live_op!` 的 `connections.write()` 写锁）。

### 阶段 B · 独立复跑（不照抄 Coder 数字）

| 检查 | Coder 声称 | Tester 实测 @ `b1e1f4010`（补测前） | 判定 |
| --- | --- | --- | --- |
| `cargo test -p datazen-driver-redis` | 188 passed / 0 failed / 1 ignored | **188 / 0 / 1**（lib 184/0/1 + 集成 4/0/0，doc-test 0） | ✅ 一致 |
| 本轨新增 lib 用例数 | 24（基线 160） | **24**（160 + 24 = 184） | ✅ 一致 |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 | **exit 0**，0 错误 | ✅ 一致 |
| `node scripts/check-driver-import-boundaries.mjs` | 0 blocking / 4 advisory | **0 blocking / 4 advisory**（1403 files scanned，2 allow-listed）；4 条 R3 advisory 全在本轨未触碰的既有宿主文件 | ✅ 一致 |
| `cargo fmt -p datazen-driver-redis -- --check` | 无 diff | **exit 0** | ✅ 一致 |
| `cargo clippy -p datazen-driver-redis --all-targets` | 2 error + 17 warning，全为基线 | **2 error + 17 warning**，命中集合见下 | ✅ 一致 |
| 契约字段名/可空性 | 逐字一致 | JSON 序列化实测逐字：`{counts,sampled,dbsize,truncated}`、`{missing,type,memoryBytes,encoding,idleSeconds,freq,ttlMs}`；`dbsize` 保持小写、`type` 显式改名、缺值以 `null` 出现而非缺字段（Tester 新增线形测试） | ✅ 一致，**Wave 2 可按本文逐字冻结 TS 类型** |

**clippy 基线归因方法（如实说明）**：判据 = "`-->` 命中文件/行是否落在本轨 diff（`git diff --stat ae65ae375 b1e1f4010`）内"。本轨 diff 仅 7 个文件，`ops_workbench*` 与新增 dispatch/definition 行**零命中**。两条 deny 级 `approx_constant` 实测在 `ops.rs:905:38`、`ops_exec.rs:260:57`，而 `git diff --stat ae65ae375 b1e1f4010 -- packages/drivers/redis/src/ops.rs packages/drivers/redis/src/ops_exec.rs` **零输出** ⇒ 基线红、与本轨无关（记入"环境性既有红"）。`commands_exec_dispatch.rs:419/426/433` 的 3 条 `redundant_closure` 经 `git show ae65ae375:… | sed -n '405p;412p;419p'` 比对，确认是本轨纯插入（hunk `@@ -384,6 +384,20 @@`）导致的整体下移 14 行，非新增命中。Tester 补测后诊断集**逐行不变**（`diff /tmp/clippy-summary.txt /tmp/clippy-summary-after.txt` 无输出）。

### 阶段 C · 覆盖率驱动补测（Tester 职权，仅测试文件）

逐分支枚举（418 行，全臂清点）：DBSIZE 拒绝上抛 vs 非数值回落 0；SCAN 拒绝上抛；采样三种退出（窗口满 / 游标归零 / 去重后不足）；钳制四路（缺省 / 0 / >5000 / 单批越窗截断）；`truncated` 真假两臂（含空库）；`sampled == Σcounts` 不变式；类型 token 缺失 / 报错 / 模块类型；回复形状（Nil、空 Array、含错 Array、Set、Map、Attribute、Push、ServerError）；`parse_opt_int`（Int / BulkString / 垃圾 / 负值）；`parse_opt_string`（含 lossy）；`slot()` 越界；`parse_key_info` 四态；`pipeline_raw` 空批短路；两条命令 JSON 线形。

新增 12 条（`test_tester_` 前缀，全部通过）+ 一个第二种 mock `ShortReplyConn`（回复条数 < 请求条数，专打"回复排布变了会怎样"）：

```
test_tester_type_distribution_json_shape_is_the_wave2_contract     test_tester_key_object_info_json_shape_is_the_wave2_contract
test_tester_expired_and_unknown_key_states_are_distinguishable     test_tester_key_info_pttl_rejection_only_blanks_the_ttl_slot
test_tester_unusable_reply_covers_the_container_shapes             test_tester_reply_parsers_cover_the_remaining_value_shapes
test_tester_sample_window_is_clamped_to_the_limit_not_the_batch    test_tester_pipeline_raw_short_circuits_an_empty_batch
test_tester_dbsize_falls_back_to_zero_on_a_non_numeric_reply       test_tester_short_type_reply_never_inflates_the_sample
test_tester_module_type_tokens_survive_the_whole_command           test_tester_keys_is_issued_in_neither_shape_on_either_path
```

- 补测后：`cargo test -p datazen-driver-redis` ⇒ **196 passed / 0 failed / 1 ignored（lib）+ 4 passed（集成）= 200 通过**；`cargo fmt --check` exit 0；clippy 诊断集与补测前逐行相同。
- **覆盖率**（`cargo llvm-cov -p datazen-driver-redis --lib`，stable）：`ops_workbench.rs` **行 95.89%**（219 行 / 9 未覆盖）、**区域 94.03%**（335 / 20 未覆盖）、**函数 96.43%**（28 / 1 未覆盖）。未覆盖 9 行逐条核过：6 行为 `tracing` 字段闭包（无 subscriber 时不执行，工具假阴性 —— 分支本身已由 Tester 用例走到）、1 行为汇总 `debug!` 字段、1 行为 `parse_type_token:208` 的 `RValue::Int(n)`（服务端不会把 TYPE 回成整数，现实不可达）、1 行同属该 match。⇒ **新代码逻辑分支实测 ≈100%，满足并远超 ≥80% 硬标准**。
- **工具限制（如实登记）**：`cargo llvm-cov --branch` 需 nightly（`-Z coverage-options=branch`），本机 `rustup toolchain list` 仅 `stable`（active）+ `1.96.1` ⇒ 表格 Branches 列为 `0 / -`；分支覆盖以"区域覆盖 94.03% + 上表人工逐分支枚举"替代，未以此掩盖缺口。
- Tester **刻意未提交**的"会红"用例（属修复面，交 Coder 与修复一并落地，原文见 `bugs.md`）：BUG-003 的 `key_object_info` 短回复可观测断言、BUG-004 的 `parse_key_info(&[.., RValue::Okay])` 非 missing 断言、BUG-005 的 SCAN 轮次上界用例。

### 阶段 D · R 回归项可执行性核实

11 项**全部可执行**（前置条件与断言点齐全，无空转项），但 7 项（1/3/4/6/9/10/11）需加强或修正、5 项需新增，已直接改写进下方「留待 R 回归」（就地修订处标 `〔Tester〕`）：

- 项 4 的 MONITOR 核对表**必须含 1 次 `SELECT`**（BUG-006），Sentinel 断线重连会整条重放 ⇒ 计数翻倍属正常，否则会把正确实现判成回归。
- 项 9 是最大空洞：原文写"验证 `req_packed_commands` 的分片路由不受影响"，而 Tester 的静态源码证据是**必受影响**（BUG-001/002）。已拆成 9a/9b/9c/9d/9e 并写明"预期失败即确认 Bug，不得判为环境问题"。
- 项 1（采样 N/M 标注）与项 6/11（未知态 vs 已过期渲染）为 Wave 2 依赖项：已补明确断言点与责任切分（R 出后端数据形状，Wave 2 出渲染；两态判别键已确定为 `(missing, ttlMs)`）。
- 项 3 补 `sampleLimit` 无 schema 上界这一事实（`input_schema` 未写 `maximum` ⇒ 6000 由后端静默钳制，UI 不得自报"已按你填的值采样"）。
- 子代理未跑 `pnpm e2e` / `pnpm tauri:build:webdriver` / 裸 `pnpm build`（按任务书禁止项执行）。

### 缺陷登记

6 条 Bug 已登记 `docs/development/coordination/tracks/redis-cmds-p0/bugs.md`（BUG-001 高 / BUG-002 中 / BUG-003 中 / BUG-004 低 / BUG-005 低 / BUG-006 低），每条含现象、可复现步骤或失败断言原文、根因推断（附 redis 0.27.6 与本仓源码行号）、建议修法、状态 `待修复`。既有基线红（clippy 2 条 deny + 17 warning、nightly 分支覆盖不可用）已单列"环境性既有红"，未计入本轨 Bug。

## Coder 修复记录（Bug 第 1 轮 · 2026-09-22 · commit `346ebc979` · 结论 **待复测**）

同一 Coder 实例续跑（Bug 循环 1/5），工作目录仍是 `.worktrees/datazen-redis-cmds-p0`（起始 `git status --porcelain` 干净 @ `94b9f6023`），构建目录 `CARGO_TARGET_DIR=$PWD/target/cargo-wt`（另有 `cargo-wt-cov` 跑覆盖率）。**未碰** `ui/**`、`locales/**`、`src/**`、`packages/driver-sdk/**`、`scripts/resolve-drivers.mjs`、`Cargo.toml` / `Cargo.lock`（零新依赖，只用 redis 已公开的 API：`ConnectionLike::req_packed_command`、`cluster_routing::get_slot`）。主检出全程只读。

采纳 Tester 的建议修法 **(a) 拓扑分支**（未选 (b) 失败重发：Cluster 上必然 1+6 往返且仍是"先失败再补救"；未选 (c) 声明不支持：P0 侧栏在 Cluster 上会常红）。

| Bug | 改法（落点） | 守它的测试 |
| --- | --- | --- |
| BUG-001 高 | Cluster 上 `key_object_info` 走 `sequential_raw`（同一批 6 条命令逐条 `req_packed_command`），服务端按项错误折回 `Nil` 交由既有解析器降级，连接级错误上抛：`ops_workbench.rs:442 single_command` / `:464 sequential_raw` / `:476 issue_batch` / `:631 key_object_info`；拓扑透传链 `connect.rs:112 topology()` → `redis_driver.rs:31 with_live_op_topo!` → `:99 plugin_on_db_topo!` → `:488 plugin_key_object_info` | `cluster_topology::cluster_key_object_info_degrades_per_field_over_six_singles`（6 单发、0 批、`freq: null` 其余有值）+ `…keeps_working_when_the_key_is_gone`（missing 分支同路径）+ `…a_transport_failure_on_the_single_command_path_aborts_the_probe`（掉线上抛，不降级）+ 前提用例 `…a_cluster_batch_folds_the_freq_error…` |
| BUG-002 中 | Cluster 上 TYPE 逐键单命令（`ops_workbench.rs:557 sample_types` 的 Cluster 分支），采样窗 `sample_window_for`（`:114`）对 Cluster 再钳到 `CLUSTER_TYPE_SAMPLE_LIMIT = 200`（`:72`），分片视图 `TypeDistribution::from_sharded_view`（`:166`）强制 `truncated` ⇒ 永不把单分片扫描读成普查 | `cluster_type_distribution_types_keys_one_at_a_time`（逐键 5 次单发、0 批）、`cluster_sample_window_is_bounded_because_every_key_costs_a_round_trip`（含 standalone 对照：500 键 1 批）、`a_small_full_scan_is_a_census_on_a_single_node_but_not_on_a_cluster`、`an_empty_cluster_shard_still_reports_an_empty_census`、`sentinel_uses_the_single_node_batch_and_its_per_item_errors` |
| BUG-003 中 | `key_object_info` 拒绝条数不匹配的回复（`ops_workbench.rs:641-656`：`warn!` + `Err(… expected 6 … got N)`）；模块文档把"升级 redis 必查 `req_packed_commands` 排布"写成硬约束（`:47-50`） | `fix_round1::key_object_info_refuses_a_truncated_reply_vector_instead_of_guessing`（`ShortReplyConn { replies: 3 }` ⇒ 错误串同时含 `expected 6` 与 `got 3`；完整回复仍正常读取） |
| BUG-004 低 | "键不存在"只由 `TYPE` 明确回答 `none`/空决定（`type_reply_says_absent`，`:296`）；`parse_key_info`（`:346`）四态顺序改为 不可用 ⇒ 明确 absent ⇒ 可解析类型 ⇒ **其余一律第四态**（`unreadable_key_state()`，`:393`，附 `warn!`）；`is_unusable_reply` 的 `_ => false` 保留但**文档改写为实现真正承诺的事**（`:246-254`），矛盾从两侧同时消除 | `fix_round1::only_an_explicit_none_answers_that_the_key_is_absent`（8 判：`bulk("none")` / `SimpleString("none")` / `" NONE "` / `""` 为真，`string` / `ReJSON-RL` / 错误回复 / `Nil` 为假）+ `…unrecognised_type_reply_is_unknown_state_and_not_an_expired_key`（`Okay` / `Double` / `Boolean` 三形状 ⇒ `!missing` 且 `== unreadable_key_state()`） |
| BUG-005 低 | `collect_sample`（`:512-553`）加 `MAX_SCAN_ROUNDS = 64` 与 `MAX_STALLED_SCAN_ROUNDS = 16` 双守卫，触发即 `warn!` 并带 `rounds/stalled/cursor/limit` 停手；`sampled` 与 `truncated` 语义不变 | `fix_round1::type_distribution_stops_when_the_cursor_stops_making_progress`（恒空批 ⇒ SCAN 恰 16 轮）+ `…stops_at_the_round_cap_on_a_spinning_cursor`（游标空转 ⇒ SCAN 恰 64 轮、`sampled == 3` 去重后诚实） |
| BUG-006 低 | **仅按 Tester 修法 1+2**：`tests.rs:459` 用例的断言文案与注释收窄为"op 自身 payload 恰 1 次 pipeline，不含 `with_live_op!` 的 SELECT"；R 项 4 的 MONITOR 核对表已含 1 次 SELECT。**〔收尾轮 `c844b6804` 补齐剩余两处口径：`tests.rs:516-518` 第二处裸 `round_trips() == 1` 加同口径注释；`commands.rs:456/469` 两条 description 与 `sampleLimit` 的 schema description 不再宣传"One pipeline"，改写为按拓扑如实 + "命令层多 1 次 SELECT"〕**。**修法 3（`select_db_on` 的 `current_db` 短路）本轨未做** —— Tester 原文即标"不建议在本轨顺手做"（全驱动行为变更，交协调者裁定） | 同一用例（口径不再外溢），无新行为可测；"op 自身绝不发 `SELECT`"已由 Tester 的 `test_tester_keys_is_issued_in_neither_shape_on_either_path` 反向白名单（`{singles,batches}` 命令名 ⊆ {DBSIZE, SCAN, TYPE, MEMORY, OBJECT, PTTL}）钉死 ⇒ 无需重复加断言 |

Tester 刻意未提交（会红）的三条用例全部按原文意图落地：BUG-003 短回复可观测断言、BUG-004 `RValue::Okay` 非 missing 断言、BUG-005 SCAN 轮次上界。

### 自验记录（修复第 1 轮 · 独立复跑）

1. `CARGO_TARGET_DIR=$PWD/target/cargo-wt cargo test -p datazen-driver-redis` ⇒ **210 passed / 0 failed / 1 ignored（lib）+ 4 passed / 0 failed（集成 `tests/workbench_commands.rs`）+ doc-test 0**，即 **214 通过**；对照上一轮 196 + 4 = 200 ⇒ **本轮净增 14 条**（`fix_round1` 5 + `cluster_topology` 9）。1 项 ignored 仍是 `connect.rs:1015` 的既有真连用例。全部 20 处 op 调用点已随签名更新为显式传 `Topology`。
2. `cargo fmt -p datazen-driver-redis -- --check` ⇒ **exit 0，无 diff**。
3. `cargo clippy -p datazen-driver-redis --all-targets` ⇒ 仍是基线的 **2 error + 17 warning**（`--lib` 14 / `--tests` 15 条 warning，`comm -13` 差集唯一项是未触碰的 `ops_io.rs:285`）；`--message-format short` 逐行核对：**`ops_workbench*` 与 `connect.rs` 零命中**，`redis_driver.rs` 的 3 条 `too many arguments` 落在 154（`scan_keys_with_info`）/294（`list_children`）/675（`plugin_xpending`）三处既有函数，均非本回合新增（宏不产生该 lint）。2 条 deny `approx_constant` 位置不变（`ops.rs:905:38`、`ops_exec.rs:260:57`）⇒ 属"环境性既有红"。
4. `node scripts/check-driver-import-boundaries.mjs` ⇒ **exit 0，0 blocking / 4 advisory**（1403 files，2 allow-listed）—— 与首轮 Coder/Tester 数字逐字相同，4 条 advisory 全在本轨未触碰的宿主文件。
5. `npx tsc --noEmit -p tsconfig.json` ⇒ **exit 0**（本轨零 TS/零文案改动，验收标准 3/4 仍满足）。
6. 覆盖率 `LLVM_COV=$(rustc --print sysroot)/lib/rustlib/*/bin/llvm-cov cargo llvm-cov -p datazen-driver-redis --lib` ⇒ `ops_workbench.rs` **函数 40/40 = 100%**、**行 329 行 / 28 未命中 = 91.49%**、**区域 491 / 56 = 88.59%**（文件从 418 行增至 666 行，区域基数变大所以百分比低于首轮 94.03%）。`--show-missing-lines` 实测未命中行号 12 个：`359/370/371/452/542/584/585/586/625/650/651` 全是 `tracing` 的**字段闭包**（无 subscriber 时不执行，与首轮记录的假阴性同类），仅 `280` 是 `parse_type_token` 的 `RValue::Int` 臂 —— 与首轮记录的 `parse_type_token:208` 缺口同一条（服务端不会把 TYPE 回成整数，现实不可达），本回合没有新增未覆盖的逻辑行。Branches 列仍 `-`：`--branch` 需 nightly（沿用首轮登记的"环境性限制"，未以此掩盖缺口）。
7. 全仓 `cargo check --workspace` / `pnpm build` / `pnpm e2e` **未跑**（按任务书禁止项；worktree 亦缺 gitignored 的外部 git 驱动）。两 op 的签名变更是 crate 内部 `pub`，全仓 grep 证实 Host / `driver-api` 无调用点（只有 `packages/drivers/redis/**` 与自身集成测试）。
8. 单文件规模：`ops_workbench.rs` 666 行（< 800 推荐线）；首轮已 1164 行的 `ops_workbench/tests.rs` 本轮**没有继续增长**（1187），新增用例分别落在新子模块 `tests/fix_round1.rs`（139 行）与 `tests/cluster_topology.rs`（413 行）。`tests.rs` 本体超线属首轮遗留，建议 Tester/R 若判需拆分再拆（纯测试文件，不影响产物）。

### Coder 收尾记录（Bug 循环 1/5 之收尾 · 2026-09-22 · 代码 `c844b6804` · 结论 **待复测**）

新 Coder 实例接手上一任（跑到 turn 上限被中断、现场留下未提交文档改动）。**只做四件事，未重做任何已落地修复**；构建目录 `CARGO_TARGET_DIR=$PWD/target/cargo-wt-coder-fix`（与前任的 `target/cargo-wt`、Tester 的 `target/cargo-wt-test` 分开以免争锁；落在 gitignored 的 `/target` 内）。主检出全程只读。

1. **BUG-006 口径改如实（代码 `c844b6804`）**：上一轮只收窄了 `tests.rs:459` 那条用例的断言文案，还剩两处仍按旧口径对外宣传 ⇒ `tests.rs:516-518`（第二处裸 `round_trips() == 1`）补同口径注释；`commands.rs:456` / `:469` 的 description 与 `sampleLimit` 的 schema description 不再写 "One pipeline…"，改为按拓扑如实（Cluster 逐条 / 采样窗 200）并显式写明"命令层每次调用多 1 次 `SELECT`"。**只动英文描述串与注释**，契约字段名 / 类型 / 可空性 / `required` / `maximum` 零改动（已在「契约偏离」新增一条登记）。Tester 建议的修法 3（`select_db_on` 短路）仍**不做**（交协调者）；该条不要求新增断言 —— "op 自身不发 `SELECT`"已被 Tester 的反向白名单用例钉死，未重复添加。
2. **「契约偏离」第 6 条正文就地更正**：删除被 Tester 判定不实的"线路字节、传输与 cluster 路由不变"这句，改写为"单节点够用 / Cluster 分发层再折叠一次 + 单 slot 约束 ⇒ 必须按拓扑分支"的真实口径，同时把 **Tester 首轮裁定原文整段以存档形式保留**在该条末尾（一字不删其结论），并按修法 2 给 R 项 9a / 9b 补上"另有 1 次 `SELECT`（Sentinel 重连整条重放）"；`bugs.md` 六条状态全部流转为 `待复测`（补齐上一轮缺失的 BUG-003 / 004 / 005 / 006 四节分节「修复备注」，逐条给落点行号 + 守它的用例名 + 未做的修法去向），BUG-006 标 `待复测（修法 3 交协调者）`。**无任何一条被虚假流转**：六条在 `346ebc979` 均已改生产码/改口径，故全部 `待复测` 成立。
3. **`346ebc979` 是否削弱 Tester 断言 —— 逐行审计结论：没有，无需回滚。**方法：`git show 346ebc979 -- packages/drivers/redis/src/ops_workbench/tests.rs` 取全量删除行（**21 行**）逐条判读，另有 `git show 346ebc979 | grep -n "ignore\|#\[test\]\|todo!"` 查是否有人被降级。结果：
   - 20/21 处删除是**同一行的签名 plumbing**（`type_distribution(&mut conn, Some(100))` → `…, Topology::Standalone`），断言本体与数量一字未动；
   - 第 21 处是把 `"the whole sidebar payload must cost exactly one round trip"` 换成带定语的 `"the op's own payload must cost exactly one pipeline round trip, excluding the db SELECT issued by with_live_op!"` —— 这正是 BUG-006 修法 1 要求的收紧，**方向是变严不是变松**（`round_trips() == 1` 与 `singles.is_empty()` 两条断言均保留）；
   - 12 条 `test_tester_` 前缀用例**全部在位**（`grep -c "fn test_tester_"` = 12）、无一条加 `#[ignore]`、无注释掉、无删；`ShortReplyConn` 与 `ScriptedConn` 两个替身仍被 Tester 原用例使用，BUG-003 的条数守卫只挂在 `key_object_info`（op）上、`test_tester_short_type_reply_never_inflates_the_sample` 打的是 `sample_types`，两者语义不冲突，故该用例断言未做任何调整；
   - 唯一新增的辅助函数是 `bulk()`（测试侧构造器），不改判定。⇒ 结论：无需恢复任何原语义，也不存在"需要说明理由的 Tester 断言改动"。
4. **提交拆分**：`c844b6804`（代码：仅 `packages/drivers/redis/src/commands.rs` + `ops_workbench/tests.rs`）与本条文档 commit（仅 `docs/development/coordination/tracks/redis-cmds-p0/**`）分开；**未提交** `target/`、codegen（`src-tauri/src/driver_init.rs` 等）、`Cargo.lock`、被注入的 `src-tauri/Cargo.toml`（`git status` 收尾后 clean，无未跟踪产物）。

#### 自验（收尾轮实测数字，全部本机实跑，无推算）

1. `cargo test -p datazen-driver-redis` ⇒ **lib 210 passed / 0 failed / 1 ignored** + **集成 `tests/workbench_commands.rs` 4 passed / 0 failed** + doc-test 0 = **214 通过**（与 `346ebc979` 逐项相同 ⇒ 本回合零行为变更，Tester 基线"约 200 通过"已因两轮补测增长到该数）；1 项 ignored 仍是 `connect.rs` 的既有真连用例。
2. `cargo fmt -p datazen-driver-redis -- --check` ⇒ **exit 0**。**如实报告**：workspace 级 `cargo fmt --check` **exit 1**，两处 diff 全在本轨之外 —— `src-tauri/src/commands/ai/integration_tests.rs`（宿主）与 `src-tauri/src/driver_init.rs`（**gitignored codegen**，由 `resolve-drivers.mjs` 注入且顺序未排序）。`git diff --name-only ae65ae375..HEAD -- src-tauri/` **零输出** ⇒ 属基线/环境既有红，本轨不修以免污染 diff（记入下方"环境性既有红"）。
3. `cargo clippy -p datazen-driver-redis --all-targets` ⇒ **不劣于基线**：`(lib) generated 17 warnings`（= 基线 17）+ 2 条 deny `approx_constant`（`ops.rs:905:38`、`ops_exec.rs:260:57`，位置未变），`(lib test)` 多 1 条（`ops_io.rs:285`，与修复轮记录同）；`datazen-driver-api (lib) 3 warnings` 不变。**逐条归因**：本轮把 20 处命中（3 × `commands_exec_dispatch.rs:419/426/433` + 5 × `redis_driver.rs:119/154/245/294/675` + 2 × `redis_driver_on.rs:80/326` + 3 × `ops_value_search.rs` + 3 × `decode/pickle.rs` + `ops_io.rs:285` + `redis_value_preview.rs:28` + 2 条 deny）全部 `git blame -L` 到行，命中的引入 commit 为 `5afb0930` / `bf8f8bca` / `49c550cd` / `8913d9aa` / `9ae4e24b` / `b7299cd6` / `be7bc6b1` / `4a4a1b37` —— **无一来自 `b1e1f4010` 或 `346ebc979`**；`ops_workbench*`、`connect.rs`、`commands.rs` 与本回合两处改动**零命中**。
4. `npx tsc --noEmit -p tsconfig.json` ⇒ **exit 0，0 错误**（本轨零 TS 改动，未跑 `pnpm install`）。
5. 禁止路径自查（本回合 diff 面）：`KEYS` 零命中（只改了描述字符串）；生产路径零裸 `unwrap()` / `expect()` 新增；零新依赖；未碰 `ui/**`、`locales/**`、宿主 `src/**`、`packages/driver-sdk/**`、`scripts/resolve-drivers.mjs`、`hub.md` 与他轨文档；未跑 `pnpm e2e` / `tauri:build:webdriver` / 裸 `pnpm build`。

### 交回协调者 / 留给 Tester 与 R

1. **BUG-006 修法 3**（`select_db_on` 短路 `current_db`）未做：全驱动收益、也改既有行为，需另立条目裁定。
2. `list_children` 的跨 slot 同形缺陷（首轮 9e / BUG-002 修法 4）不归本轨，等 R 真连确认 `CrossSlot` 后另登基线条目。
3. **R 项 9a/9b 的预期行为已因本次修复改变**（原文写"预期失败即确认 BUG-001/002"），已就地改写为"修复后期望成功"的断言表；真连仍是唯一能证伪 redis cluster 分发层实际形态的手段，进程内 `ClusterFoldingConn` 只保证不回归。
4. Wave 2 需按新口径消费：Cluster 的 `truncated` 恒真、`M` 只是单分片 DBSIZE、侧栏探测在 Cluster 上是 6 次单命令（**命令级 7 次 = 1 次 `SELECT` + 6**，standalone/sentinel 为 2 次）⇒ 自动刷新间隔/并发预算要按拓扑区分。
5. 〔收尾轮补登〕BUG-003 修法 3（改用**公开**的 `MultiplexedConnection::send_packed_commands`，把 `#[doc(hidden)]` 依赖面降到零）本轨未做：它要求两个 op 不再对 `ConnectionLike` 泛型化 ⇒ `ScriptedConn` / `ShortReplyConn` / `ClusterFoldingConn` 三个进程内替身整体重写，并与 BUG-001"同一批命令、两拓扑共用一套解析器"的实现冲突。若协调者裁定要做，需另立条目并连带重估测试面。
6. 〔收尾轮补登〕BUG-003 修法 2 的后半（是否把 `Cargo.toml` 的 `redis = "0.27"` 锁到小版本以杜绝 0.27.x 漂移）本轨未做 —— 任务书禁止改 `Cargo.toml`；现行缓解是运行期守卫（条数不符即 `Err`）+ R 项 15 的升级必查清单。属依赖治理轨。
7. 〔收尾轮补登 · 环境性既有红〕workspace 级 `cargo fmt --check` **exit 1** 的两处均在本轨 diff 之外：`src-tauri/src/commands/ai/integration_tests.rs`（宿主既有未格式化代码）与 `src-tauri/src/driver_init.rs`（**gitignored codegen**，`resolve-drivers.mjs` 注入的 `extern crate` 顺序未排序 ⇒ 每次构建都可能重新触发）。本轨不修（禁碰宿主与 codegen），建议协调者 either 在 codegen 脚本内补 `rustfmt` 或把该文件排除出 fmt 范围。

## Tester 复测轮 · 第 2 实例（变异实测 + 契约冻结 · 2026-09-22 · 起始 HEAD `2c1f77134` · 结论 **FAILED**）

接手现场：起始 `git status --porcelain` **不是干净**（任务书写"应 clean"）—— 工作区残留上一任复测实例的未提交成果：`bugs.md` / `progress.md` 的复测裁定与新增文件 `ops_workbench/tests/fix_round1_retest.rs`（259 行 / 7 条 `test_tester_` 用例）。这与本轨「Coder 收尾记录」第 202 行记过的中断情形**同类**（turn 上限死亡、现场未提交）。处置：**不丢弃、不轻信** —— 逐条独立核实后由本实例一并提交，归属如实标注。构建目录 `CARGO_TARGET_DIR=$PWD/target/cargo-wt-retest2`（APFS clone 自 `cargo-wt-retest`，秒级且不与他人争锁；`/target` 已 gitignored）。主检出全程只读。**只测不修**：生产码零改动（变异全部复原，md5 逐次核对，结束态与 HEAD blob 一致）。

### 本回合补做的两项（上一任未做）

1. **变异实测（本轨最高风险项"反自证循环"的唯一有效手段）**：13 项语义反转 + 4 项数值漂移，全部打在 `ops_workbench.rs` 生产码上，跑完整 lib 套件。**任务书点名的三个方向 M1（`issue_batch` 改回统一 pipeline）/ M2（删回复条数守卫）/ M3（去掉 `from_sharded_view` 的 `truncated` 强制位）全部立刻变红**，M3b / M4 / M5 / M6 / M7 / M7b / M8a / M11 / M12 / M13 亦红 ⇒ **`ClusterFoldingConn` 不是把期望演一遍的装饰替身**，四条修复（BUG-001 / 002 / 003 / 004）的守卫是真可证伪的。附带结论：上一任新增的 7 条用例中，分类表两条**只在 M11 / M12 / M13 变红**（既有 cluster 用例都不红），Sentinel 臂只在 M4 红 ⇒ 它们提供了**独有**的证伪能力，不是重复劳动。完整表格见 `bugs.md`「变异实测」节。
2. **契约冻结逐字节核对**：用**已提交 blob** 比较（不受工作区变异影响）。`pub struct TypeDistribution` 与 `pub struct KeyObjectInfo` 在 `b1e1f4010` 与 `HEAD` 之间 **273/273、267/267 字节完全相同**（字段名、类型、`#[serde(rename = "type")]`、`dbsize` 全小写、`Option<…>` 可空性一律未动）；`git diff b1e1f4010 HEAD -- commands.rs` **全文只 3 行**改动，逐行读为两条 `description` + `sampleLimit` 的 `description`，`required`（`&[]` / `&["key"]`）、`"type": "integer"`、`"minimum": 0`、`maximum` 仍**不存在**、`permissions`、`output_schema: None` 零改动。⇒ **Coder"只改 description"的声称成立，Wave 2 可按「契约偏离」继续冻结 TS 类型**。4 条 `tests/workbench_commands.rs` 契约用例逐条读为真断言（`assert_eq!` 到 `json!([])` / `json!(["key"])`、`["maximum"].is_null()`、`Observe` + `Read`、`ConnectionFailed` 反 `Unsupported`），不是 `contains` 式弱断言。

### 独立核实上一任结论（零信任同样适用于 Tester 自述）

| 上一任主张 | 本实例独立复核手段 | 结论 |
| --- | --- | --- |
| "12 条 `test_tester_` 用例无放宽 / 无删除 / 无注释" | `git diff 1e6b9cf4a HEAD -- tests.rs` 取**净差异全集**（覆盖 `346ebc979` + `c844b6804` 两笔，而非只审 Coder 自选的那一笔）+ 大括号配对逐函数抽取比对：12 条**全部在位**，逐函数 `assert!` 计数 67 = 67，**normalize 掉 `Topology::Standalone` 实参后 12 个函数体逐字节相同**；`#[ignore]` / `#[should_panic]` 增删 **0** | **成立**（Coder 的自查结论对，但它只审了一笔 commit；净差异层面同样干净） |
| BUG-007 的四条路由事实 | 本机 `redis-0.27.6` 源码逐行：`cluster_routing.rs:522-533`（`command()` 把 `MEMORY`/`OBJECT` 拼成两词名）+ `:503-507` 兜底臂 `_ => arg_idx(1)`、表内**无** `MEMORY USAGE` / `OBJECT *`；`request.rs:212-220` MovedRedirect → `Retry::Immediately` + `RebuildSlots`；`mod.rs:394-395` `refresh_slots` 持 `conn_lock.write()`；`:321-322` + `:366-387` `DBSIZE` = `AllMasters` + `Aggregate(Sum)`；`:477-478` `SCAN => None`（带 `// TODO - special handling`）+ `mod.rs:1052-1053` `unwrap_or(SingleNode(Random))`；`connect.rs:373-397` 未设 `read_from_replicas`（全 crate grep 零命中） | **四条全部成立，无夸大**（其"排除从节点滞后风险"一句亦准确）⇒ BUG-007 维持 `待修复` |
| "Coder 报 210 + 4 全绿" | 独立目录实跑 **217 + 4**（217 = 210 + 继承的 7 条），`ignored` 恰 1 且是 `connect.rs:1015` 既有真连用例 | **一致** |

### 本回合新发现（登记 BUG-008 · 低）

变异 M8b / M8d / M8e 三项**全绿**：`MAX_SCAN_ROUNDS`(64) / `MAX_STALLED_SCAN_ROUNDS`(16) / `CLUSTER_TYPE_SAMPLE_LIMIT`(200) 在测试中只以常量自身出现，改数字零反馈；而 200 已写进面向 UI 的 description、64/16 是 R 项 13 真连判据的字面值 —— R 项 13 那句"**单测已按'恰 16 / 恰 64 轮'钉死**，不是'≤'式弱断言"**过强**（单测钉的是"哪条守卫先生效"，不是这两个数），对照证据：`MAX_TYPE_SAMPLE_LIMIT` 5000→5001 会红（那条用例里有字面量 `10`）。详见 `bugs.md` redis-cmds-p0-BUG-008（含可粘贴复现与 3~4 行修法）。

### 门禁实测（全部本机真跑，无推算）

| 门禁 | 实测 | 与自报/基线 |
| --- | --- | --- |
| `cargo test -p datazen-driver-redis` | lib **217 / 0 / 1 ignored** + 集成 **4 / 0** + doc 0 | Coder 210+4 ✅（+7 为继承用例） |
| `cargo fmt -p datazen-driver-redis -- --check` | **exit 0** | 一致 |
| `cargo fmt --all -- --check` | **exit 1**：`src-tauri/src/commands/ai/integration_tests.rs:1244`、gitignored codegen `src-tauri/src/driver_init.rs:4,19` | 与既有"环境性既有红"登记逐字一致，`git diff --name-only ae65ae375 HEAD -- src-tauri/` 零输出 |
| `cargo clippy -p datazen-driver-redis --all-targets` | exit 101：`(lib) 17 warnings`、`(lib test) 18 (17 dup)`、`driver-api (lib) 3`、**2 条 deny** `ops.rs:905:38` / `ops_exec.rs:260:57`；20 个命中点全部枚举，`ops_workbench*` / `connect.rs` / `commands.rs` **零命中** | **不劣于基线**（2 deny + 17 warning 逐字一致） |
| `npx tsc --noEmit -p tsconfig.json` | **exit 0** | 一致（本轨零 TS 改动） |
| `node scripts/check-driver-import-boundaries.mjs` | **exit 0 · 1403 files · 0 blocking · 4 advisory · 2 allow-listed** | **边界护栏 0 blocking 保持** |
| `cargo llvm-cov -p datazen-driver-redis --lib` | `ops_workbench.rs`（本轨唯一生产改动面）**区域 491/56 未覆盖 = 88.59% · 函数 40/40 = 100.00% · 行 329/28 = 91.49%** —— 本实例自测，与 Coder 自报及第 1 实例复述**逐字一致** ⇒ ≥80% 硬标准满足（同前两轮：未命中行全为 `tracing` 字段闭包与 `parse_type_token` 的 `RValue::Int` 现实不可达臂；`--branch` 需 nightly，Branches 列 `-`） | 一致 |

### 交回协调者（本回合新增，不重复上一任已登记者）

1. **轨道卫生 / 流程问题（值得进 playbook）**：本轨**两次**出现"子代理跑到 turn 上限、现场完全未提交"（Coder 第 1 轮 → 收尾轮接手一次；本次 Tester 复测轮第 1 实例 → 第 2 实例接手第二次）。派发书应硬性要求"**每完成一个阶段立即 commit**"，否则接手者无法区分"已验证结论"与"未验证草稿"—— 本回合为此额外花了整轮做二次核实。
2. **BUG-008 建议与 BUG-007 修法 3 合并处理**（同属"断言/替身把要守的东西自己声明了一遍"），一次改动即可同时闭合测试面缺口，成本 3~4 行。
3. R 项 13 的措辞需按 BUG-008 修法 3 收窄（"钉死数字"→"钉死守卫身份"），否则 R 阶段会照抄一句过强的话；本实例**未代改**（属 Coder 整改面）。
4. 本回合**未新增任何契约字段**、未改任何生产码、未跑 `pnpm install` / `pnpm build` / `pnpm e2e`（任务书禁止项）。

## Coder 修复记录（Bug 循环 2/5 · 修复第 3 轮 · 代码 `81cc58a90`（BUG-007）+ `286d917c4`（BUG-008）+ 收尾轮 · 结论 **待复测**）

**接手现场（本轨第三次同类事故）**：第 3 轮 Coder 第 1 实例在 turn 上限被强杀，死时**两笔代码 commit 已进 HEAD**（`81cc58a90` / `286d917c4`），工作区只剩 `progress.md` 一处未提交改动 ——「契约偏离」三条 Cluster 口径已按裁定 4 重写 + 两条〔修复第 3 轮新增〕bullet + 协调者裁定原文已录入，但 **R 项清单、本记录、`bugs.md` 状态流转三件均未做**。收尾轮处置沿用本轨既有办法：**不轻信前任自述**，逐条对代码、对 redis-0.27.6 本机源码、对实跑门禁独立复核后补齐台账，前任已写的未提交文字全部保留。构建目录 `CARGO_TARGET_DIR=$PWD/target/cargo-wt-fix3`（`/target` 已 gitignored，临时脚本用完即删），主检出全程只读。

### 协调者裁定（第 3 轮 BUG-007 七条）逐条落实核对

| 裁定 | 落实情况 | 可复跑证据 |
| --- | --- | --- |
| 1 绝不向 cluster 发出路由未定义的命令 | 新增本 crate **局部**抽象 `SlotRoutedConnection::command_at_slot`（`ops_workbench.rs:471-495`），Cluster 实现体为 `self.route_command(cmd, master_route(slot))`；**三条探测通道全部改走它**：`key_object_info` 的 6 条（`issue_batch:605` → `routed_sequential:580` → `routed_single:571`，槽位取 `get_slot(key)`，`:823`）、`sample_types` 的逐键 `TYPE`（`:743`）、`scan_round` 的每轮 `SCAN`（`:649`）。两词探测命令**不再**落到 redis 的 `_ => arg_idx(1)` 兜底臂 | 替身 `ClusterFoldingConn` 按 redis 自己的 `RoutingInfo::for_routable` 建表并**主动拒绝寻址错误的探测** ⇒ `redis_table_routes_the_two_word_probes_to_a_shard_that_does_not_hold_the_key` / `an_unaddressed_two_word_probe_is_moved_and_rebuilds_the_slot_map` / `addressing_a_probe_at_the_wrong_shard_is_refused_too` 三条把"事实"与"后果"分别钉住；三条调用点变异（M-scanaddress / M-callslot / M-typeslot）各红 2/2/5 条 |
| 2 优先方案：公开 `get_slot` + 自行选主；若无公开按节点发送通道 ⇒ `BLOCKED` | **`BLOCKED` 分支不触发**：本实例独立复核 `~/.cargo/registry/src/…/redis-0.27.6/`，`ClusterConnection::route_command`、`cluster_routing::get_slot`、`Route::new` / `SlotAddr` **均为 `pub`**，故按裁定方案实现，未退化为"逐条发 + 容忍 MOVED 风暴" | `master_route:500-505` 只用公开类型；`cargo test -p datazen-driver-redis --lib` 编译即证无需 `#[doc(hidden)]` 通道 |
| 3 cluster 采样必须固定单分片游标 | `CLUSTER_SCAN_ANCHOR`（`:127`）+ `cluster_scan_anchor_slot()`（`:132`）把每一轮 `SCAN` 钉在同一分片同一游标空间，"跨分片混采"不再可能伪装成一个视图 | `every_cluster_scan_round_shares_one_shard_and_cursor_space`（同一分片 + 游标逐轮连续）与 `an_unaddressed_scan_round_has_no_pinned_shard`（不寻址时的反面对照）；M-scanaddress 变异红 2 条 |
| 4 `dbsize` 语义按事实重推、`truncated` 的"真理由"重判 | `fetch_dbsize:631` **故意不寻址**（`DBSIZE` 在 redis 表里是 `MultiNode(AllMasters, Aggregate(Sum))` ⇒ 全集群求和；钉到采样分片会把"一个分片的计数"当成"库的大小"）；`from_sharded_view` **已删除**，全拓扑统一 `TypeDistribution::from_sample:225` + `is_sample_truncated:191 = sampled < dbsize`。**重判结论：`truncated` 在 cluster 上仍几乎恒真**，但理由换成"分子是单分片采样、分母是全集群求和"两个 scope 不同，不再声称"分片视图" | `dbsize_is_left_to_the_clients_all_master_fan_out`（`conn.addressed` 必须为空 + `slot_refreshes == 0`）、`a_cluster_census_requires_the_whole_cluster_to_have_been_scanned`、`an_empty_cluster_reports_an_empty_census`；M-trunc（守卫恒 `false`）红 **11** 条 ⇒ 该位不是装饰 |
| 5 面向 UI 的 description 与「契约偏离」同步更正，字段名/可空性不动 | 「契约偏离」三条 bullet 已重写 + 新增两条；`commands.rs` 两条 description 与 `sampleLimit` description 的数字**全部改为常量 `format!` 渲染**（同时闭合 BUG-008 修法 2） | 见下「契约冻结核对」：声明面逐字节未动 |
| 6 上一轮"按拓扑分支"的结论仍有效 | `issue_batch` / `sample_types` / `scan_round` 三处 `match topology` 全保留，standalone/sentinel 仍走一条 pipeline | Tester 的 M1 / M5 类变异方向本轮仍红（M-callslot / M-typeslot 各红 cluster 用例、`sentinel_uses_the_single_node_batch_and_its_per_item_errors` 仍钉 Sentinel 臂） |
| 7 每改完一条先 commit | 前任按两笔 commit 落地代码（正面）；**但台账三件没来得及做**（本轨第三次死在同一处）。收尾轮补成两笔：测试侧改动一笔、台账一笔 | `git log --oneline -4` |

### BUG-008 四条修法的落实（Tester 建议 → 实测复证）

1. **字面量锁定**：`fix_round1::scan_budgets_are_the_numbers_the_docs_quoted`（64 / 16 各一条 `assert_eq!`，另钉两条守卫的**次序**与"最大窗口 10 轮可填满"的标定关系）+ `cluster_topology::cluster_sample_window_is_bounded_because_every_key_costs_a_round_trip` 内的 `200`。**实测（本实例复跑，逐项打生产码）**：`MAX_SCAN_ROUNDS` 64→65 红 1 条、`MAX_STALLED_SCAN_ROUNDS` 16→8 红 1 条、`CLUSTER_TYPE_SAMPLE_LIMIT` 200→201 红 2 条 ⇒ Tester 的 M8b / M8d / M8e 三项"全绿"现已闭合。
2. **description ↔ 常量一致性**：采"文案由常量渲染"这一硬路径（`commands.rs` 用 `format!` 注入 `TYPE_PIPELINE_CHUNK` / `DEFAULT_TYPE_SAMPLE_LIMIT` / `MAX_TYPE_SAMPLE_LIMIT` / `CLUSTER_TYPE_SAMPLE_LIMIT` / `KEY_INFO_PIPELINE_LEN` / `KEY_INFO_PIPELINE_LEN + 1`），再由 `fix_round1::the_ui_descriptions_still_promise_those_same_numbers` 用字面量核对渲染结果 ⇒ 实测 `TYPE_PIPELINE_CHUNK` 500→600 与 `MAX_TYPE_SAMPLE_LIMIT` 5000→5001 **各红该用例**（各连带 1 条既有断言），对外文案与实际钳制值**结构上无法再漂移**。
3. **措辞收窄**：R 项 13 已按"数字由修法 1 锁定、原用例钉的是守卫身份"改写，并补 Cluster 侧"MONITOR 要打在锚定分片上"的操作提示；「契约偏离 · Cluster 采样窗」同步。
4. **不为此改生产码**：遵守 —— 未新增配置面、未碰 `Cargo.toml` / `Cargo.lock`、未动契约字段。

### 收尾轮自己的两处测试侧改动（生产码零改动）

1. **修掉前任引入的 clippy 回归**：`fix_round1.rs:31` 的 `` assert!(true) `` 形态（clippy 报 `assert!(true)` will be optimized away）使 `(lib test)` 从基线 18 涨到 19 ⇒ 改为把两个常量先绑定为局部变量再断言（守卫次序与"轮帽不得吞掉停滞守卫"的语义不变），复跑后诊断集回到 `(lib) 17` / `(lib test) 18 (17 dup)`。
2. **补一条 `master_route` 形状用例**：`cluster_topology::the_address_we_build_names_exactly_the_master_of_the_given_slot`（`:427`）—— 断言构造出的 `RoutingInfo` 恰为 `SingleNode(SpecificNode(Route::new(slot, SlotAddr::Master)))`，对 `0 / 1 / LAST_SLOT / cluster_scan_anchor_slot()` 四个槽各核一次。它是 M-slotaddr 变异（`SlotAddr::Master` → `ReplicaOptional`）**唯一**能变红的用例（红 1 条），补上了"寻址决策已钉住、地址形状没钉住"这段空档。

### 独立变异复证（11 项 + 基线，全部打在 `ops_workbench.rs` 生产码，逐项 md5 复原核对）

方法：脚本对生产文件逐条施加语义/数值反转 → `cargo test -p datazen-driver-redis --lib -- --quiet` → 抽取 `test result:` 与 `^---- <用例名> stdout ----` → `git checkout --` 复原 → `md5` 与基线核对。施加前先 `git diff --quiet` 确认起点干净，若替换未产生 diff 则**判该用例无效**（本实例第一版草稿栽过一次：两处跨行 perl 模式未匹配 ⇒ 静默 no-op 被误记为"全绿"，本表已按有效性闸门全部重跑）。基线 M0 = **226 passed / 0 failed / 1 ignored**；结束态 md5 `466cbae5e91c1064e42ea3de52fd4db1` 与起始**逐次一致**，生产码零残留。

| # | 变异 | 实测 | 变红用例 |
| --- | --- | --- | --- |
| **M-addr** | **Cluster 的 `command_at_slot` 实现体退回 `req_packed_command`（丢掉 `route_command`）** | **全绿 226/0** | **无 —— 这是本轨已知的结构性盲区，见本表下方说明** |
| M-slotaddr | `master_route` 的 `SlotAddr::Master` → `ReplicaOptional` | 红 (1) | `the_address_we_build_names_exactly_the_master_of_the_given_slot`（收尾轮新增用例，唯一防线） |
| M-scanaddress | cluster `SCAN` 轮不寻址（回落到随机节点） | 红 (2) | `cluster_type_distribution_types_keys_one_at_a_time_on_their_own_shards`、`every_cluster_scan_round_shares_one_shard_and_cursor_space` |
| M-callslot | `key_object_info` 的 6 条寻址到锚分片而非键所属分片 | 红 (2) | `cluster_key_object_info_degrades_per_field_over_six_addressed_singles`、`…keeps_working_when_the_key_is_gone` |
| M-typeslot | 逐键 `TYPE` 寻址到锚分片 | 红 (5) | 含 `…one_at_a_time_on_their_own_shards`、`a_transport_failure_on_the_addressed_path_aborts_the_probe`、`a_cluster_census_requires_…`、`every_cluster_scan_round_shares_…`、`cluster_sample_window_is_bounded_…` |
| M-trunc | `is_sample_truncated` 恒 `false`（采样谎称普查） | 红 (11) | 两拓扑的采样/普查用例成片红（含 `test_tester_type_distribution_json_shape_is_the_wave2_contract`） |
| M8b | `MAX_SCAN_ROUNDS` 64 → 65 | 红 (1) | `scan_budgets_are_the_numbers_the_docs_quoted`〔上轮 Tester 测得**全绿** ⇒ BUG-008 已闭合〕 |
| M8d | `MAX_STALLED_SCAN_ROUNDS` 16 → 8 | 红 (1) | 同上〔上轮全绿〕 |
| M8e | `CLUSTER_TYPE_SAMPLE_LIMIT` 200 → 201 | 红 (2) | `cluster_sample_window_is_bounded_…`、`the_ui_descriptions_still_promise_those_same_numbers`〔上轮全绿〕 |
| M-chunk | `TYPE_PIPELINE_CHUNK` 500 → 600 | 红 (2) | `the_ui_descriptions_still_promise_those_same_numbers`、`type_distribution_clamps_an_oversized_window_instead_of_erroring` |
| M8f（对照） | `MAX_TYPE_SAMPLE_LIMIT` 5000 → 5001 | 红 (2) | 同上两条（与上表 M8b/M8d/M8e 形成"字面量锁定生效"的正反对照） |

**M-addr 的负面事实必须留在台账里**：`impl SlotRoutedConnection for ClusterConnection` 的那一行（`ops_workbench.rs:493`）在进程内**不可证伪** —— 三个替身各自实现同一个 trait，把"用哪个 API 发出去"这一层整个替掉了。可寻址**决策**已被 M-callslot / M-scanaddress / M-typeslot 钉住，地址**形状**已被 M-slotaddr 钉住，唯独"生产实现是否真按槽投递 + 是否真不触发槽表刷新"只能由真连核 ⇒ **R 项 9a 已改写为该项唯一防线**（按分片看 MONITOR、`-MOVED` 计数必须为 0、任何分片都不得出现 `CLUSTER SLOTS` / `CLUSTER SHARDS`）。这一条不成立时属"能返回但每次刷新抢全局写锁"的形态，裁定 1 已明确**不得降级为性能问题**。

### 契约冻结核对（对 Wave 2 冻结 TS 类型直接负责）

前任裁定"字段名/可空性照旧"，本实例**重跑并给出自己的测量**（不引用上轮数字）。方法：抽取两个输出结构体的**声明面**（`#[serde]`/`#[derive]` 属性行 + 字段声明行，剔除 doc 注释与空行），比对 `b1e1f4010`（首轮冻结契约那一版）与工作区 HEAD+收尾改动：

- `TypeDistribution`：声明面 **209 B / 8 行 → 209 B / 8 行，md5 相同**（`counts` / `sampled` / `dbsize` / `truncated` 四名四型未动）。
- `KeyObjectInfo`：声明面 **358 B / 12 行 → 358 B / 12 行，md5 相同**（含 `#[serde(rename = "type")]`、`memoryBytes` 的 camelCase、四个 `Option<…>` 的可空性）。
- 整块结构体文本从 573 B 涨到 934 B，**增量的 100% 是 doc 注释**（BUG-007 裁定 4 要求把 Cluster scope 写进字段文档）⇒ 不触契约。
- `git diff --numstat b1e1f4010 -- commands.rs` = **26 增 / 3 删**，逐行读为两条 `description` + `sampleLimit` 的 `description`（改为常量渲染）；其中唯一含契约 token 的那一行，替换后仍保留 `"type": "integer"` 与 `"minimum": 0`，`maximum` **依然不存在**，`required`（`&[]` / `&["key"]`）、`permissions`、`output_schema: None` 零改动。
- ⇒ **Wave 2 无需因本轮返工 TS 类型**；对外只需按「契约偏离」重写后的 Cluster 口径出文案。

### 门禁实测（收尾轮本机真跑，全部为实测非推算）

| 门禁 | 实测 | 与基线/上轮 |
| --- | --- | --- |
| `cargo test -p datazen-driver-redis` | lib **226 / 0 失败 / 1 ignored** + 集成 **4 / 0** + doc 0 | 上轮 217+4；净 +9 = BUG-007 那笔 **+6**（新增 12 条、其中 6 条是把既有 cluster 用例**改名**以反映新形态，故 Tester 若在旧名上找用例会"找不到"而非"被删"）+ BUG-008 那笔 **+2** + 收尾轮 **+1**（`master_route` 形状用例）。`ignored` 恰 1，仍是 `connect.rs` 既有真连用例 |
| `cargo fmt -p datazen-driver-redis -- --check` | **exit 0** | 一致 |
| `cargo fmt --all -- --check` | **exit 1**，Diff 三处全在 `src-tauri/`：`src/commands/ai/integration_tests.rs:1244`、gitignored codegen `src-tauri/src/driver_init.rs:4,19` | 与「环境性既有红」登记逐字一致，本轨零改动面 |
| `cargo clippy -p datazen-driver-redis --all-targets` | exit 101：`(lib) 17 warnings`、`(lib test) 18 warnings (17 duplicates)`、`datazen-driver-api (lib) 3`、**2 条 deny** `approx_constant`（`ops.rs:905:38`、`ops_exec.rs:260:57`）；`-->` 命中点全枚举，**`ops_workbench*` / `commands.rs` 零命中** | **不劣于基线**（收尾轮第 1 项改动正是把前任多出的那 1 条诊断消掉） |
| `npx tsc --noEmit -p tsconfig.json` | **exit 0** | 本轨零 TS 改动 |
| `node scripts/check-driver-import-boundaries.mjs` | **exit 0** · 1403 files · **0 blocking** · 4 advisory · 2 allow-listed | 与上轮逐字一致 |
| 生产路径裸 `unwrap()`/`expect()` | 对 `ops_workbench.rs` 与 `commands.rs` 分别 `grep -c` 这两种调用形态，结果均 **0 命中** | 合规（`#[cfg(test)]` 全在独立文件，不计） |
| `cargo llvm-cov -p datazen-driver-redis --lib`（`CARGO_TARGET_DIR=target/cargo-wt-cov`） | `ops_workbench.rs`（本轨唯一生产改动面）**区域 84.77%（545 中缺 83）· 函数 93.62%（47 中缺 3）· 行 87.17%（382 中缺 49）** ⇒ ≥80% 硬标准满足。与上轮（88.59% / 100% / 91.49%）相比的下降**全部由 BUG-007 新增的行数造成**：分母从 491/40/329 涨到 545/47/382（新增 trait 默认实现、Cluster 实现体、`master_route`、`routed_*`），缺 3 个函数即这几行里进程内不可执行的那几个（`--branch` 需 nightly，Branches 列 `-`） | **实测**（收尾轮自跑，非沿用）。与上轮（88.59% / 100% / 91.49%）的**函数覆盖从 100% 掉到 93.62%** 需归因：BUG-007 新增的行数把分母从 491/40/329 抬到 545/47/382（trait 默认实现、Cluster 实现体、`master_route`、`routed_*`），本实例**未逐函数导出**是哪 3 个（`cargo llvm-cov ... -- --show-missing-lines` 需显式 profdata 路径，收尾轮未跑通）⇒ 记为 Tester 复测时的一个自由核验点，不据此开 Bug |

### 文件规模登记（供协调者裁定是否触发拆分条）

`ops_workbench.rs` **849** 行（生产，本轨唯一生产改动面）、`ops_workbench/tests.rs` **1200** 行、`ops_workbench/tests/cluster_topology.rs` **1017** 行（+26 行收尾轮用例）、`tests/fix_round1.rs` **228**、`tests/fix_round1_retest.rs` **265**、`commands.rs` **771**、`tests/workbench_commands.rs` **134**。两个测试文件已过千行，**拆分属文件规模治理条、需协调者裁定**，本轨不自行开新文件（避免与 Wave 2 的 diff 面冲突）。

### 交回协调者 / 留给 Tester

1. **M-addr 盲区**（本记录变异表首行）⇒ R 项 9a 是 BUG-007 的唯一真连防线，已按"逐分片 MONITOR + `-MOVED` 计数 0 + 零 `CLUSTER SLOTS`"三条改写并加了"不得降级为性能问题"的判定；Tester 简报请原样引用，别再用"7 次往返"这种旧口径。
2. **对外文案已与常量同源自锁**：`commands.rs` 的 description 现由 `format!` 渲染，数字改任何一处都会先在 CI 红 ⇒ 后续若要调预算（例如 64→128），必须同时改文档与用例期望，这是刻意的摩擦。
3. 本实例**未跑** `pnpm install` / `pnpm build` / `pnpm e2e` / `pnpm tauri:build:webdriver`（任务书禁止项），未碰 `ui/**`、`locales/**`、宿主 `src/**`、`driver-sdk/**`、`Cargo.toml`、`scripts/resolve-drivers.mjs`，未提交任何 gitignored codegen。
4. **BUG-006 修法 3（`select_db` 短路）与 BUG-003 修法 3（迁公开 `send_packed_commands`）仍按裁定不在本轨整改面**；后者若要闭合，前提是 M-addr 盲区先由真连证一次。
5. `bugs.md`：BUG-007 / BUG-008 已各追加「修复备注（第 3 轮）」并流转为 **待复测**，汇总表同步；归档文字（含上两轮已被证伪的旧口径）一律未删。

## 留待 R 回归


子代理不跑 `pnpm e2e`；以下需真连 Redis（或真实服务端差异）才能证伪，登记给 R / Wave 2 Tester。P0 阶段上下文条与侧栏 UI 尚未落地（Wave 2），故 1–8 先以 `execute_driver_command` 命令级真连回归，Wave 2 落地后同一批用例升级为 GUI/E2E。〔Tester 首轮复测后：1/3/4/6/9/10/11 已按 `bugs.md` 加强或修正（带 `〔Tester〕` 标记），并新增 12–16 五条 mock 无法证伪的边界；项 9 已按 BUG-001/002 改写为"预期失败即确认 Bug"。〕〔**修复第 1 轮后**：项 9a/9b/9c/9d 与 4/13/15 的**期望值已随拓扑分支更新**（带 `〔修复第 1 轮〕` 标记）—— 现在"报 `CrossSlot` / 整条 `Err`"才是回归，"成功但字段按项降级"是期望行为；进程内的 `ClusterFoldingConn` 只能防形状回归，真连仍是唯一能证伪 redis cluster 分发层真实形态的手段。〕

1. **大库采样语义**：≥50k 键的 db 上跑 `type_distribution` ⇒ `dbsize` 等于服务端 `DBSIZE`、`sampled ≤ 5000`、`truncated: true`；UI 落地后必须显式可见"采样 N/M"标注（PRD §3.4），否则视为回归失败。
   〔Tester 加强 —— 断言点补齐为三条，缺一即失败：(a) `truncated == (sampled < dbsize)` 与 `Σcounts == sampled` 同时成立（后者是标注数字自洽的前提，见「契约偏离」第 4 条）；(b) 上下文条渲染的是 `sampled/dbsize` 两个真实数字而非"精确分布"文案，`truncated: true` 时**任何**"总数"字样都必须带"采样"前缀；(c) `truncated: true` 且 `counts` 为空对象时（极端：全部键在 SCAN 与 TYPE 之间消失）UI 不得回退成"显示 0 键"，须与 §3.4 的失败空态区分。责任切分：R 只核后端数据形状，(b)(c) 的渲染归 Wave 2 Tester。〕
2. **小库精确态**：键数 < 1000 的 db ⇒ `truncated: false` 且 `Σcounts == DBSIZE`；空 db ⇒ `counts: {}`、`sampled: 0`、`truncated: false`。
   〔**修复第 1 轮限定 → 修复第 3 轮（BUG-007 裁定 4）整条替换**：上一版这里写"Cluster 上 `truncated` 恒真（`from_sharded_view`），看到 `false` + 非空 `counts` 即判回归"—— **该判据作废**，照它核对会把正确实现判成回归。现在的口径是三拓扑同一条 `truncated = sampled < dbsize`（`is_sample_truncated`，`ops_workbench.rs:191`；`from_sharded_view` 已删除），Cluster 上 `sampled` 只覆盖锚定分片、`dbsize` 是全集群 `Aggregate(Sum)` ⇒ **只要集群里还有第二个非空分片，`truncated` 必为真**；`truncated: false` + 非空 `counts` 在"全部键恰好在被扫的那个分片上"（单分片集群 / 小集群 + 键集中）时是**正确答案**，不是回归。真连判据换成项 9b-补 的双向核。〕
3. **钳制不报错**：`sampleLimit = 6000` ⇒ 实际采样上限 5000 且返回成功；`sampleLimit = 0` / 缺省 ⇒ 1000。
   〔Tester 补充事实：`type_distribution` 的 `input_schema` **未写** `maximum`（有意"钳制不报错"），故 6000 由后端静默降到 5000 ⇒ Wave 2 的输入框不得回显"已按您填写的 6000 采样"，也只能显示返回体里的 `sampled`。R 请同时核对返回 `sampled ≤ 5000` 而非 6000。〕〔**修复第 1 轮补**：Cluster 连接上还要再钳一次到 **200**（`CLUSTER_TYPE_SAMPLE_LIMIT`，`sample_window_for` `ops_workbench.rs:173`）⇒ 同一入参在 Cluster 上的期望是 `sampled ≤ 200`，且**仍不报错**；项 1 的"≥50k 键"同理（Cluster ⇒ `sampled ≤ 200`）。〕〔**修复第 3 轮补 —— 200 是上界而非期望值**：Cluster 的采样窗现在钉在 `CLUSTER_SCAN_ANCHOR` 的**单一分片**上 ⇒ 该分片键数不足 200 时 `sampled` 就到顶，返回成功且**不报错**、`truncated` 按 `sampled < dbsize` 自然为真。判定只看两条：`sampled ≤ min(200, 窗口)` 与"零 `CrossSlot` / 零报错"；不得因为"要了 100 却只回 40"判回归。〕
4. **`KEYS` 禁令（MONITOR 侧证）**：以 `MONITOR` 抓包确认全过程只有 `DBSIZE` × 1、`SCAN`（游标推进至窗口满或归零）、`TYPE` 的 pipeline 批，**零** `KEYS`、零逐键 `TYPE` RTT。
   〔Tester 修正核对表 —— 必须再允许 **1 次 `SELECT`**：命令级真实路径是 `with_live_op!` → `RedisDriver::select_db`（`redis_driver_on.rs:14-23` 无短路），故 `key_object_info` 实际是 `SELECT` + 1 pipeline = **2 次往返**，`type_distribution` 是 `SELECT` + `DBSIZE` × 1 + `SCAN` × 轮数 + `TYPE` × `ceil(n/500)`。哨兵断线重连分支（`redis_driver.rs:36-45`）会**整条重放** ⇒ 计数恰为 2 倍属正常。若按原表逐字核对，会把正确实现误判为回归（详见 `bugs.md` redis-cmds-p0-BUG-006）。〕
   〔**修复第 1 轮补 → 修复第 3 轮（BUG-007 裁定 1 / 3）整条重写** —— 本表只对 standalone / sentinel 成立。Cluster 连接必须**按分片分别** `MONITOR`（这是唯一能证伪"寻址到底有没有发出去"的手段，见项 9a 末尾的"进程内盲区"）：
   - `key_object_info`：`SELECT` 落在所连分片；**6 条探测（`MEMORY USAGE` / `OBJECT ENCODING` / `OBJECT IDLETIME` / `OBJECT FREQ` / `PTTL` / `TYPE`）必须全部出现在"持有该键的分片"上**，恒零 pipeline。缺陷形态（修复前）是"只有 `TYPE` / `PTTL` 到键分片，另外 4 条先被投到 `slot("USAGE")` / `slot("ENCODING")` / `slot("IDLETIME")` / `slot("FREQ")` 的分片再被弹回" ⇒ **在别的分片上看到这 4 条中任何一条**，或任何分片日志出现 `-MOVED` / `CLUSTER SLOTS` / `CLUSTER SHARDS` ⇒ 寻址被改回未寻址，判 BUG-007 回归。
   - `type_distribution`：`SELECT` + `DBSIZE`（`MultiNode(AllMasters, Aggregate(Sum))` ⇒ **每个主节点上各看到一次 `DBSIZE`**，这是全集群求和的正常形态，不是重复发送）+ `SCAN` × 轮数（**全部只落在同一个分片** = `cluster_scan_anchor_slot()` 所属分片，且游标逐轮连续、最终归零）+ `TYPE` × `sampled`（逐键一条，因锚分片返回的键必属该分片 ⇒ 实际与 `SCAN` 同分片）。若在 Cluster 上看到一条含多个不同键的批 ⇒ 拓扑分支被改回批形态，判 BUG-001 / 002 回归；若 `SCAN` 轮次散落在多个分片、或下一轮被服务端判 `-ERR invalid cursor` ⇒ 游标定桩失效，判 BUG-007 回归。〕
5. **六种类型 + 模块类型**：对 `string/hash/list/set/zset/stream`（含 `listpack`、`hashtable` 编码各一）逐个跑 `key_object_info` ⇒ `type`/`encoding`/`memoryBytes`/`idleSeconds` 有值、`missing: false`；有 RedisJSON 时补验 `ReJSON-RL`（`encoding` 预期 `null`）。
6. **过期/删除键空态**：删除或等键过期后再查 ⇒ `missing: true`、`ttlMs: -2`、其余 `null`，HTTP/命令层为成功；侧栏须显示"键已过期"而非红色错误。
   〔Tester 补齐判别键：侧栏判"已过期"的**唯一**依据是 `missing === true`（等价 `type` 回答 `none`），且此时 `ttlMs` 必为 `-2`；若真连出现 `missing: true` 但 `ttlMs != -2`，或 `missing: false` + `type: null` + `ttlMs: -2` 之类混合态，说明 TYPE 与 PTTL 两槽位读串了位 ⇒ 记回归（单测已由 `test_tester_expired_and_unknown_key_states_are_distinguishable` 钉死，真连只需复述该三元组）。〕
7. **非 LFU 的 FREQ 槽**：`maxmemory-policy` 设为 `noeviction`/`allkeys-lru` ⇒ `freq: null` 且 `memoryBytes/encoding/idleSeconds/ttlMs` 全部仍返回；切 `allkeys-lfu` ⇒ `freq` 有值。整条命令任何情况下不得失败。
8. **MEMORY USAGE 不可用槽**：Redis < 4.0（或不支持 `MEMORY` 的托管实例）⇒ `memoryBytes: null`，其余字段正常。
9. **拓扑覆盖（本轨最高风险项）**：
   - 9a **Cluster × `key_object_info`**：真连 Redis Cluster 7.x（`maxmemory-policy` 保持默认 `noeviction`），db0 建任意键 ⇒ 调 `key_object_info`。**契约期望**：成功，`freq: null`、其余字段有值。**〔修复第 1 轮后的期望实际〕**：**仍应成功**（该 6 条命令在 Cluster 上逐条发出，`OBJECT FREQ` 的服务端错误按项降级，见 `routed_single` `ops_workbench.rs:571` + `fold_command_answer` `:552`），即 BUG-001 已修。**判定**：出现任何整条 `Err`（尤其错误串含 `object access frequency counter is not available` 或 `cluster_async/mod.rs:668-681` 的折叠形态）⇒ BUG-001 **修复失效**，按未修处理（不得判为"环境问题/测试实例配置不当"）；同时用 MONITOR 侧证这一趟是 6 条单命令而非 pipeline（见项 4）。〔**收尾轮补 —— BUG-006 修法 2**：MONITOR 上这 6 条之前**必有 1 次 `SELECT`**（`with_live_op!` → `RedisDriver::select_db` 无短路），Sentinel 重连分支会整条重放 ⇒ 计数翻倍属正常；按"6 条"逐字核对而漏算 `SELECT` 会把正确实现判成回归。Cluster 上的命令级总成本 = 1 SELECT + 6 单命令 = **7 次往返**。〕〔**修复第 3 轮补 —— 本项现在是 BUG-007 的唯一防线，务必按分片核对**：`command_at_slot` 的 Cluster 实现体走公开的 `ClusterConnection::route_command(cmd, master_route(slot))`（`ops_workbench.rs:471-505`），**这一行在进程内不可证伪** —— `ScriptedConn` / `ShortReplyConn` / `ClusterFoldingConn` 三个替身各自实现同一个 trait，把"用什么 API 发"这一层替掉了；收尾轮的变异实测已把这件事钉成一个**负面事实**（把该实现体改回 `req_packed_command` ⇒ **226 条用例全绿**，见「Coder 修复记录（第 3 轮）」的变异表 M-addr）。可寻址**决策**（把哪个槽交出去）已由 `ClusterFoldingConn` 的"寻址到错误分片也照样拒"规则钉住（三条调用点变异各 2~5 条红），槽位形状由 `the_address_we_build_names_exactly_the_master_of_the_given_slot` 钉住；**剩下只有真连能核**：`-MOVED` 计数必须为 **0**、任何分片上不得出现 `CLUSTER SLOTS` / `CLUSTER SHARDS`（一次探测都不许触发槽表刷新）、6 条探测全部出现在**键所属分片**的 MONITOR 上。这三条任一不成立 ⇒ BUG-007 修复失效（且属"能返回但每次刷新抢全局写锁"的形态，不得降级为性能问题）。〕
   - 9b **Cluster × `type_distribution`**：db0 写入 ≥20 个键（几乎必然跨 slot）⇒ 调 `type_distribution`（`sampleLimit: 100`）。**〔修复第 1 轮后的期望实际〕**：**成功**，`counts` 之和 == `sampled` ≤ 100、`truncated: true`，**零** `CrossSlot`。判定：报 `CrossSlot … Received crossed slots in pipeline`（`cluster_async/routing.rs:71-105`）⇒ BUG-002 修复失效。standalone 同输入必须成功（两条路径均已有单测）。〔**收尾轮补**：同样先有 **1 次 `SELECT`** ⇒ 命令级序列为 `SELECT` + `DBSIZE` × 1 + `SCAN` × 轮数 + `TYPE` × `sampled`（见项 4 的 Cluster 核对表）。〕〔**修复第 3 轮补**：`SCAN` 的每一轮都被寻址到 `cluster_scan_anchor_slot()`（`scan_round` `ops_workbench.rs:649`）⇒ MONITOR 侧必须看到**同一分片、游标逐轮连续**；`DBSIZE` 则**故意不寻址**，故每个主节点各出现一次（`MultiNode(AllMasters, Aggregate(Sum))`），这不是重复发送。若锚定分片上完全看不到 `SCAN`、或 `SCAN` 出现在多个分片 ⇒ 定桩失效（BUG-007 裁定 3 回归）。另：锚定分片为空时 `sampled = 0` 且命令**成功**（属正常形态，不是回归），此时想验证采样需换集群或换 `CLUSTER_SCAN_ANCHOR`（改常量会换分片，须同步 `commands.rs` 文案与用例，见项 3 末注）。〕
   - 9b-补 **Cluster 的"分布不是普查"（修复第 3 轮按裁定 4 改写为**双向**核）**：在 ≥2 个分片都有键的集群上跑 ⇒ `dbsize` = **整个集群**（所有主节点之和）、`sampled` = **锚定那一个分片**的采样数 ⇒ 期望 `truncated: true`（`sampled < dbsize` 自动成立）。判定分两向：**(a) 该真却假** —— 出现 `truncated: false` 而 `Σcounts < 全集群实际键数` ⇒ 回归（把采样谎称普查，违反 PRD §3.4）；**(b) 该假却真** —— 键未变、`sampleLimit` 未变的情况下**连续两次**调用得到 `dbsize` 相差很大的两组数字 ⇒ `DBSIZE` 聚合或采样分片漂了（锚定失效/某主节点不可达），亦记回归。旧判据"`truncated: false` + `sampled == dbsize` 即回归"**作废**：单分片集群或"全部键恰好落在锚分片"时那是正确答案（`sampled == dbsize` 只可能是这个含义）。同时 `Σcounts == sampled` 在两拓扑上恒成立，作为标注数字自洽的前提一并核对。
   - 9c **Sentinel**：与 standalone 同型（`RedisLiveConn::Sentinel { connection: MultiplexedConnection }`）⇒ 两条命令均应成功、单项降级应生效、**批形态仍是一条 pipeline**（`Topology::Sentinel` 显式与 Cluster 分开，已有单测 `sentinel_uses_the_single_node_batch_and_its_per_item_errors`）；额外做一次**主从切换**，确认 `redis_driver.rs` 的整体重放不会把 `missing` 误报、也不会让 `type_distribution` 出现重复计数。〔**修复第 3 轮补 —— 本项另需证伪一件事**：`SlotRoutedConnection` 对 `MultiplexedConnection` 取**默认实现**（"单节点上寻址是空话"）。若有人把 Cluster 分支的判定改宽（例如把 Sentinel 误并进 `Topology::Cluster` 臂 ⇒ 探测被"寻址"到不存在的分片），Sentinel 真连会表现为整条命令失败或字段全空；本项因此是"trait 默认实现未被绕过"的唯一真连证据，不得省略。〕
   - 9d 两种拓扑下均补"当前 db 为空"与（Cluster）"采样窗口跨多个分片"两例。**〔修复第 1 轮补〕** Cluster 侧再补一例 `sampleLimit: 5000` ⇒ 返回 `sampled ≤ 200`（`CLUSTER_TYPE_SAMPLE_LIMIT` 生效）且不报错；**〔修复第 3 轮按裁定 4 改写 —— 判据由"空分片"换成"整个集群为空"〕** 空集群（**所有**主节点的该 db 都为空）⇒ `counts: {}`、`sampled: 0`、`dbsize: 0`、`truncated: false`；只要**任一**分片非空而锚分片为空 ⇒ `sampled: 0`、`dbsize > 0`、`truncated: true`（旧版写的"空分片 ⇒ `dbsize: 0` 且 `truncated: false`"在 ≥2 个非空分片的集群上**永不成立**，照它核对会把正确实现判成回归）。
   - 9e 附带观察（**不归本轨**，供协调者裁定另立基线条目）：Cluster 下既有 `list_children`（`ops_tree.rs:148-156`）应同形报 `CrossSlot` —— 若成立，则说明该故障类别是基线既有缺陷，修复面比本轨更大。
10. **权限与 SafeMode**：只读 profile / SafeMode 开启时两条命令仍可用（`CommandCategory::Observe` + `Read`，单测 `workbench_commands_are_read_only_observations` 已从 `required_access_level()` 侧锁定），同时确认权限不足时的回退文案由 Wave 2 承担。
    〔Tester 补：Cluster/托管实例上若 `INFO`/`MEMORY`/`OBJECT` 被服务端 ACL 拒，`type_distribution` 与 `key_object_info` 各自的错误形状需真连确认 —— 特别地，`redis:allow-memory-sample` 只覆盖本地授权位，服务端 ACL 拒绝时侧栏必须走 §3.4 的失败空态而非 0 值。〕
11. **Wave 2 依赖项：未知态 vs 已过期区分渲染（归属已可判定）**：`type: null` 的"未知态"与"过期态"在侧栏必须可区分（见「契约偏离」实现口径第 2 条）。
    〔Tester 结论：**后端已可判别，无需新增契约字段** —— 判别键 `(missing, type, ttlMs)`：已过期 `(true, null, -2)`、未知 `(false, null, -1)`、正常 `(false, <type>, ≥-1)`；已由 `test_tester_expired_and_unknown_key_states_are_distinguishable` + `test_tester_key_object_info_json_shape_is_the_wave2_contract` 锁定。故本项**不阻塞 Wave 2 冻结 TS 类型**；渲染责任归 Wave 2：三种形状必须映射到三种视觉（过期空态 / 读取失败空态 / 正常），且未知态**禁止**显示 `ttlMs: -1` 的"永不过期"文案。Wave 2 Tester 请以这三行三元组作为用例断言表。〕
12. **非 UTF-8 键名（新增，mock 无法证伪）**：`redis-cli -x SET "$(printf 'bin\xff\xfekey')" v` 建二进制键，并另建一个 lossy 后同名但字节不同的键（如含 `\ufffd`）⇒ 在树/侧栏打开该键 ⇒ 核对 `key_object_info` 的 `type/encoding` 是否属于**真正的这个键**。判定：`type: null` 或属性串到别的键 ⇒ 记回归（本轨未新增解码点，故首轮记为 R 项而非 Bug；若真连证实属性错读到别的键，升级为新 Bug 并连带既有 `scan_keys` 通道）。同时确认 `counts` 里出现的 U+FFFD token 不会让 UI 崩。
13. **`SCAN` 无界风险压测（新增，对应 BUG-005）**：走一遍代理/降权副本（或 `MONITOR` 侧观察一个游标永不归零、恒空批的实现）⇒ `type_distribution` 必须在有限时间内返回。若命令永久 pending ⇒ 直接确认 BUG-005，并同时观察该连接上其他命令是否被 `connections.write()` 写锁连带阻塞（这是本项真正的风险量级）。
    〔**修复第 1 轮更新判据**：守卫已落地 —— `MAX_SCAN_ROUNDS = 64` / `MAX_STALLED_SCAN_ROUNDS = 16`（`ops_workbench.rs:147,153`，触发时 `warn!` 带 `rounds/stalled/cursor/limit`）。真连只需核 **MONITOR 上 `SCAN` 条数 ≤ 64**、命令在有限时间内返回 `sampled`（可能为 0）且 `truncated: true`；若 `SCAN` 条数 > 64 或返回 `truncated: false` ⇒ 回归。〕〔**修复第 3 轮措辞收窄 —— BUG-008 修法 3**：上一版这里写的"单测已按'恰 16 / 恰 64 轮'钉死，不是'≤'式弱断言"**过强且当时不成立**（那两条用例钉的是"哪条守卫先生效"，期望值直接取自常量，改数字零反馈 —— 即 Tester 变异实测的 M8b/M8d 全绿）。**现已分两侧补齐**：数字由 `fix_round1::scan_budgets_are_the_numbers_the_docs_quoted` 用**字面量**钉住（64 / 16 各一条 `assert_eq!`，另钉两条守卫次序与"最大窗口 10 轮可填满"的标定关系），"哪条先生效"仍由原两条行为用例钉住 ⇒ 本项的"`SCAN` ≤ 64"现在**确实有单测背书**，漂移会先在 CI 红而不是等 MONITOR。真连本项仍不可省：它核的是"真实坏代理下命令会在有限时间返回"，这是 mock 无法替代的。Cluster 侧另需注意：`SCAN` 现在每轮都被寻址到锚定分片 ⇒ MONITOR 要打在**那个分片**上才数得到，打在别处数到 0 条不是回归。〕
14. **`dbIndex` 越界（新增）**：db2 已存在、db7 不存在（`databases 2`）⇒ `type_distribution { dbIndex: 7 }` 与 `key_object_info { dbIndex: 7, key: "x" }` ⇒ 必须**报错上抛**（`SELECT` 失败），不得静默按 db0 返回数据。判定：返回了 db0 的分布 ⇒ 严重回归（`commands_exec.rs:49-55` 只默认 0、无上界校验，全靠服务端 `SELECT` 兜底）。
15. **redis crate 升级必查项（新增，对应 BUG-003）**：`Cargo.toml` 的 `redis = "0.27"` 允许 0.27.x 漂移，而 `req_packed_commands` 是 `#[doc(hidden)]` 内部 API（`aio/mod.rs:75-79` 自陈"Users shouldn't call it"）。升级 redis 依赖的那一轨**必须**复核：offset/count 语义、回复顺序、回复条数是否仍等于请求条数，并跑 9a/9b。判定：若 `key_object_info` 在升级后返回"全 null + `missing: false`"而无任何 warn ⇒ 属静默劣化，按 BUG-003 追修。
    〔**修复第 1 轮更新**：该静默面现已收口 —— 条数不等于 6 时 `warn!` + 整条 `Err("key_object_info: expected 6 replies for 6 commands, got N")`（`ops_workbench.rs:824-838`，与「契约偏离 · 回复条数兜底」同址；第 3 轮行号已随 BUG-007 的扩容漂移），并由 `fix_round1::key_object_info_refuses_a_truncated_reply_vector_instead_of_guessing` 锁住错误串。故升级那一轨现在只需：跑 `cargo test -p datazen-driver-redis` 看该用例是否红 + 真连跑 9a/9b；若升级后出现"命令直接报错"，那是**守卫生效**而非新 Bug，应按本项复核排布是否变化后另立条目。〕
16. **采样与侧栏的权限/降级组合（新增）**：只读 profile 下同时禁用 `OBJECT` ⇒ `key_object_info` 应整条报"权限不足"（服务端错误）而非返回全空；`type_distribution` 在禁用 `SCAN` 的实例上应报错上抛（已有单测 `rejected_scan_aborts_the_distribution_before_typing_anything` 覆盖形状）。判定：任何"权限不足"路径都不得被读成"键不存在"或"库为空"。

## 协调者裁定（三条上交项 · 2026-09-22，供 Tester 与 Wave 2 简报直接引用）

1. **BUG-006 修法 3（`select_db_on` 增加 `current_db` 短路）⇒ 本轨不做，另立 P1 轨 `redis-select-shortcircuit`。**
   理由：属全驱动行为变更（每条命令都少 1 次往返，收益面远大于本轨），与 Tester 原文"不建议在本轨顺手做"一致。
   **Wave 2 硬口径**：命令级往返预算按 **standalone/sentinel 2 次**、**Cluster 下 `key_object_info` 7 次（1 SELECT + 6 单命令）**、**Cluster 下 `type_distribution` = 1 + 1 + SCAN 轮数 + sampled** 起算 ⇒ 上下文条自动刷新间隔与并发数必须按此量级设计，不得按 op 层的"1 次 pipeline"估预算。
2. **BUG-003 修法 3（改用公开的 `MultiplexedConnection::send_packed_commands`，把 `#[doc(hidden)]` 依赖清零）⇒ P0 拒绝，转依赖治理条。**
   理由：修复轮的回复条数守卫（`ops_workbench.rs:641-656`）已把"静默读成空态"变成"warn + 整条 Err"，风险等级从中降为可观测；采纳该修法要重写 `ScriptedConn` / `ShortReplyConn` / `ClusterFoldingConn` 三个进程内替身，并与 BUG-001"同一批命令、两拓扑共用一套解析器"的实现正面冲突。`redis = "0.27"` 是否锁小版本属依赖治理轨（本轨禁止碰 `Cargo.toml`，裁定正确）。落点已存于 R 项 15。
3. **BUG-002 修法 4 / R 项 9e（既有 `list_children` 在 Cluster 下同形报 `CrossSlot`）⇒ 同意另立基线缺陷轨 `redis-cluster-list-children`，不并入本轨整改面。**
   理由：`ops_tree.rs:148-156` 与本轨无关，并入会污染 diff。**Wave 2 硬口径**：键树/层级浏览在 Cluster 上**不得假定可用**；先由 R 阶段 9e 确认可复现再定级，若成立则该轨优先级提到 Wave 2 之前。

## 协调者裁定（第 3 轮 · BUG-007 / BUG-008，2026-09-22）

**BUG-007（中）**
1. P0 硬要求：**绝不向 cluster 发出路由未定义的命令**。`MEMORY USAGE` / `OBJECT ENCODING|IDLETIME|FREQ` 在 redis 0.27.6 路由表里无臂 ⇒ arg_idx(1) 被当键 ⇒ 每条吃 `-MOVED` + `RebuildSlots`，而 `refresh_slots` 首行取 `conn_lock.write()` ⇒ 上下文条自动刷新会**反复抢全局写锁**。这比"成本低估"严重，必须消除，不接受"能返回就行"。
2. 优先方案：用**公开**的 `cluster_routing::get_slot` 自行算槽 + 从 slots 映射选主节点，把探测命令显式投到正确节点（测试里已在用该公开 API，说明可用）。若核实 redis 0.27.6 **没有**公开的按节点发送通道 ⇒ **立即停下返回 `BLOCKED`**，不要退化成"逐条发 + 容忍 MOVED 风暴"。
3. `SCAN` 无路由 ⇒ 每轮可能换分片：cluster 上采样必须固定单分片游标（或对 `sampled` 如实标注来源分片），不得让"跨分片混采"伪装成一个视图。
4. **`dbsize` 语义必须重推**：`DBSIZE` 在 cluster 上是 AllMasters + `Aggregate(Sum)` ⇒ 全集群求和，不是"被连分片的数字"。修复轮写下的三条 cluster 口径按事实重写；`truncated` 强制真的**理由**要换（成立与否由你按新事实重判，不许因循旧结论）。
5. 面向 UI 的 description 与「契约偏离」同步更正；字段名/可空性照旧不得动。
6. 上一轮"按拓扑分支"的结论仍有效，本条只修路由与口径。
7. 每改完一条先 commit，禁止攒到最后（本轨已连续两任死在 turn 上限）。

**BUG-008（低）**：把 `MAX_SCAN_ROUNDS=64`、`MAX_STALLED_SCAN_ROUNDS=16`、`CLUSTER_TYPE_SAMPLE_LIMIT=200` 三个预算数字各用**字面量**钉进用例（对照 `MAX_TYPE_SAMPLE_LIMIT=5000` 那条真被钉住的写法），使"改数字零反馈"消失。

## Tester 复测轮 · 第 3 实例（修复第 3 轮复测 · 2026-09-22 · 起始 HEAD `e8582e71f` · 结论 **TEST_DONE**）

接手现场：起始 `git status --porcelain` **干净**、工作区零改动 —— 第 3 轮 Tester 第 1 实例死时**零 commit、零脏文件**（本轨第四次同类事故），其任务清单自称的"阶段 B 226+4 预期"**没有任何落盘证据**，本实例按"未验证"处理并全部重跑，下表数字全部是本实例自己的实测。构建目录 `/tmp/w1a-r3t-target`（门禁）与 `/tmp/w1a-r3t-cov-target`（覆盖率，单独目录以免争锁），临时脚本与日志全在 `/tmp/w1a-r3t-mut/`、`/tmp/w1a-r3t-logs/`；共享 `target/` 与主检出全程未碰。**只测不修**：生产码 `ops_workbench.rs` 结束态 md5 `466cbae5e91c1064e42ea3de52fd4db1` 与起始逐次一致，`commands.rs` 零改动，本回合唯一提交是测试（`a6304a4fb`）。

**派发书的一处事实更正（复测者必读，别照着找）**：任务书把审阅范围写成 `873ffc5da` + `32403ea0d`，这两笔分别是"收尾轮测试用例"与"台账文档"，**不含 BUG-007 / BUG-008 的任何生产码修复**；按哈希审阅会得出"没有可审的修复"。真实范围是 `ed6bec976..e8582e71f`：**`81cc58a90`（BUG-007 生产码）+ `286d917c4`（BUG-008 测试面）+ `873ffc5da`（收尾轮测试侧）+ 两笔台账 commit**，本实例按整段审阅。

### 阶段 A · 代码审阅（`ops_workbench.rs` +237/−54、`commands.rs` +26/−3、测试面 +817/−111）

1. **协调者第 3 轮七条裁定逐条对到行**：裁定 1/2 ⇒ 局部 trait `SlotRoutedConnection::command_at_slot`（`:471-480` 默认实现 = `req_packed_command`，`:484-495` Cluster 实现 = `self.route_command(cmd, master_route(slot))`），`master_route:500-505` 只用**公开**类型（`RoutingInfo::SingleNode(SpecificNode(Route::new(slot, SlotAddr::Master)))`）⇒ 裁定 2 设的 `BLOCKED` 前置条件确实不成立，未退化为"逐条发 + 容忍 MOVED 风暴"；三条通道确实全部改走它（`issue_batch:615 → routed_sequential:580 → routed_single:575`、`scan_round:663`、`sample_types:743+746`、`key_object_info:823`）。裁定 3 ⇒ `CLUSTER_SCAN_ANCHOR:127` + `cluster_scan_anchor_slot():132`。裁定 4 ⇒ `fetch_dbsize` **故意不寻址**、`from_sharded_view` 已删除（全 crate grep 零命中）、`truncated` 统一由 `is_sample_truncated`（`sampled < dbsize`）决定，"重判后仍几乎恒真但理由换成 scope 不同"这一表述与本实例对 redis 表的理解一致，**不是因循旧结论**。裁定 5 ⇒ 见下第 5 项。裁定 6 ⇒ standalone/sentinel 仍一条 pipeline（`M-sentinel-off` 复跑红 1 条钉着）。
2. **两条"疑似缺陷"经核对排除**（登记方法与结论，免得后续重复怀疑）：
   - "cluster 的 `SCAN` 轮与 standalone 用了不同解析器 ⇒ 同一坏回复两拓扑行为不一致"？⇒ `scan_round:658` 非 cluster 分支直接 `return crate::ops::scan_batch(...)`，cluster 分支末尾走 `parse_scan_result(&raw)`，与 `ops.rs:96-107` 的 `scan_batch` **同一个宽松解析器** ⇒ 无不对称，**不开 Bug**。
   - "`get_slot(key)` 对 `{tag}key` 失聪"？⇒ `cluster_routing.rs:250` 的 `get_slot` 先 `get_hashtag` 再 CRC ⇒ **生产寻址正确**。但"没有任何用例使用带标签的键"成立 ⇒ 转为**测试面空档**，本实例自行补两条并在阶段 C 用变异证明其独有价值（见下）。
3. **文案 nit（不判 Bug）**：`commands.rs:484-491` 的 "so a call is 2 round trips on a single node and {} on Cluster" 里 **7 由 `KEY_INFO_PIPELINE_LEN + 1` 派生、2 是字面量**；该 2 对应"1 次 `SELECT` + 1 次 pipeline"，本就不依赖那个常量，且 `fix_round1::the_ui_descriptions_still_promise_those_same_numbers` 同时以字面量核对 `2` 与 `7` ⇒ **无漂移面**，仅记为可读性问题（若要统一，需先给"命令层 SELECT 次数"一个常量，属 Coder 面）。
4. **测试完整性（本轨高危项，逐文件核）**：`git diff --numstat ed6bec976 e8582e71f` ⇒ `ops_workbench/tests.rs` **7 增 / 0 删**、`tests/fix_round1.rs` **89/0**、`tests/fix_round1_retest.rs` **6/0** —— 前两轮 Tester 的断言**一行未动**；`tests/cluster_topology.rs` 的 **111 删除行**逐条读为旧"最后一个参数即键"乐观替身被 `RoutingInfo::for_routable` 版本整体替换（同一替身体重写，非断言删除）；`#[ignore]` / `#[should_panic]` 增删 **0**；`test_tester_` 前缀用例现 **21 条**（`tests.rs` 12 + `fix_round1_retest.rs` 7 + 本回合 2），无一条被降级或删除。
5. **契约面（对 Wave 2 冻结 TS 类型直接负责）**：用**已提交 blob** 比较（不受工作区变异影响）。声明面抽取（属性行 + 字段行，剔除 doc 注释与空行）后 `TypeDistribution` **138 B / 5 行**、`KeyObjectInfo` **267 B / 9 行**，`b1e1f4010` ↔ HEAD 的 md5 分别 `d5879e81902b7c707455cbebee9e8699` / `23793ef5cd8a00559f090526f2f909c6`，`cmp` **逐字节相同**；本实例口径与收尾轮自报的 209 B / 358 B 相差的是"是否把 `#[derive]` 整块算入"（本实例算入后是 208/8 与 357/12，差一个行尾换行），**结论一致**。`commands.rs` 的 3 删除行全部是 description 文案 ⇒ **Wave 2 无需因本轮返工 TS 类型**。
6. 生产路径裸 `unwrap()` / `expect()`：`ops_workbench.rs` 与 `commands.rs` 分别 `grep -c` 两种形态，均 **0 命中**（`#[cfg(test)]` 替身不计）。

### 阶段 B · 门禁独立复跑（全部本机真跑，`CARGO_TARGET_DIR=/tmp/w1a-r3t-target`）

| 门禁 | 本实例实测 | 与收尾轮自报 |
| --- | --- | --- |
| `cargo test -p datazen-driver-redis` | lib **226 / 0 失败 / 1 ignored** + 集成 `tests/workbench_commands.rs` **4 / 0** + doc-test **0**；`ignored` 恰 1 且是 `connect::tests::local_live_connect_prefer_plaintext_require_times_out`（需本机 6379） | **逐字一致** ⇒ 上一任"226+4"的说法本实例独立复现成立 |
| `cargo fmt -p datazen-driver-redis -- --check` | **exit 0，零 diff** | 一致 |
| `cargo fmt --all -- --check` | **exit 1**，3 个 Diff 块全在 `src-tauri/`：`src/commands/ai/integration_tests.rs:1244`、gitignored codegen `src-tauri/src/driver_init.rs:4` 与 `:19` | 与「环境性既有红」登记逐字一致，本轨零改动面 |
| `cargo clippy -p datazen-driver-redis --all-targets` | **exit 101**：`(lib) 17 warnings`、`(lib test) 18 (17 duplicates)`、`datazen-driver-api (lib) 3`、**2 条 deny** `approx_constant`（`ops.rs:905:38`、`ops_exec.rs:260:57`）；`--message-format short` 命中点全枚举（`redis_driver.rs` 5、`decode/pickle.rs` 3、`ops_value_search.rs` 3、`redis_driver_on.rs` 2、`ops_io.rs`/`redis_value_preview.rs` 各 1 + 2 deny），**`ops_workbench*` 与 `commands.rs` 零命中** | **不劣于基线**（17/18/3 + 2 deny 逐字一致） |
| `npx tsc --noEmit -p tsconfig.json` | **exit 0** | 一致（本轨零 TS 改动） |
| `node scripts/check-driver-import-boundaries.mjs` | **exit 0** · 1403 files · **0 blocking** · 4 advisory · 2 allow-listed | 逐字一致 ⇒ 边界护栏保持 |

### 阶段 C-1 · 变异复证（派发书点名的 64/16/200 与 cluster 顺序路径，共 13 项复跑 + 2 项新变异 + 2 项反向对照）

方法（沿用本轨已栽过坑的有效性闸门）：施加前 `git diff --quiet` 确认起点干净、模式命中数必须**恰为 1**（否则判 `BAD-PATTERN` 不记录结果）、施加后必须产生 diff（否则判 `NO-OP`）、跑完 `git checkout --` 复原并核对 md5 回到基线 `466cbae5e91c1064e42ea3de52fd4db1`。三组结果：`/tmp/w1a-r3t-logs/C-set1.log`、`C-set2.log`、`E-set3.log`、`E-negative-control.log`，全部 `RESTORED-OK`。

| 变异（打在生产码） | 本实例实测（passed / failed） | 变红用例 | 与收尾轮声称 |
| --- | --- | --- | --- |
| **BUG-008 三项**：`MAX_SCAN_ROUNDS` 64→65 / `MAX_STALLED_SCAN_ROUNDS` 16→8 / `CLUSTER_TYPE_SAMPLE_LIMIT` 200→201 | 225/1 · 225/1 · 224/2 | `fix_round1::scan_budgets_are_the_numbers_the_docs_quoted`（前两项）+ `cluster_sample_window_is_bounded_…`、`the_ui_descriptions_still_promise_those_same_numbers`（第三项） | **同向同数** ⇒ 上轮 M8b/M8d/M8e 的"全绿"确已闭合 |
| 对照：`TYPE_PIPELINE_CHUNK` 500→600、`MAX_TYPE_SAMPLE_LIMIT` 5000→5001 | 各 224/2 | `the_ui_descriptions_…` + `type_distribution_clamps_an_oversized_window_instead_of_erroring` | 一致 |
| `is_sample_truncated` 恒 `false`（M-trunc） | 215/11 | 两拓扑采样/普查用例成片（含 `test_tester_type_distribution_json_shape_is_the_wave2_contract`） | 一致（红 11） |
| **cluster 顺序路径**：`issue_batch` Cluster 臂退回统一 pipeline（M-seq） | 224/2 | `cluster_key_object_info_degrades_per_field_over_six_addressed_singles`、`…keeps_working_when_the_key_is_gone` | 一致 |
| 寻址三处：M-scanaddress / M-callslot / M-typeslot | 224/2 · 224/2 · 221/5 | 依次：`cluster_type_distribution_types_keys_one_at_a_time_…` + `every_cluster_scan_round_shares_one_shard_and_cursor_space`；同 M-seq 两条；含 `a_transport_failure_on_the_addressed_path_aborts_the_probe` 等 5 条 | **一致** |
| `master_route` 的 `SlotAddr::Master`→`ReplicaOptional`（M-slotaddr） | 225/1 | `the_address_we_build_names_exactly_the_master_of_the_given_slot` | 一致 |
| `DBSIZE` 改为按槽寻址（M-dbsize-addressed） | 224/2 | `dbsize_is_left_to_the_clients_all_master_fan_out`、`rejected_dbsize_aborts_the_distribution_instead_of_reading_zero` | 一致 |
| 两守卫关闭：轮帽 / 停滞（M-roundcap-off、M-stalled-off） | 各 225/1 | `type_distribution_stops_at_the_round_cap_on_a_spinning_cursor`、`…stops_when_the_cursor_stops_making_progress` | 一致 |
| 回复条数守卫 / 连接级失败分类 / Sentinel 臂 关掉 | 219/7 · 223/3 · 225/1 | 含 `fix_round1::key_object_info_refuses_a_truncated_reply_vector_instead_of_guessing`、`test_tester_keys_is_issued_in_neither_shape_on_either_path`、`test_tester_connection_failure_classifier_matches_real_reply_kinds`、`sentinel_uses_the_single_node_batch_and_its_per_item_errors` | 一致 |
| **M-addr（Cluster 实现体退回 `req_packed_command`）** | **226 / 0 全绿** | 无 | **负面事实复现** ⇒ `:493` 那一行进程内不可证伪，唯一防线仍是 R 项 9a（本实例在阶段 C-2 从覆盖率侧独立佐证了同一件事，见下） |
| **新：`key_object_info` 的 `get_slot(key)` 改为手工剥左括号（M-tagblind-keyinfo）** | 227/1 | `cluster_topology::test_tester_cluster_addressing_follows_the_hash_tag_not_the_whole_key` | 上轮无用例 ⇒ 本回合新增防线 |
| **新：`sample_types` 的 `get_slot(key)` 同样失聪（M-tagblind-sample）** | 227/1 | `cluster_topology::test_tester_a_hash_tagged_sample_is_typed_at_the_tag_slot` | 同上 |
| **反向对照（把上面两条变异各跑一次，但 `--skip` 掉本回合两条新用例）** | **226/0 全绿 ×2** | 无 | ⇒ 旧套件对"标签失聪"**零证伪能力**，新用例提供的是**独有**能力而非重复劳动 |

### 阶段 C-2 · 覆盖率与"缺 3 个函数"落点（收尾轮第 343 行留给 Tester 的自由核验点）

- `cargo llvm-cov -p datazen-driver-redis --lib`（`CARGO_TARGET_DIR=/tmp/w1a-r3t-cov-target`）⇒ `ops_workbench.rs` **区域 545 中缺 83 = 84.77% · 函数 47 中缺 3 = 93.62% · 行 382 中缺 49 = 87.17%**，与收尾轮自报**逐字一致** ⇒ ≥80% 硬标准满足。
- 用同一份 profdata 手工导出（`llvm-profdata merge -sparse` + `llvm-cov show`，本机 LLVM 20.1.8-rust-1.90.0；收尾轮没跑通的就是这一步的 profdata 路径）⇒ **逐行**列出 count=0 的可执行行 **31 条**（`/tmp/w1a-r3t-logs/D-show.txt`、行号清单见 `/tmp/w1a-r3t-logs/D-funcs.txt`）。归位后：**整段一次都进不去的函数体只有两处** —— `SlotRoutedConnection::command_at_slot` 的**默认实现体**（`:473-479`）与 `impl SlotRoutedConnection for ClusterConnection` 的**实现体**（`:488-494`）。原因可复算：只有 Cluster 通道调用 `command_at_slot`（`routed_single:575`），而唯一在跑的替身 `ClusterFoldingConn` 自己覆盖了它（`tests/cluster_topology.rs:332`）⇒ 默认实现体在 lib 套件内 0 次进入；Cluster 实现体则是替身根本不存在的那个类型。其余行全部落在**已执行**的函数体内部：`341`（`parse_type_token` 的 `RValue::Int` 臂，前三轮同一项）、`420/431-432/559/591-592/712/758-760/799-804/833-834`（全部是 `tracing` 宏的**字段闭包/字段表达式**，含 `type_distribution` 汇总日志里的 `anchor_slot = match topology { … }` —— 它在 `tracing::info!` 的字段表内，**不是逻辑分支**）。
- **诚实边界**：文件列"函数 47 中缺 3"按 llvm 的 coverage-mapping record（合并泛型实例）计，而 `report --show-functions` 打印的是**逐实例化**的 134 条记录（62 条 0 计数，绝大多数是 `ClusterConnection` / `MultiplexedConnection` 两型连接在进程内压根不存在的实例化 + tracing 调用点闭包记录）⇒ 两套口径不能一一对映，本实例**不把"3"硬编成 3 个名字**。能钉死的是：**整段不可进入的生产函数体只有那两个 `command_at_slot`，且它与 M-addr 盲区是同一件事**；真连防线分别是 R 项 **9a**（Cluster 是否真按槽投递）与 **9c**（`MultiplexedConnection` 取默认实现未被绕过）。⇒ **不据此开新 Bug**，收尾轮"下降全部由 BUG-007 新增行数造成"的归因**成立**，本回合未见新增未覆盖逻辑分支。

### 阶段 C-3 · 本回合新增测试（唯一改动面，`a6304a4fb`）

1. `cluster_topology::test_tester_cluster_addressing_follows_the_hash_tag_not_the_whole_key` —— 键 `{tenant7}:profile`：六条探测必须**全部寻址在标签槽**（`get_slot(b"tenant7")`）、`misrouted` 空、`slot_refreshes == 0`、返回值与无标签键同形；并带**fixture 守卫** `assert_ne!(tag_slot, brace_strip_slot)`（否则本用例会因fixture太弱而假绿）。
2. `cluster_topology::test_tester_a_hash_tagged_sample_is_typed_at_the_tag_slot` —— `SCAN` 页返回两个同标签键 + 一个无标签键：两个同标签键的 `TYPE` 必须寻址到**同一槽**（标签的共址承诺），无标签键必须在**别的槽**，`SCAN` 仍锚在 `cluster_scan_anchor_slot()`。
3. 复跑：`cargo fmt -p datazen-driver-redis` 后 `--check` **exit 0**；`cargo test -p datazen-driver-redis --lib` ⇒ **228 passed / 0 failed / 1 ignored**（226 + 本回合 2）；`cargo clippy --all-targets` 诊断集**逐字不变**（17 / 18(17 dup) / 3 + 同 2 条 deny，`ops_workbench*` 仍零命中）⇒ 未引入新的 lint 回归（收尾轮第 299 行那类问题）。

### 阶段 D · 裁定 **TEST_DONE**

- **BUG-008（低）⇒ 已修复**：四条修法全部落地，本实例用自己的变异独立复证上轮三项"全绿"（64/16/200）**全部转红**，且文案与常量同源渲染的正反对照成立。
- **BUG-007（中）⇒ 进程内复测通过**：七条裁定逐条对到行、契约面逐字节未动、寻址**决策 / 形状 / 回退路径 / DBSIZE 不寻址 / SCAN 定桩**五面各自有可证伪用例（本回合又补上"标签感知"一面），变异方向与红条数与收尾轮台账**全部一致**。**但 `route_command` 那一行（`:493`）的闭合仍系于 R 项 9a 真连**（本实例从覆盖率侧独立确认它就是 0-count 函数体，不是遗漏而是结构性盲区）⇒ 本实例**不代为关闭**，`bugs.md` 状态写"已修复（进程内复测通过）· 真连 9a 未过不关闭"。
- 门禁：除两项既有环境性红（workspace fmt、2 条 deny）外全绿；**无新增 Bug**，故本回合 `bugs.md` 只做状态流转，未新增分节。

### 交回协调者 / Wave 2（本回合新增，不重复已登记项）

1. **派发书写错审阅范围**属流程问题、值得进 playbook：点 commit 哈希时必须点到**生产码那一笔**（本轨是 `81cc58a90` / `286d917c4`），否则复测者按哈希核对会得出"无可审对象"。
2. 两条新用例把"hash-tag 感知"从**未测**变成**可证伪** ⇒ R 项 9a/9b 的 MONITOR 判据建议加一句"键名带 `{}` 标签时同样只落在标签所属分片"（属 R 正文，本实例**未代改**，避免与 Coder 的台账面冲突）。
3. 文件规模：`tests/cluster_topology.rs` 现 **1164 行**（收尾轮登记 1017 + 本回合 147），已过千行的测试文件两个（`tests.rs` 1200）⇒ 拆分条仍等协调者裁定，本实例按"不开新文件、不新增文档"执行。
4. 纪律自查：未跑 `pnpm install` / `pnpm build` / `pnpm e2e` / webdriver 构建；未碰 `hub.md`、他轨文档、`ui/**`、`locales/**`、宿主 `src/**`、`driver-sdk/**`、`Cargo.toml`、`scripts/resolve-drivers.mjs`；未提交任何 gitignored codegen / `target/`；`git status --porcelain` 结束时仅本台账文件待提交。
