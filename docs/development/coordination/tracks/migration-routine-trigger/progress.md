# migration-routine-trigger

Phase: READY_FOR_RETEST

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

`add22767` (base implementation); current `HEAD` contains the BUG-002/003 fix
and is `READY_FOR_RETEST`.

## Self-validation

### BUG-002/003 修复（当前提交）

- `cargo test -p datazen-driver-api --lib schema_migration::type_parts_tests`:
  10 passed, including the exact declaration-name regression.
- PostgreSQL routine renderer identity regression: 1 passed; MySQL routine
  renderer identity regression: 1 passed.
- Injected Host Schema Diff overload regression:
  `test_tester_overloaded_routine_definition_must_match_requested_signature`:
  1 passed.
- `cargo fmt --all -- --check` and `git diff --check` passed after formatting
  with temporary driver injection; generated driver files and `Cargo.lock` were
  restored afterward.

The independent Tester should re-run the BUG-002 and BUG-003 cases before
merging. Scope remains PostgreSQL/MySQL same-dialect routine/trigger identity
validation; no sequence, view, or table-option work was added.

- `cargo test -p datazen-driver-api --lib schema_migration::type_parts_tests`: 9 passed.
- The BUG-001 regression and related validator tests pass.
- `cargo test -p datazen-driver-postgres --lib`: 119 passed.
- New PostgreSQL routine/trigger renderer tests: 2 passed.
- New MySQL routine/trigger renderer tests: 2 passed.
- `cargo check -p datazen --lib` with basic driver injection: passed (the
  build required a temporary ignored `src-tauri/resources/builtin-ep`
  directory; it was removed afterward).
- `git diff --check`: passed.

## BUG-001 fix validation

- PostgreSQL routine renderer regression: 1 passed.
- MySQL routine renderer regression: 1 passed.
- `cargo fmt --all -- --check`: passed after the final fix.
- `git diff --check`: passed after the final fix.

Host Schema Diff full tests and live database journeys remain for the
independent Tester. No UI picker was added in this slice; callers use the new
backend command with qualified object selectors.

The attempted Host object test run was interrupted by the coordinator's
收敛 instruction; it was not a test failure. Generated driver injection files,
`Cargo.lock`, `src-tauri/Cargo.toml`, and the temporary build resource
directory were restored/removed before commit.

## Independent tester verification

- Reviewed every implementation file in `add22767` and the readiness note in
  `17de93e8`. The public IR, renderer capabilities, reviewed snapshots, IPC
  registration, and TypeScript wrapper are connected consistently. The
  existing selector test still referenced the renamed helper and the new
  planner test undercounted its additive trigger creation; both were
  corrected as tester-only test changes.
- Added tester coverage for exact PostgreSQL overload selection and trigger
  attached-relation selection, plus the frontend routine/trigger IPC wrapper
  payload. These paths preserve full identities and the destructive choice.
- Driver API: 142 existing tests passed; the new tester regression test
  fails, proving BUG-001 below. PostgreSQL driver: 121 passed. MySQL driver:
  102 passed. Focused migration renderer subsets passed 19/19 on each driver.
- Injected Host Schema Diff suite: 104 passed. Schema Diff command wrapper
  Vitest: 17 passed. `npx tsc --noEmit`, `cargo fmt --all -- --check`,
  Prettier checks, and `git diff --check` passed after the test-only changes.
- Rust does not have an instrumented coverage gate. The planner/renderer
  branches for create, replace, drop, destructive gating, same-dialect
  rejection, SQLite rejection, overload identity, and trigger relation
  identity are exercised by the focused suites. The repository coverage
  configuration intentionally excludes thin `src/commands/**` wrappers; the
  added wrapper test invokes every new wrapper statement and payload field.

## Second independent tester verification

- Reviewed the BUG-001 fix and the routine/trigger creation, replacement,
  drop, rollback, destructive gate, target snapshot, IPC wrapper, and
  fail-closed paths. The declaration-kind fix correctly rejects view-shaped
  DDL with routine/trigger words in literals, comments, or backtick-quoted
  content. Valid PostgreSQL `CREATE OR REPLACE` and MySQL `DEFINER`
  routine/trigger declaration envelopes remain accepted.
- Added tester-only regressions for two independent identity checks: a
  requested routine name that appears only in a body/comment, and a selected
  PostgreSQL overload whose DDL declares different arguments. Both tests fail
  and are registered as BUG-002 and BUG-003.
- Driver API full suite: **143 passed, 1 failed** (BUG-002). PostgreSQL driver
  full suite: **121 passed**. MySQL driver full suite: **102 passed**.
  Injected Host Schema Diff suite: **104 passed, 1 failed** (BUG-003).
- Frontend Schema Diff command wrapper: **17 passed**. Dedicated wrapper
  coverage is **100% statements, 86.95% branches, 100% functions, 100%
  lines**; it is intentionally excluded from the repository-wide gate as a
  thin IPC wrapper. `npx tsc --noEmit`, Prettier, Rust formatting, and diff
  checks passed after generating and then cleaning test-only driver injection
  artifacts.
- Live database E2E was not run because the two unit-level identity blockers
  would permit unsafe reviewed plans. The registered journeys stay pending
  until both defects are fixed and independently retested.

## E2E registration

| Case | Journey | Status |
| --- | --- | --- |
| RT-001 | PostgreSQL source/target fixtures with overloaded functions: select `public.lookup(integer)`, review a replacement plan, deploy, and verify only that overload changed. | 留待 BUG-002/003 修复后 R 回归 |
| RT-002 | PostgreSQL source/target fixtures with same-name triggers on different relations: select `public.audit ON public.orders`, approve destructive target-only removal, and verify the reviewed target snapshot blocks an out-of-band change. | 留待 BUG-002/003 修复后 R 回归 |
| RT-003 | MySQL source/target function, procedure, and trigger fixtures: create, replace, and approved drop; verify definition and rollback SQL on the target. | 留待 BUG-002/003 修复后 R 回归 |

No routine/trigger picker is present in this slice, so these are backend
command/integration journeys rather than an existing Schema Diff window path.
