# Fresh independent Tester report — Schema dependency DAG

- Candidate: `14e8ca1a72b7be4e740696cd15b6cbcc0123f40e`
- Tester branch: `codex/migration-schema-dependency-dag-fresh-tester`
- Result: `TEST_FAILED`
- Scope: independent focused tests, changed-line coverage measurement, and serial WDIO acceptance journeys for PostgreSQL and MySQL. No production code was changed in the tester worktree.

## Findings

The direct serial WDIO run finished with 5 passed and 5 failed. Three journeys passed on MySQL: create tables with an FK, add an FK to an existing table, and dropping selected child and parent tables in reverse dependency order. The last journey deployed successfully and read back the removal. The parent-only unselected-dependent blocker passed on both PostgreSQL and MySQL, exposing no executable plan and leaving the fixture objects intact.

Two PostgreSQL happy paths confirmed a production defect: creating the reviewed missing tables plus FK, and adding an FK to an existing table, were rejected at deploy with `Target schema changed for public.<fixture>; compare again`, even though the target had not changed since review. No DDL was deployed. See [BUG-005](./bugs/migration-schema-dependency-dag-BUG-005.md).

Three other journeys were inconclusive due to repeated stale WebDriver element reads and timeouts: PostgreSQL selected child-and-parent drop, and the late-dependent-after-review rejection journey on each dialect. The PostgreSQL drop did not reach observed plan/order/read-back assertions. The late-dependent tests did not confirm the expected rejection/read-back. These are test/UI timeouts, not confirmed product bugs. No stale plan was reported as deployed. The MySQL late child and parent remained until exact-name cleanup.

The MySQL visibility gate did not skip the positive drop case. The local root account showed direct global `SELECT` and `SHOW DATABASES` privileges without partial revokes. Catalog reads succeeded in passing MySQL cases, but the app log only contained SQL parser warnings and no catalog table-count or elapsed-time record. Therefore the scan count and duration could not be independently recorded.

## Focused validation

- Host Schema Diff Rust tests: 162 passed.
- Driver API migration tests: 15 passed.
- PostgreSQL driver tests: 132 library tests passed; opt-in live FK-introspection integration: 1 passed.
- MySQL driver tests: 115 library tests and 4 cross-database integration tests passed.
- Host TypeScript check passed. The E2E project typecheck emitted 156 pre-existing workspace diagnostics; none referenced the changed dependency-order spec.
- Changed spec formatting, Rust formatting, and `git diff --check` passed.
- `pnpm tauri:build:webdriver` produced the webdriver binary used for testing. The command subsequently exited in its DMG hook; DMG packaging is out of scope.

## Coverage

The available changed-production executable-line profile measured 269/658 lines (40.9%), below the required 80% threshold. Per file:

- `src-tauri/src/commands/schema_diff.rs`: 71/299
- `src-tauri/src/schema_diff/plan.rs`: 179/206
- `src-tauri/src/schema_diff/reviewed.rs`: 19/55
- `packages/driver-api/src/reuse.rs`: 0/2
- `packages/driver-api/src/traits.rs`: 0/2
- `packages/drivers/mysql/src/mysql.rs`: 0/86
- `packages/drivers/postgres/src/schema.rs`: 0/8

The denominator contains added executable production lines that map to instrumented source. It excludes test-only ranges: `commands/schema_diff.rs` lines 2032–EOF; `plan.rs` lines 1969–1971; `reviewed.rs` lines 339–EOF; `reuse.rs` lines 551–EOF; `traits.rs` lines 1015–EOF; `mysql.rs` lines 14–16 only (external test-module declaration); and `postgres/schema.rs` lines 537–EOF. A further 128 added lines did not map to executable instrumented source and were excluded. The app-runtime profile did not flush when the app stopped, and driver tests were not instrumented, so this is the available Host unit/build profile rather than full app/driver runtime coverage. The ≥80% coverage gate is unmet and remains release-blocking.

## E2E setup incident and cleanup

An initial `pnpm e2e:skip-build` invocation with `E2E_SKIP_WORKER_DATABASE=1` unexpectedly ran `e2e/run.mjs` and its global `e2e/setup-e2e-env.sh`. The setup modified shared seed data before aborting in `setup-sync-dbs.sh` because `E2E_PG_RO_PASSWORD` was unset. On immediate stop, the runner automatically invoked `e2e/teardown-e2e-env.sh`.

Known effects from the setup/teardown output:

- PostgreSQL `datazen_e2e.product` was deleted and reseeded with four rows (active=2, pending=1, inactive=1). A read-only post-incident check found four rows with those counts. Its pre-run contents are unknown.
- MySQL `datazen_test` was ensured. A read-only post-incident check found `datazen_test.product` had zero rows. Its pre-run contents are unknown.
- Teardown reported cleaning ephemeral objects in PostgreSQL `datazen_e2e`, `datazen_sync_src`, and `datazen_sync_tgt`; its output included a `DROP CASCADE` notice for the in-progress unique PostgreSQL FK fixture.
- Teardown reported cleaning ephemeral objects in MySQL `datazen_test`, `datazen_sync_mysql_src`, and `datazen_sync_mysql_tgt`.
- Setup's sync-database phase aborted at the missing password before its remaining setup work completed.

There was no before-image, so no restoration or reseed was attempted. After this incident, the WDIO config and hook path were audited; acceptance was invoked directly with WDIO against the already-built app, bypassing `run.mjs` and global setup/teardown. It used a fresh private app-data directory, port 4445, and `E2E_SKIP_WORKER_DATABASE=1`.

The WDIO timeout left two exact MySQL fixtures for which the parent authorized cleanup: `sd_dag_mysql_target_parent_only_a_parent_mufm9gcw` and `sd_dag_mysql_target_parent_only_z_child_mufm9gcw_late`. The test helper was inspected and used only with those exact names and this run's config IDs. Read-only verification found no `sd_dag_%` fixtures in PostgreSQL `datazen_sync_src`/`datazen_sync_tgt` or MySQL `datazen_test`, `datazen_sync_mysql_src`, and `datazen_sync_mysql_tgt`; both exact MySQL tables were absent, and no `e2e_schema_dag_` config IDs remained in the private app store. The app was stopped and port 4445 released.

