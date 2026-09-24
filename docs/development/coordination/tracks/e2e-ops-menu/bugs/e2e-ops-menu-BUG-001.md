# e2e-ops-menu-BUG-001 · RC-3 关闭修复无效：closeAnyMenu 向 window 派发 mousedown 使 onDown 抛 TypeError，菜单从未真正关闭

- **严重度**：高
- **状态**：待修复
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
