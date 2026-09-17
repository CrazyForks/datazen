# migration-transfer-plan Bugs

## migration-transfer-plan-BUG-001

- 状态：待复测
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
