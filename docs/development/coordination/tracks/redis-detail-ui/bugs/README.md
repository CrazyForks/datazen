# W3-E `redis-detail-ui` · Bug 清单（第 1 轮 Tester 复验 · 一 Bug 一文件）

> 登记人：第 1 轮 Tester（全新实例）。基线 HEAD `3919307ce`；复验过程与证据见 `../progress.md`「第 1 轮 Tester 复验记录」。
> **只测不修**：本轮生产码零改动（探针期的临时改动全部 `git checkout HEAD --` 还原，逐次核对 `git status` 干净）。
> 状态口径：`待修复` → `修复中`（原 Coder resume）→ `待复测`（Coder 提交）→ `已修复`（全新 Tester 复测）。
> 上报口径：本轮**完成后**一并上报（`tester.md` §3），未逐个中断测试流程；但每条 Bug **证实即单独 commit**（本目录一文件一 commit 链）。

## 汇总

| Bug ID | 严重度 | 类别 | 一句话 | 状态 |
| ------ | ------ | ---- | ------ | ---- |
| `redis-detail-ui-BUG-001` | **高** | I-1 数据丢失 | 树内重点击**已选中的键** ⇒ 不弹守卫、编辑面随 `detailLoading` 卸载 ⇒ 草稿静默蒸发（与头行刷新的已测行为相反） | 已修复 |
| `BUG-002` | 中 | I-1 数据丢失 | `KeyWorkbenchDialogs` 的 `onSelectKey` 仍是未守卫的 `handleSelectKey` ⇒ 创建键 / 右键 TTL / 右键 PERSIST / 右键重命名四条出口静默丢草稿 | 已修复 |
| `BUG-003` | 中 | 错误处理 | `StringEditor.save()` 无 `.catch` ⇒ 后端拒绝时**零反馈** + 一次未处理 Promise rejection | 已修复 |
| `BUG-004` | 中 | 状态机/键盘 | TTL pill 内联编辑缺 **Esc / 失焦** 两条退出跃迁（简报 E-4 点名项；同轨键头行改名已实现，行为不一致） | 已修复 |
| `BUG-005` | 低 | 台账如实性 | 自报口径 B 不可复现（86.25%→复算 85.57%）；`keyEditorsInvokes:306-321` 缺口归属写错（实为本轨新建的 `invokeDeleteKey`/`invokeRename`，非"存量集合辅助"）⇒ 被误记为非缺口 | 已修复 |
| `BUG-006` | 低 | 文案真实性 | 大 value 原因条在「超哨兵但载荷完整」分支说"载荷不完整/截断写覆盖"，与同屏 `truncated` 徽标缺席自相矛盾（64 KiB~5 MiB 为常态区间） | 已修复 |
| `BUG-007` | **高** | I-1 数据丢失 | 右键重命名**选中键**+脏草稿答「继续编辑」⇒ `selectedKey='user:renamed'` 而 `keyDetail.key='user:1'`（偏差⑥ 执行序）⇒ 下次点新名行走守卫同键旁路 ⇒ `inPlace=false` ⇒ **未守卫破坏性重取，草稿三断言静默蒸发、零询问** | 已修复（round-3 复测通过） |
| `BUG-008` | **高** | I-1 写错目标键 | 同一偏差⑥ 残留态（BUG-007 已「有界化」但未消解）下点**保存** ⇒ `StringEditor:155` 用陈旧 `detail.key` 出网：实测 `SET db0 user:1 'draft'` 而屏幕显示 `user:renamed` ⇒ **静默写错键 + 复活已 RENAME 掉的旧键 + 草稿可见消失** | 已修复（round-4 复测通过） |
| `BUG-009` | 低 | 源码规模纪律 | BUG-007 修复（净 +18 行）把 `RedisWorkbench.tsx` 787 → **805**，越过本轨 `progress.md` §5 硬钉的 `≤800`（自报「+13 行」，未声明破线） | 已修复（round-4 复测通过） |

## 判定影响

- **门禁四件套本身全绿**（Tester 独立重跑：58 files / 545 passed / 3 skipped、tsc 0、vite build 0、boundaries 0 blocking / 4 advisory）。
- 本轮整体判定 **`TEST_FAILED`**：BUG-001 / 002 属 PRD §4 I-1 的同一失败类别（用户草稿无痕消失），且 BUG-001 恰是简报 §1-5 点名"必须一并消掉"的静默清 dirty 的残留路径 ⇒ 交付项未完整达成。
- 三条 skip 用例（BUG-001 ×1、BUG-002 ×2）留在 `packages/drivers/redis/ui/__tests__/dirtyLeaveCoverage.test.tsx` 末尾，**修复者取消 skip 即复验**——本轮不把已知错误行为钉成断言。

## 判定影响（第 2 轮复测）

- **BUG-001~006 全部翻 `已修复`**：round-2 独立复验——四门禁重跑全绿（58/556/0、tsc 0、build 0、boundaries 1472/0/4）；3 枚 skip 全转正（`dirtyLeaveCoverage` 12/12）；7 项变异矩阵每项皆红且即刻还原（M-A H2+H、M-B F+create、M-C BUG-003+unhandled、M-D Esc、M-E blur、M-F 3 红、M-G H2）；六条偏差裁定 ①②③④⑤ 成立、⑥ 不成立。
- **第 2 轮整体判定仍 `TEST_FAILED`**：偏差⑥ 不成立 ⇒ 新登记 **`BUG-007`（高，I-1 静默毁草稿残留旁路）**，探针 `round2Probe.test.tsx` P1b 三断言红为实证（按第 1 轮先例暂 `describe.skip` 占位，修复者取消跳过即复验）⇒ Bug 循环 2/5。

## 判定影响（第 3 轮复测 · round-3）

- **`BUG-007` 翻 `已修复`**：round-3 独立复验——P1b 已由 `describe.skip` 转正且断言逐字未改（4 条 `expect.soft`，非占位）；
  5 项变异矩阵中 (i)(ii)(iv)(v) 皆红、每项即刻 `git checkout HEAD --` 还原并验 `git status` 净；
  有界性实测 = 三次同键点击各问一次且 `invokeGetKey` 计数恒定（先问后取）、答 keep 原样返回、答放弃才重取并愈合；
  四门禁全绿（G1 `60 files / 563 passed / 1 skipped`、tsc 0、build 0、boundaries `1474/0/4`）；口径 B 覆盖率 **92.43/95.43 与 round-2 逐位相同**；新守卫逐行执行计数在位（if 块 52 次 / 早退 4 次 / 分支两向均覆盖）。
- **第 3 轮整体判定 `TEST_FAILED`（Bug 循环 3/5）**：BUG-007 修复本体成立，但同一残留不一致态上追出**独立新后果**
  ⇒ 新登记 **`BUG-008`（高，静默写错目标键）**；文件面审计另命中本轨 §5 硬钉 `≤800` 行纪律破线
  ⇒ 新登记 **`BUG-009`（低，`RedisWorkbench.tsx` 805 行）**。
- **遗留项 2 裁定（round-2 留给协调者的题）**：**「有界 + 知情同意」不足以单独收口** —— BUG-007 验收句「消解**或**有界」在字面上成立，
  故 BUG-007 照判 `已修复`；但本轮以探针实测证明该残留态仍有独立破坏后果（保存写错键，BUG-008）⇒ 裁定**必须真消解（(a) 路线）**，
  BUG-008 的修法建议已含「先问守卫、后改名」的顺序要求（因 `DetailColumn:97` `key={detail.key}` 重挂载会立刻毁草稿）。
- **skip 处置**：`BUG-008` 的正确期望以 `describe.skip` 留在 `packages/drivers/redis/ui/__tests__/testerRound3Probe.test.tsx` D 组
  （按第 1 轮先例，不把已知错误行为钉成绿断言）——**修复者取消 skip 即复验**。
  `round2Probe.test.tsx` P1b 已无 skip；`dirtyLeaveCoverage.test.tsx` 全文无 skip。

---

## 第 4 轮复测（round-4，Tester `ecf1171f-aaa7-424e-8271-8114bbfa98c4`，HEAD `b7ef8a009`）

- **整体判定 `TEST_DONE`（第 4 轮复测通过，Bug 循环 4/5）** —— 无新登记 bug。
- **`BUG-008`（高）翻 `已修复`**：前提独立确认（`handleSelectKey:357` 为选中键唯一「换到具体键」写入口，
  `onUpdateSelectedKey` prop 已彻底移除）；基线 `8/8 绿 · 0 skipped`；变异矩阵 —— (i) 语义等价故绿（已归因：
  修复前偏差⑥ 唯一机制是被删的 `onUpdateSelectedKey`，`await onSelectKey` 前后移位不改变语义）、
  **(ii) 守卫后加回无条件写入 ⇒ 5 failed/3 passed 红**、**(ii-a) 忠实回退 `3e25a3c0f` 亦红**、
  **(iii) 守卫前直改选中键 亦红** ⇒ 因果面钉住；不变式实测三路径 **保存目标键 === 面板显示键 === 选中键**；
  **裁定「采纳、不回退」独立验证成立**。
- **`BUG-009`（低）翻 `已修复`**：`wc -l` = **795 ≤ 800**；`cbecba255` = `6 15` **纯注释**；
  守卫 3 行代码 md5 逐字节未动（`94a07d6d0aa78eddce048aee04585896`）。
- **四门**：G1 `60 files / 564 passed / 0 skipped` · G2 tsc 0 · G3 `✓ built in 4.83s` 0 ·
  G4 boundaries `1474 / 0 blocking / 4 advisory` 0。
- **覆盖率**：复算方法经 round-3 测量态**逐位复现**（A 88.88/91.22、B 92.43/95.43）自证可信；
  **like-for-like 旧口径 B 本轮 92.43/95.43，与 round-3 逐位相同 ⇒ 零回归**；
  本轮全量口径（首次纳入 `KeyWorkbenchDialogs.tsx`）B 85.95/89.03、A 84.34/86.93，均 ≥80%。
- **台账一致性就地修正**：本索引 `BUG-008`/`BUG-009` 两行状态列原滞后为 `待修复`（正文已 `待复测`），
  本轮随终判统一为 `已修复（round-4 复测通过）`。
- **观察项（非 bug）**：`console/consoleCompletion/commandMeta.ts` 873 行为静态命令元数据表，
  早于本轨、不在本轮 diff、属禁改面 ⇒ 建议后续轨按 group 拆分，**不登记 bug**。
