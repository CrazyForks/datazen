# Track: redis-host-slots — Bug 登记

Tester（全新实例）复测登记。基准 `ae65ae375`，首轮被测提交 `9b073ed46` / `9b878e609` / `e4f020b70` /
`8f502cac2`；修复轮复测被测提交 `d4469185e`（另含 `cbcf49cf9` 的 Tester 测试）。

**总判定：PASSED（无阻断缺陷）；第 1 轮修复复测：PASSED → READY_TO_MERGE。** 全部 7 项验收标准与 6 类门禁独立实跑全绿，
F-1 / F-2 / F-3 契约可冻结。以下 3 条为**非阻断**登记项（救援残留的契约面 / 文档准确性 /
Wave 2 会踩的契约缺口），**三条均已在 `d4469185e` 修复并经复测确认**；按协调者指令另列 3 条"不登记为 Bug"的裁定项，
复测再新增 2 条观察项（O-1 / O-2，不阻断合流）。

登记规范：ID / 严重级 / 现象 / 可复现步骤（含失败断言原文）/ 根因推断 / 建议修法 / 状态。

---

## redis-host-slots-BUG-001 — 两个导出的契约函数在生产代码里零调用者（救援残留的"写了没接线"面）

- **严重级**：低（非阻断；不影响本轨任何验收标准与今日 UI 行为）
- **状态**：已修复并经第 1 轮复测确认（Tester 全新实例，判定 PASSED）— 采默认处置**删除** `hasAnyKvSlotCapability` /
  `disposeKvSlotState` 及其单测（非接线：二者均非宿主唯一能力判定入口，见 progress.md §修复记录 BUG-001）。
  复测独立核实：非文档命中数 0、`detailPanelApplicable`（`ContentView.tsx:147-150`）不含任何聚合能力依赖、
  三个 `src/lib` 新文件分支覆盖仍 100%。复测补强一处：`kvSlotState.test.ts` 的 prune 用例
  增补"回收后面板 id 拿回干净原子"两条断言（原删除的 dispose 用例是唯一的洁净性断言点），详见 progress.md §复测记录（第 1 轮修复后）
- **现象**：
  - `src/lib/kvWorkspaceCapabilities.ts:45` 的 `hasAnyKvSlotCapability(meta)` 仅被
    `src/lib/__tests__/kvWorkspaceCapabilities.test.ts` 调用（6 处断言），**生产代码 0 处引用**。
  - `src/lib/kvSlotState.ts:73` 的 `disposeKvSlotState(panelId)` 同样仅被
    `src/lib/__tests__/kvSlotState.test.ts:107` 调用，**生产代码 0 处引用**；
    面板原子的实际回收完全由 `pruneKvSlotStates(livePanelIds)`（`ContentView.tsx:206-213`）承担。
  - 检索证据（worktree 根，排除 node_modules）：
    `hasAnyKvSlotCapability|disposeKvSlotState` 命中仅 定义 + `__tests__` + `progress.md`。
- **可复现步骤**：
  1. 在 worktree 根检索 `hasAnyKvSlotCapability` 与 `disposeKvSlotState`；
  2. 过滤掉 `src/lib/*.ts` 中的定义行、`src/**/__tests__/**`、`docs/**`；
  3. 剩余命中数为 0 ⇒ 两个公共 API 无生产消费者。
- **根因推断**：救援提交 `9b073ed46` 一次性落地前任未提交现场（22 files / +1644），
  其中 `hasAnyKvSlotCapability` 是原计划用于 `detailPanelApplicable` 的门控（见
  `progress.md` §留待 R 回归 3），接线动作在前任 150 轮截断时未完成；
  `disposeKvSlotState` 则是被 `pruneKvSlotStates` 批量回收方案取代后遗留的单点 API。
  两者都保留了完整单测，因此类型与全量测试都不会暴露"无调用者"。
- **建议修法**（二选一，不要在 Wave 2 里让两种机制并存）：
  1. **接线**：把详情按钮的可用性判定改为
     `detailPanelApplicable = hasKvSlotCapability(meta, 'keyPropsSidebar') && <原条件>`，
     顺带关闭 R-3 的"meta 写了 `keyPropsSidebar: true` 但 codegen 未贡献 ⇒ 空抽屉"风险；
     `disposeKvSlotState` 若确认不需要，删除并同步删测试。
  2. **明确保留**：在 `progress.md` F-1/F-2 段落显式标注
     "`hasAnyKvSlotCapability` / `disposeKvSlotState` 为 Wave 2 预留契约面，本轨无消费者"，
     避免 Wave 2 任务书误以为宿主已经做过能力聚合门控。
- **备注**：本条不推翻协调者裁定（"能力为假时行为不变"已满足：三态降级实测正确）；
  登记动机是"救援一致性"——未接线的公共 API 会让 Wave 2 误判门控已存在。

---

## redis-host-slots-BUG-002 — 自验记录里的"基线数字 / 本轨新增用例数"与 git 事实不符

- **严重级**：低（非阻断；门禁结论不受影响，但这张表是 Wave 2 任务书的输入）
- **状态**：已修复并经第 1 轮复测确认（Tester 全新实例，判定 PASSED）— §自验记录/门禁 3 段按 git 事实改写为基线
  **442/4599**、本轨 **7 新增 + 2 修改测试文件 / +47 用例**，判据改为"改后全量 exit 0、失败集合为空"。
  复测独立按 git 重算并逐项吻合（`git show 8f502cac2:<file> | grep -cE "^\s*(it|test)\("`：
  11+7+5+2+3+5+7 = **40** 新文件用例，`resolve-drivers.test.mjs` 13→18（+5）、
  `ContentStatusBar.test.tsx` 4→6（+2）⇒ **+47**；449/4646 − 7 文件/47 用例 = **442/4599** ✓；
  今天的 4653 = 4599 + 47 + 8（Tester 复测）− 1（BUG-001 删除的 dispose 整例）✓ 与两次全量实跑逐位吻合
- **现象**：`progress.md` §自验记录 与"门禁 3 的红/绿比对方法"写：
  - 基线（同一 worktree、`9b073ed46` 落地前实跑）= **447 files / 4634 tests**；
  - "两者差值恰为本轨新增的 **2 个测试文件 / 12 个用例**"，并列 `ContentViewDrawers.test.tsx` +5、
    `ConnectionWorkspaceHomeKvSlot.test.tsx` +2、`resolve-drivers.test.mjs` +5（= 3 个文件，与"2 个文件"自相矛盾）；
  - 定向单测行写"接管时 202/2061 → 本轨新增 2 文件 7 用例"。
- **可复现步骤（git 事实）**：
  ```text
  $ git log --oneline --parents -1 9b073ed46
  9b073ed46 ae65ae375 feat(connection): open capability-driven KV workspace slots on the host
  $ git diff --name-status ae65ae375..HEAD | grep -Ei "test|spec"
  M   scripts/__tests__/resolve-drivers.test.mjs
  A   src/lib/__tests__/kvSlotState.test.ts
  A   src/lib/__tests__/kvWorkspaceCapabilities.test.ts
  A   src/lib/__tests__/kvWorkspaceSlots.test.ts
  A   src/windows/connection/__tests__/ConnectionWorkspaceHomeKvSlot.test.tsx
  M   src/windows/connection/__tests__/ContentStatusBar.test.tsx
  A   src/windows/connection/__tests__/ContentToolbar.test.tsx
  A   src/windows/connection/__tests__/ContentViewDrawers.test.tsx
  A   src/windows/connection/__tests__/useKvWorkspaceSlots.test.tsx
  ```
  即 **7 新增 + 2 修改**；用例数（`grep -cE "^\s*(it|test)\("`）：新增 7 文件 11+7+5+2+3+5+7 = 40，
  `resolve-drivers.test.mjs` 13→18（+5），`ContentStatusBar.test.tsx` 4→6（+2）⇒ 本轨共 **+47 用例**。
  由于 `9b073ed46` 的父提交就是 `ae65ae375`，"落地前"即基准，真实基线应为
  **442 files / 4599 tests**（= 本轨合入后 449/4646 减去 7 文件 / 47 用例），而非 447/4634。
- **失败断言原文**：无（全量测试 `450 passed / 4654 passed`，exit 0；本条为文档准确性）
- **根因推断**：447/4634 是救援过程中（前任部分测试文件已在工作区、部分尚未落地）的一次中途测量，
  被当作基准登记；"2 文件 / 12 用例"是把"最后一批补齐"误写成"本轨新增"。
- **建议修法**：把该段改为「判据 = 改后全量 `npx vitest run` exit 0 且失败集合为空（无需基线求差集）；
  本轨相对 `ae65ae375` 新增 7 个测试文件 / 47 个用例」。若仍要登记基线数字，请在
  `git stash -u` 或临时 worktree 上实跑 `ae65ae375` 后再写，不要沿用中途值。
- **备注**：4a/4b 的 `1413 files` / `1730 files` 也已随文件数自然漂移到 1416 / 1732（含 Tester 新增文件），
  属同一表格的时效问题，不另立 Bug。

---

## redis-host-slots-BUG-003 — F-2 未写清"`open === false` 时宿主 wrapper 常驻 DOM"，Wave 2 E2E 必踩

- **严重级**：低（非阻断；当前单测已把行为钉住，缺的是契约文字）
- **状态**：已修复并经第 1 轮复测确认（Tester 全新实例，判定 PASSED）— 已在 F-2 几何条目后追加对偶事实引用块，并显式警告
  Wave 2 E2E 不得用 `conn-kv-key-props-sidebar` wrapper 存在性判抽屉开合（`toHaveCount(0)` 必红）。
  复测按码核实：`ContentViewDrawers.tsx:152-153` 行号与文字一致；`ContentViewDrawers.test.tsx:122-123`
  已钉住"`open === false` ⇒ wrapper 在、驱动 fixture 根节点不在"。**一处措辞精度补充（非 Bug）**：
  wrapper 常驻的前提是 `detailPanelApplicable && keyPropsSidebarSlot` 成立 —— `detailPanelApplicable === false`
  时 wrapper 同样不存在（`ContentViewDrawers.test.tsx:142-147` 已覆盖）。KV 面板下
  `detailPanelApplicable` 恒为真（`ContentView.tsx:147-150` 只对 `table` / `view` 面板收窄），
  故 Wave 2 判据写作"驱动根节点可见性"仍然完全够用，无需改契约段
- **现象**：F-2 几何规则只写了驱动侧义务
  （"`keyPropsSidebar` 在 `open === false` 时必须渲染 `null`，宿主不卸载它，只翻 `open`"），
  但没有登记宿主侧的对偶事实：`src/windows/connection/ContentViewDrawers.tsx:152-153` 的
  `data-slot="kv-key-props-sidebar"` / `data-testid="conn-kv-key-props-sidebar"` 包裹层
  在 `open === false` 时**仍然存在于 DOM**，抽屉收起与否只能由**内层驱动组件根节点**体现。
- **可复现步骤 / 现有断言原文**：
  `src/windows/connection/__tests__/ContentViewDrawers.test.tsx:122` 断言
  `open=false` 时 `data-testid="conn-kv-key-props-sidebar"` 依然存在（本轨已覆盖，行为正确）。
  风险在 Wave 2：若 E2E 按 AGENTS 的 `data-testid` 约定写
  `expect(page.getByTestId('conn-kv-key-props-sidebar')).toHaveCount(0)` 来判"抽屉已关闭"，
  将必然红；正确断言是"内层 `[data-slot=kv-key-props-sidebar] > *` 无内容"或驱动自身根节点的可见性。
- **根因推断**：本轨选择"常驻 wrapper + 只翻 `open`"是为了让驱动组件内部状态（如列表滚动位置、
  展开态）在抽屉开合间不丢，属有意设计；但契约文字停在驱动侧义务，消费侧推论没人补。
- **建议修法**：在 F-2 的几何条目后追加一句并在 §留待 R 回归 增补一条 Wave 2 E2E 注意事项：
  "判定抽屉开合不得用 wrapper 的存在性，须用驱动根节点内容/可见性；wrapper 常驻是契约的一部分。"

---

## 不登记为 Bug（协调者已裁定，仅备注）

1. **R-8 契约层之争**：PRD §7-4 "由 `@datazen/extension-points` 承载" 措辞与实现不符，按裁定属**文档错误**，
   codegen 驱动的驱动贡献槽位才是正道。本轨宿主侧实测：`packages/drivers/**` 零 import、
   宿主零 `databaseType === 'redis'` 分支、`check-driver-import-boundaries` **0 blocking**（1416 files / 4 advisory）。
2. **R-2**：redis meta 尚无 `kvWorkspace: true`、codegen 尚无 `kvSlots` ⇒ P-1 空带 / P-3 死按钮
   要到 Wave 2 才在 UI 上消失，属预期。
3. **R-9**：`scripts/resolve-drivers.mjs` 1338 行（基准 1239，本轨 +99）越线属存量债。

---

## 第 1 轮复测新增观察（不登记为 Bug，随下次触碰该文件时顺手处理）

1. **O-1 `KV_SLOT_NAMES` 的文档措辞名不副实**（`src/lib/kvWorkspaceCapabilities.ts:12-18`）：
   BUG-001 删除聚合位后，宿主侧 `KV_SLOT_NAMES` 的**生产调用者为 0**（消费者只有
   `src/lib/__tests__/kvWorkspaceCapabilities.test.ts` 与 `scripts/__tests__/resolve-drivers.test.mjs`
   的双向钉死断言）。这属合法用途（它是 F-1/F-3 冻结名单的宿主侧镜像），**与 BUG-001 不同**：
   BUG-001 的危害是"Wave 2 误以为宿主已做聚合门控"，而 F-1 现已显式写明"宿主不提供聚合位"，
   误导路径已消除 ⇒ 不再立 Bug。但其 doc 注释仍写
   "Every KV slot name, **in render order**"，而四槽实际各在自己的宿主组件里显式绑定
   （`ContentToolbar` / `ContentStatusBar` / `ContentViewDrawers` / `ConnectionWorkspaceHome`），
   没有任何渲染顺序由该数组驱动。建议下次改动时把注释更正为"契约名单，供钉死断言与
   Wave 2 就地聚合判定使用"，并保留 `some(...)` 用法提示。
2. **O-2 F-1 的聚合判定提示只对宿主成立**：F-1 现写"Wave 2 若要聚合判定，就地
   `KV_SLOT_NAMES.some(...)`"。宿主内代码可直接 import；**驱动侧不可**（边界护栏 R1 禁止
   `packages/drivers/**` import 宿主 `src/**`，本轨实测 0 blocking）。Wave 2 若真需要聚合判定，
   要么在驱动侧用 `@datazen/driver-sdk` 的 `KvSlotName` 联合自行枚举，要么由宿主把结论以 prop 传下去。
   建议在 Wave 2 任务书里点明，避免驱动轨照抄契约段后撞护栏。

---

## 环境性既有红 / 噪音（非本轨缺陷，不计入 Bug）

| # | 现象 | 证据 | 判定 |
| --- | --- | --- | --- |
| E-1 | `check-driver-import-boundaries` 4 条 R3 advisory | `src/locales/locales.test.ts:107`、`src/lib/driverUiSetup.ts:25,26`、`src/windows/connection/DocumentConnectionView.tsx:25` | 均在本轨之前既有，advisory 不阻断（exit 0） |
| E-2 | `node scripts/check-i18n-copy-assertions.mjs` → `MODULE_NOT_FOUND` | 该脚本在 `ae65ae375` 与本分支均不存在 | 属并行 `redis-assert-policy` 轨交付物，本轨未触碰（progress.md R-7 一致） |
| E-3 | 全量运行时 vite 警告 `Duplicate key "DRIVER_DB_ENTRIES" in object literal` | 源文件为 `src/windows/connection/__tests__/ConnectionNavigatorTree.test.tsx`（测试夹具里的 mock） | 存量噪音，非本轨文件，不影响结果 |
| E-4 | 全量运行日志中 `Error: render failed at BrokenView` | `src/components/__tests__/ErrorBoundary.test.tsx:10` | 该用例本身通过，属预期的 console 噪音 |
| E-5 | 两次并发 `--coverage` 运行互相清掉 `coverage/.tmp` | `ENOENT coverage-195.json` | Tester 自身操作问题，改为串行后消失；非仓库缺陷 |
| E-6 | 面板创建仍写 `type: 'redis-db'` 字面量；`isKvPanel` 在面板缺 `databaseType` 时回退 `sidebarConnCtx.databaseType` | `src/windows/connection/ConnectionPage.tsx:388`、`useConnectionWorkspaceMeta.ts` | 本轨范围外（`ConnectionPage.tsx` 属禁止改动清单），已被 progress.md R-4 覆盖，仅提示 R 阶段 GUI 核实 |
