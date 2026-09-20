# SQL-file Data Transfer tester findings

## TEST_FAILED

The independent tester completed the focused Rust, frontend, type-check, and formal WebDriver build gates, but the SQL-file UI journey has blocking defects.

### BUG-001 [P1] SQL-file UI submits an empty table selection and exports no tables

- **Repro:** Open Data Transfer, choose `SQL file`, select a source connection/database and a destination `.sql` file, keep the default `Data` mode, advance to preview, then execute.
- **Evidence:** `DataTransferWindow.tsx:500-506` always sends `selection.sourceTables` from `job.tables`. In SQL-file mode `buildJob` returns `tablesToMappings()`, and the SQL-file UI intentionally skips object inspection, so this is `Some([])`. The server's `apply_selection` in `src-tauri/src/commands/data_transfer/exec.rs:302-313` treats an explicit empty list as “disable every planned table”. SQL-file preview creates the source mappings on the server when `job.tables` is empty (`src-tauri/src/commands/data_transfer/preview.rs:66-86`).
- **Expected:** An unfiltered SQL-file transfer executes every table selected by the server preview (the default source scope) and writes their DDL/data.
- **Actual:** Execution receives an explicit empty selection, disables all preview mappings, and publishes an SQL file containing only the header/transaction wrapper; the UI progress also reports `0` tables.
- **Suggested fix boundary:** For SQL-file mode, omit `sourceTables` from the run request when the UI has no table mapping snapshot, or have the server treat `Some([])` as invalid/unchanged for this mode. Add a UI journey assertion for a multi-table source.

### BUG-002 [P1] SQL-file preview back navigation lands on an unusable empty mapping step

- **Repro:** Follow the same SQL-file setup through preview, then click `Back` once.
- **Evidence:** SQL-file setup skips `objects` and `mapping` in `DataTransferWindow.tsx:592-602`, but the shared footer calls `goBack` (`:1130-1133`) and `goBack` blindly decrements the global `STEPS` array (`:610-613`). From `preview`, the destination is always `mapping`, even though SQL-file mode has `tables=[]` and never ran inspection.
- **Expected:** Back from SQL-file preview returns to the SQL-file setup (or endpoint) step, preserving a usable path to regenerate the preview.
- **Actual:** The user is shown an empty mapping screen with no selected table and a disabled Next button. They must press Back multiple additional times to reach setup; the intermediate screen is a dead-end and does not represent the SQL-file flow.
- **Suggested fix boundary:** Make back navigation destination-aware for SQL-file mode and add a journey test for preview → back → setup.

### BUG-003 [P1] SQL-file structure preview exposes editable DDL that execution ignores

- **Repro:** Choose `SQL file`, select `Structure` or `Structure + Data`, generate preview, edit any displayed CREATE statement, then execute.
- **Evidence:** The preview DDL editor uses `tables.find(...)` and `updateTableDdlOverride` (`DataTransferWindow.tsx:1022-1051`, `:615-628`). SQL-file mode bypasses object/mapping inspection, so `tables` remains empty; the update maps no row and the edited SQL is not included in the immutable `TransferJob` sent for execution. The backend executes the original plan job (`src-tauri/src/commands/data_transfer/exec.rs:111-125`).
- **Expected:** Editing a displayed DDL statement either updates the reviewed SQL-file plan or the UI presents a read-only preview with no edit affordance.
- **Actual:** The editor accepts typing visually, but the server-owned plan still renders the original DDL, so the user can unknowingly export different SQL than the review screen shows.
- **Suggested fix boundary:** Keep a server-owned per-table DDL override in the SQL-file plan and re-preview on edits, or make this mode read-only and remove the edit hint/editor.

### BUG-004 [P1] Atomic publication cannot overwrite an existing SQL file on Windows

- **Repro:** On Windows, select an existing `.sql` file as the destination and run a successful SQL-file transfer.
- **Evidence:** `src-tauri/src/data_transfer/sql_file.rs:151-160` calls `fs::rename(&temporary, &destination)` directly. Windows `rename` fails when the destination already exists, whereas macOS/Linux replace it. The operation returns `cannot publish SQL file` and leaves the old file in place even though the user selected it as a save destination.
- **Expected:** A successful transfer atomically replaces an existing destination on every supported platform while preserving the old file if rendering fails or is cancelled.
- **Actual:** Existing-file exports fail on Windows; only new destinations publish successfully.
- **Suggested fix boundary:** Use a platform-aware atomic replace primitive (or remove/rename the old file only within a carefully failure-safe publication sequence) and add a Windows-specific integration test.

## Verification evidence

- `npx vitest run src/commands/__tests__/transfer.test.ts src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx`: 29/29 passed.
- Injected Rust `data_transfer::sql_file`: 3/3 passed.
- Injected Rust `commands::data_transfer`: 16/16 passed.
- Injected Rust `data_transfer::execution_tests`: 12/12 passed.
- Injected Rust `data_transfer::preview`: 6/6 passed.
- `npx tsc --noEmit`: passed.
- `CI=true pnpm tauri:build:webdriver`: passed, producing the debug app and DMG.

