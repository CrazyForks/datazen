# Track: types-to-sdk — KV/表单共享类型下沉 @datazen/driver-sdk

- 分支: `feature/types-to-sdk`（基准 `feat/driver-decoupling` @ 040e15bde）
- 角色: Coder → Tester

## 背景

驱动 UI 直接 import 宿主 `src/types` 的共享数据类型（redis ui 约 4 处），违反"驱动不得引用 host 代码"。方案第 2 步：把**纯数据类型（type-only）**下沉到 `@datazen/driver-sdk`，宿主改为从 driver-sdk 再导出以兼容存量代码。注意：`packages/driver-sdk/src/index.ts` 目前也有从 `src/**` re-export 的违规值（driverCommands、BaseTableSqlGenerator），**那些是值依赖，属于后续 cap-bridge 轨，本轨不碰**。

## 范围

1. 已盘点 `packages/drivers/*/ui/**` 中所有 **type-only** 宿主类型 import（`import type ... from '.../src/...'`），范围即以下集合：
   - `KeyEntry`（`src/types`；被 `key-browser/useRedisKeyScan.ts`、`key-browser/keyTree.ts` 及 `__tests__/keyTree.test.ts` 引用）
   - `KeyScanResult`（`src/types`；被 `shared/redisInvoke.ts` 引用）
   - `ConnectionFormState`（宿主定义在 `src/components/connection/useConnectionForm.tsx`；被 redis `connection/ConnectionWizard.tsx`、sqlserver `ui/ConnectionFields.tsx` 及 `__tests__/connectionWizard.test.tsx` 引用）→ 类型定义移入 driver-sdk，宿主 useConnectionForm 改从 driver-sdk import 并再导出以兼容。
   - `NativeMenuItemDef`（`src/lib/nativeContextMenu`；被 `key-browser/redisKeyContextMenu.ts` 引用）→ 仅移 type/interface，`showNativeContextMenu` 值函数属于 cap-bridge 轨，**不碰**。
   - `ConnectionViewProps`（`src/lib/connectionViews/types`；被 `connection/RedisConnectionView.tsx` 引用）→ 移入 driver-sdk，宿主再导出。
2. 将上述类型定义**移动**（非复制）到 `packages/driver-sdk/src/`（建议 `types/kv.ts`、`types/connection.ts` 等，遵循 driver-sdk 现有目录风格），并从 driver-sdk `index.ts` 导出。
3. 宿主源文件改为从 `@datazen/driver-sdk` import 并 `export type { ... }` 再导出，保证宿主存量 import 零改动。
4. 驱动侧 import 改为 `@datazen/driver-sdk`（含驱动 `__tests__` 里的 `import type` 行——仅改 import 路径这一行，不动测试其余内容）。

## 禁止事项（防跨轨冲突）

- 不动 `src/lib/cn`、`packages/ui`（cn-to-ui 轨范围）。
- 不改 driver-sdk 中对宿主**值**（函数/类）的 re-export（cap-bridge 轨范围）。
- 不动 redis ui 的测试文件（fix-redis-tests 轨范围）；若驱动 ui 源码 import 更新牵连某测试文件的 mock 字符串路径，仅限最小同步并在 progress 记录。

## 验收标准

- Grep `packages/drivers/*/ui` 检索 `import type .* from ['"].*src/` 结果为 0（值 import 如 useI18n/cn/settingsStore 允许残留，属其他轨范围）。
- `npx tsc --noEmit -p tsconfig.json` 通过（宿主 + 驱动均绿）。
- `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` 维持基线 213 pass / 5 fail。

## 状态

- [x] Coder 完成 → READY_FOR_TEST
- [ ] Tester 复测 → TEST_DONE

## Coder 实施记录（2026-09-20）

类型最终落点（均为**移动**，宿主原位置改 re-export，宿主存量 import 零改动）：

| 类型 | 新定义位置 | 宿主 re-export 出口 |
| --- | --- | --- |
| `KeyEntry` / `KeyScanResult` | `packages/driver-sdk/src/types/kv.ts` | `src/types/index.ts` |
| `NativeMenuItemDef`（连带 `NativeMenuPredefined`） | `packages/driver-sdk/src/types/menu.ts` | `src/lib/nativeContextMenu.ts`（值函数 `showNativeContextMenu` 等未动，属 cap-bridge 轨） |
| `ConnectionFormState` | `packages/driver-sdk/src/types/connection-form.ts`（由 `ReturnType<typeof useConnectionForm>` 改为自包含 interface，宿主 hook 显式标注 `): ConnectionFormState` 保证结构一致） | `src/components/connection/useConnectionForm.ts` |
| `ConnectionViewProps`（连带同文件强关联的 `NodeContextMenuPayload` / `ConnectionOpenTarget` / `ConnectionViewActions`） | `packages/driver-sdk/src/types/connection-view.ts` | `src/lib/connectionViews/types.ts` |

驱动侧改 import 共 9 行（redis ui 7 处 + sqlserver `ui/ConnectionFields.tsx` + `__tests__/connectionWizard.test.tsx`、`__tests__/keyTree.test.ts` 各 1 行 import 路径，测试其余内容未动）。

driver-sdk 新目录 `src/types/*.ts` 内部仍经 `'../../../../src/...'` 以 **type-only** 方式引用宿主 `DatabaseType/SslMode/SshAuthMethod` 与 `tableSqlActions` 类型——与 driver-sdk index 既有 re-export 同模式，留待 cap-bridge 轨统一处理；未新增任何对宿主值的依赖。

自验结果：
- Grep `packages/drivers/*/ui` 中 `import type .* from ['"].*src/` = **0**。
- `npx tsc --noEmit -p tsconfig.json` 通过（0 error）。
- `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` = **213 passed / 5 failed**（与基线完全一致，5 失败为 fix-redis-tests 轨既有项）。
- 未触碰 `src/lib/cn`、`packages/ui`、Cargo.lock、src-tauri/Cargo.toml。

## 留待 R 回归

- 无（纯类型搬迁）。
