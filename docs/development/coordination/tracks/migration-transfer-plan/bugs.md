# migration-transfer-plan Bugs

## migration-transfer-plan-BUG-001

- 状态：已修复（独立 Tester Round 2）
- 严重度：P1（合法 Transfer 计划无法执行）
- 描述：Preview 为已存在但被用户禁用的目标表记录 `None`，Execution 重新计算指纹时却无条件读取该目标表并记录实际 schema，导致同一个未改变的计划被错误判定为 schema stale。
- 重现步骤：
  1. 在同一 source/target session 上准备两个现有表 `users` 与 `archived`。
  2. Preview 一个包含 enabled `users` 和 disabled `archived` 的 Data/Insert TransferJob。
  3. 不改变任何 session、driver 或表结构，使用 preview 返回的 `planId` 执行。
- 实测结果：命令返回 `Validation("source or target schema changed since preview; return to comparison")`，target 没有执行写入。
- 失败测试：`commands::data_transfer::tests::test_tester_disabled_existing_table_does_not_invalidate_plan`
- 复现命令：`CARGO_TARGET_DIR=target/cargo-wt pnpm_config_verify_deps_before_run=warn cargo test -p datazen --lib data_transfer`
- 影响范围：任何包含 disabled、unmapped 或其他未纳入 preview target schema 快照但在 execution 指纹循环中仍被读取的 mapping；用户无法执行部分表选择。
- 建议修复方向：Preview 与 Execution 使用同一套参与计划指纹的 enabled/eligible relation 集合，或在计划中持久化每个 relation 的参与状态并按该状态重新校验；不能让 `None` 与实际 schema 在两阶段采用不同规则。
- 修复说明：计划签发与执行前复用服务器端 `participating_tables` 作用域，只对 preview 时 enabled 的 mapping 生成和复核指纹。disabled mapping 不再因为 execution 阶段可读取到实际 target schema 而改变计划有效性；enabled mapping 的 schema 变化仍会 fail closed。
- 验证记录：2026-09-17 独立复测 Host `data_transfer` 50/50；原 disabled-existing-target journey 通过；补充 disabled relation fingerprint 变更测试通过；计划 contract 的真实 AppState 路径无目标写入前误判。

## migration-transfer-plan-BUG-002

- 状态：已修复（独立 Tester Round 3）
- 严重度：P1（跨方言结构映射页面无法完成）
- 描述：MySQL→PostgreSQL 的 structure/create-new 映射旅程在列映射页没有渲染 `active` 列的目标类型输入，用户无法按预期确认或修改 TINYINT→boolean 映射，后续 Preview DDL 验收无法继续。
- 重现步骤：
  1. 准备 MySQL `datazen_sync_mysql_tgt` 与 PostgreSQL `datazen_sync_tgt`。
  2. 新建 MySQL 源表，包含 `id BIGINT`、`active TINYINT(1)`、`meta JSON`、`created_at DATETIME`。
  3. 打开 Data Transfer，选择 MySQL→PostgreSQL，进入 structure 模式。
  4. 选中源表，进入 Mapping，勾选 Create New，并离开目标表输入框触发重新 inspect。
  5. 查找 `[data-testid="data-transfer-target-type-active"]`。
- 实测结果：元素在 15 秒内未出现，WebDriver 报错：`element ("[data-testid="data-transfer-target-type-active"]") still not displayed after 15000ms`。
- 影响范围：`e2e/specs/data-transfer-type-mapping-mysql-pg.ts` 的 DT-TYPE-MYSQL-PG-001；属于 Transfer mapping UI/inspect 路径。
- 修复说明：自动发现的 create-new mapping 在结构模式下默认保持未选中，避免把所有 source table 一并带入 Mapping 页；disabled create-new inspect row 仍生成完整 source column mappings，用户勾选后由跨方言 adapter 补齐每列 target native type。这样 `TINYINT(1) active` 与其他可映射源列都会进入 Mapping、Preview DDL 和执行使用的同一 column mapping。
- 验证记录：正式 `DT-TYPE-MYSQL-PG-001` 在重建 webdriver bundle 后 1/1 通过，包含 active 类型输入、created_at 类型输入及 Preview DDL；Host Transfer 51/51、前端 Transfer 25/25、TypeScript 检查通过。
- 独立复测（2026-09-17）：`DT-TYPE-MYSQL-PG-001` 1/1 通过；`data-transfer` 桌面套件 7 个 spec 通过、1 个失败，唯一失败为已登记且暂不处理的 BUG-003；新增 mapping view 状态测试 2/2 通过。PostgreSQL 101、MySQL 86、SQLite 46 驱动测试通过；WebDriver 正式构建通过。

## migration-transfer-plan-BUG-003

- 状态：待修复（范围外，待转交 migration-transfer-core）
- 严重度：P2（大批量跨方言传输无法在既定超时内完成）
- 描述：PG→MySQL 25,000 行、19 列宽类型 Data Transfer 旅程在点击执行后 120 秒内没有进入结果页；同一 suite 的 MySQL→PG 25,000 行旅程通过，说明问题集中在 PG→MySQL 执行性能或终态状态推进。
- 重现步骤：
  1. 准备 `datazen_sync_src` 与 `datazen_sync_mysql_tgt`。
  2. 创建 PG 宽类型表并写入 25,000 行，创建同结构 MySQL 目标表。
  3. 打开 Data Transfer，选择 PG→MySQL，data 模式，选择该表并执行。
  4. 等待结果页最多 120 秒。
- 实测结果：结果元素未出现；WebDriver 报错：`element ("[data-testid="data-transfer-result"]") still not displayed after 120000ms`。本次运行日志同时记录 MySQL 目标宽表查询返回 25,000 行、耗时 1.629869917 秒。
- 影响范围：`e2e/specs/data-transfer-diverse-types.ts` 的 DT-COMP-001；大批量 PG→MySQL 用户旅程。immutable plan 本轮未修改批量写入/结果页业务路径。
