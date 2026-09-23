# redis-detail-ui-BUG-009 · BUG-007 修复把 `RedisWorkbench.tsx` 推过本轨 §5 硬钉的 `≤800` 行上限（787 → 805）

- **登记**：第 3 轮复测 Tester（round-3，全新实例），2026-09-23
- **状态**：`待复测（round-3 修复后）`
- **严重度**：**低**（无功能影响、不阻断四门禁；但撞的是本轨 `progress.md` §5「环境纪律（**违反即返工**）」明文条 + AGENTS.md 单文件规模条，且第 2 轮自己的审计把「787 行 ≤ 800 ✅」列为核对项 ⇒ 一次提交即破线，属纪律回归）
- **来源**：round-3 文件面审计（简报验收动作 #1「核对 `RedisWorkbench.tsx` ≤800 行」）

## 事实（逐字实测）

```text
$ git show 47e2240b7:packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx | wc -l
787
$ git show 9714509b1:packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx | wc -l
805
$ wc -l < packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx
805
$ git show --numstat --format="" 9714509b1 -- …/RedisWorkbench.tsx
18      0       packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx
```

- 修复 commit `9714509b1` 净增 **18 行**（0 删除），787 → **805** ⇒ 越过 800 上限 **5 行**。
- 文件尾有换行、`wc -l` 计行口径正常（非统计假象）；`grep -c .` 非空行 754 行。
- 同轨 `progress.md:96`（§5 环境纪律，标题含「违反即返工」）：**「i18n 开发期只改 `en.ts`；单文件 ≤800 行（`KeyEditors.tsx` 458 行，重排时按类型/职责拆，别就地堆大 if）」**。
- 同轨 `progress.md:592`（第 2 轮 R2-A 文件面审计）把 **「`RedisWorkbench.tsx` = 787 行 ≤ 800」** 作为核对项记录在案 ⇒ 本轮修复在该项上翻车。

## 与自报的差异

- 修复轮第 2 回合自报改动面为「`RedisWorkbench.tsx`（**+13 行**含注释）」，实测净增 **+18 行**（差 5）。
- 自报与台账均**未提及**越过 800（`progress.md` 的「修复轮第 2 回合」小节无行数条；BUG-007 修复记录亦无）。
  ⇒ 属「破线未被发现/未声明」，不是「已声明并获豁免」。

## 影响范围

- 无运行时影响；纯源码规模纪律。
- 与既有超限文件的关系：`ui/console/consoleCompletion/commandMeta.ts` = 873 行**存在**，但
  `git diff 8981d3078..HEAD -- …/commandMeta.ts` **为空**（本轨零触碰，属存量）；本轨自己动过的文件
  才是本条射程 ⇒ 不构成豁免先例。
- 本轨其余生产文件均在限内（`SlowlogPanel.tsx` 545、`StreamEditor.tsx` 720 等）。

## 修法建议（Tester 只测不修）

守卫本体只需 3 行代码（`:356-358`），越过上限的 15 行几乎全是 `:341-355` 的说明性注释块。任选其一：

- **(a) 注释瘦身（最小）**：把 `:341-355` 的 15 行注释压缩到 ≤10 行，即可回到 ≤800，语义无损
  （根因与设计意图已在 BUG-007 台账 + `round2Probe` 文件头各留一份，源码内不必三次重复）。
- **(b) 抽纯逻辑模块（更符合 §5 原意「按职责拆」）**：把「同键 + detail 落后 ⇒ 先问守卫」的判定抽成
  `ui/shared/` 下的小纯函数（如 `needsStaleSameKeyGuard(selectedKey, detailKey, key)`）并 co-locate 单测，
  调用点只剩一行 —— 与 PRD §5 点名的「组件薄 + 纯逻辑模块厚」一致。
- 验收：`wc -l` ≤ 800 且四门禁（尤其 G1/G4）保持绿；`round2Probe` P1b 与 `testerRound3Probe` A/B/C 不得转红。

## 修复记录（coder round-3）

- **修复者**：修复轮第 3 回合 Rescue Coder（`w3e-rescuer-r3`，全新实例）。
- **commit**：`cbecba255` —— `refactor(redis-ui): trim the BUG-007 guard comment back under the 800-line rule (BUG-009)`。
- **修法选型：建议 (a) 注释瘦身（最小改动、语义无损）**，未采用 (b) 抽模块（本回合只做"回到硬线内"，
  不扩大改动面；(b) 可留作后续重构）。

### 实测行数（逐字）

```text
$ wc -l packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx   # 修复前
805
$ wc -l packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx   # 修复后
795
$ git diff --numstat -- packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx
6      15      packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx
```

⇒ **805 → 795 行（净 −10），回到 `≤800` 硬线内 ✅**。

### 改动内容

把 `:341-355` 的 **15 行** BUG-007 说明性注释压缩为 **6 行**（守卫本体 3 行代码**逐字未动**），
保留要点：① 跨不一致态的同键重取**不是**下面的 in-place 分支（会翻 `loading`、重挂编辑器、静默毁草稿）；
② 此守卫是**同键入口的单一收口**；③ 放弃愈合、答 keep 有界；④ 免问路径（一致性重取、写后回读）保持免问。
根因与设计意图已在 BUG-007 / BUG-008 台账与 `round2Probe` 文件头各留一份，源码内不必三次重复
（与建议 (a) 的理由一致）。

```ts
// BUG-007: `selectedKey` and `keyDetail.key` can still disagree, and a
// same-key refetch across that gap is NOT the in-place one below — it flips
// `loading`, remounts the editor and silently wipes the draft. Re-ask here,
// the single choke point for every same-key entry: discard heals, keep is
// bounded (ask-free paths — consistent refetches, post-write reloads — stay
// ask-free).
if (key === selectedKey && keyDetail?.key !== key) {
```

- 注释压缩后**仍准确**：BUG-008 修复后正门已由 `handleKeyCtxRename` 的"先问后改"堵住，该守卫转为
  **防御性收口**（`selectedKey` 与 `detail.key` 现在恒一致，分支正常不再命中，但保留以防未来重现）。

### 不回归核对

- `round2Probe` P1b 与 `testerRound3Probe` A/B/C **未转红**（G1 全绿）。
- 四门禁（逐字尾部）：

```text
G1  Test Files  60 passed (60)
         Tests  564 passed (564)
G2  [tsc exit: 0]
G3  ✓ built in 4.69s
    [vite build exit: 0]
G4  [check-driver-import-boundaries] ok (1474 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
    [boundaries exit: 0]
```

### 与本条台账事实的关系

- 本条登记的 787 → 805 破线事实不变（历史）；本回合只负责**回到 ≤800**。
- 未改动本轨其他生产文件行数；`commandMeta.ts`（873 行，存量、本轨零触碰）不属本条射程，本次未动。
- **未自测代替复测**：由协调者派全新 Tester 做第 4 轮复测裁定（核对 `wc -l` 与四门禁）。

