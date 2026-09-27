# Track multi-cursor · Tester 独立测试报告（分段落盘）

- **Tester**: 独立新实例（Track D）
- **分支**: `feature/multi-cursor` @ `c37bc0848`
- **Worktree**: `.worktrees/datazen-multi-cursor`
- **规程**: `docs/development/subagent/tester.md` 四阶段 A/B/C/D

---

## 阶段 0 · 环境与改动范围核实

| 核实项 | 结果 |
|---|---|
| `git branch --show-current` | `feature/multi-cursor` ✅ |
| HEAD | `c37bc0848` ✅ |
| commit 变更文件 | 仅 3 个（`multipleSelections.ts` + 2 个测试文件）✅ |
| 是否碰 `editorExtensions.ts` / `SqlEditor.tsx` | `git diff --name-only c37bc0848^ c37bc0848 -- <这些路径>` 输出**为空** ✅ |
| 是否碰 `e2e/` | 空 ✅ |
| 是否碰 i18n（`src/locales/`） | 空 ✅ |
| 是否碰 `packages/` | 空 ✅ |
| 是否碰 `src/stores/` | 空 ✅ |
| 是否碰 `docs/development/coordination/hub.md` | 空 ✅ |
| 文件规模 | 155 / 390 / 269 行，均在 spec 限额内 ✅ |

**结论：改动范围合规，越界检查全过。**

⚠️ **过程事故记录（值得上报的方法论）**：第一次跑全量时我用了
`npx vitest run --reporter=basic 2>&1 | tail -120`。vitest 4 已移除 `basic` reporter，
启动即报错；而**管道把 vitest 的退出码吞成了 `tail` 的 0**，后台任务因此报
`[status: completed, exit code 0]` —— 一个彻底失败的运行看起来像成功。
重跑时改为 `npx vitest run > /tmp/x.log 2>&1; echo "EXIT=$?" >> /tmp/x.log`。
**教训：重型命令一律禁止裸管道掩盖退出码。**

---

## 阶段 A · 代码审查（进行中）

### A.1 逐文件阅读

`src/components/sql-editor/paste/multipleSelections.ts`（155 行，全文已读）。

修复结构与 spec 一致：
1. `Shift-Alt-ArrowUp/Down → addCursorAbove/addCursorBelow` 从普通 `keymap.of` 拆出，
   单独 `Prec.high(...)`（`Prec` 正确地从 `@codemirror/state` 导入，`:12`）✅
2. 复制行另找出路：`Mod-Shift-ArrowUp/Down`（正常优先级）+ mac 四修饰键兜底 ✅
3. `Mod-d` 族四条原样保留 ✅

### A.2 依赖源码核实（本 Tester 独立 grep，非采信任何一方转述）

`@codemirror/commands@6.10.3` `dist/index.js`：

- **L1769/1771（裁定 4 的直接证据）**
  ```js
  { key: "Shift-Alt-ArrowUp",   run: copyLineUp   },
  { key: "Shift-Alt-ArrowDown", run: copyLineDown },
  ```
  **两行均无 `mac:` 字段**。同数组内其它条目（如 `Alt-ArrowLeft` 有 `mac: "Ctrl-ArrowLeft"`）
  明显是写 `mac:` 变体的风格，此处没有 ⇒ **`Shift-Alt-*` → copyLine 的冲突在所有平台存在**。
- **L1720/1723（裁定 3 的 macOS 让位依据）**
  ```js
  { mac: "Cmd-ArrowUp",   run: cursorDocStart, shift: selectDocStart },
  { mac: "Cmd-ArrowDown", run: cursorDocEnd,   shift: selectDocEnd   },
  ```
- **全包 grep `key: ".*Shift.*Arrow"` 只有 L1769/L1771 两条** ⇒
  `Mod-Shift-ArrowUp/Down` 在 `@codemirror/commands` 中**完全未被占用**。

`@codemirror/view@6.43.11` `dist/index.js`：

- **L9017** `const currentPlatform = browser.mac ? "mac" : ... : "key"` ⇒
  jsdom 下 `Mod` → `Ctrl`，macos 测试文件的 `vi.hoisted` 伪造确有必要。
- **L9018 `normalizeKeyName`**：`Mod` 按 `platform` 展开成 `Meta` 或 `Ctrl`；
  修饰键前缀按 **Alt → Ctrl → Meta → Shift** 的固定顺序拼接。
- **L9053 `modifiers`**：与上同序；第三个参数 `shift` 决定是否加 `Shift-`。
- **L9164 `runHandlers` 关键两行**（裁定 1 的机理核心）：
  ```js
  if (runFor(scopeObj[prefix + modifiers(name, event, !isChar)])) { handled = true }
  ```
  字符键 `isChar === true` ⇒ 第三个参数 `!isChar === false` ⇒
  **主查表刻意不把 Shift 拼进名字**。
  随后的 `else if` 分支才走 `base[event.keyCode]`（非 US 布局回退）与 `shift[event.keyCode]`。
- **L9098 `buildKeymap`**：`scopeObj[full] = scopeObj[full] || {...}`
  ⇒ **同一 full key 名下先注册者胜**，这正是 `defaultKeymap`（先挂载）压过多光标扩展（后挂载）的机制。

`@codemirror/search` 的 `searchKeymap` 含 `{ key: "Mod-d", run: selectNextOccurrence, preventDefault: true }`
—— 与多光标扩展的 `Mod-d` 重复，但 `run` 是同一个函数，行为无差异（预存在，非本轨引入）。

### A.3 审查发现（均为**非阻断**，且**非本次提交引入**）

| # | 位置 | 发现 |
|---|---|---|
| R1 | `multipleSelections.ts:31` | `rectangularSelection` 的 `eventFilter` 中 `(e.altKey \|\| (e.altKey && e.shiftKey) \|\| (e.metaKey && e.altKey))` 三个子句全部被 `e.altKey` 蕴含，整个表达式恒等于 `e.altKey`。冗余但无害，属预存在代码（本轨未改动该行）。 |
| R2 | `multipleSelections.ts:37-54` | `domEventHandlers` 的 `Mod+D` 高优先级处理器在本轨挂载顺序下**基本不可达**：`handleKeyEvents` 是 `Prec.default` 且先注册，`Cmd+D` 已被 `searchKeymap` 的 `Mod-d` 命中并返回 true，后续 handler 不再执行。属预存在代码，本轨未动。 |
| R3 | 测试 | `Ctrl+D` / `Cmd+D` 那两条「modifiers 生效」sanity 断言只证明 `Mod` 解析正确，不区分"哪条绑定命中"（`hit[0]`），判别力弱于注释声称。已由 macos 文件的 `probeOnlyBinding` 双向断言补足。 |

（本节待补：覆盖率数字、裁定 1–5 结论、红→绿复现、E2E 缺口判定。）

---

## 阶段 B · 全量基线（环境恢复过程）

### B.1 三轮实测

| 轮次 | 条件 | Test Files | Tests | EXIT |
|---|---|---|---|---|
| 1（我误用 `--reporter=basic`） | vitest 4 无此 reporter | — | — | 被管道吞成 0 |
| 2 | 协调者补 `src/extensions/*` 后 | **106 failed** / 460 passed (463) | 167 failed / 3522 passed | 1 |
| 3 | **再补 `src/locales/builtinLocales.ts` 后** | **3 failed** / 460 passed (463) | 3 failed / 4583 passed | 1 |
| 3b | 3 个残留单独重跑 | 3 passed (3) | **74 passed** | **0** |

### B.2 根因（三层缺件，**全部是 gitignored codegen，与本轨无关**）

| # | 缺件 | 校验 | 归属 |
|---|---|---|---|
| 1 | `src/extensions/generated.ts`、`generated-pro.ts` | md5 `8ec3dbc6` 与全仓一致 | 协调者已补 |
| 2 | `src/locales/builtinLocales.ts` | **md5 `d7632485e346998191b009d32af7b0a0`，与主检出及 `datazen-pane-layout` 三方逐字节一致** | **我按 `tester.md` 阶段 B 第 2 步跑 `node scripts/generate-builtin-locales.mjs` 自行修复** |
| 3 | `src-tauri/capabilities/default.json` | md5 `dc5eb475c3484dd66b167c8ecc715214` 与主检出一致 | 我补（第三个残留失败的直接原因） |

三者 `git check-ignore -v` 均命中 `.gitignore:73/76`，`git status` 全程无污染。

### B.3 残留 3 个失败的归类（**均未登记为 Bug**）

1. `src/lib/windowCapabilities.test.ts` —— `ENOENT: src-tauri/capabilities/default.json`，缺 codegen（第 3 层缺件），环境问题。
2. `src/stores/__tests__/connectionStore.test.ts` —— `Test timed out in 5000ms`，单独重跑 **4115ms** 通过。
3. `src/stores/__tests__/schemaStore.test.ts` —— 同上，单独重跑 **4175ms** 通过。

第 2/3 条耗时贴脸 5000ms 上限，是**全量并行负载下的临界超时 flake**，不是逻辑失败——
单独重跑 74 tests 全绿、EXIT=0 即为反证。三者均与 `src/components/sql-editor/**` 无关。

### B.4 参照基线对齐

`datazen-pane-layout` 同基座实测为 463 文件 / 4589 用例全绿；
我这里 463 文件 / 4586 用例、零真实失败（3 条 flake 已单跑证伪）。
差异 3 个用例即上述两个 store 文件中被超时的用例，非本轨引入。

> **给协调者的环境建议**：`scripts/new-feature-worktree.sh` 应内置
> 「补齐全部 gitignored codegen」这一步（至少 `src/extensions/*`、
> `src/locales/builtinLocales.ts`、`src-tauri/capabilities/default.json`），
> 否则每个新 worktree 都会重演本次的排查成本。

---

## 裁定 1 · Mod-d 族键名矩阵（**Coder 的矩阵正确，但其两条机理解释错误**）

### 1.1 我的方法（与 Coder 不同）

Coder 用「四条键名同时注册 + `hit[0]`」判定**命中者**。我额外做了**单绑定隔离探针**
（只注册一条，测「是否可达」）与**全绑定探针**（测「谁先命中」）的对照——
只有两者分离，才能区分「结构性不可达」与「被兄弟绑定遮蔽」。这两种情况在修复动作上
含义完全不同：Coder 的结论把二者混为一谈。

### 1.2 实测命中矩阵（四条全部注册，真实浏览器形态 keyCode=68）

| 平台 | 事件 | 命中 | Coder 声称 | 判定 |
|---|---|---|---|---|
| 非 mac | Ctrl+D，key=`d` | `Mod-d` | `Mod-d` | ✅ |
| 非 mac | Ctrl+Shift+D，key=`D` | `Mod-D` | `Mod-D` | ✅ |
| 非 mac | CapsLock Ctrl+D，key=`D` | `Mod-D` | `Mod-D` | ✅ |
| 非 mac | Ctrl+Shift+D，key=`đ`（非 US 布局） | `Shift-Mod-d` | `Shift-Mod-d` | ✅ |
| mac | Cmd+D，key=`d` | `Mod-d` | `Mod-d` | ✅ |
| mac | Cmd+Shift+D，key=`D`/`đ`/`d` | `Mod-D` | `Mod-D` | ✅ |
| mac | CapsLock Cmd+D，key=`D` | `Mod-D` | `Mod-D` | ✅ |

**结论：Coder 的命中矩阵我逐格独立复现成立。** 先前的 Mod-d 裁定（协调者）
确实也被推翻——`Mod-d` 与 `Mod-D` 都活着。

### 1.3 Coder 的机理陈述有误（不影响其处置，但会误导后人）

**错误 1**：「字符键在主查表排除 Shift（`modifiers(name, event, !isChar)`），
所以带 Shift 前缀的键名**根本没机会被查**」

反证就是矩阵第 4 行：非 US 布局下**赢的正是 `Shift-Mod-d`**。
若「带 Shift 前缀的键名根本没机会被查」，那一格根本不可能有赢家。
真实机理是另一条路径——`runHandlers` 的 `base[event.keyCode]` **回退分支**
（`@codemirror/view:9197-9205`）会用 `base[keyCode]`（68 → `d`）重写名字再查。
换言之：不是「永远查不到」，而是「**主查表 miss 之后由回退分支查到**」。

**错误 2**：「非 US 布局下 `Shift-Mod-d` 经 `base[keyCode]` 回退仍会命中，
是真实的**布局安全网**」

实测：**US 布局下 `Shift-Mod-d` 同样可达**（key=`D` + Shift，主查表 `Ctrl-D` miss 后
回退分支查 `Shift-Ctrl-d` 命中）。隔离探针在非 mac 与 mac 上都确认了这点。
它之所以在真实 keymap 里从不成为赢家，是因为主查表先命中了 `Mod-D`——
即它**在所有平台都是冗余绑定**，不只是非 US 布局。这比 Coder 的说法更强，
但方向相同（都是「保留无害」）。

**错误 3**：「macOS 上 `Shift-Mod-d` / `Shift-Mod-D` 才是真死键」

需拆成两句话，隔离探针给出精确答案：
- `Shift-Mod-d` 在 mac 上**并非结构性不可达**——单绑定隔离下可达（key=`d`/`đ`）。
  正确表述是「在真实四绑定 keymap 中被 `Mod-D` 遮蔽」。
- `Shift-Mod-D` 才是在**真实浏览器形态下真不可达**（非 mac、mac 均是）。

**错误 4**：Coder 未发现的一个真实组合——
`keyCode` 缺失 + `event.key` 为非 US 字符 ⇒ **四条全部落空**（实测 NONE）。
真实浏览器恒有 keyCode，故非缺陷；但它正好解释了 `multipleSelections.ts:37-54`
那个 `e.code === 'KeyD'` 兜底 handler 的存在价值（Coder 未提及）。

### 1.4 我对「四条全留、零行为改动」这个处置的独立结论：**支持**

但支撑理由应当换成一个更强的事实：**四条绑定的 `run` 与 `preventDefault` 完全相同**
（都是 `selectNextOccurrence` / `true`）。因此「谁赢」在行为上**不可观测**——
把 `Shift-Mod-d`/`Shift-Mod-D` 删掉，不可能改变任何一次 `Mod-D` 的可观察结果。
「删冗余反而可能在未覆盖平台丢兜底」这个理由其实**并不成立**（因为兜底不会改变行为）；
真正成立的理由是「零回归风险 + 四条本来就不可能产生行为差异」。
建议在 progress.md §4 里把理由改成后者，避免日后有人按「兜底」二字做取舍。

### 1.5 对本轨的影响

**无行为影响。** `multipleSelections.ts` 的 `Mod-d` 族四条绑定本次**一行未改**（见 `git diff`），
本轨只动了 `Shift-Alt-Arrow*` 与复制行。裁定 1 的作用仅是**验证 Coder 的记录没有写错**——
它写对了，故无需处置。

---

## 裁定 3 · copy-line 改键方案（**成立，四个待验点全部通过**）

### 3.1 提权只发生在必要处 ✅

`Prec.high` 块内**只有 `Shift-Alt-ArrowUp/Down` 两条**，其余 10 条仍在正常 `keymap.of`。
我另加两条**回归守卫**测试证明提权没有外溢：

- 挂上多光标扩展后，`Mod-Enter` / `Mod-s` / `Tab` 仍不被误吞，文档不变。
  （查 `src/lib/keymap.ts:20-45`，三个 preset 的 execute/saveQuery 分别是
  `Mod-Enter`/`Mod-r`、`Mod-s`，`toCodeMirrorKeyFormat` 也无法把 `ArrowUp` 变出可用键名
  —— 未知片段会被 `toLowerCase`，且 ArrowUp 拼成 `arrowup` 与绑定名不匹配。
  即：**`Prec.high` 在结构上不可能抢到任何用户自定义快捷键**。）
- `Alt+ArrowUp` 仍走 `defaultKeymap` 的 `moveLineUp`（文档行序改变），
  **没有**被误升权成 `addCursorAbove`。若有人日后把 `Prec.high` 扩大到整个 keymap，这条会红。

### 3.2 macOS 让位测试**不是空转绿** ✅

要求「验证让位测试真能红」，我的做法是构造**反事实世界**：把
`Meta-Shift-ArrowUp → copyLineUp` 放进 `Prec.high`，挂在 `defaultKeymap` 之后，
然后按 `Cmd+Shift+↑`，断言文档变成
`SELECT a\nSELECT b\nSELECT b\nSELECT c`（复制行真的发生了）。

反事实成立 ⇒ `Prec` 确实能压过 `standardKeymap` 的
`{ mac: "Cmd-ArrowUp", run: cursorDocStart, shift: selectDocStart }`
（`@codemirror/commands:1720`）⇒ 因此现有那条
`Cmd+Shift+ArrowUp keeps selecting to the start of the document` 断言
**确实在守护一条对优先级敏感的真实边界**，且实测修复前后都为绿。
我还独立写了一条自己的 mac 让位断言（`selection.from===0 && to===20`，文档不变），
不依赖 Coder 的用例。

### 3.3 四修饰键在**所有**平台都不与既有键冲突 ✅

我把 `@codemirror/commands` 整包 grep 了一遍：
`key: ".*Shift.*Arrow"` 全包**只有 1769/1771 两行**（即 `Shift-Alt-Arrow*`）。

| 组合 | 归一键名 | 冲突检查 |
|---|---|---|
| 非 mac `Alt-Shift-Mod-ArrowUp` | `Shift-Ctrl-Alt-ArrowUp` | `defaultKeymap` 中不存在 ✅ |
| mac `Alt-Shift-Cmd-ArrowUp` | `Shift-Meta-Alt-ArrowUp` | 与 `standardKeymap:1714` 的 `Ctrl-Shift-ArrowUp`（翻页）不同键名，可共存 ✅ |
| 非 mac `Mod-Shift-ArrowUp` | `Shift-Ctrl-ArrowUp` | 全包无此绑定 ⇒ **原本完全空闲** ✅ |

「原本空闲」我用一条专门的测试证明：只挂 `defaultKeymap+historyKeymap+searchKeymap`
（**不挂**多光标扩展，即修复前的世界），按 `Ctrl+Shift+↑`，文档不变、光标仍为 1、
`event.defaultPrevented === false`。这是把「Windows/Linux 上提权/改键不与既有键冲突」
的**前提**真正证出来的，不是推断。

同时发现并记下一条易误解的事实：`Meta-` 是**字面**修饰键、与平台无关，
只有 `Mod-` 随平台展开。所以非 mac 的 `Alt-Shift-Mod-*` 与 mac 变体
`Alt-Shift-Cmd-*` 在同一 keymap 里是两个不同键名，不会互相顶替。
我为此加了正反双向断言，防止日后有人把两者搞混。

### 3.4 一个新增的正向证明

「`Shift-Alt-ArrowUp` 现在归多光标独占」不只要测「现在对」，
还要测「为什么对」。我加了一条对照：把 `Shift-Alt-ArrowUp → addCursorAbove`
放在**正常优先级**、挂 `defaultKeymap` 之后 ⇒ 实测**复制行**（`defaultKeymap` 先注册者胜）。
这从反面证明 `Prec.high` 确实是本次修复生效的唯一原因，而非其它巧合。

---

## 裁定 4 · spec §1 更正（**成立，确认**）

独立核实 `@codemirror/commands@6.10.3` 的 `defaultKeymap`：

```js
// dist/index.js:1769 与 :1771
{ key: "Shift-Alt-ArrowUp",   run: copyLineUp   },
{ key: "Shift-Alt-ArrowDown", run: copyLineDown },
```

**两行均无 `mac:` 字段。** 同一数组内确有写 `mac:` 变体的风格
（`{ key: "Alt-ArrowLeft", mac: "Ctrl-ArrowLeft", ... }`），
而这两条没有 ⇒ `Shift-Alt-*` → copyLine 的冲突在**所有平台**存在。

**裁定：spec §1「非 mac 无冲突、只有 macOS 冲突」是错的，Coder 的更正成立。**
`progress.md` §1 里那条「本节原文说…故只有 macOS 冲突」的修正块可保留。

顺带一条对本轨有利的推论：因为冲突是**全平台**的，所以修复**必须**对所有平台提权，
不能只在 mac 分支加 `mac:` 变体糊过去。Coder 的 `Prec.high` 方案正确地覆盖了全平台。

---

---

## 裁定 2 · 红→绿证据（**完全复现，9 条失败逐条对得上**）

### 2.1 复现方法

只把 `multipleSelections.ts` 回退到 `c37bc0848^`（100 行旧版），
**两个测试文件一字不动**，跑 Coder 的两个文件：

```
Test Files  2 failed (2)
     Tests  9 failed | 11 passed (20)      EXIT=1
```

与 Coder 声称的 `9 failed | 11 passed` **逐格一致**。
（20 = 两个文件 10 + 10；Coder 另报的「72 全绿」= `paste/` 整目录
50 + 2 + 10 + 10，我也独立数到 72，两处数字都对得上。）

回退后 `git diff` 只显示该文件少 55 行、且 `Prec` import 消失；
测试文件零改动。跑完立即 `git checkout c37bc0848 -- <file>` 还原，
**md5 `d47229332966a7331a5addad36aa7939` 与还原前逐字节一致**，
`git status` 无任何 M 状态，该回退态从未进入任何提交。

### 2.2 9 条失败是否**恰好**对应本次修复恢复的能力

| # | 失败用例 | 对应的修复能力 |
|---|---|---|
| 1 | (mac) `Shift-Alt-ArrowUp runs addCursorAbove, not copyLineUp` | `Prec.high` 提权 |
| 2 | (mac) `Shift-Alt-ArrowDown runs addCursorBelow, not copyLineDown` | `Prec.high` 提权 |
| 3 | (mac) `Alt-Cmd-Shift-ArrowUp copies the line up` | 复制行改键（mac 四修饰键） |
| 4 | (mac) `Alt-Cmd-Shift-ArrowDown copies the line down` | 复制行改键（mac 四修饰键） |
| 5 | `Shift-Alt-ArrowUp runs addCursorAbove … under the real mount order` | `Prec.high` 提权 |
| 6 | `Shift-Alt-ArrowDown runs addCursorBelow … under the real mount order` | `Prec.high` 提权 |
| 7 | `journey: add cursors up and down -> backspace … -> single cursor` | 提权后的连续旅程 |
| 8 | `Mod-Shift-ArrowUp copies the line up on non-mac platforms` | 复制行改键（非 mac） |
| 9 | `Mod-Shift-ArrowDown copies the line down on non-mac platforms` | 复制行改键（非 mac） |

**判定：9 条全部落在两项被恢复的能力之内，没有一条越界，也没有一项能力无红可证。**
其中 5/6/7 直接暴露了缺陷本体：旧态下 `Shift-Alt-ArrowUp` 命中 `copyLineUp`，
`ranges` 长度为 1 而非 2（`from: 13`），与 Coder 描述的「光标跳到下一行行首、
`copyLineDown` 吃掉按键」完全吻合——我实测到的失败消息字面就是
`expected [ SelectionRange{ from: 13, …(3) } ] to have a length of 2 but got 1`。

### 2.3 红态下已绿的 11 条（回归保护面）

`sanity: the mac branch is active` / `Alt-Cmd-ArrowUp|Down still adds a cursor` /
`Cmd+Shift+ArrowUp keeps selecting to the start of the document` /
`resolves each Mod-d spelling …`（mac 与非 mac 各一）/ `Cmd+D still selects the next occurrence` /
`selects word on first Mod-D and adds next occurrences on consecutive Mod-D` /
`triggers via keydown event on contentDOM` /
`Alt-Mod-ArrowUp/Down (the non-shift add-cursor chord) still add a cursor` /
`keeps the Mod-d family working end to end`。

Coder 称「Mod-D / Alt-Mod-Arrow* / Cmd+D 控制在红态下已绿」——**已确认**。
这 11 条构成的是「不得回归」面，本次修复没有动它们（实测修复后仍全绿）。

---

## 阶段 C · 覆盖率（**实测数字 + 精确补缺**）

### C.1 闸门外的事实

`vitest.config.ts:42-70` 的 `coverage.include` 列了 36 条 glob/文件，
**`src/components/sql-editor/**` 不在其中**。本轨全部代码在覆盖率闸门外，
所以「测试通过」本身确实不构成覆盖率证据。按协调者要求单独测：

```bash
npx vitest run src/components/sql-editor/paste \
  --coverage --coverage.include='src/components/sql-editor/paste/**/*.ts' \
  --coverage.thresholds.{lines,functions,branches,statements}=0
```

### C.2 补测前的实测数字

| 文件 | Stmts | Branch | Funcs | Lines | 未覆盖行 |
|---|---|---|---|---|---|
| **`multipleSelections.ts`（本轨文件）** | **70.00** | **26.31** | **50.00** | **70.00** | 30-36, 52 |
| `parseDelimitedValues.ts` | 95.08 | 92.85 | 100 | 94.11 | 53-54, 58 |
| `contextMenuItems.ts` | 100 | 100 | 100 | 100 | — |
| `createPasteExtensions.ts` | 0 | 0 | 0 | 0 | 25-35 |

**70% 低于 80% 闸门，26.31% 分支远低于 75% 闸门。协调者的担忧成立。**

### C.3 但缺口不在本轨改动上 —— 这点必须说清

`git diff c37bc0848^ c37bc0848 -- multipleSelections.ts` 只有两个 hunk：

```
@@ -9,10 +9,10 @@      ← import：加 Prec、加 copyLineUp/copyLineDown
@@ -85,16 +85,71 @@    ← keymap 改键 + Prec.high 块
```

未覆盖的 **30-36、52 行**在 `c37bc0848^` 的同号文件里逐字相同（行号也一样），
即 **`eventFilter`、`clickAddsSelectionRange`、`domEventHandlers` 的 `return false`
全部是本轨未触碰的既有代码**。本轨自己新增/改写的 85-155 行**原本就是 100% 覆盖**。

### C.4 精确补缺（只补未覆盖分支，不追数量）

`eventFilter` 不需要布局就能测——它并不决定选区类型，而是喂给
`EditorView.mouseSelectionStyle`（`@codemirror/view:10173-10176`：
`filter(event) ? rectangleSelectionStyle(view, event) : null`），
所以可以从 facet 里原样取出直接调用。
（我先试过真实拖拽 + `instanceof RectangleSelection`，jsdom 下因 `posAtCoords` 无布局而失败；
又发现 `RectangleSelection` 是内部类、**既未导出也不在 `.d.ts` 里**——
`require('@codemirror/view').RectangleSelection === undefined`。facet 探针是可行路径。）

新增 7 条测试，落在 6 个此前零测试的执行路径上：

1. `clickAddsSelectionRange` 判定 5 个组合（alt / alt+shift / 无 / shift / meta）
2. `eventFilter` 放行 Option 拖拽、挡下无修饰 / Shift / Meta
3. `eventFilter` 第二个条件（`button!==0 且 buttons!==1` 被挡；`button===0` 或 `buttons===1` 放行）
4. `eventFilter` 三析取项的 8 组合穷举
5. keydown 兜底：非 D 键（用 F5，避开 `Mod-a → selectAll`）不 preventDefault
6. keydown 兜底：带 Alt 的 D 键被 `!e.altKey` 挡下
7. `selectNextOccurrence` 落空时 `KeyBinding.preventDefault` 仍生效

### C.5 补测后的实测数字

| 文件 | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| **`multipleSelections.ts`** | **100.00** | **94.73** | **100.00** | **100.00** |
| `parseDelimitedValues.ts` | 95.08 | 92.85 | 100 | 94.11 |
| `contextMenuItems.ts` | 100 | 100 | 100 | 100 |
| `paste/` 目录合计 | 90.00 | 91.13 | 84.61 | 88.57 |

**`multipleSelections.ts` 四项全部超过 80% 闸门，剩余 5.27% 分支是下节证明的不可达死臂。**
`createPasteExtensions.ts` 的 0% 与本轨无关（本轨未触碰该文件）。

### C.6 补缺过程中发现的两个既有事实（**非本轨缺陷，建议知会但不修**）

**(1) `eventFilter` 的三个析取项里有两个是静态死臂。**

```ts
(e.altKey || (e.altKey && e.shiftKey) || (e.metaKey && e.altKey)) && (e.button === 0 || e.buttons === 1)
```

第 2 项要求 `altKey` 为真，但它**只在第 1 项为假（即 `altKey` 为假）时才会被求值** ⇒ 恒假。
第 3 项要求 `altKey` 为真，同样只在前两项为假时求值 ⇒ 恒假。
所以整个析取式**恒等于 `e.altKey`**。我用 8 组合穷举把它钉死了。

这不是「漏测」，是**不可达**——也正是 branch 覆盖率长期停在 26% 的真正原因。
**处置建议：不在本轨修**（本轨只测不改，且这是既有代码）。
建议登记为一条独立的清理项，因为那三个析取项会让人误以为
「Cmd+Option 拖拽有额外支持」，而实际上 Option 已经涵盖了它。

**(2) `KeyBinding.preventDefault: true` 与命令返回值无关。**

`@codemirror/view:9189-9193` 的 `runFor` 里：

```js
if (binding.preventDefault) { if (binding.stopPropagation) stopPropagation = true; prevented = true; }
```

这段在 `cmd(view)` 的返回值判断**之外**，即无条件置位。实测确认：
光标停在空行末尾时 `selectNextOccurrence` 确实返回 `false`，
但 `Ctrl+D` 依然被 `preventDefault`。

所以 `multipleSelections.ts:46-50` 里那个
`if (handled) { e.preventDefault(); ... }` 的 `preventDefault` 其实是**冗余**的
（keymap 那边已经无条件挡了）；它真正的价值在于 `e.stopPropagation()` 与
`return true`——即在 keymap 之前抢先处理，从而**不依赖 keymap 的优先级胜负**。
Coder 从未解释这个兜底 handler 存在的理由，我的测试把它的实际作用测了出来。
（这恰好也解释了裁定 1.3 里那个 `keyCode` 缺失 + 非 US 字符的空洞为何可被兜住。）

---

## 裁定 5 · 两处自陈缺口（**独立判定**）

### 5.1 jsdom 无布局 ⇒ 只断言光标数与文档不变

**判定：可接受，但「真实浏览器落在相邻行同列」这一条必须补 E2E/手工清单。**

我复核了论据本身：`view.moveVertically` 在无布局下退化到文档首尾，
所以位置断言是假象——**这一点成立**，Coder 没有夸大。
`addCursor*` 与 `copyLine*` 的真正分界是**文档有没有变**，
`Doc unchanged` 才是有效断言，这点他们的取舍是对的。

但取舍有代价，而取舍本身没有闭环：

- 单测能证明的是：`Shift-Alt-Arrow*` 命中 `addCursor*` **而非** `copyLine*`。
- 单测**证明不了**的是：真实浏览器里用户看到的「光标出现在上一行同一列」是否符合预期。
- AGENTS.md《交互与补全开发原则》要求「连续旅程测试……断言每一步的状态跃迁」。
  位置恰是状态跃迁的一部分。现有 journey 测试（加光标→再加→退格→收敛）
  覆盖了**数量**的跃迁，**位置**这一维在单测层面被主动放弃了。

**处置建议（不扩大本轨范围）：**
把「`Shift-Alt-ArrowUp/Down` 在真实浏览器里把光标加到上一行/下一行**同列**」
写进既有的**手工黑盒清单**（`test/` 目录），作为一条手工验收项。
这比硬塞进 E2E 更诚实：E2E 要真跑 Tauri 二进制 + 真实布局，成本远大于收益，
而这是一次性人工确认即可覆盖的维度。**当前 `progress.md` 未见这条手工登记，
建议补上，否则这个缺口实际是悬空的。**

### 5.2 E2E 覆盖不了的论证

**判定：理由成立，但不接受「只留单测 + 手工清单」作为终点。**

Coder 给的两条理由我逐条独立验证：

**(1)「本轨改的是 `runHandlers` 内部的优先级决定，在 contentDOM 上不留痕迹，
E2E 拿不到 `view.state`」——成立。**
`Prec.high` 改变的是 facet 顺序，最终产物是一个普通的 `EditorSelection`，
DOM 上只体现为 `.cm-selectionBackground` 元素的个数与位置。
E2E 确实只能数 DOM 节点，而数节点既脆弱又不直接。

**(2)「webdriver 派发 Alt+Shift+方向键跨平台不稳定」——部分成立。**
Windows 上 Alt+方向键会触发系统级「窗口移动」快捷键，
macOS 上 Option+方向键可能被输入法拦截。**跨平台不稳定是真的。**

但论证不完整，缺了关键一步：

**单测能覆盖的部分，E2E 本来就不该覆盖；而 E2E 唯一不可替代的能力，
恰恰是「真实布局下的位置」，而这正是 5.1 承认的那个缺口。**
换句话说——Coder 用「E2E 覆盖不了优先级」证明 E2E 不必要，
可 E2E 真正不可替代的那件事（位置）恰恰被单测放弃了。
**两个论证合起来留下了一个没人负责的洞：真实布局下的光标位置。**

这不构成 Bug（代码本身是对的，我已证明按键分流正确），
但**不能以「E2E 覆盖不了」结案**。我的建议与 5.1 一致：
以**一条手工黑盒验收项**兜住位置维度，并在 `progress.md` 里
把「E2E 不覆盖」的结论限定为「**优先级分流不纳入 E2E**」，
而不是笼统的「E2E 覆盖不了本轨」——后者会误导后来者以为本轨已有 E2E 保障。

---

---

## 裁定 6 · 连续旅程测试（AGENTS.md 硬性要求）

本轨改的是**键位优先级**，按 AGENTS.md《交互与补全开发原则》属于
「交互与编辑器逻辑」，必须写**模拟击键全过程的连续状态机测试（涵盖残缺中间态）**。

核查 `multipleSelections.test.ts:233-273` 的 journey 用例，它**达标**：

| 阶段 | 动作 | 断言 | 状态机要素 |
|---|---|---|---|
| ENTER | `Option+Shift+↓` | `ranges` 1→2，`doc` 不变 | 进入条件 |
| STAY | `Option+Shift+↑` | `ranges` 2→3，`doc` 不变 | 状态内行为（可重入） |
| EDIT | `Backspace` ×1 | `ranges` 仍 3，`doc.length` 变小 | 跨全光标生效 |
| EDIT | `Backspace` ×(len+4) | `doc.length === 0` | 退化到边界 |
| EXIT | — | `ranges` → 1，`empty`，`head === 0` | **退出跃迁** |

三要素齐备，且覆盖了 2 光标 / 3 光标 / 文档半空 / 文档全空四个中间态。
用 `for` 循环连打到文档清空再断言收敛回单光标，是真正的「残缺中间态」处理，
不是只测静态合法按键。**判定：满足 AGENTS.md 要求。**

补一条我自己的观察（不构成缺陷）：该 journey 只走了 `addCursor*` 分支，
没有把改键后的 `Mod-Shift-ArrowDown`（复制行）纳入同一条旅程。
两者已分别被独立用例覆盖，故不要求合并；仅记录，供后续轨道参考。

---

## 阶段 D · 最终判定

### D.1 全量复跑（终态）

```
npx vitest run
Test Files  465 passed (465)
     Tests  4621 passed (4621)
EXIT=0
```

| 对比 | 文件 | 用例 |
|---|---|---|
| 环境修复后基线 | 463 | 4586（含 3 条 flake，已单跑证伪） |
| 终态（含我新增 2 文件 35 用例） | **465** | **4621** |
| 差值 | +2 | +35（我的 tester 探针 24 + mac 探针 11） |

**零失败、零新增失败。** 第 3 轮那 3 条 flake 在本轮未复现，
与「并行负载下 4115ms / 4175ms 逼近 5000ms 上限」的解释一致。
`npx tsc --noEmit` 干净（0 输出，EXIT=0，测试文件参与类型检查）。

### D.2 五项裁定的结论

| 裁定 | 结论 | 是否需要处置 |
|---|---|---|
| 1 Mod-d 矩阵 | **命中矩阵正确**；但 4 条机理陈述有误 | 文档更正（非代码） |
| 2 红→绿 | **9 failed / 11 passed 精确复现**，9 条逐条对应两项被恢复能力 | 无 |
| 3 copy-line 改键 | 提权精准、让位测试**非空转绿**（我做了反事实）、四修饰键全平台不冲突 | 无 |
| 4 spec §1 更正 | **确认成立**（`commands:1769/1771` 无 `mac:` 变体） | 无 |
| 5 两处缺口 | 单测取舍**可接受**；E2E 论证成立但不完整，留下「真实布局位置」无人负责 | 补一条手工验收项 |

外加 6 连续旅程测试：**达标**。

### D.3 变更范围复核（应协调者要求）

`c37bc0848` 只动 3 个文件：`multipleSelections.ts`(+55)、
`multipleSelections.test.ts`(+293)、`multipleSelections.macos.test.ts`(新增 269)。
**未触碰** `editorExtensions.ts` / `SqlEditor.tsx` / `e2e/` / i18n / `hub.md` —— 逐项核对通过。
「修复必须留在 `multipleSelections.ts` 内、不得搬到 `editorExtensions.ts`」的架构约束被遵守。

### D.4 Bug 登记

**本轮登记 0 个 Bug。**

`progress.md` 的状态机里没有缺陷需要流转——不是因为我放宽了标准，
而是逐条查证后**没有找到任何代码缺陷**：
按键分流正确、优先级正确、四个平台分支正确、改动范围未越界、
覆盖率补缺后四项全部过闸、全量零回归。

我记录了 3 项**非代码**问题，均不进 Bug 流转：

1. **文档更正（建议 Coder 处理）**——`progress.md` §实现记录与 `c37bc0848` 的
   commit message 都写了「`Shift-Mod-d` **仅**在非 US 布局经 `base[keyCode]` 回退时命中」，
   实测**不成立**（US 布局下同样可达，只是被 `Mod-D` 遮蔽）。
   这已固化进 git 历史，建议在 `progress.md` 补一条更正。
   处置结论（四条全留、零行为改动）**不受影响**。
2. **手工验收项缺口**——现有手工清单（`progress.md:341-342`）只写了
   「`Option+Shift+↑/↓` 应新增光标而不复制行」等**按键分流**，
   没写「光标落在**相邻行同列**」这一**位置**维度。
   而位置恰好是单测主动放弃、又是 E2E 覆盖不了的唯一维度。
   建议补一条 `test/` 手工黑盒验收项。
3. **既有代码清理建议（不在本轨修）**——`eventFilter` 的三个析取项里
   恒等为 `e.altKey`（见 C.6(1)，已用 8 组合穷举钉死）。
   会让人误以为「Cmd+Option 拖拽有额外支持」。属既有代码，本轨只测不改。

### D.5 判定

# TEST_DONE

未写 `PASSED`。
