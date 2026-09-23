# redis-kv-context-bar 缺陷登记（BUG）

## 编码轮（Coder · 两个交付单元 · 2026-09-23）

**无待修复缺陷。**

- 四道门禁全绿（尾部逐字见 `progress.md`「四门实测」）：`npx tsc --noEmit` 0 错 ·
  Drivers `63 files / 874 tests` 0 失败（基线 `61 / 804`，+2 files / +70 tests）·
  `npx vite build` exit 0 · `check-driver-import-boundaries` 0 blocking / 4 advisory（既有）·
  `resolve-drivers.mjs --codegen-only --drivers=basic` exit 0。
- 关键约束全部做了**变异反证**（逐条见 `progress.md`「变异反证」）：
  采样标注三态（3 红）、`maxmemory 0` ⇒ 无上限（2 红）、失败分布不渲染 0（2 红）、
  游标 × loaded 成对判据（3 红）、`db_sizes` 同面板合流（1 红）、
  `ContentView` 只有一份开面板实现（1 红）。
- 一处**等价变异体**（mutation 4）被判为非缺陷并当场修掉死代码而非留断言粉饰：
  `deriveScanReadout` 里 `stopped` 的 `usedCount > 0` 项在早退分支之后不可达；
  删掉该冗余项后真实承重项（`cursor !== '0'` 与「未扫描 ⇒ 不宣称完成」）由 5 例钉住。

## 编码轮过程中发现并当场修复的存量问题（非本轨引入）

**1. 七个既有 `makeRelay()` 桩仍是 W3-A 之前的 5 成员 `KvSlotState`（中）**

- 事实：`kvBarSlots` / `kvBarRound1Fixes` / `kvBarSlotTesterGaps` / `kvBarRound2Tester` /
  `kvBarRound2Fixes` / `kvBarRound3Tester` 六个文件的本地中继桩只有
  `subscribe / getSelectedKey / selectKey / getDirty / setDirty`；W3-A §1.1 把契约加宽到
  10 个 getter 后**没有一处随之加宽**。
- 为什么一直没红：测试文件在根 `tsconfig` 的 `exclude` 里（`packages/**/*.test.tsx`），
  所以 `npx tsc --noEmit` 看不见这个类型缺口；而 W3-A 之前的槽位组件只读那 5 个成员，
  运行时也碰不到缺口。**契约加宽与桩加宽之间没有任何门禁**。
- 何时暴露：本轨 statusBar 全量版开始读 `getLoadedCount()`，`useSyncExternalStore`
  收到 `undefined` ⇒ `TypeError: getSnapshot is not a function`，**30 例红**。
- 处置：给六个文件的中继桩补齐全部 10 个 getter + 幂等 setter（不接受「只补被读到的那几个」——
  下一个读别的 getter 的槽位会重演同一现场）。`kvSlotRelay.test.tsx` 的桩只写 2 个字段、
  是**中继写入侧**测试，未受影响，保持原样。
- 建议（留给协调者）：把「驱动 UI 测试桩与 `KvSlotState` 同步」做成一条护栏
  （例如让某个 `__tests__` 文件 `satisfies KvSlotState` 地构造一次），
  否则下一次契约加宽会以同样的方式在随机某轨爆红。

**2. `kvBarSlots.test.tsx` 一条断言钉的是加宽前的契约（低）**

- 旧断言：`expect(commandInvoke).not.toHaveBeenCalled()`（用例名
  "renders the no-key state and asks the server for nothing"），钉的是「状态条一个命令都不发」。
- 为什么必须改：statusBar 全量版按 PRD §3.4 增加了 `52 keys` 字段，它读 `db_sizes` 且
  **与是否有选中键无关**；旧断言会把这条合法新增判成回归。
- 改法与旧断言钉的东西：用例改名为 "issues no key read without a selection"，断言改为
  ①`key_object_info` 零调用（该用例真正的主体：选中驱动键读取，无选中即无键读取）
  ②`db_sizes` 是唯一命令。**旧断言钉的是「零命令」，新断言钉的是「无选中 ⇒ 无键读取」**，
  语义收窄而非删除；覆盖未减（该用例原有 4 条断言全部保留）。
