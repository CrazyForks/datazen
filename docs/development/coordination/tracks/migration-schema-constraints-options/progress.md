# migration-schema-constraints-options

## Phase

READY_FOR_TEST

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

## Known limits

- Independent Tester must review this worktree and run the full required verification; coder self-validation is not a pass verdict.
- SQLite CHECK add/drop requires a future table-rebuild implementation and is intentionally unsupported today.
- CHECK expressions are not translated between database families; cross-dialect plans record an unsupported requirement.
- Table-level engine, charset/collation, table comments, and partition metadata remain a separate follow-up slice.
- Live PostgreSQL/MySQL database journeys were not run in this coding worktree.

## Commit

- Coding commit: recorded in the READY_FOR_TEST handoff.
