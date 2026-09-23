# redis-detail-ui-BUG-007 · 右键重命名选中键 + 草稿 +「继续编辑」留下 selectedKey/keyDetail 不一致，随后同键重点击静默毁草稿

- **登记**：第 2 轮复测 Tester（round-2，全新实例），2026-09-23
- **状态**：`已修复（round-3 复测通过）`
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

### 修复记录（coder round-2）

- **commit**：`4cc510998`（状态→修复中）· `9714509b1`（修复 + P1b 取消 skip）。
- **修法选型：Tester 建议 (b) 的等价手段**，落点在 `handleSelectKey` 顶部而非 `handleSelectKeyGuarded` 同键分支 —— 一处收口覆盖全部同键入口（树行 guarded handle / 头行 `reloadDetail` / 对话框回读）：
  - 实现：`if (key === selectedKey && keyDetail?.key !== key) { if (!(await requestDraftLeave())) return; }`
  - 答「继续编辑」⇒ 原样返回：状态不变、编辑器不卸载、草稿三件套原封（P1b 验收臂「弹 I-1 再问一次」）；不一致仍在但**有界** —— 每次同键点击重新询问，永不静默。
  - 答「放弃」/ 干净态 ⇒ 放行破坏性重取（知情同意），且取回的 detail 携带新名 ⇒ `keyDetail.key===selectedKey`，不一致**当场愈合**（验收句「消解或有界」两头都占）。
- **为何不选 (a)（Tester 首选项被验收断言否决）**：P1a 钉死 `redis-header-key-name='user:1'`（detail 不跟名）与 `data-selected-key='user:renamed'`（选择=新名），(a) 两写法（同步 `keyDetail.key` / keep 回滚 selection）任一都会当场翻红 P1a；且 detail.key 变化即 `key={detail.key}` 重挂载 ⇒ 编辑器卸载清理按契约**立刻**毁草稿（守卫来不及问）——(a) 等于把「重取时毁草稿」提前为「改名时毁草稿」。与 P1a 对撞核验：(b) 是唯一同时满足 P1a+P1b 的路径。
- **不回归核对（三维自查）**：① 彻底 —— 同键跨不一致三入口全收口；② 无误伤 —— 一致态同键（BUG-001/H2 头行刷新、TTL/PERSIST 回读、保存回读）条件不成立零询问；不同键切键 `key===selectedKey` 为 false ⇒ 新守卫不触发、`handleSelectKeyGuarded:379` 一问即止，一次动作至多一问保持；保存后 `reloadDetail` 草稿已 clean ⇒ 守卫无弹层直通，post-write 语义不变；③ 下一步顺畅 —— keep 后继续编辑原草稿，放弃/保存后首次同键点击即重取并愈合。
- **验收**：P1b（`round2Probe.test.tsx:308`）取消 `describe.skip` ⇒ 4 断言全绿；P1a 保持绿；靶向 5 文件 44/44（round2Probe 4 · dirtyLeaveCoverage 12 · dirtyLeaveJourney 11 · keyHeaderRowJourney 11 · redisWorkbench 6）。断言逐字未改，diff 仅去 `.skip`。
- **备注**：skip 实际在 `round2Probe.test.tsx`（其文件头自述「修复者取消跳过即复验」）；简报写 `dirtyLeaveCoverage` 系笔误 —— 该文件全文无 skip，12/12 原样绿。

## 复测记录（round-3）

- **复测者**：第 3 轮复测 Tester（round-3，全新实例，只测不修），2026-09-23
- **复测基线**：HEAD `104c87085`（修复轮第 2 回合收口；修复 commit `9714509b1`）；四门 + 覆盖率复跑落在探针收口态 `88494c6ad`
- **结论**：**修复成立，翻 `已修复`**。判据（全部独立复跑，非采信自报）如下。

### 1. P1b 是真断言（非降级占位）

`round2Probe.test.tsx:309` 的 `describe` 已从 `describe.skip` 转正，`git diff 47e2240b7..HEAD` 对该文件仅
「去 `.skip` + 改写两条注释」，**断言逐字未改**。P1b 体 = 4 条 `expect.soft`（`input().value==='draft'` /
`data-string-dirty==='true'` / `isDraftDirty()===true` / `data-selected-key==='user:renamed'`）⇒ 非空断言、非 `expect(true)`。
靶向跑：`round2Probe` **4/4 绿**（P1a 保持绿、P2×2 绿）。

### 2. 变异反向验证矩阵（逐项：改 → 跑 → 记红 → `git checkout HEAD --` 还原 → 验 `git status` 净）

| 变异 | 手法 | 结果 | 红在哪条 |
| ---- | ---- | ---- | -------- |
| (i) | 删掉新守卫 3 行（:356-358） | **红** | P1b `1 failed \| 3 passed`：3 条 soft 断言全记 —— `expected 'renamed-value' to be 'draft'`、`'false' to be 'true'`（`data-string-dirty`）、`false to be true`（`isDraftDirty`） |
| (ii) | 守卫条件改恒 `false`（`if (false)`） | **红** | P1b，同上三连红（`1 failed \| 3 passed`） |
| (iii) | 守卫改「答 keep 也放行」（丢返回值 `await requestDraftLeave();`） | **绿（假阴性！）** | P1b **未能发现** —— 见 §3，已由本轮新探针补钉 |
| (iv) | 删 round-1 的 `inPlace` 判定（`:365` 置 `false`） | **红** | `dirtyLeaveCoverage` 2 红：H2「refetches the selected key after a TTL apply…」+ H「a plain refetch of the already-selected key must pass I-1…」（`2 failed \| 21 passed`） |

每项跑完均 `git checkout HEAD -- <file>` 还原，`git status --porcelain` 为空、`md5` 与 `git show HEAD:<file>` 逐字一致。

### 3. 变异 (iii) 暴露的断言盲区（本轮补钉，非退回理由）

P1b 的验收句是**析取**「弹守卫再问一次 **或** 原位重取」—— 草稿只要还活着就绿。变异 (iii) 下：
守卫**弹了**（`await requestDraftLeave()` 照常挂出对话框）但**没人回答**（悬起），析取前半支恒真
⇒ 草稿三断言全绿，**「回答被忽略」这一破坏性回归不可见**。

本轮新增 `ui/__tests__/testerRound3Probe.test.tsx`（A/B/C 三组，**恒绿收口**）补齐：
- **A 有界性 + 知情同意**：不一致态同键重点击 ⇒ 必须**重新询问**，且**问的过程中 `invokeGetKey` 计数不得增加**
  （证明"先问后取"而非"取了再问"）；答 keep ⇒ 原样返回（不重取、草稿三件套完好、`data-selected-key` 不变）；
  **再点又问（第三次亦然）** —— 有界、永不静默。**实测证据**：三次点击各弹一次守卫、答 keep 后
  `getKey` 调用数恒定不变。
- **B 放行分支**：仅答「放弃更改」才真正重取 ⇒ `invokeGetKey(sess,'user:renamed')` 被调用、草稿按知情同意清空
  （`input().value==='renamed-value'`、dirty 落 false）、**不一致愈合**（`redis-header-key-name` 与
  `data-selected-key` 同为 `user:renamed`）。
- **C 无误伤**：**一致态**脏草稿同键重点击 ⇒ **零询问**（`leaveDialog()` 为 null、`isLeavePending()` false、草稿完好）。

探针为补盲而非翻案：BUG-007 的两条验收臂在 (i)(ii)(iv) 下均有真红，修复本体有独立测钉。

### 4. 覆盖率与执行计数（新守卫确有测试执行）

v8 `--coverage.all=false` 口径 B 复算 = **92.43% stmts / 95.43% lines**（bran 85.36 · funcs 90.29），
与 round-2 值**逐位相同**（无下降，≥80% 硬线余量充足）。新守卫逐行执行计数（`coverage-final.json`）：

```text
{"id":"147","start":356,"end":358,"count":52}   ← 守卫 if 整块命中 52 次
{"id":"148","start":357,"end":357,"count":5}    ← !(await requestDraftLeave())
{"id":"149","start":357,"end":357,"count":4}    ← return（答 keep 的早退路径命中 4 次）
branch 23 if loc 356 counts [5,47]              ← 两侧分支都走过（进入 5 / 不进入 47）
branch 25 if loc 357 counts [4,1]               ← 早退 4 / 落空 1，answer 两向均覆盖
```

### 5. 判据边界（为何 BUG-007 可翻「已修复」而另立 BUG-008）

本轮已在**同一残留不一致态**上追出**独立的新后果**：该态下点「保存」会写向陈旧的 `detail.key`（旧名）
—— 静默写错目标键 + 复活已 RENAME 掉的键（实测 `SET sess-r3 0 "user:1" "draft"`，而树标签是 `user:renamed`）。
该缺陷**不属** BUG-007 的验收面（BUG-007 断的是「同键重点击不得静默毁草稿」，已成立），故单列
**`BUG-008`（高）** 并顺延编号，不回退本条。两条同根（偏差⑥ 残留态），修法建议见 BUG-008。
