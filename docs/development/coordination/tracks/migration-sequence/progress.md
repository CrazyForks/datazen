# migration-sequence

## Phase

FAILED

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

## Independent Tester verification

- BOOTSTRAP: worktree `/Users/flyxl/code/datazen/.worktrees/datazen-migration-sequence`,
  branch `feature/migration-sequence`, clean before tester files; implementation
  under test is commit `572c0b25`.
- Phase A reviewed every changed implementation file in Driver API, PostgreSQL
  and MySQL migration, Host sequence objects/dependencies/operations/reviewed
  state/IPC/bootstrap, and the TypeScript wrapper/test. The planner is same-
  dialect and destructive-gated; target snapshots, one-shot plan IDs, replay,
  ambiguous DDL rows, and unsupported MySQL/SQLite/cross-dialect paths are
  fail-closed. BUG-001 and BUG-002 were found in the validator and rollback
  contract.
- Phase B independent suites:
  - Driver API: **147 passed, 0 failed**.
  - PostgreSQL driver: **124 passed, 0 failed**.
  - MySQL migration subset: **19 passed, 0 failed**.
  - SQLite migration subset: **10 passed, 0 failed**.
  - Injected Host `schema_diff`: **110 passed, 0 failed**, using
    `node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib schema_diff`.
  - TypeScript `npx tsc --noEmit`: passed.
  - Schema Diff wrapper Vitest: **18 passed, 0 failed**.
  - Changed Rust files: `rustfmt --edition 2021 --check ...` passed;
    `git diff --check` passed. Full `cargo fmt --all -- --check` only reported
    ignored generated `src-tauri/src/driver_init.rs` ordering/blank-line drift.
  - Full injected Host library: **1662 total, 1607 passed, 52 failed,
    3 ignored**. All 52 failures were wiremock AI tests failing before their
    assertions with `Failed to bind an OS port ... Operation not permitted`;
    no migration or Schema Diff test failed. This independently confirms the
    coder's sandbox-port limitation, with the corrected pass count 1607.
- Phase C added the tester-only integration crate under `tests/`. Its four
  sequence regression tests report **0 passed, 4 failed**, covering legal
  quote-ident names, quoted case identity, comment-like legal names, and
  replacement rollback completeness. The failures are recorded in bugs.md.
- Focused TypeScript V8 coverage for changed `src/commands/schemaDiff.ts` was
  **100% statements, 100% lines, 100% functions, 86.95% branches** across
  18 wrapper tests. The default repository-wide coverage command is not a
  meaningful changed-file metric because it instruments unrelated unimported
  modules and stops at its global threshold; the narrowed run passed.
- Required live PostgreSQL journeys are registered below and remain **【留待 R】**:
  create missing sequence; replace increment/cache/cycle and `OWNED BY`; approved
  destructive drop; stale target after prepare; replay after consume; quoted
  schema/name; ambiguous or missing catalog DDL; and cross-dialect/unsupported
  MySQL, SQLite, and unregistered-driver requests. No PostgreSQL fixture is
  available: `pg_isready` reports `/tmp:5432 - no response`, and `psql` cannot
  access the local socket (`Operation not permitted`).
- Verdict: **TEST_FAILED** for `migration-sequence-BUG-001` and
  `migration-sequence-BUG-002`; do not merge until a fresh Tester reruns the
  complete suite after repair.
