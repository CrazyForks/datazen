# Track E（Code Folding）独立复测报告

- **报告者**：Tester（独立复测，只测不修）
- **Host worktree**：`/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-folding-retest`
- **Host 分支 / HEAD**：`feature/folding-retest` @ `f7d13d81d`
- **Pro 仓**：`packages/pro-extensions/sql-editor-pro`，分支 `local-productivity/code-folding` @ `2dfba67`
- **业务代码改动**：**零**。本轮唯一的 Pro 提交是一个新增的回归测试文件。
- **发现的缺陷**：4 条，见 [`bugs/`](./bugs/)

---

## 0. 一句话结论

**宿主门禁全绿 ≠ Pro 正确。** 这一点本轮**实测确认**，不是引述：
宿主 `npx tsc --noEmit` 与 `npx vitest run` 覆盖 **0 个** Pro 文件
（`packages/pro-extensions/` 整个被 `.gitignore:68` 忽略，宿主 tsconfig 也不含它），
而 Pro 自己跑出 **841 → 846** 条用例。两套门禁**没有任何交集**；
宿主那条"全绿"在物理上**不可能**对 Pro 的正确性说一个字。

Track E 的实现本身**功能上是通的**（折叠、展开、箭头、键位、EP 注册全部实测有效），
但**测试层存在 4 个真实缺陷**，其中 2 个会让"功能已坏"判成绿。

---

## 1. 证据分级约定（全文遵守）

| 标记 | 含义 |
|---|---|
| **[变异]** | 变异证据：改坏源码，看测试是否变红 |
| **[实测]** | 真实流水线测量：真的跑构建/测试/tsc，读取真实数字 |
| **[机制]** | 机制论证（**最弱**）：读代码推出的解释，**绝不出现在同一因果句的前两种证据之后** |

---

## 2. §4 基线（我自己测的，不采信任何台账数字）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|:---:|---|
| Host 类型 | `npx tsc --noEmit` | **0** | 干净 |
| Host 测试 | `npx vitest run` | **0** | **480 files / 4820 tests**，全绿，164.87s |
| Pro 类型 | `npx tsc --noEmit` | **0** | 干净 |
| Pro 测试 | `npx vitest run` | **0** | **66 files / 841 tests**，全绿，22.44s |

**[实测]** Pro 的 66/841 与 Coder 报的**完全一致** —— 本轮唯一一处采信得上的台账数字。
加入我的回归测试后 Pro 为 **67 files / 846 tests**。
Host 的 480/4820 在我两次独立运行中**完全稳定**（含带 coverage 的那次）。

**[实测]** Host 全套件 **0 失败**，因此本 worktree 既不是协调者描述的"无 Pro"（4 例 ENOENT），
也不是 "Pro @ main / ep 1.0.0"（2 例断言失败）。复核：
`manifest.json` 的 `extensionPointsVersion` = `1.1.0`；
`packages/extension-points/src/__tests__/security.test.ts` 实跑 **25 passed / 0 failed**
—— 与协调者给的第三行完全吻合。**Pro 检出分支正确，无需排查。**

---

## 3. 验收项逐条

### A1 · BUG-003 能否在 `2dfba67^` 复现？

**结论：不能。BUG-003 在历史中不存在可复现的前版本。** 两条独立证据：

- **[实测]** `git rev-parse 2dfba67^` = `967fdbd`；
  `git ls-tree -r --name-only 2dfba67^ -- src/fold` → **无输出**；
  `git show --stat 2dfba67` 显示 `src/fold/foldExtension.ts | 232 ++++++`，是**新增文件**。
  ⇒ 前一个 commit 里根本没有 `src/fold` 目录，缺陷无从"存在于历史中"。
- **[机制]** 因此我改用**重构**而非历史恢复：
  `codeFolding({ foldService: sqlFoldService } as never)` 复现"配置里传、不注册到 facet"的形态。

**[变异] 重构版 M2 的结果**（全 Pro 套件）：**3 files / 9 tests 红**，
与"删除 `foldService.of(sqlFoldService)`"的 M1 **完全同构**（9 条同名用例红）。

**[变异] `state.facet(foldService).length`**：折叠前 **0** → 折叠后 **>0**。
这条是我自己写的 5 例回归测试 `foldServiceFacetRegression.tester.test.ts` 的核心断言，现为绿。

> ⚠️ 协调者要求核对的一条警告，已遵守：
> **dist 里的 `foldable()` 等符号已被压缩，grep 0 命中不构成证据。**
> 本轮所有"存在/不存在"判断一律走**可执行断言**，不走 dist grep。

**台账两处需要更正**：

1. "同样悄无声息地蒸发"**不准确**。`RangeSetBuilder` 变体下
   `foldCode` 派发了畸形 effect，随后 `announceFold` 执行 `state.doc.lineAt(undefined.to)`，
   从 keydown handler 里抛出
   `TypeError: Cannot read properties of undefined (reading 'length')`。
   **[实测]** 该 TypeError 出现在 jsdom 虚拟控制台 → vitest `console.error`。
   正确描述是"**折叠无效 + 抛出显眼的 TypeError**"，不是"静默"。
2. "所有既有测试仍然全绿"**与实测矛盾**：M1/M2 下有 **8 条既有测试变红**
   （keymapConflicts 4 条 + foldJourney 4 条 gutter）。
   **[机制]** 严格说，"修复前套件"已随新增文件消失，其自身绿度不可测；
   但**当前**套件对"回归"的捕获是充分的。

---

### A2 · 4 条 DOM gutter 断言是否各自 load-bearing？

**[变异] 完整矩阵**（每次只改一处，跑全 Pro 套件）：

| 变异 | 红了几条 | 红了哪些 |
|---|---:|---|
| M1 删除 `foldService.of(sqlFoldService)` | **9** | 4 条 keymapConflicts + **4 条 gutter** + 我的 1 条 |
| M2 重构版（同 M1） | **9** | 同上，逐条同名 |
| M3 删掉 `foldGutter(...)` | **6** | 4 条 gutter + `hostModuleExternalization` 的 `@codemirror/language` 那条 |
| M4 交换 open/closed 文案 | **1** | **只有** "renders the configured closed text on a collapsed line" |

**结论：4 条 DOM 断言不是"同等地 load-bearing"。**
对**现实的** gutter 配置错误（文案写反，M4），4 条里只有 **1 条**会红。

**是否存在更轻于 DOM 的等价判据？存在，且可用** ——
对全部行求 `foldable(state, line.from, line.to)` 布尔值：
- **[实测]** region 打开时 → `true`；删掉收尾行后 → `false`；与 DOM 观感一致。

**但它对 gutter 配置类缺陷的敏感度严格低于 DOM**（M3/M4 类错误 `foldable` 完全测不到）。
⇒ DOM 断言**并非全无可替代**，但也**不是 4 倍冗余**。
真正的冗余在别处 —— 见 **BUG-002**：其中一条的正向半句本身就是假绿。

**更严重的发现**：我把编辑器**完全降级**（只挂 `codeFolding() + foldGutter()`，
**不注册 `foldService`** ⇒ 折叠功能彻底失效）后读到
`arrowsIn(v) = ["Unfold line"]`，而 `foldJourney.test.ts:495` 的**两个半句都通过**。
即该用例在"功能全死"时整体仍绿，它今天会红**全靠它的第一行**。
已登记为 **BUG-002**。

---

### A3 · `hostModuleExternalization.test.ts`（7 例，真实 `vite build`）

**[变异] 删除 `vite.config.ts` 里的 `renderChunk` 改写** →
**6 / 7 例变红**；唯一仍绿的是体积闸门（因为改写不改变体积）。

| 用例 | 结果 |
|---|:---:|
| built an artifact that actually references the host globals | ❌ |
| resolves every shared-module import in the source to the host singleton | ❌ |
| resolves `react` to the host singleton too | ❌ |
| leaves no bare import statement behind in the artifact | ❌ |
| **ships no inlined copy of a CodeMirror package** | **✅（唯一存活）** |
| only externalizes modules the host actually publishes | ❌ |
| keeps `@codemirror/language` on the host copy | ❌ |

**[实测] 真实体积（真实 `vite build`，`sourcemap:false`，读 `index.esm.js`）**：

| 变体 | 字节 | kB | <420 kB? |
|---|---:|---:|:---:|
| **真实 `vite.config.ts`（未改）** | **391,554** | **382** | ✅ |
| 仅去 `renderChunk` | 391,508 | 382 | ✅ |
| `@codemirror/language` 内联 | 465,291 | 454 | ❌ |
| `@codemirror/lint` 内联 | 412,499 | 403 | **✅ 漏网** |
| **`@codemirror/state` 内联** | **428,079** | **418** | **✅ 漏网** |

**⇒ 420 kB 上限没有"~50% 余量"，实测只有 9.8%**，且单独内联
`@codemirror/state`（`Facet`/`StateField`/`RangeSet` 的定义所在）体积仍低于上限。
已登记为 **BUG-001**。

**[实测] 复现"字符串标记 0 次"的说法**：逐个数 `LRLanguage` / `syntaxTree` /
`TokenCache` / `foldInside` / `@lezer/` 在 7 个变体产物中的出现次数：

| 标记 | 全部 7 个变体中的出现次数 |
|---|:---:|
| `LRLanguage` | **0** |
| `syntaxTree` | **0** |
| `TokenCache` | **0** |
| **`foldInside`** | **1（每个变体各 1 次）** |
| `@lezer/` | **0** |

⇒ 台账"5 个标记均为 0"**不准确**：`foldInside` 在**每一个**产物里都出现 **1 次**。
**[机制]** 但**移除标记法的决定本身是对的**：这 4 个为 0 的标记，
在 `@codemirror/language` **确实被内联**的变体里**依然是 0** ——
压缩器重命名了标识符，tree-shaking 又把没走到的分支删了。
所以标记**在原理上就无法失败**，测试文件里那段"标记是 worthless"的注释是对的。

**体积上限能否漏掉小模块内联？能，已实测。**（`lint` 403 kB、`state` 418 kB）

---

### A4 · 键位冲突

**[实测] "0 个方向键组合" —— 确认成立。**
`foldKeymap` 实为 4 条，全部含方括号：

```ts
[{key:"Ctrl-Shift-[", mac:"Cmd-Alt-["}, {key:"Ctrl-Shift-]", mac:"Cmd-Alt-]"},
 {key:"Ctrl-Alt-["}, {key:"Ctrl-Alt-]"}]
```

**0 个 ArrowUp/ArrowDown 组合。**

**三个陷阱的复核**：

| 陷阱 | 判定 | 依据 |
|---|:---:|---|
| ① `foldKeymap` 不是成对 toggle | **成立** | **[实测]** 第 1 次 `Ctrl-Shift-[` → size 1；**第 2 次 → size 仍 1**，`defaultPrevented === false`；`Ctrl-Shift-]` → size 0 |
| ② 同 chord 同优先级先注册者胜 | **成立** | **[机制]** CM6 keymap 语义；`Prec.highest` 覆盖顺序已由 `createSqlFoldExtensions` 使用 |
| ③ jsdom + `w3c-keyname` 在带修饰键时丢弃 `event.key` | **本环境下为假** | **[变异]** 见下 |

**陷阱 ③ 的实测结论（重要，请勿再传播相反说法）**：
我把 `keymapConflicts.test.ts` 复制一份，**把 `KEY_CODES` / `keyCode` 垫片整段删除**后运行
→ **10 / 10 全部仍通过**。
**[机制]** 8 个和弦（4 个折叠 + `Mod-Alt-\` + `Mod-Alt-ArrowUp` + `Alt-ArrowUp` +
`Shift-Alt-ArrowUp`）在**带**与**不带** `keyCode` 两种情况下解析结果**完全相同**。
⇒ **该垫片是死代码，其注释里"没有它和弦就解析不了、每个测试都会假绿"的理由是错的。**

⇒ 关于"仓库级陷阱"：**我未发现**任何被它假绿的测试。
**"任何带修饰键的 `fireEvent.keyDown` 测试都假绿"这一说法，在本环境不成立，不应作为仓库级问题登记。**

**另附一条我自己的教训**（与 ③ 相反方向，登记以免重犯）：
jsdom 的 `KeyboardEventInit` 键名是 `ctrlKey` / `shiftKey` / `altKey` / `metaKey`。
我最初写 `{ctrl: true}` 并展开进 init，jsdom **静默丢弃未知键**，
事件变成**零修饰键** —— 于是折叠和弦在约 6 个探针场景里"看起来是死的"。
我通过"逐字复制既有测试（能跑）vs 我的变体（跑不通）"再 diff 才定位到 `ctrl` vs `ctrlKey`。
**这才是 jsdom 键盘测试真正的坑**，与陷阱 ③ 描述的相反。

---

### A5 · `proCompartments.ts` 覆盖率对账

**[实测] 统一方法（Track B 用的：全套件 + 显式 `--coverage.include`）**：

```
npx vitest run --coverage.enabled \
  --coverage.include='src/components/sql-editor/proCompartments.ts' \
  --coverage.reporter=text
→  Test Files 480 passed / Tests 4820 passed
    All files          | 100 | 100 | 100 | 100
    proCompartments.ts | 100 | 100 | 100 | 100
```

**[实测] Coder 的窄方法（只跑 `src/components/sql-editor` 子集 + 同一 include）**：

```
→  Test Files 31 passed / Tests 551 passed
    proCompartments.ts | 100 | 100 | 100 | 100
```

**结论，两问两答**：

1. **Track B 的 100% 与我复测的 100% 一致。**
2. **Coder 报的 98.41 / 96.87 / 100 / 100 在 `f7d13d81d` 上两种方法都复现不出来。**
   **[机制，最弱]** 它更像是更早状态下的测量（`foldCompartment.test.ts` 落地之前？），
   而不是回归。**我不主张台账造假，只主张该数字已过期。**
3. **加了 `fold` 隔间之后，分支覆盖率相对 Track B 是升是降？**
   **既没升也没降，仍是 100%。** **没有新增未覆盖分支。**
   ⇒ 协调者担心的"降到 96.87"这件事**不成立**。

---

### A6 · Pro 的 `tsconfig` 三档真实错误数（P-TS-1）

**[实测]**，`npx tsc --noEmit`，如实报数，**未为了让门禁变绿而调整任何选项**：

| 变体 | 退出码 | 总数 | 在 `__tests__` | 在 src 源码 |
|---|:---:|---:|---:|---:|
| **(a) 原样** | 0 | **0** | 0 | 0 |
| **(b) `strict: true`** | 2 | **2** | 0 | 2 |
| **(c) 纳入 `__tests__`** | 2 | **94** | **94** | 0 |
| (d) 两者都开（补充） | 2 | 139 | 137 | 2 |

**关键**：本轨道新增的测试贡献 **11 / 94**
（`keymapConflicts.test.ts` 10 个 + `foldJourney.test.ts` 1 个），
**11 个全是 `TS2322: Type 'number' is not assignable to type 'boolean'`** ——
`run: () => log.push(...)`。

**而本轨道自己的生产代码 `foldExtension.ts` 里，恰恰写着防止这个错误的注释**
（"`push` returns a number … an implicit return does not survive a strict check"）。
**[机制]** 同一个陷阱，在生产代码里被警告、在 11 行之外的测试里被踩了 11 次，
被 `strict:false` + 排除 `__tests__` 双重放行。

宿主根 `AGENTS.md` 明文要求"测试文件参与类型检查"，Pro 未跟进。
已登记为 **BUG-004**。

**scripts-gate 棘轮模式是否适用于 Pro？** 判断见 **BUG-004 §5**：
**适用，但第一步必须是"加只降不升的基线快照（≤94）"，不是"直接开 strict"**。

---

## 4. 已登记的缺陷

| 编号 | 一句话 | 严重度 |
|---|---|:---:|
| [BUG-001](./bugs/code-folding-BUG-001.md) | 420 kB 体积上限实测只有 9.8% 余量，且**拦不住** `@codemirror/lint`（403 kB）、`@codemirror/state`（418 kB）单独内联 | 中 |
| [BUG-002](./bugs/code-folding-BUG-002.md) | `foldJourney:495` 的 `toContain('Unfold line')` 正向半句是**夹具假象**（`foldGutter` 恒有隐藏占位符），功能全死它也绿 | 中 |
| [BUG-003](./bugs/code-folding-BUG-003.md) | `sqlFoldService` 注释说"只在起始行给箭头"，实现只判重叠 ⇒ 一个 region 在 4 行画出 4 个箭头 | 中 |
| [BUG-004](./bugs/code-folding-BUG-004.md) | Pro `tsconfig` 排除 `__tests__` + `strict:false`，本轨新增测试带着 **11 个真实 `TS2322`** 通过全部门禁 | 中 |

---

## 5. 观察（不构成缺陷，仅记录）

- `keymapConflicts.test.ts` 的 `KEY_CODES` / `keyCode` 垫片是**死代码**，
  其注释给出的理由（A4 陷阱 ③）**已被实测证伪**。删掉 10/10 仍绿。
- 台账 §8 的字节数（278,754 / 728,005）与 `2dfba67` 实测（391,554 / 465,291）不符。
- `navigator.platform === ''` ⇒ `IS_MAC` 为 false ⇒ `mac:` 变体在测试中**从未被走到**。
- `pro-extension.lock.json` 钉的是 `86c6577`（`2dfba67` 的**祖先**），
  而 `manifest.json` 已是 `0.2.2`。**未评估**，仅记录。

---

## 6. ⚠️ 我**没有**独立验证的清单（逐条列明）

以下各项**不构成本报告的证据**，任何人引用本报告时不得把它们算进去：

1. **BUG-003 在 `2dfba67^` 的原始复现** —— 前一 commit 不含 `src/fold`，**物理上不存在**。
   M2 只是**重构**，不是历史恢复。
2. **"修复前套件全绿"** —— 该套件已随新增文件消失，其自身绿度**不可测**。
3. **体积闸门对"动态 import / 绕过 specifier 扫描的打包路径"的端到端防护** ——
   我**没有**为这条路做端到端复现。BUG-001 只证明了"体积闸门单独失效"，
   **没有**证明"存在一条真的能绕过全文件的路径"。
4. **`@lezer/*` 层是否被真正内联过** —— 我只测到"这 5 个标记在所有变体中均为 0，
   包括 language 被内联时"，**没有**构造出标记能命中的产物。
5. **BUG-001 / BUG-003 的修复方案** —— 我只诊断，未实施，不对任何修法背书。
6. **Coder 报 98.41/96.87 时所用的 commit 与命令** —— 我只证明该数字在 `f7d13d81d` 两种方法下均不复现。
7. **`mac:` 键位变体在 macOS 上的行为** —— `IS_MAC` 全程为 false，**零覆盖**。
8. **真实浏览器 / WebDriver 下的表现** —— 全部结论均来自 **jsdom**；
   `foldGutter` 在真实布局下的箭头位置、数量、重叠**未测**。
9. **Track A–D 的代码质量与回归面** —— 本轮只复测 Track E。
10. **`pro-extension.lock.json` 的版本卫生** —— 观察到指向祖先提交，未评估是否会导致发布错版。
11. **Windows / 其他平台行为** —— 仅 macOS。
12. **`pack-ep.mjs` 签名链与 Pro 产物的端到端联调** —— 未执行 `pnpm tauri:build:pro`。
