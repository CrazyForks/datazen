# migration-sync-paged

Phase: READY_FOR_TEST

## Scope

Implemented the first version of the Data Sync comparison paging contract. `compare_data_sync` now returns a versioned table summary with schema metadata, operation and unchanged counts, bounded page size, first cursor and `hasMore`; row payloads are fetched through `get_data_sync_comparison_page` using only an opaque plan id, stable source/target table identity, cursor and bounded limit. Cursor signatures bind the plan, table pair and offset, and the command rejects expired or claimed plans, unknown tables, forged/out-of-range cursors, duplicate/non-advancing cursors, zero limits and limits above the server maximum.

The review window keeps only table summaries, the current page and selected row keys. Page navigation preserves selections for already loaded pages and the UI labels actions as current-page scope. SQL generation and execution continue to use the server-owned immutable ComparisonStore and validate key-only selection; client page rows are never an execution authority. Legacy full-row compare responses remain readable for compatibility during rollout. Repeating a valid cursor is idempotent and returns the same page; only the server-issued next cursor advances.

## Implementation boundary

The IPC and frontend memory are page-bounded, but the current private JSON ComparisonStore has no disk row index. A page request therefore deserializes the complete server-side comparison and slices the requested table. This is intentionally documented rather than called true streaming; a follow-up disk-backed row index is required to bound server-side page reads for very large comparisons. Existing ComparisonStore limits remain in force.

## Self-validation

- `npx vitest run src/commands/__tests__/syncPlan.test.ts src/windows/data-sync/__tests__`: 9 files, 49 tests passed.
- `npx tsc --noEmit`: passed.
- `CI=true pnpm tauri:build:webdriver`: passed frontend build, Rust build with PostgreSQL/MySQL/SQLite/Redis injection, WebDriver build and macOS App/DMG packaging.
- `CARGO_TARGET_DIR=target/cargo-wt node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib commands::sync::plans`: 9 passed, 0 failed.

The implementation is ready for an independent tester. Coder self-validation is not a PASSED verdict.
