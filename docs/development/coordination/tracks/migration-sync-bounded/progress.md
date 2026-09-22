# migration-sync-bounded

Phase: FAILED

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

Implementation commit: `16e969f5` (`feat(sync): stream comparison rows into indexed store`).

## Limits not covered

The SQL preview and execute IPC still return/consume `Vec<SqlStatement>` and
therefore use the bounded full-load compatibility path. A future page-wise SQL
and transaction executor can remove the 64 MiB compatibility ceiling without
changing the immutable plan or selection contract.

## Independent tester result (2026-09-22)

- Code review covered `apply.rs`, `comparison_store.rs`, `plans.rs` and
  `data_sync/compare.rs`/`mod.rs`. The live sink, per-table framed rows and
  fixed-width index are bounded to the two driver pages plus the current row;
  writer Drop/claim/TTL cleanup and selection defaults/exclusions are wired as
  intended.
- Independent Rust suites passed: ComparisonStore 8/8 before tester additions,
  tester additions 5/5, `data_sync::compare` 18/18, complete `data_sync` 129/129,
  complete `commands::sync` 57/57, and the focused `commands::sync::tests` 25/25.
  The tester additions cover 0/1/10,001 streaming rows, index corruption,
  cancellation cleanup, unchanged-row sink rejection, and the 64 MiB full-load
  fail-closed path while leaving one-page review reads available.
- Independent frontend checks passed: focused Data Sync Vitest 10 files / 63
  tests and `npx tsc --noEmit`. `git diff --check` passed. `cargo fmt --all
  -- --check` reports only the known ordering difference in generated,
  ignored `src-tauri/src/driver_init.rs`; the changed source file was formatted
  directly and is clean. The escalated full Host Rust regression passed 1,661
  tests with 0 failures and 3 ignored; coverage instrumentation was not
  available in this checkout, so no numeric coverage percentage is claimed.
- No live PostgreSQL/MySQL service credentials or fixtures were available in
  this environment, so the real multi-page PG/MySQL journeys remain 【留待 R】.
- The explicit 64 MiB SQL preview/execute compatibility ceiling is accepted as
  a P2 follow-up limitation for this track: it fails closed before a complete
  `Vec<SqlStatement>` is built, while bounded review pages remain usable. It is
  not recorded as a defect in this bounded-generation wave.
- **TEST_FAILED:**
  `migration-sync-bounded-BUG-001` is recorded in `bugs.md`. Mutating only
  `manifest.json`'s `insertCount` makes `ComparisonStore::summaries()` return
  inconsistent metadata instead of rejecting the damaged store. No business
  code was changed by the tester.

## Real database journey registration (留待 R)

- **PostgreSQL multi-page journey — 【留待 R】**: provision same-family source
  and target fixtures with a composite primary-key table
  `(tenant_id, item_id)`, source rows `0..=10_000`, one target update, one target
  only row and one missing target row. Compare with `batchSize=1000`; verify the
  summary counts, first/middle/last cursor pages, repeated cursor idempotence,
  reverse/duplicate key rejection, one excluded key, generated SQL and the
  transaction result. Repeat with a cancelled compare and confirm the private
  store directory is removed.
- **MySQL/MariaDB multi-page journey — 【留待 R】**: repeat the same fixture with
  a binary/text key and the driver's native quoting/placeholder renderer;
  verify 0-row, 1-row and 10,001-row tables, framed page boundaries, selection
  defaults/exclusions, SQL preview/execute consistency, stale schema/active
  database rejection and one-shot claim replay rejection.
- These journeys could not run locally because the PG/MySQL fixture credentials
  and live service were unavailable; no fixture result is claimed by this
  tester.
