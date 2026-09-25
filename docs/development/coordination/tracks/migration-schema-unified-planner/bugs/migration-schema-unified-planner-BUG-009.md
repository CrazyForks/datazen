# migration-schema-unified-planner-BUG-009 · MySQL table dependency catalog is incomplete

- **Severity**: P1 (release blocker)
- **Status**: Fix implemented; Fresh Tester re-test pending
- **Scope**: MySQL driver `get_object_dependencies` for tables; unified planner source dependency validation

## Evidence

Fresh Tester R7 created uniquely named InnoDB parent and child tables with a foreign key in `datazen_sync_mysql_src`. Live IPC returned `complete=false, dependencies=[]` for both because the MySQL driver had no table dependency catalog query. The unified planner correctly blocked the mixed table/view journey rather than assuming that an empty partial result proved no dependencies.

## Fix

- Added a MySQL table dependency query over `TABLES`, `TABLE_CONSTRAINTS`, `KEY_COLUMN_USAGE`, `REFERENTIAL_CONSTRAINTS`, and the referenced base table catalog. It emits exact structured parent table identities, including referenced schema, and deduplicates composite-key columns into one edge.
- A table is complete only when exactly one selected base table is visible, all FK column metadata joins consistently, source and referenced positions span `1..N`, referenced table identities are unambiguous and visible, and no orphan reference rows exist.
- Before marking the result complete, the driver requires a direct global `SELECT` grant and rejects any partial revoke. Query errors, missing/ambiguous tables, incomplete grants, and malformed catalog rows remain incomplete. Self-references are validated and omitted as intra-object edges; cross-schema identities remain qualified.
- Added an opt-in isolated MySQL fixture for proven empty dependencies, composite FK deduplication, self-reference, two-table cycles, missing table, optional cross-schema FK, and exact cleanup. Cleanup attempts every fixture drop and verifies remaining owned objects before reporting failures.

## Validation

- Driver API: `cargo test -p datazen-driver-api --lib` — 180 passed.
- MySQL driver: `cargo test -p datazen-driver-mysql` — 139 passed, 3 ignored (isolated database fixtures).
- Host: `cargo test -p datazen --lib schema_diff::` — 204 passed.
- `cargo fmt --all -- --check` and `git diff --check` — passed.
- The new live catalog fixture was not run from the product worktree: no `MIGRATION_TEST_*` credentials are configured and the default local MySQL socket is unavailable. Fresh Tester must run the opt-in fixture and the real WDIO journeys with isolated credentials, then record exact cleanup evidence.
