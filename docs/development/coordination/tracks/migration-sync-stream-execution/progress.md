# migration-sync-stream-execution

Phase: PLANNED

## Scope

Remove the second full materialization of a large Data Sync plan during execution. The existing review store is paged and disk-backed, but plan execution currently accumulates a full `Vec<SqlStatement>` and uses a 64 MiB full-load ceiling.

Keep one target transaction for the whole selected plan. Generate and execute a bounded page at a time without calling `ComparisonStore::load()` or retaining all generated statements. Preserve plan and selection revision checks, conflict policy, snapshot validation, statement ordering, cancellation, and known/unknown rollback outcomes. The current full SQL-preview IPC remains bounded and must continue to explain its limit clearly.

## Acceptance criteria

- [ ] The production execute path consumes selected comparison pages incrementally and its working set is bounded by a comparison page plus one generated statement batch.
- [ ] No complete `ComparisonResult` or complete `Vec<SqlStatement>` is constructed for production execution; the 64 MiB full-load limit no longer blocks execution.
- [ ] A single transaction still spans the complete run; later-page generation/execute failure or cancellation rolls back earlier pages and reports known/unknown outcome accurately.
- [ ] SQL preview still uses the immutable plan and selected rows, preserves current ordering, and fails closed with a clear size message instead of allocating an unbounded IPC payload.
- [ ] Tests cover a synthetic plan larger than the former limit, page-boundary ordering, cancellation/error after a prior page, conflict rollback, and proof that execution never full-loads the store.
- [ ] Host and PG/MySQL WDIO journeys validate actual writes and rollback/read-back behavior; record any unavailable live fixture explicitly.

## E2E registration

- [ ] Data Sync large-plan streaming execution: 【本机可执行】 using the existing WDIO migration fixture; create enough changed rows to exceed the former materialization limit, execute, and verify target counts and sampled values.
- [ ] Mid-run cancellation/late-page failure rollback: 【本机可执行】 when the driver fixture can inject a deterministic failure; otherwise register 【留待 R 回归】 with exact fixture requirements.

## Self-validation

- Pending Coder.

## Independent Tester

- Pending fresh Tester; review every changed file, assess changed-core coverage (target at least 80%), rerun all checks and WDIO cases, and register all bugs before reporting.
