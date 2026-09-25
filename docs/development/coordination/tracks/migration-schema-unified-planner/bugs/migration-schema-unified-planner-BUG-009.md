# migration-schema-unified-planner-BUG-009 · MySQL table dependency catalog is incomplete

- **严重度**：P1（阻断）
- **状态**：已由 Fresh Tester R7 独立复现；待单轨修复
- **涉及范围**：MySQL driver `get_object_dependencies` for tables; unified planner source dependency validation

## 描述与重现

The unified planner must prove the exact dependencies of a selected source table before it can approve a cross-scope plan. For MySQL tables, `execute_object_dependencies` currently has no complete catalog-query branch: the dependency SQL contract is implemented for views, while a table request returns `SchemaObjectDependencies::incomplete()`.

Fresh Tester R7 created a uniquely named InnoDB parent table and child table with a foreign key in `datazen_sync_mysql_src`, then called live `execute_driver_command(get_object_dependencies)` for both exact table identities. The new verifier-only WDIO diagnostic observed:

```text
kind=table schema=datazen_sync_mysql_src name=<fixture>_parent complete=false dependencies=[]
kind=table schema=datazen_sync_mysql_src name=<fixture>_child complete=false dependencies=[]
```

The normal MySQL positive mixed-chain journey therefore cannot reach a reviewed plan or deploy: the planner correctly fails closed when it cannot prove table dependencies. The direct diagnostic's exact fixture cleanup assertion passed with `source_remaining=0 target_remaining=0`; its persisted source/target connection configurations were then removed by `teardownSchemaDiffFixture` in a nested `finally`.

## 修复要求

- Add a MySQL table dependency catalog implementation that returns exact, structured identities for the dependency kinds supported by the planner, including foreign-key table references. It must query the selected database explicitly and distinguish incomplete/ambiguous metadata from a proven empty dependency set.
- Preserve fail-closed behavior when permissions, catalog rows, unsupported dependency forms, or query errors prevent a complete proof. Do not treat `dependencies=[]` as complete by default.
- Add driver-level regressions for a complete no-dependency table, an exact FK parent edge, cross-schema references where supported, and incomplete/error paths; keep tests in the MySQL driver crate.
- Rerun the MySQL positive mixed-table/view planner journey through reviewed deploy and readback, the exact unselected-dependency blocker with an explicit zero-write assertion, and all other unified-planner journeys. Assert exact fixture cleanup even when assertions fail.

## Fresh Tester R7 evidence

- Full `e2e/specs/schema-diff-unified-planner.ts`: 4 passing, 2 failing. The MySQL positive mixed-chain path stopped before deploy because both selected source tables reported incomplete dependency snapshots. No deploy was clicked and the planner produced no deployable statements.
- Direct live-IPC diagnostic: 1/1 passed; both selected parent and child returned `complete=false` and `dependencies=[]` as shown above. The targeted rerun after correcting nested-finally teardown again passed and reported exact 0/0 cleanup.
- The separate MySQL missing-dependency journey still passes its exact target identity blocker, empty plan, disabled deploy, and pre-cleanup zero target count. This validates fail-closed behavior, not completeness for selected MySQL tables.
- The `WITH CASCADED CHECK OPTION` journey timed out before plan assertions and did not independently establish its metadata blocker or explicit no-write assertion. It remains tracked under BUG-007.
- See [round-7 retest report](../test-results/unified-planner-retest-r7.md). Overall track remains `FAILED`.
