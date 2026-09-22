# migration-sync-bounded

Phase: READY_FOR_TEST

## Scope completed

- Data Sync comparison now writes matched table metadata and each change row
  incrementally into a private framed row file while the keyset merge retains
  only the two driver pages and current row.
- The generated store uses a fixed width per table `.index` file. Manifest,
  summary, page and full-load validation stream index entries without retaining
  one offset entry per result row in host memory.
- Comparison writer Drop cleanup covers cancellation, comparison errors,
  row/index/manifest write failures and incomplete table finalization. Plan
  ownership still controls TTL/claim cleanup through `ComparisonStore`.
- The existing in-memory compare API and aggregate 10,000-row/32 MiB guard
  remain for compatibility tests. The live plan path uses the sink API and
  accepts larger change sets; per-driver page limits and row serialization
  checks remain fail-closed.
- SQL generation and execute compatibility paths still consume a complete
  server-owned comparison, with a 64 MiB full-load limit and an explicit
  fail-closed message. Review page IPC remains index/page bounded.

## Self-validation

- `cargo check -p datazen --lib` with independent `CARGO_TARGET_DIR=target/cargo-wt`
  and injected basic drivers: passed.
- `cargo test -p datazen --lib commands::sync::comparison_store::tests -- --test-threads=1`:
  8 passed.
- `cargo test -p datazen --lib data_sync::compare::tests`:
  18 passed, including the 10,001-row sink journey.
- `cargo test -p datazen --lib commands::sync::tests -- --test-threads=1`:
  25 passed.
- `npx vitest run src/commands/__tests__/syncPlan.test.ts src/windows/data-sync/__tests__`:
  10 files, 63 passed.
- `npx tsc --noEmit`: passed.
- `cargo fmt --all -- --check`: changed source files clean; only the generated,
  ignored `src-tauri/src/driver_init.rs` ordering differs after injection.
- `git diff --check`: passed.

Commit: pending final handoff.

## Limits not covered

The SQL preview and execute IPC still return/consume `Vec<SqlStatement>` and
therefore use the bounded full-load compatibility path. A future page-wise SQL
and transaction executor can remove the 64 MiB compatibility ceiling without
changing the immutable plan or selection contract.
