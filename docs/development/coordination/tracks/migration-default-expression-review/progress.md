# migration-default-expression-review

## Phase

PASSED

## Scope

Independent review of cross-dialect Schema Diff default-expression translation at baseline `c7ff06d9` (parent `13f40925`). This review is split from the migration-navicat integration track so the confirmed P2 can be assigned to a focused fix track.

## Tester result

- Reproduction test: `schema_diff::plan::tests::test_tester_mysql_numeric_expression_default_fails_closed_for_postgres` in `src-tauri/src/schema_diff/plan_tests.rs`.
- Result: failed against `c7ff06d9`, as expected. The plan had `requirements: []` and emitted `ALTER TABLE "users" ADD COLUMN "value" integer DEFAULT IFNULL(1, 2)` for a MySQL numeric default expression mapped to PostgreSQL.
- Impact: P2. A valid MySQL expression default reaches PostgreSQL as invalid target SQL, blocking this migration instead of requiring explicit translation.
- Tester-only regression test commit: `e31bc710`.
- No production code was changed by the Tester.

## Coder result

- Fix commit: `0cfd3aab0e6d6ddf82eb1133247bbb0a75706a12` (`fix(schema-diff): reject unsafe MySQL numeric defaults`).
- Replaced the broad known-MySQL-type pass-through with explicit target-compatible numeric literal validation. PostgreSQL integer targets accept only signed integer literals within their target range; other PostgreSQL numeric targets accept the existing strict plain numeric literal grammar. Unsupported MySQL expressions and source-specific numeric forms now produce `PlanRequirement::Unsupported`.
- Preserved existing boolean default translation (`TRUE` / `FALSE`) and covered Add Column, Create Table, and Set Default planner paths.
- `int unsigned` is normalized as the unknown source type `intunsigned`; it follows the conservative target-compatibility path. Tests cover fractional defaults and the MySQL unsigned maximum being rejected for a PostgreSQL `integer` target.
- Regression and planner suite: `CARGO_TARGET_DIR=target/cargo-wt node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib schema_diff::plan::tests:: --offline` — 62 passed, 0 failed.
- Formatting: `rustfmt --check --edition 2021 --config skip_children=true src-tauri/src/schema_diff/plan.rs src-tauri/src/schema_diff/plan_tests.rs` — passed.
- `git diff --check` — passed.
- No front-end or driver files changed, so front-end typecheck and driver-specific suites were not applicable. No separate WDIO journey was needed because the fix changes only backend DDL planning.
- Coder state at handoff: READY_FOR_TEST. The independent Tester review and verification are recorded below.

## Independent Tester result

- Result: `TEST_DONE`; no additional implementation defect found. The original `BUG-001` is closed after independent verification.
- Code review: verified numeric MySQL defaults now pass only when they are plain literals compatible with the mapped PostgreSQL type. MySQL-only expressions (`IFNULL`, `COALESCE`, arithmetic), malformed/source-specific numeric forms, integer overflow, and unsupported array targets produce `Unsupported` requirements instead of executable target DDL. Existing boolean translation remains covered. Add Column, Create Table, and Set Default paths are covered by planner regressions.
- Independent Rust tests: `CARGO_TARGET_DIR=/Users/flyxl/code/datazen/.worktrees/datazen-migration-navicat/target CARGO_BUILD_JOBS=1 node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib schema_diff::plan::tests:: --offline` — 63 passed, 0 failed, 1742 filtered. A second LLVM-instrumented run also passed 63/63.
- Tester-only boundary test: `test_tester_mysql_integer_defaults_follow_postgres_target_widths` verifies PostgreSQL smallint and bigint minima/maxima/overflow, integer-array rejection, and empty numeric metadata failing closed.
- LLVM line coverage: the full changed planner file has 1219/1362 executable lines covered (89.50%). The reviewed numeric-default slices in `plan.rs` (lines 275–291, 316–396, and 513–527) cover 112/112 executable lines (100.00%). The instrumented run used all `schema_diff::plan::tests` and covered literal syntax, exponent parsing, empty/malformed values, target range branches, and fail-closed mapping paths.
- Formatting and whitespace checks: `rustfmt --check --edition 2021 src-tauri/src/schema_diff/plan_tests.rs src-tauri/src/schema_diff/plan.rs` and `git diff --check` passed.
- E2E: no UI or IPC behavior changed in this backend-only planner fix, so no WDIO journey was added or run. The planner regression tests cover the DDL acceptance and refusal paths directly.
- Frontend checks were not applicable because no frontend or driver source changed.
- Test code commit: `c279a5959d7951b7f2b8b0469ba9c153b3a62805`.
