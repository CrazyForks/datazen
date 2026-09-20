# Track: migration-transfer-sql-target

- Phase: READY_FOR_TEST
- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-transfer-sql-target`
- Branch: `codex/migration-transfer-sql-target`
- Scope: server-owned SQL-file destination for Data Transfer, integrated with immutable preview plans and execute-by-plan-id.
- Constraints: preserve existing database targets; no client-supplied SQL payload or filesystem path; source-dialect SQL output in this wave.

## Implementation

- Added an opaque, process-lifetime native path token registry and `pick_data_transfer_sql_file` IPC command. The webview receives only the token; the backend resolves and validates the absolute `.sql` destination.
- Added server-side SQL rendering for structure/data transfer. It reuses existing source filtering, recordset scopes, column mappings, mapped target names, driver literals, and source catalog qualification.
- Added atomic sibling temporary-file output with flush/sync/rename publication. Failed or cancelled runs drop the temporary file and leave the existing destination unchanged.
- Added SQL-file preview and execute-by-plan-id validation, source schema/driver/filter fingerprints, one-shot plan claiming, cancellation handling, and result summaries. Existing database targets remain supported through the required database target accessor.
- Added the destination mode and native file picker to the transfer window, plus English and Simplified Chinese translation keys.

## Self-validation

- Focused Vitest (`transfer.test.ts`, `DataTransferWindow.test.tsx`): **29 passed, 0 failed**.
- Focused Rust SQL-file tests: **3 passed, 0 failed**.
- Focused Rust data-transfer command tests including the end-to-end opaque-token/atomic-publish test: **16 passed, 0 failed**.
- Focused Rust execution tests: **4 passed, 0 failed**; preview tests: **6 passed, 0 failed**.
- `npx tsc --noEmit`: passed.
- `cargo fmt --all` and `git diff --check`: passed after generated files were restored.
- `CI=true pnpm tauri:build:webdriver`: frontend build passed and Rust compilation was in progress; the long build was interrupted after the coder timeout. It initially required a temporary empty `src-tauri/resources/builtin-ep` directory because the community worktree has no Pro resource directory.

## Tester fix pass

- SQL-file execution now omits an empty UI selection and the server treats a stale empty selection as unchanged, preserving the server-discovered multi-table scope. Progress counts use the immutable preview when no client table snapshot exists.
- SQL-file preview back navigation returns directly to setup, and structure DDL is rendered read-only so the displayed SQL cannot diverge from the immutable plan.
- Atomic publication uses POSIX rename replacement and Windows `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)`; staging drops leave an existing destination untouched on failure/cancel.
- Follow-up Vitest: **32 passed, 0 failed**; Rust SQL-file: **4 passed, 0 failed**; Rust data-transfer commands: **17 passed, 0 failed**; `npx tsc --noEmit`, `cargo fmt --all`, and `git diff --check`: passed.
- Formal `CI=true pnpm tauri:build:webdriver`: passed; debug app and DMG produced, then generated driver/Cargo files were restored.

## E2E registration

| Journey | Status |
| --- | --- |
| Native SQL path picker → source-only destination → preview → execute by plan id → atomic SQL output | 【本机可执行】 covered by the Rust command test and UI command IPC test |
| SQL-file default preview → execute with no client table snapshot → all server-selected tables retained | 【本机可执行】 covered by `sql_file_empty_selection_keeps_server_discovered_tables` and the UI multi-table journey |
| SQL-file preview → Back → setup, and structure preview shows immutable read-only DDL | 【本机可执行】 covered by `DataTransferWindow.test.tsx` |
| Existing SQL destination is unchanged until successful publication | 【本机可执行】 covered by the atomic writer test |
| SQL output uses mapped columns and escaped driver literals | 【本机可执行】 covered by the renderer test |

## Limitations

- The SQL-file UI mode currently skips the existing object/mapping editor and lets the backend select all source tables when no mappings are supplied. The backend still honors mappings, source filters, and recordsets when supplied by an immutable job.
- Output uses the source driver dialect; cross-dialect target-specific DDL adaptation, dependency ordering, indexes/foreign keys, encoding/compression, resume, and live database fixture coverage remain later parity work.
- Path tokens are process-lifetime and plans retain the existing transfer plan expiry/one-shot semantics.
