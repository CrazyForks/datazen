# migration-sync-store-recovery

Phase: READY_FOR_TEST

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

- [x] Lifecycle journey covered by a child-process Rust test: a live peer's store survives scavenging, then is reclaimed after process exit. Recovery is a backend first-use path with no separate UI startup contract, so no WDIO journey was added.
- [x] Disk-pressure/fault journey covered by Rust failpoints for partial row/index/manifest writes; errors prevent `finish()` from returning a store and incomplete private data is removed.

## Self-validation

- `rustfmt --edition 2021 --check src-tauri/src/commands/sync/comparison_store.rs src-tauri/src/commands/sync/comparison_store/disk.rs src-tauri/src/commands/sync/comparison_store/recovery.rs src-tauri/src/commands/sync/comparison_store/tests.rs` — passed.
- `git diff --check` — passed.
- `CARGO_TARGET_DIR=target/cargo-wt CARGO_BUILD_JOBS=1 cargo test -p datazen --lib commands::sync::comparison_store::tests -- --test-threads=1` — 22 passed.
- `CARGO_TARGET_DIR=target/cargo-wt CARGO_BUILD_JOBS=1 cargo test -p datazen --lib -- --test-threads=1` — 1,819 passed, 3 ignored, 0 failed. The serial run used approved local loopback test access for unrelated tunnel/listener fixtures.
- `npx tsc --noEmit` — passed.
- `npx vitest run` — 482 files, 4,986 tests passed. ErrorBoundary tests print their expected render-failure fixture logs.

## Independent Tester

- Pending fresh Tester; independently review stale-owner proof and path safety, measure changed-core coverage, rerun focused and full Host checks, and register all bugs before reporting.
