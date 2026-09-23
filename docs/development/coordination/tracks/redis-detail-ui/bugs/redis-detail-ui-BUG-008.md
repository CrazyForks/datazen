# redis-detail-ui-BUG-008 · 偏差⑥ 不一致态下「保存」写向陈旧 `detail.key`（旧名），与屏幕显示的目标键不符

- **登记**：第 3 轮复测 Tester（round-3，全新实例），2026-09-23
- **状态**：`已修复`（round-4 复测通过）
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

## 修复记录（coder round-3）

- **修复者**：修复轮第 3 回合 Rescue Coder（`w3e-rescuer-r3`，全新实例）。
- **commit**：`c70ef8c9c` —— `fix(redis-ui): ask the draft guard before renaming so the stale-key save path cannot exist (BUG-008)`。
- **修法选型：Tester 建议 (a) 的落地形态 —— 「先问守卫、后换键」，终态 = 不一致态从源头消失。**

### 改动（`key-browser/KeyWorkbenchDialogs.tsx` `handleKeyCtxRename`）

原序在守卫**之前**就改写选中键：

```ts
await invokeRename(dbSessionId, dbIndex, keyCtxDialog.key, next);
closeKeyCtxDialog();
if (selectedKey === keyCtxDialog.key) {
  onUpdateSelectedKey(next);        // ← 守卫还没问，选中键已变成新名
}
onUpdateSelectedKeys(...);          // 批量选中集合：与守卫无关
onRefreshKeys();
await onSelectKey(next);            // = handleSelectKeyGuarded：答 keep 直接 return
```

现序改为**先问、后换**，并删去 `onUpdateSelectedKey` 这条旁路 prop：

```ts
await invokeRename(dbSessionId, dbIndex, keyCtxDialog.key, next);
closeKeyCtxDialog();
onUpdateSelectedKeys(...);          // 批量选中集合：与守卫无关，保持原位
onRefreshKeys();
await onSelectKey(next);            // 守卫在这里问；答 keep ⇒ 原样返回
```

- 答 keep ⇒ `handleSelectKeyGuarded` 返回、`handleSelectKey`（`setSelectedKey` 的**唯一**写入口）未执行
  ⇒ 选中键与 `keyDetail.key` **双双仍是旧键** ⇒ 从 UI 状态看**根本未改名** ⇒ 偏差⑥ 不存在
  ⇒ `StringEditor.tsx:155` 的 `detail.key` 与 `selectedKey` 恒一致 ⇒ 写错键 + 复活旧键的路径**不可达**。
- 答放弃 / 干净态 ⇒ 守卫放行 ⇒ `handleSelectKey` 切到新键（含 `setSelectedKey`）⇒ 标签、键头、detail 齐步。
- 干净态（无草稿）+ 干净一致性下 `requestDraftLeave()` 立即 `true`，语义与改前一致，无新增弹层。
- 批量选中集合 `onUpdateSelectedKeys` 与守卫**无关**（它跟随"键本身被改名"这一既成事实），保持原位不动。

### 与简报伪码的实质偏差（请协调者知悉）

简报伪码在 `await onSelectKey(next)` **之后**保留了一句**无条件**的 `onUpdateSelectedKey(next)`。
该句在答 keep 时**照样会执行**：`selectedKey` 是渲染期闭包值，若写成
`if (selectedKey === keyCtxDialog.key) onUpdateSelectedKey(next)`，该 `if` 读到的是**旧值**
（`'user:1'`，恰好等于 `keyCtxDialog.key`）⇒ 条件为真 ⇒ 仍会把选中键改成新名而 detail 留在旧键
—— **正是本条要消灭的偏差⑥**。简报自身的原则（"答 keep ⇒ `onUpdateSelectedKey` **不执行**"）要求它
必然是**有条件**的，而 `handleSelectKey` 已经承担换键职责，故最终实现**删去该冗余调用**：
语义与简报原则一致，与伪码字面不同。此处已按"唯一期望终态：不一致态从源头消失"的验收句裁定。

### 断言同步改写

- **P1a**（`round2Probe.test.tsx`）**改写前后对照**：

| | 改写前（钉 BUG-008 的不一致态） | 改写后（钉不一致态不存在） |
| -- | -- | -- |
| `data-selected-key` | `'user:renamed'`（新名） | **`'user:1'`（旧键）** |
| `redis-header-key-name` | `'user:1'`（旧键） | **`'user:1'`（旧键）** |
| 草稿三件套 | `'draft'` / `data-string-dirty==='true'` / `isDraftDirty()===true` | **原样保留** |
| `data-detail-state` | `'ready'` | **原样保留** |
| 询问至多一次 | `leaveDialog()===null` 且 `isLeavePending()===false` | **原样保留** |

- **P1b**：不变式（草稿不得静默蒸发）保持；落点由"同键跨不一致态"改为"普通跨键切换"（因答 keep 后选中键仍是
  `user:1`，点 `user:renamed` 是跨键），并补两条正断言（选择仍为 `user:1`、确实弹了守卫）。
- **`testerRound3Probe.test.tsx`**：`expectDeviation6()` 由「标签=新名 / 键头=旧键」改为「两者同为 `user:1`」；
  A/B/C 主体断言不变；**D 组 `describe.skip` 取消**（见下）。

### D 组 unskip 结果

`describe.skip('[redis-detail-ui-BUG-008] …')` → `describe(...)`，转正为验收断言并绿。因修复后答 keep 根本未改名，
正确终态为「保存写向用户看到的那个键」= `user:1`：

```text
target === data-selected-key === redis-header-key-name === 'user:1'
invokeSetString('sess-r3', 0, 'user:1', 'draft')
```

原 D 组断的 `target === 'user:renamed'`（"写到用户看到的键"）在**旧**语义下是正确期望；
新语义下"用户看到的键"本身已是 `user:1`，故断言随语义平移，**不是降级**：不变式
「保存目标 = 面板显示 / 列表选中的键」逐字保留，且额外钉了写实参。

### 四门禁（逐字尾部）

```text
G1  Test Files  60 passed (60)
         Tests  564 passed (564)            ← 基线 563 passed / 1 skipped，D 组转正 +1
G2  [tsc exit: 0]
G3  ✓ built in 4.69s
    [vite build exit: 0]
G4  [check-driver-import-boundaries] ok (1474 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
    [boundaries exit: 0]
```

- **未自测代替复测**：本回合只做修复与门禁取证，**由协调者派全新 Tester 做第 4 轮复测裁定**。

### 变异反向验证（证明新断言非 vacuous）

手法：把两个生产文件 `git checkout 3e25a3c0f -- …`（= **逐字还原到修复前**，已验
`git diff 3e25a3c0f -- packages/drivers/redis/ui/key-browser/` 为空）后跑**修复后的新测试**，
再 `git checkout HEAD -- …` 还原并验 `git status --porcelain` 净：

```text
 Test Files  2 failed (2)
      Tests  5 failed | 3 passed (8)

× round2Probe P1a      「继续编辑 keeps label AND detail on the old key」  ← 期望 'user:1'，实得 'user:renamed'
× round2Probe P1b      「重命名+keep 后点新名行不得静默毁草稿」            ← 同上
× round3Probe A        「先问、答 keep 不放行、再点再问」                  ← expectDeviation6 红
× round3Probe B        「答放弃才换到新名」                                ← expectDeviation6 红
× round3Probe D(BUG-008)「保存必须写到用户看到的那个键」                   ← expectDeviation6 红
✓ round3Probe C        「一致态同键重点击零询问」                          ← 不受改名顺序影响，应绿
✓ round2Probe P2 ×2    「工具栏刷新一次动作只问一次」                      ← 同上
```

⇒ 5 条改写/转正断言**全部可证伪**（D 组在修复前必红 ⇒ 非"转正即恒真"的占位）；
3 条不受影响的用例保持绿 ⇒ 修复**未误伤**相邻路径。还原后复跑 **8/8 绿**、工作树净。

- **注**：首次变异尝试写错了（在已删除该 prop 的组件里引用 `onUpdateSelectedKey?.()` 导致
  `ReferenceError` 而非真实缺陷），已弃用该手法、改用上述"整文件还原到 pre-fix"的忠实变异。



---

## 复测记录（round-4）

**Tester**：全新实例（只测不修）· 复测 HEAD `b7ef8a009`（修复轮第 3 回合交付态）· 判定：**通过 ⇒ 翻 `已修复`**

### 1. 文件面 ✅

`git diff 3e25a3c0f..HEAD --name-status` ⇒ 恰 7 文件，全部落在许可面（本 bug 生产改动仅
`key-browser/KeyWorkbenchDialogs.tsx` +6/−5 与 `key-browser/RedisWorkbench.tsx` 的 prop 删除 1 行）。
禁改面反向 grep（Cargo / hub.md / scripts / locales / StringEditor / TtlControls / keyReadOnlyPolicy /
BatchBar / ImportExport / redisInvoke / console / kv-bar / meta / 宿主 `src/` / driver-sdk / 其他轨台账 / BUG-001~007 正文）
⇒ **NONE**（exit 1）。

### 2. 前提独立确认（「选中键唯一写入口 = `handleSelectKey` 内 `setSelectedKey`」）✅

`grep -rn setSelectedKey packages/drivers/redis/ui/` 实证：生产码 8 处调用中，
`RedisWorkbench.tsx:262/:299/:323/:776` 为**清空**（`null`），`:724` 为 `DetailColumn onRenamed` 出口，
`:357` 位于 `handleSelectKey` —— 即**唯一的「换到另一个具体键」写入口**。
`onUpdateSelectedKey`（单数）prop 已彻底移除（grep 仅命中复数 `onUpdateSelectedKeys`，属批量集合，与选中键正交）。
连带核对：`onRefreshKeys = refreshKeysForDialogs` 在 `isDraftDirty()` 为真时只做 `scanRefresh()+tree.refresh()`，
**不**调 `refreshKeys()` ⇒ 脏草稿时 `setSelectedKey(null)` 那条路亦不可达。
⇒ **推理链闭合：答 keep ⇒ 守卫 `return` ⇒ `handleSelectKey` 未执行 ⇒ 选中键与 `detail.key` 双双留旧键 ⇒ 不一致态不存在 ⇒ 写错键路径不可达。**

### 3. 基线跑 ✅

`npx vitest run --config vitest.drivers.config.ts testerRound3Probe.test.tsx round2Probe.test.tsx`
```
 Test Files  2 passed (2)
      Tests  8 passed (8)
```
⇒ **8/8 绿 · 0 skipped**（D 组已由 `describe.skip` 转正且在册）。

### 4. 变异矩阵（各改-跑-记红-还原-验净）

| # | 注入 | 结果 | 红在哪条 |
| --- | --- | --- | --- |
| (i) | `await onSelectKey(next)` 挪回 `onUpdateSelectedKeys` **之前** | **全绿 8/8** | 无 —— 见下「(i) 归因」 |
| (ii) | 守卫后加回无条件选中键改写（`await handleSelectKeyGuarded(key)` 后补 `setSelectedKey(key)`，等价于被删行） | **5 failed / 3 passed** ✅红 | `expectDeviation6`（`testerRound3Probe:222`，`data-selected-key` 期望 `user:1` 实得 `user:renamed`），经 `:287`/`:342`/`:399` 三用例；`round2Probe:293:56`；`round2Probe:331:61` |
| (ii-a) | 忠实回退：两生产文件整体还原 `3e25a3c0f` | **5 failed / 3 passed** | 同上 5 条（与 coder 自报逐位一致） |
| (iii) | 守卫**之前**直接改选中键（加回 `onUpdateSelectedKey` prop 并在 `closeKeyCtxDialog()` 后调用） | **5 failed / 3 passed** ✅红 | 同 (ii) |

**(i) 归因（「注入后仍绿」必查项）**：注入 (i) **不构成测试强度缺陷**。修复前产生偏差⑥ 的**唯一**机制是被删掉的
`onUpdateSelectedKey(next)`；而 `await onSelectKey(next)` 在生产码中**无前导 await** ⇒ 同步执行到守卫第一行，
与同行内联**逐字等价**：答 keep ⇒ 守卫 return（选中键仍不被改写）；答放弃 ⇒ 两处 `setSelectedKey(next)` 取值相同（幂等）。
故 (i) 在已删除陈旧写入行的前提下是**语义等价变换**，全绿属正确。
真正重造偏差⑥ 的两项 —— (ii)（等价恢复被删行）与 (iii)（放回守卫之前）—— **均实测转红**，忠实回退 (ii-a) 亦红
⇒ **修复的因果面被有效钉住，测试强度充分**。**变异矩阵：通过。**

### 5. 不变式实测（保存目标键 === 面板显示键 === 选中键）✅

以 temp 探针实测三条路径后**即删**（不进交付面，`git status` 验净）：

```
[INV-1]  target=user:1        panel=user:1        selected=user:1        (rename + dirty + 答 keep 后保存)
[INV-2a] panel=user:renamed   selected=user:renamed  input=renamed-value (rename + dirty + 答放弃)
[INV-2b] target=user:renamed  panel=user:renamed  selected=user:renamed  (新键上再编辑并保存)
[INV-3]  panel=user:renamed   selected=user:renamed  input=renamed-value (rename 干净态)
```

- 答 keep：三者同为旧键 `user:1`，保存**写向用户看到的键** ⇒ 原缺陷（写向屏幕不存在的陈旧键）**不可达** ✅
- 答放弃 / 干净态：选中键**确实变为 `next`**，标签/键头/detail 齐步，新键上保存写向新键 ✅

### 6. 裁定独立验证 ✅（裁定成立）

对 `KeyWorkbenchDialogs.tsx` 全部 4 个 `onSelectKey` 调用点逐一核对：创建(`:106`) / TTL·PERSIST(`:159`,`:178`) /
重命名(`:211`) 均由 `handleSelectKey` 完成选中键更新；删除键走**保留的** `onClearSelectedKey`(`:228`)；
批量集合走**保留的** `onUpdateSelectedKeys`(`:198`,`:230`)。头部行改名（`KeyEditors:119-128` → `onRenamed` →
`RedisWorkbench:724`）本就不经该 prop。守卫语义佐证：`draftGuard.ts:56-65` 干净态立即 `resolve(true)`、
脏态**在动作前**悬起询问。
⇒ **删除 `onUpdateSelectedKey` 后无任何合法路径丢失选中键更新；该调用在答 keep 时确实会重造偏差⑥（已由变异 (ii) 实测转红佐证）⇒ 协调者裁定「采纳、不回退」成立。**

### 7. 回归四门 · 覆盖率 · 纪律（提交态串行）✅

- **G1** `60 files / 564 passed / 0 skipped` ✅
- **G2** `npx tsc --noEmit` ⇒ exit 0 ✅
- **G3** `npx vite build` ⇒ `✓ built in 4.83s` exit 0 ✅
- **G4** boundaries ⇒ `1474 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s)` exit 0 ✅
- **覆盖率**（v8 `--coverage.all=false`）：方法经 round-3 态**逐位复现**（A 88.88/91.22、B 92.43/95.43）自证可信；
  **like-for-like 旧口径 B 本轮 92.43/95.43 ⇒ 与 round-3 逐位相同，零回归**；本轮全量口径（纳入首次进入 diff 的
  `KeyWorkbenchDialogs.tsx`）B 85.95/89.03、A 84.34/86.93 ⇒ **均 ≥80% 硬线**。
- **断言纪律**：新增断言零英文文案字面量、零几何反查、无 vacuous 断言；两文件 `skip/only/todo` **零残留** ✅

### 8. 终判

**`已修复`（round-4 复测通过）。** 不一致态已从源头消除，写错键路径不可达，不变式三键齐步实测成立，
无回归、无新增 bug，四门禁全绿。
