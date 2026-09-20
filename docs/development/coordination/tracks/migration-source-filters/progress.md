# Source filter track — independent retest result

## Scope tested

Retested the source-filter fix at `c1fad3e0` (implementation `810615a0`, defect report `41d42070`) without changing production code. The focus was the original PostgreSQL UI path: enter `id > 2` in the Data Transfer mapping editor, inspect the preview, execute the immutable plan, and verify the target rows through IPC.

## Passed

- `cargo test -p datazen --lib data_transfer`: 58 passed.
- `cargo test -p datazen --lib commands::data_transfer`: 14 passed.
- `cargo test -p datazen-driver-api --lib`: 131 passed.
- `cargo test -p datazen-driver-postgres --lib`: 103 passed.
- Transfer frontend Vitest (`DataTransferWindow.test.tsx`, `transferMappingView.test.ts`): 22 passed.
- `pnpm typecheck`: passed.
- `pnpm tauri:build:webdriver`: passed with PostgreSQL, MySQL, SQLite and Redis injected.
- Fresh real PostgreSQL UI/IPC journey passed its execution and target verification. The editor entered the value as the string `"2"`; the result was `成功已插入行数: 2`, and the target query returned exactly `[[3,"three"],[4,"four"]]`.

The E2E setup printed the known environment warning that `E2E_PG_RO_PASSWORD` is unset, so the read-only sync fixture was not initialized. This focused writable PostgreSQL transfer journey does not use that fixture and completed successfully.

## Final independent retest

The disposable WebDriver journey was rerun from the post-fix branch and completed the full PostgreSQL UI/IPC path:

- The source and target were temporary PostgreSQL tables with `id integer` and four source rows.
- The UI entered the filter value as the string `"2"`, selected `id > 2`, and displayed `WHERE ("id" > $1::integer)` in the reviewed preview. The preview contained no anonymous `?` placeholder.
- The execution result reported `成功已插入行数: 2`.
- A target query through IPC returned exactly `[[3,"three"],[4,"four"]]`.
- The disposable table and connection fixtures were removed after the journey.

Focused regression evidence from this fresh test pass:

- `cargo test -p datazen --lib data_transfer`: 58 passed.
- `cargo test -p datazen --lib commands::data_transfer`: 14 passed.
- `cargo test -p datazen-driver-api --lib`: 131 passed.
- `cargo test -p datazen-driver-postgres --lib`: 103 passed.
- Transfer frontend Vitest plus transfer command tests: 27 passed.
- `pnpm typecheck`: passed.
- `pnpm tauri:build:webdriver`: passed with PostgreSQL, MySQL, SQLite, and Redis injected.
- Real PostgreSQL source-filter WebDriver/IPC journey: 1 passed.

The E2E setup still reports the known environment limitation that `E2E_PG_RO_PASSWORD` is unset, so the read-only sync fixture is not initialized. It does not affect this writable PostgreSQL Data Transfer journey.

## Conclusion

TEST_DONE. SFLT-001 and SFLT-002 are independently verified as fixed for the real UI preview, execution, and target-row contract.
