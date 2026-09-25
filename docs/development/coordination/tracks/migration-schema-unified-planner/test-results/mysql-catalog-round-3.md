# BUG-004 · MySQL catalog list repair · Fresh Tester round-3

- Product patch reviewed: `49fa1eb7`
- Result for BUG-004: `TEST_DONE` / `已修复`
- Verification app built from this worktree with PostgreSQL, MySQL, and SQLite drivers

The four MySQL list-query branches in `list_objects_sql` now quote the reserved alias as `` `schema` `` while preserving the result label required by the shared parser. Review found no additional issue in the patch.

Independent tests passed: MySQL driver crate 131 passed / 0 failed / 2 isolated-database tests ignored; Driver API library 174/174; Host `schema_diff::` 204/204; Schema Diff Vitest 62/62; and `npx tsc --noEmit`.

The new WDIO catalog smoke created random source objects and called the freshly built app's `get_database_objects` for function, procedure, trigger, and view. Each call returned its exact fixture name and `schema=datazen_sync_mysql_src`; trigger target identity also matched. A raw quoted view-list query and the Host view list each returned one match. A repeat of the catalog smoke passed 1/1. Both runs verified exact source/target fixture cleanup at 0/0. The four modified MySQL list branches were each exercised through live IPC: 4/4 changed paths.

The broader MySQL unified planner still fails later at `get_object_ddl`; this is recorded separately as `migration-schema-unified-planner-BUG-005` and does not reopen the list-query repair.
