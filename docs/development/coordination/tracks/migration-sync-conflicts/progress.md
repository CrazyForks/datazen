# Data Sync optimistic conflicts

## Scope

This track makes Data Synchronization writes optimistic and observable. UPDATE and DELETE statements carry the target row captured during comparison as null safe, bound predicates. Execution uses the driver's affected row count and aborts the transaction when an UPDATE or DELETE affects zero rows.

## Implemented

- UPDATE/DELETE SQL requires a target row with the exact canonical projection width.
- Every non primary key target column participates in a null safe expected value predicate.
- Expected values are always bound twice for portable `value = ? OR (value IS NULL AND ? IS NULL)` semantics.
- Live sync execution uses `execute_with_params`, preserving transaction scoped affected row counts.
- `ExecutionResult.affectedRows` reports the aggregate database count and defaults during deserialization for older responses.
- Zero affected UPDATE/DELETE is returned as an optimistic conflict after rollback.

## Verification

- Host focused Data Sync and sync-command tests: **112 passed, 0 failed**.
- Host Rust library suite: **1432 passed, 0 failed, 3 ignored**.
- Driver suites: `datazen-driver-api` **131**, PostgreSQL **103**, MySQL **88**, SQLite **50** passed; no failures.
- Frontend Data Sync and opaque-plan tests: **46 passed**; TypeScript checking passed.
- Formal `pnpm tauri:build:webdriver`: passed and produced the WebDriver application bundle.
- Existing immutable-plan journeys: PostgreSQL **2/2**, MySQL **2/2** passed.
- Independent live optimistic-conflict journey: PostgreSQL and MySQL each verified that changing the target row after comparison produces a conflict, leaves the changed target row intact after rollback, and that a subsequent successful UPDATE reports `{ applied: 1, rolledBack: false, affectedRows: 1 }`.
- The E2E database setup emitted its existing missing `E2E_PG_RO_PASSWORD` warning, but the read/write databases required by these journeys were available and all selected journeys passed.

## Independent tester result

`TEST_DONE`: no correctness blocker was found in the scoped optimistic-conflict implementation. SQL generation tests cover bound UPDATE/DELETE predicates, null-safe expected values, parameter ordering, and fail-closed missing or mismatched target rows; opaque plan selection and live write behavior passed the independent checks above.
