# Unified planner fresh retest · round 10 · 2026-09-25

## Result

**TEST_FAILED — five of six live journeys passed, but the CHECK OPTION metadata blocker still cannot be reached.** The BUG-007 suffix parser repair is exercised, then `get_object_ddl` fails because MySQL expands unaliased column references in `VIEW_DEFINITION` to three-part database/table/column identifiers while `SHOW CREATE VIEW` returns two-part table/column identifiers. This is a remaining BUG-008 normalization gap. The planner did not generate or deploy a plan for this journey. Exact source and target fixture cleanup was `0/0`.

The API-unit coverage run passed 191/191. `mysql_view_metadata.rs` is 84.53% line-covered, but `execute_object_dependencies` is 59/74 (79.73%) and the full `schema_object_commands.rs` is 513/677 (75.78%). The 80% changed-core coverage gate remains open.

## Scope and environment

- Independent verification ran in `/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-planner-verification`, branch `feature/migration-schema-unified-planner-verification`, at HEAD `8e0490f4` (including the BUG-007 suffix parser fix). No production files were edited in this round.
- `node_modules` is a physical directory in the verifier worktree. No black-box-tester was used. The user's authorization was used only for the isolated MySQL and PostgreSQL fixtures. `E2E_SKIP_WORKER_DATABASE=1` disabled global WDIO worker-database creation/drop; no shared test database setup or reset ran. WDIO's app-data cleanup remained scoped to the isolated R10 data directory.
- The 13 pre-existing root `.profraw` files were left untouched. The 27 coverage profiles for this round were written and merged only below `target/cargo-unified-planner-coverage-r10/profiles/`.

## Fresh build and app

- Required command: `DATAZEN_DRIVERS=postgres,mysql,sqlite CARGO_TARGET_DIR=/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-planner-verification/target/cargo-unified-planner-tester-r10 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 pnpm tauri:build:webdriver`.
- The fresh webdriver binary and `DataZen.app` were built. The command returned nonzero only in the final DMG packaging step, which is explicitly excluded from this feature's acceptance criteria.
- The sandbox denied the first app bind on isolated port `49305`; the same binary, port, and empty app-data directory were retried through approved local-loopback access. `/status` returned `ready=true`. WDIO's sandboxed client was also denied with `EPERM`, so the same focused and broad WDIO runs were retried with approved local-loopback access.
- App data was isolated at `target/cargo-unified-planner-tester-r10/wdio-r10-app-data`. The app was stopped after WDIO; the fresh binary and `.app` remain available under `target/cargo-unified-planner-tester-r10`.

## Focused CHECK OPTION diagnostic

The focused WDIO case `SD-UNIFIED-mysql-view-metadata-blocked` created a source view in `datazen_sync_mysql_src`, with a separate target connection. The live source catalog returned exactly one row, `CHECK_OPTION=CASCADED`, and `SHOW CREATE VIEW` returned the matching view and a trailing `WITH CASCADED CHECK OPTION`. The suffix passed the parser repair far enough to reach the subsequent query-body consistency check, which failed with:

```text
Query failed: MySQL VIEW_DEFINITION and SHOW CREATE VIEW describe different query bodies or database identities
```

For fixture `sd_unified_mysql_muggqee5_h1pj_view`, the exact decoded `VIEW_DEFINITION` body was:

```sql
select `datazen_sync_mysql_src`.`sd_unified_mysql_muggqee5_h1pj_child`.`id` AS `id`,`datazen_sync_mysql_src`.`sd_unified_mysql_muggqee5_h1pj_child`.`state` AS `state`,`datazen_sync_mysql_src`.`sd_unified_mysql_muggqee5_h1pj_child`.`parent_id` AS `parent_id` from `datazen_sync_mysql_src`.`sd_unified_mysql_muggqee5_h1pj_child`
```

The query body in `SHOW CREATE VIEW` was:

```sql
select `sd_unified_mysql_muggqee5_h1pj_child`.`id` AS `id`,`sd_unified_mysql_muggqee5_h1pj_child`.`state` AS `state`,`sd_unified_mysql_muggqee5_h1pj_child`.`parent_id` AS `parent_id` from `sd_unified_mysql_muggqee5_h1pj_child`
```

The complete `SHOW CREATE VIEW` string, with only the definer identity redacted, was:

```sql
CREATE ALGORITHM=UNDEFINED DEFINER=`[redacted]`@`[redacted]` SQL SECURITY DEFINER VIEW `sd_unified_mysql_muggqee5_h1pj_view` AS select `sd_unified_mysql_muggqee5_h1pj_child`.`id` AS `id`,`sd_unified_mysql_muggqee5_h1pj_child`.`state` AS `state`,`sd_unified_mysql_muggqee5_h1pj_child`.`parent_id` AS `parent_id` from `sd_unified_mysql_muggqee5_h1pj_child` WITH CASCADED CHECK OPTION
```

This isolates the remaining normalizer defect: it removes an exact source database from a two-part relation node, but does not remove that database from the three-part compound column identifiers in `VIEW_DEFINITION`. The fixture's query body and table identity otherwise match. The failure happens before the metadata requirement, empty-plan, disabled-deploy, and explicit target-count assertions. No plan or deploy was issued. The `finally` cleanup asserted exact source/target fixture counts of `0/0` and removed both temporary connection configurations.

## Full six-journey WDIO suite

Ran `E2E_WD_PORT=49305 E2E_SKIP_WORKER_DATABASE=1 pnpm exec wdio run e2e/wdio.conf.ts --spec ./e2e/specs/schema-diff-unified-planner.ts` against the same fresh app. Result: **5 passing, 1 failing**.

- PostgreSQL positive mixed dependency plan, deploy, and readback: pass.
- PostgreSQL missing dependency, empty plan, disabled deploy, and zero-write assertion: pass.
- MySQL mixed parent/child/view plan, deploy, readback, and target-side view `SELECT`: pass.
- MySQL exact missing-dependency identity, empty plan, disabled deploy, and zero-write assertion: pass.
- MySQL four-kind catalog smoke (function, procedure, trigger, view): pass.
- MySQL `WITH CASCADED CHECK OPTION`: fail at direct `get_object_ddl` with the body/database identity mismatch above, before its metadata blocker and zero-write assertions. No planner deploy occurred.

Every started journey, including each focused CHECK OPTION diagnostic, logged exact source/target cleanup `0/0`. The fixture teardown also removed the temporary source and target connection records. The raw SQL, test output, and cleanup lines are preserved locally in `target/cargo-unified-planner-tester-r10/wdio-r10-check-option-diagnostic.log` and `target/cargo-unified-planner-tester-r10/wdio-r10-six-journeys.log`; these ignored build artifacts are not part of the commit.

## Driver API tests and coverage

- Instrumented `cargo test -p datazen-driver-api --lib -- --test-threads=1`: **191 passed, 0 failed**.
- Coverage used Rust 1.90.0, `RUSTFLAGS='-Cinstrument-coverage -Ccodegen-units=1'`, `CARGO_INCREMENTAL=0`, dev/test debug info disabled, and absolute `CARGO_TARGET_DIR=/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-planner-verification/target/cargo-unified-planner-coverage-r10`. Only the 27 profiles in its `profiles/` directory were merged with `xcrun llvm-profdata`; no earlier-round or root profiles were included.
- `packages/driver-api/src/schema_object_commands/mysql_view_metadata.rs`: **235/278 lines (84.53%)**. `mysql_view_query_bodies_match` executed 14/15 lines (93.33%); its untested empty-source-database return remains uncovered. This exceeds 80% for the BUG-008 matching helper module.
- `execute_object_dependencies` in `schema_object_commands.rs`: **59/74 lines (79.73%)**. The exact uncovered production paths include PostgreSQL view/trigger/function/table/sequence/type dispatch (lines 378–386 and 389–393), PostgreSQL table/sequence usage selection (403–404), the PostgreSQL-table catalog parse flag (420), MySQL view-visibility validation (432), empty schema/target-name filters (370 and 374), and the sequence-result closure (443). The MySQL table success/visibility path is exercised by the new tests.
- Whole `packages/driver-api/src/schema_object_commands.rs`: **513/677 lines (75.78%)**, below 80%. Keep the gate open for meaningful targeted tests of the uncovered command paths; do not lower the threshold. No WDIO runtime line coverage is claimed.

## Release gate

- BUG-007 remains open: suffix normalization now advances beyond the parser, but this live case still does not reach the CHECK OPTION blocker or its explicit zero-write assertion.
- BUG-008 is reopened for the unhandled same-source database qualifier in three-part column identifiers. The ordinary aliased-view journeys still pass; the unaliased CHECK OPTION view exposes the remaining case.
- BUG-009's live behavior remains independently verified from R8. Its API command path is now measured at 79.73% for `execute_object_dependencies`, and whole-file changed-core coverage remains below the 80% gate.
- The feature remains `TEST_FAILED`; it is not release-ready. A fresh build and six-journey WDIO rerun are required after BUG-008 is corrected.
