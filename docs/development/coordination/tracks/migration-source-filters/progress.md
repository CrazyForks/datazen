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

## Remaining failure

- The preview shown to the user still renders `WHERE ("id" > ?)` and contains no PostgreSQL type cast. The journey recorded `SOURCE_FILTER_PREVIEW_HAS_INTEGER_CAST false` and `SOURCE_FILTER_PREVIEW_HAS_ANON_PLACEHOLDER true`.
- The execution path is now typed and correct, but the preview text does not represent the typed placeholder used for execution (`$1::integer`). See `bugs.md` SFLT-002.

## Conclusion

TEST_FAILED for the requested preview-cast acceptance gate. SFLT-001 is independently verified as fixed for the real UI/IPC execution path; the track remains open until the preview either exposes the typed placeholder/cast or the product contract explicitly accepts the anonymous preview representation.
