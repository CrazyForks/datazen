# migration-schema-unified-planner-BUG-009 · MySQL table dependency catalog is incomplete

- **严重度**：P1（阻断）
- **状态**：修复已提交 `b849a774` 并经 Fresh Tester R8 功能验证；R10 命令路径覆盖率仍略低于 80% gate
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

## 修复

- Added a MySQL table dependency query over `TABLES`, `TABLE_CONSTRAINTS`, `KEY_COLUMN_USAGE`, `REFERENTIAL_CONSTRAINTS`, and the referenced base-table catalog. It emits exact structured parent identities including schema, and deduplicates composite-key columns into one edge.
- A table is complete only when exactly one selected base table is visible, all FK column metadata joins consistently, source and referenced positions span `1..N`, referenced identities are unambiguous and visible, and no orphan reference rows exist.
- Before marking a result complete, the driver requires a direct global `SELECT` grant and rejects partial revokes. Query errors, missing/ambiguous tables, incomplete grants, and malformed catalog rows remain incomplete. Self-references are validated and omitted as intra-object edges; cross-schema identities remain qualified.
- Added an opt-in isolated MySQL fixture for proven empty dependencies, composite FK deduplication, self-reference, two-table cycles, missing table, optional cross-schema FK, and exact cleanup. Cleanup attempts every owned drop and verifies remaining objects before reporting failures.

## 编码验证

- Driver API: `cargo test -p datazen-driver-api --lib` — 196 passed. A fresh isolated Rust coverage run using Xcode `llvm-profdata`/`llvm-cov` covered `execute_object_dependencies` at 74/74 lines (100%) and `schema_object_commands.rs` at 556/677 lines (82.13%).
- MySQL driver: `cargo test -p datazen-driver-mysql` — 139 passed, 3 ignored (isolated database fixtures).
- Host: `cargo test -p datazen --lib schema_diff::` — 204 passed.
- `cargo fmt --all -- --check` and `git diff --check` — passed.
- The live catalog fixture was not run in the product worktree because it had no `MIGRATION_TEST_*` configuration and the default MySQL socket was unavailable. Fresh Tester must run the opt-in fixture and real WDIO journeys, then record exact cleanup evidence.

## Fresh Tester R8 evidence

- The new retained live WDIO diagnostic returned `complete=true` with no dependencies for the parent, and `complete=true` with exactly the parent table edge for the child. It also verified that the child's self-FK was omitted as an intra-object edge. Exact post-test MySQL source and target fixture counts were `0/0`; both temporary connection configurations were removed.
- The opt-in `schema_dependency_catalog` Rust integration target passed **2/2** against the test's allowlisted `datazen_test` database. Its table fixture covered proven empty dependencies, composite FK deduplication, self-reference, cycles, missing objects, optional cross-schema references, and exact fixture cleanup; the view fixture also passed. The test guard and fixture cleanup remained active.
- The full six-journey WDIO suite passed the MySQL mixed parent/child/view plan, deploy, readback, and target-side view query, as well as the exact missing-dependency zero-write case and four-kind catalog smoke. All started journeys ended with exact `0/0` cleanup. The only failed/unproven journey is BUG-007's metadata blocker.
- See the [round-8 retest report](../test-results/unified-planner-retest-r8.md). This closes BUG-009's functional verification; the separate >=80% coverage gate is still pending because the full helper module and dependency dispatcher measured below that threshold.

## Fresh Tester R10 coverage evidence

- The updated, isolated API-unit coverage run passed 191/191 and measured the MySQL table success/visibility path added for BUG-009. `execute_object_dependencies` is 59/74 lines (79.73%); the full `schema_object_commands.rs` file is 513/677 (75.78%). The dispatcher remains just below the function threshold and the complete changed file is below the 80% gate.
- Uncovered production paths include PostgreSQL object dispatch and sequence usage, MySQL view visibility, and empty optional schema/target-name filters. Exact uncovered line groups and scope are in the [round-10 retest report](../test-results/unified-planner-retest-r10.md). Keep the coverage gate open for meaningful tests; the R8 live functional verification of BUG-009 remains valid.
