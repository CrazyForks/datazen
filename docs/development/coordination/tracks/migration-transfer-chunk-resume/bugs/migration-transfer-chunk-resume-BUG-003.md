# BUG-003 — R2 chunk-resume journeys time out before cancellation

- Status: `待复测`
- Severity: P1 — all three bounded chunk-resume WDIO journeys failed before exercising cancellation or resume.
- Candidate: `e774e3554a07e889383be02d757395f315e7fdf6`.
- Independent test report: `R2_TEST_REPORT_DATA_TRANSFER_CHUNK_RESUME.md`, commit `7d1377c967287fd8582c698d3b9df189343f4f99`.

## Reproduction

Build the candidate WebDriver app using `pnpm tauri:build:webdriver`, launch the generated app with a unique `DATAZEN_DATA_DIR` on WebDriver port 4445, then run the isolated journey directly:

```sh
E2E_WD_PORT=4445 E2E_SKIP_WORKER_DATABASE=1 pnpm exec wdio run e2e/wdio.migration-transfer-ack-loss.conf.ts
```

On this R2 run the command completed with exit 1: **2 passing, 3 failing** across PG→MySQL and MySQL→PG.

## Observed failures

All three failures occurred at the initial target visibility gate. The test polls `SELECT COUNT(*) AS c FROM <chunkTable>` on a dedicated target observer every 150 ms for up to 30 seconds and requires the result to be exactly 2:

1. PG→MySQL bounded-chunk cancellation/resume failed at `packages/drivers/postgres/e2e/data-transfer-commit-ack-loss-pg-mysql.ts:518`: `first two-row target chunk was not confirmed`.
2. PG→MySQL source-mutation rejection failed at line 653 with the same timeout before reaching cancellation or source mutation.
3. MySQL→PG bounded-chunk cancellation/resume failed at `packages/drivers/mysql/e2e/data-transfer-commit-ack-loss-mysql-pg.ts:522` with the same timeout.

Because each journey failed before clicking the UI Cancel control, none reached the cancellation result/token assertions, the resume action, or the post-mutation refusal assertion. No UI cancellation state/result was observed. Two separate acknowledgement-loss journeys passed, one in each direction.

## Logs and evidence boundary

- No plan or preview error was reported by WDIO or found in the isolated app log.
- WDIO emitted stale-element warnings/errors early in the PG→MySQL spec.
- The app log recorded two `execute_driver_command` errors saying a referenced DB session was not found (07:21:27Z and 07:23:00Z). The logs do not identify those session IDs as the target observer, so that relationship is unconfirmed.
- Slow INSERT logs for the chunk table showed 2 rows then 1 row affected in each PG→MySQL attempt and in the MySQL→PG attempt, with each slow statement taking about 8.0–8.14 seconds. They are not a final-count snapshot at the timeout; exact target row counts when each wait expired remain unverified.
- The direct WDIO run reported no fixture-cleanup hook failure. Read-only PostgreSQL and MySQL catalog queries after the run returned no databases matching this run's `dz_dt_ack_%` fixture prefix. PID 49519 was stopped, port 4445 had no listener, and the unique app data directory was preserved. Disk free space was about 4.0 GiB.

This report records an observed journey failure only. It does **not** establish a product-code root cause; the mismatch between the expected first-page observation and the logs requires investigation before attributing the failure to the resume implementation or changing the journey's assertion.

## 修复记录（round-1）

Commit `c08a907e` updates both direction-specific WDIO journeys with dedicated observer diagnostics: verify the observer connection with `ping_connection`, record the zero-row baseline before execution, preserve the latest count response or polling error, and include a final ping/count sample in timeout errors. The exact row-count assertions remain strict. These changes improve evidence collection but do not establish a fix or root cause; the cause remains unknown until a fresh R3 run exercises the journeys and inspects the new samples.
