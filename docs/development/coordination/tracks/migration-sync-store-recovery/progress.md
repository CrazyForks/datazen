# migration-sync-store-recovery

Phase: PASSED

Implementation commit: `054fbb7d` (`feat(data-sync): recover comparison stores after process exit`).

## Scope

Safely reclaim orphaned Data Sync comparison-store directories left when DataZen exits before Rust `Drop` runs. Cleanup must prove an entry is stale and must never delete a store held by another live process. Keep private directory/file permissions and avoid following symlinks or deleting unrelated files under the temp root.

Harden the write lifecycle for disk pressure: partial row/index/manifest writes must surface an actionable error, remove the incomplete store, and never publish a runnable plan. Do not introduce an arbitrary small comparison-size cap; use an existing product limit if one exists, or document the concrete capacity policy and its tradeoff before implementing a new limit.

## Acceptance criteria

- [x] First-use scavenging reclaims only marked stores whose SQLite owner lease can be acquired exclusively; an active cross-process owner keeps its store.
- [x] Cleanup scans only direct children of the private Data Sync temp root, reads at most 256 bytes per owner marker, uses a zero-wait lease probe, rejects symlinks/unrecognized entries, and continues after per-entry errors. Removal work is proportional to the contents of a positively identified stale store; no comparison-size cap was added.
- [x] Tests cover stale owner recovery, an active second owner during scavenging, malformed/unrecognized entries, cleanup errors, and refusal to delete paths outside the store root.
- [x] Injected partial row, index, and manifest failures return storage-specific errors, remove the incomplete directory best-effort, and leave `finish()` unable to publish a `ComparisonStore`.
- [x] Existing format, indexed paging, cloned ownership, cleanup-on-drop, and streaming regression tests pass; full Host tests also pass.
- [x] No production `unwrap()`/`expect()` was added. Store file handles close before removal for Windows compatibility. Windows runtime testing was unavailable in this environment; cross-process lease behavior was exercised on the current host.

## E2E registration

- [x] Lifecycle journey covered by child-process Rust tests: a live peer's store survives scavenging; after forced child termination without Rust `Drop`, its store is reclaimed. Recovery is a backend first-use path with no separate UI startup contract, so no WDIO journey was added.
- [x] Disk-pressure/fault journey covered by Rust failpoints for partial row/index/manifest writes; errors prevent `finish()` from returning a store and incomplete private data is removed.

## Self-validation

- `rustfmt --edition 2021 --check src-tauri/src/commands/sync/comparison_store.rs src-tauri/src/commands/sync/comparison_store/disk.rs src-tauri/src/commands/sync/comparison_store/recovery.rs src-tauri/src/commands/sync/comparison_store/tests.rs` — passed.
- `git diff --check` — passed.
- `CARGO_TARGET_DIR=target/cargo-wt CARGO_BUILD_JOBS=1 cargo test -p datazen --lib commands::sync::comparison_store::tests -- --test-threads=1` — 22 passed.
- `CARGO_TARGET_DIR=target/cargo-wt CARGO_BUILD_JOBS=1 cargo test -p datazen --lib -- --test-threads=1` — 1,819 passed, 3 ignored, 0 failed. The serial run used approved local loopback test access for unrelated tunnel/listener fixtures.
- `npx tsc --noEmit` — passed.
- `npx vitest run` — 482 files, 4,986 tests passed. ErrorBoundary tests print their expected render-failure fixture logs.

## Independent Tester

- Phase: `TEST_DONE`.
- Tester commit: recorded in this report commit.
- Review: no new production security defect found in the recovery change. The owner lease is held by SQLite `BEGIN EXCLUSIVE`; the probe has a zero-wait timeout and reclaims only after it can acquire the same lease. Recovery checks real direct-child directories, canonical owner/store UUIDs, and a bounded matching marker before removing anything. Malformed, missing, oversized, symlinked, or mismatched markers and absent/empty/corrupt/symlinked leases fail closed. The injected partial row/index/manifest paths close handles, delete the unpublished store, preserve the first error, and make later writer operations fail.
- Cleanup contract: Rust documents that `std::fs::remove_dir_all` does not follow symlinks and removes a symlink itself; most platforms also protect against symlink TOCTOU races, with Miri, QNX, Redox OS, and VxWorks exceptions. See [Rust `remove_dir_all` documentation](https://doc.rust-lang.org/std/fs/fn.remove_dir_all.html). This contract is separate from runtime testing: the current macOS host verified that an outside symlink target survives cleanup; Windows was not available for an execution test. Explicit row/index handle closure before cleanup was reviewed and the lifecycle tests pass on macOS.
- Tester-only regression tests added in `comparison_store/tester_recovery_tests.rs`: abrupt child termination, root/marker/lease symlinks, oversized marker, invalid lease states, unreadable store root, outside-root and foreign-owner cleanup, `NotFound` cleanup continuation, all mutation counters, inline paging bounds, writer state failures, partial index-file creation, and manifest creation failure.
- Focused `commands::sync::comparison_store::tests`: 35 passed, 0 failed.
- Full serial Host Rust suite on the final Tester tree: 1,832 passed, 3 ignored, 0 failed. Command: `RUST_TEST_THREADS=1 cargo test -p datazen --lib -- --test-threads=1`; the suite used approved local loopback access.
- Changed-core Rust line coverage, measured with stable `-C instrument-coverage`, `llvm-profdata merge`, and `llvm-cov report` over the full Host run: `comparison_store.rs` 82.02%, `disk.rs` 82.67%, and `recovery.rs` 80.05%. Tester test files: `tests.rs` 97.49%, `tester_recovery_tests.rs` 98.86%. Branch counters are unavailable in this rustc/llvm-cov report; these are line-coverage figures.
- Scoped rustfmt checks for the four implementation files and both test files passed; `git diff --check` passed. Repository-wide `cargo fmt --all -- --check` still reports ordering in generated, gitignored `src-tauri/src/driver_init.rs`; no generated file was edited or added to this track.
- No UI surface changed; no WDIO journey was applicable. No production `unwrap()`/`expect()` was added by this track.
- Independent scope note: `bugs.md` records a pre-existing `StreamingComparisonStoreWriter::add_table` API contract gap. The current `apply.rs:204` caller receives mappings from `inspect_data_sync_impl`/`classify_tables`, which constructs results with empty `rows`; this recovery journey does not drop business comparison rows. A caller passing a non-empty `TableResult` to `add_table` would lose those rows. This is separate from recovery and tracked as a follow-up, not a recovery test failure.
