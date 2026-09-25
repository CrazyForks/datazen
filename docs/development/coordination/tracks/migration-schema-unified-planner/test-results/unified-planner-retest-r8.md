# Unified planner fresh re-test · round 8 · 2026-09-25

## Result

**TEST_FAILED — 5 of 6 unified-planner WDIO journeys passed.** BUG-009's MySQL table dependency catalog is independently verified through live IPC, its opt-in live Rust fixture, and the MySQL mixed-object plan/deploy/readback journey. BUG-008's ordinary-view path also passes live planning and readback. The `WITH CASCADED CHECK OPTION` journey still times out before reaching its blocker and explicit zero-write assertions, so BUG-007 remains open. Coverage is not yet at the conservative changed-module gate: `mysql_view_metadata.rs` measures 79.07% and the full `execute_object_dependencies` function 78.38%.

## Scope and environment

- Verifier worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-planner-verification`
- Branch and starting revision: `feature/migration-schema-unified-planner-verification`, `2e1a3fad` (contains product fix `b849a774`). Product implementation was not edited in this round.
- `node_modules` was already installed as a physical directory inside this worktree; it is not linked to the main checkout. The 13 pre-existing untracked root `.profraw` files were not read, overwritten, staged, or deleted.
- The local MySQL and PostgreSQL servers required the approved loopback retry after sandboxed connection attempts were denied. The live MySQL catalog test used only its guarded `datazen_test` database. WDIO used unique source/target fixture objects and a fresh app-data directory. `E2E_SKIP_WORKER_DATABASE=1` and `E2E_SKIP_TEARDOWN=1` were set, so the global E2E worker database setup/reset/teardown did not run. No black-box-tester was used.

## Focused checks and live MySQL fixture

- `cargo test -p datazen-driver-api --lib`: **182 passed**.
- `cargo test -p datazen-driver-mysql --lib`: **123 passed**.
- `cargo test -p datazen-driver-mysql --test schema_objects_sql`: **9 passed**.
- `cargo test -p datazen --lib schema_diff::`: **213 passed**.
- `pnpm exec vitest run src/windows/schema-diff`: **62 passed**.
- Prettier for both unified-planner WDIO specs and `git diff --check`: passed.
- The ignored MySQL dependency-catalog integration target was run against the allowlisted `datazen_test` database with the `MIGRATION_TEST_*` configuration and an isolated verifier-local Cargo target: **2 passed**. Both the view and table fixtures removed their exact objects; the table fixture verified source and temporary cross-schema object counts were zero. No unsupported-cross-schema setup was left behind.

## Fresh app build and WDIO

- Ran `pnpm tauri:build:webdriver` with `DATAZEN_DRIVERS=postgres,mysql,sqlite`, absolute verifier-local `CARGO_TARGET_DIR=.../target/cargo-unified-planner-tester`, `CARGO_INCREMENTAL=0`, and dev/test debug info disabled. The webdriver executable and `.app` compiled; exit status 1 came only from the final `bundle_dmg.sh` packaging step, which is excluded from this release gate.
- Started the fresh app with `DATAZEN_DATA_DIR=.../target/cargo-unified-planner-tester/wdio-r8-app-data`, file keyring, and isolated WebDriver port `49271`. The sandboxed bind was denied once; the approved retry with the same binary, app-data directory, and port reached `/status` with HTTP 200. WDIO stopped the app after the run.
- First ran the retained, opt-in `schema-diff-unified-planner-bug009-diagnostic.ts`: **1/1 passed**. Live IPC returned `complete=true` and no edges for the parent, and `complete=true` with the exact `{kind:"table", schema:"datazen_sync_mysql_src", name:<parent>}` edge for the child. A self-referencing FK was omitted as an intra-object edge. Cleanup verified exact source/target counts `0/0` and verified both temporary connection configs were removed, including through nested `finally` cleanup.
- Then ran all six cases in `schema-diff-unified-planner.ts`: **5 passed, 1 failed/not proven**. PostgreSQL positive deploy/readback and missing-dependency zero-write cases passed. MySQL mixed parent/child/view plan, deploy, readback, and target-side view `SELECT` passed. MySQL exact missing-dependency identity and zero-write case passed. MySQL four-kind function/procedure/trigger/view catalog smoke passed.
- The MySQL `WITH CASCADED CHECK OPTION` case timed out in `clickSchemaDiffGeneratePlan()` (`e2e/helpers.ts:2308`) while waiting for automatic plan generation (`等待结构对比计划自动生成超时`). It did not reach the requirements selector, empty-statements assertion, disabled-deploy assertion, or explicit target-count-zero assertion. No deploy was clicked. Teardown did run and verified exact `0/0` cleanup. This is **not** a pass for BUG-007. WDIO did not retain a screenshot or trace for this timeout; app output after stop contained only non-fatal SQL target parser warnings and no schema-diff error.

## LLVM coverage

Coverage used Rust 1.90 with `RUSTFLAGS='-Cinstrument-coverage -Ccodegen-units=1'`, `CARGO_INCREMENTAL=0`, and debug info disabled. All profiles and merged data were isolated below `target/cargo-unified-planner-coverage-r8`; only those profiles were merged with Apple LLVM 17 `llvm-profdata`/`llvm-cov`. One `functions have mismatched data` warning was reported by the Rust/system LLVM version mismatch. `cargo-llvm-cov` was unavailable. The webdriver app itself was not instrumented, so WDIO evidence is behavioral, not part of this coverage merge.

- Instrumented Driver API: **182/182**; MySQL library: **123/123**; MySQL `schema_objects_sql`: **9/9**; live MySQL catalog fixture: **2/2**; Host `schema_diff::`: **213/213**.
- `packages/driver-api/src/schema_object_commands/mysql_view_metadata.rs`: **136/172 executable lines (79.07%)**, below 80% for the full changed helper module. The changed body matcher is 14/15 (93.33%), relation visitor 12/12 (100%), metadata field extraction 13/14 (92.86%), and metadata-value matching 11/11 (100%). Remaining uncovered paths include missing catalog/SHOW fields, unsupported definers, empty source-database guard, unrecognized/conflicting CHECK OPTION metadata, and lexer escapes/doubled quotes/ordinary comments. The gate remains open; do not infer whole-module coverage from the changed matcher alone.
- `packages/driver-api/src/schema_object_commands.rs`: 79.32% across the whole file. The R8 LLVM line display shows zero executed counters for every executable statement in `execute_object_dependencies` (lines 351–441), including the MySQL instantiation; the prior 58/74 (78.38%) function figure could not be reproduced and is withdrawn. LLVM emitted mismatched-function-data warnings when combining the test binaries, so use this as an uncovered-path diagnostic, not as a corrected aggregate percentage. Untested paths include invalid kind (351–353), missing/blank name (354–360), unsupported kind/family dispatch such as MySQL triggers (375–399), query failure (405–407), malformed catalog output (408–423), and successful command/result assembly plus MySQL visibility checks (424–441). The MySQL table visibility helper is 9/10 (90%), with its query-error fail-closed branch uncovered. Add focused command-boundary tests before claiming this changed path meets the gate.
- `packages/driver-api/src/schema_dependencies/mysql.rs`: 99.52%; `src-tauri/src/schema_diff/unified.rs`: 82.66%. `src-tauri/src/commands/schema_diff.rs` is 53.88% for the whole file and is a broad existing command module, not treated as a changed-core pass.

## Fixture and artifact cleanup

- Every started WDIO fixture journey reported exact source and target post-teardown counts `0/0`; the dedicated BUG-009 diagnostic additionally confirmed both saved fixture connections were removed. The opt-in MySQL Rust fixture verified its exact table/view and temporary-schema cleanup before success.
- Deleted only the verifier-owned `target/cargo-unified-planner-tester` build target (about 4.1 GB) after the build/run to free disk for isolated coverage. The fresh webdriver executable and `.app` **no longer exist**. The separate coverage target remains under the verifier `target/`; `node_modules` and the 13 root `.profraw` files remain untouched.

## Release gate

- BUG-007: remains open; the check-option journey did not reach its required blocker and zero-write assertions.
- BUG-008: independently verified by successful ordinary MySQL view DDL retrieval, mixed plan/deploy/readback, target-side SELECT, and the existing exact-qualifier regression tests.
- BUG-009: independently verified for exact MySQL table dependency completeness, FK identity, safe self-edge omission, live catalog fixture cleanup, and the full MySQL positive planner journey.
- Unified planner acceptance: **5/6**; overall phase remains `FAILED`.
- Coverage: the full MySQL view metadata helper is 79.07%. The exact dispatcher function has zero recorded line hits in the R8 LLVM display, with profile mismatch warnings; the earlier 78.38% estimate is withdrawn. The conservative changed-core gate remains open. A subsequent focused instrumented Driver API run is planned after merging test-only coverage regression commit `dbcf8e32`.
