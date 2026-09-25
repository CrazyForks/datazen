# migration-transfer-chunk-resume-BUG-005 · MySQL→PG acknowledgement-loss assertion mismatch

- **Severity:** P1 — the R4 journey stopped before verifying later-table fencing and token consumption.
- **Status:** 已复测通过
- **File:** `packages/drivers/mysql/e2e/data-transfer-commit-ack-loss-mysql-pg.ts`
- **Candidate tested by R4:** `ee7a0e844021cf6c4309eee5dae6199ae05f93c7`

## Finding

R4 reached the `unknown` table outcome assertion, then failed because the spec expected the obsolete phrase `target commit succeeded`. The bounded-chunk test seam returned `debug test seam: target chunk committed but its acknowledgement was dropped`. This was an E2E message-contract mismatch; R4 did not establish a production fencing defect.

The spec now matches the chunk-specific seam message. It retains the assertions for `outcome === unknown`, `rowsInserted === null`, the later table being `notStarted` with zero rows, absent resume token, committed-row target readback, and rejection of both plan and checkpoint replay.

## Verification

Using the existing candidate WebDriver app, the isolated MySQL→PG acknowledgement-loss journey passed locally: 1 passing (14.5s). Fixture cleanup completed; read-only MySQL and PostgreSQL catalog checks found no remaining `dz_dt_ack_%` databases. A fresh Tester R5 must independently rerun the journey.


## 复测记录（round-7）

Independent Tester R7 passed the isolated MySQL → PostgreSQL acknowledgement-loss journey. The unknown outcome, missing row count/token, later-table fence, committed target readback, and rejection of plan/checkpoint replay all passed. See `R7_TEST_REPORT_DATA_TRANSFER_CHUNK_RESUME.md`.
