# migration-sync-disk-index

Phase: PASSED

## Scope

Replaced the large Data Sync ComparisonStore JSON file's full-deserialization page path with a process-local manifest plus per-table length-framed row files and row-offset indexes. The immutable plan, TTL/claim cleanup, signed cursor contract, inline small-comparison path, full load path, and execution semantics remain unchanged. No frontend files were changed.

## Implementation

- Comparisons at or below `COMPARISON_MEMORY_LIMIT` remain inline.
- Larger comparisons use a private unique `0700` directory, a `0600` manifest, and `0600` per-table row files. Each row is one length-prefixed JSON frame; the manifest records table metadata, operation/unchanged counts, row count and payload offsets.
- `ComparisonStore::summaries` reads manifest metadata and never deserializes row payloads. `load_table_page` validates ownership and bounds, opens only the requested table file, verifies the selected frames and seeks the requested row interval.
- `SyncPlanStore::issue` builds preview summaries from store metadata. `get_comparison_page` uses `summaries` plus `load_table_page`; it never calls full `load`.
- Full `load` still reconstructs the original `ComparisonResult`, validates manifest/trailing data, indexed offsets, frame lengths and every row file for execution/SQL generation.
- Drop, TTL cleanup, claim cleanup and indexed write errors remove the complete private directory. The indexed format is process-local and has no cross-process compatibility requirement.

## Self-validation

- `CARGO_TARGET_DIR=target/cargo-wt node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib commands::sync::comparison_store`: 7 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib commands::sync::`: 44 passed.
- `npx vitest run src/commands/__tests__/syncPlan.test.ts src/windows/data-sync/__tests__`: 9 files, 50 passed.
- `npx tsc --noEmit`: passed.
- `cargo fmt --all -- --check`: reports only the generated, ignored `src-tauri/src/driver_init.rs` ordering difference after driver injection; changed source files are rustfmt clean.
- `CI=true pnpm tauri:build:webdriver`: passed frontend build, Rust build with PostgreSQL/MySQL/SQLite/Redis injection, WebDriver debug build and macOS App/DMG packaging.
- Cargo.lock and generated driver files were restored after build commands.

## Tests added

- Large multi-table indexed page reads return only the target table and requested rows without incrementing the test-only full-load counter.
- Summary/page path, private permissions, full round-trip, unknown table, out-of-range page, zero-limit store API, manifest corruption, trailing manifest data, frame-length corruption, cleanup after Drop and cloned-owner cleanup are covered.

Coder self-validation is complete; this track is ready for an independent tester. It is not a PASSED verdict until independent testing is complete.

## BUG-001 fix loop (2026-09-20)

Independent testing found that changing a row frame's 8-byte length prefix while preserving total file length made `summaries()` succeed even though page/full-load rejected it. `validate_manifest` now verifies every indexed frame prefix and its seek/bounds without deserializing row payloads. The regression test asserts summary, page and full-load all fail closed and cleanup still removes the private directory.

Focused revalidation passed: driver-injected ComparisonStore 7/7, full `commands::sync::` 44/44, focused frontend 50/50 and TypeScript checking. Cargo.lock and generated driver files were restored. Formal packaging was not rerun in this fix loop because the change is confined to indexed row-file validation and the prior formal build remains valid for the unchanged UI/runtime path.

The earlier independent failure is superseded by this fix; the second independent tester result below closes that review gate.

## Second independent tester result (2026-09-20)

The second independent tester reran the required driver-injected suites on commit `7b64617e`: ComparisonStore 7/7, Sync plans 10/10 and all `commands::sync::` tests 44/44. The directed large-spill corruption path changed the first row frame's 8-byte little-endian length prefix without changing file length; `summaries()`, `load_table_page()` and `load()` all rejected the store with the indexed frame-length error. The same run confirmed the unmodified indexed store summary/page/full-load round trip, private 0700/0600 permissions, multi-table middle-page isolation, offset/limit bounds, zero-limit rejection, TTL/claim cleanup and clone/Drop cleanup through the focused store/plan tests.

The specified frontend regression files passed 39/39 tests and `npx tsc --noEmit` passed. A focused Vitest coverage invocation was not a meaningful changed-file coverage measurement because the project config instruments the entire frontend and enforces the global 80% threshold; it exited on the expected 1.5% global coverage while the same four test files passed. This track changes Rust only, so Rust coverage is represented by the focused unit-path execution and code review rather than a frontend coverage number. The coder's formal WebDriver packaging remains the applicable build evidence because the fix is Rust-only and the UI is unchanged; generated driver files were restored and the worktree is clean.

Phase: PASSED


## Independent tester result (2026-09-20)

The independent Rust and frontend suites passed: ComparisonStore 7/7, Sync plans 10/10, `commands::sync` 44/44, focused Data Sync frontend files 39/39, and `npx tsc --noEmit`. The existing multi-table indexed journey passed: a large spilled comparison returned an `orders` middle page without increasing `full_load_calls`, and full `load()` round-tripped the comparison. Private 0700/0600 permissions, clone/Drop cleanup, TTL/claim cleanup, unknown table, out-of-range offset, zero-limit behavior and cursor lifecycle were reviewed and covered by the focused tests.

A directed corruption test reproduced `migration-sync-disk-index-BUG-001`: after changing a row frame length prefix without changing file length, `load()` and `load_table_page()` fail closed, but `summaries()` succeeds because it does not validate the indexed frame prefix. This violates the requested manifest/frame corruption contract. No production code was changed by the tester.

Phase: FAILED before the BUG-001 fix; superseded by the fix loop below. Formal WebDriver packaging was not rerun because the coder-recorded formal build covers the unchanged UI/runtime path; the focused Rust and frontend suites were rerun independently.
