# migration-schema-unified-planner-BUG-004 · MySQL schema-object listing SQL rejects the reserved schema alias

- **严重度**：P1（阻断）
- **状态**：待修复
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
