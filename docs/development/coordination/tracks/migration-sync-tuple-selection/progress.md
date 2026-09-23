# migration-sync-tuple-selection

Phase: PLANNED

- Task: Data Sync composite primary-key recordset ranges
- Branch: `feature/migration-sync-tuple-selection`
- Worktree: `.worktrees/datazen-migration-sync-tuple-selection`

## Scope

Extend Data Sync's bounded source recordset from one scalar key to a complete ordered composite primary-key tuple. Keep legacy scalar profile and IPC JSON compatible. Bind each component as a parameter; apply bounds to both compared tables under the existing symmetric filter contract; keep range predicates and stable keyset scan order consistent. Reject incomplete, reordered, nullable, unknown-type, or driver-specific tuple comparisons whose equality/order semantics are not proven. Preserve the current limit and boolean filter grouping behavior.

Implementation may touch `src-tauri/src/data_sync/filter.rs`, the Data Sync model and profile serialization, the Sync command/type contracts, and the recordset UI and focused tests. It must not modify `commands/sync/comparison_store.rs`, which is owned by the active store-recovery track.

## Acceptance criteria

- [ ] The new tuple range shape is unambiguous and backward-compatible with existing scalar records; scalar and tuple forms cannot be mixed.
- [ ] Bounds name every effective source primary-key column exactly once in declared order and contain one correctly typed, non-null component per key.
- [ ] Tuple predicate construction binds all values in deterministic order, uses the same key order as the source scan, and preserves filter `AND`/`OR` grouping.
- [ ] Reversed, empty, mismatched, incomplete, nullable, ambiguous, and unverified type/driver ranges fail before a reviewed plan can execute.
- [ ] Preview, profile round-trip, and immutable plan fingerprint behavior include the tuple columns, values, and inclusive endpoints.
- [ ] Rust tests cover two- and three-column keys, component typing, inclusive/exclusive endpoints, parameter ordering, legacy scalar compatibility, UI clearing/editing, invalid shapes, and fail-closed dialects.
- [ ] WDIO real-database journeys verify bounded Data Sync results and execution readback on PostgreSQL and MySQL; the independent Tester runs WDIO serially.
- [ ] Focused changed-core coverage reaches at least 80%, and Host Rust, frontend typecheck, relevant Vitest, formatting, and diff checks pass.

## E2E registration

- [ ] PostgreSQL composite-key range compare/review/execute and exact target readback.
- [ ] MySQL composite-key range compare/review/execute and exact target readback.
- [ ] Invalid tuple shape is rejected before target writes.

## Coder self-validation

Pending.

## Independent Tester

Pending fresh Tester. Review every changed implementation file, verify scalar compatibility and comparison semantics, run focused tests and serial WDIO journeys, measure changed-core coverage, and register any bugs before reporting.
