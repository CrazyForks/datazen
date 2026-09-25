# migration-schema-unified-planner-BUG-007 · MySQL view metadata can mix two catalog moments

- **严重度**：P1（阻断）
- **状态**：修复完成，待 Fresh Tester 复验
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

## 编码验证

- API regressions cover consistent metadata, INFORMATION_SCHEMA→SHOW mismatch and SHOW→INFORMATION_SCHEMA mismatch for definer/security/check-option/charset/collation, view-body mismatch, and check-option phrases inside strings/comments.
- Host Schema Diff: 204/204; Driver API: 177/177; MySQL driver library: 123/123; MySQL `schema_objects_sql` integration: 8/8.
- `cargo fmt --all -- --check` and `git diff --check` pass. Fresh Tester must rerun the real WDIO positive/negative journeys; this card does not claim independent runtime verification.
