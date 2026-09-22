# migration-routine-trigger

Phase: FAILED

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

`add22767` (amended once to record the final commit hash).

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

## E2E registration

| Case | Journey | Status |
| --- | --- | --- |
| RT-001 | PostgreSQL source/target fixtures with overloaded functions: select `public.lookup(integer)`, review a replacement plan, deploy, and verify only that overload changed. | 留待 BUG-001 修复后 R 回归 |
| RT-002 | PostgreSQL source/target fixtures with same-name triggers on different relations: select `public.audit ON public.orders`, approve destructive target-only removal, and verify the reviewed target snapshot blocks an out-of-band change. | 留待 BUG-001 修复后 R 回归 |
| RT-003 | MySQL source/target function, procedure, and trigger fixtures: create, replace, and approved drop; verify definition and rollback SQL on the target. | 留待 BUG-001 修复后 R 回归 |

No routine/trigger picker is present in this slice, so these are backend
command/integration journeys rather than an existing Schema Diff window path.
