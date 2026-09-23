# migration-sync-tuple-selection

Phase: TEST_DONE

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
- [x] Independent Tester ran the PostgreSQL and MySQL real-database journeys serially; each verified invalid partial-key rejection before writes and exact bounded target readback.
- [x] Tester coverage measured `recordset.rs` 82.89%, `filter.rs` 82.70%, `filter_values.rs` 94.37%, `filter_validation.rs` 93.81%, and `RecordsetEditor.tsx` 89.09%. Whole-file unit-profile coverage was 78.65% for `apply.rs` and 66.67% for `keyset_source.rs`; their changed tuple paths passed WDIO but the app run was not coverage-instrumented.
- [x] Host Rust focused suites, frontend typecheck, relevant Vitest, changed-file formatting, and diff checks pass.

## E2E registration

- [x] PostgreSQL and MySQL composite-key compare/review/execute journey with exact target readback is registered.
- [x] Invalid tuple shape journey asserts rejection before target writes.
- [x] WDIO execution passed for PostgreSQL and MySQL in the independent Tester run.

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

## BUG-001 Coder fix — 2026-09-23

Restored `datazen::data_sync::filter::{SyncRecordset, SyncRecordsetBound}` with public re-exports from the new internal recordset module; existing `datazen::SyncRecordset` and `datazen::SyncRecordsetBound` root exports and tuple range types remain unchanged. Added a regression test that imports through the old module path and assigns the values to the root-exported types, locking the compatibility contract.

- `cargo test -p datazen --test data_sync_public_api`: 1 passed; the integration test imports the old paths from an external crate context and assigns both names to the root exports.
- `cargo test -p datazen --lib data_sync::filter::tests`: 14 passed.
- `cargo test -p datazen --lib commands::sync::`: 66 passed.
- `rustfmt --edition 2021 --check` for both changed Rust files and `git diff --check`: passed.
- No WDIO rerun is needed for this Rust-only re-export fix; the independent Tester already passed the unchanged PostgreSQL/MySQL tuple journeys.

## Independent Tester — 2026-09-23

Prior result: `TEST_FAILED` only for the public module-path regression filed as `migration-sync-tuple-selection-BUG-001` in `bugs.md`. The Tester reported the tuple feature's focused Rust suites, Vitest, typecheck, PostgreSQL/MySQL WDIO journeys, and core coverage results above. Tester fixes were not copied into this Coder worktree.

## Fresh independent Retester — 2026-09-23

- Reviewed the Coder fix: `filter` remains a public module and now re-exports both legacy types from `recordset`; root `data_sync` exports are unchanged. The integration test compiles in a separate crate context and assigns each legacy import to its root-exported counterpart.
- `cargo test -p datazen --test data_sync_public_api`: 1 passed.
- `cargo test -p datazen --lib data_sync::filter::tests`: 14 passed.
- `cargo test -p datazen --lib commands::sync::`: 66 passed.
- `pnpm exec vitest run src/windows/data-sync/__tests__/RecordsetEditor.test.tsx src/commands/__tests__/syncPlan.test.ts`: 2 files, 12 passed.
- `pnpm exec tsc --noEmit`: passed.
- Changed-file `rustfmt --check` and `git diff --check`: passed.
- The Rust change is limited to compile-time public re-export declarations, so runtime branch coverage is not applicable. The external-crate test directly compiles both restored names and verifies type identity with both root exports. Existing independent PostgreSQL/MySQL WDIO evidence remains valid because the fix does not change runtime behavior; no WDIO rerun was needed.
- No additional review findings. `migration-sync-tuple-selection-BUG-001` is closed after independent retest.
