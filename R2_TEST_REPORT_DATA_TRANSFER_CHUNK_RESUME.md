# Data Transfer chunk-resume R2 independent test report

**Verdict: TEST_FAILED**

Candidate: `e774e3554a07e889383be02d757395f315e7fdf6`  
Tester checkout: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-transfer-chunk-resume-fresh-tester-r2`  
Checkout state: detached HEAD at the exact candidate commit; no candidate product files changed.

## Setup and preflight

- `pnpm install`: passed (exit 0). The prepare hook logged a non-fatal Husky `EPERM` while trying to update the shared main checkout Git config; dependency installation and generated driver/locale files completed.
- Verified `node_modules` exists as a physical local directory and is not a symlink.
- Disk after the webdriver build and E2E run: approximately 4.0 GiB free.
- `pnpm typecheck`: passed.
- `pnpm exec vitest run src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx`: passed, 34/34.
- `cargo test -p datazen --lib data_transfer`: passed, 140/140.
- `cargo test -p datazen-driver-postgres --lib`: passed, 133/133, including the crate's local PostgreSQL checks.
- `cargo test -p datazen-driver-mysql --lib`: passed, 124/124, including the crate's local MySQL check.
- `git diff --check 68bde43f..HEAD`: passed.
- `rustfmt --edition 2021 --check` on changed Rust files: passed.
- `pnpm exec prettier --check` on changed TypeScript files: passed.

## Webdriver build and journeys

Ran `pnpm tauri:build:webdriver`. Frontend and Rust webdriver app compilation succeeded and produced:

`target/debug/bundle/macos/DataZen.app/Contents/MacOS/datazen`

The command exited 1 in the subsequent DMG packaging step. The app binary was available and launched with a unique temporary `DATAZEN_DATA_DIR` on WebDriver port 4445.

The first direct WDIO attempt was rejected by automatic review because it flagged possible shared database teardown. After read-only hook inspection established that the dedicated config overrides the base worker-database setup and teardown, the exact command was retried:

```sh
E2E_WD_PORT=4445 E2E_SKIP_WORKER_DATABASE=1 pnpm exec wdio run e2e/wdio.migration-transfer-ack-loss.conf.ts
```

The direct run completed with exit 1: **2 passing, 3 failing** across the two driver specs.

Passing journeys:
- PG→MySQL: reports an unknown outcome after an applied commit, stops the later table, and consumes the plan/token.
- MySQL→PG: same acknowledgement-loss behavior.

Failing journeys:
- PG→MySQL bounded-chunk cancellation/resume: `browser.waitUntil` polled `SELECT COUNT(*) AS c FROM <chunkTable>` on the dedicated target observer every 150 ms for up to 30 seconds and required the count to equal exactly 2. It timed out at `packages/drivers/postgres/e2e/data-transfer-commit-ack-loss-pg-mysql.ts:518` with `first two-row target chunk was not confirmed`. The test failed before clicking the Cancel button, so the cancellation result, resume token, `rowsInserted`, and paused row count were not observed.
- PG→MySQL source-mutation rejection: the same 30-second/150-ms exact-count wait failed at line 653 with `first two-row target chunk was not confirmed`. The test did not reach Cancel, source mutation, or the intended resume rejection assertion.
- MySQL→PG bounded-chunk cancellation/resume: the same exact-count wait failed at `packages/drivers/mysql/e2e/data-transfer-commit-ack-loss-mysql-pg.ts:522` with `first two-row target chunk was not confirmed`. The test failed before clicking Cancel, so it did not observe a cancelled result or attempt resume.

No plan/preview error appeared in the WDIO output or the isolated app log. The UI journeys had entered execution (the initial captured transfer call was present), but each failure occurred while waiting for target visibility, before the Cancel interaction; consequently no UI cancellation state/result was observed. The WDIO output showed WebDriver stale-element warnings/errors early in the PG→MySQL spec. The app log also recorded two `execute_driver_command` errors saying the referenced DB session was not found (07:21:27Z and 07:23:00Z). The available evidence does not establish whether the stale-element warnings or missing-session errors caused the chunk-confirmation timeouts.

The isolated app log recorded these slow target INSERT statements for the chunk table: PG→MySQL attempt one affected 2 rows in 8.132 s then 1 row in 8.096 s; PG→MySQL attempt two affected 2 rows in 8.043 s then 1 row in 8.136 s; MySQL→PG affected 2 rows in 8.004 s then 1 row in 8.004 s. These are only slow-statement records, not a snapshot of the final table count at each timeout; exact visible row counts at failure are therefore unverified. No final row-count assertion ran for the failed journeys.

## Fixture and process cleanup

The dedicated config's `before` and `after` replace the shared base worker DB hooks; the global setup/teardown in `e2e/run.mjs` is not invoked by direct WDIO. Each journey checks that its timestamped database names are absent before creating them, marks a database owned only after its own `CREATE DATABASE` succeeds, and drops only databases it owns.

The WDIO run reported no fixture-cleanup hook failure. After the run, read-only catalog queries returned no databases matching `dz_dt_ack_%` in either local PostgreSQL or MySQL; no manual database deletion was performed. The journey hooks also assert that their temporary connection IDs are gone.

After the single WDIO command completed, the root coordinator requested a graceful app stop. Ctrl-C terminated the tester app (PID 49519); a follow-up listener check found no process on port 4445. Its unique data directory `/private/tmp/datazen-transfer-r2-data.Srzm44` was preserved. No second WDIO instance was started. Disk free space was approximately 4.0 GiB.

## Coverage limitation

Changed executable production-line coverage was not measured. The Rust tests ran without coverage instrumentation; an additional instrumented Cargo build was not attempted with approximately 4 GiB free after the webdriver build. The pass counts above are test results, not a line-coverage estimate.

## Release assessment

The candidate does not pass the release gate: all required local unit/type/format checks passed, and the webdriver app compiled, but three direct database-backed resume journeys failed to observe the first two-row target chunk. The specific timeout cause remains unresolved and should be diagnosed in the candidate implementation or journey before release.
