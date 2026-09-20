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
- Status: implementation self-validation complete; ready for independent testing.
