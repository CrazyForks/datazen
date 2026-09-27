# Track: ep-hooks-settings — EP 契约通用钩子 + Pro 设置生效 + 版本 bump

- **状态**: TEST_FAILED
- **测试结论**: 第 1 轮测试（基线 `6d3fedf97`）已完成，结论 **TEST_FAILED**。
  报告：[`test-report.md`](test-report.md)；缺陷：[`bugs/`](bugs/README.md)（BUG-001 高 / BUG-002 低 / BUG-003 低，均为「待修复」）。
  门禁：`npx tsc --noEmit` exit 0；Host `npx vitest run` 464 文件 / 4598 测试全绿；Pro 63 文件 / 780 测试全绿；改动代码覆盖率 98.8%。
- **分支**: `feature/ep-hooks-settings`（宿主）— commit `4192affd8`
- **Pro 分支**: `productivity/ep-hooks-settings`（`packages/pro-extensions/sql-editor-pro`）— commit `63b212a`
- **方案依据**: `docs/development/editor-pro-productivity-plan.zh-CN.md` §4 G2 / G3 / G4

## 一、目标

三件事同批做，因为它们共享同一条重配路径且**必须原子同批**：

- **G2** 契约新增三个通用钩子（现契约是 13 个成员的闭集，Pro 无法新增任何能力）
- **G3** 让 Pro 设置真正生效（现编辑器只读 5 个硬编码键，其余设置「能存能渲染、零效果」）
- **G4** `EXTENSION_POINTS_VERSION` bump（`checkEngineCompatibility` 用**精确字符串相等**，不同步 bump ⇒ Pro 静默降级 community）

## 二、已实证的机制（勿重新论证）

- `SqlEditorEnhancedFeatures`（`packages/extension-points/src/sqlEditorEnhancedEP.ts:59-104`）恰 13 个成员，无通用 extra-extensions / keymap / panel-slot 钩子。
- `fallbackFeatures` 是 `Object.freeze`（house style：钩子 null/空返回）。
- `checkEngineCompatibility`（`security.ts:124-142`）`required !== hostVersion` ⇒ 精确串比，`engines.extensionPointsVersion` 必填。
- 舱位是**固定闭集** `statement, completion, intention, hover, paste, linter`（`editorExtensions.ts:121-134`）。
- `reconfigureProCompartments`（`editorExtensions.ts:827-839`）是现成的**原子批量**重配 API，**生产零调用**；生产走 6 次非原子 dispatch（`SqlEditor.tsx:438-495`）。
- **G3 病根**：编辑器只读 5 个硬编码键 —— `statementGutter` / `tableHover` / `insertValueHints` / `intentionActions`（`SqlEditor.tsx:125-128`）+ `bindParamPanel`（`QueryEditorSection.tsx:243`）。六个工厂的 `useMemo` 依赖数组里没有其他键。
- **键位优先级**：`SqlEditor.tsx:349-398` 按挂载顺序注册，**先注册者胜**；`defaultKeymap` 在 `editorExtensions.ts:289` 已被 `searchKeymap` 之后的宿主 keymap 抢过。

## 三、改动范围（独占，禁越界）

| 文件 | 改动 |
| --- | --- |
| `packages/extension-points/src/sqlEditorEnhancedEP.ts` | 新增 3 个**可选**钩子；`fallbackFeatures` 保持 `Object.freeze` 且新钩子 null/空返回 |
| `packages/extension-points/src/security.ts:14` | `EXTENSION_POINTS_VERSION` `1.0.0` → `1.1.0` |
| `src/components/sql-editor/editorExtensions.ts` | 舱位改为**可扩展映射**（`ProCompartmentPayload` 由六键字面量改为可遍历映射）；把 `reconfigureProCompartments` **接进生产路径** |
| `src/components/sql-editor/SqlEditor.tsx` | 用通用路径替代 5 个硬编码键；6 次非原子 dispatch → 原子批量重配 |
| Pro `package.json` | `engines.extensionPointsVersion` → `1.1.0` |
| Pro `src/proFeatures.ts` | 新钩子保持 fallback 语义（不实现，只保证契约编译通过） |

### 三个新钩子

| 钩子 | 用途 | 解阻 |
| --- | --- | --- |
| `createExtraExtensions?` | 进入宿主新增 `folding` 舱位 | Code Folding |
| `createExtraKeymap?` | **`Prec.highest`** 插入，不被 `defaultKeymap` 抢占 | Multi-cursor 扩展、折叠快捷键 |
| `createEditorPanelSlot?` | 通用 React 面板槽 | History/Favorite 的 Pro 视图（后续） |

**不在本轨范围**：Pro 侧真正实现折叠/多光标（P1）、面板槽被 Pro 消费（P3）。

## 四、验收标准（逐条可核对）

1. `SqlEditorEnhancedFeatures` 新增 3 个**可选**成员；`fallbackFeatures` 仍为 `Object.freeze`，且新钩子在 fallback 下返回 null / 空数组 / null。
2. `EXTENSION_POINTS_VERSION === '1.1.0'`，且 Pro `package.json` 的 `engines.extensionPointsVersion` **同为 `'1.1.0'`**；`checkEngineCompatibility` 对新 Pro 清单返回 `{ compatible: true }`。
3. 有测试覆盖版本不匹配 ⇒ `{ compatible: false }`（防止将来 bump 漏一端）。
4. 舱位可扩展：新舱位无需修改 `ProCompartmentPayload` 类型定义即可传入并被遍历消费。
5. 生产路径**改为调用 `reconfigureProCompartments`**，不再有 6 次独立 dispatch；有一条测试证明重配后所有 Pro 舱位同时生效（原子性）。
6. **G3 生效可证**：新增一个此前「零效果」的 Pro 设置键，改动后能触发对应舱位重配（有测试断言，不要只靠代码审阅）。
7. `createExtraKeymap` 产出的绑定**不被 `defaultKeymap` 抢占**（有测试：`Mod-Alt-ArrowUp` 之类的冲突键能被 Pro 捕获）。
8. `pnpm typecheck` 干净（**含测试文件**，tsconfig 已不再排除 `__tests__`）。
9. `npx vitest run`（相关文件）全绿。
10. `node scripts/resolve-pro.mjs --edition=pro` 成功（Pro 契约改动后仍能打包签名）。

## 五、已知陷阱

- **`compartments` 是模块级共享单例**（`editorExtensions.ts` 顶部导出）。多实例编辑器共享它 ⇒ 改造时必须有一条多实例测试，否则会出现 A 编辑器重配影响 B 编辑器。
- **版本 bump 必须与 Pro 同批**。`checkEngineCompatibility` 无 semver range、无协商窗口，漏改任一端 = Pro 静默降级 community，用户只看到「功能凭空消失」，日志里仅一行 `console.error`。
- `Prec.highest` 是 `createExtraKeymap` 能生效的前提；不加则被 `defaultKeymap`（`copyLineUp/Down` 等恒返回 true 的绑定）吃掉。
- `SafeCompartmentWrapper`（`safeCompartment.ts:23-39`）任一工厂抛错会注销**整个 EP**，`onCircuitBreak` 目前**未接线**。本轨不修，但新增钩子不得引入新的抛错路径。
- Pro 仓是**独立 git 仓库**，需独立 commit。宿主与 Pro 的 `package.json` 版本改动虽同文件，但两轨 worktree 物理隔离，合并期再合 JSON。

## 六、E2E 登记

| 用例 | 状态 | 前置 |
| --- | --- | --- |
| 【留待 R 回归】`e2e/specs/sql-editor-productivity.ts` SE-PROD-020/021/022（`Mod+D`）、SE-PROD-030（`Alt+Click`）、SE-PROD-040（`Alt+drag`）多光标回归 | 留待 R 回归 | 本轨不改变多光标行为，**用于证明无回归** |

## 七、自验套件

```bash
npx tsc --noEmit
npx vitest run src/components/sql-editor src/components/__tests__ packages/extension-points
cd packages/pro-extensions/sql-editor-pro && npx vitest run && cd -
node scripts/resolve-pro.mjs --edition=pro
```

> 本 worktree 未装依赖，必须用 `npx`（或 `pnpm --config.verify-deps-before-run=false`）；**禁止** `pnpm install`。`pnpm typecheck` 原文照抄会被 pnpm preflight 拦下，故此处改写为等价的 `npx tsc --noEmit`（其 `tsconfig` 与 `pnpm typecheck` 同一份）。

## 八、实现说明（READY_FOR_TEST）

### 实际改动文件

**宿主（`feature/ep-hooks-settings`，commit `4192affd8`，12 个文件）**

| 文件 | 改动 |
| --- | --- |
| `packages/extension-points/src/sqlEditorEnhancedEP.ts` | 新增 `EditorPanelSlot` 接口 + 3 个可选钩子；`fallbackFeatures` 补 `() => []` / `() => []` / `() => null` |
| `packages/extension-points/src/index.ts` | 导出 `EditorPanelSlot` |
| `packages/extension-points/src/security.ts` | `EXTENSION_POINTS_VERSION` → `1.1.0`（附精确比较的告警注释） |
| `src/components/sql-editor/proCompartments.ts` | **新增**。可扩展舱位注册表 + `mountProCompartments` / `reconfigureProCompartments` + `readProSettingsBag` / `proSettingFlag` + `createProKeymapExtension` / `createProExtraExtensions` |
| `src/components/sql-editor/editorExtensions.ts` | 舱位字面量改为 re-export；新增并导出 `ProCompartmentOptionsBase`，5 个 option 接口改为 `extends`；删除旧的六键 `ProCompartmentPayload` 与 `reconfigureProCompartments` |
| `src/components/sql-editor/paste/createPasteExtensions.ts` | `PasteCompartmentOptions` 增加 `proSettings` |
| `src/components/sql-editor/SqlEditor.tsx` | 5 个硬编码键 → `readProSettingsBag` + `proSettingFlag`；6 次独立 dispatch → 单次 `reconfigureProCompartments` |
| `src/components/sql-editor/__tests__/proCompartments.test.ts` | **新增**，10 例 |
| `src/components/sql-editor/__tests__/proKeymapPrecedence.test.ts` | **新增**，14 例 |
| `src/components/__tests__/SqlEditorProSettingsJourney.test.tsx` | **新增**，6 例 |
| `src/components/__tests__/SqlEditorIntentionSettingsJourney.test.tsx` | 越界但**必须改**：见下方「范围外改动」 |
| `packages/extension-points/src/__tests__/security.test.ts` | 新增 1.1.0 契约块，5 例 |

**Pro（`productivity/ep-hooks-settings`，commit `63b212a`，4 个文件）**

| 文件 | 改动 |
| --- | --- |
| `manifest.json` | `engines.extensionPointsVersion` → `1.1.0` |
| `src/proFeatures.ts` | `createPasteExtensions` 读 `proSettings.pasteAsIn`；新增 `pasteAsIn` 设置项；注释说明 3 个新钩子有意不实现 |
| `src/__tests__/proSettingsJourney.test.ts` | **新增**，5 例 |
| `src/intentions/__tests__/linterCompartment.tester.test.ts` | 断言了 settings 项全量列表，补 `pasteAsIn` 一行 |

### 两条关键论断的证明方式

**G3 生效可证**（验收 6）——`pasteAsIn` 是刻意选的哨兵键：**宿主对它没有任何硬编码知识**。如果设置包只是"存了、渲染了、没生效"，测试不可能变绿。

- `SqlEditorProSettingsJourney.test.tsx:1` 写一次 `{ pasteAsIn: false }` 进 `useSettingsStore`，断言 `view.state.facet(pasteInstalled)` 走 `true → false → true`、view 实例与文档不变、`createPasteExtensions` 收到的 `proSettings` 恰为 `{pasteAsIn:false}`。同文件另有 3 例钉住**因果**而非巧合：一次设置写入同时重跑 `createPasteExtensions` 与 `createHoverExtensions`；生产路径对 `view.dispatch` 打桩后，一次设置写入**恰好 1 次** dispatch（原子性落到真实组件上）；未实现新钩子的 EP 与 `createExtraExtensions` 抛错熔断都不影响编辑器。
- Pro 侧 `proSettingsJourney.test.ts` 从另一端钉住：`pasteAsIn: false ⇒ []`、切回 `true ⇒ 非空`、无关键不误触发、且该键确实出现在 `settingsContributions` 里。

**keymap 不被 defaultKeymap 抢占**（验收 7）——`proKeymapPrecedence.test.ts` 走真实注册表 + 真实 `createProKeymapExtension()` + 真实 `dispatchEvent(new KeyboardEvent('keydown', …))`，不是桩。

- 三条真实冲突键：`Shift-Alt-ArrowUp`（copyLineUp）、`Alt-ArrowUp`（moveLineUp）、`Mod-Alt-ArrowUp`（addCursorAbove）。`Mod` 的平台差异用候选事件列表探测实际生效的那条。
- 每条都有**对照组**：同样的绑定用裸 `keymap.of([...])`（即去掉 `Prec.highest`）装在同一位置 ⇒ Pro handler 调用次数 0、宿主命令照常执行。**没有这个对照，"我们赢了"和"这个键本来没人争"无法区分。**
- 另有守卫例：先在裸编辑器上确认该键确实被 `defaultKeymap` 占用，否则 `claimedEventFor` 直接抛错而不是让测试悄悄变空转。
- 反向用例：handler `return false` 时宿主命令仍能接管（`Prec.highest` 只扩大触达，不让钩子变贪婪）。
- 最后一条用 `Alt-ArrowDown` 与显式 `Prec.default` 对手竞争，证明赢的是**优先级**而不是注册顺序。

### 范围外改动（必须知会）

1. **`SqlEditorIntentionSettingsJourney.test.tsx`**（宿主，不在 §三 改动表内）。把 `proSettings` 加进 `useMemo` 依赖后，`createIntentionExtensions` 在首次切换时合法地多跑一次，原有的"调用次数"断言失败。已改为断言**opts 本身**（`insertValueHints` / `databaseType` 不变）——这才是该测试真正要守的不变量，未削弱断言。
2. **`linterCompartment.tester.test.ts`**（Pro，不在改动表内）。该测试断言了 settings 项的**全量有序列表**，新增 `pasteAsIn` 后必须补一行。
3. **`tsconfig.json` 未改**。本分支落后 main 6 个 commit，仍带着排除 `__tests__` 的 `exclude` 块（main 的 `d14037e8b` 已删除该块并修掉由此暴露的 2014 个错误）。改 tsconfig 属越界，故改用临时 tsconfig（include 全部、无 exclude）单独验证本轨测试文件的类型，验证后已删除。详见「已知陷阱」第 2 条。

### 验收对照

| # | 项 | 结果 |
| --- | --- | --- |
| 1 | 3 个可选成员 + `Object.freeze` + null/空返回 | ✅ |
| 2 | 两侧均 `1.1.0`，Pro 清单 `{compatible:true}` | ✅（`security.test.ts` 读盘断言） |
| 3 | 版本不匹配 ⇒ `{compatible:false}` | ✅（`1.0.0` 与 `1.2.0` 均拒绝） |
| 4 | 新舱位不改 `ProCompartmentPayload` 类型即可遍历消费 | ✅（`'sql-folding'` 用例） |
| 5 | 生产走 `reconfigureProCompartments`，一次 dispatch | ✅（含 3 次单独派发的对照组） |
| 6 | G3 生效可证 | ✅（`pasteAsIn` 哨兵，见上） |
| 7 | keymap 不被抢占 | ✅（14 例，见上） |
| 8 | typecheck 干净（含测试） | ⚠️ **部分**，见下 |
| 9 | 相关 vitest 全绿 | ✅ 宿主 46 文件 / 570 例；Pro 63 文件 / 780 例 |
| 10 | `resolve-pro --edition=pro` 成功 | ✅ |

### 验收 8 的准确表述

`npx tsc --noEmit`（本分支 tsconfig）**干净，退出码 0**。但本分支 tsconfig 仍排除测试文件，所以它**不覆盖**验收 8 的"含测试文件"。改用临时 tsconfig（include 全量、去掉 exclude）后全量 2268 个错误中，**落在本轨文件里的为 0**；Pro 包 `npx tsc -p packages/pro-extensions/sql-editor-pro/tsconfig.json --noEmit` 退出码 0。剩余 2268 个是 main 已修、本分支尚未同步的历史欠账，不属本轨。

## 九、实测中新发现 / 已修正的陷阱

以下是 §五 之外，本轨动手过程中**实测**出来、或对 §五 结论做了修正的条目；§五 仍然有效。

1. **分支落后 main 6 个 commit，`tsconfig.json` 尚未同步**。本分支仍排除 `__tests__`，main 的 `d14037e8b` 已删除该排除块。合并前先同步 main，否则验收 8 无法在本分支被自动验证。
2. **`src/windows/connection/__tests__/epHotplugJourney.test.ts` 在本分支是坏的**（第 132 行用不存在的 mock key 调用 `reconfigureProCompartments`），main 已修。本轨的 `Record<string, Extension[]>` payload 类型 + 未挂载 id 兜底让它**运行时不再抛**，但类型/断言仍需靠合并 main 解决。**合并期关注点。**
3. **`engines.extensionPointsVersion` 在 `manifest.json` 里，不在 `package.json`**。本文件 §三 与验收 2 原文都写的 `package.json`，实为笔误；Pro `package.json` 根本没有 `engines` 字段。已按 `manifest.json` 落地。
4. **`compartments` 是模块级共享单例**，跨编辑器实例共享。已补多实例隔离测试（重配 A 不影响 B），但新增舱位 id 时仍须注意同一 `id` 在多实例间复用同一个 `Compartment`。
5. **未挂载的舱位 id 会合并进 `extra` 兜底槽**（`extra` 也未挂载时才 `console.warn`）。这让"扩展自带 id 在生产里忘了挂载"变成静默降级而非崩溃，是可用性换可观测性——真实打包产物需要日志侧确认。
6. `SafeCompartmentWrapper` 抛错会注销**整个 EP**，`onCircuitBreak` 未接线。本轨未修，但新增的三个钩子都包在 wrapper 内，已有用例覆盖"抛错后编辑器仍可用"。
7. **`createPasteExtensions()` 不传 opts 会在 `proFeatures.ts:202` 抛 TypeError**（`opts.onDrop` 缺可选链）。**属既有缺陷，与本轨无关**，本轨未改以免扩大 diff；宿主始终传 opts，当前不可达。
8. `pack-ep.mjs` 的 `HOST_SHARED_MODULES` 窄白名单 vs Pro `vite.config.ts` 的 `/^@codemirror\//` 宽 externalize 是**有意保留的差异**（G1/P1 关注点），**不要在合并时被"顺手抹平"**。
9. **修正 §五 最后一条**：`createExtraKeymap` 的"会被 `copyLineUp/Down` 吃掉"这一说法**键位写错了**。实测 `defaultKeymap` 的绑定是 `Shift-Alt-ArrowUp`→`copyLineUp`、`Alt-ArrowUp`→`moveLineUp`、`Mod-Alt-ArrowUp`→`addCursorAbove`；`Mod-Alt-ArrowUp` 归 `addCursorAbove`（多光标），不是 `copyLineUp`。结论（需要 `Prec.highest`）不变，但**冲突键清单以 §八 为准**。
10. **`defaultKeymap` 并非"恒返回 true"**：只有 `copyLine*` / `addCursor*` 这类"有活就干"的命令如此；`moveLineUp` 在文档首行会返回 `false`。因此 keymap 类测试不能只看 handler 是否被调用，要看**视图是否真的变化**（`addCursorAbove` 只改 selection 不改 doc）。
