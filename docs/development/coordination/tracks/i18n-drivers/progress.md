# Track: i18n-drivers — 驱动词条自注册 + 驱动 UI 统一使用 @datazen/ui i18n

- 分支: `feature/i18n-drivers`（基准 `feat/driver-decoupling` @ d172476fc，已含 Wave 1 全部 + i18n-core + cap-bridge）
- 角色: Coder → Tester
- 上游依据: 用户 2026-09-20 批准的 i18n 终态方案（见本文件「目标设计」），**不得重新提出备选方案**

## 目标设计（既定 spec，逐条落实）

1. `@datazen/ui` 是**唯一** i18n 运行时（`packages/ui/src/i18n.ts`：`setLocale` / `getLocale` / `registerTranslations` / `t` / `useI18n`）。无 bridge、无第二套查表引擎（i18n-core 轨已交付）。
2. **词条由各 package 自己提供并自注册**：驱动不再依赖宿主 codegen 聚合，改为驱动包自带 `locales/index.ts` 副作用模块，调用 `registerTranslations` 把自己全部语言的字典灌入共享注册表。
3. **只有宿主调用 `setLocale`**（`src/lib/localeSync.ts` 已接线）。驱动/扩展侧出现任何 `setLocale` 调用即违规。
4. `@datazen/extension-points` 不 re-export i18n（i18n-core 已删除 `src/i18n.ts`）；扩展与驱动一律直接 import `@datazen/ui`。
5. 已接受的权衡：驱动侧 `t()` 的 key 是普通 `string`，不再有编译期 `I18nKey` 校验；词条完整性由扩展后的 `scripts/i18n-sync-check.mjs` 扫描保证。

## 范围

### A. 驱动词条自注册

1. 新增 `packages/drivers/<id>/locales/index.ts`（当前有词条包的驱动：`redis`、`mongodb`）：
   - `import { registerTranslations } from '@datazen/ui';`
   - 静态 import 本目录**全部**语言文件（`en`、`zh-CN`、`zh-TW`、`de`、`es`、`fr`、`ja`、`ko`、`pt-BR`、`ru`）并按 locale code 组装后一次性 `registerTranslations(...)`；locale code 必须与宿主 `src/locales/builtinLocales.ts` 的 `BUILTIN_LOCALES` 字面量完全一致（`pt-BR` 带连字符）。
   - 纯副作用模块：不导出运行时值（可 `export {}`），保证多次 import 幂等（`registerTranslations` 本身是 Object.assign 语义，重复注册无副作用）。
2. 在驱动 UI 的入口模块挂副作用 import：`packages/drivers/redis/ui/shared/meta.ts`、`packages/drivers/mongodb/ui/shared/meta.ts`（若某驱动入口文件路径不同，取 `src/extensions/generated.ts` 实际 import 的该驱动 UI 首个模块，并在 progress 记录落点）。理由：`generated.ts` 每次构建都会 import meta，故驱动 UI 一经装载即完成词条注册，宿主无需知道驱动有哪些语言包。
3. 驱动 `locales/` 目录结构、命名与 key 前缀（`redis.*` / `mongo.*`）保持不变；**本轨不新增/不重命名任何 key**。

### B. 驱动 UI 改用 @datazen/ui 的 useI18n

1. 全量替换驱动 UI 中的宿主 import：`import { useI18n } from '../../../../../src/hooks/useI18n'` → `from '@datazen/ui'`。已盘点范围（基准 d172476fc）：redis ui 31 处 + `packages/drivers/sqlserver/ui/ConnectionFields.tsx` 1 处（行号见 `grep` 结果，务必以实际检索为准，勿遗漏嵌套目录如 `value-editors/valueView/render.tsx`、`console/consoleCompletion/CompletionPopup.tsx`）。
2. 替换后驱动侧不得残留任何 `.../src/` 形态的宿主 import（含 `src/locales`、`src/hooks`）。允许残留：`packages/drivers/*/ui/__tests__/redisKeyWebContextMenu.test.tsx` 的 `WebContextMenuHost` + `contextMenuStore`（协调者已裁定：这是宿主集成 fixture，非解耦违规，留待后续里程碑）。
3. 若驱动组件对 `t(...)` 有 `as I18nKey` 之类的宿主类型断言，一并去除（改用 `string`）。

### C. 宿主与 codegen 收口

1. `src/locales/index.ts`：删除 `import { DRIVER_LOCALES, type DriverTranslationKey } from '../extensions/generated-locales'` 与 `registerTranslations(DRIVER_LOCALES)`；删除对 `MongoTranslationKey` 的 type import 及 re-export；`I18nKey` 收敛为 `TranslationKey | (string & {})`（保持向后兼容的字面量类型联合可删）。
2. `getAllTranslations(locale)`：改为从 `@datazen/ui` 暴露的只读快照 API 取字典。**必须在 `packages/ui/src/i18n.ts` 新增该 API**（建议 `getRegisteredTranslations(locale: string): Record<string, string>`，返回只读拷贝），避免宿主自持第二份字典。注意语义变化并在 progress 记录：驱动词条只有在驱动 UI 模块被 import 后才在注册表内；`src/locales/locales.test.ts` 若因此断言失败，允许在测试内显式 `import '../packages/drivers/redis/locales'`（或等价方式）后断言，**禁止放宽断言到"不校验驱动 key"**。
3. **删除驱动 locale 聚合 codegen**（第 2 步的 `generated-locales.ts` 随之消失）：
   - `scripts/resolve-drivers.mjs`：删 `DRIVER_LOCALE_CONFIG`（~368 行）、`generateLocales` 及其调用点、`HOST_LOCALES`（若无其他用途）；
   - `scripts/driver-deinject.mjs`：删 clean 模板与 `generated-locales.ts` 相关分支（~17/25/221/226/255）；
   - `scripts/driver-stash-precommit.mjs`：删 `hasInjectedGeneratedLocales` / 相关清理分支（~63/71/94/134/226/250/269/296/312/332）；
   - `scripts/ensure-generated-drivers.mjs`：删该文件的 clean 生成（~39）；
   - `scripts/check-id-terminology.mjs`：`SKIP_FILES` 移除该项（文件已不存在）；
   - `scripts/__tests__/`：同步 `fixture.ts`（~13/21）、`driver-deinject.test.ts`（~37/44/49）、`driver-stash-precommit.test.ts`（~63/64/81）。
   - 本地已存在的 gitignored `src/extensions/generated-locales.ts` 属产物，删除或不再引用即可，**不要提交**。
4. `scripts/i18n-sync-check.mjs`：新增扫描 `packages/drivers/*/locales/`——以各驱动 `en.ts` 为 source，校验同目录其他语言文件 key 集合一致（缺失/多余逐项列出，非零退出）。保持对宿主 `src/locales` 的既有行为不变。
5. 文档：`packages/drivers/*/README.md`（或既有驱动开发文档）补一段"词条自注册"约定；若无 README 则在 progress 记录并留待 `decouple-docs` 轨（该轨并行在写解耦指南，勿重复创建同名文档）。

## 禁止事项（防跨轨冲突 & 防越界）

- **不动** `docs/development/coordination/hub.md`（协调者聚合脚本专用）、其他轨道的 `tracks/*/progress.md`。
- **不动** `packages/ui/src/i18n.ts` 的既有 5 个 API 行为（只允许**新增**只读快照 API）；不引入第二套 `t`/字典。
- **不改** `src/hooks/useI18n.ts` 的宿主别名定位（宿主 300+ 文件仍走它），不得删除该文件。
- **不动** `settingsStore`、`localeSync.ts` 的接线逻辑（语言切换 → `setLocale` 已由 i18n-core 完成）。
- 不新增 i18n key、不翻译词条（开发期只允许改 `en.ts` 的纪律仍适用，本轨连 `en.ts` 都不该动）。
- 禁止 `pnpm install`；搜索用 Grep 工具；不提交 codegen 产物与 `Cargo.lock` / `src-tauri/Cargo.toml` 注入段。

## 环境注意

- worktree 初始化 codegen 为 `--drivers=basic`；验证 redis UI 前执行：
  `node scripts/resolve-drivers.mjs --codegen-only --drivers=all`
- 驱动 UI 单测配置：`vitest.drivers.config.ts`（alias 已含 `@datazen/ui` → `packages/ui/src/index.ts`）。

## 验收标准

1. `grep` 检索 `packages/drivers/*/ui/**` 中 `from ['"].*src/` 命中数 = **0**（除禁止事项中登记的 `redisKeyWebContextMenu.test.tsx` 两处宿主 fixture）。
2. 全仓无 `DRIVER_LOCALES` / `generated-locales` 引用残留（`scripts/__tests__` 与生产代码均清）。
3. `node scripts/resolve-drivers.mjs --codegen-only --drivers=all` 成功且 `src/extensions/generated.ts` / `driver_init.rs` 正常产出（不再产出 `generated-locales.ts`）。
4. `npx tsc --noEmit -p tsconfig.json` = 0 error。
5. `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` = **218 pass / 0 fail**（基线，且**不得通过修改断言来维持绿灯**；若某用例因宿主字典不再被 `src/hooks/useI18n` 间接注册而失败，用显式注册驱动/宿主字典的方式修复测试装配）。
6. `npx vitest run packages/drivers` 全绿（其他驱动 UI 不因 import 改动破坏）。
7. `npx vitest run src packages/driver-sdk packages/ui` 全绿（基准 412 文件 / 4241 用例，允许因 locales.test 装配调整产生的最小改动）。
8. `npx vitest run scripts` 全绿（codegen 相关脚本测试）。
9. `node scripts/i18n-sync-check.mjs` 能报出驱动词条缺失（可临时删一个 key 自证后还原），且当前仓库全绿。
10. 运行时自检（可用 vite build 或 `pnpm build` 代替手工）：切到 `zh-CN` 后 redis 工作台文案为中文、切回 `en` 生效——登记为「留待 R 回归」E2E 项。

## 状态

- [x] Coder 完成 → READY_FOR_TEST
- [ ] Tester 复测 → TEST_DONE

## Coder 实施记录

Phase = `READY_FOR_TEST`（本小节末尾为自验实测数字；未做 `PASSED` 自标）。

### 1. 改动落点表

| 主题 | 文件 | 改动 |
| --- | --- | --- |
| 唯一运行时新增只读快照 | `packages/ui/src/i18n.ts` | 新增 `getRegisteredTranslations(locale): Record<string,string>`（浅拷贝、未知 locale → `{}`）；既有 5 个 API 行为零改动 |
| | `packages/ui/src/index.ts` | 导出该 API |
| | `packages/ui/src/__tests__/i18n.test.tsx` | 新增 1 例：快照可读、写回不影响注册表、未知 locale 为空 |
| 驱动词条自注册（A.1/A.2） | `packages/drivers/redis/locales/index.ts`（新）<br>`packages/drivers/mongodb/locales/index.ts`（新） | 静态 import 本包 **全部 10 个**语言文件 → 一次 `registerTranslations({...})`；纯副作用模块（`export {}`），locale code 与 `BUILTIN_LOCALES` 字面量一致（`pt-BR`/`zh-CN`/`zh-TW` 带连字符） |
| | `packages/drivers/redis/ui/shared/meta.ts`<br>`packages/drivers/mongodb/ui/meta.ts` | 顶部 `import '../../locales'` / `import '../locales'` 副作用挂载点（两者正是 `generated.ts` import 的该驱动 UI 首个模块，与任务书预估一致） |
| 驱动 UI 取 `@datazen/ui`（B） | 32 个文件（redis ui 31 + `packages/drivers/sqlserver/ui/ConnectionFields.tsx`） | `import { useI18n } from '<rel>/src/hooks/useI18n'` → `from '@datazen/ui'`（逐文件单行替换，保持既有“每组件多行 @datazen/ui import”风格） |
| 宿主收口（C.1/C.2） | `src/locales/index.ts` | 删 `DRIVER_LOCALES` / `MongoTranslationKey` import 与 re-export、删 `registerTranslations(DRIVER_LOCALES)`；`I18nKey = TranslationKey \| (string & {})`；`getAllTranslations()` 改为 `getRegisteredTranslations()` 快照（非内置 locale 回落到 `en`，与原契约一致）；注释同步 |
| 测试装配 | `src/test/driverUiSetup.ts`（新）+ `vitest.drivers.config.ts` | 见下节 |
| | 8 个 redis UI 测试文件 | `vi.mock` 落点从宿主别名改挂到 `@datazen/ui`（partial mock，见下节） |
| | `src/locales/locales.test.ts` | 新增 1 例：驱动包自注册后 `getAllTranslations('en')` / `getTranslation()` 可见驱动 key，且宿主快照不含它 |
| codegen 删码（C.3） | 5 个脚本 + 3 个脚本测试 | 见下节清单 |
| 词条完整性扫描（C.4） | `scripts/i18n-sync-check.mjs` | 驱动包扫描 + 结构校验 |

`src/hooks/useI18n.ts` 宿主薄别名按要求原样保留（未删、未改）。`AGENTS.md` / `CONTRIBUTING.md` / `.gitignore` 中的 `generated-locales.ts` 文字残留属文档/忽略规则，本轨文档权限不含 `AGENTS.md`、`CONTRIBUTING.md`（`.gitignore` 条目留着无害：文件不再被产出，仅作防御性忽略），登记给 `decouple-docs` / hub。

### 2. 脚本删码清单（C.3）

| 脚本 | 删除内容 |
| --- | --- |
| `scripts/resolve-drivers.mjs` | `DRIVER_LOCALE_CONFIG`、`HOST_LOCALES`、整个 `generateExtensionLocales()`（原 368~441 行）、其调用点；`--codegen-only` 提示文案与文件头注释去掉 locales |
| `scripts/driver-deinject.mjs` | `FULLY_GENERATED_MANAGED` 与 `isFullyGeneratedManagedFile()` 中的该条目、`cleanGeneratedLocalesContent()` 整个模板、`cleanFullyGeneratedContent()` 分支、头注释 |
| `scripts/driver-stash-precommit.mjs` | `hasInjectedGeneratedLocales()` 整个函数 + `fileHasInjection()` 路由分支 |
| `scripts/ensure-generated-drivers.mjs` | 文件头清单条目（列表本身由 `FULLY_GENERATED_MANAGED` 派生，无需另改） |
| `scripts/check-id-terminology.mjs` | `SKIP_FILES` 中该项 |
| `scripts/__tests__/fixture.ts` | `CLEAN_CONTENTS` / `INJECTED_CONTENTS` 两条样本 |
| `scripts/__tests__/driver-deinject.test.ts` | `cleanGeneratedLocalesContent` import 与断言、路径分类断言（注释说明“驱动包自注册、旧聚合文件已不存在”，不落字面量） |
| `scripts/__tests__/driver-stash-precommit.test.ts` | `hasInjectedGeneratedLocales` import、`fileHasInjection` 路由用例、空/桩 codegen 两条断言 |
| 本地 gitignored 产物 | `src/extensions/generated-locales.ts` 已删除（未提交） |

`scripts/`、`src/`、`packages/`、`e2e/` 内 `DRIVER_LOCALES` / `generated-locales` / `DriverTranslationKey` / `hasInjectedGeneratedLocales` / `cleanGeneratedLocalesContent` 全部 0 命中。

### 3. 词条扫描脚本行为（C.4）

- 发现式扫描：任何 `packages/drivers/<id>/locales/en.ts` 即视为一个词条包（当前 redis、mongodb）。
- key 抽取用独立 `extractPackKeys()`：除宿主同款内联正额外，额外识别驱动文件里的**换行折行值**写法（`'key':` 结尾换行），否则这类 key 对完整性校验不可见；宿主 `src/locales` 路径与输出保持原样。
- 缺失 key → 计入 `totalMissing` → 退出码 1；多余 key 只列出不致命（与宿主一致）。
- 额外结构校验（`totalStructural`）：词条包必须有 `index.ts`，且 `index.ts` 必须 import 目录内每个语言文件（漏 import → 列出并退出 1），把“自注册”约定本身也纳守门。
- 汇总行改为同时报告宿主 locale 数与驱动词条包数。

### 4. 测试装配说明（不改任何断言）

- 驱动组件不再经宿主 `src/hooks/useI18n` 间接触发 `src/locales` 副作用 ⇒ 驱动 UI 测试若不改装配会拿到空注册表。装配点收在**宿主测试侧**新文件 `src/test/driverUiSetup.ts`：`import '../locales'`（宿主自己那份，等价 app 启动）+ `import '../../packages/drivers/{redis,mongodb}/locales'`（驱动自注册，等价 `generated.ts → meta`），由 `vitest.drivers.config.ts` 的 `setupFiles` 追加。这样 `packages/drivers/*/ui/**` 内不出现任何 `src/` import。
- 8 个原本 `vi.mock('<rel>/src/hooks/useI18n')` 的 redis 用例改为 partial-mock `@datazen/ui`（`importOriginal` 展开后只覆盖 `useI18n`），保留其“断言与语言无关”的原意；断言文本一字未动。
- 有效性反证（临时探针，跑完即删）：在驱动测试环境内 `t('redis.batchDelete')==='Delete selected'`、`t('common.cancel')` 为真实英文、`getRegisteredTranslations('zh-CN')` > 100 key、`t('mongo.collections')==='Collections'` 全部通过，证明注册表确实被灌满（绿灯不是“查不到就回显 key”的假绿）。
- `src/locales/locales.test.ts` 新增用例显式 `await import('../../packages/drivers/redis/locales')` 后断言驱动 key 出现在共享快照里；未放宽任何既有断言。

### 5. 自验命令与实测数字

| # | 命令 | 实测 |
| --- | --- | --- |
| 1 | `node scripts/resolve-drivers.mjs --codegen-only --drivers=all` | 成功；提示改为 `codegen-only: wrote generated.ts / driver_init.rs`；`generated.ts`（15 驱动）/`driver_init.rs` 正常产出；`src/extensions/` 只剩 `generated.ts` + `generated-pro.ts` |
| 2 | `npx tsc --noEmit -p tsconfig.json` | **0 error** |
| 3 | `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` | **26 files / 218 passed / 0 failed**（= 基线，断言未动） |
| 4 | `npx vitest run packages/drivers` | 默认 `vitest.config.ts` 的 include 不含 `packages/drivers/**`（该轨任务书这条命令按设计收集 0 文件并退出 1）；驱动 UI 全量的正确入口 `npx vitest run --config vitest.drivers.config.ts`（即 `pnpm test:unit:drivers`）= **31 files / 233 passed / 0 failed** |
| 5 | `npx vitest run src packages/driver-sdk packages/ui` | **412 files / 4243 passed / 0 failed**（基线 4241 + 本轨新增 2 例） |
| 6 | `npx vitest run scripts` | **21 files / 190 passed**；`npx vitest run scripts packages/ui` = 24 files / 215 passed |
| 7 | `node scripts/i18n-sync-check.mjs` | 见下「偏离」：宿主部分与基线逐项一致（`1216 missing / 1650 stale`，**基线本就是退出 1**）；驱动部分新报 `redis/{de,es,fr,ja,ko,pt-BR,ru,zh-TW} 各 139 missing`、`redis/zh-CN 72 missing`、mongodb 全同步；合计 `2400 missing`，`0 driver pack issue(s) across 2 driver locale pack(s)`，退出码 1。<br>负向自证 A（删 `mongodb/locales/ja.ts` 的 `mongo.applyFilter`）→ `[driver.mongodb/ja] Missing 1 key(s): mongo.applyFilter`、总数 2400→2401；<br>负向自证 B（删 `index.ts` 里 `import de from './de'`）→ `[driver.mongodb] locales/index.ts does not import 1 locale file(s): de.ts`；两者均已还原（`git status` 干净） |
| 8 | 验收 Grep 断言 | ① `packages/drivers/**` 中 `from ['"].*src/` → **2 命中**，全在已裁定的 `redis/ui/__tests__/redisKeyWebContextMenu.test.tsx`（宿主 `WebContextMenuHost` + `contextMenuStore`）；② `DRIVER_LOCALES\|generated-locales\|DriverTranslationKey` 全仓 → 生产代码/`scripts/`/`src/`/`packages/`/`e2e/` **0 命中**（仅 `AGENTS.md` 2 处、`CONTRIBUTING.md` 1 处、`.gitignore` 1 处、`docs/**` 5 处，越界不动）；③ 驱动/扩展侧 `setLocale` → **0 调用**（仅 `packages/ui` 实现+导出、两处文档注释） |
| 9 | `npx vite build`（代替 `pnpm build`，见「环境」） | 退出 0；产物内可 grep 到 `redis.bytes` 的日文值「バイト」与 `redis.console` 的 zh-TW 值「批次 TTL」⇒ 驱动词条经 `meta.ts` 副作用进入主 chunk，运行时自注册链路在真实 bundle 中成立 |

### 6. 取舍与偏离（重要）

1. **全部 10 个语言都注册**（按任务书 A.1 与建议）：实测代价为 `main-*.js` 1,528.55 kB → 1,605.12 kB（**+76.6 kB minified / +6.6 kB gzip**），并非“成本为零”。收益是消除 codegen 瓶颈、修复 8 个存量语言文件永不接线的缺口。若协调者认为包体优先，退回 `en`/`zh-CN` 只需删两处 import 列表（脚本会同步报 structural 之外的信息，不会静默）。
2. **`i18n-sync-check` 无法做到“当前仓库全绿”**：基线（改动前 `git stash` 前实测）宿主自身就是 `1216 missing / 1650 stale` 且退出 1；驱动 redis 的 8 个存量语言文件相对 `en.ts` 缺 139/72 个 key（同一批存量债）。本轨明令“不新增 key、不翻译词条”，因此**只如实上报、不刷绿**。要清零需一次专门的翻译回合（i18n-sync skill），登记给 R/hub。
3. **`npx vitest run packages/drivers`（任务书第 4 步）按当前 include 设计收集 0 文件并以 1 退出**——非回归；驱动 UI 单测入口是 `vitest.drivers.config.ts`（`pnpm test:unit:drivers`），已按 31/233 全绿执行。
4. **未跑 `pnpm build`**：pnpm 的 deps-status 检查会自行触发 `pnpm install`（本工作区硬禁止），首次尝试即以退出码 1 失败（已确认 `node_modules` 软链与 `pnpm-lock.yaml` 未被改动，`find node_modules -newermt '-20 minutes'` = 0 命中），改用等价 `npx vite build`（含 `tsc --noEmit` 单独执行）完成打包验证。
5. **key 优先级语义微调**：原先宿主 `registerTranslations(DRIVER_LOCALES)` 在宿主 eager 字典之前注册（宿主 key 覆盖驱动同名 key）；现在驱动包随 UI 装载注册，故**同名 key 由驱动胜出**。驱动 key 全部带 `redis.` / `mongo.` 前缀，实际无碰撞；如需“宿主永远压制驱动”，后续可在 `@datazen/ui` 加注册优先级（越界，未做）。
6. **语义可见性变化**：`getAllTranslations(locale)` 现在是共享注册表快照 ⇒ 含已加载的 lazy 域包、且驱动 key 只在驱动 UI 装载后出现（任务书 C.2 已预告）；宿主内建 locale 之外的 code 仍回落 `en`，`locales.test.ts` 相应断言不变。
7. **C.5 文档**：`packages/drivers/*/README.md` **一个都不存在**（18 个驱动目录全无 README）。按任务书指令不新建与 `decouple-docs` 轨重复的文档，约定改由代码内注释承载（`locales/index.ts` 头部写明自注册契约 + `i18n-sync-check` 守门），文档落点登记给 `decouple-docs`。

### 7. 未尽事项 / 风险

- 驱动词条翻译债：`redis` 9 个非 en 文件缺 139（zh-CN 缺 72）个 key，需要独立翻译回合（i18n-sync skill）补齐后 `i18n-sync-check` 才会绿。
- `AGENTS.md` / `CONTRIBUTING.md` / `.gitignore` / `docs/architecture/**` 仍描述 `generated-locales.ts`（越权，交 `decouple-docs`）。
- `i18n-core` 轨 progress.md 里对 `DRIVER_LOCALES` 的历史描述未改（他轨文件，禁改）。
- 后续 Wave 4 的 lint 规则需覆盖：驱动/扩展侧 `setLocale`、驱动侧 `src/**` import 两类违规（本轨靠人工 Grep 自证）。

## 留待 R 回归

- **R-1（E2E，验收 #10）**：`zh-CN` 下 redis 工作台/键浏览器/控制台文案为中文，切回 `en` 立即生效；顺带覆盖 mongodb 文档视图 `mongo.*`。构建须 `pnpm tauri:build:webdriver`（或 `pnpm e2e`），本轨未跑 GUI。
- **R-2**：`--drivers=basic`（不含 mongodb）与 `--drivers=all` 两种选型下 `pnpm build` / `tauri:dev` 均无缺失词条导致的 raw-key 泄漏（重点看 redis 工作台标题、控制台提示）。
- **R-3**：`npx vitest run --config vitest.drivers.config.ts`（31 files / 233）+ `npx vitest run src packages/driver-sdk packages/ui`（412 / 4243）+ `npx vitest run scripts`（21 / 190）在 R 环境复跑一致。
- **R-4**：`node scripts/i18n-sync-check.mjs` 输出结构与本轨实测逐项一致（宿主段数字不变、驱动段 8×139 + 1×72），并在翻译回合后转为退出 0。
- **R-5**：Pro/EP 与 wapp 侧若开始自带词条，验证其 `registerTranslations` 与驱动/宿主词条无前缀冲突。

