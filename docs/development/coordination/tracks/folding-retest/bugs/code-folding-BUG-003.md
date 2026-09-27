# BUG-003：`sqlFoldService` 的注释承诺与实现相反，一个 region 画出 N 个箭头

- **状态**：待修复（未修复；本轨 Tester 只测不修）
- **严重度**：中（功能性 + 文档误导；不改也能折叠，但注释描述的行为不存在）
- **轨道**：folding-retest
- **发现者**：Tester（独立复测）
- **发现时基线**：Pro `local-productivity/code-folding` @ `2dfba67`
- **类别**：注释与实现矛盾 / 视觉行为缺陷
- **是否本轨道引入**：**是**
- **业务代码改动**：**零**。本条若要修，需要改业务代码，Tester 不动，仅登记。

---

## 一、一句话描述

`src/fold/foldExtension.ts` 中 `sqlFoldService` 上方的注释写着"只为**起始行落在请求区间内**的
region 提供箭头，因为为一个开启 token 画出多个箭头会暗示存在多个可独立折叠的块，而实际只有一个"；
但实现的判定条件**只看区间是否相交**，于是 CodeMirror 对一个跨越 4 行的 region
在**每一行**各画一个 "Fold line" 箭头 —— 正是注释声称要避免的那个结果。

---

## 二、矛盾点逐字对照

**注释（`foldExtension.ts` `sqlFoldService` 上方）声称：**

> Only regions that **start on a line inside the requested range** … Showing several arrows
> for one opening token would imply several independent folds where there is one.

**实现（`sqlFoldService`，`foldExtension.ts:139-158`）实际做的事：**

```ts
for (const region of regions()) {
  // 只判重叠，不判"起始行"
  if (region.to <= lineStart || region.from >= lineEnd) continue;
  if (/* 已折叠 */) continue;
  if (!best) best = region;
}
```

`foldGutter` 对**每一行**调用一次 `foldService(state, lineStart, lineEnd)`。
重叠判定对"跨 4 行的 region"在 4 行上都成立，于是返回 4 次同一个 region。

---

## 三、证据

- **[真实流水线测量]** 文档 `SELECT (\n  a,\n  b\n)`（4 行，1 个 region），
  折叠**前** gutter 读到：`['Unfold line'(占位), 'Fold line' × 4]`。
  即**一个 region 画出 4 个 "Fold line" 箭头**，而不是注释描述的开头 token 处 1 个。
  折叠**后**：`['Unfold line'(占位), 'Unfold line' × 1]`，`foldState.size === 1`。
  ⇒ 4 个箭头点的是**同一个** `foldState` 条目，不存在"多个独立折叠"。
- **[机制论证，最弱]** 上面那行"4 个箭头点同一个条目"是对 `foldState.size === 1` 的读数，
  属于间接证据；直接证据是 DOM 计数。两条已分列。

---

## 四、为什么这不只是注释洁癖

1. **用户可见**：SQL 里一个 `SELECT (...)` 块会在 4 行上出现 4 个折叠箭头，
   视觉上暗示"这里有 4 个可以各自折叠的东西"。点击任意一个，效果完全相同。
2. **它是测试盲区**：`foldJourney.test.ts` 的 4 条 gutter 断言全部用
   `toContain` / `not.toContain` 语义，**天然测不出箭头数量**，
   所以这个行为错误可以一直绿着通过。
3. **两个方向只能选一个**：要么实现改成"只在该 region 的起始行给箭头"（符合注释），
   要么注释改成承认"每行都给箭头"并解释为什么。当前状态是**注释描述了一个没实现的功能**，
   后人会照着注释去改测试或加断言，落空。

---

## 五、建议（Tester 不实施）

由 Coder 二选一：

- **A（对齐注释）**：在重叠判定之上再加"该 region 的起始行 == 当前行"的条件，
  一个 region 只画 1 个箭头。需要补一条"箭头数量 == region 数量"的测试。
- **B（对齐实现）**：改注释，如实描述"区域内每行都给箭头"，并说明这符合 CodeMirror
  惯用行为。此时 `foldGutter` 视每一行都可折叠是合理的。

无论选哪个，**建议把 `toContain` 类断言升级为精确数组断言**，否则数量类回归仍然测不出来
（与 BUG-002 是同一处修改）。
