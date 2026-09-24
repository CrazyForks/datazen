# migration-transfer-unknown-outcome-fence-BUG-004 · Ack-loss WDIO cleanup can drop a database it did not create

- **Severity**: P1 (test fixture can destroy pre-existing user data)
- **Status**: READY_FOR_TEST
- **Files**: `packages/drivers/postgres/e2e/data-transfer-commit-ack-loss-pg-mysql.ts`; `packages/drivers/mysql/e2e/data-transfer-commit-ack-loss-mysql-pg.ts`
- **Description**: Both new acknowledgement-loss specs set `adminConnectionsSaved = true` before attempting either `CREATE DATABASE`, then their `after` hook unconditionally issues `DROP DATABASE IF EXISTS` for both generated names. They neither assert that each generated database was absent before starting nor record which `CREATE DATABASE` succeeded. If a generated name already exists, its `CREATE` fails and cleanup drops that pre-existing database. If the first create succeeds and the second collides/fails, cleanup also drops the pre-existing database with the second name. The names are timestamp-derived and unlikely to collide accidentally, but the unconditional deletion has no ownership proof and is destructive when that condition occurs.
- **Reproduction**:
  1. Pre-create either direction's exact generated source or target database name for the current `Date.now().toString(36)` stamp (or force `CREATE DATABASE` of the second database to fail after the first succeeds).
  2. Start the corresponding WDIO spec.
  3. Its setup fails at `CREATE DATABASE`; Mocha still invokes the `after` hook.
  4. The cleanup hook executes `DROP DATABASE IF EXISTS` for both names, including the database that this run did not create.
- **Observed code**: `adminConnectionsSaved = true` is assigned before the setup DDL; cleanup drops both `sourceDatabase` and `targetDatabase` without per-database creation flags or a prior catalog absence check. The same flaw is present in both direction specs.
- **Impact**: The required live test currently cannot be run safely against the authorized local database services. No acknowledgement-loss spec was run, and no database was created or dropped during this review.
- **Required repair**: Before any create, query both catalogs and fail closed if either exact name exists; track successful creation separately for source and target; cleanup may drop only a database whose `CREATE` returned success in this run. Ensure partial setup failure follows the same ownership rule.

## Coder repair

- Both specs query the exact PostgreSQL database name in `pg_database` and the exact MySQL schema name in `information_schema.SCHEMATA` before either `CREATE DATABASE`; an existing name aborts setup before any database DDL.
- `sourceDatabaseCreated` and `targetDatabaseCreated` are independent and become true only after their respective `CREATE DATABASE` IPC resolves successfully. Cleanup attempts `DROP` only for the corresponding true flag, so a failed or ambiguous create response is never treated as ownership.
- Source/target admin and fixture connection configs are tracked independently. Sessions are disconnected independently; partial setup cleanup deletes only configs whose save calls returned successfully. Cleanup attempts each owned database separately and reports any failure without widening ownership.
- No database journey was run in this Coder phase. Static checks: Host TypeScript passed; Prettier and `git diff --check` passed; the repository-wide E2E TypeScript project still has existing harness errors, with no diagnostics in either changed spec.
- Ready for a fresh independent Tester to run the candidate journeys. The first live run should be serial, and no shared fixture/reset scripts should be used.
