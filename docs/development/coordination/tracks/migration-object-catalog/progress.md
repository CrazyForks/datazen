# migration-object-catalog

## Phase

READY_FOR_TEST

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

## Commit

- Coding commit: to be recorded in the READY_FOR_TEST handoff.
