# Track: migration-connection-view-contracts

- 分支: `feature/migration-connection-view-contracts`（基准 `codex/migration-navicat` @ `23a7c8a5`）
- Worktree: `.worktrees/datazen-migration-connection-view-contracts`
- 角色: Coder → Tester
- 状态: **TEST_DONE / PASSED**

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

- 独立工作区：`feature/migration-connection-view-contracts-fresh-tester`，基于 `d1a44f5e`（Coder 实现 commit `4c84733af6cd563a37952b63714c7cddf2093fed` 的子提交）。通过 `pnpm install --offline --frozen-lockfile` 安装依赖；`node_modules` 为物理目录。未创建数据库夹具、未启动 app 或产生运行时应用数据；复制到 Tester worktree 的 `e2e/.env` 已移除。
- Review：Coder commit 只修改 connection-view 类型契约和两项 Host 回归测试，未改运行时业务实现。`ConnectionPage.test.tsx` 的 `ContentView` 是 mock，未覆盖真实 `ContentView.actionsRef` 接线；新增 `ContentViewKvDbSwitch.test.tsx` 的 `[tester]` 用例，直接调用实际 ContentView action ref 并验证显式 `analytics` 目标到达 panel handler。导航树和 handler 的既有测试分别覆盖链路两端。KV relay 测试验证传入的是相同 SDK `KvSlotState` 对象并保留 `undefined` fallback。未发现产品缺陷。
- 独立复验：`pnpm exec tsc --noEmit` 通过；5 个聚焦 Vitest 文件、141 个用例通过（ConnectionPage、PanelContentRenderer KV relay、usePanelHandlers、ConnectionNavigatorTree、ContentView action ref）；Prettier 检查和 `git diff --check` 通过。改动的生产文件仅为纯类型声明，运行时行覆盖率不适用；类型正确性由 TSC 检验，运行时转发由上述接线测试覆盖。
- webdriver build gate：先用 Tester 专属 Cargo target 尝试构建，Vite 成功，Cargo 因 Data 卷空间不足（`No space left on device`）在应用二进制生成前失败；删除该次仅属于 Tester 的临时 target 后，复用并串行占用 integration Cargo cache 重试。第二次 Vite 与 Cargo 均成功，Tauri 报告 `Built application at .../debug/datazen` 并生成 `DataZen.app`；随后仅在 `bundle_dmg.sh` 的 DMG 打包阶段退出失败。按本轨验收约定，此打包错误不阻塞 Host app/binary 构建。`with-driver-inject` 已恢复临时 Cargo feature 注入。
- E2E：登记【留待 R 回归】用例：在导航树对非当前 database 打开 ER Diagram，确认 ER panel 绑定该显式目标。未运行 WDIO：现有 `er-diagram.ts` suite setup 会 DROP 固定名称的 `er_pred_owner` / `er_pred_member` 表，`navigator-context-menu.ts` 包含固定 fixture DROP；均不满足本轮安全、自包含条件。4445 端口检查为空且未启动 app。
- 覆盖率补齐：仅新增一项真实 ContentView `actionsRef` 回归，不引入冗余测试。纯类型生产变更的覆盖率为 N/A。
- 本轮无产品 Bug。Tester 测试 commit：`3f3d9465`；进度记录另由后续 commit 提交。
