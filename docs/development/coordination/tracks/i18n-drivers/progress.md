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

- [ ] Coder 完成 → READY_FOR_TEST
- [ ] Tester 复测 → TEST_DONE

## Coder 实施记录

（待填写：改动落点表、脚本删除清单、测试装配说明、自验命令与数字）

## 留待 R 回归

- 待登记。
