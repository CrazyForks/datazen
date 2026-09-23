# migration-sync-store-add-table

Phase: READY_FOR_TEST

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

- `node_modules` is a worktree-local directory (not a symlink); dependencies were installed independently before coding.
- `commands::sync::comparison_store::` focused Host tests: 37 passed, 0 failed.
- New one-shot round-trip and partial row/index write-failure tests: 2 passed, 0 failed.
- Final explicitly serial full Host Rust suite: 1847 passed, 0 failed, 3 ignored.
- LLVM line coverage for the changed core files: `comparison_store.rs` 82.32%; `comparison_store/disk.rs` 82.96%. The changed `add_table`, `finish_table`, and `write_row` functions measured 100%, 100%, and 95% line coverage; `validate_operation_counts` measured 96.49%.
- Scoped `rustfmt --check` and `git diff --check` pass.
- No WDIO journey applies: this is a storage-only Rust contract with no UI or driver behavior change.
- Coder implementation commit: `206e11cc` (`fix(sync): preserve rows in one-shot comparison store writes`).

## Caller inspection

The current `apply.rs` caller supplies results from `inspect_data_sync_impl`. That inspection calls `classify_tables`, which creates matched mappings with an empty row vector; this caller currently does not drop compared row changes. This track preserves the one-shot writer contract for row-bearing `TableResult` inputs without changing that inspection path.

## Independent Tester

Pending fresh Tester. Independently review the writer contract, add focused coverage if needed, measure changed-core coverage, and rerun the focused and full Host suites. Do not change production implementation.
