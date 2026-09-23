# migration-sync-tuple-selection

Phase: READY_FOR_TEST

- Task: Data Sync composite primary-key recordset ranges
- Branch: `feature/migration-sync-tuple-selection`
- Worktree: `.worktrees/datazen-migration-sync-tuple-selection`
- Baseline: `a089e677`

## Scope

Extend Data Sync's bounded source recordset from one scalar key to a complete ordered composite primary-key tuple. Keep legacy scalar profile and IPC JSON compatible. Bind each component as a parameter; apply bounds to both compared tables under the existing symmetric filter contract; keep range predicates and stable keyset scan order consistent. Reject incomplete, reordered, nullable, unknown-type, or driver-specific tuple comparisons whose equality/order semantics are not proven. Preserve the current limit and boolean filter grouping behavior.

Implementation is isolated to this track's Data Sync recordset/filter/planning/apply contract, UI, focused tests, WDIO journey, and this progress file. It does not modify `commands/sync/comparison_store.rs`, Schema Diff, `hub.md`, or the total plan.

## Acceptance criteria

- [x] The tuple range shape is unambiguous and backward-compatible with existing scalar records; scalar and tuple forms cannot be mixed.
- [x] Bounds name every effective source primary-key column exactly once in declared order and contain one correctly typed, non-null component per key.
- [x] Tuple predicates bind all values in deterministic order, use the same key order expressions as the source scan, and preserve filter `AND`/`OR` grouping.
- [x] Reversed, empty, mismatched, incomplete, nullable, ambiguous, and unverified type/driver ranges fail before a reviewed plan can execute.
- [x] Preview, profile round-trip, and immutable plan fingerprint behavior include tuple columns, values, and inclusive endpoints.
- [x] Rust tests cover two- and three-column keys, component typing, inclusive/exclusive endpoints, parameter ordering, legacy scalar compatibility, invalid shapes, and fail-closed ordering contracts; UI tests cover editing and clearing.
- [ ] WDIO real-database journeys verify bounded Data Sync results and execution readback on PostgreSQL and MySQL; the independent Tester runs WDIO serially.
- [ ] Changed-core coverage reaches at least 80%. No coverage executable is installed in this worktree (`cargo llvm-cov`, `grcov`, `cargo-tarpaulin`, `llvm-cov`, and `llvm-profdata` are unavailable); independent Tester/coordinator should measure coverage if their environment provides a tool.
- [x] Host Rust focused suites, frontend typecheck, relevant Vitest, changed-file formatting, and diff checks pass.

## E2E registration

- [x] PostgreSQL and MySQL composite-key compare/review/execute journey with exact target readback is registered.
- [x] Invalid tuple shape journey asserts rejection before target writes.
- [ ] WDIO execution is pending the independent Tester; Coder did not start WDIO.

## Coder self-validation

- `cargo test -p datazen --lib tuple`: 11 passed.
- `cargo test -p datazen --lib data_sync::filter::tests`: 14 passed.
- `cargo test -p datazen --lib commands::sync::`: 66 passed.
- `pnpm exec vitest run src/windows/data-sync/__tests__/RecordsetEditor.test.tsx src/commands/__tests__/syncPlan.test.ts`: 12 passed.
- `pnpm typecheck`: passed.
- `rustfmt --edition 2021 --check` on all changed Rust files and `git diff --check`: passed.
- `pnpm exec tsc --noEmit -p e2e/tsconfig.json`: fails on existing E2E-suite type issues in unrelated files; after correcting this journey's imports, it reported no diagnostics for `data-sync-tuple-range.ts`.
- WDIO was not run, per coordinator scheduling. Coverage was not measured because the listed coverage tools are unavailable.
- Source files are split by responsibility and stay under 800 lines: `filter.rs` 364, `recordset.rs` 486, `commands/sync/apply.rs` 771.

## Independent Tester

Pending fresh Tester. Review changed implementation, verify scalar compatibility and comparison semantics, run the registered PostgreSQL/MySQL WDIO journeys serially, measure changed-core coverage if tooling is available, and register any bugs before reporting.
