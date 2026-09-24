# Track: migration-connection-view-contracts

- 分支: `feature/migration-connection-view-contracts`（基准 `codex/migration-navicat` @ `23a7c8a5`）
- Worktree: `.worktrees/datazen-migration-connection-view-contracts`
- 角色: Coder → Tester
- 状态: **READY_FOR_TEST**

## 目标与范围

修复 migration 集成分支 webdriver build 的两个 Host TypeScript 集成诊断：

1. `ConnectionViewActions.openErDiagram` 保留显式目标 database 参数，使导航树右键目标一路到 ER diagram handler。
2. Host `ConnectionViewProps` 复用 `@datazen/driver-sdk` 的 `KvSlotState` 并公开 `kvSlotState`，与 `PanelContentRenderer` 的现有透传和 SDK 契约对齐。

仅触及上述 host 类型契约与相应的聚焦回归测试；不改集成 worktree。

## 验收标准

- ConnectionPage 的导航树 ER 操作将显式 database 传给 connection-view action handler；handler 将 ER panel 绑定到该 database。
- `PanelContentRenderer` 选中的 KV connection view 收到同一个 `KvSlotState` 对象并能读取其状态。
- `pnpm exec tsc --noEmit`、相关 Vitest 文件、Prettier 和 `git diff --check` 通过。

## Coder 记录

- Bootstrap：从 `codex/migration-navicat` 创建独立分支与 worktree；`pnpm install --offline` 成功，`node_modules` 为真实目录而非软链。
- 实现与聚焦测试 commit：`4c84733af6cd563a37952b63714c7cddf2093fed`。
- `src/lib/connectionViews/types.ts`：`openErDiagram` 保留可选 database 参数；`ConnectionViewProps.kvSlotState` 复用 SDK 的 `KvSlotState`。
- ER diagram 回归：`ConnectionPage.test.tsx` 验证导航树显式目标经过 `ConnectionPage` action wrapper 到达 connection-view handler；既有 `usePanelHandlers.test.tsx` 验证 handler 将该目标绑定到 ER panel。
- KV 回归：`PanelContentRendererKvSlotState.test.tsx` 验证所选 view 收到原始 state 对象且可读取选择与 dirty 状态；`undefined` fallback 也保留。
- 自验：`pnpm exec tsc --noEmit` 通过；4 个聚焦 Vitest 文件、133 个用例通过；Prettier 检查和 `git diff --check` 通过。
- Changed files: Host type contract、ConnectionPage forwarding test、KV relay test。
- 当前状态仅 `READY_FOR_TEST`，等待独立 Tester 复核。

## Tester 记录

- 待独立复测。
