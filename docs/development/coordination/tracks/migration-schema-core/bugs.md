# migration-schema-core bugs

## migration-schema-core-BUG-001 — P1: PK removal does not precede nullable relaxation

- Status: 待修复
- Location: `src-tauri/src/schema_diff/dependencies.rs`, `precedes` and dependency closure.
- Reproduction: source `users(id integer NULL)`; target `users(id integer PRIMARY KEY)`; prepare same-family PostgreSQL plan with destructive enabled.
- Actual generated SQL: `ALTER TABLE "users" ALTER COLUMN "id" DROP NOT NULL` then `ALTER TABLE "users" DROP CONSTRAINT "users_pkey"`.
- Real PostgreSQL on isolated `dz_mig_0910_schema_tgt`: first statement fails `ERROR: column "id" is in a primary key` (psql exit 3). Reversing these operations succeeds (exit 0). Both probes used BEGIN / unique table / ROLLBACK; no retained fixture changes.
- Impact: ordinary removal/replacement of a primary key cannot migrate to a nullable desired column. With destructive disabled, the excluded PK drop also fails to remove its dependent nullable relaxation, leaving an executable invalid plan.
- New failing Host regressions: `test_tester_primary_key_removal_precedes_nullable_relaxation`, `test_tester_excluding_pk_drop_excludes_dependent_nullable_change`. The latter also protects unrelated additive columns.
- Expected: drop old PK before relaxing its columns; if PK drop is excluded, exclude dependent relaxation while retaining unrelated changes. Handle replacement into a different PK without new graph cycles.

## migration-schema-core-BUG-002 — P2: deployment-window acceptance paths lack coverage

- Status: 待修复
- Scope: independent verification gate, not a claim that all uncovered code is defective.
- Existing 37 frontend tests pass, but changed three-file V8 line coverage is 39.08%. After tester added control-state journey: 40.14%; `SchemaDiffDeployPanel.tsx` improved 66.66% → 100%; `SchemaDiffWindow.tsx` remains 33.73%; `schemaDiff.ts` remains 75.86%.
- Reproduction: run Vitest changed suites with `--coverage --coverage.include=src/windows/schema-diff/SchemaDiffDeployPanel.tsx --coverage.include=src/windows/schema-diff/SchemaDiffWindow.tsx --coverage.include=src/commands/schemaDiff.ts`.
- Actual: coverage command exits nonzero: line coverage 40.14% below 80%. Main-window deploy handler/footer journey is unexecuted by the existing shell-only window test; therefore panel tests do not substantiate both entry points.
- Required: enable meaningful full wizard tests (including prepare failure/stale plan, execute refusal/result and rollback control transitions), independently measure ≥80% core coverage, and run the exact-binary desktop journey after BUG-001 correction. Tester may add tests; any production seams/refactor belongs to coder.
