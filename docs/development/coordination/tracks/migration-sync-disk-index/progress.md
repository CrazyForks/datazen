# migration-sync-disk-index

Phase: READY_FOR_TEST

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
