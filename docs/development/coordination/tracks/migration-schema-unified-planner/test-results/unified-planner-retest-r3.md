# migration-schema-unified-planner · Fresh Tester round-3

- Result: `TEST_FAILED`
- Verification worktree: `datazen-migration-schema-unified-planner-verification`
- Code under test: `49fa1eb7` (BUG-004 fix), merged at `584a46da`; current verification HEAD began at `07a56f15`
- Tester changes: WDIO MySQL catalog smoke and diagnostics only; no product source modified

## Review

Reviewed all changed lines in `packages/driver-api/src/schema_objects.rs` and `packages/drivers/mysql/tests/schema_objects_sql.rs` from `49fa1eb7`. Function, procedure, trigger, and view list SQL all backtick-quote the reserved alias while preserving the exact result label `schema`. Unit coverage includes every kind plus the shared parser's schema/name contract. No defect was found in BUG-004's patch itself.

## Independent checks

- `pnpm install --offline --frozen-lockfile`: passed; `node_modules` is a physical directory inside this verification worktree. The main checkout's dependencies were not touched.
- `node scripts/generate-builtin-locales.mjs`: passed.
- MySQL driver crate: 131 passed, 0 failed, 2 isolated-database tests ignored.
- Driver API library: 174/174 passed.
- Host `schema_diff::` tests (including nested `commands::schema_diff::`): 204/204 passed.
- Schema Diff Vitest: 62/62 passed; `npx tsc --noEmit` passed.
- `pnpm exec tsc --noEmit -p e2e/tsconfig.json` still reports pre-existing diagnostics in unrelated E2E helpers/specs and generated driver typing; it emitted no diagnostic for `schema-diff-unified-planner.ts`. WDIO successfully transpiled and executed that spec.
- `git diff --check` passed. The WDIO spec was formatted with the repository Prettier.

## Build and WebdriverIO

The required `pnpm tauri:build:webdriver` ran with `DATAZEN_DRIVERS=postgres,mysql,sqlite`, an absolute target path inside this worktree, `CARGO_INCREMENTAL=0`, and debug info disabled. The frontend and new app binary plus `DataZen.app` bundle were produced. The command exited 1 only in final macOS `bundle_dmg.sh`; that packaging step is excluded by project instructions and the user's explicit scope decision. The generated app was launched on isolated Webdriver port `49177` with an app-data directory under this worktree. All WDIO runs set `E2E_SKIP_WORKER_DATABASE=1` and did not execute global DB setup/teardown.

The original four unified planner journeys produced:

- PostgreSQL create/deploy/readback: passed 1/1; exact source/target cleanup 0/0.
- PostgreSQL unselected-view dependency: passed 1/1; exact source/target cleanup 0/0 and target remained unchanged.
- MySQL create/deploy/readback: failed at view DDL retrieval; exact source/target cleanup 0/0.
- MySQL unselected-view dependency: failed at the same DDL retrieval stage before deploy became available; exact source/target cleanup 0/0.

The added MySQL catalog smoke passed 1/1. It created a random function, procedure, trigger, trigger table, and view in the exact source database. Through the newly built app it called `get_database_objects` once for each of `function`, `procedure`, `trigger`, and `view`, and each response contained the exact fixture name and `schema=datazen_sync_mysql_src`; trigger target schema/table also matched. The target received no matching fixture object. Teardown confirmed exact source/target counts 0/0. A repeated smoke run after adding the raw alias assertion also passed 1/1.

The MySQL planner failure was independently narrowed without product changes: `information_schema.views` returned one exact row; both raw quoted view-list SQL and Host `get_database_objects` returned one match; raw `VIEW_DEFINITION` returned a non-empty value (886–890 characters across unique fixture names); Host `get_object_ddl` returned `Query failed: Object was not found or its DDL is unavailable`. The UI showed two alerts with this error, and the Plan panel lacked the review control. This is registered as `BUG-005`, separate from the now-fixed `BUG-004`.

## Coverage and cleanup

All four production list-query branches changed by `49fa1eb7` were exercised through live `get_database_objects` IPC and each parsed the expected `schema` and name: 4/4 changed paths (100%). This round did not produce an LLVM line-coverage report. Each unique PG and MySQL planner fixture and the MySQL four-object catalog fixture reported exact source and target post-teardown counts of 0/0. The 13 root-level pre-existing `.profraw` files were left untouched.

`BUG-004` is `已修复`. Overall result is `TEST_FAILED` because MySQL view DDL lookup blocks the planner acceptance (`BUG-005`); the track remains `FAILED` pending repair and a fresh full Tester round.
