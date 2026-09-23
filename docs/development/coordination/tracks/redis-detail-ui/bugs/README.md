# W3-E `redis-detail-ui` · Bug 清单（第 1 轮 Tester 复验 · 一 Bug 一文件）

> 登记人：第 1 轮 Tester（全新实例）。基线 HEAD `3919307ce`；复验过程与证据见 `../progress.md`「第 1 轮 Tester 复验记录」。
> **只测不修**：本轮生产码零改动（探针期的临时改动全部 `git checkout HEAD --` 还原，逐次核对 `git status` 干净）。
> 状态口径：`待修复` → `修复中`（原 Coder resume）→ `待复测`（Coder 提交）→ `已修复`（全新 Tester 复测）。
> 上报口径：本轮**完成后**一并上报（`tester.md` §3），未逐个中断测试流程；但每条 Bug **证实即单独 commit**（本目录一文件一 commit 链）。

## 汇总

| Bug ID | 严重度 | 类别 | 一句话 | 状态 |
| ------ | ------ | ---- | ------ | ---- |
| `redis-detail-ui-BUG-001` | **高** | I-1 数据丢失 | 树内重点击**已选中的键** ⇒ 不弹守卫、编辑面随 `detailLoading` 卸载 ⇒ 草稿静默蒸发（与头行刷新的已测行为相反） | 待修复 |
| `BUG-002` | 中 | I-1 数据丢失 | `KeyWorkbenchDialogs` 的 `onSelectKey` 仍是未守卫的 `handleSelectKey` ⇒ 创建键 / 右键 TTL / 右键 PERSIST / 右键重命名四条出口静默丢草稿 | 待修复 |
| `BUG-003` | 中 | 错误处理 | `StringEditor.save()` 无 `.catch` ⇒ 后端拒绝时**零反馈** + 一次未处理 Promise rejection | 待修复 |
| `BUG-004` | 中 | 状态机/键盘 | TTL pill 内联编辑缺 **Esc / 失焦** 两条退出跃迁（简报 E-4 点名项；同轨键头行改名已实现，行为不一致） | 待修复 |
| `BUG-005` | 低 | 台账如实性 | 自报口径 B 不可复现（86.25%→复算 85.57%）；`keyEditorsInvokes:306-321` 缺口归属写错（实为本轨新建的 `invokeDeleteKey`/`invokeRename`，非"存量集合辅助"）⇒ 被误记为非缺口 | 待修复（改台账；测试已补） |
| `BUG-006` | 低 | 文案真实性 | 大 value 原因条在「超哨兵但载荷完整」分支说"载荷不完整/截断写覆盖"，与同屏 `truncated` 徽标缺席自相矛盾（64 KiB~5 MiB 为常态区间） | 待修复 |

## 判定影响

- **门禁四件套本身全绿**（Tester 独立重跑：58 files / 545 passed / 3 skipped、tsc 0、vite build 0、boundaries 0 blocking / 4 advisory）。
- 本轮整体判定 **`TEST_FAILED`**：BUG-001 / 002 属 PRD §4 I-1 的同一失败类别（用户草稿无痕消失），且 BUG-001 恰是简报 §1-5 点名"必须一并消掉"的静默清 dirty 的残留路径 ⇒ 交付项未完整达成。
- 三条 skip 用例（BUG-001 ×1、BUG-002 ×2）留在 `packages/drivers/redis/ui/__tests__/dirtyLeaveCoverage.test.tsx` 末尾，**修复者取消 skip 即复验**——本轮不把已知错误行为钉成断言。
