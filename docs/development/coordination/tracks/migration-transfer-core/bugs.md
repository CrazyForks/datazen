# migration-transfer-core bugs

## migration-transfer-core-BUG-001

- 描述：PostgreSQL 连接指定 schema 时，Data Transfer 的表元数据读取仍把裸表名传给 `get_table_schema`。同一数据库的其他 schema 存在同名表时，驱动把这些表的列合并进一个 `TableSchema`。实测选中 schema 的表只有 `selected_id`，读取结果却是 `[selected_id, other_payload]`。
- 状态：待复测
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
