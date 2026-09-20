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
- [ ] Tester 复测 → TEST_DONE

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

- 无（文档轨）。
