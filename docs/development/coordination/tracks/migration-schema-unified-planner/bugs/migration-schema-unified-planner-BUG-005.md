# migration-schema-unified-planner-BUG-005 · MySQL view DDL lookup fails for a visible view

- **严重度**：P1（阻断）
- **状态**：已修复
- **涉及文件**：`packages/driver-api/src/schema_objects.rs`、`packages/driver-api/src/schema_object_commands.rs`、`src/windows/schema-diff/`、`e2e/specs/schema-diff-unified-planner.ts`

## 描述

MySQL view 已能通过对象列表查询返回，但调用 Host `get_object_ddl` 获取同一个 view 定义时失败并返回 `Query failed: Object was not found or its DDL is unavailable`。同一来源连接直接查询 `information_schema.VIEWS.VIEW_DEFINITION` 可读到非空定义，因此该错误不是 fixture 不存在或 MySQL catalog 隐藏。统一 planner 的计划生成界面出现相同错误，无法生成包含 MySQL view 的 reviewed plan。

## 重现步骤

1. 在隔离 MySQL E2E 数据库中使用随机唯一名字创建 source parent/child 表、外键和依赖这些表的 view；target 不创建对象。
2. 查询 `information_schema.views`，确认该 view 存在；调用 `get_database_objects(kind='view')`，确认返回唯一匹配且 schema/name 正确。
3. 使用同一 source connection 执行 `SELECT VIEW_DEFINITION AS ddl FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='<fixture-view>'`，确认结果非空。
4. 调用 Host `get_object_ddl(kind='view', name='<fixture-view>', schema=null)`，或在 Schema Diff 中选择该 view 并生成计划。

## 实测错误日志与影响范围

独立 WDIO 实测同一 fixture 的 `information_schema.views` 计数为 1，修复后的 raw view list 和 Host object list 各返回匹配 1；raw `VIEW_DEFINITION` 长度为 886–890 字符。Host `get_object_ddl` 抛出：

```text
Query failed: Object was not found or its DDL is unavailable
```

计划页 DOM 有 `schema-diff-plan-panel`，但显示两条相同错误，且没有 `schema-diff-allow-destructive` 控件；生成计划等待超时。MySQL unified planner 正向和未选依赖拒绝 journey 均在此阶段失败。没有触发部署；每次随机 source/target fixture teardown 后精确对象计数均为 0/0。

该缺陷阻断 MySQL view migration 计划生成及针对 view 依赖的正向部署和 fail-closed 验收。

## 修复记录（round-1）

- 修复提交：`04b309cb`。
- DDL-only bytes handling：DDL 提取器只将有效 UTF-8 的 `Value::Bytes` 解码为文本；不会对任意二进制值做 lossy 转换。
- 非法 UTF-8 仍作为不可用 DDL 拒绝；回归测试覆盖长多字节定义成功提取和非法 UTF-8 拒绝。

## 复测记录（round-1）

- 独立复测确认 `get_object_ddl(view)` 已能从 MySQL catalog bytes 返回非空定义：本轮 fixture 返回 252 个非空白字符；同一 view 的原始 `VIEW_DEFINITION` 为 886 字符。WDIO 新增非空断言，避免只验证对象可见。
- Driver API 全套 175/175 通过，其中包括有效长 UTF-8 bytes、非法 UTF-8 拒绝和既有 `Value::String` 兼容路径；无 lossy decoding。
- MySQL 后续正向 planner 测试被既有跨 schema 安全门拦截（source `datazen_sync_mysql_src`、target `datazen_sync_mysql_tgt`）。该错误发生在 DDL 提取之后，明确提示对象 DDL 暂不跨 schema 改写；它不是本卡所述 DDL 查找缺陷。本卡按直接 DDL 与编码路径实测关闭，整体轨道仍因 MySQL 正向计划验收未过而保持 `FAILED`。
- 完整记录见 `test-results/unified-planner-retest-r4.md`。
