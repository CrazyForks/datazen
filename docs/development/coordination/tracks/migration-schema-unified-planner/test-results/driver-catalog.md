# Driver dependency catalog · independent Tester report

- **判定**：`TEST_FAILED`
- **范围**：Driver API schema dependency catalog、schema-object command parser/DTO、PostgreSQL/MySQL driver live fixtures。
- **测试分支**：`feature/migration-schema-unified-dependency-catalog`
- **起始实现提交**：`ac0c7b410937926505855582264254bc2194b5b3`
- **本轮最后测试提交**：`64eeed252178d584787c71780364223df9ef6284`
- **业务实现改动**：无。只新增了测试断言和 Tester 结果/Bug 记录。

## 独立复验

- `cargo test -p datazen-driver-api -p datazen-driver-postgres -p datazen-driver-mysql --quiet`：**455 passed、0 failed**。三个 crate 的默认单元与非 opt-in 集成测试均通过；依赖 catalog 的 PG/MySQL live fixtures 默认标记为 ignored，因此另行执行。
- PostgreSQL `schema_dependency_catalog` live fixture：**0 passed、1 failed**。失败原因是普通 view 返回了自身作为 dependency，见 BUG-002。将此 exact-set 检查放在最后后，失败前已实际通过 missing/ambiguous identity、opaque routine/constraint-trigger fail-closed、trigger 的 table/function 精确身份、column_type 与 expression/constraint 的自定义类型来源、type/domain/range、owned sequence、BIGSERIAL 双向边以及 FK 主键索引归属断言。
- MySQL `schema_dependency_catalog` live fixture：**1 passed、0 failed**。view 恰有预期的 table 和 function 两条边；缺失 view 与 opaque routine 都 fail closed，MySQL catalog visibility 检查通过。
- PostgreSQL 失败后用只读目录查询确认本轮随机后缀对应的 schema、relation、routine、type 残留计数都是 **0**。
- 对本轨所有改动的 tracked Rust 文件执行 `rustfmt --edition 2021 --check`：通过；`git diff --check`：通过。`cargo fmt --all -- --check` 仍报告生成且 gitignored 的 `src-tauri/src/driver_init.rs` 格式差异；该生成文件不属于此提交，逐文件的 tracked-source 格式检查通过。

编码代理先前报告 PostgreSQL/MySQL live fixture 通过，但原断言只验证预期边“存在”，不会发现额外边。Tester 将 live 断言加强为完整集合比较后，发现 PostgreSQL view 自身边，证明先前通过数字没有覆盖该缺陷。

## 代码审查

逐文件审查了 `packages/driver-api/src/lib.rs`、`schema_dependencies/{mod,mysql,postgres}.rs`、`schema_object_commands.rs` 与 parser tests，以及 PostgreSQL/MySQL 的 schema-object command、SQL 和 live fixture tests。命令在 SQL 查询失败、依赖身份不完整、catalog 可见性不可证明、对象缺失/歧义或遇到不支持对象种类时返回 `complete: false`；PostgreSQL overload 依赖带完整 identity arguments，trigger 边携带附着关系，MySQL view 的完整性要求 catalog grants 与 UDF 可见性证明。没有发现第二个已证实业务缺陷。

## 已登记问题

- `migration-schema-unified-planner-BUG-002`：PostgreSQL view dependency catalog 将 view 自身作为完整依赖边返回。该边会在统一 DAG 中形成自环，使合法 view 计划被判为循环或无法部署。Bug 与检测用例已在 `7259cf9e394dc2b5818e50484fa4596217cab51f` 独立提交。

## 覆盖与后续门槛

本工作区没有安装 `cargo llvm-cov` 或 `cargo tarpaulin`，无法生成改动核心文件的精确行覆盖率；不声称已经达到 80% 硬门槛。当前测试覆盖了主要 dialect SQL、精确身份、类型用途归属、依赖循环及完整性失败路径，集成阶段仍需补出可审计的定量覆盖率结果。

Host/UI 尚在编码；完整 mixed-kind WDIO 部署/读回及无写入失败旅程须待整合后由独立 Tester 验收。本报告只判定 driver catalog 子片，不能代表 Unified Planner 全轨通过，也未运行 black-box-tester。
