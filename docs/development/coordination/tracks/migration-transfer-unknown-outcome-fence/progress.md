# migration-transfer-unknown-outcome-fence

Phase: PLANNED

- Task: stop Data Transfer after an unknown per-table transaction outcome, regardless of the continue-on-error preference
- Branch: `feature/migration-transfer-unknown-outcome-fence`
- Worktree: `.worktrees/datazen-migration-transfer-unknown-outcome-fence`
- Baseline: current `codex/migration-navicat`

## Confirmed defect

In database Data and Structure+Data execution, a statement failure followed by a rollback error or a commit error marks a table error string as `outcome UNKNOWN`. The executor then continues to later tables whenever `stop_on_error=false`. Checkpoint/token logic notices the unknown result only after the table loop; that is too late to prevent later writes in the same run. Table rows are also set to `0`, which presents an unknown amount as a confirmed zero, and run history does not distinguish confirmed rollback from an unknown outcome.

## Scope

Make transaction results machine-readable and fail closed at the table boundary. Keep the user preference to continue after a confirmed, successful rollback. An unknown commit or rollback outcome must stop all later writes unconditionally, carry an explicit unknown result with an unknown row count, and never issue or preserve a resume token for that run. The plan remains consumed. Surface the distinction in Data Transfer results and its migration-history summary without changing Sync or Schema Diff history semantics.

This track covers database Data and Structure+Data transactions. SQL-file output has no target database transaction and remains outside this change. Review the structure phase for any target DDL response-loss ambiguity; if it has a separate unsafe continue path, record it and either include the smallest compatible guard or create a follow-up blocker rather than silently claiming that path safe.

## Acceptance criteria

- [ ] Per-table outcomes explicitly distinguish at least `committed`, `rolled_back`, `not_started`, and `unknown`; an unknown row count is represented as unknown rather than `0`.
- [ ] After commit or rollback becomes unknown, the executor stops before touching the next table even when `stop_on_error=false`.
- [ ] A statement failure with a confirmed successful rollback can continue when `stop_on_error=false` and stops when it is `true`.
- [ ] Unknown outcomes cannot create or preserve a resume checkpoint; a prior checkpoint is invalidated and the old plan cannot be replayed.
- [ ] Transfer UI and run history render confirmed rollback, unknown outcome, and not-started/preflight failure distinctly. Shared history behavior for Data Sync and Schema Diff is unchanged.
- [ ] Tests simulate commit applied-but-response-lost, commit not applied-but-response-lost, rollback failure, confirmed rollback continuation, preflight failure, and checkpoint invalidation; assert later table calls and row counts precisely.
- [ ] PostgreSQL→MySQL and MySQL→PostgreSQL WDIO failure journeys use unique fixtures and prove confirmed rollback/continue behavior with `stop_on_error=false`; commit acknowledgement loss is tested with a controllable mock/fault injector, never inferred from normal DB errors.
- [ ] Changed-core coverage ≥80%; focused Host/UI/driver checks, formatting, and `git diff --check` pass.

## Boundaries

- Do not add chunk-level large-table recovery here. Existing table-level checkpoints and the gap in bounded source reads are tracked separately.
- Do not retry an unknown table, infer which rows were committed, or reuse its old plan.
- Do not alter SQL-file atomic publication, Data Sync reconciliation, or Schema Diff DDL compensation.
- Keep continue-on-error for later tables only when the previous table's transaction outcome is known.

## Tester

Pending fresh independent Tester after Coder handoff. Run the required WDIO journeys serially, then verify cleanup and release port 4445.

