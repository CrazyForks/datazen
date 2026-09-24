# migration-schema-unified-planner-BUG-004 · MySQL schema-object listing SQL rejects the reserved schema alias

- **严重度**：P1（阻断）
- **状态**：已修复
- **涉及文件**：`packages/driver-api/src/schema_objects.rs`、`packages/driver-api/src/schema_object_commands.rs`、`e2e/specs/schema-diff-unified-planner.ts`

## 描述

MySQL `list_objects_sql(..., ObjectKind::View)` 生成 `SELECT TABLE_SCHEMA AS schema, TABLE_NAME AS name FROM information_schema.VIEWS ...`。本机 MySQL 对查询返回 SQLSTATE `42000` / error `1064`，语法错误位置为 `schema, TABLE_NAME AS name`。独立 live fixture 同时确认该精确 view 在 `information_schema.views` 中存在 1 行，但 `get_database_objects(kind='view')` 无法返回对象，unified object picker 因此无法选择 MySQL view。MySQL routines/triggers 也使用同一未引用的 `schema` alias，应一并评估。

## 重现步骤

1. 在本机 MySQL 的 isolated fixture database 创建唯一前缀 view。
2. 查询 `information_schema.views`，确认对应 view 存在。
3. 执行 Host IPC `get_database_objects`，参数 `kind='view'`；或运行 driver API `list_objects`。

## 实测错误日志与影响范围

WebdriverIO 直连已构建 Host app 后输出：

```text
source catalog dialect=mysql view_information_schema=1 view_raw_list_matches=0 view_driver_matches=0
driver_error=Query failed: error returned from database: 1064 (42000): You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'schema, TABLE_NAME AS name FROM information_schema.VIEWS ...'
```

随机 source/target fixture 清理后的 catalog 计数均为 0，部署未执行。该错误阻断 MySQL unified view selection 及其 FK→view mixed-plan WDIO journey。

## 复测记录（round-2）

- 使用修复 `b36a2bee` 构建的独立 Host app 再跑 unified MySQL WDIO 正向和拒绝边界，两例均在 source view catalog discovery 处复现同一 `1064 (42000)` reserved alias 错误；`information_schema.views` 的精确 fixture row 数仍为 1，Driver IPC 返回匹配数为 0。
- 正向与拒绝用例各自执行精确 source/target cleanup，两个 teardown 都确认计数为 0/0。此轮没有部署写入，也没有运行全局 worker database setup/teardown。
- BUG-004 保持待修复，MySQL unified view acceptance 仍被阻断。

## 修复记录（round-1）

- 修复提交：`49fa1eb7`。
- MySQL function、procedure、trigger、view 列表查询均使用反引号引用 `schema` 别名，同时保留 parser 所需的 `schema` 输出列名。
- 编码测试：MySQL 116 个 lib 测试和 15 个 integration 测试通过，2 个隔离数据库测试忽略；Driver API 172/172 通过；fmt 和 diff-check 通过。

## 复测记录（round-1）

- 独立逐文件 review `49fa1eb7`：四种 MySQL 对象列表均使用合法的 ``AS `schema` `` 标识符引用，输出列名仍为 parser 需要的 `schema`；没有发现额外修复缺陷。
- 独立测试 MySQL driver crate 全套：131 passed、0 failed、2 个需显式隔离数据库配置的测试 ignored；Driver API library 174/174；Host `schema_diff::`（含嵌套 `commands::schema_diff::`）204/204；Schema Diff Vitest 62/62；`npx tsc --noEmit` 通过。
- 新增 MySQL WDIO catalog smoke 实际通过 Host IPC 分别执行 `get_database_objects` 的 `function`、`procedure`、`trigger`、`view` 四个 kind。四项都返回唯一 fixture 对象，`schema=datazen_sync_mysql_src`、name 与随机 fixture 相符；触发器还返回正确的 target schema/table。另一个 raw view-list query 返回唯一匹配。测试结束后，source 和 target 精确对象计数均为 0/0。
- 本次修复改动的四个 `list_objects_sql` MySQL 分支均被 live API journey 运行并解析出 schema，即改动路径 4/4（100%）；本轮没有生成 LLVM 行覆盖报告。
- 同一构建 app 的 unified planner WDIO 中，PostgreSQL 正向与拒绝旅程通过 2/2；MySQL 正向与拒绝旅程均继续到 view DDL 获取阶段，随后因独立新缺陷 `BUG-005` 阻断。BUG-004 的对象枚举已修复，但整条 MySQL planner acceptance 仍未通过。
- `pnpm tauri:build:webdriver` 已生成新 `DataZen.app` 并用于 WDIO；命令仅在最终 DMG bundler 阶段返回错误，该阶段按项目规则及用户要求排除。e2e 专用 TypeScript 检查有仓库既有的其他文件诊断，未命中本次 E2E spec。
- 独立结果：`BUG-004` 已修复；总体 track 因 `BUG-005` 保持 `FAILED`。详细结果见 [unified-planner-retest-r3.md](../test-results/unified-planner-retest-r3.md)。
