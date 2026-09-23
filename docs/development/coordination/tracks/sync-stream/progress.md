# sync-stream

Phase: READY_FOR_TEST

## Scope

Make Data Sync SQL preview and execution consume a persisted `ComparisonStore`
through bounded table pages. Keep the 64 MiB full-load compatibility guard and
all manifest validation fail-closed behavior unchanged.

## Implementation notes

The existing paged review path already reads indexed row files. The remaining
callers in the plan SQL/execute path now use manifest summaries and bounded
500-row reads. Selection membership and table-level scopes are validated by a
single-page-at-a-time scan; selected pages are sent to the existing SQL
generator and released before the next page. Schema fingerprinting and profile
selection use metadata summaries, so neither SQL preview nor execution calls
`ComparisonStore::load()`.

The public SQL preview contract still returns `Vec<SqlStatement>`, so generated
SQL remains accumulated for the caller. The retained `ComparisonStore::load()`
compatibility path and its 64 MiB fail-closed ceiling are unchanged. Manifest,
frame, index and operation-count validation continues to run before page data
is exposed.

## Commit

Pending commit hash.

## Verification

- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib commands::sync:: -- --test-threads=1`: **59 passed**.
- `rustfmt --edition 2021 --check src-tauri/src/commands/sync/plans.rs src-tauri/src/commands/sync/exec.rs`: passed.
- `git diff --check`: passed.
- `node node_modules/vitest/vitest.mjs run src/commands/__tests__/syncPlan.test.ts src/windows/data-sync/__tests__`: **10 files, 63 passed**.
- `node node_modules/typescript/bin/tsc --noEmit`: passed.

The worktree has no `node_modules/.bin/vitest` shim, so the requested `npx vitest`
form attempted an unavailable registry lookup; the bundled Vitest CLI produced
the same focused result above without network access.
