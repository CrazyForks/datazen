# migration-schema-safety Bugs

## migration-schema-safety-BUG-001 — empty DropTable identifiers are executable

- 状态：已修复（`6337b2cf`；第二轮 Tester 复测通过）
- 级别：阻断
- 描述：PostgreSQL、MySQL、SQLite 的 `DropTable` renderer 没有拒绝空表标识符；Host schema-diff plan 也会把空表名转换成可执行的 `DROP TABLE` statement。空字符串会被包成 `""` / ````，导致 fail-open，而不是进入 `PlanRequirement::Unsupported`。
- 重现步骤：
  1. 调用任一 renderer，传入 `MigrationOperation::DropTable { table: String::new() }`。
  2. 或调用 `build_schema_diff_plan`，传入 `[("".into(), empty_source, target_with_id)]`，目标方言为 PostgreSQL，并设置 `allow_destructive: true`。
  3. 观察 renderer 返回 `Ok`，或 Host plan 返回一条 statement 且 requirements 为空。
- 实测错误日志：
  - `migration::tests::test_tester_drop_table_rejects_empty_identifier ... FAILED`（PG，断言 `render(...).is_err()` 失败）
  - `migration::tests::test_tester_drop_table_rejects_empty_identifier ... FAILED`（MySQL，断言 `render(...).is_err()` 失败）
  - `migration::tests::test_tester_drop_table_rejects_empty_identifier ... FAILED`（SQLite，断言 `render(...).is_err()` 失败）
  - `schema_diff::plan::tests::test_tester_target_only_empty_identifier_is_not_executable ... FAILED`（断言 `plan.statements.is_empty()` 失败）
- 影响范围：任何空或清洗后为空的 target-only table identifier 可绕过 unsupported/empty-identifier safety gate，生成无效或不应执行的 destructive DDL。该问题阻断本轨合并。
- 相关测试：`packages/drivers/postgres/src/migration.rs`、`packages/drivers/mysql/src/migration.rs`、`packages/drivers/sqlite/src/migration.rs`、`src-tauri/src/schema_diff/plan_tests.rs` 中以 `test_tester_` 开头的测试。

## 复测结论

第二轮独立 Tester 已验证空字符串、空白字符串、控制字符和非法 qualified identifier 在 PostgreSQL、MySQL、SQLite renderer 以及 Host planner 中均 fail-closed；Host plan 无 executable statements 且带 `Unsupported` requirement。该 Bug 不再阻断合并。
