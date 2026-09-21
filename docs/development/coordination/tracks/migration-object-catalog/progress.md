# migration-object-catalog

## Phase

FAILED

## Scope

- Extended the shared schema-object metadata contract with routine overload signatures and trigger target schema/name fields.
- Added PostgreSQL routine catalog/DDL filtering by `prokind` and `pg_get_function_identity_arguments`, plus trigger relation filtering.
- Switched MySQL routine/trigger catalogs to `information_schema` and qualified routine/trigger DDL with escaped schema identifiers.
- Added SQLite trigger target metadata while keeping routine/sequence capabilities explicitly unsupported.
- Propagated object identity through Host IPC and the object browser/panel wrapper so overloads and same-name triggers remain addressable.
- Missing/ambiguous DDL results now fail closed instead of returning an empty or arbitrary definition.

## Self validation

- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-api --lib`: 140 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-postgres --test schema_objects_sql`: 8 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-mysql --test schema_objects_sql`: 6 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-sqlite --test schema_object_commands`: 5 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-sqlite --test schema_objects_sql`: 5 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib commands::schema::tests::`: 14 passed.
- `npx --no-install vitest run src/windows/connection/__tests__/ObjectBrowser.test.tsx src/windows/connection/__tests__/ConnectionNavigatorTree.test.tsx`: 87 passed.
- `npx --no-install tsc --noEmit`: passed.
- `rustfmt --edition 2021` on changed Rust files: passed.
- `git diff --check`: passed.

## Known limits

- PostgreSQL/MySQL live-server integration was not available in this coder pass; SQL contracts are covered with driver integration tests and Host mock IPC tests.
- MySQL and SQLite do not advertise native sequence support; cross-dialect sequence translation remains intentionally unsupported.
- Trigger target metadata is used to disambiguate DDL lookup; trigger migration/rendering remains outside this track.
- Rust coverage instrumentation was not run because no repository coverage command was available in this worktree.

## Follow-up BUG-001

- ObjectBrowser now keys rows and compares selected/copy state by the complete object identity: kind, schema, name, routine signature, and trigger target schema/name.
- Overload and trigger identity journeys remain covered by the focused ObjectBrowser, navigator, PostgreSQL, and SQLite tests.

## Commit

- Coding commit: e15d81c9

## Tester round 2

- Tester test additions: ObjectBrowser overload copy, navigator key uniqueness, and panel identity journeys.
- Focused Vitest: 97 passed, 2 failed; both failures are migration-object-catalog-BUG-001.
- ObjectBrowser coverage with focused suite: 96.05% statements, 84.74% branches, 96% functions, 97.33% lines.
- Driver/API/Host checks: Driver API 140 passed; PostgreSQL object SQL 10 passed; MySQL object SQL 6 passed; SQLite object command 6 passed; SQLite object SQL 5 passed; Host schema tests 14 passed.
- TypeScript, Prettier, rustfmt, and `git diff --check`: passed.
- Live DB limitation: PostgreSQL and MySQL live-server integration was unavailable; SQL contracts and Host mock IPC were used.
- Tester commit: 564dad6e
