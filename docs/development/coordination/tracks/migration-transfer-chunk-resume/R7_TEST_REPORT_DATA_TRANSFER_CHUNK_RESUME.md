# R7 Independent Tester Report — Data Transfer Chunk Resume

- Candidate: `c3ef7f467038994461f9e24b3ae04303f8865e71`
- Tester branch: `codex/migration-transfer-chunk-resume-fresh-tester-r7`
- Tester worktree: `/Users/flyxl/.codex/worktrees/datazen-migration-transfer-chunk-resume-fresh-tester-r7/datazen`
- Result: **TEST_DONE**
- Tester commits: `500d3b74b0df0d782ffe6fd0776f8e59976a852d` (frontend test correction), `5016f58dc7ac7dcdd7b378e836a6c85cce59a1f7` (Rust tests, report, progress, and BUG retest records).

## Review

The review covered the candidate’s Data Transfer resume path and related driver/UI/E2E changes: eligibility and cursor type gates, keyset SQL and fingerprints, empty-page handling, source and target transaction preflight, target chunk transaction boundaries, checkpoint persistence and claim locking, expiration cleanup, cancellation, acknowledgement loss, rollback uncertainty, replay rejection, and visible resume/cancel state. The R6 rollback-failure regression was independently re-run. No new confirmed product defect was found.

One changed production line, the MySQL information-schema query-error mapping at `packages/drivers/mysql/src/mysql.rs:1116`, was not executed by the unit-only MySQL run; exercising that error requires a live query failure. This uncovered path is included in the measured denominator and does not make the aggregate coverage gate fail.

## Independent checks

| Check | Result |
| --- | --- |
| Locale generation | Passed |
| `pnpm typecheck` | Passed |
| Data Transfer Host Rust suite (`cargo test -p datazen --lib data_transfer -- --test-threads=1`) | 161 passed, 0 failed |
| Focused Host `test_tester` suite | 226 passed, 0 failed |
| PostgreSQL driver `--lib` suite | 133 passed, 0 failed |
| MySQL driver `--lib` suite | 124 passed, 0 failed; reused existing binary, no relink |
| DataTransferWindow Vitest | 37 passed, 0 failed |
| Rust formatting, Prettier, `git diff --check` | Passed |
| Isolated WDIO config | 5 journeys passed, 0 failed |

The full Vitest file initially exposed an unsupported-pair assertion tied to Redis metadata that is absent from the generated basic-driver unit test build. The Tester changed only the test fixture to use the explicitly unsupported `kiwi` fallback category, then asserted the stable pair-note test id, disabled target option accessibility attributes (`aria-disabled` and `title`), and disabled Next control. This preserves the supported behavior assertion and does not change product code.

## Coverage

**Rust production changed executable lines: 2,207 / 2,751 = 80.23%.** This was measured, not estimated. The calculation intersects added Rust line numbers from `git diff --no-color --unified=0 codex/migration-navicat...HEAD` with LCOV `DA` line records from `/private/tmp/datazen-transfer-r7-host-pg-mysql-lib-final-20260925.lcov`; an added executable line is covered when the LCOV hit count is greater than zero.

The raw added-Rust executable-line intersection was 3,372/3,930 (85.80%). Production-only filtering excluded pure test and mock files (`plans/tests.rs`: 528 executable additions; `resume_preflight_tests.rs`: 408; `commands/data_transfer/tests.rs`: 32; `data_transfer/resume/tests.rs`: 190; MySQL `tests.rs`: 6; `testing/mock_driver.rs`: 1) and inline `#[cfg(test)]` additions at:

- `packages/drivers/mysql/src/migration.rs`: 833, 839, 859
- - `packages/drivers/postgres/src/schema.rs`: 627–635
- `src-tauri/src/schema_diff/compare.rs`: 416, 423

Profiles came from the valid Host, PostgreSQL, and MySQL `--lib` runs. The failed MySQL integration-link profiles were excluded. All `.profraw` files were retained.

The DataTransferWindow-specific v8 report, run against `src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx` with `src/windows/data-transfer/DataTransferWindow.tsx` explicitly included, measured statements 86.62% (434/501), branches **77.97% (354/454)**, functions 90.20% (129/143), and lines 88.54% (402/454). The branch gate is 75%.

## Added Tester coverage

The new Rust tests cover ambiguous and exact-numeric cursor eligibility, fail-closed keyset bounds, value tags in fingerprint hashing, checkpoint-advance failure after confirmed commit, lost chunk-commit acknowledgement, source fingerprint failure plus unknown snapshot rollback, checkpoint expiry/corruption/ownership/progress/session lifecycle, and concurrent checkpoint claims.

`test_tester_concurrent_checkpoint_claim_allows_exactly_one_and_prevents_replay` uses a barrier to release two claim requests at the same time. It asserts one success and one rejection, then verifies that the token cannot be replayed.

The R6 regression `chunk_write_and_rollback_failure_fences_later_table_and_consumes_checkpoint` passed. It asserts Unknown outcome and null row count after unknown rollback, no checkpoint token, no later-table write, no confirmed target commit, and rejection of plan and token replay. `unknown_source_snapshot_close_preserves_committed_chunk_and_stops_later_tables` also passed, preserving the committed state while fencing subsequent tables and token replay.

## WDIO

The direct WDIO run used `e2e/wdio.migration-transfer-ack-loss.conf.ts`, port 4445, a unique `DATAZEN_DATA_DIR`, and the R4 application bundle after verifying that its runtime inputs had not changed since build. All five journeys passed:

1. PostgreSQL → MySQL bounded chunk cancel/resume
2. MySQL → PostgreSQL bounded chunk cancel/resume
3. PostgreSQL → MySQL source mutation refusal while paused
4. PostgreSQL → MySQL commit acknowledgement loss
5. MySQL → PostgreSQL commit acknowledgement loss

The journeys retained strict row-count and ordered-row assertions. They verified source-mutation refusal before additional writes, unknown outcomes, later-table fencing, absent/rejected replay tokens, and fixture cleanup. The app process was stopped, port 4445 was free, and no run-prefixed fixture databases remained. No black-box tester was used.

## Existing BUG retests

- **BUG-001:** exact MySQL numeric cursor types fail closed; `mysql_bigint_key_keeps_atomic_table_boundary_resume` passed and verifies transactional whole-table fallback. The live adjacent-value comparison above 2^53 was **not** exercised and is not claimed.
- **BUG-002:** `unknown_target_transaction_metadata_allows_transfer_without_token` passed; `changed_target_transaction_contract_invalidates_before_legacy_write` passed, asserting zero replacement commits and token replay rejection.
- **BUG-003:** both direction-specific cancel/resume journeys and PostgreSQL → MySQL source-mutation refusal passed.
- **BUG-004 / BUG-005:** acknowledgement-loss journeys passed in both directions, including unknown row-count state, later-table fencing, target readback, absent token, and replay rejection.
- No new confirmed defects were found in R7.

## Cleanup and disposition

Only the R7 unique app-data directory and run-owned fixtures were cleaned. The app was stopped and port 4445 was released. The measured filesystem free space was 418 MiB, above the required 300 MiB floor. Read-only process checks found no Cargo, rustc, linker, or clang process active. No profiles, application bundles, or other reports were deleted or overwritten.

**Disposition: TEST_DONE.**
