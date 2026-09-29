# migration-schema-sqlite-rebuild-BUG-002 · Schema Diff SQLite endpoints cannot open dedicated sessions

- **严重度**：高（发布阻断：SQLite 结构对比向导无法加载表列表）
- **状态**：已修复并通过 R8 文件型 WDIO
- **涉及文件**：`src/windows/schema-diff/useSchemaDiffEndpoints.ts`、`src/lib/dedicatedDbSession.ts`、`src-tauri/src/services/connection_manager/connections.rs`

## 描述

在两个有效、可由普通 `connect` 打开的 SQLite 文件连接上，Schema Diff 选择端点后无法载入表列表。文件路径与 SQLite catalog 名 `main` 混用：`useSchemaDiffEndpoints` 将选中的 catalog 名交给 `ensureDedicatedSession`，后者调用 `connectDedicated(connectionId, database)`；`ConnectionManager::establish_connection` 把 `database` 覆写到连接配置的文件路径字段，SQLite 驱动尝试打开名为 `main` 的文件并报错。

## 重现步骤

1. 用 `e2e/specs/schema-diff-sqlite-rebuild.ts` 创建两个临时文件型 SQLite 数据库与保存的连接。
2. 通过 IPC 对两个 `connectionId` 执行普通 `connect`；都成功，随后释放。
3. 打开 Schema Diff，选择这两个连接并进入对象选择步骤。
4. `setSchemaDiffTables` 在 20 秒内找不到表行；应用日志重复出现 `cmd="connect_dedicated" ... (code: 14) unable to open database file`。

## 实测结果

- `E2E_SKIP_WORKER_DATABASE=1 ... node e2e/run.mjs --skip-build --spec e2e/specs/schema-diff-sqlite-rebuild.ts`：0/1，表列表加载超时（2026-09-28）。
- 换用系统临时目录、worktree `e2e/fixtures/`、应用数据目录 `e2e/.app-data/` 均同样失败；第三轮增加普通 `connect` 正向检查后，两个连接均成功，排除文件不存在或文件目录权限问题。
- 失败发生在任何迁移写入之前；目标 SQLite 行和表结构未改变，临时文件由测试 `after` 清理。

## 验收标准

- SQLite dedicated session 保持原连接配置中的真实文件路径；UI 选择的 `main` 用于后续 schema/catalog 查询，不覆盖文件路径。
- 两个不同 SQLite 文件的 Schema Diff 可列出表、比较、生成计划、部署一次需要 table rebuild 的差异，部署后读回目标已有行和新结构。
- PostgreSQL/MySQL 选数据库的 dedicated session 行为保持正常。

## 修复与验证

- `c4908888`：SQLite `main` 仅作为 catalog，dedicated session 继续使用配置文件路径。
- 独立 R8 WDIO 完成 2/2：一例加载两份文件库、比较、审阅并部署重建，目标行和新列类型读回正确；另一例验证加载后的漂移拒绝路径；见 `validation/sqlite-r8-wdio.md`。
