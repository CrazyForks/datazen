# migration-schema-objects

## Phase

READY_FOR_TEST

## Scope

- Implemented the first object migration slice: same-dialect views.
- Added dialect-neutral `CreateView`, `ReplaceView`, and `DropView` operations with schema-qualified identities and source-definition validation.
- Added PostgreSQL and MySQL create/replace/drop rendering with quoted identifiers and rollback SQL. SQLite supports create/drop and explicitly rejects replacement because it requires a rebuild.
- Added a host view planner that compares schema + name + definition, applies the destructive approval gate to target-only drops, preserves rollback metadata, and fails closed for cross-dialect, unsupported, duplicate, invalid, or unsafe definitions.
- Added `prepare_schema_view_plan` IPC. The backend lists and reads source/target view metadata, accepts only object selectors, freezes target view snapshots into the existing one-shot reviewed plan, and revalidates those snapshots before deployment through the existing deploy executor.
- Added frontend command wrapper and focused command/renderer/planner/reviewed tests.

## Self validation

- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-api --lib schema_migration::type_parts_tests`: 6 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-api --lib schema_objects`: 5 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-postgres --test schema_objects_sql`: 6 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-mysql --test schema_objects_sql`: 5 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-sqlite --test schema_objects_sql`: 4 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-postgres --lib migration`: 12 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-mysql --lib migration`: 11 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-sqlite --lib migration`: 6 passed.
- `CARGO_TARGET_DIR=target/cargo-wt node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib schema_diff`: 84 passed.
- `npx --no-install vitest run src/commands/__tests__/schemaDiff.test.ts`: 15 passed.
- `npx --no-install tsc --noEmit`: passed.
- `rustfmt --edition 2021` on changed Rust files: passed.
- `git diff --check`: passed.
- Full host `cargo test -p datazen --lib` was attempted through the driver-injection wrapper: 1578 tests passed, 52 unrelated AI/wiremock tests failed because the sandbox denied binding local OS ports (`PermissionDenied`), and 3 were ignored. The focused schema-diff suite remains green.

## Known limits

- This slice is views only. Routines, triggers, sequences, CHECK constraints, table options, drop-table semantics, and object dependency ordering remain later work.
- View migration is intentionally same-dialect only; translating referenced relation/type syntax across database families requires a driver-owned dependency contract.
- View definitions containing semicolons are rejected before rendering to preserve one reviewed statement per operation; definitions requiring multi-statement setup are unsupported.
- No live PostgreSQL/MySQL desktop journey was run in this coder wave. Independent Tester must verify the exact IPC/deploy path against isolated databases and inspect the generated body-DDL queries.

## Commit

- Coding commit: final SHA is recorded in the READY_FOR_TEST handoff.
