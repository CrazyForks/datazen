# migration-default-expression-review Bugs

## migration-default-expression-review-BUG-001 — MySQL numeric default expressions pass through to PostgreSQL

- 状态：已修复
- 级别：P2
- 描述：跨方言 Schema Diff 将 MySQL 数值类型默认表达式原样放入 PostgreSQL DDL。`apply_mysql_string_default_mapping` 对 `is_known_mysql_default_type` 直接返回成功，因此不会识别 MySQL 专属函数，也不会生成 `Unsupported` requirement。合法的 MySQL 表达式默认值 `IFNULL(1, 2)` 被计划为 PostgreSQL 默认值；目标 PostgreSQL 没有 `IFNULL` 函数，计划执行会失败。
- 重现步骤：
  1. 构造源 MySQL `users.value INT DEFAULT (IFNULL(1, 2))` 的列快照，目标为 PostgreSQL，类型映射为 `integer`。
  2. 调用 `build_schema_diff_plan`，使该列作为新增列。
  3. 观察计划没有 `Unsupported` requirement，仍返回可执行的 `ALTER TABLE`。
- 实测错误日志：
  - Tester 用例 `schema_diff::plan::tests::test_tester_mysql_numeric_expression_default_fails_closed_for_postgres` 失败，预期出现 `PlanRequirement::Unsupported`。
  - 失败时 plan 含 SQL：`ALTER TABLE "users" ADD COLUMN "value" integer DEFAULT IFNULL(1, 2)`，且 `requirements: []`。
- 影响范围：MySQL→PostgreSQL Schema Diff 对数值列使用 MySQL 函数或其他不兼容表达式默认值的表，会生成目标端无效 DDL，阻断迁移；计划将该操作标记为 Additive，未向调用方提示需人工翻译。
- 相关测试：`src-tauri/src/schema_diff/plan_tests.rs` 中的 `[tester]` 用例。
- 建议：只允许明确可移植的数值字面量透传，无法证明语义可移植的数值表达式 fail closed，并由回归用例验证。
- 修复提交：`0cfd3aab0e6d6ddf82eb1133247bbb0a75706a12`。目前只允许与 PostgreSQL 目标数值类型兼容的纯数值字面量；整数目标额外检查整数词法和有符号范围。MySQL 专属函数/表达式、十六进制/位字符串及不兼容字面量均成为 `Unsupported`。
- 回归状态：原 Tester 复现及独立 Schema Diff planner 定向套件通过；完整数值默认映射核心路径覆盖 112/112 可执行行。原 MySQL 数值表达式不再进入 PostgreSQL DDL。
- 独立 Tester：`CARGO_TARGET_DIR=/Users/flyxl/code/datazen/.worktrees/datazen-migration-navicat/target CARGO_BUILD_JOBS=1 node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib schema_diff::plan::tests:: --offline` — 63 passed, 0 failed；覆盖率详情见本轨 progress.md。
