# Data Sync task persistence

## Scope

This track hardens the legacy `store::SyncTask` persistence format. It does not add a profile editor, run history, or a new resumable execution engine.

## Implemented

- Runtime `sourceDbSessionId` and `targetDbSessionId` are accepted when reading old JSON for compatibility, then cleared and omitted from all serialized tasks.
- Persisted task endpoints retain stable `sourceConnectionId` / `targetConnectionId` plus optional database and schema identity. Conflict checks resolve fresh live sessions from those connection ids, so a stale process-local session id is never sent to the strict session API.
- Missing active sessions are safely established through `ConnectionManager::resolve_session_for_connection`.
- Legacy `running`, `paused`, `continue`, or non-zero-offset checkpoints are migrated to `status: interrupted`, `strategy: unknown`, `resumeState: unknown`, offset `0`, and a user-readable restart message. The code has no path that silently resumes an old offset.
- The existing save, list, delete, and conflict-check IPC names remain unchanged. The TypeScript task model makes runtime ids optional and exposes the explicit resume state.

## Verification

- `cargo check -p datazen --lib`
- `cargo test -p datazen --lib store::tests`: 64 passed, 2 ignored (the filter also includes existing ComparisonStore tests)
- `cargo test -p datazen --lib commands::sync::tests`: 22 passed
- `pnpm exec tsc --noEmit`
- Independent final verification: `cargo test -p datazen --lib` passed 1461 tests with 3 ignored; the focused Store and Sync suites above passed again, and the TypeScript check passed.
- The formal `pnpm tauri:build:webdriver` frontend build completed and all four driver crates entered compilation, but the build stopped with `No space left on device` while writing Rust archives. The generated driver files were restored and the worktree is clean after removing only its 7.2 GB ignored `target/` cache.
- Added store tests for legacy JSON migration, omission of runtime ids, and rejection of offset/continue state.
- Added a command test that starts from stale session ids and verifies conflict checking reconnects through persisted connection ids.

The formal Tauri/WebDriver build is owned by the integration tester. This track does not claim safe offset resumption; a fresh compare and run is required after interruption.
