# 轨道 multi-cursor · 多光标键位解遮蔽

- **状态**: TEST_DONE
- **分支**: `feature/multi-cursor`
- **Worktree**: `.worktrees/datazen-multi-cursor`
- **基准**: `feature/editor-productivity` @ `9a9027531`
- **Pro 仓**: 不涉及（纯宿主侧）
- **实现提交**: `c37bc0848`（3 files, +612/−17）
- **测试报告**: [`tester-report.md`](./tester-report.md)（独立 Tester，0 个 Bug）

## 目标

让 SQL 编辑器的多光标键位真正生效。当前存在**已确证的死键**：作者写了 `Shift-Alt-ArrowUp/Down → addCursorAbove/Below`，
但在真实挂载顺序下永远抢不到按键，macOS 上被 CodeMirror `defaultKeymap` 的 `copyLineUp`/`copyLineDown` 吃掉。

## 已实证机制（不要重新推翻，也不要当作假设）

### 1. 冲突确证

`src/components/sql-editor/paste/multipleSelections.ts:88-97` 注册：

```ts
{ key: 'Shift-Alt-ArrowUp', run: addCursorAbove, preventDefault: true },
{ key: 'Shift-Alt-ArrowDown', run: addCursorBelow, preventDefault: true },
```

而 `@codemirror/commands` 的 `defaultKeymap` 把 `Shift-Alt-ArrowUp` / `Shift-Alt-ArrowDown`
绑到 `copyLineUp` / `copyLineDown`。

> **修正（本轨实测推翻本节原结论）**：本节原文说「非 mac 上是 `Alt-ArrowUp`，故 `Shift-Alt-*`
> 只有 macOS 冲突」。实测 `node_modules/.pnpm/@codemirror+commands@*/dist/index.js:1765-1789`
> 的 `defaultKeymap` 中，`{ key: "Shift-Alt-ArrowUp", run: copyLineUp }` 与
> `{ key: "Shift-Alt-ArrowDown", run: copyLineDown }` **没有任何 `mac:` 变体**，
> 即 `Shift-Alt-*` → copyLine 的冲突在**所有平台**都存在，不只是 macOS。

### 2. 遮蔽确证（关键，别搞错方向）

`src/components/sql-editor/SqlEditor.tsx:349` 起的扩展数组顺序是：

1. `...createBaseEditorExtensions(...)` —— 内部 `editorExtensions.ts:262-288` 自定义 keymap、
   `editorExtensions.ts:289` `keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap])`
2. `...createSqlExtensions({...})`
3. `compartments.statement.of(...)` …
4. `compartments.paste.of(pasteExts)` —— **多光标 keymap 在这里**

CodeMirror 6 的 keymap 语义是**同一优先级下先注册者胜**。`pasteExts`（经
`createPasteExtensions()`，`createPasteExtensions.ts:35` `[...multiCursor, ...enhancedPaste]`）
排在 `defaultKeymap` **之后**，所以 `defaultKeymap` 先注册 ⇒ 抢先命中 ⇒ 多光标那两个绑定是死键。

`editorExtensions.ts:261` 已有注释「Custom keymaps FIRST so they override defaultKeymap's Mod-Enter etc.」，
说明作者清楚这个优先级机制，只是多光标的 keymap 放错了层。

### 3. 疑似同样失效的绑定（需你**实测**判定，不要照抄本节结论）

`multipleSelections.ts:55-97` 共 6 条 keymap 绑定：`Mod-d`、`Mod-D`、`Shift-Mod-d`、
`Alt-Mod-ArrowUp/Down`(+mac 变体 `Alt-Cmd-ArrowUp/Down`)、`Shift-Alt-ArrowUp/Down`。
其中 `Mod-D` 与 `Shift-Mod-d` 的键名大小写在 CodeMirror 的 `keyName` 归一化下是否真能命中，
**必须用真实 EditorView + 真实 KeyboardEvent 实测**，不要凭读源码下结论。若确实恒不命中，一并处理并记证据。

### 4. 零测试覆盖

`src/components/sql-editor/paste/__tests__/multipleSelections.test.ts` 现有 2 个用例，
只覆盖 `Mod-D`（且是**直接调 `selectNextOccurrence(view)`**，绕过 keymap 分发），
**没有任何用例**把 `defaultKeymap` 一起挂进扩展数组。所以死键从未被测出来。

## 改动范围（严格）

| 文件 | 允许的改动 |
|---|---|
| `src/components/sql-editor/paste/multipleSelections.ts` | 主体修复 |
| `src/components/sql-editor/paste/__tests__/multipleSelections.test.ts` | 补 journey 测试 |
| `e2e/specs/sql-editor-productivity.ts` | 仅当新增 E2E 用例；先在 §E2E 登记 |

**不在本轨范围**（越界即 BUG）：

- `src/components/sql-editor/editorExtensions.ts` —— **其他在跑轨道持有此文件**。
  修复**必须**在 `multipleSelections.ts` 内用 CodeMirror 的 `Prec` 机制完成，
  **禁止**把绑定搬到 `editorExtensions.ts` 的自定义 keymap 块里（那是绕过既有架构，不是修复）。
- `src/components/sql-editor/SqlEditor.tsx` —— 同上，其他在跑轨道持有。
- `packages/extension-points/**`、`packages/pro-extensions/**`、`src/stores/**`、任何设置项。

## 验收标准（逐条自证）

1. **先红后绿**：动手前先写一个**失败**的测试证明死键存在 —— 构造含 `defaultKeymap` 的 `EditorState`，
   按真实顺序（`defaultKeymap` 在前、多光标 keymap 在后）派发 `Shift-Alt-ArrowUp` 的真实
   `KeyboardEvent`，断言当前行为**不是** `addCursorAbove`。修复后同一测试转绿。**必须贴出红与绿两次实跑输出。**
2. **真按键分发**：测试必须经由 `view.contentDOM.dispatchEvent(new KeyboardEvent(...))` 走真实 keymap 分发，
   **禁止**直接调 `addCursorAbove(view)` 绕过 keymap（现有测试正是这个毛病）。macOS 上需用
   `mac: 'Shift-Alt-ArrowUp'` 对应的实际事件组合，并在注释中说明模拟的是 mac 分支。
3. **连续旅程测试**（AGENTS.md 硬性要求）：模拟连续击键过程并断言每一步的选区跃迁与退出，
   至少覆盖「加光标 → 再加 → 退格全部内容 → 选区回落为单光标」的完整状态机。
4. **不得误伤合法同类**（AGENTS.md 三维自查第 2 条）：`copyLineUp/Down` 是既有合法能力。
   让多光标抢占 `Shift-Alt-ArrowUp/Down` 后，**必须**为复制行另保留一个不冲突的绑定
   （建议 `Mod-Shift-ArrowUp/Down`，与 VS Code 在 macOS 上的 copy-line-up 一致），
   并为它补测试。若你认为直接放弃复制行更合适，必须在 progress.md 写明理由交协调者裁决，
   **不要**默默丢掉这个能力。
5. **回归**：`Mod-d` 系列与其他既有绑定行为不变；`Alt-Mod-ArrowUp/Down` 仍能加光标。
6. **全绿**：`npx vitest run src/components/sql-editor/paste/__tests__/multipleSelections.test.ts` 全过，
   且 `npx vitest run` 全量无新增失败。
7. **类型**：`pnpm --config.verify-deps-before-run=false typecheck` 干净（见下方环境陷阱）。
8. **单文件规模**：`multipleSelections.ts` 不得膨胀超过 ~200 行；测试文件超过 ~400 行请拆分。

## 已知陷阱

1. **本 worktree 的 `node_modules` 是指向主检出的软链。** 直接 `pnpm <script>` 会触发 pnpm 11 的
   `verify-deps-before-run`，它试图 `pnpm install` 清掉 modules 目录，无 TTY 时报
   `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。
   **严禁**用 `CI=true` 或 `confirmModulesPurge=false` 绕过 —— 那会**真的删掉主检出的 node_modules**。
   安全命令：`pnpm --config.verify-deps-before-run=false typecheck`，或直接用 `npx`。
2. **一律禁止 `pnpm install`**（本项目纪律）。
3. 本轨不碰 Pro 仓，不需要 `node scripts/resolve-pro.mjs`。

## E2E 登记

`e2e/specs/sql-editor-productivity.ts` 现有 `SE-PROD-020/021/022/030/031/040`，
**零** `Shift-Alt-Arrow` 相关用例。

- 若你新增 E2E 用例，在此登记：编号、目标、运行命令 `pnpm e2e:qb` 或 `pnpm e2e:pro:sql-editor`。
- 若因 E2E 需真实 webdriver binary 而本轨无法实跑，**照常登记并标注「留待 R 回归」**，不要因此放弃 E2E 编写。
- 键盘快捷键在 E2E 中的可用性：若 webdriver 在该平台无法稳定派发带修饰键的按键，
  明确写出「E2E 不可覆盖，仅单测覆盖」的理由。

## 自验套件

```bash
npx vitest run src/components/sql-editor/paste/__tests__/multipleSelections.test.ts
npx vitest run                                   # 全量，确认零新增失败
pnpm --config.verify-deps-before-run=false typecheck
```

---

# 实现记录（提交 `c37bc0848`）

## 改动文件

| 文件 | 性质 | 行数变化 |
|---|---|---|
| `src/components/sql-editor/paste/multipleSelections.ts` | 修改（主体修复） | 100 → 155（+55） |
| `src/components/sql-editor/paste/__tests__/multipleSelections.test.ts` | 修改（补回归 + 旅程 + 键名探针） | 119 → 390（+271） |
| `src/components/sql-editor/paste/__tests__/multipleSelections.macos.test.ts` | 新增（macOS 分支模拟） | 0 → 269 |

合计 `3 files changed, 612 insertions(+), 17 deletions(-)`。
**未触碰** `editorExtensions.ts`、`SqlEditor.tsx`、`e2e/`、任何 i18n 文件、`hub.md`。

### 修复结构（严格限定在 `multipleSelections.ts` 内）

1. 把 `Shift-Alt-ArrowUp/Down → addCursorAbove/addCursorBelow` 从普通 `keymap.of([...])` 里**拆出来**，
   单独放进 `Prec.high(keymap.of([...]))`。
   - 提权范围**只有这两条**。若把整个 keymap 提权，会一并盖过 `editorExtensions.ts` 里用户自定义的
     执行/保存/Tab 快捷键——那是本轨的「误伤」。拆开是关键。
2. 复制行另找出路（见下方验收标准 4）。
3. `Mod-d` 族四条绑定**原样保留**，零行为改动。

> 踩坑记录：`Prec` 从 **`@codemirror/state`** 导出，不在 `@codemirror/view`。
> 从 view 导入会得到 `undefined`，运行时报 `Cannot read properties of undefined (reading 'high')`。

## 验收标准逐条核对结果

### 1. 先红后绿 —— 已自证

**红**（把 `multipleSelections.ts` 回退到 HEAD、测试文件保持不动）：

```
$ npx vitest run src/components/sql-editor/paste/__tests__/multipleSelections.test.ts \
    src/components/sql-editor/paste/__tests__/multipleSelections.macos.test.ts

 FAIL  ... > Shift-Alt-ArrowUp runs addCursorAbove instead of copyLineUp under the real mount order
AssertionError: expected [ SelectionRange{ from: 12, …(3) } ] to have a length of 2 but got 1
- Expected
+ Received
- 2
+ 1
 ❯ src/components/sql-editor/paste/__tests__/multipleSelections.test.ts:184:43

 FAIL  ... > Shift-Alt-ArrowDown runs addCursorBelow instead of copyLineDown under the real mount order
AssertionError: expected [ SelectionRange{ from: 13, …(3) } ] to have a length of 2 but got 1
 ❯ src/components/sql-editor/paste/__tests__/multipleSelections.test.ts:196:43

 Test Files  2 failed (2)
      Tests  9 failed | 11 passed (20)
```

红灯里 9 个失败用例：`Shift-Alt-ArrowUp/Down`（非 mac 2 个 + mac 2 个）、`journey`、
`Mod-Shift-ArrowUp/Down`（非 mac 2 个）、`Alt-Cmd-Shift-ArrowUp/Down`（mac 2 个）——即
**本轨修复要恢复的全部能力**。`Mod-D`、`Alt-Mod-Arrow*`、`Cmd+D` 等对照组在红灯下即已全绿，
反证它们**本来就没坏**，修复也没有动它们。

注意 Down 的红灯是 `from: 13`——光标跳到了下一行行首，正是 `copyLineDown` 吃掉了按键。

**绿**（同一套测试，源码为修复后版本）：

```
$ npx vitest run src/components/sql-editor/paste

 ✓ src/components/sql-editor/paste/__tests__/parseDelimitedValues.test.ts (50 tests) 73ms
 ✓ src/components/sql-editor/paste/__tests__/contextMenuItems.test.ts (2 tests) 4ms
 ✓ src/components/sql-editor/paste/__tests__/multipleSelections.macos.test.ts (10 tests) 786ms
 ✓ src/components/sql-editor/paste/__tests__/multipleSelections.test.ts (10 tests) 744ms

 Test Files  4 passed (4)
      Tests  72 passed (72)
   Duration  2.49s
```

### 2. 真按键分发 —— 满足

所有按键断言都经 `view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {...}))`，
**没有任何一处**直接调 `addCursorAbove(view)` 绕过 keymap。挂载顺序复刻真实编辑器：
`keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap])` 在前，`createMultipleSelectionsExtension()` 在后。

macOS 分支的模拟方式在 `multipleSelections.macos.test.ts` 文件头注释中写明：
`@codemirror/view` 的 `browser.mac` 在**模块求值期**由 `navigator.platform` 决定，jsdom 下
`navigator.platform` 为空 ⇒ `currentPlatform === 'key'` ⇒ `Mod` 会退化成 `Ctrl`。
故用 `vi.hoisted()`（会被提升到所有 `import` 之前）把 `navigator.platform` 打成 `MacIntel`，
`afterAll` 还原。mac 分支的事件组合为 `metaKey` + `altKey` + `shiftKey`（Option+Cmd+Shift+↑↓）。
文件内另有一条**判别性** sanity 用例：只注册 `Mod-d` 一条绑定，Cmd+D 必须命中（证明 Mod=Cmd）、
Ctrl+D 必须落空（否则说明平台桩没生效）。第一版这条用例是假通过（同时注册 `Mod-d`+`Ctrl-d`
时两个平台结果相同），已重写。

### 3. 连续旅程测试 —— 已覆盖

`journey: add cursors up and down -> backspace through the whole doc -> single cursor`，
五步断言全链路：进入（`Alt+Shift+↓` 加光标）→ 态内（`Alt+Shift+↑` 再加，共 3 个光标，
文档仍不变）→ 态内编辑（一次 Backspace 应用到全部光标，3 个光标存活）→ 持续编辑删空
→ 退出（`doc.length === 0`，选区**收敛回单个空光标** `head === 0`，回到旅程起点状态）。

### 4. 不得误伤合法同类 —— copy-line 保留，且有测试

多光标抢占 `Shift-Alt-ArrowUp/Down` 后，复制行的新入口：

| 入口 | 平台 | 优先级 | 依据 |
|---|---|---|---|
| `Mod-Shift-ArrowUp/Down` | Windows/Linux | **正常**（不提权） | 实测该组合键在非 mac 上原本无任何绑定，Ctrl+Shift+↑/↓ 空转 |
| `Cmd+Shift-ArrowUp/Down` | macOS | 保持让位 | `standardKeymap` 已占用为 `selectDocStart/End`，不可抢占 |
| `Alt-Shift-Mod-ArrowUp/Down`（Cmd+Opt+Shift+↑↓） | macOS | 正常 | 实测 mac 上已无空闲的两修饰键方向键组合，用四修饰键兜底 |

**为什么 `Mod-Shift-ArrowUp/Down` 在 macOS 上不提权**：macOS 上它是 `Cmd+Shift+↑`
= `selectDocStart`（CodeMirror `standardKeymap` 的 `{ mac: "Cmd-ArrowUp", shift: selectDocStart }`），
这是一个 mac 原生手势。若提权抢占，就违反 AGENTS.md「三维影响度自查」第 2 条。测试
`Cmd+Shift+ArrowUp keeps selecting to the start of the document (not copy line)`
**在修复前后都是绿的**，正是为了守住这条不误伤的边界。

三条入口全部有真实按键测试：
- `Mod-Shift-ArrowUp copies the line up on non-mac platforms` → `"SELECT a\nSELECT b\nSELECT b\nSELECT c"`
- `Mod-Shift-ArrowDown copies the line down on non-mac platforms` → `"SELECT a\nSELECT a\nSELECT b\nSELECT c"`
- `Alt-Cmd-Shift-ArrowUp/Down (the free mac chord) copies the line up/down`（同上两个期望字符串）

**未放弃复制行**，无需协调者裁决。

### 5. 回归 —— 已覆盖

- `Mod-d` 族：见下方专项实测，**四条绑定全部原样保留**，行为零变化。
- `Alt-Mod-ArrowUp/Down`（含 mac 变体 `Alt-Cmd-ArrowUp/Down`）：4 个用例，红灯下即绿，
  修复后仍绿——证明 `Prec` 提权没有波及它们。
- `copyLineUp/Down` 本身：见标准 4。

#### `Mod-d` / `Shift-Mod-d` 专项实测（真实 EditorView + 真实 KeyboardEvent，探针法）

做法：注册一个**只含这四条键名**的探针 keymap，每条绑定带一个 spy 命令记录命中者，
再用真实 `KeyboardEvent` 派发。结果如下（**推翻了协调者先前「第 1 条裁定」**）：

**非 mac 分支**（jsdom，`Mod` ≡ `Ctrl`）：

| 事件 | 命中 |
|---|---|
| `Ctrl+D`（`key:'d'`, `keyCode` 省略） | `Mod-d` |
| `Ctrl+Shift+D`（`key:'D'`, `shiftKey:true`） | `Mod-D` |
| `Ctrl+D` 且 CapsLock（`key:'D'`, 无 Shift） | `Mod-D` |
| `Ctrl+Shift+D`，非 US 布局（`key:'đ'`, `keyCode:68`） | **`Shift-Mod-d`** |

**macOS 分支**（`navigator.platform = MacIntel`，`Mod` ≡ `Cmd`）：

| 事件 | 命中 |
|---|---|
| `Cmd+D`（`key:'d'`） | `Mod-d` |
| `Cmd+Shift+D`（`key:'D'`） | `Mod-D` |
| `Cmd+Shift+D`，非 US 布局（`key:'đ'`, `keyCode:68`） | `Mod-D` |

**结论（与先前裁定相反，务必采信实测）**：

- 真正**恒不命中**的是 `Shift-Mod-d` 与 `Shift-Mod-D`，**不是** `Mod-D` / `Shift-Mod-d`。
  `Mod-d`（普通 Ctrl/Cmd+D）与 `Mod-D`（带 Shift 的 Ctrl/Cmd+Shift+D）**都是活的**。
- 机理：字符键在 `runHandlers` 的主查表里**排除 Shift**（`modifiers(name, event, !isChar)`），
  所以 `{key:'D', shiftKey:true}` 解析成 `Mod-D` 而**不是** `Shift-Mod-D`；某条绑定一旦在
  主查表命中，带 Shift 前缀的键名**根本没机会被查**。
- 非 mac 上 `Shift-Mod-d` **不是死键**：它只在非 US 布局（物理 D 键上报其它字符）、
  经 `w3c-keyname` 的 `base[keyCode]` 回退时才命中——是一条真实的**布局安全网**。
- macOS 上 `Shift-Mod-d` / `Shift-Mod-D` 才是真死键：`w3c-keyname@2.2.8` 对
  `Cmd+Shift+<字符>` **忽略 `event.key`、改读 `shift[event.keyCode]`**，于是永远解析成 `Meta-D`，
  被 `Mod-D` 先吃掉。
- 附带发现：`EditorView.domEventHandlers` 里那条 `Mod+D` 处理器直接判 `e.metaKey || e.ctrlKey`
  而不经过 `keyName` 归一化，在 macOS 上是 Cmd+Shift+D 的**兜底**，行为一致。
- **处置：四条绑定全部保留，零行为改动 = 零回归风险。** 冗余条目无害，
  贸然删除反而可能在某个未覆盖的平台/布局上丢掉兜底。

### 6. 全绿 —— 分两层如实汇报

- 本轨范围：`npx vitest run src/components/sql-editor/paste` → **4 files / 72 tests 全绿，0 失败**。
- 全量 `npx vitest run`：**174 failed | 287 passed (461 files)，248 failed | 2682 passed (2930 tests)**。

  这批全量失败**与本轨无关**，根因已定位：worktree 内 `src/extensions/` 为空目录，
  codegen 产物 `src/extensions/generated.ts`、`generated-pro.ts`、
  `src/locales/builtinLocales.ts` 不存在，报
  `Failed to resolve import "../extensions/generated" from "src/lib/databaseTypes.ts"`。
  这些文件由 `pnpm install` / `resolve-drivers.mjs` 生成，而本轨**禁止** `pnpm install`。
  失败文件清单里**没有任何一个**位于 `src/components/sql-editor/paste/`。
  全量基线交由独立 Tester 在已执行 codegen 的环境复核。

### 7. 类型 —— 本轨 0 错

`npx tsc --noEmit` 退出码 2，共 28 行错误，逐条核对后：
**指向本轨 3 个文件的错误 0 条**（已修掉 macos 测试里 3 处 `EditorView` 被当类型用的
TS2749 —— 动态 `await import()` 得到的是值不是类型，改用 `import type { EditorView as EditorViewType }`，
该 type-only import 编译期擦除，不会触发 `vi.hoisted` 要抢在前面那次模块求值）。

剩余 28 条全部是 `Cannot find module '../../../extensions/generated'` 一类 codegen 缺失，
外加 3 条无关文件里的 `implicitly any`（`src/locales/locales.test.ts`、
`src/windows/settings/DriverSettingsSection.tsx`、`SettingsContent.tsx`）——本轨从未触碰。

### 8. 单文件规模 —— 满足

- `multipleSelections.ts` = **155 行** ≤ 200。
- 测试文件已按第 8 条拆分：`multipleSelections.test.ts` = 390 行（非 mac，**未超 400**），
  macOS 分支独立为 `multipleSelections.macos.test.ts` = 269 行。两者合计 659 行 > 400，
  故按平台拆分而非堆在单文件。

## E2E 登记（补）

**本轨未新增 E2E 用例**，理由如下（按 spec §E2E 要求写出「E2E 不可覆盖，仅单测覆盖」及其理由）：

- 本轨改的是 **CodeMirror keymap 优先级**——同一次 `keydown` 事件里**哪一条绑定先命中**。
  这个决策完全发生在 `EditorView` 的 `runHandlers` 内部，`contentDOM` 上不会留下任何
  可供 E2E 断言的 DOM 痕迹：命中 `addCursorAbove` 与命中 `copyLineUp` 之后，
  唯一的差别是选区光标数量，而 E2E 拿不到 `view.state`（除非注入 `__DEV__` 钩子，
  那会引入本轨禁止的 `SqlEditor.tsx` 改动）。
- WebdriverIO 的 `webdriver.io`/Tauri WebDriver 派发带 `Alt`+`Shift` 修饰键的方向键
  在 macOS/Windows 上存在已知的不稳定（修饰键状态不同步），会产出假绿或假红。
- 因此把「哪条绑定先命中」这一断言放在能真正观测它的层级——**真实 `EditorView` + 真实
  `KeyboardEvent` 单测**——并刻意复刻真实挂载顺序，避免了 E2E 无法避免的「单测挂载顺序
  与生产不一致」这一根本缺陷（正是本缺陷当初逃逸的原因）。
- 建议 Tester 若要人工验：macOS 上 `Option+Shift+↑/↓` 应新增光标而**不**复制行；
  `Cmd+Opt+Shift+↑/↓` 应复制行；`Cmd+Shift+↑` 仍应是「选到文首」。

## 遗留疑虑

1. **全量测试基线未能在本 worktree 建立**（`src/extensions/` 空 ⇒ codegen 缺失 ⇒ 174 个文件级失败）。
   本轨只能证明「未新增失败」是**逻辑推断**（失败文件清单无 `paste/` 下任何文件），
   **不是**实测。请 Tester 在已执行 codegen 的环境跑一次全量做真实对照。
2. **jsdom 无布局，`addCursor*` 的光标精确位置不可断言。** 实测 `view.moveVertically` 在 jsdom 下
   会退化成文档首/尾：文档 `SELECT a\nSELECT b\nSELECT c`（长度 26）、光标在 12 时，
   `addCursorAbove` 落在 0 而非真实浏览器里的同列位置 3。因此所有测试只断言
   **光标数量**与**文档文本不变**（后者才是 `addCursor*` 与 `copyLine*` 的真正分界），
   **没有**断言具体位置。真实浏览器中光标应落在相邻行的同列位置——该行为**未被自动化覆盖**，
   属上面建议的人工验证项。
3. **macOS 四修饰键 `Option+Cmd+Shift+↑/↓` 的手感偏重**，且与部分系统/虚拟机的快捷键可能撞车
   （例如某些 Windows 虚拟机的 Host+Option 组合）。这是「macOS 上已无空闲两修饰键方向键组合」
   的必然取舍。若协调者或 Tester 认为应改用菜单入口或可配置化，需要另开一轨
   （本轨范围禁止碰 `src/stores/**` 与任何设置项）。
4. **`Mod-d` 族的冗余未清理**：`Shift-Mod-D` 在所有平台都不可达，`Shift-Mod-d` 仅非 US 布局可达。
   有意保留（兜底 + 零回归风险），但若日后有人做键位清理，需要知道这两条是**故意**留下的，
   理由已写在 `multipleSelections.ts` 注释与本节 5 中。**删除前请先读本节。**
5. **E2E 缺口**：见上「E2E 登记（补）」，快捷键优先级这一层在 E2E 层无覆盖。
6. `Prec` 提权后，**若将来有人把 `Shift-Alt-ArrowUp/Down` 也注册进 `editorExtensions.ts` 的自定义
   keymap 块**，会重新形成「先注册者胜」的平级冲突。建议后续轨道在
   `editorExtensions.ts:261` 附近加一条注释说明该组合键的归属，本轨无权改该文件。

---

# Tester 更正与遗留（独立复核后追加）

Tester 独立复现了 5 项裁定，完整证据见 [`tester-report.md`](./tester-report.md)。
**判定 TEST_DONE，登记 0 个 Bug**（全量 465 文件 / 4621 用例全绿，`tsc --noEmit` 干净）。

## 更正 1：`Shift-Mod-d` 的「仅非 US 布局」说法不成立

上文「实现记录」与 `c37bc0848` 的 commit message 都写了
「`Shift-Mod-d` **仅**在非 US 布局经 `base[keyCode]` 回退时命中」。**实测不成立**：

- 隔离探针显示，`Shift-Mod-d` 在 **US 布局（`key='D'` + Shift）下同样可达**——
  主查表查 `Ctrl-D`（命中 `Mod-D`）miss 后，`base[68]='d'` 回退分支查 `Shift-Ctrl-d` 命中它。
- 也就是说它在**所有**布局下都是冗余绑定，只是在真实四绑定 keymap 中总被 `Mod-D` 遮蔽。

同时，「字符键在主查表排除 Shift，所以带 Shift 前缀的键名**根本没机会被查**」
这一机理陈述也是错的：非 US 布局下**赢的正是 `Shift-Mod-d`**，说明该键名被查到了，
只是走的不是主查表而是 `base[keyCode]` 回退分支（`@codemirror/view:9197-9205`）。

**影响：无。** 四条绑定的 `run` 与 `preventDefault` 完全相同，
「谁赢」在行为上不可观测，**四条全留、零行为改动的处置结论不变**。
此处仅更正事实表述，避免后续轨道按错误机理做取舍。

## 遗留 1：手工验收项缺「位置」维度

§E2E 登记（补）末尾的人工验证建议只覆盖了**按键分流**
（`Option+Shift+↑/↓` 新增光标、`Cmd+Opt+Shift+↑/↓` 复制行、`Cmd+Shift+↑` 选到文首），
**没有覆盖「光标落在相邻行同一列」**。

而位置恰好是本轨唯一一个「单测主动放弃（jsdom 无布局）且 E2E 覆盖不了」的维度——
单测证明分流正确，E2E 证明不了位置，两边都不管就会悬空。

**建议**：在 `test/` 手工黑盒清单补一条：
真实浏览器中 `Option+Shift+↑/↓` 把光标加到上一行/下一行的**同列**位置。

## 遗留 2：`eventFilter` 两个析取项恒为假（既有代码，不在本轨修）

```ts
(e.altKey || (e.altKey && e.shiftKey) || (e.metaKey && e.altKey)) && (e.button === 0 || e.buttons === 1)
```

第 2、3 项都要求 `altKey` 为真，却只在 `altKey` 为假时才被求值 ⇒ **恒为假**，
整个析取式恒等于 `e.altKey`。Tester 用 8 组合穷举钉死。
这既解释了 `multipleSelections.ts` 的 branch 覆盖率长期只有 26%，
也会让人误以为「Cmd+Option 拖拽有额外支持」。属本轨未触碰的既有代码，建议单开清理项。
