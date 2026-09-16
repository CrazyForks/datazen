# migration-transfer-core bugs

## migration-transfer-core-BUG-001

- 描述：PostgreSQL 连接指定 schema 时，Data Transfer 的表元数据读取仍把裸表名传给 `get_table_schema`。同一数据库的其他 schema 存在同名表时，驱动把这些表的列合并进一个 `TableSchema`。实测选中 schema 的表只有 `selected_id`，读取结果却是 `[selected_id, other_payload]`。
- 状态：已修复（独立 Tester Round 2）
- 量级：阻断；映射检查、目标参数类型选择和结构预览可能基于错误表结构，可能造成错误阻断或把值写入错误类型的目标列。
- 重现步骤：
  1. 在隔离数据库创建两个 schema，并在两者创建同名、不同列的表。
  2. 使用 `ConnectionConfig.schema = selected_schema` 建立 PostgreSQL 连接。
  3. 调用 `get_table_schema(handle, bare_table_name)`。
  4. 运行：`cargo test -p datazen-driver-postgres --test migration_schema_qualification -- --ignored`（设置 `MIGRATION_TEST_*` 指向 `dz_mig_0910_transfer_src`）。
- 实测错误：`left: ["selected_id", "other_payload"]`, `right: ["selected_id"]`。
- 影响范围：`inspect_data_transfer_impl`、preview/execute source schema 读取和 bound writer target schema 读取均传裸表名；显式 schema 的 PostgreSQL Data Transfer 不可信。

## 已独立验证通过

- F02/F04/F07/F08/F11 的默认 schema 路径通过 Host 单测、PG/MySQL exact-binary E2E 和 SQLite 驱动旅程。
- 私有 tagged spool 的 JSON/Bytes/Timestamp/Float bits 分支通过单元测试；真实 PG/MySQL bytes 与 65 位 numeric/decimal 逐值通过。

## BUG001 coder repair (2026-09-16)
- Unified every Transfer get_table_schema call behind metadata::load_table_schema; inspect/preview/execute and bound target writer use normalized Endpoint.schema, falling back to ConnectionConfig.schema at the command boundary.
- Database/catalog remains independent; unscoped MySQL/SQLite metadata stays bare. Table listings are filtered by explicit schema when the driver supplies TableInfo.schema.
- Full-type enrichment uses the same scoped relation; PostgreSQL adapter quotes regclass components internally, preserving mixed case and literal dots in the table name. Host never prequotes metadata strings.
- Schema names containing a dot are explicitly rejected because the current split-once metadata contract cannot represent them unambiguously. Structured schema identifiers remain a separate contract change.
- Host mock asserts source_scope.same_table and target_scope.same_table requests. Real PG probe now exercises the approved explicit qualified caller contract (not implicit bare-name driver behavior), with two schemas, same-name table, mixed-case schema and table name containing a dot.
- Self-validation: Host 36/36; driver libs MySQL 86/86, PG 101/101, SQLite 46/46; PG schema regression 1/1; real PG/MySQL bound writes 1/1 each; SQLite transfer journey 1/1; frontend 18/18 and tsc passed. Independent tester rerun required.

## migration-transfer-core-BUG-002

- 描述：同一 `dbSessionId`、同一 database/catalog、不同 schema 的同名表被执行层误判为同一物理表。Inspect 的数据库自目标检查会区分 schema，因此该作业能进入预览/执行；但 `is_self_table_overwrite` 只比较 session、database 和表名，忽略 source/target schema，最终以 `self-overwrite ... is not allowed` 错误拒绝合法的跨 schema 传输。
- 状态：已修复（独立 Tester Round 3）
- 量级：阻断；PostgreSQL 等支持 schema 的数据库无法在同一连接/数据库内把 `source_schema.same_table` 传到 `target_schema.same_table`，与本轮 schema-qualified 元数据契约不一致。
- 重现步骤：
  1. 构造同一 session、同一 catalog，source schema=`source_schema`、target schema=`target_schema`，source/target 表名均为 `same_table` 的 Data Transfer 作业。
  2. 运行：`CARGO_TARGET_DIR="$PWD/target/cargo-wt" cargo test -p datazen --lib data_transfer::execution_tests::test_tester_same_session_same_catalog_different_schemas_can_transfer_same_table_name -- --exact --nocapture`。
  3. 预期：两端关系不同，允许传输并提交 1 行；实测：在任何目标写入前错误返回自覆盖校验失败。
- 实测错误：`Validation("self-overwrite of table 'same_table' is not allowed")`；失败断言位于 Tester 新增的连续执行复现。
- 影响范围：`execute_transfer_data` 的 data-only / structure-and-data 写入路径；同 session 跨 schema 同名表。不同连接的 BUG001 资格读取与 PG/MySQL 独立传输不受此缺陷影响。

## Independent Tester Round 2 closure for BUG001

- Host `data_transfer` 原套件 36/36 通过；新增含点 target schema fail-closed 测试 1/1 通过，确认 metadata 未调用且 bound write 次数为 0。
- PostgreSQL 真实资格测试 1/1：大小写 schema、两个 schema 同名但异构的表、表名含字面点、full-column-types 仅返回选中 schema 的 `selected_id`。
- MySQL 的 catalog/database 不作为 schema：Host 元数据契约测试通过，并由真实 MySQL 两数据库 WebDriver 传输验证。
- BUG001 通过独立复测并关闭；Round 2 最终仍因新发现 BUG002 判定失败。

## BUG002 coder repair (2026-09-16)
- Self-overwrite now compares the complete logical relation: dbSessionId, database/catalog, normalized schema, and table name. Database/catalog never substitutes for schema; no driver-family branch added.
- Kept the Tester regression unchanged. Added same-relation rejection before metadata/writes, schema whitespace/empty normalization, distinct catalog, distinct session, and renamed-table checks.
- Self-validation: Host transfer 39/39 (including Tester regression), driver libraries MySQL 86 / PostgreSQL 101 / SQLite 46, SQLite transfer journey 1/1, frontend 24/24, tsc and diff checks passed.
- Pending independent retest; no new desktop E2E claim. Physical identity across connection aliases remains outside BUG002 scope.

## Independent Tester Round 3 closure for BUG002

- 原失败用例通过：同一 session/catalog、不同 schema、同表名完成 1 行提交；同一归一化 schema 则在任何 target metadata 或 bound write 前 fail-closed。
- 身份判定逐分支覆盖 session、catalog/database、normalized schema 与 table；显式 schema 与连接回退 schema 均在命令边界归一化后进入同一比较，catalog/database 没有被代作 schema。
- Host Transfer 39/39、前端 24/24、tsc、PostgreSQL 101/101、MySQL 86/86、SQLite 46/46 均通过。真实 PostgreSQL schema qualification、PostgreSQL/MySQL bound write、SQLite transfer journey 各 1/1 通过。
- BUG001 未回归，BUG002 通过独立复测并关闭。本轮实现差异仅为 Host 纯身份判定，因此未重复 Round 2 已通过的正式 WebDriver build 与 PostgreSQL/MySQL 精确桌面旅程；相关二进制证据继续有效。
