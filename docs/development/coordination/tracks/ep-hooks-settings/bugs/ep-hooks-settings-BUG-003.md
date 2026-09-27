# BUG-003：`proCompartments.ts:171` 的 `continue` 分支不可达（死代码）

- **状态**：待修复
- **严重度**：低
- **轨道**：ep-hooks-settings
- **发现者**：Tester（第 1 轮）
- **发现时基线**：`6d3fedf97`
- **类别**：死代码 / 误导性防御
- **是否本轨道引入**：**是**（`proCompartments.ts` 为本轨道新增文件）

---

## 一、一句话描述

`reconfigureProCompartments` 把"迟到槽位"折进 `extra` 之前，先判断
`if (id === EXTRA_COMPARTMENT_ID) continue;` 以免把 `extra` 折进自己。
但走到该循环的**前提**就是 `extra` 已挂载，而挂载的 `extra` 永远不会进入 `overflow` 列表 ——
所以这个 `continue` 永远不会执行。

---

## 二、代码位置

`src/components/sql-editor/proCompartments.ts:166-181`：

```ts
const extraCompartment = getProCompartment(EXTRA_COMPARTMENT_ID);
if (overflow.length > 0) {
  if (extraCompartment && extraCompartment.get(view.state) !== undefined) {   // ← 前提
    const merged: Extension[] = [...(payload[EXTRA_COMPARTMENT_ID] ?? [])];
    for (const id of overflow) {
      if (id === EXTRA_COMPARTMENT_ID) continue;        // ← L171，永不成立
      merged.push(...payload[id]);
    }
    direct.push(extraCompartment.reconfigure(merged));
  } else {
    console.warn(...);
  }
}
```

---

## 三、不可达性证明

1. `overflow` 的入列条件（`:151-160`）：
   `getProCompartment(id)` 为 `undefined`，**或** `compartment.get(view.state) === undefined`。
2. 进入 `:169` 的前提是 `extraCompartment.get(view.state) !== undefined`，
   即 **`extra` 确实挂载在这个 view 的 state 里**。
3. `extra` 是 `BASE_PRO_COMPARTMENT_IDS` 的成员（`:54`），模块加载时由 `:109` 的
   `for (const id of BASE_PRO_COMPARTMENT_IDS) ensureProCompartment(id)` 预先注册，
   因此 `getProCompartment('extra')` **永不**为 `undefined`。
4. 于是若 `id === 'extra'` 出现在 payload 中，它必然命中第 1 步的**否定**分支
   （已注册 且 已挂载）⇒ 被推进 `directIds`，**不可能**进入 `overflow`。
5. 若 `extra` 不在 payload 中，`overflow` 里当然也不会有 `'extra'`。

⇒ `id === EXTRA_COMPARTMENT_ID` 在该循环内恒为 `false`，`:171` 的 `continue` 是死代码。

---

## 四、客观证据：覆盖率

显式 coverage 跑（`proCompartments.ts` 行覆盖率 100%，**分支** 93.33%），
唯一未覆盖的分支位置正是 **L169-171**，且是 `continue` 所在的那一条。
"整文件行覆盖率 100% 却没有覆盖到某一行"的唯一解释就是该行不可达。

Tester 已在 `src/components/sql-editor/__tests__/proCompartments.tester.test.ts` 中
用两个**可达**用例把该区域的真实行为钉住：

- `"does not duplicate \`extra\` when it is also present in the payload"`
  —— 断言槽位内容为 `['only-once', 'late']`，即 `extra` 只出现一次；
- `"an id that is registered but not in this view is still treated as late"`
  —— 覆盖 `ensureProCompartment` 存在但未挂载的 id，证明它确实走 `overflow`。

这两条在**删掉** `:171` 之后依然通过 —— 证明该行对行为无影响。

---

## 五、影响面（为什么定为低危）

1. **无功能影响**：删掉后全部测试仍绿。
2. **但有阅读危害**：这段代码看起来像在处理"`extra` 可能在 overflow 里"的情形，
   而该情形不可能发生。维护者会因此高估 `reconfigureProCompartments` 的复杂度，
   或误以为存在一条"重复注入"的真实风险路径。
3. 与 §`:140-144` 的模块级注释叠加后更具误导性 —— 该注释描述了
   "先注册后挂载"与"视图建好后注册"两条路径，但 `:171` 让读者以为还有第三条。

---

## 六、期望行为

`overflow` 列表在进入合并循环时**按构造**就不含 `EXTRA_COMPARTMENT_ID`。
代码要么删掉该 `continue` 并把不变量写进注释，要么把该不变量提成
一个带断言的局部判定（例如只在 `id !== EXTRA_COMPARTMENT_ID` 时 push），
让"这不可能发生"变成可读的不变量而不是一条永不执行的分支。

---

## 七、修复方向

最小改动（二选一）：

- 删除 `:171`，并在 `:168` 附近补一行注释说明
  "`extra` 已挂载 ⇒ 它一定进了 `directIds` ⇒ `overflow` 不含 `extra`"；
- 或把该判断提到循环外，改写为对**整个 overflow 列表**的一次性过滤，
  使其在类型/结构上就不可能产出"把 extra 折进 extra"的中间态。

**注意**：不要因为删掉这行就把 `proCompartments.ts` 的分支覆盖率门槛下调 ——
本轨道分支覆盖率本已 98%+，删掉死代码只会更高。
