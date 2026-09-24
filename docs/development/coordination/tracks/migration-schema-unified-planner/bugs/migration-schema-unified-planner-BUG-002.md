# migration-schema-unified-planner-BUG-002 · PostgreSQL view catalog reports the view as its own dependency

- **严重度**：P1（阻断）
- **状态**：待修复
- **涉及文件**：`packages/driver-api/src/schema_dependencies/postgres.rs`，`packages/drivers/postgres/tests/schema_dependency_catalog.rs`

## 描述

PostgreSQL `get_object_dependencies` 对普通 view 返回了指向该 view 自身的 `DatabaseObject` 边，同时 `complete` 仍为 `true`。独立 live fixture 期望 view 只依赖其引用的 table 和 function，实测得到 table、function、自身 view 共三条。统一依赖图会把每个被选中的 PostgreSQL view 构造成自环，导致计划拓扑排序将合法 view 标记为循环或阻断部署。

## 重现步骤

1. 在 disposable PostgreSQL 数据库创建一张唯一测试表、一个函数和引用二者的 view。
2. 对该 view 执行 `get_object_dependencies`，传入精确 `schema`、`name`。
3. 检查响应的 `complete` 和 `dependencies`。

## 实测错误日志与影响范围

独立 live 检查在 `packages/drivers/postgres/tests/schema_dependency_catalog.rs` 的精确依赖断言失败：预期依赖数为 2，实测为 3；额外边为 `{"kind":"view","schema":"public","name":"dz_mig_dep_view_decdaa377d9b419194c6ef84ed975f39"}`。响应仍标记 `complete: true`。额外边与本次随机 fixture 的 view 名匹配，证明是自身边而非其他对象。

该缺陷影响 PostgreSQL view 迁移计划的依赖 DAG；所有相关部署需在修复并由全新 Tester 复验后才可放行。
