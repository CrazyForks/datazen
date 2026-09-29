# migration-schema-sqlite-rebuild-BUG-003 · Schema Diff passes SQLite file paths as catalog names

- **严重度**：高（发布阻断：SQLite Schema Diff 在表列表后无法比较表结构）
- **状态**：待修复
- **涉及文件**：`src-tauri/src/commands/schema_diff.rs`、`src-tauri/src/commands/schema_diff/unified_plan.rs`

## 描述

BUG-002 修复后，两个 file-backed SQLite 专用会话都能成功打开，向导也能加载并选择表。但点击 Compare 后仍失败。`compare_table_schemas_impl` 从 `ConnectionManager::get_session_config` 取 `config.database`（SQLite 文件路径），并将其作为 `DatabaseDriver::get_table_schema` 的 catalog 参数。SQLite 驱动按 catalog 拼出 `"<文件路径>".sqlite_master`，导致 `no such table`。统一计划路径也将 `source_config.database` / `target_config.database` 直接传给 catalog 元数据方法，需要一起审查。

## 重现步骤

1. 运行 `e2e/specs/schema-diff-sqlite-rebuild.ts`，该用例创建两个临时 SQLite 文件、每个文件一张同名但列类型不同的表，并验证普通连接成功。
2. 打开 Schema Diff，选择两个 SQLite 连接和该表。
3. 点击 Compare。

## 实测结果

- `E2E_SKIP_WORKER_DATABASE=1 pnpm e2e:skip-build -- --spec e2e/specs/schema-diff-sqlite-rebuild.ts`：0/1。
- 错误日志：`cmd="compare_table_schemas" ... no such table: <临时目录>/source.sqlite.sqlite_master`。
- 用例在任何计划部署或迁移写入前失败；临时文件由 `after` 清理，目标数据库没有被修改。
- 复测构建通过 `pnpm tauri:build:webdriver` 完成；失败发生于真实 WebdriverIO 运行阶段。

## 验收标准

- SQLite 文件路径只用于连接；SQLite catalog 元数据调用使用 `main` 或驱动定义的 catalog 名。
- 两个 SQLite 文件可完整完成表列表、Compare、计划审阅及表重建部署，并保持目标现有行和新结构。
- PostgreSQL/MySQL 的数据库名仍按现有逻辑传给驱动。
