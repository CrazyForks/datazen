# migration-sync-store-add-table

Phase: PLANNED

- Task: Preserve non-empty rows in the one-shot comparison-store writer API
- Branch: `feature/migration-sync-store-add-table`
- Worktree: `.worktrees/datazen-migration-sync-store-add-table`

## Scope

`StreamingComparisonStoreWriter::add_table` currently delegates to `begin_table`, which clears `TableResult.rows`, and then finalizes without writing those rows. The existing apply caller supplies inspection-only mappings with empty rows, so current journeys do not lose comparison changes. Make the one-shot writer preserve row-bearing `TableResult` inputs, including unchanged counts and computed insert/update/delete counts, without cloning the row collection or weakening the streaming store's failure behavior.

## Acceptance criteria

- [ ] A non-empty `TableResult` passed to `add_table` round-trips every row and its metadata in the same order through inline and disk-backed stores.
- [ ] Insert/update/delete/unchanged counts and `unchanged_count` remain correct; selected state, keys, row images, warnings, and source filters are preserved.
- [ ] `add_table` consumes/moves its input rows rather than creating a second full copy; partial write failures abort and never publish a runnable store.
- [ ] Empty-table behavior and the current inspection-only `apply.rs` caller remain unchanged.
- [ ] Focused Host tests, full serial Host Rust tests, changed-core line coverage ≥80%, scoped rustfmt, and `git diff --check` pass.

## E2E

No UI or driver behavior changes. Rust writer tests provide direct coverage of the storage contract and failure lifecycle; no WDIO journey is applicable.

## Coder self-validation

Pending.

## Independent Tester

Pending fresh Tester. Independently review the writer contract, add focused coverage if needed, measure changed-core coverage, and rerun the focused and full Host suites. Do not change production implementation.
