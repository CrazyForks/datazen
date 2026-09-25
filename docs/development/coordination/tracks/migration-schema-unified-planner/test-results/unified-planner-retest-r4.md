# Unified planner fresh re-test · round 4 · 2026-09-25

## Code review

- Reviewed coder commit `04b309cb` file by file. `value_as_ddl_text` is limited to DDL extraction and accepts `Value::Bytes` only when the complete byte sequence is valid UTF-8. It keeps the existing string conversion path for every other `Value`, and checked extraction still rejects absent, ambiguous, empty, and invalid-byte definitions. Public signatures and object-list parsing are unchanged. No code-review defect found.
- Unit-path coverage for the changed extraction logic is 3/3 branches (100%): valid UTF-8 bytes, invalid UTF-8 bytes, and the legacy `Value::String` fallback. The long multibyte and invalid-byte cases are in `checked_ddl_decodes_only_valid_utf8_bytes`; the existing named-column test covers the string fallback. `cargo-llvm-cov` is unavailable here, so this is branch-by-branch test evidence rather than an LLVM line-coverage percentage for the whole file. Earlier track-wide line figures predate this fix and are not claimed for this round.

## Independent checks

- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-planner-verification`, branch `feature/migration-schema-unified-planner-verification`, HEAD `e5406c6f` (includes merge `4f370680` and fix `04b309cb`). `node_modules` is a physical directory whose real path is inside this worktree.
- `pnpm install --offline --frozen-lockfile` and `node scripts/generate-builtin-locales.mjs` passed.
- Driver API: 175/175 passed (coder reported 173/173; independent run found two additional tests in the merged branch).
- MySQL driver: 116/116 library tests and 15/15 non-ignored integration tests passed; 2 isolated-database tests were ignored, matching the coder report.
- Host `schema_diff::`: 204/204 passed (coder reported 195/195; independent run includes nine additional merged tests).
- Related Schema Diff Vitest: 87/87 across 10 files. `npx tsc --noEmit` passed.
- `git diff --check` and `rustfmt --check --edition 2021` for both changed Driver API Rust files passed. `cargo fmt --all -- --check` reports only the existing generated `src-tauri/src/driver_init.rs` order difference; that generated file is not part of the fix and is not tracked.

## Fresh app and WDIO

- Ran the required `pnpm tauri:build:webdriver` with `DATAZEN_DRIVERS=postgres,mysql,sqlite`, absolute worktree-local `CARGO_TARGET_DIR=.../target/cargo-unified-planner-tester`, `CARGO_INCREMENTAL=0`, and debug info disabled. It produced the rebuilt app binary and `DataZen.app`; the command exited 1 only in the final DMG bundling step, which is explicitly excluded by project policy and the user's instruction.
- The default sandboxed GUI launch aborted in AppKit before opening the WebDriver port. Re-running the already-built isolated app with approved local access opened port 49179; no rebuild was needed. WDIO used app data under `target/cargo-unified-planner-tester/wdio-r4-app-data`, with global worker database setup and teardown disabled. `.env` values were not printed.
- Added a Tester assertion requiring `get_object_ddl(view)` to return a non-empty string, so catalog visibility alone cannot pass the MySQL DDL regression.
- PostgreSQL positive deploy/readback: 1/1 passed. Direct Host view DDL length: 177 characters. Source and target cleanup: 0/0.
- PostgreSQL fail-closed unselected dependency: 1/1 passed; target remained empty. Source and target cleanup: 0/0.
- MySQL catalog smoke: 1/1 passed. Fresh IPC calls listed function, procedure, trigger, and view with exact `datazen_sync_mysql_src` schema identity (4/4 kinds); exact cleanup: 0/0.
- MySQL direct view DDL extraction passed: Host `get_object_ddl` returned 252 non-whitespace characters; raw `information_schema.VIEWS.VIEW_DEFINITION` was 886 characters.
- MySQL positive plan/deploy/readback: 0/1. Plan generation failed closed because the fixture uses source database `datazen_sync_mysql_src` and target database `datazen_sync_mysql_tgt`; the current planner deliberately refuses to rewrite object DDL across schema scopes without a verified renderer contract. No target write occurred and fixture cleanup was 0/0. This is the documented cross-schema product limitation and a mismatch with the required MySQL positive acceptance case; it is not a regression in BUG-005's DDL extraction.
- MySQL unselected-dependency rejection: 1/1 remained blocked with zero target objects and exact cleanup 0/0. The blocking diagnostic is the same cross-schema scope restriction, so this proves fail-closed behavior but does not independently prove the intended missing-table-dependency diagnostic for MySQL.
- Overall WDIO: 4 passing, 1 failing, from the complete `e2e/specs/schema-diff-unified-planner.ts` spec. All five random source/target fixture journeys asserted exact teardown counts of 0/0. The isolated app and WebDriver process were stopped after the run.

## Result

`BUG-005` is fixed: the live MySQL view is visible, direct Host DDL extraction returns non-empty text, and the API tests prove valid UTF-8 acceptance, invalid UTF-8 rejection, and string compatibility. `BUG-004` remains fixed. The required MySQL positive planner journey is blocked after extraction by the existing cross-scope DDL rewrite guard; this distinct acceptance gap is registered as `BUG-006` in `bugs/migration-schema-unified-planner-BUG-006.md`. The track stays `FAILED` / `TEST_FAILED` until MySQL positive deploy/readback and the independent fail-closed dependency case pass. No business code was changed in this Tester checkpoint.
