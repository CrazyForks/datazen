# redis-detail-ui-BUG-001 · 树内重点击「已选中的键」会静默销毁未保存草稿（无 I-1 弹层）

- **严重度**：高（I-1 的同一失败类别——"用户草稿无痕消失"——在本轨宣称已消灭后，仍以另一条路径存在；且触发姿势是树内最普通的点击）
- **状态**：`待修复`
- **发现**：W3-E 第 1 轮 Tester 复验（全新实例，HEAD `3919307ce` → 补测 commit `da4bc9531`）
- **涉及文件**：
  - `packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx:364-374`（`handleSelectKeyGuarded` 的同键旁路：`key === selectedKey` ⇒ 直接 `handleSelectKey(key)`，**不经过** `requestDraftLeave`）
  - `packages/drivers/redis/ui/key-browser/DetailColumn.tsx:67,90-98`（`detailLoading` 时编辑面整体卸载）
  - `packages/drivers/redis/ui/value-editors/StringEditor.tsx:100-108`（卸载 cleanup ⇒ `onDirtyChange(false)` + `publishDraftDirty(false)`）

## 描述（含量级）

简报 E-5 的验收是「**切键 / 切页签 / 切 db / 刷新 / 搜索一律先弹**放弃更改 / 继续编辑」，并且点名要消掉「静默清 dirty」。头行刷新按钮（`redis-header-refresh`）确实走守卫；但树内**重点击当前已选中的键**被实现为「无条件重取 detail」，而重取必经 `detailLoading` 一帧——编辑面按 `key={detail.key}` 整块卸载再重挂，卸载 cleanup 把 dirty 发布为 `false`。结果：**不弹任何对话框，草稿内容蒸发，textarea 回到服务器真值**。

同一语义的两种入口行为相反（这是判定缺陷的核心）：
- 点头行刷新（`KeyEditors.tsx:113-117 refreshNow`）⇒ `await requestDraftLeave()` ⇒ 先弹（`dirtyLeaveJourney.test.tsx:323` 用例守住）；
- 点树里那行已经亮着的键 ⇒ `RedisWorkbench.tsx:366` 早退 ⇒ 静默重取 ⇒ 草稿没了。

对用户而言二者都是「刷新当前键」。草稿丢失不可恢复（无撤销、无剪贴板回退），且全程零提示。

## 重现步骤（jsdom / 本机可复现，无需真连）

1. `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/dirtyLeaveCoverage.test.tsx`（本文件登记的 skip 用例）
2. 或手工：打开 Redis 连接 → 选 `user:1` → 在编辑区改一个字符（底栏出现 = dirty）→ **再点一次树里的 `user:1` 行**。

## 实测日志（探针逐帧，`[tag] editor脏位 | detail状态 | guardDirty | 悬起 | 弹层 | textarea值`）

```text
[before]               dirty=true  state=ready   guardDirty=true  pending=false dialog=false value=DRAFT
[sync-after-click]     dirty=undef state=loading guardDirty=false pending=false dialog=false value=undef
[after-microtasks]     dirty=false state=ready   guardDirty=false pending=false dialog=false value=hello
```

⇒ 点击后第一帧编辑面被 `loading` 态卸载（`dirty=undef`），cleanup 把守卫脏位清成 `false`；重挂后 textarea 是服务器值 `hello`，`draft` 永久丢失，`dialog=false`。

变异自证：该支路在补测前**撤掉早退也不会有任何测试变红**（M10 全绿 ⇒ 当时零覆盖）；修复前的现状已被 `dirtyLeaveCoverage.test.tsx` 探针钉死，正确期望以 `describe.skip('[redis-detail-ui-BUG-001] …')` 留在同一文件末尾，**修复后取消 skip 即复验**。

## 建议修法（供原 Coder 判断，Tester 不代修）

任一即可，倾向 (a)：
- (a) 同键重点击改为与头行刷新同语义：`handleSelectKeyGuarded` 里同键也 `if (!(await requestDraftLeave())) return;`（守卫干净时零开销）；
- (b) 让 `detailLoading` 不卸载已有编辑面（`DetailColumn` 在「已有一把已渲染的键 + refetch 同一把」时保留旧 detail，仅打 `data-detail-state="refreshing"`），从根上让「刷新当前键」不触碰草稿。

## 影响范围

不阻断其余门禁（三口径复验全绿）；影响 dirty 主链路的用户可信度：PRD §3.3 底栏 / §4 I-1 / 简报 §1-5「静默清 dirty 必须消掉」。与 BUG-002 同根（未守卫的选中键变更出口），建议同一轮修。
