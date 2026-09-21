# migration-schema-constraints-options

## Phase

PASSED

## Implemented slice

- Added a dialect-neutral `CheckConstraint` snapshot to `TableSchema` and a named CHECK add/drop migration operation.
- Schema Diff compares CHECK constraints by name and whitespace-normalized expression, emitting a drop/add pair when a predicate changes.
- PostgreSQL reads named checks from `pg_constraint` and renders quoted `ALTER TABLE ... ADD/DROP CONSTRAINT ... CHECK (...)` statements with rollback metadata.
- MySQL parses named and unnamed checks from `SHOW CREATE TABLE` and renders the corresponding add/drop statements.
- SQLite reads CHECK predicates from `sqlite_master` for accurate comparison, but refuses direct CHECK changes because SQLite requires a table rebuild; this path fails closed with an explicit unsupported requirement.
- Reviewed plan validation includes CHECK metadata through the existing `TableSchema` snapshot. Cross-dialect CHECK changes are rejected because predicate translation is not implemented.
- Schema Diff UI and text export now show CHECK constraints added to or removed from the target.
- Table-level engine/charset/comment/partition options remain outside this slice; no unsupported table option is synthesized.

## Self validation

- `CARGO_TARGET_DIR=/tmp/datazen-migration-schema-constraints-options cargo test -p datazen-driver-api --lib schema_migration`: 7 passed.
- `CARGO_TARGET_DIR=/tmp/datazen-migration-schema-constraints-options cargo test -p datazen-driver-postgres --lib migration`: 17 passed.
- `CARGO_TARGET_DIR=/tmp/datazen-migration-schema-constraints-options cargo test -p datazen-driver-mysql --lib migration`: 15 passed.
- MySQL CHECK parser focused test: 1 passed.
- SQLite CHECK renderer fail-closed and parser focused tests: 2 passed.
- Host Schema Diff through driver injection: 96 passed before the final cross-dialect guard; the two new CHECK compare/IR tests each passed afterward.
- Vitest `src/windows/schema-diff/__tests__/SchemaDiffPanels.test.tsx`: 16 passed.
- `npx tsc --noEmit`: passed.
- `cargo fmt --all -- --check` and `git diff --check`: passed after generated driver registration formatting.

## Independent Tester verification

- Code review covered all changed API, driver, Schema Diff, reviewed-plan, and UI/text-export paths.
- `cargo test -p datazen-driver-api --lib`: **141 passed**.
- `cargo test -p datazen-driver-postgres --lib`: **119 passed**.
- `cargo test -p datazen-driver-mysql --lib`: **96 passed** before tester boundary cases; focused parser reproduction **failed** with BUG-001.
- `cargo test -p datazen-driver-sqlite --lib`: **56 passed** before tester boundary cases; focused parser reproduction **failed** with BUG-002.
- Injected Host Schema Diff suite: **99 passed** before tester-only reviewed snapshot assertion; frontend Schema Diff suite: **28 passed** before tester-only CHECK rendering assertion.
- Tester-only frontend CHECK rendering/text-export assertion passed: **17/17** in `SchemaDiffPanels.test.tsx`.
- Coverage command was attempted, but repository-wide configured threshold is not meaningful for focused files and failed on global coverage (0.44% statements); changed UI paths were exercised by the focused suite.
- No live PostgreSQL/MySQL database journey or destructive migration was run.
- Tester added only tests and this track's bug/progress records; no business implementation was changed.

## Bug fixes

- BUG-001: MySQL CHECK scanning now skips SQL string literals, quoted identifiers, and comments before recognizing `CHECK`, so a default literal such as `'CHECK (literal)'` is not reported as a constraint.
- BUG-002: SQLite CHECK scanning now skips block and line comments at both the table-definition and predicate-scanning levels, so comment text containing `CHECK (...)` is ignored while real constraints remain visible.
- Focused MySQL parser regressions and the existing named/unnamed CHECK parser test passed.
- Focused SQLite parser regressions and the existing nested CHECK parser test passed.
- Focused Host Schema Diff comparison test passed.

## Independent Tester retest

- Retest covered the two reported boundary bugs and added test-only cases for MySQL block/line comments, quoted identifiers, SQLite line comments, and comments containing a closing parenthesis inside a CHECK predicate.
- MySQL driver unit suite: **97 passed**; focused boundary tests: **2 passed**.
- SQLite driver unit suite: **57 passed**; focused boundary tests: **2 passed**.
- Driver API unit suite: **141 passed**; PostgreSQL driver unit suite: **119 passed**.
- Injected Host Schema Diff suite: **100 passed**.
- Schema Diff frontend suites (`schemaDiff`, panels, profile load, wizard, table names): **49 passed**.
- Focused `SchemaDiffPanel` coverage: **96.66% statements, 83.92% branches, 100% functions, 100% lines**.
- `npx tsc --noEmit`, `cargo fmt --all -- --check`, and `git diff --check`: passed.
- No live PostgreSQL/MySQL journey or destructive migration was run.

## Known limits

- SQLite CHECK add/drop requires a future table-rebuild implementation and is intentionally unsupported today.
- CHECK expressions are not translated between database families; cross-dialect plans record an unsupported requirement.
- Table-level engine, charset/collation, table comments, and partition metadata remain a separate follow-up slice.
- Live PostgreSQL/MySQL database journeys were not run in this coding worktree.

## Tester verdict

- Previous verdict: **TEST_FAILED** for `migration-schema-constraints-options-BUG-001` and `migration-schema-constraints-options-BUG-002`.
- Current verdict: **PASSED** after independent retest of both fixes and the focused regression suites.

## Commit

- Coding commit: `2426b710`.
- Tester verification commit: recorded below after committing the test-only coverage and verdict.
