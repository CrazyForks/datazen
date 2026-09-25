# migration-schema-unified-planner-BUG-006 · MySQL cross-scope object migration remains blocked

- **严重度**：P1（阻断 MySQL 正向部署验收）
- **状态**：待修复
- **涉及文件**：`src-tauri/src/schema_diff/unified.rs`、`e2e/specs/schema-diff-unified-planner.ts`

## 描述

MySQL 对象已能通过 catalog IPC 列出，且 `get_object_ddl(view)` 可返回非空 view 定义；但统一 planner 在 source 与 target 位于不同数据库 scope 时拒绝生成对象计划。当前 WDIO 的必需 MySQL 正向旅程使用独立 source/target 数据库，因而无法 deploy/readback。此行为是现有 fail-closed schema-rewrite 限制，不是 BUG-005 的 UTF-8 DDL extraction 回归；然而它与本轨道要求通过 MySQL mixed-object 正向旅程的验收条件不匹配，应作为单独的产品能力/验收差距处理。

## 重现步骤

1. 在 `datazen_sync_mysql_src` 创建随机唯一的 parent/child 表、外键和引用这些表的 view；将 `datazen_sync_mysql_tgt` 留空。
2. 通过 Host IPC 列出 source view，并调用 `get_object_ddl(kind='view')` 确认返回非空 DDL。
3. 在统一 Schema Diff picker 中选择该对象链并请求 reviewed plan。
4. 观察 plan preparation 在任何 target 写入前 fail closed。

## 实测结果

WDIO `e2e/specs/schema-diff-unified-planner.ts` 的 MySQL 正向旅程为 0/1。Host DDL 提取返回 252 个非空白字符，原始 `information_schema.VIEWS.VIEW_DEFINITION` 长 886 字符；随后 planner 返回：

```text
Object DDL is not rewritten across schemas; choose matching scopes or migrate this object through a renderer that supports schema mapping.
```

该诊断来自 `src-tauri/src/schema_diff/unified.rs` 的既有 scope guard。计划没有可执行语句，未发生 target 写入；该随机 fixture teardown 后 source/target 精确计数为 0/0。MySQL fail-closed 用例虽为 1/1，但也被同一 scope guard 拦截，因此没有独立验证预期的 missing-table-dependency 诊断。MySQL 四种对象 catalog smoke 为 4/4，说明当前阻塞位于 DDL 计划阶段而非对象发现。

## 处理要求

明确并实现本轨道的 MySQL 正向迁移契约：为 MySQL source/target schema mapping 提供经过验证的 renderer 重写能力，或调整测试/验收为相同 scope 且定义安全、可执行的替代部署边界。修复后需重新运行 MySQL mixed-object WDIO 正向 deploy/readback 和 fail-closed 用例，并继续证明拒绝路径无写入、source/target fixture 清理为 0/0。不能把当前拒绝行为误报为 DDL extraction 失败。

## 发现记录（round-4）

- 独立 fresh build 和完整 unified planner WDIO 结果见 `test-results/unified-planner-retest-r4.md`。
- PostgreSQL 正向 deploy/readback 与拒绝用例均通过 1/1；MySQL positive 为 0/1，MySQL catalog smoke 为 1/1（四种 kind 全部可见）。完整 WDIO 为 4 passing、1 failing。
- BUG-005 的 UTF-8 extraction 修复已由 unit 路径和 live MySQL `get_object_ddl(view)` 复测关闭；本卡记录的是其后的跨 scope plan blocker。
