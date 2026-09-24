# migration-transfer-unknown-outcome-fence

Phase: CODING

- Task: stop Data Transfer after an unknown per-table transaction outcome, regardless of the continue-on-error preference
- Branch: `feature/migration-transfer-unknown-outcome-fence`
- Worktree: `.worktrees/datazen-migration-transfer-unknown-outcome-fence`
- Baseline: current `codex/migration-navicat`

## Confirmed defect

In database Data and Structure+Data execution, a statement failure followed by a rollback error or a commit error marks a table error string as `outcome UNKNOWN`. The executor then continues to later tables whenever `stop_on_error=false`. Checkpoint/token logic notices the unknown result only after the table loop; that is too late to prevent later writes in the same run. Table rows are also set to `0`, which presents an unknown amount as a confirmed zero, and run history does not distinguish confirmed rollback from an unknown outcome.

## Scope

Make transaction results machine-readable and fail closed at the table boundary. Keep the user preference to continue after a confirmed, successful rollback. An unknown commit or rollback outcome must stop all later writes unconditionally, carry an explicit unknown result with an unknown row count, and never issue or preserve a resume token for that run. The plan remains consumed. Surface the distinction in Data Transfer results and its migration-history summary without changing Sync or Schema Diff history semantics.

Confirmed standalone target DDL is tracked separately from the row transaction: if TRUNCATE or DROP+CREATE succeeds but later inspection, transaction start, or row work fails, report `partiallyApplied` with a known row count of zero (or preserve the unknown state if rollback itself is uncertain). In Structure+Data, a confirmed CREATE has the same partial outcome when the later data phase does not commit.

This track covers database Data and Structure+Data transactions. SQL-file output has no target database transaction and remains outside this change. Review the structure phase for any target DDL response-loss ambiguity; if it has a separate unsafe continue path, record it and either include the smallest compatible guard or create a follow-up blocker rather than silently claiming that path safe.

## Acceptance criteria

- [x] Per-table outcomes explicitly distinguish at least `committed`, `rolled_back`, `not_started`, and `unknown`; an unknown row count is represented as unknown rather than `0`.
- [x] After commit or rollback becomes unknown, the executor stops before touching the next table even when `stop_on_error=false`.
- [x] A statement failure with a confirmed successful rollback can continue when `stop_on_error=false` and stops when it is `true`.
- [x] Unknown outcomes cannot create or preserve a resume checkpoint; a prior checkpoint is invalidated and the old plan cannot be replayed.
- [x] Transfer table UI and Transfer history payload encode confirmed rollback, unknown, not-started, and confirmed destructive-preamble partial application distinctly. Shared history behavior for Data Sync and Schema Diff is unchanged. Shared history label/dialog test is pending with the Sync owner.
- [ ] Focused Rust tests simulate commit applied-but-response-lost, commit not applied-but-response-lost, rollback failure, confirmed rollback continuation, preflight failure, confirmed truncate/drop-create preambles followed by reinspection/begin failures, and checkpoint invalidation; assert later table calls and row counts precisely. Re-run after shared Cargo target is released.
- [ ] An order-sensitive self-overwrite test places a valid table before a conflicting selected table and proves validation rejects the run before any write/DDL, with history remaining `notStarted` rather than `unknown`.
- [ ] Destructive preamble modes cannot mint or accept a resumable checkpoint that could replay a known partial application.
- [ ] PostgreSQL→MySQL and MySQL→PostgreSQL WDIO failure journeys use unique fixtures and prove confirmed rollback/continue behavior with `stop_on_error=false`; commit acknowledgement loss is tested with a controllable mock/fault injector, never inferred from normal DB errors.
- [ ] Changed-core coverage ≥80% after the confirmed-preamble follow-up; rerun after shared Cargo target is released. Focused Host/UI checks, formatting, and `git diff --check` pass.

## Boundaries

- Do not add chunk-level large-table recovery here. Existing table-level checkpoints and the gap in bounded source reads are tracked separately.
- Do not retry an unknown table, infer which rows were committed, or reuse its old plan.
- Do not alter SQL-file atomic publication, Data Sync reconciliation, or Schema Diff DDL compensation.
- Keep continue-on-error for later tables only when the previous table's transaction outcome is known.

## Remaining gaps outside this track

- Large-table recovery remains separate work: the current transfer reads/spools at table scope, has no bounded row-chunk checkpoint or mid-table resume, and does not promise bounded memory for materializing fallback drivers. This track adds no offset or chunk cursor.
- Cancellation still does not guarantee interruption of a driver's active source query. That behavior and bounded chunk recovery need their own design, tests, and acceptance.
- Confirmed destructive DDL is reported as `partiallyApplied`; this track does not compensate or automatically reconcile it. DDL acknowledgement loss stays `unknown` and stops the run.

## Tester

This checkpoint is not a Coder handoff: the track remains `CODING`, and it is not ready for Tester. Cargo tests and updated changed-core coverage have not been rerun after the confirmed-preamble/self-overwrite additions because the shared target is occupied by Sync Tester. Do not start this track's Cargo, app, or WDIO work until the parent releases those resources. After Coder validation and handoff, run the required WDIO journeys serially with a dedicated `DATAZEN_DATA_DIR`, then verify cleanup and release port 4445. Shared history rendering for `partiallyApplied` also needs the Sync owner’s locale/dialog/test integration before merge.

## Coder self-validation

- Previous Rust/coverage run before the confirmed-preamble follow-up: 123 passed; changed executable coverage 1036/1093 (94.8%); strict changed production-core coverage 309/350 (88.3%). These figures are provisional until the updated Transfer suite runs with the shared target.
- Previous strict per-file ratios: `commands/data_transfer/exec.rs` 28/37 (75.7%); `commands/data_transfer/mod.rs` 24/36 (66.7%); `data_transfer/execute.rs` 149/160 (93.1%); `data_transfer/model.rs` 16/16 (100%); `data_transfer/structure.rs` 92/100 (92.0%); `workflow/migration.rs` 0/1. The remaining uncovered lines were mostly IPC wrapper/history workflow glue not entered by those library unit tests.
- Host UI test after adding destructive-preamble coverage: `DataTransferWindow.test.tsx` 34 passed, 0 failed; TypeScript check passed.
- Rust formatting, Prettier, and `git diff --check` passed.
- No WDIO, black-box, or live database tests were run by the Coder. Before WDIO, use a dedicated `DATAZEN_DATA_DIR`: `e2e/wdio.conf.ts` creates and drops its own uniquely named PostgreSQL worker database and cleans the app-data passed to the app; it does not honor `E2E_SKIP_WORKER_DATABASE`. Do not use `e2e/run.mjs` or setup scripts that mutate shared fixtures. Run the two new direction-specific specs serially after the Schema lane releases the harness, inspect fixture cleanup, and release port 4445.
- Transfer history now sends `partiallyApplied`; the Sync owner must add its shared run-history display label and regression assertion. This worktree intentionally does not edit the shared dialog, locale, or shared history test.
- Self-overwrite validation is run against the full eligible selection before Structure+Data DDL or any table write, so a later conflicting table cannot turn earlier valid tables into a partially executed run. The data executor keeps the same guard for direct callers.
- SQL-file per-table results retain `outcome: None`; Transfer run-history mapping has an explicit compatibility path that preserves the pre-existing SQL-file partial outcome while this track changes only database-target outcomes.
- Checkpoint status: this commit preserves ongoing work only. The UI/type/format/diff checks are current; Rust test results and strict coverage ratios above predate the latest core changes and must not be treated as final or as Tester-ready evidence.
