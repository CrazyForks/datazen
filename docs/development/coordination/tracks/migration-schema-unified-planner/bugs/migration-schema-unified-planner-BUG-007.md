# migration-schema-unified-planner-BUG-007 · MySQL view metadata can mix two catalog moments

- **严重度**：P1（阻断）
- **状态**：一致性修复已合入；Fresh Tester R7 未能独立到达 `WITH CASCADED CHECK OPTION` 的元数据阻断断言，保持待复验
- **涉及范围**：Driver API MySQL `get_object_ddl` view metadata extraction; unified planner source snapshot

## 描述

`get_object_ddl(view)` previously read `VIEW_DEFINITION` and creation metadata from `INFORMATION_SCHEMA.VIEWS`, then separately read `SHOW CREATE VIEW`. It compared only the two query bodies and derived only algorithm and explicit column-list metadata from the SHOW result. A concurrent metadata-only `ALTER VIEW` could therefore mix different catalog moments while leaving the query body unchanged; the combined snapshot could pass the planner's renderer-equivalence gate despite changed security, definer, check-option, or collation semantics.

## 修复与安全边界

- `SHOW CREATE VIEW` is now authoritative for algorithm, definer, SQL security, check option, client character set, and connection collation. Required fields missing from SHOW fail closed.
- The returned body remains the renderer-compatible `VIEW_DEFINITION`, but it is accepted only when its parsed query matches the query in the same SHOW result. Every creation field also exposed by `INFORMATION_SCHEMA.VIEWS` must match SHOW; disagreement returns an error before a schema-object snapshot or reviewed plan can be produced.
- The check-option parser recognizes MySQL's executable version-comment suffix and ignores quoted strings and ordinary comments. Legacy string and valid UTF-8 byte extraction remains supported; invalid UTF-8 remains rejected.

## Fresh Tester R5 review evidence

- R5 identified the issue by source review; concurrent DDL was not reproduced. The finding is that two non-atomic reads can describe different states unless every overlapping field and the parsed view body are checked.
- R5 prepared WDIO assertions for the MySQL view readback, exact mapped dependency blocker/zero writes, and `WITH CASCADED CHECK OPTION` rejection. Those journeys remain unrun pending this fix and a new independent Tester.

## Fresh Tester round-6 evidence

- The independent WDIO run exercised the new view metadata path. MySQL positive and missing-dependency journeys received `Query failed: MySQL VIEW_DEFINITION and SHOW CREATE VIEW describe different query bodies` for ordinary same-database table references. The metadata-negative journey timed out before a plan was produced, so the `WITH CASCADED CHECK OPTION` blocker did not independently pass.
- Live reproduction shows `VIEW_DEFINITION` qualifies local references with the selected source database while `SHOW CREATE VIEW` omits that same-database qualifier. BUG-008 records the compatibility defect and the requirement to retain external-database identity when comparing the bodies.
- See the [round-6 retest report](../test-results/unified-planner-retest-r6.md). This round does not close BUG-007 or claim the MySQL planner acceptance path passed.

## 编码验证

- API regressions cover consistent metadata, INFORMATION_SCHEMA→SHOW mismatch and SHOW→INFORMATION_SCHEMA mismatch for definer/security/check-option/charset/collation, view-body mismatch, and check-option phrases inside strings/comments.
- Host Schema Diff: 204/204; Driver API: 177/177; MySQL driver library: 123/123; MySQL `schema_objects_sql` integration: 8/8.
- `cargo fmt --all -- --check` and `git diff --check` pass. Fresh Tester must rerun the real WDIO positive/negative journeys; this card does not claim independent runtime verification.

## Fresh Tester R7 evidence

- The rebuilt app completed the MySQL catalog smoke and successfully retrieved the fixture view's DDL through live IPC, so ordinary view extraction proceeds past the BUG-008 same-database qualifier issue.
- The `WITH CASCADED CHECK OPTION` journey timed out in `clickSchemaDiffGeneratePlan()` before the plan panel and metadata assertions. No deploy was clicked, but the explicit post-plan zero-write assertion was not reached. Exact teardown counts were 0/0. Therefore R7 does not independently verify BUG-007's intended metadata blocker; keep this card open until that journey produces and asserts the blocker.
- Full evidence is in the [round-7 retest report](../test-results/unified-planner-retest-r7.md).
