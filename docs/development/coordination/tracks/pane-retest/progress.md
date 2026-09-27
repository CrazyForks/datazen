# pane-layout 复测轨道 · progress

轨道：`pane-retest`（复测 BUG-001）
复测对象：`227b6af8e fix(panel): pane 焦点按 tab 归属，修 BUG-001`
工作目录：`/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-pane-retest`
分支：`feature/pane-retest`　基线 HEAD：`92d49373e`（Merge feature/pane-layout）
角色：Tester（只测不修；本轨道零业务代码改动）

## 结论

**TEST_DONE — PASSED。** BUG-001 确已修复，六项验收逐项取证如下。未发现产品缺陷，
未新增 BUG 文件。复测期间发现并**补齐了 6 处测试防线空洞**（`addPanel` 等动作缺少回归
保护），全部以新测试闭合，变异测试最终 15/15 全捕获。

---

## 1. 三条红灯转绿

```
npx vitest run src/stores/__tests__/paneFocusScope.tester.test.ts \
                  src/hooks/__tests__/useQueryExec.pane.tester.test.tsx \
                  src/stores/__tests__/panelStore.panes.test.ts
→ Test Files  3 passed (3)
  Tests       31 passed (31)      # 3 + 11 + 17
  EXIT=0
```

含 Coder 新增的镜像不变量例 `keeps the focusedPaneId mirror equal to the active tab own focus`。

## 2. 独立复现原缺陷（差分复现，非复述原报告数字）

方法：把修复前的 store **逐字**复制为**测试夹具**（fixture）

- 路径：`src/stores/__tests__/fixtures/panelStore.pre-fix-227b6af8e.ts`
  （置于 `__tests__/fixtures/` ⇒ 明确不是生产代码，且不与真实 store 并列在 `src/stores/`）
- 相对 import 因下移两层而重写：`'./x'`→`'../../x'`，`'../x'`→`'../../../x'`。
  **两种形态增加的层数不同**，不能靠数 `'../'` 个数推导——必须按原目录解析成绝对路径再
  重算；生成时逐个断言可解析到真实模块。
- 相对 import 之外的代码与源 blob 逐字节相同（PROVENANCE 2 会证明这一点）

同一段场景体分别跑 before / after 并断言可观测结果不同。场景体只经公开 store 面 +
与生产相同的 key 解析，模拟 `ContentView → QueryPanel` 的路由。

**夹具的 provenance 是三条可失败的守卫，不是注释**（`paneFocusDifferentialRepro.tester.test.ts`）：

| 守卫 | 内容 |
|---|---|
| PROVENANCE 1 | 运行时形状：before 有全局 `focusedPaneId`、无 `focusedPaneIdByPanel`；after 两者皆有 |
| PROVENANCE 2 | banner 的 `source  :` 行**指名**来源 commit；且 marker 之后的正文与 `git show 227b6af8e^:src/stores/panelStore.ts` **逐字节相同**（仅剔除重写过的相对 import 行） |
| PROVENANCE 3 | 断言 `src/stores/` 下**非 `__tests__` 的任何文件都没有 import 它** |

**这三条守卫逐条做了反向验证（改坏 → 必须转红）**，不是只跑通就算数：

| 反向注入 | 期望 | 实测 |
|---|---|---|
| 正文被手改（模拟"真 store 改了、副本没跟上"的维护陷阱） | PROVENANCE 2 红 | ✔ 红 |
| banner 谎称 `deadbeef1^`（不存在的 commit） | PROVENANCE 2 红 | ✔ 红 |
| banner 谎称 `227b6af8e`（指到修复后而非其父） | PROVENANCE 2 红 | ✔ 红 |
| banner 谎称 `0042d8ef7^`（无关 commit） | PROVENANCE 2 红 | ✔ 红 |
| 在 `panelStore.ts` 里 import 该夹具 | PROVENANCE 3 红 | ✔ 红 |
| 全部还原 | 全绿 | ✔ 8/8 |

> **我自己第一版的 PROVENANCE 2 是个假守卫，被反向验证当场抓出来。** 原先写的是
> `expect(banner).toContain('227b6af8e')`，而 banner 里另有两行也引用了这个 commit，
> **该断言几乎不可能失败**——把 banner 改成声称 `deadbeef1` 居然照样绿。改为只钉
> `source  :` 那一行的精确内容后才真正可失败。记在这里是因为：**"断言存在"与
> "断言能失败"是两件事，只有反向注入能区分**，而只看"全绿"永远分不出来。

> 副产物：此过程中我自己写错过两处（import 深度按 `'../'` 个数推导，导致 `./x` 与
> `../x` 加了同样层数；jsdom 下 `import.meta.url` 是 `http://` 而非 `file://`，使
> `fileURLToPath` 抛错）。两处都被上述守卫/断言当场暴露，**非产品问题**，记录在案
> 以免后来者重蹈。

| 后果 | before (`227b6af8e^`) 实测 | after (HEAD) 实测 |
|---|---|---|
| 1 未分屏 tab 路由到幽灵 pane | `panel-q-2::p2` | `panel-q-2` |
| 2 键入长出无主 exec entry | exec keys 由 3 → **4**（`+panel-q-2::p2`） | 保持 **3** |
| 2 结果流入看不见的 key | `keysHoldingRows=["panel-q-2::p2"]` | `keysHoldingRows=["panel-q-2"]` |
| 3 关一个 tab 抢走另一个 tab 焦点 | `panel-q-1::p2` → `panel-q-1` | 前后均 `panel-q-1::p2` |

**原报告未夸大，三个后果与全部关键数字逐条吻合**（幽灵 key、exec 3→4、抢焦点
`::p2`→裸 id）。唯一措辞不准之处：原报告称 exec keys 列表为
`[panel-q-1, panel-q-1::p2, panel-q-2, panel-q-2::p2]`，该列表是**键入后**的快照，
而正文描述的 3→4 是**增量**；两者不矛盾，但读者容易误读为同一时刻的同一组数字。

## 3. 生产不可观测前提 —— 已核实，并跑真实 P2 序列

Coder 称 `openPane` / `closePane` / `setFocusedPane` 无生产调用点，故 `focusedPaneId`
恒为 `null`，既有测试构造的是生产到不了的状态。**核实成立**：
`grep -rn "openPane\|closePane\|setFocusedPane\|focusedPaneIdByPanel" src packages
--include=*.ts --include=*.tsx | grep -v __tests__ | grep -v '\.test\.'` 只命中
`panelStore.ts` 内的声明/定义，以及同名无关符号（`closePanelsToTheRight`/`Left` 于
`usePanelHandlers.ts:559,563`、局部 `closePanelsForTable`、`WorkflowPage.tsx` 的
`closePanel`、`useQueryBuilderContribution` 的 `openPanelId`）。

因此另建 `paneRealSequence.tester.test.ts`：**同一条 P2 真实操作序列在 before/after
两个构建上各跑 12 帧**，逐帧断言任务指定的 5 个问题。

- 分屏的 tab 是否成为 active —— 是（frame 2：`active=panel-q-1 mirror=p2
  map={"panel-q-1":"p2"} routed=panel-q-1::p2`）
- 切到 B 时 `map` 是否只动 B 的条目、A 不受影响 —— 是（frame 7：
  `active=panel-q-2 mirror=p2 map={"panel-q-2":"p2","panel-q-1":"p3"}`）
- 在 A 执行后，B 的 `updateSql` 还会命中 A 的 paneId 吗 —— 不会（frame 8：
  SQL 落入 `panel-q-2::p2`，exec keys 稳定在 5，无孤儿增长）
- 关 B 的 pane 是否动 A 的焦点 —— 不会（frame 9：`map={"panel-q-1":"p3"}`，
  routed 仍为 `panel-q-2`）
- 已关 tab 的 `focusedPaneIdByPanel` 条目是否清理（泄漏）—— 是（frame 11 `map={}`）
- 泄漏不变量检查器：`leaks(after) === []`，`leaks(before).length > 0`

**构造态与真实序列之间未发现语义差异。** after 构建 12 帧全部符合预期。

## 4. 单一写入口 —— grep + 变异测试

**grep 独立核实**：`focusedPaneIdByPanel` 的赋值点全仓库仅 3 处，全在 `panelStore.ts`
——`syncPaneFocus` 内的 `:219`（唯一写入口）、模块级初始值 `:229`、`reset` 的整态
字面量 `:688`（后两者与 `focusedPaneId` 同时置位）。`panelStore.ts` 之外仅
`ContentView.tsx:89` 一句注释提到它。`focusedPaneId` 同理，赋值点仅 `:220`（镜像推导）、
`:230`、`:689`。**单写入口成立。**

**变异测试**：新增 `scripts/mutation-check-pane-focus.mjs`（沿用 `scripts/check-*.mjs`
约定）。把每个改焦点的动作逐一改回修复前形态（纯 `activePanelId` 写 / 纯全局
`focusedPaneId` 写 / 不带 focus patch），要求测试转红。store 文件每次以内存备份逐字节
还原，全程不使用 git 写命令，变异从不提交。

- **首轮 7/15 被捕获，8 个存活 —— 防线确有洞**，包括任务点名的 `addPanel`。
- 补写 `paneFocusEntryLifecycle.tester.test.ts`（11 例）闭合全部 6 处空洞
  （`addPanel` / `removeAllForConnection` / `removePanelsForRelation` /
  `removePanelsForDatabase` / `closeOtherPanels` / `closeAllPanels` /
  `closePanelsToTheLeft` / `reset`）。
- **复跑 15/15 全捕获，0 存活**，`panelStore.ts restored byte-for-byte: true`，
  `HARNESS_EXIT=0`。每个变异都由具名断言捕获（非超时假阳性）。

其中一条空洞值得单记：`addPanel` 不走 `syncPaneFocus` 时，**新建的查询 tab 会继承
上一个 tab 的焦点**，路由到 `panel-q-2::p2` —— 与 BUG-001 后果 1 同源，且是 P2 落地后
最常见的动作（用户 A 分屏着，再开一个新查询 tab）。该用例已固化为
`addPanel: a newly activated tab must not inherit the tab being left focus`。

## 5. 副作用面 —— queryExec 生命周期未被触碰

- `227b6af8e` 只动 3 个文件：`panelStore.ts`、`ContentView.tsx`、`panelStore.panes.test.ts`。
- `git diff 227b6af8e^ HEAD -- src/stores/queryExecActions.ts src/hooks/useQueryExec.ts
  src/windows/connection/query/useQueryExecutionGate.tsx src/windows/connection/query/queryDropHandler.ts`
  中前三个**零差异**。
- `useQueryExecutionGate.tsx` 确有 18 行差异，但来自合流 commit `0042d8ef7`，
  `diff -u -w -B` 显示**纯 prettier 折行 + 尾逗号**；剔除尾逗号与全部空白后两版本
  字符串完全相同 ⇒ 语义等价。**Coder「未触碰 queryExec 生命周期」的说法成立**，
  仅需注意：按文件跑 `git log` 会看到该文件被合流 commit 触及，容易误判为违规。
- **`ContentView.tsx` 的回退镜像读取不绕过单写入口。** 该文件在本次修复中**只改注释**
  （`+6/-0`，4 行注释换成 8 行），`focusedPaneId` 的读（`:92`）与下发（`:564`）字节未变。
  镜像与 map 在**同一次 `set()`** 内写入，结构上无法漂移。为此补了比点态断言更强的
  用例：订阅 store，对**每一次状态发射**校验 `focusedPaneId === map[activePanelId] ?? null`
  （`invariant: the mirror is correct on EVERY state emission`），17 步动作序列
  `violations === []` —— 覆盖了「漂移只存在一次 `set()`、恰好被 React 渲染到」这类
  点态检查看不见的情形。
- **`ContentViewKvToolbar.test.tsx` 的 store mock 确为 4 键子集**，独立读取确认：
  `{ panels, activePanelId, setActivePanel, updatePanel }`，**不含** `focusedPaneId`
  也不含 `focusedPaneIdByPanel`。**陈旧读风险评估：视图侧读镜像不存在陈旧读风险**——
  镜像由 store 侧在同一次 `set()` 内重算，永远不落后于 map；反向风险也不存在（视图只
  订阅镜像，后台 tab 的焦点变化不会误触发重渲染，这是正确的）。该 mock 的真实约束是：
  若视图改读 map，`state.focusedPaneIdByPanel` 为 `undefined`，取 `[activePanelId]`
  会直接 `TypeError`。故「视图读镜像」这一选择由 store 单写入口保证正确性、由该 mock
  隐式锁定，**属可接受的耦合，但值得登记**：P2 若让视图改读 map，必须同步扩这个 mock。

## 6. 门禁 —— 自测基线（不复用 Track C 数字）

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit`（tsc 5.9.3） | **EXIT=0** |
| `npx vitest run` | **EXIT=1**，见下 |

**自测基线：480 测试文件 / 4815 用例（4808 passed / 3 skipped / 4 failed / 480 files
1 failed）。** 与原报告的 463/4589、Coder 的 465/4604 均不同 —— Coder 的数字测于 Track C
分支，合流到集成分支后又带进一批用例，故必须各自实测。

4 个失败全部集中在 `packages/extension-points/src/__tests__/security.test.ts`，成因单一：

```
ENOENT: no such file or directory, open '.../.worktrees/datazen-pane-retest/
        packages/pro-extensions/sql-editor-pro/manifest.json'
```

`packages/pro-extensions/` 由 `.gitignore:68` 忽略、从未被 git 跟踪，只存在于主检出，
**worktree 中按设计就不存在**（需 `scripts/resolve-pro.mjs` 落盘）。这既与 BUG-001 无关，
也**不在本轨道的可修范围**（禁止触碰 Pro 仓库、禁止 `pnpm install`）。单独复跑该文件
同样 4 失败，**排除顺序依赖**。其余 **479 文件 / 4811 用例全绿**，含本轨道全部 pane 用例。

> **门禁可复现性缺口（登记）**：任何在干净 worktree 里跑全量 `npx vitest run` 的代理都会
> 撞上这 4 个 ENOENT。Coder 报的「465 文件 / 4604 用例全绿」在干净 worktree 中无法复现。
> 建议在编排层统一约定：要么 worktree 预置 Pro 产物，要么把该文件排除出默认门禁并显式
> 声明，否则每个新代理都要重新诊断一遍。

---

## 交付物

新增（仅测试与工具，零业务代码改动）：

- `src/stores/__tests__/paneFocusDifferentialRepro.tester.test.ts`（8 例）——
  before/after 差分复现 + PROVENANCE 1/2/3 三条来源守卫（均经反向验证）
- `src/stores/__tests__/paneRealSequence.tester.test.ts`（14 例）—— P2 真实序列 12 帧 × 2 构建
- `src/stores/__tests__/paneP2ContractProbes.tester.test.ts`（7 例）—— P2 契约探针 A–G
- `src/stores/__tests__/paneFocusEntryLifecycle.tester.test.ts`（11 例）—— 单写入口锁定 + 逐次发射不变量
- `scripts/mutation-check-pane-focus.mjs` —— 变异测试工具，`node` 直接可跑，EXIT=0
- `src/stores/__tests__/fixtures/panelStore.pre-fix-227b6af8e.ts` —— **修复前 store 的
  逐字副本**，差分复现的「before」侧所必需。置于 `__tests__/fixtures/` 而非
  `src/stores/`：不进生产源码目录、不与真实 store 并列、文件名本身即写明快照时刻。
  重新生成（不要手工改，生成后把 banner 补回文件头）：
  ```sh
  git show 227b6af8e^:src/stores/panelStore.ts \
    > src/stores/__tests__/fixtures/panelStore.pre-fix-227b6af8e.ts
  ```

## 留给 P2 的待验清单（可执行条目，不是"待验证"）

本次复测**唯一没做的验证类别是 DOM 渲染**——分屏 UI 尚不存在，无从渲染。以下三条
现在已可写死，P2 开工时直接执行、逐条销账：

1. **【最大缺口】多 pane 视图真实渲染后，active 与 `focusedPaneId` 镜像是否一致。**
   本次只验证了「store 给出的 key」与「ContentView 会怎么用这个 mirror」两件事
   （读源码 + grep），**没有任何真实 DOM 渲染**。P2 必须补一个渲染级测试：真实挂载
   `ContentView`（或等价的多 pane 容器），分屏 tab A，再断言
   ① A 在 UI 上确为 active；② 下发给 `QueryPanel` 的 `focusedPaneId` 等于
   `focusedPaneIdByPanel[A]`；③ 切到 B 时这两者同步改变、A 的条目不受影响。
   判据：三者任一不符即为缺陷——store 层的 12 帧序列已证明 store 侧正确，DOM 侧
   出现偏差只能是视图接线问题。

2. **【硬性前置，不是注意事项】`ContentViewKvToolbar.test.tsx` 的 4 键 store mock。**
   该 mock 独立核实为 `{ panels, activePanelId, setActivePanel, updatePanel }`，
   **不含** `focusedPaneId`，**也不含** `focusedPaneIdByPanel`。
   - P2 **必须**保持视图读镜像 `focusedPaneId`——这不是偏好而是约束：镜像由 store 在
     **同一次 `set()`** 内重算，永不落后于 map，故**读镜像无陈旧读风险**；反向风险
     （后台 tab 焦点变化误触发重渲染）也不存在，因为视图只订阅镜像。
   - P2 **一旦**让视图改读 `focusedPaneIdByPanel`，该 mock 会**直接 `TypeError`**
     （取 `undefined[activePanelId]`）。届时**必须同批次扩 mock**，否则门禁红且原因
     看起来像产品缺陷。**先改视图后补 mock 的提交顺序要避免。**

3. **【待决设计问题，非缺陷】`openPane` 置 active 在后台 tab 分屏下会让用户"跳走"。**
   `openPane` 现在把被分屏的 tab 置为 active，相对修复前是**行为变更**。今天无生产
   调用点故不可达，故**不登记 BUG**；但 P2 拆 UI 前必须先定这个设计问题：
   对**后台** tab 触发分屏时，视图是该跳过去，还是分屏但不抢焦点？两条路都要可实现，
   选定后请在 P2 简报里写死，并补一条对应的测试（PROBE D 已固化当前行为）。

## 留给 P2 的两条设计备注（今天不可达，故不登记为 BUG）

1. **`openPane` 现在会把被分屏的 tab 置为 active —— 相对修复前是行为变更。** 若 P2 对一个
   **后台** tab 触发分屏，视图会跳过去。今天无调用点故不可达，但 P2 必须知道：后台分屏
   要么显式不传、要么接受跳转。
2. **store 侧不阻止「从未打开过的 pane」成为焦点。** `setFocusedPane('p3', A)` 在
   A 从未 `openPane(A,'p3')` 时会记下 `map[A]='p3'`，随后的 `updateSql` 又会由
   `patchExec` 播种 `panel-q-1::p3` —— **孤儿 exec entry 的那扇门依然开着**
   （PROBE A 已固化）。这属于**调用方契约**：store 负责记账，不负责校验 pane 归属。
   P2 的 pane 点击处理器必须只传自己 tab 内已存在的 paneId。另：`setFocusedPane` 不校验
   目标 tab 是否存在，会记一条无主条目，但**下一个改焦点的动作即由 prune 清除**，
   自愈（PROBE G 已固化），无需处理。

> 第 1 条对应上文待验清单第 3 项（待决设计问题）；第 2 条应作为**调用方契约**写进
> P2 简报的硬性约束。两者的证据均已由 PROBE A / D / G / E 固化。
