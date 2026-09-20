# Track: fix-redis-tests — Redis 驱动 UI 5 个已知红色测试修复

- 分支: `feature/fix-redis-tests`（基准 `feat/driver-decoupling` @ 040e15bde）
- 角色: Coder → Tester

## 背景

`npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` 基线为 **213 pass / 5 fail**。5 个失败均为主线已知环境性/接线性问题（main 上同样红）。

## 范围（仅这 5 个用例，不做范围外改动）

1. **DecompressionStream 缺失（3 例）**：`ui/value-editors/stringKeyValue.ts` 的 `tryDecompressString`/相关测试在 jsdom 下 `typeof DecompressionStream === 'undefined'` 直接返回 null。修复：在测试 setup（或测试文件内）用 `node:stream/web` 的 `CompressionStream`/`DecompressionStream` 注入 globalThis polyfill，使 gzip 解压路径可测。**不改生产逻辑**。
2. **redisWorkbench.test.tsx（2 例）**：未 mock 完整 invoke 链导致真实 invoke 泄漏 → TypeError；且缺 `clearAllMocks` 导致 hash_set 调用跨用例泄漏。修复：补齐 `invokeRename`/相关 driver command mock + `beforeEach(() => vi.clearAllMocks())`。

## 验收标准

- 上述 5 例全部转绿；`packages/drivers/redis/ui` 套件的其余 213 例保持绿（合计 218 pass / 0 fail）。
- `npx tsc --noEmit -p tsconfig.json` 通过。
- 不修改 `stringKeyValue.ts` 生产分支逻辑（仅测试侧 polyfill/接线）。

## 状态

- [x] Coder 完成 → READY_FOR_TEST
- [ ] Tester 复测 → TEST_DONE

## Coder 记录（READY_FOR_TEST）

- `stringKeyValue.test.ts`：测试顶部注入 `node:stream/web` 的 Compression/DecompressionStream（兜底）+ jsdom `Blob.prototype.stream` 最小 polyfill。诊断确认真正缺口是 jsdom Blob 无 `stream()`（DecompressionStream 在 vitest 环境已存在），生产代码 `stringKeyValue.ts` 零改动。
- `redisWorkbench.test.tsx`：`invokeSetString` 按新签名补 `keepTtl` 实参接线（此前 invoke 被当作 keepTtl 传入导致真实 IPC 泄漏 TypeError）；两处 `set_string` 断言补 `keepTtl: false`（与现行为一致，未弱化）；新增 `beforeEach(() => vi.clearAllMocks())`。
- 验收：`packages/drivers/redis/ui` 218 pass / 0 fail；`npx tsc --noEmit -p tsconfig.json` 通过。

## 留待 R 回归

- 无新增 E2E 用例（纯单测修复）。
