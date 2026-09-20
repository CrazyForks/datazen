# Data Sync table-level select-all across pages

## BOOTSTRAP (2026-09-20)

- Scope: server-owned table/operation selection scopes with per-row exclusions for the paged Data Sync review.
- Worktree: `codex/migration-sync-select-all`.
- Constraints: selection is bound to the immutable comparison revision and plan-owned rows; no client row payloads, SQL, OFFSET checkpoint or execution fallback.
- Status: implementation in progress; backend contract and validation are being extended before UI wiring.

## HEARTBEAT (2026-09-20)

- Added strict Rust `SyncTableSelection`/`SyncSelectionExclusion` contracts and server-side expansion/validation.
- Wired command IPC selection scopes through SQL preview and execution; scope data contains only table/op/key exclusions.
- Added page-aware UI scope state, per-row exclusions and honest scope counts in ExecuteBar.
- Added command-level journey coverage for 5,000-row scope selection without page-key materialization.
- Validation: `commands::sync` Rust 48/48 with injected PostgreSQL/MySQL/SQLite/Redis drivers; focused Sync frontend/IPC tests 39/39; `npx tsc --noEmit`; formal `CI=true pnpm tauri:build:webdriver` with App/DMG packaging.
- Scope counts use server comparison summaries and subtract exclusions; generated selection keeps row keys only for explicit rows outside a scope.
- Limitations: this track still relies on the existing server-owned full comparison for SQL generation/execution; it adds no checkpointed OFFSET resume, row payload authority, or multi-table scope UI in one click.
- Status: FAILED — independent testing found migration-sync-select-all-BUG-001; see bugs.md.

## TESTER (2026-09-20)

- Code review: strict serde and server-owned scope expansion reject unknown tables, disabled/duplicate operations, duplicate exclusions, unknown keys, cross-table rows, client payloads, and explicit rows that overlap a scope. Plan callers enforce the exact selection revision; SQL preview and execute both apply the same server-owned selection.
- Passed: `CARGO_TARGET_DIR=target/cargo-sync-select-all-tester node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib commands::sync` — 48/48.
- Passed: focused Data Sync/IPC Vitest before tester case — 9 files, 52/52.
- Failed: tester full UI journey after adding cross-page clear coverage — 9 files, 52 passed, 1 failed. The failure is BUG-001.
- Passed: `npx tsc --noEmit`.
- Passed: `CI=true pnpm tauri:build:webdriver` (Vite build, Tauri debug app, App and DMG bundles); no live PostgreSQL E2E was run because `E2E_PG_RO_PASSWORD` is unavailable in this environment.
- `git diff --check` passed. `cargo fmt --all -- --check` is blocked by pre-existing generated `src-tauri/src/driver_init.rs` ordering/blank-line differences after driver injection; no production file was changed by the tester.
