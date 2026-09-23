# redis-kv-context-bar-BUG-002 · Compact memory overflow loses the unlimited-memory label

- **严重度**：P2（窄布局下内存上限状态含义不清）
- **状态**：待复测
- **涉及文件**：`packages/drivers/redis/ui/kv-bar/ContextBarActions.tsx`、`packages/drivers/redis/ui/__tests__/redisContextBar.test.tsx`
- **描述**：Redis `maxmemory=0` 表示不限制内存。正常布局使用 `redis.contextBar.memoryUnlimited` 明确呈现此含义；紧凑布局的 overflow row 却始终使用 `redis.contextBar.memory`，并把 `max` 替换为 `—`。所以 compact 用户只能看到省略号，无法知道是无上限还是数据缺失，违反 PRD §3.4 的 `used/max` 语义及本轨数据模型对 unlimited 的明确表示。量级：所有 `compact=true` 且 `maxBytes === null` 的面板都会触发（包括 `maxmemory=0` 和字段缺失）。
- **重现步骤**：
  1. 渲染 `RedisContextBar`，传 `compact: true`。
  2. 令 `info_filtered` 的 memory section 返回 `used_memory=1258291`、`maxmemory=0`。
  3. 检查 `redis-context-overflow-memory` 的 `data-i18n-key`；当前值为 `redis.contextBar.memory`，应使用 `redis.contextBar.memoryUnlimited`。
- **实测错误日志**（Tester 新增断言）：
  ```text
  npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/redisContextBar.test.tsx -t '\\[tester\\] preserves the no-limit memory meaning in compact overflow'
  FAIL [tester] preserves the no-limit memory meaning in compact overflow
  AssertionError: expected 'redis.contextBar.memory' to be 'redis.contextBar.memoryUnlimited'
  redisContextBar.test.tsx:765
  Test Files 1 failed (1); Tests 1 failed | 48 skipped (49)
  ```
- **影响范围**：仅紧凑布局的 memory overflow 文案语义不完整；宽布局仍能显示无上限。真机布局触发条件留待 R 阶段确认。

## 修复记录（round-1）

- 修复 commit：`392e851aa`。
- 修复：compact overflow 根据 `maxBytes` 选择普通 memory 或 `memoryUnlimited` 词条；无上限时不再渲染占位的最大值。
- 验证：`npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/redisContextBar.test.tsx`（49/49）；完整 drivers UI 套件（63 files / 876 tests）通过；`npx --no-install tsc --noEmit` 通过。
- 独立复测入口：运行上述 targeted 用例及完整 `npx vitest run --config vitest.drivers.config.ts`，重点确认 `[tester] preserves the no-limit memory meaning in compact overflow`。
