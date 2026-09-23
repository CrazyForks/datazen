# migration-sync-store-add-table

Phase: PASSED

- Task: Preserve non-empty rows in the one-shot comparison-store writer API
- Branch: `feature/migration-sync-store-add-table`
- Worktree: `.worktrees/datazen-migration-sync-store-add-table`

## Scope

`StreamingComparisonStoreWriter::add_table` currently delegates to `begin_table`, which clears `TableResult.rows`, and then finalizes without writing those rows. The existing apply caller supplies inspection-only mappings with empty rows, so current journeys do not lose comparison changes. Make the one-shot writer preserve row-bearing `TableResult` inputs, including unchanged counts and computed insert/update/delete counts, without cloning the row collection or weakening the streaming store's failure behavior.

## Acceptance criteria

- [x] A non-empty `TableResult` passed to `add_table` round-trips every row and its metadata in the same order through inline and disk-backed storage. The inline path preserves the reference value; the one-shot streaming writer persists and reloads the same row-bearing table.
- [x] Insert/update/delete/unchanged counts and `unchanged_count` remain correct; selected state, keys, row images, warnings, and source filters are preserved.
- [x] `add_table` consumes/moves its input rows rather than creating a second full copy; injected partial row-payload and row-index write failures abort and never publish a runnable store.
- [x] Empty-table behavior and the current inspection-only `apply.rs` caller remain unchanged.
- [x] Focused Host tests, full serial Host Rust tests, changed-core line coverage ≥80%, scoped rustfmt, and `git diff --check` pass.

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

### Result: TEST_DONE

- Tester review: `add_table` takes ownership of the input row vector with `std::mem::take`, streams each row through the framed-row/index writer, and uses checked accounting. It preserves the input table metadata and order, and combines the separate unchanged count with any unchanged row images. Manifest validation now verifies both sources of unchanged counts. Existing live `RowChangeSink` behavior still rejects indexed unchanged rows and records unchanged counts through its aggregate callback. The current `apply.rs` caller provides inspection-only mappings with empty row lists. No production defect found; no additional test was needed beyond the committed contract/failure tests, which cover all changed executable lines.
- Independent focused suite: `cargo test -p datazen --lib commands::sync::comparison_store:: -- --test-threads=1` — 37 passed, 0 failed.
- Independent full suite: `RUST_TEST_THREADS=1 cargo test -p datazen --lib -- --test-threads=1` under the approved local-loopback test permission — 1,847 passed, 0 failed, 3 ignored, 41.73s. The same command without the elevated permission had 1,761 passed and 86 unrelated AI/tunnel fixture failures because loopback `bind()` returned `PermissionDenied`; rerun with the minimum required permission passed.
- Independent coverage run: `LLVM_PROFILE_FILE=/tmp/datazen-add-table-%p.profraw RUSTFLAGS='-C instrument-coverage' cargo test -p datazen --lib commands::sync::comparison_store:: -- --test-threads=1` — 37 passed. Merged profiles with `xcrun llvm-profdata merge -sparse`; LLVM source line coverage: `comparison_store.rs` 82.32%, `comparison_store/disk.rs` 82.96%. All changed executable lines were hit: `comparison_store.rs` 28/28, `disk.rs` 10/10 (100% changed-line coverage). LLVM branch counters are unavailable in this toolchain report.
- `rustfmt --edition 2021 --check` over the three changed source/test files and `git diff --check 206e11cc..HEAD` — passed.
- No frontend or driver path changed, so no WDIO journey applies. The storage API and failure lifecycle are covered by Rust tests.
- Tester commit: recorded in this report commit.
