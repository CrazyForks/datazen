# migration-schema-unified-planner-BUG-003 · PostgreSQL live mixed-object plan blocks supported dependency chains

- **严重度**：P1（阻断）
- **状态**：待修复
- **涉及文件**：`packages/driver-api/src/schema_migration.rs`、`packages/drivers/postgres/src/schema.rs`、`packages/driver-api/src/schema_dependencies/postgres.rs`、`src-tauri/src/schema_diff/unified.rs`、`src-tauri/src/commands/schema_diff/unified_plan.rs`、`e2e/specs/schema-diff-unified-planner.ts`

## 描述

全新 Tester 在独立工作树通过真实 Host UI/IPC 对 PostgreSQL 构造并选择了一个单一混合链：自定义 enum type、`BIGSERIAL` owner table 与 owned sequence、parent/child FK、PL/pgSQL routine/trigger、依赖该表的 view。源 view 在 `information_schema.views` 中存在，`get_database_objects(kind='view')` 精确返回该 view；但 unified reviewed plan 返回 **0 条可执行语句**，并同时报告下列 3 个安全阻断：

1. view 的 driver definition 被单查询验证器拒绝：`view definition must contain one query without semicolons`。fixture 的 view 是一条 `CREATE VIEW ... AS SELECT ... JOIN ...` 查询，没有脚本分隔语句。
2. 表中选中的 enum 列在 unified table renderer 处退化为 `USER-DEFINED`，不能与已选中的精确 enum identity 匹配：`Unqualified type `USER-DEFINED` is not a recognized built-in type or present in the complete target snapshot; qualify it or select its exact source type.` PostgreSQL 的表结构查询只取 `information_schema.columns.data_type`，对用户定义类型返回通用 `USER-DEFINED`，未保留可供 renderer 使用的 `udt_schema` / `udt_name` 身份。
3. 无对象依赖的选中 PL/pgSQL trigger function 被 driver catalog 标记为 opaque：`Dependencies of `function:public.<fixture>()` are opaque; the driver must provide exact dependency identities before this object can be created or replaced in a unified plan.` 这使 PostgreSQL routine/trigger 链无法进入 reviewed deploy。

这些拒绝发生在部署前，令受支持的 type→table/sequence ownership→FK→view/routine/trigger 组合无法形成单个可审查计划。不能通过删除这些对象或放宽 planner 的 fail-closed 校验来让旅程通过；应修复 driver 提供的结构化身份/definition 与完整依赖证据。

## 重现步骤

1. 使用 `e2e/specs/schema-diff-unified-planner.ts` 的 PG create case，在 `datazen_sync_src` 与 `datazen_sync_tgt` 的随机 fixture 名上创建并选中上述对象链。
2. 在 unified object picker 中勾选 type、sequence、function、trigger、view，并选择 parent/child tables。
3. 进入统一 reviewed plan 并检查要求、SQL 数量。

## 实测错误日志与影响范围

独立 WebdriverIO 运行得到 `postgresql-create` 失败，计划面板显示 `0 语句` 和以上三条 `不支持` blocker。另一个 object-only blocked case 同样被第一条 view-definition blocker 抢先阻断，因此不能把它计为缺失 dependency 的验收通过。PG 正向和负向 fixture 清理后均通过精确 catalog 计数：`source_remaining=0 target_remaining=0`；目标从未部署任何 statement。

该缺陷阻断 PostgreSQL unified mixed-object migration；对应 live acceptance 需在修复并由全新 Tester 复测后才能通过。
