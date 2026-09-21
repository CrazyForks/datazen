# Track: redis-cmds-p0 — KV 上下文条与键属性侧栏所需的两条 P0 后端命令

- 分支: `feature/redis-cmds-p0`（基准 `feat/redis-workspace-ux` @ ae65ae375）
- 角色: Coder → Tester
- 状态: **TEST_FAILED**（Tester 首轮复测 @ `b1e1f4010`：数字与契约声称全部核实为真，但发现 6 条 Bug（1 高 / 2 中 / 3 低），详见 `bugs.md`；待 Coder 修复后复测）
- Worktree: `.worktrees/datazen-redis-cmds-p0`
- 规格: `docs/todo/redis-workbench-ux/PRD.md` §3.4、§6（P0 两行）、§7、§8

## 背景

P0 把 Redis 顶部 48px 空带换成**全量 KV 上下文条**（PRD 裁定 8-2 = 全量），并把右上角的死按钮换成**键属性侧栏**（裁定 8-3 = M）。两者各自缺一条后端命令。本轨只补这两条命令 + 契约 + Rust 测试，**不写任何 UI**（UI 属 Wave 2）。

## 范围（两条命令，契约必须逐字对齐，Wave 2 直接按此消费）

### 1. `type_distribution`

- 入参：`{ dbIndex?: number, sampleLimit?: number }`（`sampleLimit` 默认 1000，硬上限 5000，超出即钳制且**不报错**）
- 返回：`{ counts: Record<String, u64>, sampled: u64, dbsize: u64, truncated: bool }`
- 语义：**游标采样**，绝不允许用 `KEYS`。复用既有 SCAN 原语 `packages/drivers/redis/src/ops.rs:86 scan_batch`；TYPE 一律 **pipeline 批量**取，禁止逐键 RTT。
- `truncated = sampled < dbsize`。**这个位是硬要求**：Wave 2 必须在 `truncated` 为真时显式渲染"采样 N/M"标注，否则采样分布会被读成精确分布（PRD §3.4 硬约束）。
- `dbsize` 走既有 DBSIZE 通道，一次动作内只取一次。
- 只读命令，不受 SafeMode 写门闸影响。

### 2. `key_object_info`

- 入参：`{ key: String, dbIndex?: number }`
- 返回：`{ missing: bool, type: Option<String>, memoryBytes: Option<u64>, encoding: Option<String>, idleSeconds: Option<u64>, freq: Option<u64>, ttlMs: i64 }`
- 语义：**一次 pipeline** 打 `MEMORY USAGE` + `OBJECT ENCODING` + `OBJECT IDLETIME` + `OBJECT FREQ` + `PTTL` + `TYPE`。
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
- `key_object_info` 存在**第四种状态**：`TYPE` 本身报错（非 `none`）时返回 `missing: false` + `type: null` + 全部属性 `null` + `ttlMs: -1`，即"键状态未知、属性不可信"，既不谎称键已消失，也不给出半可信属性。侧栏应渲染为"读取失败/未知"空态，而不是过期态。
- `counts` 的 key 是服务端 `TYPE` 原样 token（含模块类型如 `ReJSON-RL`），未做白名单归一；UI 若只画 6 种内置类型，需要"其他类型"兜底桶。
- 采样窗口内 SCAN 结果会 `sort + dedup`（SCAN 允许跨游标重复返回同一键），因此 `sampled` 是去重后真实类型成功的键数，且恒等于 `counts` 各项之和（`truncated` 标注依赖此不变式）。
- `key_object_info` 未调用 `ops_observe.rs:188 memory_usage_key`（那会多一次独立 RTT），而是把 `MEMORY USAGE` 折进同一条 pipeline，以满足上文"一次 pipeline"；复用点落在权限位与定义样板。
- 回复读取改用 `ConnectionLike::req_packed_commands`：redis 0.27 的 `Pipeline::query_async` 会经 `Value::extract_error_vec`，**首个单项错误即整批失败**，与"单项降级"要求直接冲突。该方法就是 `query_async` 内部所调者，`offset=0 / count=len` 与 `execute_pipelined_async` 一致 ⇒ 线路字节、传输与 cluster 路由不变。**〔Tester 复测裁定：本条前半段成立（绕开 `query_async` 有实据），末句"cluster 路由不变"不成立且会误导 Wave 2 —— cluster 分发层自己再做一次错误折叠、并对 pipeline 施加单 slot 约束，见 `bugs.md` redis-cmds-p0-BUG-001 / BUG-002；修复时必须一并更正本条。〕**
- 权限位：`key_object_info` = `redis:allow-memory-sample`（按本文件要求）；`type_distribution` = `redis:allow-info`（本文件未指定，与同为库级观测的 `scan_keys`/`db_sizes`/`list_children` 对齐）。两者均派生为 `CommandAccessLevel::Read`、`CommandCategory::Observe`，不受 SafeMode 写门闸影响（已有断言测试锁定）。

## 自验记录

Worktree：`/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-cmds-p0`（分支 `feature/redis-cmds-p0`，基准 `ae65ae375`）
独立构建目录（gitignored，`.gitignore:13 /target` 覆盖）：`CARGO_TARGET_DIR=/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-cmds-p0/target/cargo-wt`

1. `CARGO_TARGET_DIR=$PWD/target/cargo-wt cargo test -p datazen-driver-redis` ⇒ **188 passed / 0 failed / 1 ignored**
   - lib 单测：`184 passed; 0 failed; 1 ignored`（其中本轨新增 `ops_workbench::tests` **24** 项，基线 160 项）
   - 新增集成测试 `packages/drivers/redis/tests/workbench_commands.rs`：**4 passed / 0 failed**
   - 文档测试：0 项
   - 验收标准 2 的六项场景逐条对应：`sampleLimit` 钳制 → `sample_limit_defaults_and_clamps_without_erroring` + `type_distribution_clamps_an_oversized_window_instead_of_erroring`；`truncated` 真假两路 → `truncated_flag_is_the_sample_vs_census_bit` + `type_distribution_flags_truncated_when_the_sample_is_partial`（真）+ `type_distribution_counts_a_fully_scanned_small_db` / `type_distribution_on_an_empty_db_is_not_truncated`（假）；pipeline 批量往返次数 → `ScriptedConn`（record 型 `ConnectionLike`）journal 断言：`key_object_info_uses_one_round_trip_and_survives_a_rejected_field`（恰 1 次往返、0 单发）、`type_distribution_pipelines_types_in_chunks_and_never_calls_keys`（`ceil(n/500)` 批 + 无 `KEYS` + 无逐键 `TYPE`）、DBSIZE 每动作恰 1 次；`missing` 分支 → `key_info_reports_missing_as_success` + `key_object_info_reports_missing_over_the_wire`；FREQ 单项失败不整体失败 → `key_info_degrades_freq_and_memory_independently`；MEMORY USAGE 不支持单项降级 → 同上 + `rejected_*_aborts_*`（区分"服务端拒绝单字段"与"整条命令失败"）。
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

## 留待 R 回归

子代理不跑 `pnpm e2e`；以下需真连 Redis（或真实服务端差异）才能证伪，登记给 R / Wave 2 Tester。P0 阶段上下文条与侧栏 UI 尚未落地（Wave 2），故 1–8 先以 `execute_driver_command` 命令级真连回归，Wave 2 落地后同一批用例升级为 GUI/E2E。〔Tester 首轮复测后：1/3/4/6/9/10/11 已按 `bugs.md` 加强或修正（带 `〔Tester〕` 标记），并新增 12–16 五条 mock 无法证伪的边界；项 9 已按 BUG-001/002 改写为"预期失败即确认 Bug"。〕

1. **大库采样语义**：≥50k 键的 db 上跑 `type_distribution` ⇒ `dbsize` 等于服务端 `DBSIZE`、`sampled ≤ 5000`、`truncated: true`；UI 落地后必须显式可见"采样 N/M"标注（PRD §3.4），否则视为回归失败。
   〔Tester 加强 —— 断言点补齐为三条，缺一即失败：(a) `truncated == (sampled < dbsize)` 与 `Σcounts == sampled` 同时成立（后者是标注数字自洽的前提，见「契约偏离」第 4 条）；(b) 上下文条渲染的是 `sampled/dbsize` 两个真实数字而非"精确分布"文案，`truncated: true` 时**任何**"总数"字样都必须带"采样"前缀；(c) `truncated: true` 且 `counts` 为空对象时（极端：全部键在 SCAN 与 TYPE 之间消失）UI 不得回退成"显示 0 键"，须与 §3.4 的失败空态区分。责任切分：R 只核后端数据形状，(b)(c) 的渲染归 Wave 2 Tester。〕
2. **小库精确态**：键数 < 1000 的 db ⇒ `truncated: false` 且 `Σcounts == DBSIZE`；空 db ⇒ `counts: {}`、`sampled: 0`、`truncated: false`。
3. **钳制不报错**：`sampleLimit = 6000` ⇒ 实际采样上限 5000 且返回成功；`sampleLimit = 0` / 缺省 ⇒ 1000。
   〔Tester 补充事实：`type_distribution` 的 `input_schema` **未写** `maximum`（有意"钳制不报错"），故 6000 由后端静默降到 5000 ⇒ Wave 2 的输入框不得回显"已按您填写的 6000 采样"，也只能显示返回体里的 `sampled`。R 请同时核对返回 `sampled ≤ 5000` 而非 6000。〕
4. **`KEYS` 禁令（MONITOR 侧证）**：以 `MONITOR` 抓包确认全过程只有 `DBSIZE` × 1、`SCAN`（游标推进至窗口满或归零）、`TYPE` 的 pipeline 批，**零** `KEYS`、零逐键 `TYPE` RTT。
   〔Tester 修正核对表 —— 必须再允许 **1 次 `SELECT`**：命令级真实路径是 `with_live_op!` → `RedisDriver::select_db`（`redis_driver_on.rs:14-23` 无短路），故 `key_object_info` 实际是 `SELECT` + 1 pipeline = **2 次往返**，`type_distribution` 是 `SELECT` + `DBSIZE` × 1 + `SCAN` × 轮数 + `TYPE` × `ceil(n/500)`。哨兵断线重连分支（`redis_driver.rs:36-45`）会**整条重放** ⇒ 计数恰为 2 倍属正常。若按原表逐字核对，会把正确实现误判为回归（详见 `bugs.md` redis-cmds-p0-BUG-006）。〕
5. **六种类型 + 模块类型**：对 `string/hash/list/set/zset/stream`（含 `listpack`、`hashtable` 编码各一）逐个跑 `key_object_info` ⇒ `type`/`encoding`/`memoryBytes`/`idleSeconds` 有值、`missing: false`；有 RedisJSON 时补验 `ReJSON-RL`（`encoding` 预期 `null`）。
6. **过期/删除键空态**：删除或等键过期后再查 ⇒ `missing: true`、`ttlMs: -2`、其余 `null`，HTTP/命令层为成功；侧栏须显示"键已过期"而非红色错误。
   〔Tester 补齐判别键：侧栏判"已过期"的**唯一**依据是 `missing === true`（等价 `type` 回答 `none`），且此时 `ttlMs` 必为 `-2`；若真连出现 `missing: true` 但 `ttlMs != -2`，或 `missing: false` + `type: null` + `ttlMs: -2` 之类混合态，说明 TYPE 与 PTTL 两槽位读串了位 ⇒ 记回归（单测已由 `test_tester_expired_and_unknown_key_states_are_distinguishable` 钉死，真连只需复述该三元组）。〕
7. **非 LFU 的 FREQ 槽**：`maxmemory-policy` 设为 `noeviction`/`allkeys-lru` ⇒ `freq: null` 且 `memoryBytes/encoding/idleSeconds/ttlMs` 全部仍返回；切 `allkeys-lfu` ⇒ `freq` 有值。整条命令任何情况下不得失败。
8. **MEMORY USAGE 不可用槽**：Redis < 4.0（或不支持 `MEMORY` 的托管实例）⇒ `memoryBytes: null`，其余字段正常。
9. **拓扑覆盖（本轨最高风险项，Tester 静态证据已判定为"必受影响"，原措辞作废）**：
   - 9a **Cluster × `key_object_info`**：真连 Redis Cluster 7.x（`maxmemory-policy` 保持默认 `noeviction`），db0 建任意键 ⇒ 调 `key_object_info`。**契约期望**：成功，`freq: null`、其余字段有值。**Tester 预期实际**：整条 `Err`，错误串含 `object access frequency counter is not available`（`cluster_async/mod.rs:668-681` 的 `extract_error_vec` 折叠）。**命中即确认 redis-cmds-p0-BUG-001（高），严禁判为"环境问题/测试实例配置不当"。**
   - 9b **Cluster × `type_distribution`**：db0 写入 ≥20 个键（几乎必然跨 slot）⇒ 调 `type_distribution`（`sampleLimit: 100`）。**Tester 预期**：`Err(CrossSlot … Received crossed slots in pipeline)`（`cluster_async/routing.rs:71-105`）⇒ 确认 BUG-002（中）。standalone 同输入必须成功（单测已覆盖）。
   - 9c **Sentinel**：与 standalone 同型（`RedisLiveConn::Sentinel { connection: MultiplexedConnection }`）⇒ 两条命令均应成功、单项降级应生效；额外做一次**主从切换**，确认 `redis_driver.rs:36-45` 的整体重放不会把 `missing` 误报、也不会让 `type_distribution` 出现重复计数。
   - 9d 两种拓扑下均补"当前 db 为空"与（Cluster）"采样窗口跨多个分片"两例。
   - 9e 附带观察（**不归本轨**，供协调者裁定另立基线条目）：Cluster 下既有 `list_children`（`ops_tree.rs:148-156`）应同形报 `CrossSlot` —— 若成立，则说明该故障类别是基线既有缺陷，修复面比本轨更大。
10. **权限与 SafeMode**：只读 profile / SafeMode 开启时两条命令仍可用（`CommandCategory::Observe` + `Read`，单测 `workbench_commands_are_read_only_observations` 已从 `required_access_level()` 侧锁定），同时确认权限不足时的回退文案由 Wave 2 承担。
    〔Tester 补：Cluster/托管实例上若 `INFO`/`MEMORY`/`OBJECT` 被服务端 ACL 拒，`type_distribution` 与 `key_object_info` 各自的错误形状需真连确认 —— 特别地，`redis:allow-memory-sample` 只覆盖本地授权位，服务端 ACL 拒绝时侧栏必须走 §3.4 的失败空态而非 0 值。〕
11. **Wave 2 依赖项：未知态 vs 已过期区分渲染（归属已可判定）**：`type: null` 的"未知态"与"过期态"在侧栏必须可区分（见「契约偏离」实现口径第 2 条）。
    〔Tester 结论：**后端已可判别，无需新增契约字段** —— 判别键 `(missing, type, ttlMs)`：已过期 `(true, null, -2)`、未知 `(false, null, -1)`、正常 `(false, <type>, ≥-1)`；已由 `test_tester_expired_and_unknown_key_states_are_distinguishable` + `test_tester_key_object_info_json_shape_is_the_wave2_contract` 锁定。故本项**不阻塞 Wave 2 冻结 TS 类型**；渲染责任归 Wave 2：三种形状必须映射到三种视觉（过期空态 / 读取失败空态 / 正常），且未知态**禁止**显示 `ttlMs: -1` 的"永不过期"文案。Wave 2 Tester 请以这三行三元组作为用例断言表。〕
12. **非 UTF-8 键名（新增，mock 无法证伪）**：`redis-cli -x SET "$(printf 'bin\xff\xfekey')" v` 建二进制键，并另建一个 lossy 后同名但字节不同的键（如含 `\ufffd`）⇒ 在树/侧栏打开该键 ⇒ 核对 `key_object_info` 的 `type/encoding` 是否属于**真正的这个键**。判定：`type: null` 或属性串到别的键 ⇒ 记回归（本轨未新增解码点，故首轮记为 R 项而非 Bug；若真连证实属性错读到别的键，升级为新 Bug 并连带既有 `scan_keys` 通道）。同时确认 `counts` 里出现的 U+FFFD token 不会让 UI 崩。
13. **`SCAN` 无界风险压测（新增，对应 BUG-005）**：走一遍代理/降权副本（或 `MONITOR` 侧观察一个游标永不归零、恒空批的实现）⇒ `type_distribution` 必须在有限时间内返回。若命令永久 pending ⇒ 直接确认 BUG-005，并同时观察该连接上其他命令是否被 `connections.write()` 写锁连带阻塞（这是本项真正的风险量级）。
14. **`dbIndex` 越界（新增）**：db2 已存在、db7 不存在（`databases 2`）⇒ `type_distribution { dbIndex: 7 }` 与 `key_object_info { dbIndex: 7, key: "x" }` ⇒ 必须**报错上抛**（`SELECT` 失败），不得静默按 db0 返回数据。判定：返回了 db0 的分布 ⇒ 严重回归（`commands_exec.rs:49-55` 只默认 0、无上界校验，全靠服务端 `SELECT` 兜底）。
15. **redis crate 升级必查项（新增，对应 BUG-003）**：`Cargo.toml` 的 `redis = "0.27"` 允许 0.27.x 漂移，而 `req_packed_commands` 是 `#[doc(hidden)]` 内部 API（`aio/mod.rs:75-79` 自陈"Users shouldn't call it"）。升级 redis 依赖的那一轨**必须**复核：offset/count 语义、回复顺序、回复条数是否仍等于请求条数，并跑 9a/9b。判定：若 `key_object_info` 在升级后返回"全 null + `missing: false`"而无任何 warn ⇒ 属静默劣化，按 BUG-003 追修。
16. **采样与侧栏的权限/降级组合（新增）**：只读 profile 下同时禁用 `OBJECT` ⇒ `key_object_info` 应整条报"权限不足"（服务端错误）而非返回全空；`type_distribution` 在禁用 `SCAN` 的实例上应报错上抛（已有单测 `rejected_scan_aborts_the_distribution_before_typing_anything` 覆盖形状）。判定：任何"权限不足"路径都不得被读成"键不存在"或"库为空"。
