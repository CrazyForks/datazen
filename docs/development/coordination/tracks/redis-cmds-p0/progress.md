# Track: redis-cmds-p0 — KV 上下文条与键属性侧栏所需的两条 P0 后端命令

- 分支: `feature/redis-cmds-p0`（基准 `feat/redis-workspace-ux` @ ae65ae375）
- 角色: Coder → Tester
- 状态: READY_FOR_TEST（后端两条命令 + Rust 测试已落地，无 UI 改动；待 Tester/R 真连回归）
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
- 回复读取改用 `ConnectionLike::req_packed_commands`：redis 0.27 的 `Pipeline::query_async` 会经 `Value::extract_error_vec`，**首个单项错误即整批失败**，与"单项降级"要求直接冲突。该方法就是 `query_async` 内部所调者，`offset=0 / count=len` 与 `execute_pipelined_async` 一致 ⇒ 线路字节、传输与 cluster 路由不变。
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

## 留待 R 回归

子代理不跑 `pnpm e2e`；以下需真连 Redis（或真实服务端差异）才能证伪，登记给 R / Wave 2 Tester。P0 阶段上下文条与侧栏 UI 尚未落地（Wave 2），故 1–8 先以 `execute_driver_command` 命令级真连回归，Wave 2 落地后同一批用例升级为 GUI/E2E：

1. **大库采样语义**：≥50k 键的 db 上跑 `type_distribution` ⇒ `dbsize` 等于服务端 `DBSIZE`、`sampled ≤ 5000`、`truncated: true`；UI 落地后必须显式可见"采样 N/M"标注（PRD §3.4），否则视为回归失败。
2. **小库精确态**：键数 < 1000 的 db ⇒ `truncated: false` 且 `Σcounts == DBSIZE`；空 db ⇒ `counts: {}`、`sampled: 0`、`truncated: false`。
3. **钳制不报错**：`sampleLimit = 6000` ⇒ 实际采样上限 5000 且返回成功；`sampleLimit = 0` / 缺省 ⇒ 1000。
4. **`KEYS` 禁令（MONITOR 侧证）**：以 `MONITOR` 抓包确认全过程只有 `DBSIZE` × 1、`SCAN`（游标推进至窗口满或归零）、`TYPE` 的 pipeline 批，**零** `KEYS`、零逐键 `TYPE` RTT。
5. **六种类型 + 模块类型**：对 `string/hash/list/set/zset/stream`（含 `listpack`、`hashtable` 编码各一）逐个跑 `key_object_info` ⇒ `type`/`encoding`/`memoryBytes`/`idleSeconds` 有值、`missing: false`；有 RedisJSON 时补验 `ReJSON-RL`（`encoding` 预期 `null`）。
6. **过期/删除键空态**：删除或等键过期后再查 ⇒ `missing: true`、`ttlMs: -2`、其余 `null`，HTTP/命令层为成功；侧栏须显示"键已过期"而非红色错误。
7. **非 LFU 的 FREQ 槽**：`maxmemory-policy` 设为 `noeviction`/`allkeys-lru` ⇒ `freq: null` 且 `memoryBytes/encoding/idleSeconds/ttlMs` 全部仍返回；切 `allkeys-lfu` ⇒ `freq` 有值。整条命令任何情况下不得失败。
8. **MEMORY USAGE 不可用槽**：Redis < 4.0（或不支持 `MEMORY` 的托管实例）⇒ `memoryBytes: null`，其余字段正常。
9. **拓扑覆盖**：Cluster 与 Sentinel 连接下各跑两条命令（验证 `req_packed_commands` 的分片路由不受影响），并覆盖"当前 db 为空"与"采样窗口跨越多个分片"。
10. **权限与 SafeMode**：只读 profile / SafeMode 开启时两条命令仍可用（`CommandCategory::Observe` + `Read`），同时确认权限不足时的回退文案由 Wave 2 承担。
11. **Wave 2 依赖项**：`type: null` 的"未知态"与"过期态"需在侧栏可区分（见「契约偏离」实现口径第 2 条）—— UI 落地时须带回归属。
