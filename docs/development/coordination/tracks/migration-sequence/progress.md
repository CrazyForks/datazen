# migration-sequence

## Phase

READY_FOR_TEST

## Scope

- PostgreSQL same-dialect Schema Diff sequence create, replace, and approved
  drop through server-side catalog snapshots and one-shot reviewed plans.
- All cross-dialect and unsupported-driver paths remain fail-closed.

## Working notes

- The branch starts from `d2b6cabd`, which includes the independently-tested
  routine/trigger object migration pattern used by this track.
- The existing generic object catalog already lists PostgreSQL sequences. This
  track will extend the migration IR, strict DDL validation, PostgreSQL
  renderer, reviewed snapshots, IPC wrapper, and focused tests without adding
  an unverified UI picker.

## Implementation

- Added `MigrationSequence` and sequence create/replace/drop operations to the
  driver API and Host operation graph, with schema-qualified identity checks.
- PostgreSQL catalog DDL now reads sequence type, increment, min/max, start,
  cache, cycle, and `OWNED BY` metadata from `pg_sequence`/`pg_depend`; the
  renderer validates the catalog script before emitting SQL.
- Added Host sequence snapshots/plans, dependency ordering, reviewed target
  snapshot validation, destructive drop/replace risks, bootstrap IPC command,
  and the qualified-selector TypeScript wrapper.
- MySQL and SQLite sequence operations fail closed through capabilities; source
  and target dialect mismatches, unsupported drivers, missing/ambiguous catalog
  rows, DDL/name mismatch, replay, and stale reviewed plans remain blocked.

## Self-check

- `cargo test -p datazen-driver-api --lib`: 147 passed.
- `cargo test -p datazen-driver-postgres --lib`: 124 passed.
- `cargo test -p datazen --lib schema_diff`: 110 passed.
- `npx vitest run src/commands/__tests__/schemaDiff.test.ts`: 18 passed.
- `npx tsc --noEmit`: passed.
- `cargo check -p datazen --lib`: passed with the independent target directory.
- Full `cargo test -p datazen --lib`: 1606 passed; 52 pre-existing AI/wiremock
  tests could not bind local ports in the sandbox (`Operation not permitted`).
