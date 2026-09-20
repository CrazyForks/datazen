# migration-sync-plan Bugs

## migration-sync-plan-BUG-001 — plan does not bind the live active database identity (P1)

- 状态：待修复
- 描述：`validate_plan_context` 读取了 source/target session config，但没有把当前 session 的 active database 与 plan 中的 qualified database 比较。`current_schema_fingerprint` 使用 plan 保存的 database 名称参与哈希，同时从当前 session 的 active database 读取 schema；如果另一个 database 恰好有同名同结构表，指纹仍可相等。PostgreSQL 的 Sync SQL 只按 schema 限定关系，因此执行会把 reviewed plan 写入被切换后的 database。
- 重现步骤：
  1. 在 PostgreSQL database A 和 database B 建立同名、同结构且存在差异的表，并用 session 连接 database A。
  2. 对 source 与 target database A 执行 `compare_data_sync`，保存返回的 `planId` 与 `selectionRevision`。
  3. 在执行前对同一个 target `dbSessionId` 调用带 `database: B` 的查询命令，触发 `ensure_session_database` 切换活动 database。
  4. 使用原 planId 执行 `execute_data_sync`；当前校验可能通过，写入 database B，而不是 review 时绑定的 database A。
- 实测/审查证据：独立逐文件审查 `src-tauri/src/commands/sync/exec.rs` 发现 `source_config` 最终仅 `let _ = source_config`，`target_config` 只用于 `read_only`；没有比较 `plan.target_database`。同一文件的 `current_schema_fingerprint` 将 plan database 传入 `fingerprint_relations`，而 schema 查询依赖 live handle 的当前活动 database。
- 影响范围：绕过了本 wave 要求的 qualified database identity 绑定，在同库名表存在时可能把 reviewed Sync 写入错误 database；这是执行前必须阻断的 P1 数据完整性问题。
- 修复要求：执行前对 source/target live session 的 active database 与 plan 保存的 resolved database 做严格比较；数据库切换、session 替换或无法确认当前 identity 时均在 claim/write 前拒绝，并补充 PostgreSQL 同结构跨 database 回归旅程。

## migration-sync-plan-BUG-002 — 既有 real Sync E2E 仍发送已移除的旧 API 契约（P1 release gate）

- 状态：待修复
- 描述：immutable plan 变更后，既有 `e2e/specs/data-sync-real.ts` 仍把 `compare_data_sync` 当作数组，把 `generate_data_sync_sql` 当作接收 source/target/tables，并调用已经明确拒绝未审核重比对的 `apply_data_sync`。这使正式应用上的既有 real Sync 套件无法通过，且没有覆盖新的 planId/selection execution contract。
- 重现步骤：
  1. 使用 `CI=true CARGO_TARGET_DIR=/tmp/datazen-target-sync-plan pnpm tauri:build:webdriver` 构建本轨应用。
  2. 准备 `e2e/.env` 数据库并运行：`E2E_SKIP_TEARDOWN=1 E2E_WD_PORT=4490 node e2e/run.mjs --skip-build --port 4490 --spec ./e2e/specs/data-sync-real.ts`。
  3. 观察 `SYNC-REAL-004/008/024` 报 `results.find is not a function` 或 `compared.find is not a function`，`SYNC-REAL-009` 报 `legacy apply cannot preserve reviewed row selection`。
- 实测错误：精确构建的 binary journey 为 **20 passing, 4 failing**。失败均发生在旧测试契约与 immutable plan 返回/请求契约不匹配处；不是数据库连接失败。
- 影响范围：`pnpm e2e:data-sync` 的 real Sync release gate 失败；回归套件不能证明新的 opaque plan、selection revision、selected-only writes 和 stale-plan rejection。
- 修复要求：迁移该套 real Sync tests 到 `{ planId, selection, options }` 请求，并以 `execute_data_sync` 为唯一执行入口；保留旧 `apply_data_sync` 的拒绝断言作为独立兼容性测试。新测试必须断言 selected-only writes、stale schema 在 target write 前拒绝以及一次性 claim。
