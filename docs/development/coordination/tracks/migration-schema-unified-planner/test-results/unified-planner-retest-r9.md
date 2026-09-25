# Unified planner fresh re-test · round 9 · 2026-09-25

## Result

**TEST_FAILED — BUG-007 remains open.** The first broad six-journey run on the fresh app passed the other five journeys, but its CHECK OPTION fixture accidentally queried the target schema when the view was created in the source schema; that run is not valid evidence for BUG-007. A corrected focused WDIO run proved the real product blocker: `SHOW CREATE VIEW` returns valid metadata with a CASCADED suffix, but the production SQL parser rejects that trailing clause before the planner can make its metadata decision. The UI exposes the same parser error and plan generation times out. No deploy was clicked; exact fixture teardown was `0/0`.

## Scope and environment

- Verifier worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-planner-verification`
- Branch revision for the fresh build/runtime: `b0347afa` (includes R8 report commit and focused Driver API coverage tests; production behavior was unchanged).
- `node_modules` was confirmed as a physical directory inside the verifier worktree. The 13 existing root `.profraw` files remain untouched. No black-box-tester was used.
- The app used isolated data at `target/cargo-unified-planner-tester-r9/wdio-r9-app-data` and WebDriver port `49289`. The sandbox denied the first loopback bind; the same fresh app and data directory were retried with approved local-loopback access and returned HTTP 200 at `/status`.
- WDIO ran with `E2E_SKIP_WORKER_DATABASE=1` and `E2E_SKIP_TEARDOWN=1`; no global worker database setup/reset/teardown ran. The authorized local MySQL/PostgreSQL connections were used only for the feature fixtures.

## Build and broad six-journey run

- Ran the required `pnpm tauri:build:webdriver` with `DATAZEN_DRIVERS=postgres,mysql,sqlite`, an absolute verifier-local `CARGO_TARGET_DIR=.../target/cargo-unified-planner-tester-r9`, `CARGO_INCREMENTAL=0`, and debug info disabled. The fresh executable and `.app` compiled. The command returned 1 only in the final `bundle_dmg.sh` packaging step, excluded from this task.
- On the fresh app, the six-case suite reported **5 passing, 1 failing**. Both PostgreSQL cases, both ordinary MySQL planner cases, and the four-kind MySQL catalog case passed. Every started fixture reported exact source/target teardown counts of `0/0`.
- The first version of the CHECK OPTION test used `MYSQL_SYNC_DB` (`datazen_sync_mysql_tgt`) for a view created on the source database (`datazen_sync_mysql_src`). Its direct `get_object_ddl` query therefore searched the wrong database. That is a verifier fixture defect; exclude this first six-case result from BUG-007 acceptance evidence.

## Corrected CHECK OPTION diagnostic

- Corrected the fixture to use a single `MYSQL_SOURCE_DB = datazen_sync_mysql_src` for the source connection, raw catalog query, `SHOW CREATE VIEW`, and direct DDL IPC request. A focused rerun without a rebuild confirmed the exact source catalog row before teardown: one row, `VIEW_DEFINITION` length `1180`, `CHECK_OPTION=CASCADED` (the IPC byte array decodes to that text); `SHOW CREATE VIEW` returned one row with DDL length `374` and the `WITH CASCADED CHECK OPTION` suffix.
- Direct `get_object_ddl` then failed with: `Query failed: parse MySQL SHOW CREATE VIEW result: sql parser error: Expected: end of statement, found: WITH at Line: 1, Column: 349`.
- An environment-gated diagnostic rerun let the UI journey proceed after recording that direct error. The plan panel was on `schema-diff-step-plan`; its inline error contained the same parser failure and its text was `生成部署脚本`. `clickSchemaDiffGeneratePlan()` timed out after **45.4 seconds** at `e2e/helpers.ts:2308` with `等待结构对比计划自动生成超时`.
- The metadata requirement, empty-plan, disabled-deploy, and explicit pre-clean target-count assertions were not reached. No deploy was clicked. Cleanup still ran and asserted exact source/target fixture counts of `0/0`. The fresh app was stopped afterward; `/status` then returned connection refused.
- This establishes that the SQL parser rejects MySQL's plain trailing CHECK OPTION before BUG-007's metadata blocker can be returned. The product fix must safely normalize/parse that suffix while retaining the exact metadata check; production code was not edited in this verifier round.

## R9 Driver API coverage

- On verifier HEAD `b0347afa`, `cargo test -p datazen-driver-api --lib` passed **186/186**. LLVM instrumentation used Rust 1.90, `RUSTFLAGS='-Cinstrument-coverage -Ccodegen-units=1'`, `CARGO_INCREMENTAL=0`, and debug info disabled. The fresh target was `target/cargo-unified-planner-coverage-r9`; all **27** merged profiles came only from `target/cargo-unified-planner-coverage-r9/profiles`. No R8 or root profile was included.
- `packages/driver-api/src/schema_object_commands/mysql_view_metadata.rs`: **149/172 lines (86.63%)**, above 80% with the added metadata tests.
- `execute_object_dependencies` async state machine in `schema_object_commands.rs`: **39/74 lines (52.70%)**, still below the gate. R9 tests now hit invalid kind/name, unsupported MySQL trigger, query error, and malformed-catalog fail-closed paths. The remaining gaps include MySQL view dispatch at line 376, PostgreSQL trigger/function/table/sequence/type dispatch at lines 378–391, required sequence handling at 401–402, and successful catalog/completeness/result assembly plus MySQL visibility checks at 424–441. The complete `schema_object_commands.rs` file is 677/960 lines (70.61%) in this API-unit-only profile scope.
- Apple LLVM 17 `llvm-profdata`/`llvm-cov` read the isolated profile set. The webdriver app was not instrumented, so no WDIO runtime lines are claimed in these percentages.

## Release gate

- BUG-007: remains open pending the product parser repair and fresh independent verification.
- BUG-008: remains independently verified from R8.
- BUG-009: remains independently verified from R8; its coverage follow-up is represented by the R9 helper coverage above, while the dependency dispatcher remains below 80%.
- Unified planner: five other journeys passed on this build; the corrected CHECK OPTION journey failed before its blocker/zero-write assertions. The broad 5/6 count is not a BUG-007 pass because the original fixture used the wrong schema.
- Coverage: the MySQL metadata helper exceeds 80%; `execute_object_dependencies` and the whole command module remain below 80%. Track phase stays `FAILED`; do not claim release readiness.
