# migration-default-expression-review

## Phase

READY_FOR_TEST

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
- No front-end or driver files changed, so front-end typecheck and driver-specific suites were not applicable. WDIO was not started because the coordinator reserved that runner; schedule independent Tester E2E/review.
- Current state: READY_FOR_TEST. Tester must independently review the implementation and rerun verification before closing BUG-001.
