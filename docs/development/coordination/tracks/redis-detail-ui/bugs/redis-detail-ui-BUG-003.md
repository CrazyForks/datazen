# redis-detail-ui-BUG-003 · 保存失败静默：`invokeSetString` 无 `.catch` ⇒ 零反馈 + 未处理的 Promise rejection

- **严重度**：中（E-5 新写的保存主链路自身的错误处理缺口；用户点「保存」后**界面看起来完全没反应**——底栏仍在、按钮闪一下又亮、草稿还在，但既不知道失败也不知道原因；写路径失败被吞掉是本轨要消灭的类别，且会污染测试/运行的错误上报）
- **状态**：`待复测（round-1 修复后）`
- **发现**：W3-E 第 1 轮 Tester 复验（HEAD `3919307ce`，探针实测）
- **涉及文件**：`packages/drivers/redis/ui/value-editors/StringEditor.tsx:152-164`（`await invokeSetString(...).then(...).finally(() => setSaving(false))` —— **无 `.catch`**）
- **对照**：同文件 `runDecompress` 有 `.catch` 并渲染 `decompError`（`:180-183`）；`KeyEditors.tsx:97-104` 的 `run()` 有 `catch` 并 `setError(...)`。⇒ 同一轨道内其它写路径都处理了失败，唯独新常驻编辑面的保存没有。

## 描述（含量级）

`save()` 里唯一的 `.then` 成功分支负责清 dirty、`settleDraftLeave(true)`、`onSaved()`。当后端拒绝（只读副本 / `WRONGTYPE` / 连接断开 / ACL）时：
1. `.then` 不执行 ⇒ 脏位仍 `true`（**这条是对的**：草稿确实没落库，理应保留）；
2. 但 `finally` 只把 `saving` 落回 `false` ⇒ 按钮重新可点，**没有任何错误文案**，`jsonError` / `KeyEditors.error` 都不会被写；
3. Promise 以 rejection 结束而无人 catch ⇒ 测试运行时观测到 **1 次 unhandledRejection**（生产里表现为控制台/日志噪声，且宿主的全局错误上报拿不到上下文）。

用户的可见结果：点保存 ⇒ 转圈 ⇒ 停止 ⇒ 什么都没发生。与 PRD §3.3「保存语义走 `SET ... KEEPTTL`，服务端拒绝时回退 `PTTL` + `PX`」的失败处理要求相比，前端连"拒绝"这件事都没露出来。

## 重现步骤（本机 jsdom，无需真连）

```bash
# 探针（本轮实测用，未提交）：set_string 返回 reject 后检查 DOM/守卫/未处理 rejection 计数
npx vitest run --config vitest.drivers.config.ts <probe>
# 手工：任意 Redis 连接 → 选 string 键 → 改一个字符 → 让后端在该写命令上失败
#       （例：连一个 replica-only 会话，或保存瞬间断链）
```

## 实测日志

```text
PROBE dirty= true bar= true errEl= false guardDirty= true unhandled= 1
```

字段含义：`dirty`＝编辑面脏位、`bar`＝脏底栏是否仍在、`errEl`＝**是否存在任何错误提示节点（false）**、`guardDirty`＝`draftGuard` 真值、`unhandled`＝**未处理 rejection 次数（1）**。

⇒ 失败后草稿保留（正确），但**零错误反馈 + 一次未处理 rejection**（缺陷）。

## 建议修法（供原 Coder 判断，Tester 不代修）

`save()` 的链上补 `.catch`：`setJsonError(...)` 或复用 `KeyEditors` 的 `setError` 通道，并把失败信息以 i18n key 断言的形态渲染（新例可钉 `data-testid="redis-string-save-error"`，禁英文字面量）。同时**必须保留**脏位 `true`（现状已对，别顺手清 dirty —— 清了就是第三个 I-1 静默丢草稿）。

修完后请补一条用例：保存 reject ⇒ 弹错误节点 + `data-string-dirty` 仍 `true` + 守卫 `isDraftDirty()` 仍 `true` + **无** unhandledRejection。

## 影响范围

不影响门禁与覆盖率复验数字；影响 dirty 主链路的可诊断性。属"错误处理路径未覆盖"，与本轮未覆盖缺口点名（`StringEditor` 70.65% stmts，解压失败支路同形）同源。

## 修复记录（round-1）

- **commit**：`449dba5fd`（`fix(redis-detail-ui): BUG-003 保存失败可见反馈（.catch + redis.detail.saveFailed）并补验收用例`）。
- **修法**：`StringEditor.save()` 链上补 `.catch`（位于 `.then` 成功分支之后、`.finally` 之前）⇒ 新增 `saveError` 状态与错误节点 `data-testid="redis-string-save-error"`（`role="alert"` + `data-i18n-key="redis.detail.saveFailed"`，新 key 只追加在 `en.ts` 的 `redis.detail.*` 命名空间）。`setSaveError(null)` 挂在三处清旧错：再次保存、键入新字符、放弃草稿。失败时 `.then` 不执行 ⇒ 脏位 / 草稿 / `draftGuard` 脏位**原样保留**（未动 dirty，不引入第三条 I-1 静默路径）；rejection 被 `.catch` 消费 ⇒ 无 unhandled rejection。
- **复验**：`stringEditorTesterGaps.test.tsx` 新增 `[redis-detail-ui-BUG-003] 保存被后端拒绝的可见反馈` 用例——reject ⇒ 错误节点可见、`data-i18n-key` 断 key（identity `t`，无英文字面量）、`data-string-dirty='true'`、`isDraftDirty()=true`、保存按钮可再点；链路恢复后再次保存 ⇒ 错误消失、脏位落 `false`（退出跃迁不卡死）。整文件 **4/4 绿**（无 unhandled rejection：有则 vitest 整跑失败）。
