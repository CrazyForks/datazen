# migration-schema-safety

## Phase

READY_TO_MERGE

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

## BUG-001 repair

- Renderer validation now trims relation identifiers and rejects empty, control-character, empty-segment, and whitespace-padded qualified names before quoting `DropTable` SQL.
- Host planning applies the same fail-closed validation before driver lookup or renderer invocation, so invalid target-only identifiers produce `PlanRequirement::Unsupported` with no executable statement.
- Added regression coverage for blank, control-character, and malformed qualified identifiers in the Driver API, PG/MySQL/SQLite renderers, and Host planner.
- Validation after repair: Host Schema Diff 92 passed; PostgreSQL 116, MySQL 94, and SQLite 54 driver tests passed; Driver API 134 passed; Schema Diff Vitest 33 passed; TypeScript check passed.
- Repair commit: `6337b2cf`.

## Second-round tester validation

- `TEST_DONE`: `PASSED`; Phase: `READY_TO_MERGE`.
- Tester commit: `ead545c7` (test-only rustfmt correction).
- Independent Host Schema Diff focused suite: 92 passed, 0 failed, including empty, whitespace-only, control-character, and malformed qualified target-only identifiers producing no statements plus an `Unsupported` requirement.
- Independent Driver API suite: 134 passed; PostgreSQL 116, MySQL 94, and SQLite 54 full crate tests passed. Focused migration tests passed: PG 15, MySQL 14, SQLite 9.
- Schema Diff Vitest: 63 passed across 10 files; `npx --no-install tsc --noEmit` passed; rustfmt checks and `git diff --check` passed.
- Reviewed regression paths passed: normal qualified identifiers, destructive approval, no `CASCADE`, no rollback SQL, dependency order, `requireRollback` gating, transaction rollback, commit/rollback unknown outcomes, cancellation rollback failure, and plan requirement gates.
- Changed Rust paths are covered by direct valid/error branch tests and the Host planner/deploy regression matrix; no untested changed core path was identified. Vitest coverage was run for the selected Schema Diff files; the repository-wide global threshold is not meaningful for this focused invocation because unrelated unimported modules are included.
- Limitation retained: the standard Schema Diff target-only table picker is not wired in the UI; this slice is exercised through the neutral planner and still requires source snapshot revalidation before destructive execution.
