# migration-schema-foreign-keys

## Phase

READY_FOR_TEST

## Scope

- Add foreign-key create/drop/replace operations to the dialect-neutral Schema Diff IR.
- Preserve names, local and referenced columns, referenced relations, and update/delete actions.
- Order foreign-key DDL after table, column, primary-key, and supporting-index prerequisites, and before dependent drops.
- Render safe DDL for PostgreSQL and MySQL; SQLite remains fail-closed because `ALTER TABLE` cannot add or remove a foreign key without a table rebuild.
- Normalize schema-qualified referenced relation names when the target dialect does not support source schema qualification.

## Validation

- Injected Host Schema Diff tests: 78 passed.
- Driver renderer tests: PostgreSQL migration 10 passed; MySQL migration 10 passed; SQLite migration 5 passed.
- Driver API schema migration tests: 5 passed.
- `cargo fmt --all -- --check` and `git diff --check` passed.

## Safety boundary

- Foreign-key drops are destructive and require the existing Schema Diff destructive approval path.
- Invalid names, empty column lists, mismatched local/referenced column counts, and unsupported actions fail closed before SQL is emitted.
- SQLite foreign-key changes remain an explicit unsupported requirement; this track does not invent a table-rebuild plan.
- Views, routines, triggers, sequences, CHECK constraints, table options, and drop-table operations remain separate parity work.
