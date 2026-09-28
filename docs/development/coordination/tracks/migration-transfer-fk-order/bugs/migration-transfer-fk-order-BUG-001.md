# migration-transfer-fk-order-BUG-001

- **状态**：待复测
- **优先级**：P1
- **标题**：Data-only Transfer writes FK-constrained target tables in mapping order
- **发现方式**：独立发布差距审计；PostgreSQL FK-constrained target fixture

## 缺陷描述

When a Data-only transfer selects both an existing parent and child target table, the executor previously wrote them in the inspected/mapping order. A child listed before its parent failed its foreign-key constraint even though the parent row was part of the same reviewed transfer. The executor commits each table independently, so a selected dependency cycle cannot be made safe merely by deferring a PostgreSQL constraint.

## 复现条件

1. Create existing PostgreSQL target tables `parent(id PRIMARY KEY)` and `child(parent_id REFERENCES parent(id))`.
2. Select both tables in child-then-parent order and transfer one matching parent and child row with Data mode + Insert.
3. Before the fix, the child write ran first and failed with a foreign-key violation.

## 修复记录（round-1）

- Captured selected target FK relationships in the reviewed plan, stably ordered selected writes parent-before-child, and retained child-only selection when its parent is not selected.
- Selected cycles, ambiguous dependencies, and unsafe destructive modes now fail before writes with an actionable validation error.
- Added Rust ordering tests and a PostgreSQL WDIO journey covering ordering, child-only selection, FK readback, and a deferred cycle with zero target rows after rejection.
- Coder self-validation: 4 focused Rust tests passed; `pnpm typecheck`, targeted rustfmt, Prettier, and diff checks passed. The PostgreSQL WDIO journey passed 2/2 both on its initial webdriver build and after cleanup hardening; follow-up catalog checks found zero `dt_fk_%` tables in source and target. Awaiting independent review/retest.
