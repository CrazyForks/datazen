# redis-kv-context-bar-BUG-001 · Compact layout drops the mandatory sampled-distribution marker

- **严重度**：P1（Redis 类型分布在窄布局中被呈现得像完整统计）
- **状态**：待复测
- **涉及文件**：`packages/drivers/redis/ui/kv-bar/ContextBarActions.tsx`、`packages/drivers/redis/ui/__tests__/redisContextBar.test.tsx`
- **描述**：PRD §3.4 要求当 `sampled < dbsize` 时，类型 chips 组尾必须显示采样标记。完整布局渲染 `redis-context-types-sampled`，但 `compact` 把 chips 搬进 `OverflowRow` 时只拼接 `type count`，完全丢弃 `types.sample`。例如只统计到 48/100 个键时，菜单只显示 `string 30`，用户看不到这是抽样值，可能将近似分布当作精确统计。量级：所有 `compact=true` 且 `sampled < dbsize` 的 Redis 面板都会触发。
- **重现步骤**：
  1. 渲染 `RedisContextBar`，传 `compact: true`。
  2. 令 `type_distribution` 返回 `{ counts: { string: 30 }, sampled: 48, dbsize: 100, truncated: true }`。
  3. 检查 `redis-context-overflow-types` 内是否包含 `data-i18n-key="redis.contextBar.sampled"` 的标记；当前不存在。
- **实测错误日志**（Tester 新增断言）：
  ```text
  npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/redisContextBar.test.tsx -t '\\[tester\\] keeps the mandatory sample marker with compact overflow chips'
  FAIL [tester] keeps the mandatory sample marker with compact overflow chips
  AssertionError: expected null not to be null
  redisContextBar.test.tsx:746
  Test Files 1 failed (1); Tests 1 failed | 47 skipped (48)
  ```
- **影响范围**：紧凑布局的类型分布缺少 PRD 强制的数据可靠性标注；宽布局不受影响。GUI 真机走查仍需在 R 阶段验证布局触发条件。

## 修复记录（round-1）

- 修复 commit：`392e851aa`。
- 修复：compact overflow 保留 `types.sample`，并在 chips 行尾渲染带 `data-i18n-key="redis.contextBar.sampled"` 的采样标记；标记沿用模型中的 `sampled` / `dbsize` 和本地化词条。
- 验证：`npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/redisContextBar.test.tsx`（49/49）；完整 drivers UI 套件（63 files / 876 tests）通过；`npx --no-install tsc --noEmit` 通过。
- 独立复测入口：运行上述 targeted 用例及完整 `npx vitest run --config vitest.drivers.config.ts`，重点确认 `[tester] keeps the mandatory sample marker with compact overflow`。
