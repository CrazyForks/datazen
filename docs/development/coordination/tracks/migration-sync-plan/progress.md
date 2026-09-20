# migration-sync-plan

Phase: READY_FOR_TEST
Branch: codex/migration-sync-plan
Worktree: `.worktrees/datazen-migration-sync-plan`
Base: `codex/migration-navicat` @ `4e461391`
Coding commit: `08483057` (`fix(data-sync): close active database and real journey gates`)

## Scope for this serial wave

Implement the next Sync correctness boundary only: a server-owned immutable comparison/execution plan that binds source and target sessions, qualified relation identity, schema/key fingerprints, reviewed selection revision and driver contract. Execution must fail closed on stale sessions, schema/key changes, changed read-only policy, invalid selections and unknown outcomes. Keep the existing integer-key comparison limitations explicit; do not expand to unrelated object graphs, profiles or scheduler work in this wave.

## Acceptance gates

- Host Sync Rust tests and command-path tests pass, including stale/one-shot/unknown-outcome cases.
- Sync frontend journey tests and TypeScript pass; execute sends an opaque plan ID and validated selection revision only.
- PostgreSQL/MySQL/SQLite driver tests pass.
- Formal WebDriver build passes.
- Isolated PostgreSQL and MySQL Sync binary journeys prove selected-only writes and stale-plan rejection before target writes.

## Remaining boundaries

Normalized text/collation/composite-key ordering, bounded stable snapshots, disk-backed ComparisonStore, conflict detection and persistent profiles remain later waves.

## Implementation

- `compare_data_sync` now returns a review payload containing an opaque `planId`, a selection revision and display-only tables. The full comparison stays in a process-local server registry with a 15 minute TTL and one-shot consumed state.
- Each plan binds the exact source/target `dbSessionId`, qualified database/schema/relation identity, serialized source and target `TableSchema` fingerprints (including primary keys), driver ids and protocol versions, comparison options and target read-only policy.
- `generate_data_sync_sql` and `execute_data_sync` resolve the server-owned comparison by `planId`. Requests carry only a revision, selected operation/key tuples, validated options and an optional cancellation job id. Unknown fields such as replacement SQL, rows, statements or mappings are rejected during deserialization.
- Execution revalidates sessions, drivers, read-only state and live schema/key fingerprints before atomically consuming the plan. A consumed plan remains unavailable after rollback, cancellation or an unknown transaction result.
- The frontend keeps its existing reviewed-table UI while translating its local selection to operation/key tuples. The actual IPC payload never forwards generated SQL, source rows or replacement mappings. SQL preview also resolves from the same server plan.

## Independent Tester review（2026-09-20）

- 代码审查：逐文件复核 `apply.rs`、`exec.rs`、`mod.rs`、`plans.rs`、Sync IPC wrapper 和 `DataSyncWindow`。opaque `planId`、deny-unknown-fields、selection membership、revision、driver/protocol/read-only/schema checks、claim one-shot 和 unknown-result fence 均存在；发现 BUG-001 的活动 database identity 缺口，且既有 real E2E 未迁移到新契约（BUG-002）。
- Host Rust 全量：`CARGO_TARGET_DIR=/tmp/datazen-target-sync-plan cargo test -p datazen --lib` — **1417 passed, 3 ignored, 0 failed**。
- Sync Rust 专项：`data_sync::` **98 passed**；`commands::sync` **26 passed**。
- Frontend Sync：8 个相关 Vitest 文件 **46 passed**；TypeScript `noEmit` 通过。
- Frontend 改动覆盖率（仅 include `sync.ts` / `DataSyncWindow.tsx`）：总 lines **85.13%**，statements **83.18%**，functions **84.18%**，branches **76.31%**；`sync.ts` lines **82.14%**，`DataSyncWindow.tsx` lines **82.77%**。全仓库默认 coverage threshold 因未限定 include 仅为 1.6%，该命令失败属于覆盖率范围配置，不是测试失败。
- 驱动测试：PostgreSQL **101 passed**、MySQL **86 passed**、SQLite **46 passed**。
- 正式构建：`CI=true CARGO_TARGET_DIR=/tmp/datazen-target-sync-plan pnpm_config_verify_deps_before_run=warn pnpm tauri:build:webdriver` 通过。
- 新增独立 immutable-plan binary journeys：`packages/drivers/postgres/e2e/sync-plan.ts` 与 `packages/drivers/mysql/e2e/sync-plan.ts`，精确构建运行 **4/4 passed**；覆盖 selected-only writes 与 stale target schema 在写入前拒绝。
- 既有 `e2e/specs/data-sync-real.ts` 精确构建运行 **20 passed, 4 failed**，失败原因已登记 BUG-002；运行期间仅出现 demo fixture 的历史字段警告，不影响上述 Sync 断言。
- 代码质量：正式构建提示 `plans.rs` 的 `RowChange` 生产路径 unused import，属于可清理 warning；未发现调试输出或本轨生成文件残留。
- 独立判定：**TEST_FAILED**。BUG-001 解决前不能宣称 qualified database identity 已正确绑定；BUG-002 解决前既有 real Sync release gate 不能通过。

## Round 1 修复（2026-09-20）

- BUG-001：`validate_plan_context` 在 claim/write 前严格校验 source/target live session 的 active database 与 plan 保存的 resolved database；缺失、切换或无法确认均拒绝。新增 Host command test 覆盖 target active database 改变。
- BUG-002：`e2e/specs/data-sync-real.ts` 已切换为 `{ planId, selection, options, jobId? }` opaque contract，`execute_data_sync` 是唯一成功执行入口；保留 legacy `apply_data_sync` 拒绝断言，覆盖 selected-only、stale schema 写前拒绝和 one-shot。补充 PostgreSQL numeric typed placeholder，保证 wide-type journey 的参数化写入正确。
- Round 1 自验：Host Sync command tests **21 passed**；numeric placeholder tests **2 passed**；formal `pnpm tauri:build:webdriver` 通过；PG real Sync 基础组 **11 passed**。完整权限组未运行，因本机缺少 `E2E_PG_RO_PASSWORD` fixture。

## Self-validation

- Injected Host `data_sync` tests: **102 passed**.
- Injected Host `commands::sync` tests: **20 passed**, including opaque plan issuance; the command filter overlaps the data_sync module tests and is not summed as a unique total.
- Immutable-plan unit tests: **3 passed**, covering selection membership, payload rejection and key-only selections.
- Frontend Data Sync suites plus immutable IPC contract test: **8 files, 46 passed**.
- TypeScript `noEmit`: passed with no diagnostics; `git diff --check`: passed.
- Formal `pnpm tauri:build:webdriver` completed with basic driver injection and an isolated `CARGO_TARGET_DIR`.
- PostgreSQL/MySQL binary journeys were not run by the Coder; they remain required for the independent Tester, including stale-schema rejection before writes. Driver-specific suites remain required at the Tester gate.

## Known limits for independent testing

- This wave intentionally retains the existing integer-key comparison gate and in-memory comparison result limits.
- Selection revision is an immutable review epoch for one comparison. Later waves can add a server-side review mutation protocol if selection history needs durable audit semantics.
- The legacy SQL-taking helper exists only under `cfg(test)` for existing unit coverage; it is not compiled into or registered as an IPC command.
