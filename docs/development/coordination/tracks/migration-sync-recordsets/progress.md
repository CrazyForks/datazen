# Data Sync stable recordset track

Phase: READY_FOR_TEST
Branch: `codex/migration-sync-recordsets`
Worktree: `.worktrees/datazen-migration-sync-recordsets`

## Scope

Data Sync now supports a reviewed, typed row range per matched table. The
recordset is carried inside the existing structured source scope, so the
immutable comparison plan fingerprint includes the order column, inclusive or
exclusive bounds, and limit. The same scope is applied to source and target
keyset pages during comparison; execution and SQL preview continue to consume
only the server-owned reviewed plan.

The range is deliberately fail-closed to one primary-key column. An omitted
`orderBy` is accepted only for a table with one effective primary key; an
explicit order must name a primary-key column. Composite-key tables may choose
one primary-key column for a bounded range while keyset paging still orders by
the complete composite tuple. Non-key ordering, missing keys, reversed or
empty bounds, integer overflow, invalid limits, and unsupported values are
rejected before a query.

The UI exposes start/end bounds, endpoint inclusivity, and a maximum row count
from the Sync mapping step. Bound text remains lossless until the server
converts it against the inspected source type. Editing filters preserves an
active recordset; clearing the range removes only the recordset scope.

## Self-validation

- Injected Host `data_sync::filter`: **9 passed**.
- Injected Host `commands::sync::plans`: **16 passed**.
- Injected Host `commands::sync`: **50 passed**.
- Frontend Sync/Transfer regression suites: **71 passed**; recordset editor
  tests cover lossless bounds, primary-key choices, clearing bounds, and
  rejecting zero, decimal, and unsafe limits.
- `npx tsc --noEmit`: passed after generating the ignored locale artifact.
- `cargo fmt --all`: passed through the driver injection wrapper; generated
  driver files and Cargo dependency injection were restored.
- `git diff --check`: passed.

## Remaining release gates

An independent Tester must review the comparison/plan execution path, rerun
the formal WebDriver build, and verify a live PostgreSQL/MySQL journey when
credentials are available. This track does not add row-range resume
checkpoints, arbitrary non-key ordering, or tuple bounds across composite
keys.
