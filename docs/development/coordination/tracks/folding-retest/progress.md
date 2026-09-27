# 轨道 folding-retest · Track E（Code Folding）独立复测

- **状态**: TEST_DONE
- **分支**: `feature/folding-retest`
- **Worktree**: `.worktrees/datazen-folding-retest`
- **Host 基准**: `f7d13d81d`（integration tip）
- **Pro 仓**: `packages/pro-extensions/sql-editor-pro` @ `local-productivity/code-folding` @ `2dfba67`（ep 1.1.0，已复核）
- **测试报告**: [`tester-report.md`](./tester-report.md)
- **业务代码改动**: **零**

## 结论

**宿主门禁全绿 ≠ Pro 正确** —— 宿主 `npx tsc --noEmit` + `npx vitest run`
覆盖 Pro 的**零个**文件（`packages/pro-extensions/` 被 `.gitignore:68` 忽略，宿主 tsconfig 也不含它），
两套门禁**没有任何交集**。

Track E 的**实现功能上是通的**（折叠 / 展开 / 箭头 / 键位 / EP 注册均实测有效），
但**测试层有 4 个真实缺陷**，其中 2 个会把"功能已坏"判成绿。

## 基线（Tester 自测，不采信台账）

| 门禁 | 退出码 | 结果 |
|---|:---:|---|
| Host `npx tsc --noEmit` | 0 | 干净 |
| Host `npx vitest run` | 0 | **480 files / 4820 tests** 全绿 |
| Pro `npx tsc --noEmit` | 0 | 干净 |
| Pro `npx vitest run` | 0 | **66 files / 841 tests** 全绿（+ 我的 5 例 → 67 / 846） |

## 缺陷

| 编号 | 一句话 |
|---|---|
| [BUG-001](./bugs/code-folding-BUG-001.md) | 420 kB 体积上限实测只有 **9.8%** 余量，拦不住 `@codemirror/lint`(403 kB)、`@codemirror/state`(418 kB) 单独内联 |
| [BUG-002](./bugs/code-folding-BUG-002.md) | `foldJourney:495` 的 `toContain('Unfold line')` 是夹具假象，功能全死它也绿 |
| [BUG-003](./bugs/code-folding-BUG-003.md) | `sqlFoldService` 注释说"只在起始行给箭头"，实现只判重叠 ⇒ 一个 region 画出 4 个箭头 |
| [BUG-004](./bugs/code-folding-BUG-004.md) | Pro `tsconfig` 排除 `__tests__` + `strict:false`，本轨新增测试带着 **11 个真实 `TS2322`** 全绿过门 |

## 关键更正（协调者台账）

- "同样悄无声息地蒸发"**不准确** —— 实际是"折叠无效 + 抛出显眼的 `TypeError`"。
- "所有既有测试仍然全绿"**与实测矛盾** —— 回归后有 **8 条既有测试变红**。
- `keymapConflicts.test.ts` 的 `keyCode` 垫片是**死代码**（删掉 10/10 仍绿），其理由已被证伪。
- "5 个字符串标记均为 0"**不准确** —— `foldInside` 在每个产物中各出现 **1 次**。
- A5：**加 `fold` 隔间后 `proCompartments.ts` 覆盖率是 100/100/100/100，既没升也没降**，
  Track B 与我在**统一方法**下一致；Coder 的 98.41/96.87 在 `f7d13d81d` 两种方法下均不复现。

## 未独立验证

见 [`tester-report.md` §6](./tester-report.md)，共 **12 条**，逐条列明。引用本轨道任何结论时不得把其中任何一条算作证据。
