# migration-schema-safety

## Phase

FAILED

## Worktree

- Branch: `feature/migration-schema-safety`
- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-safety`
- Base: `50ca3152`

## Implemented slice

- Added an explicit `DropTable` migration operation to the driver API and Host Schema Diff IR.
- A target-only table is planned as one `DROP TABLE` statement instead of a sequence of `DROP COLUMN` operations.
- PostgreSQL, MySQL, and SQLite renderers quote qualified identifiers, omit `CASCADE`, mark the statement destructive, and provide no rollback SQL because DDL cannot restore table data and metadata.
- Driver capabilities advertise `DropTable` only for those three renderers; drivers without an implementation remain fail-closed through the existing capability contract.
- Dependency ordering keeps foreign-key drops and same-table operations ahead of `DropTable`.
- Existing deploy gates therefore require destructive confirmation and reject `requireRollback=true` for a drop-table plan; transactional execution still uses the existing reviewed-plan and unknown-outcome semantics.

## Self validation

- Host Schema Diff Rust: 89 passed, 0 failed.
- Driver Rust suites: PostgreSQL 114 passed, MySQL 92 passed, SQLite 52 passed.
- Driver API Rust: 133 passed, 0 failed.
- Schema Diff Vitest: 33 passed in 6 files.
- `npx --no-install tsc --noEmit`: passed.
- `rustfmt --check` on changed Rust files and `git diff --check`: passed.

## Limits

- CHECK constraint metadata and migration remain deferred; no lossy CHECK conversion was introduced.
- The standard Schema Diff object picker still starts from source tables. This slice is exercised through the neutral schema-diff planner when the desired source snapshot is empty; wiring a target-only table picker requires a separate UI/metadata contract and must preserve source snapshot revalidation before enabling destructive execution.
- No `CASCADE` or synthetic table recreation is emitted, and no real database destructive journey was claimed in this coder wave.

## Coding commit

`214673d6` (`feat(schema-diff): add safe drop-table migration operation`)

## Tester validation

- Phase: `FAILED`
- Blocking bug: `migration-schema-safety-BUG-001`
- Added fail-closed regression tests for empty `DropTable` identifiers and unknown target drivers.
- Schema Diff Vitest: 33 passed, 0 failed.
- Host Schema Diff focused: baseline 89 passed, 0 failed; new empty-identifier regression failed as expected.
- Driver migration focused: baseline PG 13, MySQL 12, SQLite 7 passed; new empty-identifier regression failed in all three renderers.
