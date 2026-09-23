# redis-detail-ui-BUG-008 · 偏差⑥ 不一致态下「保存」写向陈旧 `detail.key`（旧名），与屏幕显示的目标键不符

- **登记**：第 3 轮复测 Tester（round-3，全新实例），2026-09-23
- **状态**：`待修复`
- **严重度**：**高**（静默写错目标键 + 复活已 RENAME 掉的键 + 用户草稿"凭空消失"三者同时发生；且属 PRD §3.3 屏 B 右列编辑面的核心写路径）
- **来源**：round-3 复测「遗留项 2 裁定」取证探针（`ui/__tests__/testerRound3Probe.test.tsx` D 组，现以 `describe.skip` 保留正确期望）。BUG-007 的修复把不一致态**有界化**（不再静默毁草稿），但未**消解**它；本轮顺藤检查该残留态还有哪些后果时命中本条。

## 复现步骤（jsdom 探针，`round2Probe` 同款 harness）

1. 选中 `user:1`（string），值改成 `draft` ⇒ `isDraftDirty()=true`。
2. 右键 `user:1` → 「重命名」→ 填 `user:renamed` → 确认（RENAME 出网；`onUpdateSelectedKey(next)` 在守卫之前已改掉选中）。
3. 守卫弹层答「继续编辑」（`redis-draft-keep`）⇒ 进入偏差⑥ 不一致态：
   - 树行标签 `data-selected-key='user:renamed'`（新名）
   - 编辑器头 `redis-header-key-name='user:1'`（旧键，`keyDetail.key` 未跟）
   - 草稿完整（BUG-007 修复后的正确行为，P1a/P1b 绿）
4. **带着草稿点「保存」**（底栏 `redis-string-dirty-bar` → `redis-string-save`）。

## 期望 vs 实际（round-3 实测，HEAD `b56e37e0f`）

| | 期望 | 实际 |
| -- | ---- | ---- |
| SET 目标键 | 面板显示/列表选中的 `user:renamed` | **`user:1`（RENAME 前的旧名）** |
| 与屏幕一致性 | 写向用户看到的键 | 静默写向另一个键 |
| 服务器状态 | 只影响 `user:renamed` | **复活 `user:1`** 并写入草稿 |
| 用户可见结果 | 草稿落到所见键 | 保存后 `reloadDetail` 回读 `user:renamed` ⇒ 显示仍是服务端旧值 `renamed-value` |

实测取证（探针逐字输出，`SET 实参 = ["sess-r3",0,"user:1","draft"]`）：

```text
[round-3 取证] SET 实参 = ["sess-r3",0,"user:1","draft"]
[round-3 取证] 保存后状态 = {
  "saveTarget": "user:1",
  "treeSelected": "user:renamed",
  "headerKeyName": "user:renamed",
  "inputValue": "renamed-value",
  "draftDirty": false,
  "detailState": "ready",
  "refetched": ["user:1", "user:renamed"]
}
```

用户视角完整链条：**点保存 → 草稿消失 → 值回退成服务端旧值 → 但实际写进了另一个键（且该键已不存在）**。三处都不符预期，且全程零提示。

## 根因（代码路径，逐行）

1. `KeyWorkbenchDialogs.tsx:189-216` `handleKeyCtxRename`：`await invokeRename(...)` 成功后
   **先** `onUpdateSelectedKey(next)`（:199-201，无守卫、答 keep 不回滚）⇒ `selectedKey` 变成新名，
   而 `keyDetail` 未被触碰 ⇒ `keyDetail.key` 仍是旧名。
2. `RedisWorkbench.tsx:356-358`（BUG-007 修复）：同键跨不一致时先过 `requestDraftLeave()`；
   答 keep ⇒ `return`（正确：草稿保住了），**但不一致态原样留存**。
3. `StringEditor.tsx:155`：`await invokeSetString(dbSessionId, dbIndex, detail.key, value)`
   —— 保存目标取自 **`detail.key`（旧名）**，而非 `selectedKey` / 面板显示名。
4. `RedisWorkbench.tsx:403-412` `reloadDetail`：保存成功后 `handleSelectKey(selectedKey)` 回读**新名**
   ⇒ detail 换成新键的服务端值；编辑器按 `key={detail.key}` 重挂载 ⇒ 用户草稿在屏幕上"蒸发"。

即：**BUG-007 修复了"不一致态下点同键行会毁草稿"，但没修"不一致态下保存会写错键"** —— 后者更隐蔽，
因为它以"保存成功"的面目出现。

## 与 BUG-007 的关系（为何单列而非退回）

- BUG-007 的验收句是「不一致**消解**或有界」，修复者选了「有界 + 知情同意」，该验收**成立**（round-3 已复现验证：keep 后每次同键点击重问，草稿永不静默蒸发）。
- 但「有界化」只保证**草稿不静默消失**，不保证**不一致态本身无害**。本条证明该残留态仍有独立的破坏后果（写错键），
  属新缺陷、新可达路径、新后果，故单列 BUG-008，**不退回 BUG-007**。
- 反过来说：若 BUG-008 按「不一致必须真消解」修复（(a) 路线），BUG-007 的残留态将不复存在 —— 两条同根，
  建议修复者一并考虑（见下）。

## 修法建议（Tester 只测不修）

- **(a) 真消解不一致（根治两案）**：`handleKeyCtxRename` 里 `onUpdateSelectedKey(next)` 之后同步
  `setKeyDetail(prev => (prev ? { ...prev, key: next } : prev))`。**注意**：`DetailColumn.tsx:97` 用
  `key={detail.key}` 挂编辑器 ⇒ 改 `detail.key` 会重挂载并立刻毁草稿（守卫来不及问）——
  故必须**先问守卫、后改名**（把 `onUpdateSelectedKey` / `setKeyDetail` 挪到 `await onSelectKey(next)` 的守卫之后，
  或让该处显式先 `await requestDraftLeave()`）。
- **(b) 最小改法（只修写错键）**：`StringEditor` 的保存目标改用 `selectedKey` 而非 `detail.key`
  （或由父级把「当前真实键」作为 prop 传入）。风险面：`selectedKey` 与 detail 的一致性假设需全局复核。
- **(c) 兜底**：保存前若 `detail.key !== selectedKey` ⇒ 先 `requestDraftLeave()` 并在放行后重取，
  拒绝时不出网（本路径最小、与 BUG-007 的收口风格一致）。
- 无论哪种，验收断言 = 探针 D 组（取消 `describe.skip`）：`SET` 目标键必须等于
  `data-selected-key` 与 `redis-header-key-name` 所指的键。

## 影响范围

- 只读路径：右键重命名**选中键** + 脏草稿 + 答「继续编辑」（= 偏差⑥ 残留态）后点保存。
- 头行改名（`KeyEditors.tsx:119-127`）**不受影响** —— 它先过守卫再 `invokeRename(detail.key, newName)`，
  答 keep 时 RENAME 根本不出网，故不会产生不一致态；`dirtyLeaveCoverage.test.tsx:280-310` 已钉住该顺序。
- 非选中键的右键改名不触 `onUpdateSelectedKey`，不受影响；干净态（无草稿）下守卫放行 ⇒ 不一致当场愈合，不受影响。
- **前提条件**：`KeyWorkbenchDialogs.tsx` 的「RENAME 先出网、守卫后问」顺序为**存量行为**（`8981d3078` base 同序），
  非本轨引入；但本轨 E-5 引入 I-1 守卫后，"答 keep 留下不一致态"这一**可达态**才成立 ⇒ 本条属本轨验收面。
