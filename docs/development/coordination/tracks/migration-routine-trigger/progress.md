# migration-routine-trigger

Phase: READY_FOR_TEST

## Scope

- Added driver API migration IR for routines and triggers with explicit create,
  replace, and drop operations.
- Added PostgreSQL and MySQL renderers/capabilities. PostgreSQL routine drops
  require identity arguments; trigger drops require the attached relation.
- Added a host same-dialect routine/trigger plan builder with identity
  matching, dependency-stable ordering, destructive approval, rollback SQL,
  and reviewed target object snapshots.
- Added `prepare_schema_routine_trigger_plan` IPC and the frontend command
  wrapper. Object DDL is fetched by the backend through the existing catalog
  contract; client SQL is never accepted.
- Cross-dialect, SQLite, unsupported object kinds, missing/ambiguous metadata,
  invalid identifiers, and malformed object DDL fail closed.

## Commit

`PENDING` until the commit is created below.

## Self-validation

- `cargo test -p datazen-driver-api --lib`: 142 passed.
- `cargo test -p datazen-driver-postgres --lib`: 119 passed.
- New PostgreSQL routine/trigger renderer tests: 2 passed.
- New MySQL routine/trigger renderer tests: 2 passed.
- `cargo check -p datazen --lib` with basic driver injection: passed (the
  build required a temporary ignored `src-tauri/resources/builtin-ep`
  directory; it was removed afterward).
- `git diff --check`: passed.

Host Schema Diff full tests and live database journeys remain for the
independent Tester. No UI picker was added in this slice; callers use the new
backend command with qualified object selectors.

The attempted Host object test run was interrupted by the coordinator's
收敛 instruction; it was not a test failure. Generated driver injection files,
`Cargo.lock`, `src-tauri/Cargo.toml`, and the temporary build resource
directory were restored/removed before commit.
