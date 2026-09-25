# Unified planner fresh re-test · round 7 · 2026-09-25

## Result

**TEST_FAILED — 4 of 6 acceptance journeys passed; 1 failed and 1 was not proven.** The BUG-008 view-body normalization fix was independently reviewed and exercised successfully through live MySQL DDL retrieval. The MySQL mixed plan remains blocked by newly confirmed BUG-009: MySQL table dependency snapshots are incomplete. The `WITH CASCADED CHECK OPTION` journey timed out before its intended assertions, so BUG-007 remains open. Changed-function coverage for BUG-008 exceeds 80%, but the full helper module is at 79.07%; the broader changed-core coverage gate remains open.

## Scope and independent review

- Verifier worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-planner-verification`
- Branch: `feature/migration-schema-unified-planner-verification`
- Starting revision: `49bc919f` (merge commit containing product fix `ab1cd4cd`)
- Production files were not edited. The BUG-009 diagnostic WDIO spec is retained as a verifier-only regression seed and is not registered in the normal six-journey suite; after the driver fix, replace its current incomplete-snapshot assertions with positive completeness and exact FK-edge assertions. The retained R6 report was not rewritten.
- Reviewed the BUG-008 change independently. MySQL view metadata now supplies exact `TABLE_SCHEMA`; the AST visitor normalizes only a two-part relation identity whose first identifier exactly matches that source database. Literals and non-relation AST nodes are not visited by this rewrite. External database qualifiers, mismatched identity/casing, external-to-local changes, and genuine body mismatches remain significant and fail closed.
- The verifier's `node_modules` is a physical directory whose real path remains inside this verifier worktree. No `node_modules` link was made to the main checkout. The 13 pre-existing root `.profraw` files were left untouched.

## Build and WDIO environment

- Ran the required `pnpm tauri:build:webdriver` with `DATAZEN_DRIVERS=postgres,mysql,sqlite`, an absolute worktree-local `CARGO_TARGET_DIR` under `target/cargo-unified-planner-tester`, `CARGO_INCREMENTAL=0`, and dev/test debug info disabled. The frontend and webdriver app compiled and produced the fresh executable and `DataZen.app` under that target. The command exited 1 only in the final macOS `bundle_dmg.sh` packaging step, which is excluded by the user.
- Launched the fresh R7 app (not the R6 bundle) with an isolated `DATAZEN_DATA_DIR` at `target/cargo-unified-planner-tester/wdio-r7-app-data` and WebDriver loopback port `49237`. The sandboxed first launch could not bind loopback; the approved local-loopback retry started the fresh binary and WDIO connected successfully. No database fixtures were created before the app endpoint was reachable.
- Ran the six journeys in `e2e/specs/schema-diff-unified-planner.ts` directly with `pnpm exec wdio run e2e/wdio.conf.ts --spec ./e2e/specs/schema-diff-unified-planner.ts`, `E2E_SKIP_WORKER_DATABASE=1`, and `E2E_SKIP_TEARDOWN=1`. No global worker database setup, reset, or teardown ran. No black-box-tester was used.
- A separate verifier-only diagnostic spec invoked live `execute_driver_command(get_object_dependencies)` for two unique MySQL source tables. After correcting its cleanup to run through nested `finally` blocks, the targeted rerun passed 1/1 on isolated loopback port `49239`. The spec remains at `e2e/specs/schema-diff-unified-planner-bug009-diagnostic.ts`, outside the normal suite, as a reproducible seed to replace when BUG-009 is fixed.

## Six acceptance journeys

| Journey                                                       | Result                      | Evidence                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL mixed-object positive create/deploy/readback       | PASS                        | The reviewed plan deployed the custom type, sequence ownership phases, parent/child tables and FK, function/trigger, and view; objects were read back. Exact fixture cleanup was 0/0.                                                                                                                         |
| PostgreSQL missing/unselected dependency blocker              | PASS                        | Empty statements, disabled deploy, and zero target writes were asserted. Exact cleanup was 0/0.                                                                                                                                                                                                               |
| MySQL mixed parent/child/view positive create/deploy/readback | FAIL — BUG-009              | View listing and DDL retrieval succeeded, but both selected source tables lacked complete dependency proof. The planner returned no deployable statements; deploy was not clicked. Exact post-teardown fixture cleanup was 0/0. This journey did not establish a separate pre-cleanup target-count assertion. |
| MySQL exact unselected/missing dependency blocker             | PASS                        | The exact target identity requirement was shown, the plan had no statements, deploy stayed disabled, and the target table/view count was zero before teardown. Exact cleanup was 0/0. This verifies fail-closed behavior, not selected-table dependency completeness.                                         |
| MySQL `WITH CASCADED CHECK OPTION` metadata blocker           | FAIL / NOT PROVEN — BUG-007 | WDIO timed out in `clickSchemaDiffGeneratePlan()` before plan-panel assertions. No deploy was clicked, but the intended metadata blocker and explicit post-plan zero-write assertion were not reached. Teardown cleanup was 0/0.                                                                              |
| MySQL four-kind catalog smoke                                 | PASS                        | The fresh app returned exact schema/name identities for function, procedure, trigger, and view; trigger target schema/table also matched. Exact cleanup was 0/0.                                                                                                                                              |

Overall: **4 passing, 2 failed/unproven**. Every started fixture journey's post-teardown source and target counts were exactly `0/0`.

## BUG-009 direct live-IPC evidence

The additional unique InnoDB parent/child fixture included a real FK. Live calls for both identities returned:

```text
[BUG-009] live IPC kind=table schema=datazen_sync_mysql_src name=<fixture>_parent complete=false dependencies=[]
[BUG-009] live IPC kind=table schema=datazen_sync_mysql_src name=<fixture>_child complete=false dependencies=[]
[BUG-009] exact fixture cleanup source_remaining=0 target_remaining=0
```

Source review confirms `execute_object_dependencies` implements a MySQL dependency SQL contract for views, while MySQL table requests fall through to `SchemaObjectDependencies::incomplete()`. The returned empty array therefore does not mean “no dependencies”; completeness is false. The planner's refusal to approve the positive table chain is correct fail-closed behavior. This blocks MySQL mixed-chain planning until a complete exact table-dependency catalog is implemented. See [BUG-009](../bugs/migration-schema-unified-planner-BUG-009.md).

## Focused checks

- Driver API focused MySQL view metadata tests: **5/5 passed**.
- Full `datazen-driver-api` library tests: **180/180 passed**.
- MySQL driver library tests: **123/123 passed**.
- MySQL `schema_objects_sql` integration tests: **8/8 passed**.
- Host `schema_diff::` Rust tests: **213/213 passed**.
- `pnpm exec vitest run src/windows/schema-diff`: **62/62 passed**.
- Direct rustfmt on changed Rust files, Prettier on the unified planner WDIO spec, and `git diff --check`: passed.

## Coverage

Coverage instrumentation was isolated under this worktree's `target/cargo-unified-planner-coverage-r7` and profile output under `target/cargo-unified-planner-tester/coverage-r7/profiles`. The run used Rust 1.90 with `RUSTFLAGS='-Cinstrument-coverage -Ccodegen-units=1'`, `CARGO_INCREMENTAL=0`, and debug info disabled. The full Driver API suite (180/180) and MySQL `schema_objects_sql` integration suite (8/8) were run with instrumentation. Apple LLVM 17 `llvm-profdata` and `llvm-cov` were used to merge and inspect the isolated profiles; `cargo-llvm-cov` was unavailable. No root profile files were read into the merge or overwritten.

- `mysql_view_query_bodies_match`: **14/15 executable lines (93.33%)**.
- `OwnDatabaseQualifier::pre_visit_relation`: **12/12 executable lines (100%)**.
- The `TABLE_SCHEMA AS view_schema` catalog-query branch was exercised by the instrumented MySQL catalog integration test.
- The whole `mysql_view_metadata.rs` helper module: **79.07%**, below 80%. This aggregate includes unchanged parser/helper error paths. The changed matcher and AST visitor each exceed 80%, but the full-module changed-core gate is conservatively left open until module-scope coverage reaches 80% or the gate's measured scope is clarified by the track owner.

## Release gate

- BUG-008: independently verified for exact local-relation qualifier normalization; live MySQL view DDL retrieval succeeds and regression suites pass.
- BUG-009: confirmed P1 blocker for MySQL positive table-chain planning; requires a complete, exact MySQL table dependency catalog.
- BUG-007: remains open; R7 did not reach the `WITH CASCADED CHECK OPTION` blocker assertion or its explicit zero-write assertion.
- Unified planner acceptance: incomplete (4/6 WDIO journeys passed).
- Coverage acceptance: incomplete at whole helper-module scope (79.07%).
- Track phase remains **FAILED**; R7 result is **TEST_FAILED**. Retest the full six-journey suite after BUG-009 and BUG-007 repairs, preserving per-fixture cleanup assertions and the excluded DMG packaging status.
