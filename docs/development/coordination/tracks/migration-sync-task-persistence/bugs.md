# Data Sync task persistence defects

## Closed in this track

- Legacy task files persisted process-local database session ids. After restart, conflict checking could pass that stale id to `get_session`, causing a lookup failure or an unsafe assumption about the endpoint. The store now drops those ids and the command resolves from stable connection ids.
- Legacy offset/continue fields looked resumable even though no durable source snapshot, target checkpoint, or idempotent write contract was stored. They now become explicit interrupted/unknown state and require a fresh run.
- Conflict checking reused the connection's default runtime session even when a persisted task selected another database. The endpoint now opens a dedicated session with the persisted database override.

## Remaining limitations

- There is no durable row-level checkpoint/resume engine in this track. A user must compare and run again from the beginning after interruption.
- The persisted task format stores optional catalog/schema identity but does not create a dedicated profile/run-history model. That remains a later parity wave.
- Conflict checking resolves and validates both endpoints, but it only counts source rows for the incomplete tables, preserving the existing IPC result shape.

## Independent verification — 2026-09-20

- Store focused tests passed: 64 passed, 2 ignored; Sync command focused tests passed: 22 passed; Host Rust full suite passed: 1461 passed, 3 ignored; `pnpm exec tsc --noEmit` passed.
- The formal WebDriver build completed its frontend phase and reached Rust compilation, then failed because the worktree's ignored build cache exhausted the shared disk (`No space left on device`). This is an environment limitation; generated files were restored and no production files were changed by the failed build.

## Closed after fix — database override rehydration (2026-09-20)

`3be34051` now establishes a dedicated session with the persisted database override before counting rows. The independent test `check_sync_conflicts_reconnects_selected_database_with_override` passes with a task selecting `analytics` while the saved source connection defaults to `app`; the live session is confirmed on `analytics`.

## Open issue — dedicated recovery sessions are not released

The override path calls `connect_dedicated` for source and target inside `check_sync_conflicts_impl`, but the returned runtime session ids are not released on success or any later error path. Each conflict check can therefore retain two sessions and their reference counts until application shutdown or idle cleanup. This was found by source review during the independent retest and is recorded only; no production code was changed in this tester pass.
