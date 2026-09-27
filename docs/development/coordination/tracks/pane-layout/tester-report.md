# Track pane-layout · Tester 独立复测报告

> Tester 独立复验。**只测不修业务代码**。本文件分段追加，中途崩溃也不丢证据。
> 判定：**TEST_FAILED**（1 条 Bug，见 `bugs/pane-layout-BUG-001.md`）

---

## 0. BOOTSTRAP 自检

```
worktree        : .worktrees/datazen-pane-layout
branch          : feature/pane-layout
HEAD            : 3fe2129fe  test(panel): 补齐 pane 测试夹具以通过测试文件类型门禁
                  6072d3baf  Merge branch 'main' into feature/pane-layout
                  f66ef75d8  feat(panel): 引入 pane 维度状态模型与焦点路由
git status --short : ?? docs/development/coordination/tracks/pane-layout/   （仅此 1 条，符合预期）
```

未执行任何 merge / rebase / cherry-pick / reset / `git add -A` / `pnpm install`；未触碰 `hub.md`；
主检出与其他 worktree 全程只读。

---

## 1. 阶段 A：代码实现审查

改动清单 = `git show --stat f66ef75`（10 改 + 2 新生产模块 + 2 新测试）+ `3fe2129`（仅 2 个测试文件的夹具修正）。

| # | 文件 | 审查结论 |
| --- | --- | --- |
| 1 | `src/stores/paneKeys.ts`（新，84 行） | 键空间设计正确。默认 pane 返回裸 panelId（单 pane 逐字节等价）；`paneArgs` 对默认 pane 返回 `[]` 而非 `[undefined]`，消除了实参列表漂移，注释把这个取舍讲清楚了。 |
| 2 | `src/stores/panelExecCleanup.ts`（新，63 行） | 从 panelStore 抽出；`cancelAndCleanupExec` 用 `paneKeysOfPanel` 遍历全部 pane 逐个 cancel+delete。**验收项 4 的核心，实现正确。** |
| 3 | `src/stores/panelStore.ts`（617 行） | exec 动作统一加尾部可选 `paneId`；`executeQuery`/`executeSelection` **在任何 await 之前**解析一次 key——注释与实现一致，符合 progress §五「流式生命周期内 pane 键必须稳定」。 |
| 4 | `src/stores/queryExecActions.ts`（205 行） | `runStreamingQuery` 形参语义 panelId→pane key，key 入口解析一次，所有异步回调复用；`streamRunId` 判陈旧机制保留。对调用方不透明（`runStreamingQuery('p1')` 仍可用）。 |
| 5 | `src/hooks/useQueryExec.ts` | 透传 paneId，默认解析为裸 panelId。 |
| 6 | `src/windows/connection/QueryPanel.tsx`（798 行） | `paneId = resolveFocusedPaneId(focusedPaneId)`；动作经 `...paneArgs(paneId)` 路由。 |
| 7 | `src/windows/connection/ContentView.tsx` | 从 store 读 `focusedPaneId` 下传。 |
| 8 | `src/windows/connection/PanelContentRenderer.tsx` | 纯透传。 |
| 9 | `src/windows/connection/query/contracts.ts` | `QueryPanelProps.focusedPaneId` + `readCurrentQueryPanelRetryValidationInput(..., paneId?)`。 |
| 10 | `src/windows/connection/query/queryDropHandler.ts` | `updateSql` 形参扩展 + `handleApplyFixSql`/`handleRetry` 透传 pane。 |
| 11 | `src/windows/connection/query/useQueryExecutionGate.tsx` | 4 处执行调用、快照判陈、错误读取均按 pane key。 |
| 12 | `src/lib/relationMetadata/metadataCache.ts` | **仅注释**，`git diff` 确认零逻辑改动。验收项 6 达成。 |
| 13 | `src/stores/__tests__/panelStore.panes.test.ts`（新，403 行 / 16 例） | 见 §3.2、§3.4。 |
| 14 | `src/windows/connection/__tests__/QueryPanel.paneRouting.test.tsx`（新，442 行 / 10 例） | 见 §3.1、§3.4。 |

### 1.1 验收标准逐条核对（progress.md §四）

| # | 验收项 | 判定 | 依据 |
| --- | --- | --- | --- |
| 1 | 引入 paneId，同一 panelId 下多 pane 可并存互不覆盖 | ✅ | `panelStore.panes.test.ts`「keeps several panes of one panel independent instead of overwriting each other」 |
| 2 | **单 pane 场景行为零变化**（既有测试不修改即通过） | ✅ | `git show f66ef75 --stat` 显示**零既有测试文件被修改**；`paneRouting.test.tsx`「issues the exact pre-pane call shape when the tab is not split」逐字节钉住旧实参列表 |
| 3 | `focusedPaneId` + 5 个动作路由到焦点 pane | ⚠️ 部分 | 5 个动作各有断言（见 §3.4），但焦点是**全局单值**而非按 tab 作用域 → **BUG-001** |
| 4 | 关 tab 清理该 tab 全部 pane，无残留 | ✅ | 「removing a tab cleans up every one of its panes with no residue」断言剩余 key 精确等于另两个 tab 的 key；另见 §3.2 独立复核 |
| 5 | 不引入 persist()、不引入 dirty 追踪 | ✅ | `grep persist/dirty` 于本轨 14 个文件无新增命中 |
| 6 | metadataCache 加「多 pane 已知隐患」注释，只加注释 | ✅ | `git show f66ef75 -- src/lib/relationMetadata/metadataCache.ts` 仅注释 |
| 7 | `npx tsc --noEmit` 干净（含测试文件） | ✅ | 实测 EXIT=0，见 §2.1 |
| 8 | `npx vitest run src/stores` 全绿 | ✅ | 见 §2.2 |
| 9 | 单文件未突破 800 行 | ✅ | `QueryPanel.tsx` = **798 行**（余量 2 行，与 Coder 自报一致） |

### 1.2 文件规模（800 行上限，AGENTS.md）

```
panelStore.ts 617 / paneKeys.ts 84 / panelExecCleanup.ts 63 / queryExecActions.ts 205
useQueryExec.ts 22 / QueryPanel.tsx 798 / ContentView.tsx 644 / PanelContentRenderer.tsx 545
contracts.ts 195 / queryDropHandler.ts 418 / useQueryExecutionGate.tsx 589
```

最大 `QueryPanel.tsx` = **798 行**，未越限。本轨**未**把它推高（见 §3.6）。

### 1.3 `any` 扫描（AGENTS.md 禁用）

`paneKeys.ts` / `panelExecCleanup.ts` / 两个新测试文件，
`grep -n ": any\|<any>\|as any\|any\[\]"` → **0 命中**。✅
Tester 自加的两个测试文件同样 0 命中，且已过 `tsc --noEmit`。

---

## 2. 阶段 B：独立复验（零信任复现）

### 2.1 类型门禁 `npx tsc --noEmit`

```
npx tsc --noEmit   →   EXIT=0
```

**与 Coder 自报一致。** 此处确为「真门禁」：`tsconfig.json` 的 `exclude` 已随 main 的
`d14037e8b` 移除，测试文件确实参与检查。Tester 加入 2 个新测试文件后**复跑仍为 EXIT=0**。

### 2.2 全量前端套件 `npx vitest run`

```
Test Files  463 passed (463)
Tests      4589 passed (4589)
EXIT=0
```

**与 Coder 自报逐位一致。** 关于「上一轮少计 2 个文件 / 26 条用例」的自纠：
`16 (panelStore.panes) + 10 (paneRouting) = 26`，与基线完全吻合，**自纠成立**。

> **一次假阴性的记录（重要，勿据此误判）**：首轮全量跑出现
> `3 failed | 460 passed (463)`、`5 failed | 4584 passed (4589)`、EXIT=1。
> 逐条查证后确认**全部是环境性 flake，与本轨无关**——当时另一个 worktree
> （`.worktrees/datazen-pack-ep-key-invariant`）正在并发跑全量 vitest，CPU 争抢导致：
> - `schemaStore.test.ts`「is multi only when capability and length > 1」→ 5000ms 超时（隔离跑 962ms 通过）
> - `DataTransferWindow.test.tsx` 3 例 → 超时 / `Found multiple elements`（隔离跑 1498ms 全通过）
> - `statementRanges.test.ts` 20k 性能冒烟 → `expected 52.88 to be less than 50`（隔离跑 55ms 通过）
>
> 三个文件**本轨一个字节都没碰**。隔离复跑 `3 passed (3) / 88 passed (88) EXIT=0`，
> 随后无争抢时全量复跑回到 `463/4589 EXIT=0`。**故不判失败。**
> 附带观察：`statementRanges` 的 50ms 预算余量很薄（隔离跑 55ms），属既有测试的环境敏感点，
> 与本轨无关，提请协调者知晓。

---

## 3. 阶段 C：覆盖率与风险点

### 3.1 风险点 (1)：夹具补字段是否掩盖了真实类型漂移？—— **结论：没有掩盖，判定正当**

`3fe2129` 补了 `database:'app'`、`schema:null`、`tableSchema:'public'`。逐字段核对真实类型
（`src/stores/panelTypes.ts`）与**生产路径的真实赋值**：

| 字段 | 真实类型 | 生产路径实际赋值 | 夹具值 | 判定 |
| --- | --- | --- | --- | --- |
| `QueryPanel.database` | `string`（必填、**不可 undefined**） | `usePanelHandlers.ts:488` `database: boundDatabase ?? ''`；`openHistoryQuery.ts:73` `panelDatabase ?? ''` | `'app'` | ✅ 合法 string |
| `QueryPanel.schema` | `string \| null`（显式允许 null） | `usePanelHandlers.ts:489` `schema: target?.schema?.trim() \|\| null` | `null` | ✅ **正是生产兜底值本身** |
| `TablePanel.tableSchema` | `string \| null` | `usePanelHandlers.ts:268/288` 直接写死 `tableSchema: null` | `'public'` | ✅ 非 null 也是合法取值 |

三个问题逐一回答：

- **这些字段在生产路径上真会这样赋值吗？** 会。`schema: null` 与 `tableSchema: null` 都不是
  编译器逼出来的填充，而是生产代码**字面写死**的兜底分支。`database` 在生产里是必填
  `string`（不存在 `undefined` 分歧），夹具给非空 `'app'` 合法。
- **补 `null` 掩盖了「生产可能传 undefined」的真实分歧吗？** **没有。** `schema: string | null`
  的类型**显式建模了 null**，`undefined` 在该类型下本就不是合法值；若生产真传 `undefined`，
  `tsc` 会直接报错。所以补 `null` 是**把测试对齐到当前真实类型**，不是把类型错误藏进测试。
  AGENTS.md 点名的历史病（`TableInfo.rowCount` 实收 `null` 却声明 `?: number`）在这里**没有**重演。
- **`paneRouting.test.tsx:271` 的 `as unknown as Partial<...>` 桥接正当吗？** **正当。**
  它符合 AGENTS.md 点名的精确断言形态（`as unknown as X` + `Partial<>`），**不是 `any`**；
  注释也写清了理由（只覆盖少数字段、其余保留真实实现；`unknown` 桥接的是 `getState()` 返回的
  `PanelState & PanelActions` 交叉类型）。**无需整改。**
  仅一处可打磨（非缺陷）：`:351` 同形态的 `as Partial<...>` 没有注释。

**方向判定**：门禁恢复对测试文件的检查后，**夹具补齐 = 把测试拉回真实类型**，而非放宽类型。
**这是本轮门禁该做的事，判定正确。**

### 3.2 风险点 (2)：`queryExec` 的 1:1 约束与 pane 生命周期 —— **主路径正确，焦点作用域有缺陷**

**(a) 关闭一个 pane 会不会误删另一个 pane 的 exec 状态？—— 不会。✅**
`cancelAndCleanupExec` 遍历 `paneKeysOfPanel(currentExec, panel.id)` 而非 `delete(panel.id)`。
既有测试「removing a tab cleans up every one of its panes with no residue」断言：
删除 `panel-q-1`（3 个 pane key）后剩余 key **精确等于** `['panel-q-2','panel-q-2::p2']`。

Tester 另做键编码边界复核（`panelIdOfPaneKey` / `paneIdOfPaneKey` 往返）：

| 输入 pane | key | 解析回 panel | 解析回 pane |
| --- | --- | --- | --- |
| (`panel-q-1`, 默认) | `panel-q-1` | `panel-q-1` | `main` |
| (`panel-q-1`, `p2`) | `panel-q-1::p2` | `panel-q-1` | `p2` |
| (`panel-q-11`, `p2`) | `panel-q-11::p2` | `panel-q-11` | `p2` |
| (`panel-q-1`, `a::b`) | `panel-q-1::a::b` | `panel-q-1` | `a::b` |

前缀安全已验证：`panelIdOfPaneKey('panel-q-11::p2') === 'panel-q-11' ≠ 'panel-q-1'`，
**不存在 `panel-q-1` 误吞 `panel-q-11` 前缀**的问题。pane id 内含 `::` 也安全（按**首个**分隔符切）。

**(b) pane 拆分/合并/关闭时 queryExec 生命周期是否正确？—— 有 1 处缺陷 → BUG-001。**
`focusedPaneId` 是**单一全局字段**，而 pane 属于 panel。详见 `bugs/pane-layout-BUG-001.md`。
该缺陷**潜伏**：生产代码目前无任何调用点触发 `openPane`/`closePane`/`setFocusedPane`，
`focusedPaneId` 恒为 `null`，故**不违反验收项 2**（单 pane 行为确实零变化）。

### 3.3 风险点 (3)：`reconfigureProCompartments` 共享单例 —— **本轨未制造多实例场景**

先纠正两处**前提偏差**（供协调者更新背景知识）：

1. **所述路径不存在。** `src/components/sql-editor/proCompartments.ts` 在本仓库**并不存在**。
   真实位置是 `src/components/sql-editor/editorExtensions.ts:121`（`export const compartments`）
   与 `:827`（`reconfigureProCompartments`）。
2. **「多实例会互相踩」对 CodeMirror 6 不成立。** `compartments` 虽是模块级共享对象，
   但 `Compartment.reconfigure()` 产出的内容是**按 view 求值并存进各自 StateField** 的，
   共享的只是句柄。只要每个 view 的扩展列表都 `include` 了这些 compartment，多实例互不影响。
   该函数也只对传入的 `view` 派发 transaction，不会波及其他实例。

**对本轨的结论：本波「不制造多实例场景」，因此不构成缺陷。**
`ContentView.tsx:88` 仍然只渲染 `activePanel`，一个 tab 一个 `QueryPanel` 一个 `SqlEditor` 实例。
`paneRouting.test.tsx` 用 `focusedPaneId=PANE_2` 断言的是**路由目标**，只渲染**一个**编辑器，
没有也不需要造第二实例。**该风险整体留待 P2**：P2 接上分屏 UI 时，两个活体 `SqlEditor`
共享同一批 compartment 对象 + `metadataCache` 进程级单例（验收项 6 已注释）必须在**那时**补测试。

### 3.4 连续旅程测试（AGENTS.md「交互与编辑器逻辑」）—— **就本波范围而言满足**

本波新增的**唯一真正有状态的新路径**是「流式执行在飞期间焦点切走」，
`panelStore.panes.test.ts`「streams results into the pane that started the run, not the focused one」
是货真价实的连续状态机测试：启动执行（永不 settle 的流）→ **中途** `setFocusedPane` →
逐个 `emit(statementStart)` / `emit(rows)`（残缺中间态）→ 断言两侧 `results` / `running`
的跃迁与退出。**满足「涵盖残缺中间态 + 断言每一步跃迁与退出」。**

`paneRouting.test.tsx` 的 10 例以逐动作路由为主（execute / executeAll / executeSelection /
工具栏执行 / formatDocument / onSaveQuery / 工具栏保存 / onChange / cancel / 同 tab 兄弟 pane
不受影响 / 未分屏时旧实参列表逐字节不变），含 1 个 execute→onChange 的连续序列。

**残留缺口（不判为 Bug，登记留待 P2）**：没有「逐键击键 + 残缺 SQL 未完成态 + 跨 pane 取消/重跑」
的完整旅程测试。因本波不动 SQL 解析/校验、且验收项 2 要求零行为变化，此缺口不阻塞本波；
但 P2 接入分屏 UI、用户可同时操作两个编辑器时，**必须**补这类连续旅程测试。

### 3.5 覆盖率实测（显式测量，含门禁外的文件）

**门禁范围核实**（`vitest.config.ts`）：`coverage.include` 覆盖 `src/lib/**`、`src/stores/**`、
`src/components/DataTable/**`、`src/components/ai/**`，以及 `windows/connection/` 下**仅**
`ConnectionPage.tsx` / `ConnectionSettingsDialog.tsx` / `ObjectBrowser.tsx` / `PrivilegeView.tsx`。
⇒ 协调者所说「`src/components/sql-editor/**` 在门禁之外」**正确**；
**此外本轨改动的 `QueryPanel.tsx` / `ContentView.tsx` / `PanelContentRenderer.tsx` /
`src/hooks/useQueryExec.ts` / `windows/connection/query/**` 也全部在门禁之外**——
「测试通过」对这些文件是弱证据，故逐个显式测量。

`npx vitest run --coverage --coverage.include=<本轨 11 个改动文件>` 实测：

| 文件 | % Stmts | % Branch | % Funcs | **% Lines** | 门禁内 |
| --- | --- | --- | --- | --- | --- |
| `stores/paneKeys.ts` | **100** | **100** | **100** | **100** | ✅ |
| `stores/panelExecCleanup.ts` | 95.23 | 90 | 75 | **100** | ✅ |
| `stores/queryExecActions.ts` | 90.9 | 82.6 | 90 | **97.95** | ✅ |
| `windows/connection/query/contracts.ts` | **100** | 95.65 | **100** | **100** | ❌ 门外 |
| `windows/connection/query/useQueryExecutionGate.tsx` | 87.04 | 79.72 | 95.83 | **89.01** | ❌ 门外 |
| `windows/connection/query/queryDropHandler.ts` | 84.34 | 68.49 | 80 | **89.52** | ❌ 门外 |
| `windows/connection/QueryPanel.tsx` | 87.39 | 64.34 | 73.33 | **88.77** | ❌ 门外 |
| `stores/panelStore.ts` | 73.17 | 60.41 | 83.72 | **78.65** | ✅ |
| `hooks/useQueryExec.ts` | 50 | 25 | 50 | **50** | ❌ 门外 |
| `windows/connection/ContentView.tsx` | 65.4 | 59.22 | 48.64 | **67.45** | ❌ 门外 |
| `windows/connection/PanelContentRenderer.tsx` | 45.07 | 37.19 | 23.8 | **47.05** | ❌ 门外 |

> 测量口径说明：该次运行同时打印了
> `ERROR: Coverage for functions (70.63%) does not meet global threshold (80%)` 等三行，
> 这是**我用 `--coverage.include` 把统计集收窄到这 11 个文件**、导致全局阈值被套用在窄集合上的
> **测量假象**，**不是仓库真实门禁失败**（仓库门禁按其自身 include 集合计算，基线本就是绿的）。
> 本报告不据此判 Bug，仅引用上表的逐文件数字。

**解读：**

- **本波新增代码覆盖充分**：`paneKeys.ts` 100%；`panelExecCleanup.ts` 行覆盖 100%；
  `panelStore` 的 pane 分支（`openPane`/`closePane`/`setFocusedPane` 与所有 `paneKey(...)`
  调用点）均被 `panelStore.panes.test.ts` 覆盖；`QueryPanel.tsx` 88.77% 行覆盖，
  且新增的 `paneId` 解析与 `paneArgs` 路由路径逐条有断言。
- **`useQueryExec.ts` 原本 50%，是本轨改动文件里最低的一个**，成因与 pane 无关：
  `useQueryExecField` **完全没有测试**（缺失行 20-21，函数 0 覆盖），
  于是「按 pane 下标取字段」这条新路径在 hook 层从未被验证。
  **Tester 已补齐**：`src/hooks/__tests__/useQueryExec.pane.tester.test.tsx`，**11 例全绿**，
  `useQueryExec.ts` **50% → 100%（四项全 100%）**。
- **`panelStore.ts` 78.65% / `ContentView.tsx` 67.45% / `PanelContentRenderer.tsx` 47.05% 低于 80%。**
  但这三者的低覆盖**主要来自既有未覆盖面，而非本轨新增代码**：`ContentView` 本轨只加 3 行透传
  （`:88` 读 + `:560` 传），`PanelContentRenderer` 只加 8 行透传，两者绝大部分是未被单测覆盖的
  既有渲染分支。**本轨没有把这些文件推入未覆盖状态**（见 §3.6），
  故不作为 Bug 登记；「补齐到 80%」属独立技术债，不在本波验收范围。

### 3.6 本轨「零回归」自证

- `git show f66ef75 --stat` 确认：**既有测试文件零修改** ⇒ 验收项 2「不修改即通过」成立。
- 与 main 的重叠面复核（协调者背景：`0042d8ef7` 自动合并零冲突）：

```
main 侧重叠 2 文件：src/stores/panelStore.ts、src/windows/connection/PanelContentRenderer.tsx
本轨对这两文件的改动：+195（pane 模型改造）/ +8（pane 透传）
tsconfig.json（8 -）：全部为 main 侧删除 exclude，本轨未动
```

---

## 4. Bug 清单

| Bug ID | 标题 | 严重度 | 状态 |
| --- | --- | --- | --- |
| `pane-layout-BUG-001` | `focusedPaneId` 是全局单值而非按 tab 作用域，焦点跨 tab 泄漏 | 中（潜伏） | 待修复 |

详见 `bugs/pane-layout-BUG-001.md`。回归测试
`src/stores/__tests__/paneFocusScope.tester.test.ts`（3 例，**当前全红**，随 Bug 提交，修复后应转绿）。

---

## 5. Tester 新增测试清单

| 文件 | 用例数 | 覆盖路径 |
| --- | --- | --- |
| `src/hooks/__tests__/useQueryExec.pane.tester.test.tsx` | 11（全绿） | `useQueryExec` 默认 pane / 指定 pane / 未打开 pane 回退空态 / 兄弟 pane 变更不误采纳；`useQueryExecField` 默认与指定 pane、**falsy 字段不继承兄弟**、非字符串字段、订阅 pane 变更重渲染、未打开 pane 回退；同 tab 两 pane 并行独立 |
| `src/stores/__tests__/paneFocusScope.tester.test.ts` | 3（**全红 = BUG-001**） | 未分屏兄弟 tab 路由到本 pane 而非外来 paneId；不产生未打开 pane 的 exec entry；关一个 tab 的 pane 不抢另一个 tab 的焦点 |

---

## 6. 阶段 D：判定

**TEST_FAILED** —— 存在 1 条 Bug（`pane-layout-BUG-001`，中 / 潜伏）。

判定要点：

- **Coder 的自报数字全部独立复现成功**：`tsc` EXIT=0；`463 文件 / 4589 用例全绿 EXIT=0`。
  首轮出现的 5 例失败经隔离复跑证明是并发 CPU 争抢的环境 flake，**不构成本轨缺陷**，已如实记录（§2.2）。
- **验收项 1/2/4/5/6/7/8/9 全部通过**；验收项 3 部分通过（5 个动作路由均有断言，
  但焦点作用域模型有缺陷）。
- **判定卡在 BUG-001**：状态模型的焦点维度是**全局单值**，与 pane 的 panel 归属不匹配。
  本波潜伏无用户可见影响，但它正是本波唯一要交付的产物，下一波接 UI 即成静默数据丢失。
- **交回协调者裁决**：BUG-001 的修复方向属状态模型设计决策（per-panel 焦点字段 vs
  在 `ContentView` 按 active panel 过滤），Tester 不代做，请协调者 resume 原 Coder 处理。
