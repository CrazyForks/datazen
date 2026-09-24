# migration-transfer-unknown-outcome-fence-BUG-003 · 缺少真实跨库 commit acknowledgement loss 验证

- **严重度**：P2（发布阻断：关键跨库未知结果路径没有候选构建上的端到端证据）
- **状态**：待修复
- **涉及文件**：
  - `packages/drivers/postgres/e2e/data-transfer-rollback-continue-pg-mysql.ts`
  - `packages/drivers/mysql/e2e/data-transfer-rollback-continue-mysql-pg.ts`
  - `src-tauri/src/data_transfer/execute.rs`
  - `src-tauri/src/commands/data_transfer/exec.rs`
  - `src-tauri/src/data_transfer/model.rs`
- **描述**：候选提交包含 Rust mock 中的 commit/rollback acknowledgement-loss 测试，但新增的两个方向性 WDIO journey 只触发普通主键冲突，验证确认回滚后继续写入后续表。它们不制造提交已生效但响应丢失（或提交未生效但响应丢失），也不验证跨 PG↔MySQL unknown outcome 下无后续写入、旧计划不可重放、history 标记 unknown、旧 resume token 被失效，以及目标端读回结果。普通约束错误不能代表 acknowledgement loss。缺少该集成证据时，无法确认真实驱动/事务栈的边界行为与 UI/history 状态满足此轨验收条件。
- **重现步骤**：
  1. 检查候选 `750f65e2f5cc5772d4d1c0ac90cf41cb246a3aa1` 的上述两个 WDIO spec；均只包含已知约束冲突和后续表成功写入。
  2. 搜索 spec 和被调用测试命令，确认没有 commit/rollback acknowledgement-loss 控制点，也没有未知 history、token invalidation、plan replay 或对应 readback 断言。
  3. 运行独立 Tester 的 `pnpm tauri:build:webdriver`：候选构建在 Tauri `beforeBuildCommand` 的 Host TypeScript 检查处退出，报告 `ConnectionPage.tsx:718` 参数数量错误及 `PanelContentRenderer.tsx:100` 的 `kvSlotState` 类型错误；因此没有可证明来自候选的 app 可供安全 WDIO 验证。已有调试 app 比候选提交早，不能作为该提交的证据。
- **实测证据**：
  - 独立确认当前两个 spec 是安全、唯一 fixture 的 confirmed-rollback journey；未运行它们，因为没有 candidate-provenance app。
  - focused Rust: 151/151；Rust 改动可执行行覆盖率：354/409（86.55%）。focused UI：44/44。上述检查不能替代真实 PG↔MySQL acknowledgement-loss journey。
  - 没有运行 WDIO、启动旧 app、创建 DB fixture 或 DATAZEN_DATA_DIR。
- **修复要求**：由原 Coder 增加仅测试构建可用、可控且可观察的 commit-acknowledgement-loss 注入路径；为 PostgreSQL→MySQL 和 MySQL→PostgreSQL 各新增使用唯一 fixture 的真实数据库 WDIO journey。覆盖提交响应丢失后立即停止所有后续写入、旧计划不可重放、history outcome 为 unknown、先前 resume token 被失效、以及目标端读回；覆盖注入动作之后的最终副作用观察，但不得根据常规 constraint failure 推断未知结果。修复后由全新 Tester 在候选构建上直接运行指定 specs 并验证 fixture/数据目录清理。

## 复测记录

本轮没有复测，因为候选 webdriver 构建被上述既有 Host 类型错误阻断，且没有可安全使用的候选 app。当前状态保持 `待修复`。
