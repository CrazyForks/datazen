# Bugs

## migration-schema-constraints-options-BUG-001

- 描述：MySQL `SHOW CREATE TABLE` CHECK 解析器按行直接寻找大写 `CHECK`，没有在寻找关键字前跳过 SQL 字符串。列默认值中包含 `CHECK (...)` 时会被错误识别为一个额外的 CHECK 约束。
- 量级：P1，Schema Diff 会展示不存在的约束，并可能生成错误的 DROP CHECK 计划；真实数据库结构比对结果不正确。
- 状态：待复测
- 重现步骤：
  1. 调用 `MysqlDriver::parse_check_from_create_table`，输入 `CREATE TABLE users (\n  note varchar(64) DEFAULT 'CHECK (literal)',\n  CONSTRAINT users_age_check CHECK (age >= 0)\n)` 的 SHOW CREATE TABLE 形态。
  2. 观察解析结果。
- 实测错误日志：`test_tester_check_parser_ignores_default_literal_before_real_check` 断言失败，实际 `checks.len() == 2`，期望 `1`。
- 影响范围：MySQL/MariaDB 表结构读取、Schema Diff CHECK 结果和后续迁移计划。

## migration-schema-constraints-options-BUG-002

- 描述：SQLite CHECK 解析器没有跳过 SQL 注释。建表 SQL 注释中包含 `CHECK (...)` 时会被错误识别为约束。
- 量级：P1，Schema Diff 会展示错误的 CHECK 约束；SQLite 迁移虽然当前对 CHECK 变更 fail-closed，但比较结果仍然错误。
- 状态：待复测
- 重现步骤：
  1. 调用 `parse_sqlite_check_constraints`，输入 `CREATE TABLE users (id INTEGER /* CHECK (comment_only) */, CHECK (id > 0))`。
  2. 观察解析结果。
- 实测错误日志：`test_tester_check_parser_ignores_sql_comments` 断言失败，实际 `checks.len() == 2`，期望 `1`。
- 影响范围：SQLite 表结构读取、Schema Diff CHECK 结果和 fail-closed 要求提示。
