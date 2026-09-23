# migration-default-expression-review

## Phase

TEST_FAILED / fix required

## Scope

Independent review of cross-dialect Schema Diff default-expression translation at baseline `c7ff06d9` (parent `13f40925`). This review is split from the migration-navicat integration track so the confirmed P2 can be assigned to a focused fix track.

## Tester result

- Reproduction test: `schema_diff::plan::tests::test_tester_mysql_numeric_expression_default_fails_closed_for_postgres` in `src-tauri/src/schema_diff/plan_tests.rs`.
- Result: failed against `c7ff06d9`, as expected. The plan had `requirements: []` and emitted `ALTER TABLE "users" ADD COLUMN "value" integer DEFAULT IFNULL(1, 2)` for a MySQL numeric default expression mapped to PostgreSQL.
- Impact: P2. A valid MySQL expression default reaches PostgreSQL as invalid target SQL, blocking this migration instead of requiring explicit translation.
- Tester-only regression test commit: `e31bc710`.
- No production code was changed by the Tester.
