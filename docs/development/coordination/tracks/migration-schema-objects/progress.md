# migration-schema-objects

## Phase

FAILED

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

## Independent tester 1 — 2026-09-21

- A. Reviewed the complete `4c35307c` diff. The same-dialect view planner, destructive approval gate, renderer quoting/rollback, cross-dialect fail-closed behavior, SQLite replacement rejection, duplicate/invalid identity checks, reviewed target snapshots, IPC registration, object SQL queries and frontend wrapper are present. No generated files or business implementation files were changed by this tester.
- B. Independently reran the focused suite: Driver API schema migration 6/6 and schema objects 5/5; PostgreSQL object SQL 6/6 and migration 12/12; MySQL object SQL 5/5 and migration 11/11; SQLite migration 6/6 and object SQL 4/4; Host schema_diff 84/84; Vitest 15/15; TypeScript and rustfmt checks passed; `git diff --check` passed. Full Host lib had 1578 passed, 52 unrelated wiremock port-binding failures, and 3 ignored.
- C. Added a real SQLite schema-object command journey covering view listing and multiline `AS` extraction. The regression fails with actual `ATE VIEW active_rows AS\\nSELECT id\\nFROM source_rows`, proving the query-body extraction bug. Frontend changed-file V8 coverage is `schemaDiff.ts`: 100% lines, 100% statements, 100% functions, 84.21% branches. Rust coverage instrumentation is unavailable in this environment; focused Host/driver paths and review cover the changed Rust logic except for the reported failing SQLite branch.
- D. `TEST_FAILED`; see `migration-schema-objects-BUG-001`. The exact SQLite object-command suite is 2 passed / 1 failed after adding the regression. Cargo injection left a `Cargo.lock` redis dependency line; it was removed, and the only remaining worktree change is the tester regression plus this progress/bug record.

## Independent tester 2 — 2026-09-21

- BOOTSTRAP: worktree `/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-objects`, branch `feature/migration-schema-objects`, coder fix `42c600cc`, initially clean.
- A. Reviewed the `42c600cc` SQLite SQL change and test expansion. The normalization handles LF, lowercase `as`, spaces, and tabs, but its fixed `+ 4` extraction offset is incorrect for a CRLF separator after `AS`.
- B. Re-ran the SQLite schema-object command suite: 3/3 passed before the new CRLF coverage; after adding the independent variant journey, 3/4 passed and `test_tester_round2_view_ddl_preserves_single_line_and_spacing_variants` failed with actual `\\nSELECT id\\r\\nFROM source_rows`. SQLite object SQL: 4/4 passed. Driver API migration: 6/6; API type-parts focused: 6/6; API schema objects: 5/5; PostgreSQL migration: 12/12; MySQL migration: 11/11; SQLite migration: 6/6; PostgreSQL object SQL: 6/6; MySQL object SQL: 5/5.
- C. Added a real SQLite integration journey covering uppercase single-line `AS`, extra spaces, CRLF, exact body preservation, and the absence of `ATE VIEW`. The non-CRLF variants pass; CRLF exposes `migration-schema-objects-BUG-002`. Rust coverage instrumentation remains unavailable; changed Rust paths are covered by focused tests except the failing CRLF branch.
- D. `TEST_FAILED`; see `migration-schema-objects-BUG-002`. All remaining host/frontend/check commands completed successfully: Host `schema_diff` 84/84 through the driver-injection wrapper; Vitest `schemaDiff.test.ts` 15/15; V8 coverage for `src/commands/schemaDiff.ts` was 100% statements, 84.21% branches, 100% functions, and 100% lines; `npx --no-install tsc --noEmit`, rustfmt `--check` on all changed Rust files, and `git diff --check` passed. Rust line/branch coverage instrumentation was unavailable because `cargo-llvm-cov` is not installed. The diff contains only this track's implementation/test files plus the track records; generated files and `Cargo.lock` were restored clean.

## Known limits

- This slice is views only. Routines, triggers, sequences, CHECK constraints, table options, drop-table semantics, and object dependency ordering remain later work.
- View migration is intentionally same-dialect only; translating referenced relation/type syntax across database families requires a driver-owned dependency contract.
- View definitions containing semicolons are rejected before rendering to preserve one reviewed statement per operation; definitions requiring multi-statement setup are unsupported.
- No live PostgreSQL/MySQL desktop journey was run in this coder wave. Independent Tester must verify the exact IPC/deploy path against isolated databases and inspect the generated body-DDL queries.

## Commit

- Coding commit: final SHA is recorded in the READY_FOR_TEST handoff.
