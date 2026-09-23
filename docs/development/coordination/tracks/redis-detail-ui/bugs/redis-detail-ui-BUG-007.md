# redis-detail-ui-BUG-007 · 右键重命名选中键 + 草稿 +「继续编辑」留下 selectedKey/keyDetail 不一致，随后同键重点击静默毁草稿

- **登记**：第 2 轮复测 Tester（round-2，全新实例），2026-09-23
- **状态**：修复中
- **严重度**：高（I-1 / BUG-001 的核心不变式「同键重取不得无询问毁草稿」在可达状态下被静默击穿；用户输入直接蒸发）
- **来源**：偏差⑥ 独立裁定探针（`ui/__tests__/round2Probe.test.tsx`）。按简报「标签/detail 短暂不一致但草稿完好 vs 草稿丢失 —— 只有后者立案」：组合刚结束时草稿完好（探针 P1a 绿），但不一致**不是短暂态** —— 它一旦形成，下一次对该选中键的树行点击即静默销毁草稿 ⇒ 判后者，立案。

## 复现步骤（jsdom 探针 P1b，`dirtyLeaveCoverage` 同款 harness）

1. 选中 `user:1`（string），把值改成 `draft` ⇒ `isDraftDirty()=true`。
2. 右键 `user:1` → 「重命名」→ 填 `user:renamed` → 确认。
   - RENAME 先出网（`invokeRename`），**之后**守卫才弹（`onUpdateSelectedKey(next)` 在守卫之前已改掉选中）。
3. 守卫弹层答「继续编辑」（`redis-draft-keep`）。
   - 实际结果（探针 P1a，绿）：**≤1 次询问**、标签 `data-selected-key='user:renamed'`（新名），
     编辑器头 `redis-header-key-name='user:1'`（旧键，`keyDetail.key` 未跟），
     草稿三件套（input 值 / `data-string-dirty` / `isDraftDirty()`）完好，`data-detail-state='ready'`。
   - 至此即偏差⑥ 所述不一致；**没有任何机制修复它**，直到一次破坏性重取。
4. 静默重扫已把新名行放进树（脏时 `refreshKeysForDialogs` 走 silent rescan）。
   点击 `redis-key-row-user:renamed`（= 点当前选中键，同键重点击）。

## 期望 vs 实际

| | 期望 | 实际（round-2 探针 P1b，HEAD `b555270fb`） |
| -- | ---- | ---- |
| 守卫 | 弹 I-1 再问一次，**或**原位非毁式重取 | **两者都没有**：`leaveDialog()` 自始至终为 null，零询问 |
| 草稿 | `input().value === 'draft'` | **`'renamed-value'`（服务端值，编辑器已重挂）** |
| 编辑器脏标 | `data-string-dirty='true'` | `'false'` |
| 全局脏标 | `isDraftDirty()===true` | `false`（StringEditor 卸载时按契约发布了 false） |

探针失败尾（三连红，soft 断言全记）：

```text
FAIL round2Probe.test.tsx > … 不一致态下的同键重点击不得静默毁草稿
  AssertionError: expected 'renamed-value' to be 'draft'
  AssertionError: expected 'false' to be 'true'   (data-string-dirty)
  AssertionError: expected false to be true       (isDraftDirty)
Tests  1 failed | 15 passed (16)   ← P1a/P2×2 与 dirtyLeaveCoverage 12/12 均绿
```

## 根因（代码路径，逐行）

1. `KeyWorkbenchDialogs.tsx:189-216` `handleKeyCtxRename`：`await invokeRename(...)` 成功后
   **先** `onUpdateSelectedKey(next)`（:199-201，无守卫、答 keep 也**不回滚**）、
   `onRefreshKeys()`（脏 ⇒ silent，:209）、**后** `await onSelectKey(next)`（:210）。
   ⇒ 守卫答「继续编辑」后：`selectedKey='user:renamed'` 而 `keyDetail.key` 仍 `'user:1'`。
2. `RedisWorkbench.tsx:373-383` `handleSelectKeyGuarded` 同键分支（:375-378）
   `if (key === selectedKey)` ⇒ **直接走裸 `handleSelectKey`，按设计不问**。
   （此刻闭包里的 `selectedKey` 已是新名，被 :379 的守卫判成「同键」而绕过。）
3. `RedisWorkbench.tsx:347` `const inPlace = key === selectedKey && keyDetail?.key === key;`
   —— 因 `keyDetail.key` 还是旧名 ⇒ `inPlace=false` ⇒ :349 `setKeyDetailLoading(true)` 置 loading，
   `DetailColumn` 的 loading 分支整块替换编辑器 ⇒ 编辑器**卸载** ⇒ 草稿按契约蒸发。
   :356/:358 的 inPlace 保护同样失效（catch 里还会 `setKeyDetail(null)`）。

即：**BUG-001 的修复（inPlace 原位重取）只在 `selectedKey` 与 `keyDetail.key` 一致时成立；偏差⑥ 的执行序恰好制造了不一致，两条修复互相打穿。**

## 建议修法（Tester 只测不修，供参考）

任选其一（或等价手段），并补上对应钉子用例（round2Probe P1b 取消 `describe.skip` 即为验收断言）：

- **(a) 保持一致（首选）**：`handleKeyCtxRename` 里与 `onUpdateSelectedKey(next)` 同步
  `setKeyDetail(prev => (prev ? { ...prev, key: next } : prev))`（值/ttl 不变，仅 key 字段跟名）；
  或把 `onUpdateSelectedKey` 挪到守卫**之后**并在答 keep 时回滚。
- **(b) 守卫兜底**：`handleSelectKeyGuarded` 同键分支在 `keyDetail?.key !== key`（状态不一致）时
  改走 `requestDraftLeave()`，不静默走裸函数。
- 无论哪种，验收必须同时成立：P1a（≤1 询问 + 不一致消解或有界）与 P1b（草稿三断言全绿）。

## 影响范围

- 只读路径：右键重命名**选中键** + 脏草稿 + 答「继续编辑」后再次点击该行（重扫后必然出现）。
- 不影响：头行改名（守卫在 RENAME 前，`dirtyLeave` 用例钉住）、非选中键的右键改名（不触 `onUpdateSelectedKey`）、干净态。
- 与 BUG-001/002 的关系：那两条在**一致态**下的修复本身有效（round-2 变异 M-A/M-B 均红），本条是偏差⑥ 打出的残留旁路。
