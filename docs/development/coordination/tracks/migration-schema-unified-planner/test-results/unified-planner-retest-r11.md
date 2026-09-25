# Unified planner fresh retest · round 11 · 2026-09-25

## Result

**TEST_DONE / PASSED.** The BUG-008 fix now normalizes MySQL's exact source-database qualifier in relation names, three-part column identifiers, and qualified wildcards without erasing external database identity. The focused CHECK OPTION case reached and asserted the metadata blocker, empty plan, disabled deploy, and zero target fixture objects. The full six-journey WDIO suite passed 6/6, and every fixture cleanup asserted exact source/target counts of `0/0`.

Independent Driver API unit coverage passed 198/198. Both changed core files exceed 80% line coverage: `schema_object_commands.rs` is 556/677 lines (82.13%) and `mysql_view_metadata.rs` is 274/334 lines (82.04%). The command file's region coverage is 78.04%; that separate below-80 region figure is reported without conflating it with the line-coverage gate.

## Scope and environment

- The fresh app was built in `/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-planner-verification`, branch `feature/migration-schema-unified-planner-verification`, at `cc280c5d`, which includes product fix `1369db7` via merge `ff1af3f9`. The later `c1d4a047` merge added only API coverage tests; production code did not change between the runtime build and the final coverage run at verifier HEAD `e3a1aa35`.
- `node_modules` is physical and worktree-local. No black-box-tester was used. The user-authorized local MySQL and PostgreSQL instances were used only for these isolated feature fixtures. `E2E_SKIP_WORKER_DATABASE=1` prevented global worker-database setup/drop; no shared database reset ran. Test fixture setup, teardown, and app data stayed isolated.
- The 13 pre-existing root `.profraw` files and all R10 coverage profiles were left untouched. The successful R11 API coverage run wrote 11 profiles below `target/cargo-unified-planner-coverage-r11/profiles/` and merged only those profiles.

## Fresh build and runtime

- Required command: `DATAZEN_DRIVERS=postgres,mysql,sqlite CARGO_TARGET_DIR=/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-planner-verification/target/cargo-unified-planner-tester-r11 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 pnpm tauri:build:webdriver`.
- The frontend type-check and Vite build passed; Rust produced the fresh webdriver binary and `DataZen.app`. The command returned nonzero only in the final DMG packaging step, which is explicitly excluded from this feature's acceptance criteria.
- The sandbox denied the first app bind and WDIO client connection on loopback. The same fresh app, isolated data directory, and port were retried through approved local-loopback access; `/status` returned `ready=true`. The app used port `49319` and app data at `target/cargo-unified-planner-tester-r11/wdio-r11-app-data`.
- The app was stopped after WDIO. The fresh binary, `.app`, build log, and WDIO logs remain under `target/cargo-unified-planner-tester-r11`; these ignored local artifacts are not committed.

## Focused CHECK OPTION journey

Ran `SD-UNIFIED-mysql-view-metadata-blocked` against the fresh app. The live source catalog returned exactly one row with `CHECK_OPTION=CASCADED`, and `SHOW CREATE VIEW` contained the trailing `WITH CASCADED CHECK OPTION`. `get_object_ddl` returned a valid view snapshot after normalizing the local database qualifier. WDIO then reached the planner metadata requirement and asserted:

- the requirement identifies the non-default creation semantics;
- the generated plan has no statements;
- deploy is disabled at review;
- the target fixture object count is zero before teardown.

All assertions passed. The `finally` path asserted exact source/target fixture counts of `0/0` and removed both temporary connection configurations. The six-case suite repeated this journey successfully. There was no fallback to the earlier R10 error path.

## Full six-journey WDIO suite

Ran `E2E_WD_PORT=49319 E2E_SKIP_WORKER_DATABASE=1 pnpm exec wdio run e2e/wdio.conf.ts --spec ./e2e/specs/schema-diff-unified-planner.ts`. Result: **6 passing, 0 failing**.

- PostgreSQL mixed dependency create, reviewed deploy, and readback: pass.
- PostgreSQL missing dependency, empty plan, disabled deploy, and zero-write assertion: pass.
- MySQL mixed parent/child/view plan, deploy, readback, and target-side view `SELECT`: pass.
- MySQL exact missing-dependency identity, empty plan, disabled deploy, and zero-write assertion: pass.
- MySQL function/procedure/trigger/view catalog smoke: pass.
- MySQL `WITH CASCADED CHECK OPTION` metadata blocker and zero-write assertions: pass.

Every started journey logged exact source/target fixture cleanup `0/0`; fixture teardown removed temporary connection records. Full output is preserved locally at `target/cargo-unified-planner-tester-r11/wdio-r11-six-journeys.log`, with focused output at `target/cargo-unified-planner-tester-r11/wdio-r11-check-option.log`.

## Independent fix review and coverage

- Reviewed product commit `1369db7` and its regression cases. The normalizer removes only the exact source database from three-part compound column identifiers, relation nodes, and qualified wildcards. Regressions preserve an unchanged external database identity and reject external-to-local changes. No additional correctness issue was found in this fix.
- Instrumented `cargo test -p datazen-driver-api --lib -- --test-threads=1` on verifier HEAD `e3a1aa35` passed **198/198**. Coverage used Rust 1.90.0, Apple LLVM 17.0.0, `RUSTFLAGS='-Cinstrument-coverage -Ccodegen-units=1'`, `CARGO_INCREMENTAL=0`, and an absolute verifier-local `CARGO_TARGET_DIR=.../target/cargo-unified-planner-coverage-r11`.
- `packages/driver-api/src/schema_object_commands.rs`: **556/677 lines (82.13%)**; `execute_object_dependencies` is 74/74 lines in the tested driver instantiation. Region coverage for the full file is **78.04%** and remains below 80; it is a separate metric from the line gate.
- `packages/driver-api/src/schema_object_commands/mysql_view_metadata.rs`: **274/334 lines (82.04%)**. The BUG-008 matcher is 14/15 lines (93.33%). Coverage includes the new three-part column and qualified-wildcard regressions. No WDIO runtime line coverage is claimed.
- The 11 successful R11 profiles alone were merged with `xcrun llvm-profdata`; no partial pre-merge attempt profiles, R10 profiles, or root profiles were included. The interrupted pre-merge compile emitted only temporary R11-local build profiles; those files were cleared before the successful test run.

## Acceptance status

- BUG-007 is independently verified: the CHECK OPTION metadata reaches its blocker before writes, and WDIO proves an empty plan, disabled deploy, and zero target objects.
- BUG-008 is independently verified: the corrected local qualifier normalization passes both live planner journeys and the unaliased CHECK OPTION view, while unit regressions preserve external database identity.
- BUG-009's functional evidence from R8 remains valid; R11 independently closes its API coverage gate with the 82.13% line result.
- All six unified-planner WDIO journeys and the 80% changed-core line-coverage criterion now pass. The feature track is `TEST_DONE / PASSED`.
