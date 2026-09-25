# migration-schema-unified-planner-BUG-008 · MySQL view body consistency check rejects same-database qualification normalization

- **严重度**：P1（阻断）
- **状态**：修复完成，待 Fresh Tester 复验
- **涉及范围**：Driver API MySQL `get_object_ddl` view metadata extraction; BUG-007 `VIEW_DEFINITION` / `SHOW CREATE VIEW` query-body comparison

## 描述与重现

Fresh Tester round-6 found ordinary MySQL views could not enter the unified plan because the body from `INFORMATION_SCHEMA.VIEWS.VIEW_DEFINITION` and the body from the same `SHOW CREATE VIEW` result differed syntactically. MySQL qualifies same-database references in `VIEW_DEFINITION` (for example, `` `source_db`.`child` ``) while `SHOW CREATE VIEW` may emit the equivalent local relation as `` `child` ``. Exact AST equality incorrectly rejected this server normalization before planning or dependency diagnostics.

## 修复与安全边界

- The view metadata query now returns `TABLE_SCHEMA` as `view_schema`; the body comparison receives this exact source database identity.
- Before comparing parsed query ASTs, the Driver API removes a database qualifier only from a two-part relation or projection wildcard, or from a three-part column identifier, when the first identifier exactly equals `view_schema`. It does not rewrite literals, comments, two-part column identifiers, or other expressions.
- External database qualifiers remain part of the AST identity. A body that changes an external relation to an unqualified local relation remains rejected. Unknown/mismatched casing is not normalized, preserving fail-closed behavior where server identifier case rules are uncertain.
- Existing `SHOW CREATE VIEW` creation-metadata cross-checks remain in force, and genuine body mismatches still prevent a view snapshot from being returned.

## 编码验证

- Driver API regressions cover quoted and unquoted same-database references, catalog-shaped three-part columns and relations, same-database qualified wildcards, case-mismatched local qualifiers, unchanged external database identities, external-to-local changes, two-part column identifiers, and genuine query-body mismatches.
- R10 verification: focused Driver API scope tests 3/3; full Driver API 192/192; MySQL driver 123 library tests plus 16 non-isolated integration tests (3 isolated-database tests ignored); Host Schema Diff 204/204; related Schema Diff UI/command tests 83/83.
- `cargo fmt --all -- --check` and `git diff --check` pass. This worktree did not run live WDIO; Fresh Tester must rerun the MySQL positive mixed-object journey and missing-dependency zero-write case, plus verify exact fixture cleanup.
