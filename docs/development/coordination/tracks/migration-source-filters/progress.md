# Source filter track — independent test result

## Scope tested

Validated the committed Transfer source-filter implementation at `810615a0` for structured filter serialization, identifier validation, parameterized SQL construction, immutable-plan binding, UI typecheck, real PostgreSQL execution, the existing Transfer E2E suite, and the formal WebDriver build.

## Passed

- `cargo test -p datazen --lib data_transfer`: 57 passed.
- `cargo test -p datazen --lib commands::data_transfer`: 14 passed.
- `cargo test -p datazen-driver-api --lib`: 131 passed.
- Transfer frontend Vitest (`transfer.test.ts`, `DataTransferWindow.test.tsx`, `transferMappingView.test.ts`): 27 passed.
- `pnpm typecheck`: passed.
- `pnpm tauri:build:webdriver`: passed with PostgreSQL, MySQL, SQLite and Redis injected.
- Existing real database Data Transfer suite: 8 spec files, 40 tests passed, including PG↔MySQL journeys and 25,000-row wide-type transfers.
- A direct IPC journey using a JSON numeric filter value (`id > 2`) returned `rowsInserted: 2`, `partial: false`; this confirms the bound source scan and writer work when the parameter has a numeric type.

The E2E database setup printed pre-existing nonfatal demo-fixture errors for stale `test_orders` / `product_name` columns; the suite still completed and passed. These are environment-fixture noise, not source-filter failures.

## Failed / blocking

- Real PostgreSQL IPC journey using the value produced by the source-filter editor (`id > "2"`) failed during source scan with `operator does not exist: integer > text`; execution returned `rowsInserted: 0`, `partial: true`, and copied no rows. See `bugs.md` SFLT-001.
- The current preview reports `canExecute: true` for this case, so the user receives no early type-compatibility warning.

## Conclusion

TEST_FAILED. The source-filter feature is correct for typed JSON numeric values and for text predicates, but the shipped editor path cannot reliably filter PostgreSQL integer/numeric columns until values are typed from source column metadata or the server supplies compatible typed placeholders/bindings. Do not close this track as a complete filtered-transfer gate until SFLT-001 is fixed and independently retested.
