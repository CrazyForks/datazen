# Track: import-guard — 驱动/扩展 import 边界与 setLocale 调用护栏 + CI 接入

- 分支: `feature/import-guard`（基准 `feat/driver-decoupling` @ 8b66586e4，Wave 1/2/3 全部已合并）
- 角色: Coder → Tester
- 波次: Wave 4-A（本轨合并后进入 R 阶段全量回归，任务 #32）

## 目标

Wave 1~3 已把驱动侧对宿主代码的引用清零（`grep ['"]\.\./.*src/` 在 `packages/drivers/**` 当前仅剩 2 处已裁定夹具，见下）。这类解耦**极易被新 MR 悄悄回退**，本轨落地静态护栏 + CI 阻断，把契约变成机器强制。

## 现状事实（已核对，勿重复调研）

- 允许 import 面与契约正文：`docs/development/driver-api-dependency-boundary.md`（Part 2 前端契约，2.1.2 允许/禁止面、2.2 落点决策表、2.4.3 语言集合三层、2.6「Wave 4 护栏预告」明确写着文件名与 CI 位置尚未确定 —— **本轨就是把它落实并回扫措辞的那一轨**）。
- 当前基线（基准 8b66586e4 实测）：
  - `packages/drivers/**` 中匹配 `['"]\.\./.*src/` 命中 **2**，均在 `packages/drivers/redis/ui/__tests__/redisKeyWebContextMenu.test.tsx:5`（`WebContextMenuHost`）与 `:9`（`useContextMenuStore`）—— 协调者已裁定为驱动↔宿主**集成夹具**，属唯一豁免。
  - Wave 3 已把驱动侧 8 处 `vi.mock('<rel>/src/hooks/useI18n')` 改为 partial-mock `@datazen/ui`，因此 **`vi.mock` 形态的宿主路径命中数应为 0**（若你实测非 0，说明基线漂移，须先报告再决定）。
  - `packages/ui/src/i18n.ts` 是 `setLocale` 的唯一定义处；唯一生产调用方应为宿主 `src/lib/localeSync.ts`。
  - 同类护栏脚本惯例（照抄其结构：可导出纯函数 + `runCli()` + `endsWith(...)` main 守卫 + 明确退出码 + `scripts/__tests__/*.test.mjs` 单测）：`scripts/check-id-terminology.mjs`、`scripts/check-module-layers.mjs`、`scripts/check-ci-docs-consistency.mjs`，以及 Wave 3 刚重构过的 `scripts/i18n-sync-check.mjs`（其 18 例 fixture 用例可当写法样板）。
  - 接入点：`package.json` 现有 `test:ids` / `test:layers` / `test:ci-docs` / `test:version` 脚本位；CI 步骤见 `.github/workflows/ci.yml` 的「Guard …」段（约 49~68 行）；本地等价位 `scripts/ci-local.sh`、`scripts/run-full-automation-test.sh`（Wave 3 Tester 已登记这三处的调用方清单）。

## 范围

1. **新增护栏脚本 `scripts/check-driver-import-boundaries.mjs`**（命名沿用 `check-*.mjs` 惯例），导出纯函数 + CLI 守卫，覆盖三条规则：
   - **R1 驱动禁引宿主源码**：扫描 `packages/drivers/*/ui/**`（含 `__tests__`、`locales/**`）内所有**说明符字面量**，凡匹配 `'^(\.\./)+.*src/'`（即相对上溯进宿主 `src/`）即违规。必须同时覆盖：`import`/`export ... from`、`import(...)` 动态形式、`vi.mock(...)` / `vi.doMock(...)` / `require(...)` 的字符串参数形态——**不能只 grep `from`**，这是上一轮实测暴露的 8 处漏网点。
   - **R2 非宿主禁调 `setLocale`**：扫描范围 = `packages/**`（除 `packages/ui/src/i18n.ts` 的定义与自身导出行），命中 `setLocale(` 调用即违规；须排除注释行与 `type`/接口成员声明（`setLocale(locale: string): void;` 这类契约声明不算调用）。
   - **R3 宿主不引驱动内部**（低成本对称护栏）：`src/**` 不得相对 import `packages/drivers/**`（当前合法出口是 codegen 的 `src/extensions/generated*.ts`，属 gitignored 产物，跳过；`src/locales/index.ts` 对 `packages/drivers/*/locales/en` 的 **type-only** import 若仍存在须先核实现状再决定放行或收紧）。**若 R3 现状即红，不要擅自扩大豁免**：先在本文件登记事实并与协调者裁定后再定。
   - 允许清单（allowlist）：外置为脚本内显式常量（文件 + 规则 + 原因 + 归属里程碑），初始仅 2 条 = 上述 fixture；禁止用目录级/通配级豁免把口子放大。
2. **测试**：`scripts/__tests__/check-driver-import-boundaries.test.mjs`，用内联 fixture（虚拟文件树 map）覆盖：干净树通过 / `from` 违规 / `vi.mock` 违规 / 动态 `import()` 违规 / `export from` 违规 / 非宿主 `setLocale` 调用违规 / 注释与契约声明不误报 / allowlist 命中放行 / allowlist 指向不存在文件时报「过期豁免」/ R3 分支。**本轨新增逻辑行覆盖 ≥80%（目标 100%）**。
3. **对真实仓库自证有效**：临时在某个驱动 ui 文件里加一行 `import { useI18n } from '../../../src/hooks/useI18n';` 与一行 `vi.mock('../../../../src/stores/settingsStore')`，跑脚本必须红；还原后必须绿。把两次输出贴进 progress（结束前 `git status` 干净）。
4. **接入 CI 与本地**：`package.json` 加 `test:boundaries`；`.github/workflows/ci.yml` 在其它 Guard 步骤后加「Guard driver/host import boundaries」；`scripts/ci-local.sh` 与 `scripts/run-full-automation-test.sh` 同步补一步（与既有 guard 步骤风格一致，失败即阻断）。
5. **文档回扫（把 Wave 3 留下的债一次清掉）**：
   - `docs/development/driver-api-dependency-boundary.md` 2.6：把「文件名与 CI 位置尚未确定」替换为真实脚本名 / npm script 名 / CI 步骤名。
   - 同文档 2.1.2 与 2.7 的过渡期基线数字（`32 useI18n + 2 夹具 + 8 vi.mock = 42`）**已因 Wave 3 合并而失效**：按你实测重写成当前真实基线（应为「生产码 0 / 夹具 2」），并注明护栏已阻断新增。
   - `decouple-docs` 轨登记的 3 条 Nit 一并处理：① `boundary.md:299` 单条 bullet 过载 → 拆 2~3 子条；② 两份指南 §6.3 分例补「（如 mongodb）」标注与契约写法对齐；③ 与 2.4.3 观察项同批回扫（保持两份指南标题 **21 : 21**、层级 `#`×1/`##`×13/`###`×7 不变）。
   - 文档改动必须逐处 Read 代码核实，禁止编造符号/路径/行号。
6. **R1 违规修复的边界**：本轨**只写护栏**，不重做解耦。若 R1/R2 因合并后的新漂移出现非豁免违规，先停下报告协调者裁定，不要自行搬迁代码。

## 禁止事项

- 不动 `packages/ui/src/i18n.ts` 的既有 API 行为；不引入第二套 i18n；不改驱动/宿主业务代码（除第 3 项临时自证，且必须还原）。
- 不动 `docs/development/coordination/hub.md`（协调者聚合专用）、其他轨 `progress.md` / `bugs.md`。
- 不新增/删除两份 `independent-driver-development.*.md` 的任何标题（21:21 是前几轮实测口径）。
- 不动 `src-tauri/**`、`Cargo.lock`、`packages/pro-extensions/**`；不提交 codegen 产物（`src/extensions/generated*.ts`、`src-tauri/src/driver_init.rs`、`capabilities/default.json`）。
- 禁止 `pnpm install`、裸 `pnpm build`（会自触发 install；用 `npx vite build`）；禁止真实 `pnpm e2e`。

## 环境注意

- 工作目录固定 `.worktrees/datazen-import-guard`；`pwd` 自检；搜索用 Grep 工具。
- worktree codegen 默认 `--drivers=basic`；redis 相关校验前：`node scripts/resolve-drivers.mjs --codegen-only --drivers=all`

## 验收标准

1. `node scripts/check-driver-import-boundaries.mjs` 在还原态基准分支上 **exit 0**，输出风格与其它 guard 脚本一致（含扫描文件数、豁免命中数、过期豁免检测）。
2. 故意注入 R1（`from` 与 `vi.mock` 两种）与 R2 违规各一处 → 脚本 **exit≠0 且逐条点名文件:行**；还原后再次 exit 0。
3. `npx vitest run scripts` 全绿，且本轨新增用例数与覆盖数字如实登记（新增逻辑行覆盖 ≥80%）。
4. allowlist 只含已裁定的 2 条 fixture；无目录级/通配豁免。
5. `package.json` + `.github/workflows/ci.yml` + `scripts/ci-local.sh` + `scripts/run-full-automation-test.sh` 四处接入齐备且互相一致（脚本名拼写完全相同）。
6. `npx tsc --noEmit -p tsconfig.json` = 0；`npx vite build` exit 0。
7. `node scripts/check-id-terminology.mjs`、`check-ci-docs-consistency.mjs`、`check-module-layers.mjs`、既有 `pnpm test:unit` / `pnpm test:unit:drivers` 不因新护栏破坏（新脚本是**新增**步骤，不得改动既有步骤语义）。
8. 文档回扫：2.6 不再含「尚未确定」；2.1.2/2.7 基线数字与实测一致；3 条 Nit 关闭；两份指南 21:21；文档内路径/符号抽验零失配。

## 状态

- [ ] Coder 完成 → READY_FOR_TEST
- [ ] Tester 复测 → TEST_DONE

## Coder 实施记录

（待填写）

## 留待 R 回归

- 待登记（本轨合并后 R 阶段须把新护栏纳入全量回归清单，并复跑各轨登记的 E2E 项）。
