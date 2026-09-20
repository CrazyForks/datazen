# Track: decouple-docs — 驱动↔宿主解耦契约文档收口

- 分支: `feature/decouple-docs`（基准 `feat/driver-decoupling` @ d172476fc）
- 角色: Coder → Tester
- 性质:**纯文档轨**，零生产代码改动（与并行轨 `i18n-drivers` 文件面完全互斥）

## 背景

`feat/driver-decoupling` 分支已完成 5 条轨：`cn-to-ui`（驱动统一用 `@datazen/ui` 的 `cn`）、`types-to-sdk`（共享类型下沉 `@datazen/driver-sdk/src/types/*`）、`fix-redis-tests`、`i18n-core`（`packages/ui/src/i18n.ts` 单一 i18n 运行时）、`cap-bridge`（宿主值能力下沉 + `bind*`/`useBound*` 注入桥）。文档仍停留在解耦前的描述，且**并行轨 `i18n-drivers` 正在落地"驱动词条自注册"**。本轨负责把新契约写成一份可直接照做的规范，供 Wave 4 的 import 护栏与后续 git 驱动作者使用。

## 必读（先读后写，禁止凭想象描述 API）

1. `AGENTS.md`、`docs/development/subagent/coder.md`、本文件。
2. 代码现状（以文件实际内容为准）：
   - `packages/ui/src/i18n.ts`（`setLocale`/`getLocale`/`registerTranslations`/`t`/`useI18n`）
   - `packages/driver-sdk/src/index.ts` 与其 `types/`、`ipc/`、`*Bridge.ts` 各模块
   - `packages/driver-sdk/src/{settingsStoreBridge,connectionStoreBridge,confirmDialogBridge}.ts`、`src/lib/nativeContextMenu.ts`、`src/hooks/useConfirmDialog.tsx`、`src/stores/*.ts` 中的 `bind*` 调用点
   - `src/lib/localeSync.ts`、`src/main.tsx`、`src/extensions/generated.ts`
   - `scripts/resolve-drivers.mjs`（驱动 codegen 与 `--drivers` 语义）
3. 既有文档：`docs/development/driver-api-dependency-boundary.md`、`docs/development/independent-driver-development.zh-CN.md` 与 `.en.md`、`docs/architecture/frontend/extensibility.md`、`docs/architecture/frontend/components.md`、`docs/development/coordination/tracks/{cap-bridge,i18n-core,types-to-sdk,cn-to-ui}/progress.md`（各轨 Coder/Tester 记录是权威落点清单）。

## 范围

1. **主交付**：重写/扩写 `docs/development/driver-api-dependency-boundary.md` 为「驱动前端与宿主解耦契约」，至少覆盖：
   - 允许 import 面：`@datazen/ui`（基础组件 + `cn` + i18n）、`@datazen/driver-sdk`（元数据/方言/Command/下沉类型/IPC 封装/注入桥）、`@datazen/extension-points`（仅 EP 契约类型）、npm 依赖；**禁止** `../../../src/**` 形态的宿主 import（含 `src/hooks`、`src/stores`、`src/lib`、`src/types`、`src/components`、`src/locales`）。
   - 宿主能力取用模式：纯函数/IPC → 直接下沉 driver-sdk；需要宿主 store/hook 运行时状态 → `bindX()` + `useBoundX()` 注入桥模式（给出宿主 bind 时机与驱动侧用法各一段最小代码示例，示例必须与实际 API 签名一致）。
   - i18n 契约：单一实现、`setLocale` **仅宿主**调用、词条由各 package 自注册（`packages/drivers/<id>/locales/index.ts` 由驱动 UI 入口 `ui/shared/meta.ts` 挂副作用 import、`<driverId>.` key 前缀、驱动侧 `t()` key 为普通 `string`、parity 由 `scripts/i18n-sync-check.mjs` 扫描 `packages/drivers/*/locales/`）。**并注明该自注册由并行轨 `i18n-drivers` 同期落地**，避免读者误以为已合并。
   - 新增能力时的落点决策表（下沉 driver-sdk / 建注入桥 / 留宿主 / 走 EP 插槽），以及"为什么不用 bridge 式回退查表"的一句话理由（防止后人重新引入）。
   - Wave 4 将上的 import 护栏预告（ lint 规则名/CI 位置尚未定，写成"待 Wave 4 落地"，不要编造脚本文件名）。
2. **同步开发者指南**：`docs/development/independent-driver-development.zh-CN.md` 与 `.en.md`（两份内容必须一一对应，英文版为中文直译，术语一致）中涉及前端 UI 的章节：把"从宿主 import"的旧示例改为新契约写法；补 i18n 与能力桥两小节（可引用第 1 项文档，不重复长篇）。
3. **勘误**：`docs/architecture/frontend/components.md`、`extensibility.md` 中与现状不符的 `@datazen/ui` / driver-sdk / i18n 描述（如仍提到 `HostLocaleBridge`、`src/lib/cn`、宿主类型出处）逐条改正；`AGENTS.md` 仅在确有一处错误时最小修改（默认不动，避免与其他轨竞争）。
4. 每处改动在 progress.md 记录「文件 → 改了哪一节 → 依据哪个源文件行」，便于 Tester 核对代码事实。

## 禁止事项

- **零生产代码/脚本/测试文件改动**（`git diff --name-only` 必须全部落在 `docs/**`；若动了 `AGENTS.md` 需在 progress 说明理由）。
- 不创建新的驱动 README（`i18n-drivers` 轨负责驱动目录内 README 的词条自注册说明，避免重复）。
- 不动 `docs/development/coordination/hub.md`、其他轨 `progress.md`/`bugs.md`。
- 不写"计划/分析"类新文档堆砌：优先在既有文档内改写；新增文件仅限确无合适落点时（须在 progress 说明）。
- 描述任何 API 前先读源码；**禁止**写出与代码不一致的签名、文件名或命令。
- 禁止 `pnpm install`；搜索用 Grep 工具；不提交 codegen 产物、`Cargo.lock`、`src-tauri/Cargo.toml` 注入段。

## 验收标准

1. `git diff --name-only` 仅含 `docs/**`（至多 1 处 `AGENTS.md` 且已说明）。
2. 文档中出现的所有 import 路径、包名、函数名、文件路径、命令，可被 grep/test 验证为真实存在（Tester 需抽验 ≥10 处并列表）。
3. 全文检索新文档：无 `HostLocaleBridge`、`setHostLocaleBridge`、`src/lib/cn`、`../../../src/`（作为推荐写法出现即为不合格；作为"禁止示例"出现需明确标注为反例）。
4. `independent-driver-development.zh-CN.md` 与 `.en.md` 章节结构一一对应（Tester 比对标题列表）。
5. 内部链接全部可达：文档内所有相对链接指向的文件存在（Tester 逐条校验）。
6. `npx tsc --noEmit -p tsconfig.json` 与 `node scripts/aggregate-hub.mjs` 结果不受影响（文档轨不应触发；仍需自证未误改代码）。

## 状态

- [x] Coder 完成 → READY_FOR_TEST（commits `da30426b3` / `9a88c7778` / `8ac2705d2` / 本记录 commit）
- [x] Tester 复测 → **TEST_FAILED**（4 个 Bug 待修复，见 `bugs.md`；结构类验收全部通过，仅事实/引用一致性问题）
- [ ] Tester 复测 → TEST_DONE

## Tester 复测记录（commit `6199d9d95`，全新实例独立实测，不采信 Coder 自报）

工作目录 `.worktrees/datazen-decouple-docs` @ `feature/decouple-docs`；基线 `d172476fc`；本 worktree 起始 `git status --short` 干净。

### 阶段 A：实现审查 + 事实一致性抽验

1. **diff 范围（越界检查）**：`git diff --name-only d172476fc..HEAD` → **6 个文件，全部 `docs/**`**；`git diff --stat d172476fc..HEAD -- src packages scripts src-tauri e2e AGENTS.md` → **空输出**（零代码影响，AGENTS.md 确实未改）。逐文件读 diff，未见夹带越界改动。
2. **一致性抽验清单：47 项断言 → 43 项命中，命中率 91.5%；4 项不一致 → `decouple-docs-BUG-001..004`**（覆盖 Coder 自验 1-14 全部条目，另加 33 项扩展核对）。

| # | 文档断言（位置） | 实测出处与结果 |
| --- | --- | --- |
| 1 | `@datazen/ui` 导出 11 组件 + `cn` + 5 个 i18n API + `I18nParams`（2.1.1） | `packages/ui/src/index.ts:1-30` 逐项命中 ✅ |
| 2 | driver-sdk 允许面全清单：`DatabaseTypeMeta`/`ConnectionMode`/`BaseTableSqlGenerator`/下沉类型/`driverCommands`/`fileCommands`/6 纯函数+`HOST_DEFAULT_EDITOR_FONT`/5 菜单 API/`bind*`+`useBound*`/6 Schema API（2.1.1） | `packages/driver-sdk/src/index.ts:7-134` 逐项命中 ✅ |
| 3 | 「`@datazen/extension-points` 不导出任何 i18n 能力」（2.1.1 / 2.4.1） | Grep `i18n\|registerTranslations\|setLocale\|useI18n` on `packages/extension-points/src/` → **0 命中** ✅ |
| 4 | EP 先例 `sqlEditorProEP`（2.2 行 5） | `packages/extension-points/src/index.ts:27` ✅ |
| 5 | 三处 alias 一致（2.1.1） | `tsconfig.json:18-24`、`vite.config.ts:27-33`、`vitest.drivers.config.ts:9-15` ✅ |
| 6 | `pnpm test:unit:drivers`（2.1.1） | `package.json:86` `vitest run --config vitest.drivers.config.ts` ✅ |
| 7 | 5 个 bridge + 未绑定抛错文案（2.2 / 2.3.1） | `grep -rn "has not been bound to driver-sdk yet"` → SettingsStore/ConnectionStore/ConfirmDialog/SchemaStore/ContextMenu 各 1 处，文案与文档模板完全一致 ✅ |
| 8-12 | 宿主 bind 时机 5 处（2.3.1 表） | `settingsStore.ts:197`、`connectionStore.ts:248`、`schemaStore.ts:694`、`useConfirmDialog.tsx:69`、`contextMenuStore.ts:40-43`（含 `show: showWebContextMenu`）✅ 行号逐条命中 |
| 13 | `hide` 未绑定为安全 no-op（2.3.1 约束 2） | `packages/driver-sdk/src/nativeContextMenu.ts:104-111`（`if (!boundBridge) return;` + 同因注释）✅ |
| 14 | 桥类型只暴露子集，`SettingsBridgeState` 只有 `settings.safeMode/editorFontFamily/driverSettings`（2.3.1 约束 3） | `settingsStoreBridge.ts:11-17` ✅ |
| 15 | `useBoundConnectionStore` 仅 selector/`getState`（2.3.1 表，无 setState） | `connectionStoreBridge.ts:38-41` ✅ |
| 16 | `useBoundConfirmDialog(): [ConfirmDialogFn, ReactNode]`（2.3.1 表） | `confirmDialogBridge.ts:28/36` ✅ |
| 17 | 用法示例（2.3.2） | `SafeModeBadge.tsx:10` selector 形态；`useRedisGate.ts:28` 二元组、`:32` `getState()`、`:36-41` `confirm({... kind})` ✅ |
| 18 | 「单测例外：测试内显式 bind」（2.3.1 约束 1） | `packages/drivers/redis/ui/__tests__/useRedisGate.test.tsx:33` `bindSettingsStore(harness…)`、`:78/96/115/138` `bindConfirmDialog(…)` ✅ |
| 19 | 唯一运行时 5 签名 + 查找链 + `{param}` 插值 + `useSyncExternalStore`（2.4.1） | `packages/ui/src/i18n.ts:34/44/53/73/89`，查找链 `:74`，插值 `:63`，`:90` ✅（`registry[locale] ?? registry['en'] ?? key` 逐字符相符） |
| 20 | 宿主 `src/hooks/useI18n.ts` 为别名再导出（2.4.1） | 该文件 9 行，`:8` 副作用 import locales、`:9` `export { useI18n, type I18nParams } from '@datazen/ui'` ✅ |
| 21-22 | `startLocaleSync` 唯一接线 + `main.tsx` 调用一次（2.4.2） | `src/lib/localeSync.ts:18-26`、`src/main.tsx:66` ✅；Grep 全仓 `setLocale(` 生产调用方 = localeSync + `src/locales/index.ts:73/77`（getTranslation 适配器，见下方观察项）✅ |
| 23 | EP 经 `__DATAZEN_HOST__['@datazen/ui']` 共享单例（2.4.3） | `src/main.tsx:46-56`，`'@datazen/ui': ui` 在 `:48` ✅ |
| 24 | 宿主 eager 字典 `registerTranslations` 灌入（2.4.3 表） | `src/locales/index.ts:29-32` ✅ |
| 25 | lazy 域包经 `useLocaleDomains` / `ensureLocaleDomains`（2.4.3 表） | `src/locales/lazyPacks.ts:50`、`src/hooks/useLocaleDomains.ts:14` ✅ |
| 26 | 驱动前缀 `redis.*` / `mongo.*`（2.4.4） | `packages/drivers/redis/locales/en.ts:2-4`、`packages/drivers/mongodb/locales/en.ts:2-6` ✅ |
| 27 | `i18n-sync-check.mjs` 当前仅扫宿主 `src/locales`，驱动扫描随 i18n-drivers 加入（2.4.4） | `scripts/i18n-sync-check.mjs:21` `resolve(root,'src/locales')` ✅ 标注到位 |
| 28 | `BUILTIN_LOCALES` 佐证 `zh-CN`/`pt-BR` 连字符（2.4.3） | `builtinLocales.ts:9` 仅 `['en','zh-CN']`，**全文件无 `pt-BR`** ❌ **BUG-002** |
| 29 | `DRIVER_LOCALES` 聚合链路现存、终态由 i18n-drivers 删除（2.4.3） | `src/extensions/generated-locales.ts:14` + `scripts/resolve-drivers.mjs:432/437` ✅ 未来态框架与标注正确 |
| 30 | 驱动 `locales/index.ts` 自注册尚未存在（2.4.3 表） | `ls packages/drivers/{redis,mongodb}/locales/index.ts` → 均缺失；入口 `meta.ts` 无 `import '../locales'` ✅ 标注为同期落地，未冒充已交付 |
| 31 | redis 入口 `ui/shared/meta.ts`、mongodb 入口 `ui/meta.ts`（2.4.3 / extensibility 1.4） | `resolve-drivers.mjs:239`、`:270` ✅ |
| 32 | `generated.ts` codegen 符号（2.4.3 / extensibility 1.1、1.4） | `src/extensions/generated.ts:10`（redis 入口）、`:41`（`DatabaseType`）、`:44`（`DRIVER_DB_ENTRIES`）✅ |
| 33 | `src/types/index.ts` 的 `DatabaseType` 来自 generated（extensibility 1.4） | `src/types/index.ts:2` ✅ |
| 34 | `DB_REGISTRY` 在此合并驱动条目（extensibility 1.1） | `src/lib/databaseTypes.ts:10`（import）+ `:20-21`（`...DRIVER_DB_ENTRIES`）✅ |
| 35 | 唯一实现原则的薄再导出路径（2.1.2） | `src/lib/cn.ts:1`、`src/lib/nativeContextMenu.ts:7-15`、`src/commands/driver.ts:1-10`、`src/commands/file.ts:9/17` ✅ |
| 36 | 决策表行 1 先例 `src/lib/driverSettings.ts` → SDK（2.2） | SDK 侧存在，但宿主 `src/lib/driverSettings.ts` **已被整体移走、文件不存在** ❌ **BUG-003** |
| 37 | 行 4 先例 `src/lib/connectionViews/types.ts`（含 `ConnectionViewActions`） | 该文件 re-export 4 个类型含 `ConnectionViewActions` ✅ |
| 38 | 「过渡期例外…除上述两点外不存在任何豁免」（2.1.2） | `packages/drivers/sqlserver/ui/ConnectionFields.tsx:2` 同类宿主 import，未被登记 ❌ **BUG-001** |
| 39 | 反例污染扫描（验收 3） | 5 份文档 `HostLocaleBridge`/`setHostLocaleBridge`/`getExtensionTranslation` **0 命中**；`src/lib/cn`(3 处) 与 `../../../src/`(9 处) **逐处判定**：均在带 `❌ 反例` 标注的代码块或「禁止/零新增」句内 ✅ |
| 40 | Wave 4 护栏不得杜撰（任务书 6） | 2.6 明确「具体脚本文件名与 CI 位置尚未确定（待 Wave 4 落地）」；`scripts/` 下仅无关的 `check-structure-editor-guardrails.mjs`，无 import 护栏 ✅ |
| 41 | Redis Key 菜单 builder 路径勘误（components.md 9.1.1） | `packages/drivers/redis/ui/key-browser/redisKeyContextMenu.ts` 存在、旧路径 `ui/redisKeyContextMenu.ts` 不存在、`RedisWorkbench.tsx:28` 相对引用 ✅ 勘误正确 |
| 42 | components.md 其余入口未被误伤 | `WebContextMenu.tsx`+`App.tsx:100` 挂载 `WebContextMenuHost`、`contextMenuPosition.ts`、4 个宿主 builder 文件均存在 ✅ |
| 43 | extensibility 1.4 新增的 `.drivers-dev.json` / registry 说法 | `drivers-registry.json` 存在、`resolve-drivers.mjs:54` 读取 `.drivers-dev.json`（注释 `:53` 标 gitignored）✅ |
| 44 | Part 1「逐字未动」 | `git diff 824c7830b..HEAD` 对 Part 1 只有顶部 H1 一行被替换 ✅；抽查 Part 1 事实：`PROTOCOL_VERSION` → `packages/driver-api/src/lib.rs:73`，workspace path 依赖 → `Cargo.toml:16` ✅ |
| 45 | 相对链接可达（验收 5） | 一次性 node 脚本（写在 `/tmp`，跑完已 `rm`，仓库内零残留）解析 5 份文档全部相对链接：**14 条，broken 0** ✅ |
| 46 | zh/en 章节一一对应（验收 4） | `#`×1 + `##`×13 + `###`×7 = **21 : 21**，序号/层级/顺序逐行对应（1-13 + 可选小节 + 6.1/6.2/6.3）✅；但 progress.md 自报「各 24 个」失真 ❌ **BUG-004** |
| 47 | `sideEffects: false`（2.3.1 约束 4） | `packages/driver-sdk/package.json` 实测 `"sideEffects": false` ✅ |

### 阶段 B：独立复跑（实测数字）

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | **exit 0**，0 error ✅ |
| `node scripts/aggregate-hub.mjs` | exit 0，输出「聚合 11 个 tracks」；随后 `git status --short` **仅 ` M docs/development/coordination/hub.md`**（证明本轨未污染聚合总览，重跑结果与提交态一致）；已 `git checkout -- hub.md` 恢复，**hub.md 未提交** ✅ |
| `node scripts/check-id-terminology.mjs`（`pnpm test:ids`） | exit 0，「5 allow-listed occurrence(s) skipped / ok（1714 files scanned）」✅ |
| `node scripts/check-ci-docs-consistency.mjs`（`pnpm test:ci-docs`，文档一致性守卫） | exit 0，drivers 11 ids / window boundaries / toolchain 三项全 ok ✅ |
| `node scripts/check-module-layers.mjs`（`pnpm test:layers`） | exit 0，「ok（3 rules）」✅ |
| `git diff --stat d172476fc..HEAD -- src packages scripts src-tauri e2e AGENTS.md` | **空**（零代码影响）✅ |

说明：文档轨不跑 `vitest`/`cargo test`（本轨未触碰任何可执行文件，上表 5 条守卫 + tsc 已覆盖「零回归」自证需要）。

### 阶段 C：一致性覆盖率（替代行覆盖率）

- 可验证断言总数 **47**，实测核对 **47**（100% 覆盖，未留未核项），命中 **43**，命中率 **91.5%**。
- 4 处不一致全部登记为 Bug（BUG-001 中级 / BUG-002、003、004 低级），均为「文档写 X / 代码实为 Y」型引用与清单完整性问题，**不涉及契约结论错误**：允许面/禁止面、5 桥清单、i18n 五 API、决策表主落点、勘误方向经核对全部为真。
- 残余风险（未列入 Bug 的观察项，见 `bugs.md` 末节）：2.4.2「唯一接线点」措辞与 `getTranslation()` 的临时 `setLocale` 存在可读性歧义；Part 1 遗留 `"0.1"` 版本示例与 crate 实测 `0.0.8` 不吻合（历史文本，不在本轨范围）。

### 阶段 D：留待 R 回归

- 本轨无需 E2E。文档指导出的后续验证点（Wave 4 护栏落地时必须拦住、且当前**无法**由本轨验证的行为）：
  1. `packages/drivers/*/ui/**` 内任意 `.../src/` 形态 import —— 现网基线应为 **32 处**（redis 31 + sqlserver 1，见 BUG-001）+ `redisKeyWebContextMenu.test.tsx` 夹具 2 处（已裁决豁免）；护栏白名单必须与该口径一致，否则落地即红。
  2. 驱动/EP 生产代码的 `setLocale` 调用（宿主 `localeSync.ts` 接线与 `getTranslation` 适配器需白名单区分）。
  3. 驱动 `t()` key 断言宿主 `I18nKey`（2.4.4）与新增宿主聚合 codegen（2.4.3 禁止项）。
- i18n 自注册终态（`locales/index.ts`、入口副作用行、`DRIVER_LOCALES` 删除、`i18n-sync-check` 驱动扫描）在 `i18n-drivers` 轨合并后需**回扫本文件 2.4.3**，把「同期落地」措辞改为已交付并核对实际模块名一致。


## Coder 实施记录

### Commit 索引

| commit | 主题 | 文件 |
| --- | --- | --- |
| `da30426b3` | 主交付：解耦契约重写 | `docs/development/driver-api-dependency-boundary.md` |
| `9a88c7778` | 开发者指南同步（zh/en 一一对应） | `docs/development/independent-driver-development.zh-CN.md`、`.en.md` |
| `8ac2705d2` | 架构文档勘误 | `docs/architecture/frontend/components.md`、`extensibility.md` |
| （本 commit） | 实施记录 + 状态推进 | 本文件 |

### A. `docs/development/driver-api-dependency-boundary.md`（重写）

保留原 Rust Part 1 全文（降级为「Part 1」章节，内容逐字未动）；新增「Part 2 · 驱动前端与宿主解耦契约」：

| 小节 | 内容 | 依据源文件（核对行） |
| --- | --- | --- |
| 2.1.1 允许 import 面表 | `@datazen/ui` / `@datazen/driver-sdk` / `@datazen/extension-points` / npm | `packages/ui/src/index.ts:1-30`（组件+cn+i18n 导出清单）；`packages/driver-sdk/src/index.ts:7-134`（方言/类型/IPC/driverSettings/右键菜单/bridge 导出清单）；`packages/extension-points/src/index.ts:5-55`（EP 契约导出、无 i18n）；`tsconfig.json:19-23`、`vite.config.ts:28-32`、`vitest.drivers.config.ts:9-15`（三处 alias 一致） |
| 2.1.2 禁止面 + 反例块 | `../../../src/**` 违规；过渡期例外两条 | 例外1 实测 `packages/drivers/redis/ui/**`（如 `connection/ClusterNodePicker.tsx:5`）尚存宿主 useI18n 相对 import（i18n-drivers 轨范围）；例外2 `packages/drivers/redis/ui/__tests__/redisKeyWebContextMenu.test.tsx` 存在性经 find 核实（cap-bridge progress.md 裁决段） |
| 唯一实现原则 | 宿主薄再导出 | `src/lib/cn.ts`（整文件 `export { cn } from '@datazen/ui'`）、`src/lib/nativeContextMenu.ts:7-15`、`src/commands/driver.ts:1-10`、`src/commands/file.ts:9/17`（合并再导出） |
| 2.2 决策表 | 5 分支落点 + 「为何不做回退查表」 | 先例列全部指向 A 表已核实文件；EP 先例 `sqlEditorProEP`（`packages/extension-points/src/index.ts:27`） |
| 2.3.1 bridge 清单表 | 5 桥 + 宿主 bind 时机与未绑定抛错 | `settingsStoreBridge.ts:27-36`/`settingsStore.ts:197`；`connectionStoreBridge.ts:27-36`/`connectionStore.ts:248`；`confirmDialogBridge.ts:32-41`/`useConfirmDialog.tsx:69`；`schemaStoreBridge.ts:24-33`/`schemaStore.ts:694`；`nativeContextMenu.ts:18-26`/`contextMenuStore.ts:40-43`（`show: showWebContextMenu`，`showWebContextMenu` 定义于 `contextMenuStore.ts:30`）；`sideEffects:false` 见 `packages/driver-sdk/package.json` |
| 2.3.2 用法示例 | selector / getState / confirm 二元组 | 逐行对照 `packages/drivers/redis/ui/shared/SafeModeBadge.tsx:10`、`useRedisGate.ts:28/32/36-41`、`src/stores/settingsStore.ts:193-197` |
| 2.4.1 唯一运行时五 API + 查找链 | `registry[locale] ?? registry['en'] ?? key`、`{param}` 插值 | `packages/ui/src/i18n.ts:34-92`；EP i18n 删除现状见 `packages/extension-points/src/`（无 i18n.ts，全仓 grep `HostLocaleBridge` 生产代码 0 命中）；宿主别名定位 `src/hooks/useI18n.ts:1-9` |
| 2.4.2 setLocale 仅宿主 | `startLocaleSync` 唯一接线 | `src/lib/localeSync.ts:18-26`、`src/main.tsx:66`；全仓 `setLocale(` 生产调用方 grep 仅 `src/lib/localeSync.ts` + `src/locales/index.ts`（getTranslation 工具适配器） |
| 2.4.3 词条归属表 + 自注册终态 | 宿主 eager/lazy、驱动 locales/index.ts 自注册、EP 直连；**显式标注「由 i18n-drivers 轨同期落地」** | 现状基线：`src/locales/index.ts:29-32`（registerTranslations 灌入）、`src/locales/lazyPacks.ts:50`、`src/main.tsx:46-56`（`__DATAZEN_HOST__['@datazen/ui']`）；终态描述逐条对齐 `.worktrees/datazen-i18n-drivers/docs/development/coordination/tracks/i18n-drivers/progress.md`（只读参考）A1-A3/C 节；驱动入口实例 `scripts/resolve-drivers.mjs:239`（redis `ui/shared/meta`）与 `:270`（mongodb `ui/meta`）、`src/extensions/generated.ts:10-11` |
| 2.4.4 key 前缀/普通 string/parity | `redis.*`、`mongo.*` 前缀实测 | `packages/drivers/redis/locales/en.ts:1-3`、`packages/drivers/mongodb/locales/en.ts:1-5`；`scripts/i18n-sync-check.mjs:21`（当前仅扫 `src/locales`，故标注驱动扫描随 i18n-drivers 加入）；locale code 对照 `src/locales/builtinLocales.ts:9` |
| 2.4.5 t() 注入先例 | `DriverFormValidator` 第二参 `t` | `packages/driver-sdk/src/index.ts:49-60` |
| 2.5 流程 / 2.6 Wave 4 预告 / 2.7 清单 | 护栏仅写「待 Wave 4 落地」，未杜撰脚本名 | 任务书设计红线 |

### B. `docs/development/independent-driver-development.zh-CN.md` / `.en.md`（同步）

| 改动 | 依据 |
| --- | --- |
| §2 布局树新增 `locales/` 行（两份对应） | 驱动词条目录现实（`packages/drivers/redis/locales/`、`mongodb/locales/`） |
| §6 重写：末段接契约 Part 2 链接；新增 6.1（允许/禁止 import 面 + ❌/✅ 示例）、6.2（下沉 + 注入桥 + tsx 示例）、6.3（i18n 单一运行时 + 自注册终态，标注 i18n-drivers 同期落地） | 全部复用 A 表已核实出处；旧文无字面「从宿主 import」代码示例，按任务书以新契约示例替换泛化描述 |
| §13 总结各加一条前端边界 bullet（两份对应） | 与 6.1-6.3 一致 |
| 标题结构：zh/en 均 24 个 `#` 级标题、顺序一一对应（见自验 5） | — |

### C. `docs/architecture/frontend/components.md` / `extensibility.md`（勘误）

| 文件 → 节 | 改动 | 依据 |
| --- | --- | --- |
| components.md §9.1.1 入口列表 | `src/lib/nativeContextMenu.ts` 条目改为 `@datazen/driver-sdk` 唯一实现 + 宿主薄再导出 + `bindContextMenuBridge` 注入点 | `packages/driver-sdk/src/nativeContextMenu.ts:18`、`src/stores/contextMenuStore.ts:40-43`、`src/lib/nativeContextMenu.ts:7-15` |
| components.md §9.1.1 builder 表 | Redis Key 行路径修正为 `packages/drivers/redis/ui/key-browser/redisKeyContextMenu.ts` | find 实测（原路径文件不存在） |
| extensibility.md §1.1 条目1 | 补注驱动条目经 codegen `DRIVER_DB_ENTRIES` 合并 | `src/lib/databaseTypes.ts:10/20-21`、`src/extensions/generated.ts:44` |
| extensibility.md §1.4 清单 | 由「手改 types/index.ts + databaseTypes.ts」改为驱动包 + registry + codegen 流程，并链接契约/指南 | `src/types/index.ts:2`（DatabaseType re-export 自 generated）、`src/extensions/generated.ts:41`、`scripts/resolve-drivers.mjs:220/239/270`、`drivers-registry.json` 机制（指南 §3/§4） |
| AGENTS.md | **未改动**（未发现确凿事实错误；@datazen/ui 组件列举不完整但不算错误，遵守默认不动原则） | — |

### 自验结果（真实输出，worktree=`.worktrees/datazen-decouple-docs`）

1. `git diff --name-only d172476fc..HEAD` → 6 个文件全部 `docs/**`：
   `docs/architecture/frontend/components.md`、`docs/architecture/frontend/extensibility.md`、`docs/development/coordination/tracks/decouple-docs/progress.md`（任务书 commit `824c7830b` 自带）、`docs/development/driver-api-dependency-boundary.md`、`docs/development/independent-driver-development.en.md`、`.zh-CN.md`。零生产代码改动。
2. API/路径/命令抽验 ≥10 处（文档片段 → 代码出处）：

   | # | 文档片段 | 验证出处 |
   | --- | --- | --- |
   | 1 | `@datazen/ui` 导出 `setLocale/getLocale/registerTranslations/t/useI18n` | `packages/ui/src/index.ts:23-30`、`packages/ui/src/i18n.ts:34-92` |
   | 2 | 未绑定抛错文案 `'<X> has not been bound to driver-sdk yet.'` | driver-sdk 5 个 bridge 模块各 1 处（grep -c 全中） |
   | 3 | `bindSettingsStore(useSettingsStore)` 于宿主 store 文件末尾 | `src/stores/settingsStore.ts:197` |
   | 4 | `bindContextMenuBridge({ show: showWebContextMenu, hide })` | `src/stores/contextMenuStore.ts:40-43` |
   | 5 | `useBoundSettingsStore((s) => s.settings.safeMode)` 示例 | `packages/drivers/redis/ui/shared/SafeModeBadge.tsx:10` |
   | 6 | `const [confirm, dialog] = useBoundConfirmDialog()` 示例 | `packages/drivers/redis/ui/shared/useRedisGate.ts:28` |
   | 7 | `setLocale` 宿主唯一接线 | `src/lib/localeSync.ts:18-26` + `src/main.tsx:66`（全仓 grep 生产调用方仅此+getTranslation 适配器） |
   | 8 | `DriverFormValidator` 第二参数 `t: (key: string) => string` | `packages/driver-sdk/src/index.ts:59` |
   | 9 | 下沉类型清单 `ConnectionFormState`/`KeyEntry`/`KeyScanResult`/`NativeMenuItemDef`/`ConnectionViewProps` | `packages/driver-sdk/src/{types/connection-form.ts,types/kv.ts,types/menu.ts,types/connection-view.ts}` + index.ts:29-43 |
   | 10 | 命令 `node scripts/i18n-sync-check.mjs`、`pnpm test:unit:drivers` | `scripts/i18n-sync-check.mjs` 存在；`package.json:86` |
   | 11 | alias 三处一致（tsconfig/vite/vitest.drivers） | `tsconfig.json:19-23`、`vite.config.ts:28-32`、`vitest.drivers.config.ts:9-15` |
   | 12 | redis 入口 `ui/shared/meta.ts`、mongodb 入口 `ui/meta.ts`（前缀 `redis.*`/`mongo.*`） | `scripts/resolve-drivers.mjs:239/270`、`src/extensions/generated.ts:10-11`、两包 `locales/en.ts` 首行 key 前缀 |
   | 13 | BUILTIN_LOCALES 字面量（`zh-CN`/`pt-BR` 连字符规则所指） | `src/locales/builtinLocales.ts:9` |
   | 14 | `sideEffects:false`（bridge 禁顶层副作用依据） | `packages/driver-sdk/package.json` |
3. 违禁词扫描：新写/改动的 5 份文档 grep `HostLocaleBridge|setHostLocaleBridge|getExtensionTranslation` = 0；`../../../src/` 与 `src/lib/cn` 仅出现在 ❌ 反例块与禁止性表述中（逐条核对于本记录）。
4. `npx tsc --noEmit -p tsconfig.json` → **exit 0**。`node scripts/aggregate-hub.mjs` 未运行（避免改写禁止触碰的 hub.md）；diff 不含 `scripts/**` 与任何代码，结论等价。
5. 相对链接校验：5 份文档共 14 条相对 markdown 链接，Node 脚本逐条 exists 检查 → **broken: 0**。
6. zh/en 标题对照：各 24 个标题、序号与顺序一一对应（1-13 + 6.1/6.2/6.3 + 无编号小节，清单见上方命令输出）。

### 偏离与说明

- 无范围缩窄。两处主动决策：① 主文档采用「Part 1 原文保留（英文不动）+ Part 2 中文新契约」双部结构，因该文件被 `docs/README.md`、`external-contract-policy.md` 以路径引用且历史引用方均为英文语境；② extensibility.md §1.4 原「手改宿主注册表」清单被判定为任务书「宿主类型出处」类过期描述，一并勘误（改动限于该节与 §1.1 一条注记）。
- i18n 自注册、`i18n-sync-check` 驱动扫描、`DRIVER_LOCALES` codegen 删除均按任务书终态描述并显式标注「由 i18n-drivers 轨同期落地」；redis UI 现存宿主 useI18n 相对 import 作为过渡期例外登记（含唯一豁免测试文件），与并行轨文件面零冲突（本轨仅 `docs/**`）。

## 留待 R 回归

- 本轨无 E2E（纯文档）。后续验证点已由 Tester 登记在上方「阶段 D：留待 R 回归」：Wave 4 import 护栏落地时的 32 处现网基线白名单口径（BUG-001）、驱动侧 `setLocale` 拦截、以及 `i18n-drivers` 合并后回扫 2.4.3 的措辞与模块名。
