# BUG-004：Track E 新增的 11 个测试带着 11 个真实类型错误，Pro 的 tsconfig 挡住了它

- **状态**：待修复（未修复；本轨 Tester 只测不修）
- **严重度**：中
- **轨道**：folding-retest
- **发现者**：Tester（独立复测）
- **发现时基线**：Pro `local-productivity/code-folding` @ `2dfba67`
- **类别**：门禁缺口（测试文件不参与类型检查）
- **是否本轨道引入**：**是**
- **业务代码改动**：**零**。修这 11 个错误只改测试文件。

---

## 一、一句话描述

宿主根 `AGENTS.md` 明文规定"**测试文件参与类型检查**……新增或修改测试后必须保证
`pnpm typecheck` 干净"；而 Pro 的 `tsconfig.json` 同时开着 `"strict": false`
**和** `exclude: ["src/**/__tests__/**"]`，把这条规矩整个挡在门外。
结果：本轨道新增的 `keymapConflicts.test.ts`（10 个）和 `foldJourney.test.ts`（1 个）
带着 **11 个真实的 `TS2322` 类型错误**通过了全部门禁。

---

## 二、三个真实错误数（**[真实流水线测量]**，均为 `npx tsc --noEmit` 实际退出码与行数）

在 `packages/pro-extensions/sql-editor-pro/` 下实测：

| 变体 | 退出码 | 错误总数 | 在 `__tests__` | 在 src 源码 |
|---|:---:|---:|---:|---:|
| **(a) 原样**（`strict:false` + 排除 `__tests__`） | **0** | **0** | 0 | 0 |
| **(b) 只开 `strict: true`** | 2 | **2** | 0 | 2 |
| **(c) 只把 `__tests__` 纳入** | 2 | **94** | **94** | 0 |
| (d) 两者都开（补充测量） | 2 | 139 | 137 | 2 |

三个数如实报出，**没有为了让任何一种配置变绿而调整过任何选项**。

**(b) 的 2 个源码错误**（仅 `strict` 才暴露，**与本轨道无关**，属既有代码）：
- `src/diagnostics/metadataLoader.ts:131` — `TS2345: 'string | undefined'` 传给 `'string'`
- `src/hover/hoverExtension.ts:70` — `TS2345: Promise<Tooltip | null | undefined>` 不满足
  `HoverTooltipSource`（CM 要求 `null` 而非 `undefined`）

**(c) 的 94 个按文件分布**：

| 文件 | 错误数 | 归属 |
|---|---:|---|
| `src/components/query-builder/__tests__/QueryBuilderPanelCommit.test.tsx` | 40 | 既有，非本轨 |
| `src/components/query-builder/BuildStatement/__tests__/BuildStatement.test.tsx` | 37 | 既有，非本轨 |
| **`src/fold/__tests__/keymapConflicts.test.ts`** | **10** | **本轨 Track E 新增** |
| `src/components/query-builder/DiagramCanvas/__tests__/…interactions.test.tsx` | 4 | 既有，非本轨 |
| **`src/fold/__tests__/foldJourney.test.ts`** | **1** | **本轨 Track E 新增** |
| 其余 2 个 query-builder 测试 | 2 | 既有，非本轨 |

**本轨道贡献 11 / 94。**

---

## 三、11 个错误的同一个成因（最扎眼的地方）

全部是同一类：

```text
src/fold/__tests__/keymapConflicts.test.ts(36,42): error TS2322:
  Type 'number' is not assignable to type 'boolean'.
src/fold/__tests__/foldJourney.test.ts(57,55): error TS2322:
  Type 'number' is not assignable to type 'false | void'.
```

即 `run: () => log.push('folded')` 这类写法：`Array.prototype.push` 返回 `number`。

**关键点在于**：本轨道自己的**生产代码**里，`foldExtension.ts` 的 `toggleFoldAtCursor`
**恰恰写着防止这个错误的注释** ——

> "Arrow body, not an expression body: `push` returns a number … an implicit return
> does not survive a strict check."

**同一个陷阱，在生产代码里被显式警告、在 11 行之外的测试代码里被踩了 11 次**，
而 `strict: false` + 排除 `__tests__` 让它一路绿灯。

这**不是**假设"如果开了 strict 就会坏" —— 上面 (c) 列的 94 就是开了的实测结果。

---

## 四、影响边界（不夸大）

- 这 11 个错误**不会**造成运行时错误；`strict` 下 `push` 返回 `number` 照样能跑。
  真正的问题是**门禁形同虚设**：Pro 侧"测试文件参与类型检查"这条宿主规矩**完全没生效**。
- 我**没有**主张 Pro 应该立刻开 `strict`（(b) 的 2 个源码错误在别的文件，且按 §6
  我无权改业务代码）。我主张的只有更小、且有宿主先例的一条：**先把 `exclude` 里的
  `src/**/__tests__/**` 去掉**，让 94 个测试错误进入视野，然后用 scripts-gate 那种
  **只降不升的棘轮**逐轨消化。

---

## 五、scripts-gate 模式是否适用于 Pro（协调者点名要我判断）

**我的判断：适用，但必须分两步走，且第一步不能是"直接改配置"。**

- **第一步（无风险，立即可做）**：Pro 侧加一条**基线快照**测试/脚本，
  断言 `tsc -p <把 exclude 去掉、strict 保持 false 的配置>` 的错误数 **≤ 94**，
  **只允许持平或下降**。这正是 `scripts-gate` 的棘轮形状，**不需要一次修完 94 个**。
- **第二步（逐轨）**：本轨只需消化自己的 **11 个**，就能让基线降到 83。
  合理、可完成、且有归属。
- **第三步（可选）**：那 2 个 `strict` 源码错误量极小（2 个文件各 1 处），
  修完即可开 `strict: true`，错误总数从 94 降到 137→… 需重测（因为 `strict` 会额外
  暴露测试里的 43 个），**故必须先做第一步再动 `strict`**。

**"听起来合理"不是证据**（协调者第十类判据）。上面每一条的**错误数**都是实测；
"棘轮可分步降"这一条属于**机制论证，最弱**，标明如上。
