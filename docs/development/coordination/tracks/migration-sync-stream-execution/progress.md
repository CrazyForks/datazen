# migration-sync-stream-execution

Phase: PASSED

## Scope

Remove the second full materialization of a large Data Sync plan during execution. The existing review store is paged and disk-backed, but plan execution currently accumulates a full `Vec<SqlStatement>` and uses a 64 MiB full-load ceiling.

Keep one target transaction for the whole selected plan. Generate and execute a bounded page at a time without calling `ComparisonStore::load()` or retaining all generated statements. Preserve plan and selection revision checks, conflict policy, snapshot validation, statement ordering, cancellation, and known/unknown rollback outcomes. The current full SQL-preview IPC remains bounded and must continue to explain its limit clearly.

## Acceptance criteria

- [x] The production execute path consumes selected comparison pages incrementally and keeps only the current comparison page and generated statement batch in memory.
- [x] Production execution does not construct a complete `ComparisonResult` or complete `Vec<SqlStatement>`; a >64 MiB synthetic plan executes through the paged path without calling the full-load API.
- [x] One target transaction spans the run; later-page generation/execute failure and cancellation roll back prior writes, and rollback failure reports an unknown outcome.
- [x] SQL preview follows the immutable plan and selected rows in order and rejects responses over 16 MiB with a clear validation message. Preview remains a bounded full IPC response.
- [x] Unit tests cover >64 MiB execution, cross-page statement order, cancellation and source failure after writes, unknown rollback outcome, streamed Skip conflicts, and zero full-load calls.
- [x] Existing PostgreSQL and MySQL WDIO journeys verify real writes and readback; the new PostgreSQL late-page optimistic-conflict journey verifies rollback and readback. Fresh independent WDIO verification passed both new journeys in an isolated run.

## E2E registration

- [x] Data Sync large-plan streaming execution: `SYNC-REAL-026` uses 5,000 changed rows × 14 KiB and `batchSize: 500` (ten execution pages, approximately 68 MiB total); the isolated WDIO run passed the 16 MiB preview refusal, applied count, target count, and sampled value-length assertions.
- [x] Late-page optimistic conflict rollback: `SYNC-REAL-027` changes row 500 after comparison so the conflict occurs on the second 500-row execution page; the isolated WDIO run passed and readback confirmed the first page was rolled back while preserving the concurrent value.

## Coder self-validation (historical)

Implementation commit: `cff9665b` (`feat(sync): stream comparison pages during execution`). At handoff, the coder reported 1,801 Host Rust tests passing (3 ignored), 193 focused Sync tests passing, the focused Vitest suite (7 tests), TypeScript typecheck, and diff validation passing.

The coder's first combined WDIO attempt overlapped the shared Data Transfer app/WebDriver lane: `SYNC-REAL-027` passed, while the large-plan preview assertion was inconclusive after an `Address already in use` service collision. That overlapped result is historical only and is superseded by the independent, isolated WDIO rerun below.

## Independent Tester verification

### A. Review and correctness

- Independently reviewed every changed implementation file from `920c515d` through `cff9665b`, plus the focused tests and E2E journey. No functional correctness defects were found.
- Added Tester-only Rust tests for later-page execution failure rollback; empty, read-only, cancelled, and begin-failed preflight; empty generated pages; preview byte accounting and ordering; immutable-plan preview/execution; and preserving an empty plan after its no-op rejection.

### B. Test and build checks

- Final LLVM-instrumented `cargo test -p datazen --lib`: 1,811 passed, 0 failed, 3 ignored.
- Focused frontend test `npx vitest run src/commands/__tests__/syncPlan.test.ts`: 1 file, 7 tests passed; `npx tsc --noEmit` passed.
- `rustfmt --check` on both changed Rust files and `git diff --check` passed.

### C. Changed-core coverage

- Final full Host run LLVM line coverage: `commands/sync/exec.rs` 93.80%; `data_sync/execute.rs` 92.30%.
- Changed paging/preview functions measured 88.89–100%; plan SQL preview 84.21%; plan execution 81.82%. Changed-core coverage is above the 80% target.

### D. Isolated WDIO and cleanup

- `CI=true pnpm e2e -- --suite data-sync --mochaOpts.grep 'SYNC-REAL-026|SYNC-REAL-027'`: 2/2 tests passed in the changed spec; 3 unrelated specs were skipped by the focused grep. `SYNC-REAL-026` verified the 5,000 × 14 KiB, ten-page (~68 MiB) PostgreSQL journey, the 16 MiB preview refusal, applied count, target count, and sampled value lengths. `SYNC-REAL-027` verified late-page conflict rollback and readback preserving the concurrent value.
- The isolated rerun resolved the earlier `Address already in use` collision: the prior run had overlapped another WDIO owner on the shared app/WebDriver service, making its preview result inconclusive. The rerun was serialized after the Data Transfer lane released the service; the app and WDIO process exited cleanly. Both local PostgreSQL and MySQL fixture checks succeeded.
- Tester worktree uses its own `node_modules` directory (not a symlink). Generated Cargo injection changes were restored; `Cargo.lock` is clean.
- Non-blocking P3 hygiene note: the production build warns that `execute_statements` is an unused import in `commands/sync/exec.rs`; its remaining use is in a `#[cfg(test)]` helper, so the import can be gated with `#[cfg(test)]`. No functional impact; no correctness bug filed.

Tester result: `TEST_DONE`; no correctness bugs registered.
