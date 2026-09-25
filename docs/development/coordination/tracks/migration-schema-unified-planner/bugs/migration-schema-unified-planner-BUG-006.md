# migration-schema-unified-planner-BUG-006 · MySQL cross-database view plans block before dependency review

- **严重度**：P1（阻断）
- **状态**：修复已合入；round-6 的 MySQL planner 旅程被 BUG-008 阻断，待 BUG-008 修复后复验
- **涉及范围**：统一 Schema Diff Host planner、Driver API schema-object DDL metadata、MySQL view scope mapper

## 描述与重现

Fresh Tester round-4 从 `datazen_sync_mysql_src` 迁移到 `datazen_sync_mysql_tgt` 时，source view 的 DDL 已由 `get_object_ddl` 返回非空，但 unified planner 在建图前以“object DDL is not rewritten across schemas”阻断。测试因此没有生成任何 SQL（0 statements），也无法到达 view→table 的依赖验证；同一 round 的缺失依赖场景同样停在 scope blocker，没有命中应有的精确缺失依赖诊断。

该缺陷阻止轨道要求的 MySQL table/FK/view 正向 mixed journey。简单放开 schema mismatch 会把 source database identity 与 view body 中的 source-qualified relation 带到 target，存在错误目标写入风险。

## Fresh Tester round-4 discovery evidence

- The complete WDIO run was 4 passed / 1 failed: PostgreSQL positive and blocked journeys passed, MySQL catalog smoke found all four object kinds, and the MySQL positive migration remained blocked at the cross-scope guard. The MySQL missing-dependency case hit that same guard, so it did not yet verify the intended dependency diagnostic.
- All five random fixture journeys cleaned their source and target catalogs to exact 0/0 counts. Direct MySQL view DDL retrieval succeeded, confirming that the remaining failure was in planning rather than catalog discovery or DDL extraction.
- Detailed evidence: [round-4 retest report](../test-results/unified-planner-retest-r4.md).

## Fresh Tester round-6 evidence

- PostgreSQL positive and blocked journeys passed. Both MySQL planner journeys failed earlier in live view DDL extraction because BUG-008 rejects MySQL's equivalent same-database qualification normalization; the MySQL missing-dependency diagnostic and mixed deploy/readback are therefore still unverified.
- The MySQL four-kind catalog journey passed. All six source/target fixture pairs, including the metadata-negative journey, ended at exact 0/0 after teardown. See the [round-6 retest report](../test-results/unified-planner-retest-r6.md).

## 修复设计与安全边界

- MySQL renderer 提供 additive、driver-owned scope mapping contract。Host 只传入已配置 source scope、target scope、完整 catalog dependency identities 及 source→target exact identity pairs；Host 不拼 SQL，也不做裸字符串替换。
- MySQL driver 用 SQL AST 识别 relation token，只改写 catalog 证明的本地 source database 标识及已选表的精确名称映射。字符串和注释保持不变；三段标识、未证明的限定依赖、完整 catalog 中缺失的未限定 relation、CTE 与 catalog relation 的歧义均 fail closed。明确的 external qualified identity 保持原样。
- 计划在依赖图校验前同步映射本地 view dependency identities，未选依赖仍需 target snapshot 证明存在；映射后缺失的依赖显示精确 target identity blocker，不能生成可执行 SQL。
- MySQL `VIEW_DEFINITION` 不包含完整创建语义。Driver 同时读取 `SHOW CREATE VIEW`，解析并交叉核对 query body，捕获 algorithm 和显式列清单；另读取 definer、security type、check option、client character set 与 connection collation。统一 planner 和旧 object-only view planner 对 source 及被选中的 target view 都只接受 renderer 可等价表达的 `ALGORITHM=UNDEFINED`、无显式列清单、`SQL SECURITY DEFINER`、`CHECK_OPTION=NONE`，并要求 definer/字符集/collation 与 target 创建会话完全相同。缺失或非默认 metadata 阻断部署；target context 在 deploy 前重新读取，source metadata 进入 source snapshot freshness validation。
- 跨方言继续阻断；routine、trigger、custom type、sequence 的跨 scope 迁移继续 fail closed。view 的有效支持范围是由完整 dependency catalog 证明的 MySQL view query，不代表所有 MySQL CREATE VIEW 选项均可迁移。

## 验收证据

- MySQL driver 单测覆盖 source-qualified/local/external relation、unqualified rename、字符串/注释不改写、缺失 relation、CTE 冲突、unsupported relation 及 target-qualified CREATE/rollback SQL。
- Host tests 覆盖 source→target identity 映射、缺失 dependency 精确 blocker、source scope mismatch、same-scope 与 cross-scope metadata gate、target view metadata blocker、definer/context mismatch，以及 metadata freshness。
- Driver API tests 覆盖 `SHOW CREATE VIEW` 算法/显式列清单解析、与 `VIEW_DEFINITION` query-body 一致性校验和 required catalog metadata。
- 真实 WDIO 正向/负向混合旅程与精确 fixture 清理由 Fresh Tester 合并后复验；本文件不宣称该独立验收已通过。

## 修复与编码验证

- 已增加 MySQL driver-owned schema scope mapper 与 Host 统一计划接线，保留 cross-dialect 和其他对象种类的 fail-closed 边界；source/target view 创建语义与目标会话上下文在计划及 deploy freshness 中校验。
- 本轨测试通过：Host Schema Diff 204/204；Driver API 174/174；MySQL driver library 123/123；MySQL `schema_objects_sql` integration 8/8；`cargo fmt --all -- --check` 与 `git diff --check` 通过。
- 编码 worktree 未运行真实数据库 WDIO journey。新的独立 Tester 仍需验证同一 reviewed plan 的正向混合创建/读回、缺失依赖零写入和精确 fixture 清理。
