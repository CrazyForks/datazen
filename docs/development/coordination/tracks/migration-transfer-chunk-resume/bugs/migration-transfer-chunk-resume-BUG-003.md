# BUG-003 — R2 chunk-resume journeys time out before cancellation

- Status: `已复测通过`
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

## 复测记录（round-2）

Independent Tester R3 used candidate product commit `c08a907ef9c3ed64f2c524518a070f3d8c45456e` and directly ran the isolated WDIO configuration. Result: 2 passed, 3 failed. Both acknowledgement-loss journeys passed. All three chunk journeys still timed out at the initial strict target-count-two gate, before cancellation/resume or source-mutation assertions.

R3's latest/final timeout samples were successful observer queries with `ping=true,count=5`:

- PG→MySQL cancellation/resume: `dz_dt_ack_pgm_tgt_mugpnglq.dt_chunk_resume_mugpnglq` returned count 5.
- MySQL→PG cancellation/resume: `public.dt_chunk_resume_mugpphzp` returned count 5.
- PG→MySQL source-mutation refusal: `ping=true,count=5` at the same initial count-two wait.

The observer was reachable and returned the final count for the intended fixture relation. This does not explain why the intermediate count of two was not observed; R3 does not attribute the failure to the app, UI, or observer sampling. No count assertion was loosened. Cancellation, resume, exact final rows, source mutation, and zero-new-row refusal remain unverified. The R3 report is `R3_TEST_REPORT_DATA_TRANSFER_CHUNK_RESUME.md`. Read-only catalog queries found no databases with the R3 `dz_dt_ack_%` prefix, and the app process was stopped with port 4445 free. Status returns to `待修复` pending diagnosis and a passing independent rerun.

## 修复记录（round-2）

An instrumented local PG→MySQL WDIO attempt reproduced the failure before reaching cancellation. The app log identified the exact fallback reason: `source page projection changed while transfer was running`. The transfer had selected the bounded-resume candidate, then its initial full-source fingerprint failed before checkpoint progress and dispatch fell back to the legacy atomic table writer. This is consistent with the strict observer seeing no two-row prefix and later seeing all five rows.

Root cause: PostgreSQL and MySQL result decoders build `QueryResult.columns` from `rows.first()`. A valid empty keyset page therefore has both `rows=[]` and `columns=[]`. The fingerprint scan and copy loop share `validate_page`, which previously compared that empty metadata vector to the expected projection and treated the terminator as a schema/projection change.

The repair accepts absent column metadata only for an empty page; every non-empty page must still match the exact inspected projection, and row-count/row-width bounds remain enforced. The mismatch error now includes the expected and actual column vectors. A focused unit test covers an empty terminator (including the trailing empty page after an exact chunk-size multiple), rejects a non-empty projection in the wrong order, and rejects a page larger than its hard limit. The dispatcher keeps a debug-level reason when safe row-chunk initialization falls back. The PG→MySQL first-page journey again waits for exact `COUNT(*) = 2`; the count assertion was not weakened. This fix has not yet passed an independent post-fix WDIO run.

### Separate UI defect found by the post-fingerprint probe

After the empty-page repair made the first exact-count gate pass, the same journey exposed a second, independent bug: clicking Resume called `runExecute(resumeToken)` while the wizard remained on the `result` step, but the Cancel control was rendered only on the `preview` step. A resumed transfer therefore had no user-visible Cancel control. The UI now returns to the preview/execution step as soon as a resume begins, so the normal progress and Cancel controls are available until that invocation settles. A focused UI test holds a resumed execution open and proves the Cancel action remains available.

The rebuilt local PG→MySQL bounded-chunk WDIO journey then passed (1 passing, 46.5s): the strict target counts of 2 and 4 were observed, both cancellation/resume boundaries completed, and the final ordered rows assertion for ids 1–5 passed. Its fixture cleanup completed, read-only catalog checks found no remaining run-specific source/target databases, and the app was stopped with port 4445 clear.

## Independent retest R4

R4 independently passed the PG→MySQL and MySQL→PG multi-boundary cancellation/resume journeys and the PG→MySQL source-mutation refusal, including exact target row counts/readbacks and the final empty page. The new resumed-cancel UI path was exercised. See `R4_TEST_REPORT_DATA_TRANSFER_CHUNK_RESUME.md`; the remaining R4 failures were only stale acknowledgement-loss error-message expectations tracked separately in BUG-004/005. BUG-003 is therefore independently verified; overall feature release gates remain open.
