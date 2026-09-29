# migration-schema-sqlite-rebuild-BUG-004 · SQLite reviewed deploy scope disagrees with the UI catalog

- **严重度**：高（发布阻断：SQLite Schema Diff 生成计划后无法部署）
- **状态**：待修复
- **涉及文件**：`src-tauri/src/commands/schema_diff.rs`、`src-tauri/src/commands/schema_diff/unified_plan.rs`

## 描述

在 BUG-003 修复后，Schema Diff 能加载 SQLite 表、比较结构并生成重建计划。部署时后端拒绝计划，提示 `Target database or schema scope changed after review; compare again`。冻结的审阅记录使用连接配置中的 SQLite 文件路径作为 `target_database_scope`，而 Schema Diff UI 传入逻辑 catalog `main`；两者代表同一个文件连接，但字符串比较失败。

## 重现步骤

1. 运行 `e2e/specs/schema-diff-sqlite-rebuild.ts`，选择两个 file-backed SQLite 连接。
2. 比较一张列类型不同的表，生成并审阅重建计划。
3. 确认后部署。

## 实测结果

- `E2E_SKIP_WORKER_DATABASE=1 pnpm e2e:skip-build -- --spec e2e/specs/schema-diff-sqlite-rebuild.ts`：0/1。
- 表列表、Compare、生成计划、审阅均成功；部署返回 `Target database or schema scope changed after review; compare again`。
- 失败发生在任何迁移写入前；测试清理两个临时数据库，目标结构和行未改变。
- Webdriver 应用由 `pnpm tauri:build:webdriver` 构建。

## 验收标准

- SQLite 审阅范围以逻辑 catalog `main` 冻结，与部署请求一致；文件路径仍用于连接身份验证。
- 同一 WDIO 旅程完整部署表重建，目标已有行 `id=7, value='kept'` 与新 `BLOB` 列定义均保留。
- PostgreSQL/MySQL 现有 database/schema 范围校验保持不变。
