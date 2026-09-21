# migration-table-options

## Phase

PASSED

## Scope

- Add a dialect-neutral `TableOptions` snapshot for table comment, storage engine, and default character set.
- Read these values from MySQL/MariaDB information schema metadata and carry them through Schema Diff compare, reviewed snapshots, and deploy plans.
- Render safe MySQL `ALTER TABLE` option changes with rollback metadata; PostgreSQL, SQLite, and cross-dialect plans fail closed because translation is not implemented.
- Show table option changes in Schema Diff UI and plain-text export.

## Validation

- `cargo test -p datazen-driver-api --lib`: 141 passed.
- `cargo test -p datazen-driver-mysql --lib migration`: 17 passed.
- `cargo test -p datazen-driver-postgres --lib migration`: 17 passed.
- `cargo test -p datazen-driver-sqlite --lib`: 58 passed.
- `cargo test -p datazen-driver-redis --lib`: 126 passed, 1 ignored.
- Injected basic Host Schema Diff tests: 101 passed; Redis now compiles through the Host injection path.
- Schema Diff Vitest focused files: 9 files / 66 passed.
- `SchemaDiffPanel.tsx` targeted coverage: 97.5% statements, 81.15% branches, 100% functions, 100% lines.
- `npx --no-install tsc --noEmit`: passed.
- `cargo fmt --all -- --check` and `git diff --check`: passed.

## Safety boundary

- MySQL engine and charset tokens accept only ASCII alphanumeric/underscore identifiers; unknown or removed values fail closed.
- Table comments use SQL literal escaping and preserve rollback metadata.
- PostgreSQL/SQLite renderers reject table options; cross-dialect plans record an unsupported requirement instead of copying source syntax.
- Collation, partitioning, table-level compression, and live MySQL integration coverage remain future work.

## Commit

- Coding commit: 03644d70.
- Bug-fix commit: `e693b7fa`.
- Independent Tester verification: PASSED after the Redis `TableSchema` initializer fix.

## Tester verification

- Driver API: 141 passed.
- MySQL migration: 17 passed.
- PostgreSQL migration: 17 passed.
- SQLite driver: 58 passed.
- Schema Diff Vitest focused suite: 9 files / 66 passed.
- Redis driver suite: 126 passed, 1 ignored.
- Added `test_tester` coverage for table-option UI rendering and text export.
- `SchemaDiffPanel.tsx` targeted coverage: 97.5% statements, 81.15% branches, 100% functions, 100% lines.
- TypeScript check, rustfmt check, and diff check passed.
- Host injected Schema Diff suite: 101 passed; the Redis compile blocker is resolved.
