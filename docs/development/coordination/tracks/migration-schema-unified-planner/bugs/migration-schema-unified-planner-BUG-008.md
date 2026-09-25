# migration-schema-unified-planner-BUG-008 · MySQL view body consistency check rejects same-database qualification normalization

- **严重度**：P1（阻断）
- **状态**：待修复
- **涉及范围**：Driver API MySQL `get_object_ddl` view metadata extraction; BUG-007 `VIEW_DEFINITION` / `SHOW CREATE VIEW` query-body comparison

## 描述与重现

Fresh Tester round-6 ran the complete unified-planner WDIO spec against the rebuilt app and local MySQL/PostgreSQL. Both MySQL planner journeys failed while reading an ordinary source view:

`Query failed: MySQL VIEW_DEFINITION and SHOW CREATE VIEW describe different query bodies`

The error occurred before either positive planning/deploy or the intended missing-dependency diagnosis. PostgreSQL's positive and blocked journeys passed. The MySQL four-kind catalog smoke also passed.

The failure is reproducible for a standard view over same-database tables. MySQL's `INFORMATION_SCHEMA.VIEWS.VIEW_DEFINITION` expands references such as `` `child` c `` to `` `datazen_sync_mysql_src`.`child` ``, while `SHOW CREATE VIEW` emits the equivalent same-database reference without the database qualifier. Parsing both query bodies and requiring exact AST equality treats these semantically equivalent definitions as different.

## 修复要求

- Compare the body from `VIEW_DEFINITION` with the query body from the same `SHOW CREATE VIEW` result while accounting only for MySQL's normalization of references to the view's own database.
- Preserve exact identity for references to other databases. Do not erase all qualifiers or accept a body that changes an external dependency into a local dependency.
- Keep the creation-metadata consistency checks and fail-closed behavior for actual body or metadata disagreement.
- Add regressions for same-database qualification normalization, retained external-database qualifiers, and a genuine body mismatch; rerun the six live WDIO journeys and assert exact fixture cleanup.

## Fresh Tester round-6 evidence

- WDIO: 3 passed, 3 failed. PostgreSQL create/deploy/readback and PostgreSQL missing-dependency blocker passed; MySQL catalog smoke passed. MySQL create/deploy and missing-dependency journeys failed at DDL extraction. The `WITH CASCADED CHECK OPTION` journey timed out before a plan was generated; the metadata blocker did not independently pass.
- All six source/target fixture pairs reported exact 0/0 after cleanup. For the metadata-negative journey, the explicit post-blocker zero-write assertion was not reached; the report records this limitation.
- A separate uniquely named MySQL parent/child/FK/view reproduction confirmed the database-qualification difference and removed its temporary objects with a cleanup trap.
- Detailed environment and test evidence: [round-6 retest report](../test-results/unified-planner-retest-r6.md).
