# Track: i18n-core — 全应用唯一 i18n 实现进 @datazen/ui（无 bridge）

- 分支: `feature/i18n-core`（基准 `feat/driver-decoupling` @ c3058fdd0）
- 角色: Coder → Tester
- Wave 2 并行轨道之一（cap-bridge 不碰 useI18n/PathInput，本轨独占它们）

## 已批准架构（用户 spec，不得偏离）

1. **@datazen/ui 是唯一实现**：模块私有 `currentLocale` + 词条注册表 + listeners。导出且仅导出：
   - `setLocale(locale: string): void` — 切换语言并通知订阅者。**只有 host 调用**（编译期无法限制，Wave 4 lint 兜底）。
   - `getLocale(): string`
   - `registerTranslations(resources: Record<locale, Record<key, string>>): void` — host/驱动/扩展共用的唯一注册入口
   - `t(key: string, params?: Record<string, string|number>): string` — `registry[locale] ?? registry['en'] ?? 插值(key)`；`{param}` 插值
   - `useI18n(): { t, language }` — `useSyncExternalStore` 订阅 locale 变化
2. **删除 extension-points 的 bridge 模型**：`packages/extension-points/src/i18n.ts` 整文件删除（`HostLocaleBridge`/`setHostLocaleBridge`/`subscribeHostLocale`/`getCurrentHostLocale`/`getExtensionTranslation` 全部消失，**不留 re-export 兼容层**）；`index.ts` 不再导出 i18n。EP 回归纯契约包。
3. **editor-pro 直连 @datazen/ui**：`packages/pro-extensions/sql-editor-pro/src/locales/index.ts` 的 `registerTranslations`、以及其 ui 代码里从 '@datazen/extension-points' import 的 `useI18n`/`t` → 改 `from '@datazen/ui'`。加载机制已核实安全：pack-ep 的 `rewriteEpImportsToHostGlobals` 把裸 import 重写为 `globalThis.__DATAZEN_HOST__['@datazen/ui']`（宿主实例单例，main.tsx:47 已注册）。注意 pro-extensions 子仓的 commit 也要打（独立 git 仓库则按其 README 流程；若在本 worktree 内可直接提交）。
4. **宿主接线**：
   - `src/main.tsx`：删除 `setHostLocaleBridge({...})` 调用块；启动时 `setLocale(useSettingsStore.getState().settings.language ?? 'en')`，并订阅 language 字段变化 → `setLocale(next)`。
   - `src/hooks/useI18n.ts`：不再自持实现，改为从 @datazen/ui re-export（宿主 300+ 消费文件零改动，避免第二套运行时）。
   - **词条归属不变（本轨不动）**：宿主 dictionaries 仍由 `src/locales/*` 拥有并惰性加载；驱动 `t()` 暂时继续解析宿主 `redis.*` key，词条迁入驱动包是 Wave 3 i18n-drivers 的事。
   - **单一查找引擎约束**：合并后运行时只允许一处"查表+插值+回落"实现（@datazen/ui）。宿主 `src/locales/index.ts`/`t.ts` 现为独立实现且带 `I18nKey` 类型与域包加载逻辑——由你设计收敛：宿主字典在加载时 `registerTranslations()` 灌入注册表，宿主查找委托 @datazen/ui 的 `t`；`I18nKey` 模板字面量类型可保留作编译期约束（类型不是运行时实现）。禁止出现"宿主一套查表 + ui 一套查表"双实现并存。
   - 连带清理宿主中引用被删 EP i18n 符号的文件（如 `src/locales/index.ts:12,73-85` 的 `getExtensionTranslation`）。
5. **PathInput 下沉**：`src/components/ui/PathInput.tsx`（73 行，仅依赖 react/lucide/tauri-dialog/@datazen/ui Input/Button/cn/useI18n）移入 `packages/ui/src/PathInput.tsx` 并从 index 导出；宿主 `src/components/ui/PathInput.tsx` 删除、消费点改 import '@datazen/ui'；redis `connection/ConnectionWizard.tsx` 的 PathInput import 换源 @datazen/ui。**不动该文件其余宿主 import（useI18n 换源也归本轨）**。
6. **测试更新**：EP i18n 的既有测试、editor-pro locales.test.ts、宿主 locales/useI18n 相关测试随迁移调整；断言语义不得弱化。

## 禁止事项（防跨轨冲突）
- 不动 `settingsStore` 的 store 本体（cap-bridge 会 bind 它，本轨只在 main.tsx 订阅语言字段）。
- 不动 driver-sdk / 驱动除 ConnectionWizard 的 PathInput 行与 useI18n import 行以外的内容。
- 不引入新包（无 @datazen/i18n）。

## 验收标准
- Grep 全仓 `setHostLocaleBridge|HostLocaleBridge|getExtensionTranslation` = 0。
- `npx tsc --noEmit -p tsconfig.json` 0 错误。
- redis ui：`npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` = **218 pass / 0 fail**。
- 宿主 `npx vitest run src` 全绿（locales 域包惰性行为不变）。
- editor-pro：在其包目录跑其 vitest（若有）全绿；`resolve-pro.mjs` stage 流程不因 EP 契约变化报错（可只跑相关脚本单测）。
- 语言切换冒烟：settingsStore language 变化 → useI18n 消费组件重渲染（用单测证明订阅链路）。

## 状态

- [x] Coder 完成 → READY_FOR_TEST（编码 commit `a78badeb6`；editor-pro 子仓 commit `c60f7fc`，位于主检出 `packages/pro-extensions/sql-editor-pro`，独立仓库已提交）
- [ ] Tester 复测 → TEST_DONE

## Coder 自验记录（a78badeb6）

- Grep 全仓 `setHostLocaleBridge|HostLocaleBridge|getExtensionTranslation|subscribeHostLocale|getCurrentHostLocale` = 0（含 editor-pro 子仓）。
- `npx tsc --noEmit -p tsconfig.json`（worktree）= 0 错误。
- 宿主 `npx vitest run src` = 406 files / 4206 tests 全绿；全量 `npx vitest run`（含 EP/SDK/ui/scripts）= 435 files / 4477 tests 全绿。
- redis ui `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` = 218 pass / 0 fail。
- editor-pro 全套 `DATAZEN_ROOT=<worktree> npx vitest run` = 30 files / 277 tests 全绿（locales.test.ts 断言语义不变：en/zh 解析、未知 locale 回落 en、fresh bundle registerTranslations({en,'zh-CN'}) 快照）。
- 订阅链路单测：`src/lib/__tests__/localeSync.test.tsx`（settingsStore.language 变化 → setLocale → useI18n 消费组件重渲染）+ `packages/ui/src/__tests__/i18n.test.tsx`（唯一引擎查表/插值/回落）。

## 收敛设计说明（供 Tester/主代理审阅）

- 唯一运行时实现：`packages/ui/src/i18n.ts`（模块私有 currentLocale + registry + listeners），仅导出 `setLocale/getLocale/registerTranslations/t/useI18n`（+`I18nParams` 类型）。`setLocale` 仅宿主调用：宿主接线在 `src/lib/localeSync.ts`（main.tsx 启动 `startLocaleSync()`，订阅 settingsStore.language；未触碰 settingsStore 本体）。
- 宿主查找收敛：`src/locales/index.ts` 不再自持查表——模块加载时 `registerTranslations(DRIVER_LOCALES)` + 各 builtin eager 字典灌入共享注册表；lazy 域包在 `ensureLocaleDomains` 加载时注册（`lookupLazyTranslation` 已删除）。`getTranslation(locale,…)` 变为薄适配器：当前 locale 直接委托 ui `t`；异 locale 通过临时 setLocale 交换后委托同一引擎（仅测试/工具路径使用，不在 React 渲染路径）。`I18nKey` 模板字面量类型保留为编译期约束。
- `src/hooks/useI18n.ts` = `export { useI18n } from '@datazen/ui'`（驱动既有相对路径 import 与 vi.mock 均不受影响；驱动文件除 ConnectionWizard PathInput 行外零改动）。
- PathInput 下沉 `packages/ui/src/PathInput.tsx` 并从 index 导出；宿主文件删除；6 个消费点（含 redis ConnectionWizard）换源 '@datazen/ui'；2 个宿主测试的 vi.mock 改为对 '@datazen/ui' 的部分 mock。
- 已知取舍：共享注册表为后注册覆盖（旧引擎为查找期优先级；实测 host/driver/pro 词条集合互不相交，行为等价）；旧链末尾"回落 zh-CN"特例移除（en 为 source of truth，i18n-sync 保证 key 集合一致）；`unregisterLocale` 仅注销 locale 目录标签，共享注册表词条 append-only（相应调整 locales.test.ts 扩展 locale 用例使用独立 locale code，断言未弱化）。
- editor-pro 子仓裸 `tsc` 报 `@datazen/ui has no exported member`：因主检出 packages/ui 尚未含本轨导出，合并后自愈（vitest 经 DATAZEN_ROOT 别名验证已全绿）。

## 留待 R 回归

- （Tester 登记：设置页切语言 → 驱动 UI 文案实时刷新）
