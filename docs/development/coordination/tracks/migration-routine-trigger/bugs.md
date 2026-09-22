# migration-routine-trigger bugs

## migration-routine-trigger-BUG-001 — object DDL kind validation is fail-open

- 状态：待修复
- 描述：`validate_object_definition` uses an unrestricted `contains` check for
  `FUNCTION` / `PROCEDURE` / `TRIGGER`. A `CREATE VIEW` whose body contains the
  relevant word inside a string literal is accepted as a routine or trigger
  definition. This violates the track's malformed-DDL fail-closed contract.
- 重现：run
  `cargo test -p datazen-driver-api --lib test_tester_object_definition_requires_kind_in_create_header`.
  The test passes `CREATE VIEW calculate_total AS SELECT 'FUNCTION' AS marker`
  as a function and `CREATE VIEW audit_insert AS SELECT 'TRIGGER' AS marker`
  as a trigger; both must be rejected, but the current validator accepts the
  first input and the test fails.
- 实测：the full Driver API suite reports **142 passed, 1 failed**, with the
  failure at `schema_migration.rs:518` asserting that the view-shaped DDL is
  rejected.
- 影响：a malformed or incorrect driver DDL response can enter the
  routine/trigger planner, be rendered as an object migration, and reach the
  reviewed deployment flow under a misleading summary. The validator must
  inspect the `CREATE [OR REPLACE] <kind>` envelope outside literals/comments,
  not merely search the complete definition for a token.
