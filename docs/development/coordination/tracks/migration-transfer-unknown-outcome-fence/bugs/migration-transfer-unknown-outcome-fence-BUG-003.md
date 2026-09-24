# migration-transfer-unknown-outcome-fence-BUG-003 · 缺少真实跨库 commit acknowledgement loss 验证

- **严重度**：P2（发布阻断：关键跨库未知结果路径需要独立候选复测）
- **状态**：READY_FOR_TEST
- **涉及文件**：
  - `src-tauri/src/data_transfer/execute.rs`
  - `src-tauri/src/commands/data_transfer/mod.rs`
  - `src-tauri/src/bootstrap/run.rs`
  - `src/commands/transfer.ts`
  - `packages/drivers/postgres/e2e/data-transfer-commit-ack-loss-pg-mysql.ts`
  - `packages/drivers/mysql/e2e/data-transfer-commit-ack-loss-mysql-pg.ts`

## 缺陷

Rust mock 能验证 commit/rollback acknowledgement loss 的状态机，但真实 PG↔MySQL WDIO 旅程此前只触发普通主键冲突。常规约束失败不能证明提交响应丢失后的未知结果、停止后续写入、计划/检查点失效、历史 outcome 和目标端实际状态。

## 修复与边界

增加仅在测试和 debug WebDriver 构建中可用的精确目标表一次性 fault seam。它先调用真实目标驱动的 `commit`；仅当该调用成功返回后才丢弃 acknowledgement 并返回 typed `unknown`。这是受控的 commit-ack 边界注入，不是真实网络分区。Release 构建不包含 arm/reset IPC、全局故障状态或环境变量开关。

前端的被动调用记录只在 `VITE_E2E` 构建且 WDIO 明确安装 recorder 时记录原始请求与响应，不替换 IPC、不伪造结果。两条方向旅程使用不同且唯一的数据库、表和连接配置；MySQL 表显式指定 InnoDB。清理仅删除本轮生成的数据库/连接配置和私有 app-data。

## 候选验证

- PG→MySQL: 1 个 WDIO journey 通过。
- MySQL→PG: 1 个 WDIO journey 通过。
- 两方向均断言真实请求报告 `unknown` 且行数为 `null`，后续表为 `notStarted` 且目标未写入；回读确认未知表的目标事务实际已提交；Transfer 历史为 `unknown`；无 resume token/UI 恢复操作；旧计划和旧检查点请求重放均被拒绝。
- 使用候选 `pnpm tauri:build:webdriver` 产物；可执行文件 SHA-256：`c31f3f2b2350a6b8cbb92dddaa7c4dba64f350a75f9def69a71497cf536862f8`。构建产出 app 与可执行文件，最终失败仅发生在用户排除的 DMG 打包步骤。
- WDIO 后 PostgreSQL 与 MySQL catalog 均无 `dz_dt_ack_%` fixture 数据库；候选进程已停止，4445 端口已释放，两个私有测试 app-data 目录已删除。

独立 Tester 应从该提交重建候选、核验二进制 provenance，并串行复测两条 ack-loss 旅程及已有 confirmed-rollback/continue journeys。未确认真实网络中断行为；验证范围明确限于真实数据库驱动 commit 成功返回之后的受控 acknowledgement-loss 注入。
