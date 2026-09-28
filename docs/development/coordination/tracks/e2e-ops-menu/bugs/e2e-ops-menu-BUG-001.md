# e2e-ops-menu-BUG-001 · RC-3 关闭修复无效：closeAnyMenu 向 window 派发 mousedown 使 onDown 抛 TypeError，菜单从未真正关闭

- **严重度**：高
- **状态**：已修复
- **涉及文件**：
  - `e2e/specs/ops-process-server.ts`（`closeAnyMenu()` L45-62 / `dismissMenu()`）
  - `e2e/specs/ops-ddl-backup.ts`（`closeAnyMenu()` / `dismissMenu()`）
  - `e2e/specs/navigator-context-menu.ts`（`closeAnyMenu()` / `dismissMenu()`）
  - （根因在被测组件 `src/components/ui/WebContextMenu.tsx:175` 的 `onDown`，本 track 禁改 `src/`，故按"不可测/修复无效"登记，交由协调者派发）

## 描述（含量级）

commit `84d9100979c3932b1ef48c7cb797b2474706dabe` 声称修复 RC-3：原
`dismissMenu` 向 `document` 派发**不冒泡** `mousedown`，到不了
`WebContextMenu` 的 `window.addEventListener('mousedown', onDown)`（根因分析
正确，已核实监听器位于 `WebContextMenu.tsx:181`）。新修复改为：

```ts
window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
```

这确实**到达**了 `onDown`，但 `onDown`（`WebContextMenu.tsx:173-177`）为：

```ts
const onDown = (e: MouseEvent) => {
  const t = e.target as Node | null;
  if (rootRef.current?.contains(t) || subRef.current?.contains(t)) return;
  hide();
};
```

在 window 上派发时 `e.target === window`，而 **`window` 不是 `Node`**：
`rootRef.current?.contains(window)` 按 WebIDL 对接口参数的转换规则抛
`TypeError: Failed to execute 'contains' on 'Node': parameter 1 is not of type 'Node'`，
`hide()` 永远不执行 → **菜单打开状态下，closeAnyMenu 无法关闭任何菜单**。

**量级**：

1. 三个 spec 的 `closeAnyMenu()`/`dismissMenu()` 在"菜单已打开"时全部实质
   no-op：`waitUntil(3s)` 必然超时，且被 `.catch(() => {})` 静默吞掉——恰好
   把 RC-3 想解决的"菜单残留污染后续断言"原样留在原地。
2. `rightClick()` 里的注释自述目标是"先确定性关闭残留菜单，避免下面的等待把
   旧菜单误判为新菜单已渲染完成"——由于关闭失效，`waitUntil(menu.isExisting())`
   会**立即被残留旧菜单满足**：跨节点右键（navigator 的 conn→db→schema→…
   用例、OPS-DDL-002 的 db 节点）存在读到旧菜单文本的误判风险（假失败/假通过
   两个方向都有）。
3. 每次带残留菜单的 `rightClick`/`dismissMenu` 白等满 3s 超时（慢化，非阻断）。
4. RC-3 修复链路**零断言验证**：`waitUntil` 失败被吞，任何静默回退都不会被
   现有用例发现。本轮已补 `[tester] OPS-PROC-T001` 硬断言作为复现/回归用例。

## 重现步骤

1. worktree `feature/e2e-ops-menu` @ `84d9100979c3932b1ef48c7cb797b2474706dabe`。
2. 运行真实组件级复现（vitest + jsdom，与 E2E 同一 WebIDL 语义；临时取证文件，
   取证后已删除，日志见下）：

```tsx
render(<WebContextMenuHost />);
showWebContextMenu([{ kind: 'item', id: 'a', label: 'A', action: () => {} }], { x: 10, y: 10 });
await screen.findByTestId('web-context-menu');
window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // ← closeAnyMenu 的做法
await waitFor(() => expect(screen.queryByTestId('web-context-menu')).toBeNull(), { timeout: 500 });
```

3. 对照组：把派发目标换成 `document.body` → 同断言通过。

## 实测错误日志

```
$ npx vitest run src/components/ui/__tests__/TempTesterCloseEvidence.test.tsx
 RUN  v4.1.10
 ❯ TempTesterCloseEvidence.test.tsx (2 tests | 2 failed → 修正 waitFor 后 1 failed | 1 passed)

 FAIL  ...window-dispatched bubbling mousedown closes the menu (e2e closeAnyMenu contract)
 AssertionError: expected <div data-testid="web-context-menu"> to be null
   （菜单仍挂在 DOM 上；run 级 Unhandled Error:）
 TypeError: Failed to execute 'contains' on 'Node': parameter 1 is not of type 'Node'.
    ❯ Object.exports.convert jsdom/lib/generated/idl/Node.js:27:9
    ❯ HTMLDivElement.contains jsdom/lib/generated/idl/Node.js:260:28
    ❯ onDown src/components/ui/WebContextMenu.tsx:175:28     ← 与被测源码行号一致
    ❯ dispatchEvent ... TempTesterCloseEvidence.test.tsx:26

 ✓ control: body-dispatched bubbling mousedown closes the menu（对照组通过）
```

独立佐证（jsdom 直接实验 + 真实浏览器同型案例）：

- 直接调用 `el.contains(window)`：`TypeError: Failed to execute 'contains' on 'Node': parameter 1 is not of type 'Node'`（jsdom 29，WebIDL 规范转换）。
- Stack Overflow 69208491「TypeError: Failed to execute 'contains' on 'Node': parameter 1 is not of type 'Node'」——真实浏览器同型报错。
- headlessui Issue #2115 同型：click-outside 处理器用 `contains(e.target)` 在
  `e.target` 为 window/document 时报该 TypeError（业界已知反模式）。

## 影响范围

- 三个 spec 的全部 `dismissMenu()`（OPS-PROC-001、OPS-DDL-001/002、NCM-001/003
  等所有以 dismiss 结尾的用例）在 R 回归中的实际表现依赖"菜单项点击/WebDriver
  原生点击顺带关闭菜单"的偶发副作用；跨节点右键用例（NCM-010 起的 db/schema
  文本断言、OPS-DDL-002）存在旧菜单误判风险。
- 新增复现用例 `[tester] OPS-PROC-T001` 在修复前必然失败（稳定复现点）。

## 建议修复方向（仅建议，测试方不改）

将派发目标改为 `Node`（任选其一）：

```ts
document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // 推荐
// 或 document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
```

`e.target` 为 Node → `contains()` 正常返回 false → `hide()` 执行。修复应同时
考虑在 `WebContextMenu.onDown` 侧对非 Node target 做防御（业界同型反模式），
但该改动属 `src/`，需协调者另行派发。

## 留待 R 回归

- 【留待 R 回归】真实 E2E（WebKit WebDriver）运行表现：`pnpm e2e:skip-build -- --spec e2e/specs/ops-process-server.ts,e2e/specs/navigator-context-menu.ts,e2e/specs/ops-ddl-backup.ts`，前置条件：主检出执行 `pnpm tauri:build:webdriver` 产出二进制。

## 修复记录（round-1）

- **修复提交**：`74f2854e6a174802b37c873644105d6c77ff3c9b`（修复内容在 message 为 `fix(e2e): resolve e2e-ops-menu-BUG-001 …` 的首个提交内；commit 无法包含自身 SHA，故由紧随其后的回填提交写入本行）
- **修复方式（仅测试侧，未动 `src/`）**：三个 spec 的 `closeAnyMenu()` 派发目标由 `window` 改为 `document.body`——body 是 Node，且是菜单 portal root 的祖先（`rootRef.contains(body)` 为 false），冒泡到 window 监听器后 `hide()` 正常执行；同时移除 `waitUntil` 上吞错的 `.catch`，关闭失败将带 `右键菜单未关闭` timeoutMsg 抛错（菜单本就不存在时 `waitUntil` 立即成功；`rightClick` 中面向"无菜单目标"语义的 `.catch` 保留，navigator 负向断言依赖）。
- **src/ 防御性补充未采纳**：生产真实 mousedown 的 target 必然是 Node，非 Node target 仅出现在合成 `window.dispatchEvent`（测试侧模式）中；按本轮"仅修 Bug、不改应用代码"约束未改 `WebContextMenu.onDown`，`if (!(e.target instanceof Node)) return;` 防御加固建议由协调者评估后另行派发。
- **验证**：
  - vitest 真实组件（临时取证文件，运行后已删除）：`document.body` 派发冒泡 `mousedown` → 菜单从 DOM 消失（根菜单、子菜单已打开两场景），2/2 通过。
  - `npx tsc --noEmit -p e2e/tsconfig.json`：HEAD 70 → 修复后 70，逐条归一化 diff 完全一致（相对 HEAD 零新增、零移除）。
- **复测入口**：主检出 `pnpm tauri:build:webdriver` 后执行 `pnpm e2e:skip-build -- --spec e2e/specs/ops-process-server.ts,e2e/specs/navigator-context-menu.ts,e2e/specs/ops-ddl-backup.ts`；回归用例 `[tester] OPS-PROC-T001` 必须转绿。

## 复测记录（round-1）

- **复测结论**：✅ 修复有效，BUG-001 关闭（状态 → 已修复）。复测 Tester 为全新独立实例。
- **修复范围审查（零信任独立核实）**：
  - `git diff --stat 7f56d244b..HEAD`（修复轮两个 commit）：仅 5 文件——3 spec + 本 BUG 文件 + progress.md；`src/`、`src-tauri/`、`packages/`、`e2e/helpers.ts`、`e2e/wdio.conf.ts`、`e2e/lib/` 逐一核对**零改动**（与修复者自报一致）。
  - 三份 `closeAnyMenu()` 函数体逐字节比对 **MD5 完全一致**（`af01c39a0f3631ae88a4c71ee5434d04` ×3）——Round 1 指出的"三份复制"本轮至少行为完全一致。
- **关闭机理独立验证（vitest 真组件，jsdom，5/5 通过）**：新增正式回归测试
  `src/components/ui/__tests__/test_tester_web_context_menu_close_dispatch.test.tsx`（`[tester]` / `test_tester_` 前缀）：
  1. `document.body` 派发冒泡 mousedown → 根菜单从 DOM 消失 ✅；
  2. 根菜单 + 子菜单已打开 → 两者均关闭 ✅；
  3. 菜单未打开时 body 派发为安全 no-op（"菜单本不存在 → waitUntil 首轮即真"的组件侧对应）✅；
  4. **负例**：`window` 派发（round-0 写法）→ 菜单**仍在 DOM**（`hide()` 未执行），window error 事件捕获到 `TypeError: Failed to execute 'contains' on 'Node': parameter 1 is not of type 'Node'` ✅——即 BUG-001 机理在当前 HEAD 上原样可复现（证明修复靠"换派发目标"而非掩盖）；
  5. 直接复现 `onDown` 第 175 行表达式 `menu.contains(window)` 抛 WebIDL TypeError ✅。
  - **机制结论**：`WebContextMenu` 经 `createPortal(..., document.body)`（源码第 239 行）挂载，菜单面板是 body 的子节点 → `rootRef.contains(body)` 恒 false（body 是祖先非后代）；body 上以 `bubbles: true` 派发沿 body → html → document → window 冒泡，window 监听器为 bubble 阶段（第 181 行无 capture 标志）→ `hide()` 正常执行。修复论证严谨成立。已核查 `src/` 内 6 处 document 级 mousedown 监听器均无 `stopPropagation()`，生产环境冒泡链无截断风险。
- **移除 `.catch` 后的失败信号复核**：3 个 spec 的 `dismissMenu`/`closeAnyMenu` 调用链上 `waitUntil(3000, timeoutMsg 右键菜单未关闭)` 均**无 `.catch`**——关闭失败真实抛错（不再被吞）；`waitUntil` 条件 `!menu.isExisting()` 在"菜单本不存在"时首轮即真、立即成功；navigator `rightClick` 面向"无菜单目标 → getMenuText()==''"语义的 `.catch`（L166-168）**保留完整**，ops 两 spec 的 `rightClick` 本轮未触碰（本就要求菜单必现）。
- **tsc 独立实测 vs 自报**：自报「70 → 70，逐条归一化 diff 完全一致」→ 独立重跑 `npx tsc --noEmit -p e2e/tsconfig.json` = **70 errors**（navigator 14 + helpers 4 + lib 2 + 其它 spec 50），并临时 checkout `7f56d244b` 三 spec 跑基线对照 = **70**，归一化（去行列号 + 排序）diff **完全一致，零新增零移除**；原始差异仅为 +4 行注释导致的行号位移。**核对通过**。
- **完整回归（阶段 C）**：`npx vitest run` 全量 **484 文件 / 5060 测试全绿**（含新增 5 条 + 既有 `WebContextMenu.test.tsx` 7/7）；RC-1 `dropLeakedSeededSession` 三处 before 调用在位（proc L241 / ddl L198 / nav L340）；Round 1 的 5 条非 Bug 发现逐条核对**原样在位、未被修复轮恶化**（`?? items[0]` 兜底 L81、kill 按钮静默 return L473、`[data-dt-row]` 全文档扫描 L179、navigator 无菜单 rightClick 等满 8s、三份复制）。
- **新增 Bug**：无。
- **【留待 R 回归】**：完整 E2E 需主检出 `pnpm tauri:build:webdriver` 后执行
  `pnpm e2e:skip-build -- --spec e2e/specs/ops-process-server.ts,e2e/specs/navigator-context-menu.ts,e2e/specs/ops-ddl-backup.ts`；
  回归用例 `[tester] OPS-PROC-T001` **必须转绿**（其断言链经复核为真实失败信号：menu isExisting 断言 → dismissMenu → waitUntil 消失 → 末置 expect false）。
