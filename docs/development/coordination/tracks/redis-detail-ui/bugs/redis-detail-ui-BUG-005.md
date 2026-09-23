# redis-detail-ui-BUG-005 · 台账口径失实：自报覆盖率与「非缺口」判定所依据的行号/文件归属错误

- **严重度**：低（不改变任何运行时行为，也不改变「口径 A/B ≥80%」这一结论——Tester 独立复算同样成立；但它误导协调者对缺口性质的裁定，且正是本仓反复消灭的「台账不如实」类别）
- **状态**：`待复测（round-1 修复后）`
- **发现**：W3-E 第 1 轮 Tester 复验（覆盖率独立复算 + `coverage-final.json` 逐语句比对）
- **涉及文件**：`docs/development/coordination/tracks/redis-detail-ui/progress.md` §6（`## 自验记录`）

## 描述（含量级）

自验记录 §6 点名缺口里有三处与实测不符，逐条：

| # | 台账说法 | Tester 实测（`coverage-final.json`，`--coverage.all=false`） |
| - | -------- | ------------------------------------------------------------ |
| 1 | 「`keyEditorsInvokes.ts` 的 `:306-321` 为**集合类批量 invoke 辅助（本轨未动其语义）**」 | `:306-325` 实际是 **`invokeRename`(`:296-311`) 与 `invokeDeleteKey`(`:314-325`)**。`invokeDeleteKey` 是**本轨 E-4 新建**的单键删除入口（`git diff 8981d3078..HEAD` 明确含该函数），不是存量集合辅助。⇒ 该缺口属本轨验收面，**应补测而非记为非缺口**（Tester 本轮已补，见 T-11）。真正属 §2「明确不做」的集合辅助是 `:63-68 / 96-102 / 112-117 / 127-132 / 143-149 / 174-179 / 204-209`（`invokeHashDel` / `invokeListSet` / `invokeListPop` / `invokeListIndex` / `invokeListRem` / `invokeSetRemove` / `invokeZsetRemove`，base 即零覆盖）。 |
| 2 | 口径 B 自报 **86.25% stmts / 88.74% lines** | Tester 以同一 v8 配置复算（A=15 文件口径、B=剔除 `RedisWorkbench` + 5 集合编辑器 + `JsonEditor`）= **85.57% / 88.64%**（含 `en.ts`）或 **85.55% / 88.62%**（不含 `en.ts`）。⇒ 差 0.68pp / 0.10pp，**结论不变（≥80%）**，但自报值不可复现，需以复算值为准。口径 A 自报 81.22/83.71 → 复算 **81.25/83.74**（吻合）。 |
| 3 | 「口径 C 偏低**不是缺口**，是 glob 把 §2 不做的编辑器扫进来」 | 判定**成立**（Tester 复算口径 C = **56.32% stmts / 57.00% lines**，与自报 55.43/56 同一量级；低分的 100% 来自 base 即 0.67~1.66% 且**本轨零 diff** 的 5 个集合编辑器 + 未触及的 `JsonEditor.tsx` 55.05%）。但 §6 把 `keyEditorsInvokes:306-321` 混进同一句话里，使「非缺口」清单多算了一条**属本轨验收面**的项（见 #1）。 |

附带一条同类：`## 交接现场核对` 表里「`git diff` 后**唯一被改文件** = `ui/key-browser/RedisWorkbench.tsx`」属实，但 §3 的结论句「**不回升**这一实质要求满足」下方给出的「简报基线 531 与本文件无关」需要协调者在合流时以实测 **760** 重对齐（本条不重复登记，只在 T-13 记录）。

## 重现步骤

```bash
# 1) 行号归属
git diff 8981d3078..HEAD -- packages/drivers/redis/ui/value-editors/keyEditorsInvokes.ts | grep -A3 "invokeDeleteKey"
sed -n '296,325p' packages/drivers/redis/ui/value-editors/keyEditorsInvokes.ts
# 2) 口径复算
npx vitest run --config vitest.drivers.config.ts --coverage --coverage.provider=v8 \
  --coverage.all=false --coverage.reporter=json-summary --coverage.reporter=json
#   再按 progress.md §6 的两套文件集合对 coverage-final.json 求 Σcovered/Σtotal
```

## 实测日志

```text
BEFORE(tester tests)  A: stat=81.25 bran=75.36 func=78.42 line=83.74
BEFORE(tester tests)  B: stat=85.57 bran=78.88 func=83.72 line=88.64
CALIBER C (recompute): stat=56.32 bran=57.52 func=48.05 line=57.00
keyEditorsInvokes.ts uncovered statements -> 63-68, 96-102, 112-117, 127-132, 143-149,
    174-179, 204-209, 306-311, 321-325
  uncovered fns: invokeDeleteKey, invokeHashDel, invokeListIndex, invokeListPop,
    invokeListRem, invokeListSet, invokeRename, invokeSetRemove, invokeZsetRemove
```

⇒ `invokeDeleteKey` / `invokeRename` **确在**未覆盖函数清单内，而台账把它们归给了「集合类批量 invoke 辅助」。

## 建议修法

台账 §6 就地改写三条：口径 B 换成复算值并附复算命令；缺口清单把 `invokeRename` / `invokeDeleteKey` 移到「属本轨验收面」，集合辅助保留「§2 明确不做」。本轮 Tester 已在 T-11 补测覆盖 `invokeRename` / `invokeDeleteKey`，改台账时一并引用。

## 影响范围

纯台账准确性。不阻断门禁与合流；影响协调者对「哪些缺口需要回炉」的判断，故仍登记而非口头说明。

## 修复记录（round-1）

- **commit**：`c9e647f2e`（`docs(redis-detail-ui): BUG-005 台账口径四条就地更正（修复轮 round-1 记录区）`）。
- **修法**：`progress.md` 末尾新增「`## 修复轮 round-1（fixer · 2026-09-23）`」记录区，四条更正（历史原文全部保留，以新节为准）：
  1. **口径 B**：自报 86.25/88.74 作废，引用以 Tester 复算 **85.57% stmts / 88.64% lines（含 `en.ts`）** 为准（不含 85.55/88.62）；**≥80% 结论不变**；口径 A 81.25/83.74 吻合、口径 C 判定成立但清单按第 2 条修剪；附复算命令指引（BUG-005 重现步骤 §2）。
  2. **缺口归属**：`keyEditorsInvokes.ts:296-311 invokeRename` / `:314-325 invokeDeleteKey` 改记为**本轨验收面缺口（应补测）**，注明 Tester T-11 已补测；§2 集合辅助只保留实测那 7 段（`invokeHashDel` 等，base 即零覆盖）。
  3. **孤儿副本注释作废**：实测 9 个非 `en.ts` 文件 `stringMode` 命中**均为 0**、`i18n-sync-check` driver pack **0 issue** ⇒ 「9 语言留孤儿副本」为不实陈述。
  4. **拦截点计数**：§5「8 个拦截点」标注为**语义计数（8 类动作）**，并补「**11 个调用点 / 8 类动作**」口径（`KeyEditors ×3 + RedisWorkbench ×7 + RedisConnectionView ×1`，另 `draftGuard.ts:6` 文档提及 1 处对上 T-6 的 12 处），兑现 T-6 注「台账需补一句」。
- **偏差说明**：本 bug「建议修法」写的是「就地改写」，而 round-1 修复纪律要求「追加更正、不删历史」⇒ 采用**追加式更正**，原文保留、新节声明权威口径，更正前后可对照。
