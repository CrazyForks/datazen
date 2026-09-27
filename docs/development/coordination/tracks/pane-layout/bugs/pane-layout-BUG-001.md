# pane-layout-BUG-001 · `focusedPaneId` 是全局单值而非按 tab 作用域，焦点跨 tab 泄漏

- **严重度**: 中（latent / 潜伏——本波尚无分屏 UI 调用 `openPane`/`closePane`，用户不可达；但它正落在本波要交付的接缝上，下一波 P2 一旦接 UI 立刻变成用户可见的数据丢失）
- **状态**: 待修复
- **轨道**: pane-layout
- **发现人**: 独立 Tester（阶段 A 代码审查 + 阶段 C 覆盖率驱动补测）
- **类型**: 状态模型缺陷（新引入），非测试缺陷

## 涉及文件

| 文件 | 角色 |
| --- | --- |
| `src/stores/panelStore.ts:83` | `focusedPaneId: string \| null` 声明为**单一全局字段** |
| `src/stores/panelStore.ts:360-369` | `openPane` 无条件写全局 `focusedPaneId` |
| `src/stores/panelStore.ts:374-381` | `closePane` 只比较 `paneId`、**从不比较所属 `panelId`**，见下方缺陷点 |
| `src/stores/panelStore.ts:293-295` | `setActivePanel` 不重置 `focusedPaneId`（切 tab 时旧焦点原样带过去） |
| `src/windows/connection/ContentView.tsx:88, 560` | 读全局 `focusedPaneId`，下传给**当前 active** 的任意 panel |
| `src/windows/connection/PanelContentRenderer.tsx:125, 323` | 原样透传给 `QueryPanel` |
| `src/stores/queryExecActions.ts:86-90` | `patchExec` 对未知 key 播种 `emptyQueryExecState()`，使幻影 pane 得以被创建 |

**缺陷点原文**（`src/stores/panelStore.ts:378`）：

```ts
focusedPaneId: s.focusedPaneId === paneId ? DEFAULT_PANE_ID : s.focusedPaneId,
```

`paneId` 是**每个 panel 各自命名空间内的局部 id**（`paneKey` 拼成 `panelId::paneId` 正是为此），而 `focusedPaneId` 只有一个全局槽位。只比 `paneId` 不比 `panelId`，等于把「哪个 tab 的哪个 pane」压缩成了「哪个 pane」。

## 描述（含量级）

pane 属于某个 panel，但焦点不属于 tab。三条后果：

1. **切 tab 后路由到幻影 pane。** 一旦 A tab 被分屏并聚焦其 `p2`，未分屏的 B tab 仍会收到同一个全局 `focusedPaneId='p2'`，于是解析出 `panel-q-2::p2` —— `addPanel` 从未播种过的 key。B tab 自己的 SQL 与结果仍在 `panel-q-2`，但**再也没人读得到**，界面渲染空白编辑器。

2. **编辑写入无人认领的孤儿 entry。** 在 B tab 敲字时 `updateSql` 走到 `panel-q-2::p2`，而 `patchExec` 对未知 key 会 `emptyQueryExecState()` 播种，于是凭空生成一个**任何 pane 列表都未声明**的 exec entry。Execute 随后把结果流进这个孤儿，用户永远看不到。一次「分屏 A 再切回 B」的操作就让 B 的 4 条 exec entry 里多出 1 条孤儿。

3. **关一个 pane 会抢走另一个 tab 的焦点。** `closePane` 只比 `paneId`。关闭 B tab 的 `p2` 会把全局焦点重置为 `main`，即使该焦点其实属于 A tab 正在使用的 `p2`。

量级：每次「分屏一个 tab + 在多 tab 间切换」触发 1、2；每次「关闭与当前 tab 同名 pane id 的 pane」触发 3。

## 重现步骤（全部已自动化，见下）

1. `addPanel(panel-q-1)`、`addPanel(panel-q-2)`。
2. `openPane(panel-q-1, 'p2')` —— A 被分屏，全局 `focusedPaneId` 变为 `'p2'`。
3. `setActivePanel('panel-q-2')` —— 切到未分屏的 B。
4. 复现 1：按 `ContentView`→`QueryPanel` 的真实路径解析
   `paneKey('panel-q-2', resolveFocusedPaneId(store.focusedPaneId))`，实测得 `'panel-q-2::p2'`，
   而 `queryExec.get('panel-q-2::p2')` 为 `undefined`；B 的真实 SQL 仍在 `panel-q-2`。
5. 复现 2：按 `QueryPanel` 真实路径调 `updateSql('panel-q-2', 'SELECT edited', ...paneArgs(paneId))`，
   实测 `queryExec` 从 3 个 key 涨到 4 个，多出 `panel-q-2::p2`；`executeQuery` 把结果流进该孤儿。
6. 复现 3：`openPane(panel-q-1,'p2')`、`openPane(panel-q-2,'p2')`、`setActivePanel(panel-q-1)`、
   `setFocusedPane('p2')`，然后 `closePane('panel-q-2','p2')` —— 实测 A 的路由 key 从
   `panel-q-1::p2` 变成 `panel-q-1`。

## 实测错误日志

回归测试：`src/stores/__tests__/paneFocusScope.tester.test.ts`（Tester 新增，3 例全红）

```
× routes an unsplit sibling tab to its own pane, not a foreign pane id
  → expected 'panel-q-2::p2' to be 'panel-q-2' // Object.is equality
× never grows an exec entry for a pane the never-opened pane
  → expected [ 'panel-q-1', 'panel-q-1::p2', 'panel-q-2', 'panel-q-2::p2' ]
            to deeply equal   [ 'panel-q-1', 'panel-q-1::p2', 'panel-q-2' ]
× does not steal focus belonging to another tab when a pane closes
  → expected 'panel-q-1' to be 'panel-q-1::p2' // Object.is equality

Test Files  1 failed | 1 passed (2)
     Tests  3 failed | 11 passed (14)
```

## 影响范围

- **本波**：无用户可见影响。生产代码目前没有任何调用点触发 `openPane` / `closePane` /
  `setFocusedPane`（`grep focusedPaneId` 生产命中点仅 `panelStore` 自身 + 纯透传的
  `ContentView` / `PanelContentRenderer` / `QueryPanel`），`focusedPaneId` 恒为 `null`，
  故 `resolveFocusedPaneId(null) === 'main'`，单 pane 行为确实零变化。
  **验收项 2「单 pane 行为零变化」成立，本 Bug 不违反该条。**
- **下一波 P2**：一旦分屏 UI 接入 `openPane`，上述三条立即全部变为用户可见，
  其中 1、2 是**静默数据丢失**（用户 SQL 与结果集消失），3 是焦点错乱。
- 与 `progress.md` §二「**无 `focusedPaneId`**」列为多实例隐患的判断一致：本波补上了
  这个字段，但补成了**全局单值**；正确形状应是按 panel 作用域
  （例如 `focusedPaneIdByPanel: Record<string, string>`，或把 `panelId` 纳入
  `setFocusedPane` / `openPane` / `closePane` 签名）。

## 修复建议（供参考，不代做）

把焦点从「全局单值」改为「按 panel 作用域」，二选一：

1. `focusedPaneId` → `focusedPaneIdByPanel: Record<string, string>`；
   `ContentView` 改为按 `activePanel.id` 取值。`closePane` 的重置天然变成 per-panel。
2. 保留字段但把 `panelId` 并入签名（`setFocusedPane(panelId, paneId)`、
   `openPane(panelId, paneId)` 已是、`closePane(panelId, paneId)` 已是），
   并让 `ContentView` 只在 `focusedPaneId` 属于当前 active panel 时才下传。

无论哪种，`paneFocusScope.tester.test.ts` 的 3 例都应转绿。

## 复测指引

修复后由**全新 Tester** 复测，需重跑完整套件（不只本 Bug 涉及文件）确认无回归：
`npx tsc --noEmit`（须 EXIT=0，含测试文件）+ `npx vitest run`
（基线 **463 文件 / 4589 用例全绿**；Tester 新增用例后为 465 文件 / 4603 用例，
其中 `paneFocusScope.tester.test.ts` 3 例应转绿）。
