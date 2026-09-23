# schema-type track

Phase: READY_FOR_TEST

## Implementation

- Added the driver API `MigrationType` contract and `CreateType` / `ReplaceType` / `DropType` operations.
- Added fail-closed type DDL validation: exact schema/name identity, one driver-owned `CREATE TYPE` or `CREATE DOMAIN` statement, and no statement injection.
- Added PostgreSQL type/domain renderer and capability coverage. MySQL and SQLite explicitly reject user-defined type migration because they do not expose a matching catalog/renderer contract. SQL Server keeps its existing catalog/DDL listing but has no migration renderer, so planning fails closed.
- Added Host schema-object snapshots, same-dialect Type planning, reviewed target snapshots, Type IPC (`prepare_schema_type_plan`), command registration, frontend command wrapper, and Object Browser Type tab.
- Cross-dialect translation and dependency graph ordering remain outside this track and are recorded as follow-up work.

## Validation

- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-api --lib`: PASS (151/151)
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-postgres --lib`: PASS (127/127 after Type tests)
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-sqlite --lib migration::tests`: PASS (10/10)
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib schema_diff::objects::tests`: PASS (12/12)
- MySQL migration test compile is blocked by a pre-existing missing `MysqlDriver::parse_check_from_create_table` referenced by `packages/drivers/mysql/src/tests.rs`; no Type-related error was reported.
- Frontend Vitest/TypeScript commands could not run because this worktree has no `node_modules/.bin/vitest` or `node_modules/.bin/tsc`, and network installation is unavailable.
- `git diff --check`: PASS

Commit: pending
