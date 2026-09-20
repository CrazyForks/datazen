# Data Sync task persistence defects

## Closed in this track

- Legacy task files persisted process-local database session ids. After restart, conflict checking could pass that stale id to `get_session`, causing a lookup failure or an unsafe assumption about the endpoint. The store now drops those ids and the command resolves from stable connection ids.
- Legacy offset/continue fields looked resumable even though no durable source snapshot, target checkpoint, or idempotent write contract was stored. They now become explicit interrupted/unknown state and require a fresh run.

## Remaining limitations

- There is no durable row-level checkpoint/resume engine in this track. A user must compare and run again from the beginning after interruption.
- The persisted task format stores optional catalog/schema identity but does not create a dedicated profile/run-history model. That remains a later parity wave.
- Conflict checking resolves and validates both endpoints, but it only counts source rows for the incomplete tables, preserving the existing IPC result shape.

## Independent verification — 2026-09-20

- Store focused tests passed: 64 passed, 2 ignored; Sync command focused tests passed: 22 passed; Host Rust full suite passed: 1461 passed, 3 ignored; `pnpm exec tsc --noEmit` passed.
- The formal WebDriver build completed its frontend phase and reached Rust compilation, then failed because the worktree's ignored build cache exhausted the shared disk (`No space left on device`). This is an environment limitation; generated files were restored and no production files were changed by the failed build.

## Open issue — database override is not rehydrated

`check_sync_conflicts_impl` calls `resolve_session_for_connection(connection_id)` without the persisted `sourceDatabase` / `targetDatabase` override, then rejects the task when the fresh session's configured database differs (`src-tauri/src/commands/sync/tasks.rs:31-65`). A task that selected another catalog therefore cannot be checked after restart, even though `ConnectionManager::connect_dedicated` supports the required database override (`src-tauri/src/services/connection_manager.rs:120-141`). PostgreSQL also needs the override at connection time because a three-part database/schema/table qualifier is not a cross-database query. This remains a production defect for persisted tasks whose selected database differs from the saved connection default; it was recorded only and not modified in the independent test pass.
