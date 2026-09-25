# Unified planner fresh re-test · round 6 · 2026-09-25

## Result

**TEST_FAILED — 3 passed, 3 failed.** BUG-008 blocks normal MySQL view DDL extraction. This round does not close BUG-006 or BUG-007, does not prove the MySQL missing-dependency blocker, and does not establish release readiness for the Schema Diff track.

## Code review

- Independently reviewed the merged BUG-006 scope-mapping and BUG-007 metadata-extraction changes in the verification worktree before running the app. The MySQL driver owns relation-token rewriting; Host passes exact configured source/target scopes and structured dependency mappings. The metadata path requires `SHOW CREATE VIEW` creation fields and cross-checks overlapping catalog fields.
- The body consistency check compares parsed query ASTs exactly. That assumption does not hold for MySQL's same-database qualification normalization: live `VIEW_DEFINITION` prefixes local relation names with the selected database, while `SHOW CREATE VIEW` omits that prefix.
- No product source was changed by this Tester. The new P1 is registered as BUG-008.

## Environment and build

- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-planner-verification`; branch `feature/migration-schema-unified-planner-verification`; HEAD `1d06eb97` before Tester documentation updates.
- `node_modules` is a physical directory in this worktree. The 13 pre-existing root `.profraw` files were left untouched.
- Fresh `pnpm tauri:build:webdriver` ran with `DATAZEN_DRIVERS=postgres,mysql,sqlite` and `CARGO_TARGET_DIR` isolated under this worktree. It produced `target/cargo-unified-planner-tester/debug/datazen` and `DataZen.app`; it exited 1 only in the final DMG bundling step, which the user explicitly excluded.
- WDIO ran directly against the freshly built app on port `49183`, with isolated app data at `target/cargo-unified-planner-tester/wdio-r6-app-data` and `E2E_SKIP_WORKER_DATABASE=1`. No `black-box-tester` was used; no shared worker-database setup/teardown ran.

## WDIO journey results

| Journey | Result | Evidence |
| --- | --- | --- |
| PostgreSQL positive create/deploy/readback | PASS | Unified dependency chain deployed; source/target cleanup 0/0. |
| PostgreSQL unselected-dependency blocker | PASS | Blocked plan left target unchanged; cleanup 0/0. |
| MySQL positive cross-database mixed deploy/readback | FAIL | `get_object_ddl(view)` rejected equivalent bodies after MySQL qualification normalization; cleanup 0/0. |
| MySQL exact mapped missing-dependency blocker | FAIL | Same DDL-extraction error occurred before dependency planning; intended diagnostic/zero-write assertion not reached; cleanup 0/0. |
| MySQL `WITH CASCADED CHECK OPTION` blocker | FAIL / NOT PROVEN | Timed out waiting for plan generation before the metadata assertion; no independent metadata-blocker result. Teardown cleanup was 0/0; the explicit post-plan target-count assertion was not reached. |
| MySQL four-kind catalog smoke | PASS | Function, procedure, trigger, and view names returned with exact source schema identity; cleanup 0/0. |

Overall WDIO result: **3 passing, 3 failing**. Every random source/target fixture pair printed exact post-teardown object counts `0/0`.

## Live normalization reproduction

A separate uniquely named MySQL fixture with parent table, child table, FK, and view confirmed the inconsistency:

- `VIEW_DEFINITION`: ``from (`datazen_sync_mysql_src`.`<child>` `c` join `datazen_sync_mysql_src`.`<parent>` `p` ...)``
- `SHOW CREATE VIEW`: ``from (`<child>` `c` join `<parent>` `p` ...)``

The temporary objects were dropped by a cleanup trap. The comparison must normalize only references to the view's own database and retain external-database identity; see BUG-008.

## Coverage and remaining verification

The changed-core coverage gate was not measured in this round because the live P1 blocks the MySQL acceptance paths and requires a product repair before the coverage result can represent the final implementation. No `TEST_DONE` is declared. After BUG-008 is fixed, a fresh Tester must rerun all six journeys, confirm the metadata blocker and exact zero-write assertion independently, run the requested focused Rust/frontend checks, and measure changed-core coverage against the >=80% gate.
