# migration-table-options Bugs

## migration-table-options-BUG-001

- **描述**：`TableSchema` 新增必填的 `table_options` 字段后，Redis 驱动仍有一个 `TableSchema` 初始化器没有提供该字段。
- **状态**：待复测
- **重现步骤**：
  1. 在 `feature/migration-table-options` worktree 中运行 `node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib schema_diff`。
  2. 等待 basic 驱动注入并编译 Host。
- **实测错误日志**：
  ```text
  error[E0063]: missing field `table_options` in initializer of `datazen_driver_api::TableSchema`
     --> packages/drivers/redis/src/redis_driver_db.rs:190:12
  ```
- **影响范围**：basic 驱动构建无法完成，Host Rust Schema Diff 测试与包含 Redis 的应用构建均被阻断。该错误发生在编译阶段，没有执行真实迁移。

## 修复

- 在 Redis 驱动的 `TableSchema` 初始化中补齐 `TableOptions::default()`。
- `cargo check -p datazen-driver-redis` 通过；等待独立 Tester 重新运行 basic Host 编译与 Schema Diff 测试。
