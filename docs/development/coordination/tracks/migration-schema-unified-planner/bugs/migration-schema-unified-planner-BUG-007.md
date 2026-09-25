# migration-schema-unified-planner-BUG-007 · MySQL view metadata can mix two catalog moments

- **严重度**：P1（阻断）
- **状态**：待修复
- **涉及范围**：Driver API MySQL `get_object_ddl` view metadata extraction; unified planner source/target snapshot validation

## 描述与代码审查证据

`get_object_ddl(view)` first reads `VIEW_DEFINITION`, `DEFINER`, `SECURITY_TYPE`, `CHECK_OPTION`, `CHARACTER_SET_CLIENT`, and `COLLATION_CONNECTION` from `INFORMATION_SCHEMA.VIEWS`. It then issues a separate `SHOW CREATE VIEW` query. The parser compares only the two query bodies; it takes `ALGORITHM` and explicit-column-list metadata from `SHOW CREATE VIEW`, but does not compare its definer/security/check-option fields with the first result.

If a concurrent `ALTER VIEW` changes creation semantics while keeping the query body unchanged, the two reads can describe different catalog states. For example, the first read can report `CHECK_OPTION=NONE`, then `SHOW CREATE VIEW` can report `WITH CASCADED CHECK OPTION`. Because only the query bodies are compared, the combined snapshot can retain `NONE` and pass the planner's body-only renderer gate. The migration could then silently remove the later view's write-check behavior. The same split also applies to definer and security semantics; the charset/collation values come only from the first query.

This finding is from independent source review of `packages/driver-api/src/schema_object_commands.rs::extract_mysql_view_metadata`; it has not yet been reproduced with concurrent DDL. It is separate from BUG-006's cross-database mapping acceptance.

## Required fix and verification

- Build one authoritative metadata snapshot from one `SHOW CREATE VIEW` result, including algorithm, explicit columns, definer, SQL security, check option, client character set, and connection collation, where exposed by MySQL.
- If catalog fields from a separate query remain necessary, compare every creation-semantic field with the `SHOW CREATE VIEW` result and fail closed on any mismatch or missing field. Comparing only the query AST is insufficient.
- Add parser tests for consistent metadata and mismatched security/check-option/definer data, plus a verification test that proves a metadata mismatch cannot yield a deployable plan.
- Re-run the full independent MySQL metadata blocker and positive view readback journeys after merging the fix.
