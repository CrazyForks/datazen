# migration-sync-stream-execution

Phase: READY_FOR_TEST

## Scope

Remove the second full materialization of a large Data Sync plan during execution. The existing review store is paged and disk-backed, but plan execution currently accumulates a full `Vec<SqlStatement>` and uses a 64 MiB full-load ceiling.

Keep one target transaction for the whole selected plan. Generate and execute a bounded page at a time without calling `ComparisonStore::load()` or retaining all generated statements. Preserve plan and selection revision checks, conflict policy, snapshot validation, statement ordering, cancellation, and known/unknown rollback outcomes. The current full SQL-preview IPC remains bounded and must continue to explain its limit clearly.

## Acceptance criteria

- [x] The production execute path consumes selected comparison pages incrementally and keeps only the current comparison page and generated statement batch in memory.
- [x] Production execution does not construct a complete `ComparisonResult` or complete `Vec<SqlStatement>`; a >64 MiB synthetic plan executes through the paged path without calling the full-load API.
- [x] One target transaction spans the run; later-page generation/execute failure and cancellation roll back prior writes, and rollback failure reports an unknown outcome.
- [x] SQL preview follows the immutable plan and selected rows in order and rejects responses over 16 MiB with a clear validation message. Preview remains a bounded full IPC response.
- [x] Unit tests cover >64 MiB execution, cross-page statement order, cancellation and source failure after writes, unknown rollback outcome, streamed Skip conflicts, and zero full-load calls.
- [x] Existing PostgreSQL and MySQL WDIO journeys verify real writes and readback; the new PostgreSQL late-page optimistic-conflict journey verifies rollback and readback. The isolated track WDIO rerun is coordinated after the active Data Transfer lane finishes.

## E2E registration

- [x] Data Sync large-plan streaming execution: added `SYNC-REAL-026` using 5,000 changed rows × 14 KiB and `batchSize: 500` (ten execution pages, approximately 68 MiB total); asserts the 16 MiB preview limit, applied count, target count, and sampled value lengths. Its first WDIO attempt overlapped the Data Transfer app/WebDriver lane and is awaiting the coordinator-scheduled isolated rerun.
- [x] Mid-run cancellation/late-page failure rollback: unit coverage includes cancellation and later-page source failure after writes; `SYNC-REAL-027` mutates row 500 after compare so the conflict occurs on the second 500-row execution page, then verifies the first page was rolled back by reading back the sole concurrently modified row. It passed in the initial WDIO attempt; isolated rerun is coordinated with the large-plan test.

## Self-validation

- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib`: 1,801 passed, 0 failed, 3 ignored. Run with authorized local loopback access because the sandbox blocks WireMock/tunnel loopback binds.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib sync::`: 193 passed, 0 failed.
- `npx vitest run src/commands/__tests__/syncPlan.test.ts`: 1 file and 7 tests passed.
- `npx tsc --noEmit`: passed.
- `git diff --check`: passed.
- WDIO command for `SYNC-REAL-026|SYNC-REAL-027`: one passing test and one inconclusive preview-limit failure while another lane owned the shared app/WebDriver service (`Address already in use`). The running process exited; the coordinator will schedule a focused isolated rerun. No product conclusion is drawn from the preview assertion in that overlapped run.
- Coder implementation commit: pending final commit.

## Independent Tester

- Pending fresh Tester; review every changed file, assess changed-core coverage (target at least 80%), rerun all checks and WDIO cases, and register all bugs before reporting.
