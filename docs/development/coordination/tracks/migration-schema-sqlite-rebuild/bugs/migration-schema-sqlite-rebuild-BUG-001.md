# migration-schema-sqlite-rebuild-BUG-001 · SQLite rebuild drops ON CONFLICT policies

- **严重度**：高（发布阻断：重建会改变已审核表的写入语义）
- **状态**：已修复并通过独立复测（R5 文件型 driver journey 9/9）
- **涉及文件**：`packages/drivers/sqlite/src/sqlite/schema.rs`、`packages/drivers/sqlite/src/migration/rebuild.rs`、`packages/drivers/sqlite/tests/schema_rebuild_journey.rs`

## 描述

SQLite 列级或表级约束上的 `ON CONFLICT` 策略没有进入 Schema Diff 快照的迁移阻断信息，而 rebuild serializer 也没有序列化这些策略。受影响的结构变更因此可能正常生成重建语句，却把 `IGNORE`、`REPLACE` 等运行时行为改成默认冲突处理方式，造成已审核迁移破坏既有数据写入契约。

独立复现报告 `test-results/independent-r4.md` 记录：原表 `CREATE TABLE before_rebuild (email TEXT UNIQUE ON CONFLICT IGNORE)` 接受重复插入并保留一行；重建出的 `UNIQUE(email)` 则对重复插入报完整性错误。

## 重现步骤

1. 在文件型 SQLite 数据库创建 `CREATE TABLE before_rebuild (email TEXT UNIQUE ON CONFLICT IGNORE)`。
2. 插入一行 `email = 'same'`，再插入同值第二行；原策略会忽略第二行，数据库中仍是一行。
3. 获取 Schema Diff 表快照并请求一个需要 SQLite table rebuild 的结构变更。
4. 观察旧实现没有 `ON CONFLICT` 迁移 blocker，生成的 replacement DDL 只包含 `UNIQUE(email)`。
5. 重建后再次插入同值会报唯一约束错误，说明表行为已经被静默改变。

## 零写入验收标准

- SQLite 列级与表级 `ON CONFLICT` policy 都必须在规划/渲染阶段作为“不支持保真重建”的明确 blocker；未知 action 也必须 fail closed。
- 针对 `UNIQUE ON CONFLICT IGNORE` 以及其余被覆盖的列约束和表约束 AST 形式，文件型测试需确认 render 返回 blocker，且重建尝试前后的 `sqlite_master.sql`、目标行集均相同；没有目标 DDL 或数据写入。
- `UNIQUE ON CONFLICT IGNORE` 在 blocker 检查后仍保持原行为：重复值插入成功但不会增加行数。
- 普通、可支持的表重建正向旅程仍须通过并验证重建读回。

## 修复记录（round-1）

- 在 `sqlite_master.sql` 的 token 流中检查未引用的 `ON CONFLICT` 关键字对，覆盖列级与表级语法、跨注释空白形式；不匹配字符串字面量或引用标识符。策略加入 `migration_blockers`，沿用已有 rebuild preflight 在任何写入前拒绝。
- 添加文件型回归，覆盖列级 UNIQUE / NOT NULL / PRIMARY KEY，以及表级 UNIQUE / PRIMARY KEY / CHECK 和五种 SQLite conflict actions；验证目录和行集不变、`IGNORE` 行为保留。
- 自验通过：新增冲突策略回归 1/1；文件型 rebuild 旅程 9/9；SQLite driver suites 78 passed / 1 个已知 baseline assertion filtered；Host planner 74/74、deploy 7/7。
- 新鲜 R5 tester 文件型 SQLite driver journey 9/9 通过，其中包含普通重建读回与 `ON CONFLICT` fail-closed 零写入检查；实现 commit：`c20e837ea1887f94678b85f226ec02f80c4b9d16`。
