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

- [ ] Coder 完成 → READY_FOR_TEST
- [ ] Tester 复测 → TEST_DONE

## Coder 实施记录

（待填写）

## 留待 R 回归

- 无（文档轨）。
