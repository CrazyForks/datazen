# migration-schema-unified-planner-BUG-008 · MySQL view body consistency check rejects same-database qualification normalization

- **严重度**：P1（阻断）
- **状态**：普通别名与未别名列引用已修复，并经 Fresh Tester R11 的六个 live journeys 独立验证
- **涉及范围**：Driver API MySQL `get_object_ddl` view metadata extraction; BUG-007 `VIEW_DEFINITION` / `SHOW CREATE VIEW` query-body comparison

## 描述与重现

Fresh Tester round-6 ran the complete unified-planner WDIO spec against the rebuilt app and local MySQL/PostgreSQL. Both MySQL planner journeys failed while reading an ordinary source view:

`Query failed: MySQL VIEW_DEFINITION and SHOW CREATE VIEW describe different query bodies`

The error occurred before either positive planning/deploy or the intended missing-dependency diagnosis. PostgreSQL's positive and blocked journeys passed. The MySQL four-kind catalog smoke also passed.

The failure is reproducible for a standard view over same-database tables. MySQL's `INFORMATION_SCHEMA.VIEWS.VIEW_DEFINITION` expands references such as `` `child` c `` to `` `datazen_sync_mysql_src`.`child` ``, while `SHOW CREATE VIEW` emits the equivalent same-database reference without the database qualifier. Parsing both query bodies and requiring exact AST equality treats these semantically equivalent definitions as different.

## 修复要求

- Compare the body from `VIEW_DEFINITION` with the query body from the same `SHOW CREATE VIEW` result while accounting only for MySQL's normalization of references to the view's own database.
- Normalize the exact source database qualifier in both relation nodes and three-part compound column identifiers such as `source_db.table.column`; keep external database identities and all column/table identity intact.
- Preserve exact identity for references to other databases. Do not erase all qualifiers or accept a body that changes an external dependency into a local dependency.
- Keep the creation-metadata consistency checks and fail-closed behavior for actual body or metadata disagreement.
- Add regressions for same-database qualification normalization, retained external-database qualifiers, and a genuine body mismatch; rerun the six live WDIO journeys and assert exact fixture cleanup.

## Fresh Tester round-6 evidence

- WDIO: 3 passed, 3 failed. PostgreSQL create/deploy/readback and PostgreSQL missing-dependency blocker passed; MySQL catalog smoke passed. MySQL create/deploy and missing-dependency journeys failed at DDL extraction. The `WITH CASCADED CHECK OPTION` journey timed out before a plan was generated; the metadata blocker did not independently pass.
- All six source/target fixture pairs reported exact 0/0 after cleanup. For the metadata-negative journey, the explicit post-blocker zero-write assertion was not reached; the report records this limitation.
- A separate uniquely named MySQL parent/child/FK/view reproduction confirmed the database-qualification difference and removed its temporary objects with a cleanup trap.
- Detailed environment and test evidence: [round-6 retest report](../test-results/unified-planner-retest-r6.md).

## 修复与安全边界

- The view metadata query now returns `TABLE_SCHEMA` as `view_schema`; the body comparison receives this exact source database identity.
- Before comparing parsed query ASTs, the Driver API removes a database qualifier only from a two-part relation or projection wildcard, or from a three-part column identifier, when the first identifier exactly equals `view_schema`. It does not rewrite literals, comments, two-part column identifiers, or other expressions.
- External database qualifiers remain part of the AST identity. A body that changes an external relation to an unqualified local relation remains rejected. Unknown/mismatched casing is not normalized, preserving fail-closed behavior where server identifier case rules are uncertain.
- Existing `SHOW CREATE VIEW` creation-metadata cross-checks remain in force, and genuine body mismatches still prevent a view snapshot from being returned.

## 编码验证

- Driver API regressions cover quoted and unquoted same-database references, catalog-shaped three-part columns and relations, same-database qualified wildcards, case-mismatched local qualifiers, unchanged external database identities, external-to-local changes, two-part column identifiers, and genuine query-body mismatches.
- R10 verification: focused Driver API scope tests 3/3; full Driver API 192/192; MySQL driver 123 library tests plus 16 non-isolated integration tests (3 isolated-database tests ignored); Host Schema Diff 204/204; related Schema Diff UI/command tests 83/83.
- `cargo fmt --all -- --check` and `git diff --check` pass. This worktree did not run live WDIO; Fresh Tester must rerun the MySQL positive mixed-object journey and missing-dependency zero-write case, plus verify exact fixture cleanup.

## Fresh Tester R7 evidence

- Independent source review confirmed that exact `TABLE_SCHEMA` is passed to the AST normalization and that only a two-part relation node whose first identifier exactly matches that source database is normalized. The visitor walks relation AST nodes, so literals and non-relational expressions cannot be rewritten. External database qualifiers, case mismatches, external-to-local changes, and body mismatches remain significant and have regression coverage.
- Focused live MySQL catalog smoke and the MySQL positive journey both retrieved the source fixture view DDL successfully; the former passed all four catalog kinds. This verifies that the original same-database body comparison no longer rejects the ordinary view.
- R7 focused Driver API metadata tests passed 5/5; the full Driver API suite passed 180/180; MySQL library tests 123/123; `schema_objects_sql` integration 8/8; Host Schema Diff Rust tests 213/213; Schema Diff Vitest 62/62.
- Isolated LLVM coverage measured `mysql_view_query_bodies_match` at 14/15 executable lines (93.33%) and `OwnDatabaseQualifier::pre_visit_relation` at 12/12 (100%). The whole `mysql_view_metadata.rs` helper module measured 79.07%, below the 80% gate when interpreted at module scope; see R7 report for the scope and limitation. BUG-008's changed matcher and visitor exceed 80%, but the broader changed-core coverage gate remains open.
- The full MySQL positive planner journey remains blocked before deploy by the separate incomplete table dependency catalog, registered as [BUG-009](migration-schema-unified-planner-BUG-009.md). See the [round-7 retest report](../test-results/unified-planner-retest-r7.md).

## Fresh Tester R8 evidence

- On the fresh R8 app, MySQL's ordinary same-database view passed DDL extraction and participated in the mixed parent/child/view plan, deploy, readback, and target-side `SELECT`. The separate exact dependency-blocker and four-kind catalog journeys also passed.
- This independently confirms the ordinary-view qualifier normalization in the end-to-end path. The check-option metadata-negative journey remains unproven under BUG-007, and full helper-module coverage is still below 80%; those do not undo the successful BUG-008 behavior check.
- See the [round-8 retest report](../test-results/unified-planner-retest-r8.md).

## Fresh Tester R10 evidence

- A fresh CHECK OPTION view uses unaliased projected columns. MySQL's `VIEW_DEFINITION` returned three-part column references and a two-part table reference qualified with `datazen_sync_mysql_src`; the same `SHOW CREATE VIEW` query uses two-part column references and an unqualified table. The exact decoded bodies and the full `SHOW CREATE VIEW` string (definer redacted) are recorded in the [round-10 retest report](../test-results/unified-planner-retest-r10.md).
- `mysql_view_query_bodies_match` currently removes the exact source database only from a two-part relation node, so it leaves the database component in compound column identifiers. `get_object_ddl` rejects the otherwise matching body before the planner can classify the CASCADED metadata. This is a remaining BUG-008 defect; preserve exact external database identity while normalizing this additional AST form.
- The five other live WDIO journeys passed, including ordinary aliased MySQL views; the CHECK OPTION case failed before planning. Its fixture cleanup asserted source/target `0/0` and removed both connection configurations.
- R10 coverage: `mysql_view_query_bodies_match` 14/15 executable lines and `mysql_view_metadata.rs` 235/278 lines (84.53%). The complete `schema_object_commands.rs` file remains below the 80% gate at 513/677 lines (75.78%). Keep that gate open for targeted tests of the uncovered command paths.

## Fresh Tester R11 evidence

- Reviewed fix `1369db7`: it normalizes only the exact source database qualifier in relation nodes, three-part column identifiers, and qualified wildcards. Regressions cover local qualification, unchanged external database references, and external-to-local changes; no additional correctness defect was found.
- The focused live unaliased CHECK OPTION view now passes DDL extraction and reaches the planner metadata blocker. The full six-journey WDIO suite passed 6/6, including both ordinary MySQL view planner journeys and the CHECK OPTION no-write case. All fixture cleanups were exactly `0/0`.
- R11 Driver API line coverage is 274/334 (82.04%) for `mysql_view_metadata.rs`; the matching helper is 14/15 lines (93.33%). The related `schema_object_commands.rs` file is 556/677 lines (82.13%). See [round-11 report](../test-results/unified-planner-retest-r11.md), which separately records the command file's 78.04% region result.
- BUG-008 is closed as independently fixed and verified.
