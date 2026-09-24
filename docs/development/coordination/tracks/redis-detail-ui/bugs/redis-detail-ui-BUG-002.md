# redis-detail-ui-BUG-002 · 对话框出口的 `onSelectKey` 未接守卫 ⇒ 创建键 / 右键 TTL / 重命名后静默丢草稿

- **严重度**：中（同 BUG-001 的 I-1 旁路类别；触发面比 BUG-001 窄——要求「已有一把选中键 + 恰好一个未保存草稿」，且动作本身是服务端写操作而非纯导航，部分用户会预期草稿被换掉。但**结果同样是零提示的草稿蒸发**，与简报 E-5「消掉静默清 dirty」直接冲突）
- **状态**：`已修复（round-2 复测通过）`
- **发现**：W3-E 第 1 轮 Tester 复验（补测 commit `da4bc9531`）
- **涉及文件**：
  - `packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx:735`（`onSelectKey={handleSelectKey}` —— 传给 `KeyWorkbenchDialogs` 的是**未守卫**的原始回调；对比 `:657` 树列已换成 `handleSelectKeyGuarded`）
  - `packages/drivers/redis/ui/key-browser/KeyWorkbenchDialogs.tsx:107-108`（创建键：`onRefreshKeys(); await onSelectKey(name);`）· `:159-161`（右键 TTL：`onRefreshKeys(); if (selectedKey === key) await onSelectKey(key)`）· `:178-180`（PERSIST 同形）· `:209-210`（右键重命名同形）
  - `packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx:294-302`（`refreshKeys` 的守卫只管自己，管不到紧随其后的 `onSelectKey`）

## 描述（含量级）

E-5 给 `refreshKeys` 加了守卫，但**没有覆盖紧随其后的第二次选中键变更**。`KeyWorkbenchDialogs` 拿到的 `onSelectKey` 是裸的 `handleSelectKey`：它先 `setSelectedKey(key)` 再 `setKeyDetailLoading(true)` ⇒ 编辑面卸载 ⇒ dirty 被 cleanup 发布为 `false`。守卫即便在 `refreshKeys` 里弹出，用户点「继续编辑」也**只挡住了刷新那一步**，挡不住后面那次无条件重挂。

四条出口同一形状（`onRefreshKeys(); await onSelectKey(...)`）：

| 出口 | 位置 | 实测后果 |
| ---- | ---- | -------- |
| 创建键（string） | `KeyWorkbenchDialogs.tsx:107-108` | `set_string` 出网一次后**不弹守卫**，选中直接跳新键，旧草稿静默消失 |
| 右键 TTL | `:159-161` | `set_ttl` 出网后不弹守卫，选中键被重挂，草稿值回服务器真值 |
| 右键 PERSIST | `:178-180` | 同上 |
| 右键重命名 | `:209-210` | 同上（`onUpdateSelectedKey(next)` 之后又 `onSelectKey(next)`） |

对照：`onClearSelectedKey`（`:736-742`）**有**守卫，且实测生效——Tester 的 G 组用例（对话框删选中键）能正确弹层并 honor 两种回答。所以这不是"对话框侧一律没守卫"，而是**恰好漏了会改选中键的那四个 `onSelectKey` 调用点**。

## 重现步骤（本机 jsdom，无需真连）

```bash
npx vitest run --config vitest.drivers.config.ts \
  packages/drivers/redis/ui/__tests__/dirtyLeaveCoverage.test.tsx
```

其中两条**探针**用例（记录现状，非期望）已在本轮以 `describe.skip` 形式保留正确期望：
- `[redis-detail-ui-BUG-002] 创建键后的跳转不得静默丢草稿`（F 组）
- `[redis-detail-ui-BUG-002] 右键 TTL 作用于选中键后不得静默丢草稿`（H2 组）

手工复现（右键 TTL 那条最直观）：选 `user:1` → 编辑区改一个字符 → 树内右键该行 → `Set TTL` → 填 `120` → 确认。TTL 改了，**草稿同时没了，且没弹任何放弃/继续询问**。

## 实测日志

F 组（创建键）探针，`commands` 序列 + 守卫真值：

```text
[DBG F] commands= modules_list,set_string  draftDirty=false  pending=false  sel=new:key  dialog=false
```

⇒ `set_string` 出网（创建）后守卫 `dirty` 已是 `false`（`pending=false`、无对话框）、选中键变成 `new:key`：旧草稿被静默替换。

H2 组（右键 TTL）：`set_ttl` 出网 ⇒ 无 `redis-draft-discard` ⇒ 选中键重取 ⇒ 编辑面回到服务器真值、脏位 `false`。

## 建议修法（供原 Coder 判断，Tester 不代修）

最小面：`RedisWorkbench.tsx:735` 改 `onSelectKey={handleSelectKeyGuarded}`。但注意 `handleSelectKeyGuarded` 的**同键早退**（`:366`）正是 BUG-001，两处一起修才闭环 —— 否则会退化成「换键问、同键不问」的又一种不对称。
建议同时把「一次用户动作内已答过守卫 ⇒ 本次动作后续出口不再二次询问」做成 `draftGuard` 的一次性票据（否则 TTL/重命名路径修好后可能出现弹两次）。

## 影响范围

与 BUG-001 同根，建议同一轮修。不阻断门禁；PRD §4 I-1 的旁路之一。

## 修复记录（round-1）

- **commit**：`a82dce41d`（与 BUG-001 同轮同 commit，见 `redis-detail-ui-BUG-001.md` 修复记录）。
- **修法（三处，全部在 `RedisWorkbench.tsx`，`KeyWorkbenchDialogs.tsx` 零改动）**：
  1. `onSelectKey` 改接 `handleSelectKeyGuarded`（原 `:735`）：创建 / 右键重命名的**换键**出口先问后跳（F 组期望）；右键 TTL / PERSIST 的**同键**重取落进 BUG-001 的非毁式支路 ⇒ 零弹窗、草稿原样（H2 组期望）。
  2. 新增 `refreshKeysForDialogs` 接管对话框侧 `onRefreshKeys`（原 `:734`）：**脏时**仅 `scanRefresh() + tree.refresh()` 重扫列表——不动选中、不动详情、不动脏位、不再进守卫；**干净时**走原 `refreshKeys`（今日行为不变）。毁草稿的那半（清选中）收敛到各自已守卫的 `onSelectKey` / `onClearSelectedKey` 出口。BatchBar / 工具栏 / 句柄的 `refreshKeys` 保持原守卫语义（C/D/kvSlotRelay 既有期望不动）。
  3. **双弹排除**：简报建议的 `draftGuard` 一次性票据按现场判断**未加码**——本设计下每条对话框动作的守卫询问 ≤ 1 次（创建/重命名→`onSelectKey` 一次；删除→`onClearSelectedKey` 一次；TTL/PERSIST→零次），`draftGuard` 既有的同 tick pending 合并（`draftGuard.ts:58`）作兜底。新增自测 `[fix-selftest] 对话框出口一次动作只询问一次守卫`（创建 + 对话框删除两条）：首次询问点「继续编辑」后长 `flush(60)` 断言**无二次弹窗、无悬起 pending、草稿与选中原样**。
- **复验**：原 skip 用例 F 组 `[redis-detail-ui-BUG-002] 创建键后的跳转不得静默丢草稿` 与 H2 组 `[redis-detail-ui-BUG-002] 右键 TTL 作用于选中键后不得静默丢草稿` 转绿；`dirtyLeaveCoverage.test.tsx` **12/12 绿**。

## 复测记录（round-2）
- **裁定**：已修复 ✅（round-2 Tester · 全新实例 · 只测不修 · 2026-09-23）。
- **正测**（四出口逐条）：创建键 F 绿（守卫弹问 + 继续编辑同链不二弹）；右键删除 `[fix-selftest]` 双问/单问用例绿；右键 TTL/PERSIST H2 零询问且草稿三断言绿；右键改名 P1a ≤1 询问（其残留旁路属 BUG-007，另案）。
- **变异钉**：M-B 把对话框 `onSelectKey`（`RedisWorkbench.tsx:762`）撤回裸 `handleSelectKey` ⇒ **F + `[fix-selftest]` 创建 exactly-once 红**（`2 failed | 10 passed`）。诚实记录：M-B 下 **H2 未红**（其同键路径被 inPlace 吸收、非破坏），H2 由 M-A（inPlace 恒 false ⇒ H2 红）与 M-G（撤掉 `refreshKeysForDialogs` 静默包装 ⇒ H2 红，`1 failed | 11 passed`）分别钉住。
- **合并兜底**：M-G 下 create 链由 `draftGuard` 合并兜底保持绿（预期行为，非漏钉）——逐出口走查「一次动作 ≤1 问」成立，双问占位探针（keep/discard 各一答）绿。
