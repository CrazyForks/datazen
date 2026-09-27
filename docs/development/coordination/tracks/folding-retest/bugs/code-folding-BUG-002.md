# BUG-002：折叠后的 "Unfold line" 断言有一半是夹具假象，功能全死它也绿

- **状态**：待修复（未修复；本轨 Tester 只测不修）
- **严重度**：中
- **轨道**：folding-retest
- **发现者**：Tester（独立复测）
- **发现时基线**：Pro `local-productivity/code-folding` @ `2dfba67`
- **类别**：测试断言空转（vacuous assertion）
- **是否本轨道引入**：**是**
- **业务代码改动**：**零**。

---

## 一、一句话描述

`foldJourney.test.ts:495` 那条 "swaps the arrow for an unfold arrow once the line is collapsed"
里，**正向半句** `expect(...).toContain('Unfold line')` 在**折叠功能完全不存在**时也成立 ——
因为 CodeMirror 的 `foldGutter` 本身就会**无条件**渲染一个隐藏的占位元素，
而该测试的 `arrowsIn()` 辅助函数**不过滤**它。

---

## 二、机制（可复现，非推断）

`foldGutter` 挂载后，行号槽里**恒定**存在这样一个节点：

```html
<div class="cm-gutterElement" style="height: 0px; visibility: hidden; pointer-events: none;">
  <span title="Unfold line">›</span>
</div>
```

`title` 就是 `"Unfold line"`。它与折叠是否工作**毫无关系**，是 CodeMirror 用来占位的
`spacer`，宽度 0、`visibility: hidden`、不接收指针事件。

而本测试的取值辅助函数：

```ts
function arrowsIn(view: EditorView) { /* 收集全部 cm-gutterElement 的 title */ }
```

**不区分可见与不可见**。于是 `toContain('Unfold line')` 在这两种世界里都成立：

| 世界 | `arrowsIn(v)` 的值 | 该断言 | 真实功能 |
|---|---|:---:|:---:|
| 正常：折叠生效 | `['Unfold line'(占位), 'Unfold line'(真箭头)]` | ✅ | 正常 |
| **折叠功能全死（只挂 gutter，不注册 foldService）** | `['Unfold line'(占位)]` | **✅ 假绿** | **无** |

在"全死"世界里 `not.toContain('Fold line')` 也成立（因为根本没有 Fold 行），
所以**这条测试的两个半句在功能全死时都通过**。

**它今天之所以还会红，唯一的功劳是它的第一行**（真正的折叠动作）——
删除 `foldService.of(sqlFoldService)` 后，第一行先红，测试才整体红。
正向半句本身**零贡献**。

---

## 三、证据

- **[真实流水线测量]** 我在只挂载 `codeFolding() + foldGutter()`、**完全不注册 `foldService`**
  的编辑器上读取 gutter：结果为 `["Unfold line"]`，
  与 `foldJourney.test.ts:495` 的两个半句都吻合。
- **[变异证据]** 删除 `foldService.of(sqlFoldService)` 后 `foldJourney` 4 条 gutter 测试全红，
  但红的**触发点**是 495 的第一行折叠动作，不是 `toContain('Unfold line')`。

---

## 四、影响边界（不夸大）

- 这不是"这条测试没用"。它的**第一行**是真断言，能捕获功能全死。
- 本条主张的仅是：**`toContain('Unfold line')` 这一半无法区分"折叠后的箭头"和"占位符"**，
  因此它对"箭头文案配错/折叠态渲染错"这一类缺陷**不敏感**。
- 与 BUG-004 相互印证：同一批 gutter 断言里，只有这一条存在空转。

---

## 五、建议（Tester 不实施）

在 `arrowsIn()` 里过滤掉 `visibility: hidden` 的占位节点（我自己的回归测试
`foldServiceFacetRegression.tester.test.ts` 里的 `arrows()` 已经这么做了），
或改断言为**精确序列**断言，例如折叠后应恰好是 `['Unfold line']`（真箭头 1 个）
而不是 `toContain`。后者还能顺带暴露"一个 region 画出 4 个箭头"的问题（见 BUG-004）。
