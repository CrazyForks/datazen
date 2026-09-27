# Track: pane-layout — G5 分屏前置：pane 状态模型（Wave 1 范围）

- **状态**: TEST_FAILED
- **判定**: `TEST_FAILED` —— 1 条 Bug：`pane-layout-BUG-001`（中 / 潜伏）
- **独立复测报告**: [tester-report.md](tester-report.md)（阶段 A/B/C/D 全过程、逐文件覆盖率数字）
- **分支**: `feature/pane-layout`
- **Pro 分支**: 无（本轨纯宿主，不动 Pro 仓）
- **提交**: `f66ef75` feat(panel): 引入 pane 维度状态模型与焦点路由；`3fe2129` test(panel): 补齐 pane 测试夹具以通过测试文件类型门禁
- **方案依据**: `docs/development/editor-pro-productivity-plan.zh-CN.md` §4 G5、§5 P2

## 一、目标与范围切割（重要）

Split Pane 被 `Map<panelId, QueryExecState>` 的 **1:1 假设**阻断。
本波**只建状态模型，不建 UI**：把 store 从 1:1 改成 pane 维度，并加焦点路由，
**UI 仍然每 tab 渲染单 pane**，因此对外行为必须与改动前**完全一致**。

这样切的理由：模型可被单测完整覆盖且无回归风险；而分屏 UI 涉及 `useResizable`
递归嵌套、拖拽布局、dirty 标记与会话恢复，与模型改造耦合会放大风险。
**先证明模型无回归，下一波再叠 UI。**

## 二、已实证的机制（勿重新论证）

- `panelStore.ts:74-85`：`queryExec: Map<string, QueryExecState>` 与 `panelId` **严格 1:1**。
- `QueryExecState`（`queryExecActions.ts:26-41`）：`{ sql, results[], activeResultIdx, error, running, ..., streamRunId }`。
- `cancelAndCleanupExec`（`panelStore.ts:45-62`）执行 `nextExec.delete(panel.id)` ——
  **关 tab 即销毁 SQL 与结果，不可逆**；store **无 `persist()`，全项目无 dirty 追踪**。
- `runStreamingQuery`（`queryExecActions.ts:115-177`），pinned 结果在 `:130-137` 过滤并前插。
- `PanelBase` / `QueryPanel`（`src/stores/panelTypes.ts:6-38`），id 形如 `panel-<prefix>-<n>`（`:143-146`）。
- `ContentView.tsx:198-199`：切 tab 会卸载非活跃面板；`:88` 只渲染 `activePanel`。
- `SqlEditor` 暴露给宿主的动作（`SqlEditor.tsx:219-227`）：`onExecute` / `onExecuteSelection` /
  `onExecuteAll` / `formatDocument` / `onSaveQuery`。

### 多实例风险分级（已勘察，改造时逐条确认）

**是隐患**：`queryExec` 1:1；`useBindParameters` 每面板独立 React state；
`metadataCache`（`src/lib/relationMetadata/metadataCache.ts:436`）是进程级单例、按 `dbSessionId` 键
（`switchContext` 在 `:418-433`）；结果落在同一个数组；共享模块 `compartments`；
`useContextMenuStore` 单一全局菜单；N 份主题监听；**无 `focusedPaneId`**。

**不是隐患**（别误改）：`executionStateField` / `documentVersionField`（StateField 规格是 per-state 的）；
`StartExecutionEffect`。

## 三、改动范围（独占，禁越界）

| 文件 | 改动 |
| --- | --- |
| `src/stores/panelStore.ts` | 引入 `paneId` 维度；`queryExec` 改为按 pane 键；新增 `focusedPaneId` 与其 setter |
| `src/stores/queryExecActions.ts` | `QueryExecState` 取用改为接受 pane 键；保持现有行为语义 |
| `src/windows/connection/query/QueryPanel.tsx` | 动作路由到 `focusedPaneId`；`useBindParameters` 按 pane 取值 |
| `src/windows/connection/ContentView.tsx` | 单 pane 模式下传入焦点 pane |

**明确不在本轨范围（留给下一波 P2，禁止顺手做）**：
- `useResizable` 递归嵌套 / 比例存储 / per-tab 命名空间化
- 分屏 UI、拖拽布局、结果面板 N 分栏
- `dirty` 标记与会话恢复
- `metadataCache` 的 pane 维度改造（只需在代码注释中标注其为**已知隐患**并留待 P2）

## 四、验收标准（逐条可核对）

1. `panelStore` 引入 `paneId`，`queryExec` 支持**同一 panelId 下多个 pane**（有单测证明可并存且互不覆盖）。
2. **单 pane 场景行为零变化**：现有全部 `panelStore` / `queryExecActions` 相关测试**不修改即通过**（这是本轨最重要的回归信号）。
3. 新增 `focusedPaneId`，并把 `onExecute` / `onExecuteSelection` / `onExecuteAll` /
   `formatDocument` / `onSaveQuery` 路由到焦点 pane（有单测断言路由目标）。
4. 关闭 tab 时该 tab 全部 pane 的 exec 状态被清理（扩展 `cancelAndCleanupExec`），**不残留泄漏**（有单测）。
5. 仍**不引入** `persist()` 中间件、**不引入** dirty 追踪（AGENTS.md 明令禁止）。
6. 在 `metadataCache` 旁加注释标注「进程级单例 + 按 `dbSessionId` 键，是多 pane 已知隐患，留待 P2」——只加注释，不改逻辑。
7. `pnpm typecheck` 干净（**含测试文件**）。
8. `npx vitest run src/stores` 全绿。
9. 单文件均未突破 800 行上限（`panelStore.ts` 若因新增显著膨胀，拆子模块）。

## 五、已知陷阱

- **本轨的价值全在「无回归」**。任何为了让新测试通过而修改既有测试断言的操作都是错的；
  既有测试若真失败，先判断是**模型改造引入的缺陷**还是**测试本身有缺陷**，后者登记 Bug 交回协调者裁决，不要自行改断言。
- `cancelAndCleanupExec` 目前的 `delete(panel.id)` 改成多 pane 后**极易漏删**，
  必须有「关闭 tab 后该 panel 所有 pane 均被清理」的显式测试。
- `queryExecActions.ts` 被 `runStreamingQuery` 的流式回调异步写入，
  pane 键在流式生命周期内必须**稳定**，不能在回调里重新解析焦点 pane（会写到错误的 pane）。
- `ContentView.tsx` 切 tab 会**卸载**非活跃面板，焦点 pane 状态因此必须存在 store 里而非组件 state 里。
- 禁止 `git merge` / `rebase` / `cherry-pick`，禁止删 worktree 或分支。

## 六、E2E 登记

| 用例 | 状态 | 前置 |
| --- | --- | --- |
| 【留待 R 回归】`e2e/specs/query-history.ts` TS-QH-E01~E05（历史面板/搜索/scope/结果 tab） | 留待 R 回归 | **用于证明单 pane 行为零变化** |
| 【留待 R 回归】`e2e/specs/sql-editor-productivity.ts` 多光标用例 | 留待 R 回归 | 同上 |

## 七、自验套件

```bash
pnpm typecheck
npx vitest run src/stores
```

## 八、实现记录（编码子代理，提交 `f66ef75`）

### 8.1 核心设计：两道「单 pane 等价」保险

「单 pane 行为零变化」不是靠小心维护，而是靠两处机制保证：

1. **`paneKey(panelId, paneId = 'main')` 对默认 pane 返回裸 `panelId`**（新文件 `src/stores/paneKeys.ts`）。
   于是所有既有 `queryExec` 调用点、所有既有测试 fixture（`queryExec.get(panel.id)`）解析到**同一个 entry**，
   与改动前逐字节一致。缺了这道保险，「1:1 假设被打破」这一改动本身就会波及全部既有测试。
2. **`paneArgs(paneId)` 对默认 pane 返回 `[]`**（展开在调用点）。
   单 pane 时 `f(a, b)` 仍是 `f(a, b)`，而不是 `f(a, b, undefined)`。
   **这是实测踩出来的必要机制**：首轮改动后既有 13 个用例失败，报错
   `expected "vi.fn()" to be called with arguments: [ 'p1', undefined ]` ——
   `useQueryExecutionGate.test.tsx` / `QueryPanel.executeCancel.test.tsx` 钉死了 pane 之前的实参列表。
   这不是缺陷而是合理的既有契约，**没有改任何断言**，改为在生产代码侧消掉多余的 `undefined`。

### 8.2 改动文件清单（14 个：10 改 + 4 新）

| 文件 | 改动 |
| --- | --- |
| `src/stores/paneKeys.ts`（新） | `DEFAULT_PANE_ID='main'`、`PANE_SEPARATOR='::'`；`paneKey` / `panelIdOfPaneKey` / `paneIdOfPaneKey` / `isPaneKeyOfPanel` / `paneKeysOfPanel` / `paneArgs` / `resolveFocusedPaneId` |
| `src/stores/panelExecCleanup.ts`（新） | 从 `panelStore` 拆出的 `cancelAndCleanupExec` / `cancelAndCleanupPaneExec`：**遍历该 panel 全部 pane key** 逐个 cancel 并 delete |
| `src/stores/panelStore.ts` | `focusedPaneId` + `setFocusedPane` / `openPane` / `closePane`；全部 exec 动作尾部可选 `paneId?`（默认 `DEFAULT_PANE_ID`）；`addPanel(panel, activate?, paneId?)` 按 pane key 播种；re-export `paneKeys` 供 UI 层使用。610 行 |
| `src/stores/queryExecActions.ts` | `runStreamingQuery` / `runBoundQuery` 形参语义由 panelId 改为 **pane key**（对调用方不透明，`runStreamingQuery('p1')` 照常可用）；key 在入口解析一次，**所有异步回调复用同一 key**。205 行 |
| `src/hooks/useQueryExec.ts` | `useQueryExec(panelId, paneId?)` / `useQueryExecField(panelId, field, paneId?)` |
| `src/windows/connection/QueryPanel.tsx` | `focusedPaneId` prop → `paneId = resolveFocusedPaneId(focusedPaneId)`；编辑器动作经 `...paneArgs(paneId)` 路由。**798 行（距 800 上限仅 2 行）** |
| `src/windows/connection/ContentView.tsx` | 从 store 读 `focusedPaneId` 下传（焦点态在 store，切 tab 卸载组件不丢） |
| `src/windows/connection/PanelContentRenderer.tsx` | 透传 `focusedPaneId` |
| `src/windows/connection/query/contracts.ts` | `QueryPanelProps.focusedPaneId` + `readCurrentQueryPanelRetryValidationInput(..., paneId?)` |
| `src/windows/connection/query/useQueryExecutionGate.tsx` | 新增 `paneId?`；4 处执行调用、快照判陈、错误读取均按 pane 键 |
| `src/windows/connection/query/queryDropHandler.ts` | 新增 `paneId?`；`updateSql` 形参扩展为 `(panelId, sql, paneId?)`；`handleApplyFixSql` / `handleRetry` 透传 pane |
| `src/lib/relationMetadata/metadataCache.ts` | **仅注释**：标注「进程级单例 + 按 `dbSessionId` 键，多 pane 已知隐患，留待 P2」并给出两条修法。**逻辑零改动** |
| `src/stores/__tests__/panelStore.panes.test.ts`（新） | 16 例：pane key 单测、同 panelId 多 pane 并存互不覆盖、open/closePane、全 pane 清理无残留、流式写回 pane 稳定性 |
| `src/windows/connection/__tests__/QueryPanel.paneRouting.test.tsx`（新） | 10 例：`onExecute` / `onExecuteAll` / `onExecuteSelection` / 工具栏执行键 / `formatDocument` / `onSaveQuery`（含收藏对话框预填 SQL）/ 取消 / 兄弟 pane 不受影响 / 未分屏时实参列表与 pane 之前完全一致 |

### 8.3 验收对照

| # | 验收项 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | 同一 panelId 下多 pane 并存互不覆盖 | ✅ | `panelStore.panes.test.ts`「keeps several panes of one panel independent」等 3 例 |
| 2 | 既有测试**零改动**全通过 | ✅ | `git show --stat` 无任何既有测试文件被修改；全量 `npx vitest run` **463 文件 / 4589 用例**全绿 |
| 3 | 焦点 pane 路由 5 个动作 | ✅ | `QueryPanel.paneRouting.test.tsx` 10 例，逐个断言 store 收到的目标 pane |
| 4 | 关闭 tab 清理该 tab 全部 pane、无残留 | ✅ | `panelStore.panes.test.ts`「removing a tab cleans up every one of its panes with no residue」+ `removeAllForConnection` / `closeAllPanels` 参数化用例（断言残留 key 精确等于兄弟 tab 的两个 key） |
| 5 | 无 `persist()`、无 dirty 追踪 | ✅ | 未引入；diff 中无相关字样 |
| 6 | `metadataCache` 仅加注释 | ✅ | 该文件 `git diff` 仅一个注释块，无逻辑改动 |
| 7 | typecheck 干净（**含测试文件**） | ✅（**已重测**） | 旧基座下该结论无效，见 **8.7**。main 合入后（`6072d3baf`）真门禁下 `npx tsc --noEmit` **整仓退出码 0**，本轨 14 个文件错误数 0；修正提交 `3fe2129` |
| 8 | `npx vitest run src/stores` 全绿 | ✅ | `src/stores` 全绿；且额外跑了全量 463/4589 |
| 9 | 无文件超 800 行 | ✅ | 最大为 `QueryPanel.tsx` 798 行 |

### 8.4 自验输出

```
npx tsc --noEmit                → 0
npx vitest run                  → Test Files 461 passed (461)
                                   Tests      4589 passed (4589)   EXIT=0
其中新增：panelStore.panes.test.ts 16 例、QueryPanel.paneRouting.test.tsx 10 例
既有测试文件修改数：0
```

### 8.5 需要协调者知悉的事项

- **`pnpm typecheck` 在本 worktree 不可用**：worktree 的 `node_modules` 是符号链接，pnpm 想清空重装 →
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。已按纪律用 `npx tsc --noEmit`（与脚本等价）代替，**未执行 `pnpm install`**。
- **`git add` 与文档的取舍**：本文件所在的 `docs/development/coordination/**` 仍是**未跟踪**状态，按协调者指示
  **未纳入提交**（提交内只有 14 个业务/测试文件）。`progress.md` 的更新只落在工作区，需要协调者决定如何入库。
- **越界三处，必要且最小**：§三 的表只列了 4 个文件，实际另改了
  `hooks/useQueryExec.ts`、`query/contracts.ts`、`query/useQueryExecutionGate.tsx`、`PanelContentRenderer.tsx`。
  它们是验收项 3 的**传递依赖**（`QueryPanelProps` 定义在 `contracts.ts`，执行门在 `useQueryExecutionGate`），
  未做重构，只做透传。协调者已交叉校验与 Track B 零重叠。
- **测试环境事实（勿重新论证）**：`import.meta.env.VITE_E2E` 在 vitest 下为 `undefined`，
  故 `tid()` 返回 `{}`、**工具栏没有 data-testid**。`query.modules.test.tsx:808` 的做法是
  `vi.stubEnv('VITE_E2E','1')`，新测试沿用。
- **另一个易踩的 mock 坑**：`QueryPanel.handleFormat` 读 `useSettingsStore.getState()`，
  缺 `getState` 会被它的 `try/catch` 静默吞掉，表现为「点了格式化但什么都没发生」。
  新测试的 settings mock 补了 `getState`。
- **`QueryPanel.tsx` 只剩 2 行余量**。下一波若要往该文件加行，应先拆出 12 行的
  `menu:add-favorite` effect（本次为「无回归」刻意未做，属于有风险的重构）。

### 8.7 修正：测试文件类型错已在真门禁下修正（提交 `3fe2129`）

**前次自验的第 7 条结论不成立，已作废并重测。**
`f66ef75` 时本 worktree 仍在旧基座上，`tsconfig.json` 带着
`exclude: [src/**/__tests__/**, src/**/*.test.ts(x), ...]`，因此
「`npx tsc --noEmit` 退出码 0」**并未检查任何测试文件**。
main 的 `d14037e8b chore(types): bring test files under tsc, fix 2014 resulting errors`
删除了该 exclude，测试文件自此真正参与类型检查——本轨两个新测试文件在真门禁下暴露
**7 处错误**（生产代码 0 错）。这正是该门禁要防的「mock 与真实类型长期漂移」。

| 文件 | 错误 | 处理 |
| --- | --- | --- |
| `panelStore.panes.test.ts` | TS6196 `'Panel'` 未使用 | 删掉该类型别名 |
| `panelStore.panes.test.ts` | TS2739 `QueryPanel` 缺 `database`/`schema` | 夹具补齐（`database: 'app'`、`schema: null`） |
| `panelStore.panes.test.ts` | TS2345 `TablePanel` 缺 `database`/`tableSchema` | 夹具补齐（`database: 'app'`、`tableSchema: 'public'`） |
| `QueryPanel.paneRouting.test.tsx` | TS6133 `waitFor` 未使用 | 删除该导入 |
| `QueryPanel.paneRouting.test.tsx` | TS2352 `Partial<PanelState & PanelActions>` 需先转 `unknown` | 按 AGENTS.md「精确断言」精神 `as unknown as Partial<...>`，**未用 `any`** |
| `QueryPanel.paneRouting.test.tsx` | TS1360 store 种子面板不满足 `QueryPanel` | 补 `database`/`schema` |
| `QueryPanel.paneRouting.test.tsx` | TS2739 `<QueryPanel>` 缺 `database`/`schema` | 渲染补 `database="app"` `schema={null}` |

**验证方式（临时探针，用后已删）**：新建 `tsconfig.probe.json`，`extends ./tsconfig.json`、
`include` 复制 main 现在的列表（`src`、`packages/driver-sdk`、`packages/extension-points`、
`packages/wapp-sdk`、`packages/ui`、`packages/drivers/*/ui`）、**`exclude: []`**，
跑 `npx tsc -p tsconfig.probe.json --noEmit`：

```
全量错误 1923 条（全部属 main 已修、本分支尚未合入的历史欠账，不在本轨范围）
本轨 14 个文件（10 生产 + 2 测试 + 2 新模块）错误数：0
```

探针文件**已删除，未提交**（`git status` 中不存在）。**未改任何既有断言、未删任何测试、未用 `any`。**

**最终验证改用真门禁**：修完之后协调者把 main 合进了本分支（`6072d3baf Merge branch 'main'
into feature/pane-layout`，非本轨执行），`tsconfig.json` 的 `exclude` 随之消失，
于是在**无任何探针**的真实配置下重跑：

```
npx tsc --noEmit        → 退出码 0（整仓含全部测试文件，0 错误）
本轨 14 个文件错误数     → 0
npx vitest run          → Test Files 463 passed (463)
                           Tests      4589 passed (4589)   EXIT=0
```

**同时修正一处自验数字**：`f66ef75` 时我报的「全量 461 文件 / 4563 用例」**少计了自己的 2 个新文件**。
连续三次复跑均为 **463 文件 / 4589 用例全绿**（= 26 条新增用例，16 + 10），以 463/4589 为准。

### 8.8 未做（刻意不扩大范围，留给下一波）

- 分屏 UI、拖拽布局、结果面板 N 分栏；`useResizable` 递归嵌套与比例存储
- `dirty` 标记与会话恢复；任何 `persist()`
- `metadataCache` 的 pane 维度改造（仅注释）
- 键入 `Cmd+Enter` 执行**选中片段**等仅在多 pane 下才有意义的交互差异（单 pane 下无法观测）
