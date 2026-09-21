# migration-table-options

## Phase

READY_FOR_RETEST

## Scope

- Add a dialect-neutral `TableOptions` snapshot for table comment, storage engine, and default character set.
- Read these values from MySQL/MariaDB information schema metadata and carry them through Schema Diff compare, reviewed snapshots, and deploy plans.
- Render safe MySQL `ALTER TABLE` option changes with rollback metadata; PostgreSQL, SQLite, and cross-dialect plans fail closed because translation is not implemented.
- Show table option changes in Schema Diff UI and plain-text export.

## Validation

- `cargo test -p datazen-driver-api --lib`: 141 passed.
- `cargo test -p datazen-driver-mysql --lib migration`: 17 passed.
- Injected Host Schema Diff focused tests: 100 passed; full Host lib regression: 1598 passed, 52 pre-existing AI wiremock tests failed because the sandbox denied mock-server ports, 3 ignored.
- Schema Diff Vitest focused files: 34 passed.
- `npx --no-install tsc --noEmit`: passed.
- `cargo fmt --all -- --check` and `git diff --check`: passed.

## Safety boundary

- MySQL engine and charset tokens accept only ASCII alphanumeric/underscore identifiers; unknown or removed values fail closed.
- Table comments use SQL literal escaping and preserve rollback metadata.
- PostgreSQL/SQLite renderers reject table options; cross-dialect plans record an unsupported requirement instead of copying source syntax.
- Collation, partitioning, table-level compression, and live MySQL integration coverage remain future work.

## Commit

- Coding commit: 03644d70.
- Bug-fix commit: pending.
- Independent Tester verification: prior round FAILED on BUG-001; fix is ready for a fresh retest.

## Tester verification

- Driver API: 141 passed.
- MySQL migration: 17 passed.
- PostgreSQL migration: 17 passed.
- SQLite driver: 58 passed.
- Schema Diff Vitest focused suite: 7 files / 46 passed.
- Added `test_tester` coverage for table-option UI rendering and text export.
- `SchemaDiffPanel.tsx` targeted coverage: 97.5% statements, 81.15% branches, 100% functions, 100% lines.
- TypeScript check, rustfmt check, and diff check passed.
- Host injected Schema Diff build is blocked by `migration-table-options-BUG-001`.
