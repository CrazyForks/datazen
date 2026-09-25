- 任务：将 Visual Query Builder 实现、私有状态、单测与 WebDriver journeys 迁入独立 SQL Editor Pro；Host 保留公共契约、Query tab 适配与容器。
- 状态：TEST_DONE（Round 3 独立验证通过；Pro release pin 可从配置的远端干净解析，BUG-001 回归测试仍通过）
- 初始迁移编码 commit：Host `497accbd665519d67a07cec83b19d44c90e0cdbf`；Pro `e87541fed6759d79971a4e8e9cfc01d3b9ba4a7b`
- Tester bug/test commit：Host `075ed41d76b87084563e5704abf6e5330a04b176`
- Tester 收尾 commit：Host `fe92c2d650cf73336b41cc0f9e669645bd7b1a09`
- Round 2 Pro 覆盖测试 commit：`2a45c90f28041e81c948e67b9416fade8ac5472f`
- Round 2 Host 修复 commit：`d1c44f3cedf3d4685e8d767e698258edeb89bee9`
- Worktree：`.worktrees/datazen-qb-editor-pro`
- Host 分支：`feature/qb-editor-pro`
- Pro 初始 HEAD：`c60f7fc8e1d552c6a37d3f70128d9c8e42555750`
- Pro 分支：`codex/qb-editor-pro`
- 执行方式：单一并发；Coder 自验完成，现交 Tester/R 复核

## 范围与实现

施工依据：`docs/development/query-builder-editor-pro-implementation.md`（临时未跟踪副本，不提交）及 `docs/development/query-builder-editor-pro-migration.md`。

- `@datazen/extension-points` 提供可选 Query Builder 契约；Host 通过 Query Editor Pro adapter 注入当前 Query tab 的 connection/session/database/schema、schema catalog、方言、SQL formatter 与关系预测服务。
- Query Editor Pro 私有持有 Builder store、SQL generator、validation、dialect adapter、组件与 locale；controller 按 panel/context 管理会话，并在 tab 销毁和 EP dispose 时清理状态。Tester 发现 Builder 打开期间 Host context 变化没有传入 controller，详见 BUG-001。
- SQL Builder 只生成并写回 SQL，不自动执行；保留冲突 replace/append/keep、取消回滚、CodeMirror 保持挂载、多方言、复合 FK 和关系预测确认。
- Pro Panel 校验 schema-tree V1 拖放 payload 的连接、session、database、schema 和 catalog table；不接收过期或越上下文 payload。
- VITE_E2E bridge 仅用于测试构建；生产 bundle 已静态检查不含 `__qbTest` / `__qbStore`，共享 React 与扩展点依赖外置。
- Builder 菜单只在 Pro contribution 存在时显示；Host 单测覆盖 contribution 缺省时无菜单项。
- 原 QB 单测搬入 Pro；四条原 WebDriver journeys 与 helper 搬入 Pro suite。Host 原 QB 组件、store、dialect、单测及测试全局已清理。
- en/zh-CN 的完整 QB 文案归 Pro；Host 仅保留仍由 Host 使用的 `query.visualBuilder.title` 与 `query.visualBuilder.appliedToast`。
- 相关开发文档、E2E suite 入口与插件说明已更新。

## 阶段与自验

| 阶段 | 结果 | 自验 |
|---|---|---|
| 公共 EP 契约与 Host adapter/lifecycle | 完成 | Host `npx tsc --noEmit` 通过；Host 全量 Vitest 455 files / 4,513 tests 通过 |
| Pro QB 核心、私有 store、生命周期与拖放校验 | 完成 | Pro `npx tsc --noEmit` 通过；Round 2 全量 Vitest 62 files / 774 tests 通过 |
| 旧 Host QB 清理、Locales、E2E 与文档 | 完成 | Host `QueryToolbarMoreMenu.test.tsx` 11/11 通过；Pro E2E TypeScript 检查通过；四条 WebDriver spec 4/4 通过（22 条用例） |
| 生产 bundle / Pro 打包 | 本机 macOS Pro webdriver app 可加载；完整发行构建仍待发布流程 | Tester 重跑 Pro `npx vite build` 并验证无 `__qbTest` / `__qbStore` / `@host/`、bare external imports，且使用 `__DATAZEN_HOST__` 单例 |

## WebDriver journeys

命令：`node e2e/run.mjs --pro --skip-build -- --suite pro-query-builder`（Tester 独立复跑，4 spec / 22 tests passed）

| Journey | 结果 |
|---|---|
| `visual-query-builder-clauses-journey.ts` | 通过，2 tests |
| `visual-query-builder-complex-journey.ts` | 通过，2 tests |
| `visual-query-builder-edge-journey.ts` | 通过，16 tests |
| `visual-query-builder-journey.ts` | 通过，2 tests |

E2E 暴露一个旧 helper 使用全局 schemaStore schema、与 Query tab 配置 schema 不同的问题。helper 已改为使用测试连接配置中的 database/schema 和真实活动 dbSessionId；单独重跑 A 后通过，随后完整 suite 重跑通过。测试数据库 worker fixtures 均已 teardown。

初始 Pro Tauri E2E build 遇到 PNPM 在无 TTY 下自动 install 的 abort；未触发依赖安装。通过 runner 的本机 Pro webdriver build（将 Tauri pre-build 的 `pnpm build` 换为等价生成、TypeScript 检查和 Vite build 命令；构建后恢复 `tauri.conf.json`）生成测试 app，随后以 skip-build 跑完整 suite。

## Locale 检查

- Pro en/zh-CN QB key parity 由 Pro Vitest 覆盖并通过。
- 全仓 `node scripts/i18n-sync-check.mjs --from HEAD` 仍报告历史翻译缺口。按当前 HEAD 基线逐 locale 比较，Host 每个 locale 的 missing 数均较基线减少 126，extra/stale 总量没有增加；检查变化清单确认迁移只删除 Host 已不使用的 Builder 专属 key，并保留 Host 使用的 `title` / `appliedToast`。其余差额属于已有 Host 与 Redis driver locale 债务，需由 i18n 发布流程处理。

## Tester 独立复验

- Host commit `497accbd665519d67a07cec83b19d44c90e0cdbf` 与 Pro commit `e87541fed6759d79971a4e8e9cfc01d3b9ba4a7b` 均与目标一致；Pro `pro-extension.lock.json` pin 指向 Pro commit；两仓初始 status 干净（implementation spec 是 Host 临时未跟踪输入）。
- `node scripts/generate-builtin-locales.mjs`：通过。
- Host `npx vitest run`：455 files / 4,513 tests 通过；新加回归测试后 `npx vitest run src/windows/connection/query/__tests__/QueryEditorSection.qbContext.test.tsx` 以预期断言失败复现 BUG-001。Host `npx tsc --noEmit`（含新增测试）、`node scripts/check-module-layers.mjs`、两仓 commit `git diff --check`：通过。
- Pro `pnpm test` 在测试脚本执行前触发 pnpm 自动安装并因无 TTY 中止（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）；使用现存依赖独立执行 `npx vitest run`：61 files / 767 tests 通过。Pro `npx tsc --noEmit`、`npx vite build`：通过。
- Round 1 覆盖率基线：原 include scope 的总体 lines 85.30%、statements 83.97%、branches 74.04%、functions 82.54%；`QueryBuilderPanel.tsx` 76.85%、`DiagramCanvas.tsx` 64.75% lines。两处 UI 门槛已在 Round 2 补测后通过，结果见下文。
- Pro production bundle 静态检查通过：无 `__qbTest`、`__qbStore`、`@host/` 或裸 external imports；确认 React/EP/UI 运行时从 `__DATAZEN_HOST__` 共享。
- `node e2e/run.mjs --pro --skip-build -- --suite pro-query-builder`：4 specs / 22 tests 通过，测试 worker fixture teardown 完成。该次使用现成 macOS Pro WebDriver app；runner 提示 app binary 早于刚生成的 Host `dist/index.html`，因此本轮证明 E2E 可运行，不等同于独立完成最终签名发行包重建。
- `node scripts/i18n-sync-check.mjs --from HEAD`：仍失败，报告 3,845 missing 与 1,650 stale translations（8 个 Host locales；Redis 两 locale packs 未报 driver pack issue）。Pro en/zh-CN QB key parity 在 Pro Vitest 中通过。Host/Redis 全仓差额需发布前由 i18n 流程处理。

## Round 2 修复与复验

- **BUG-001 上下文切换**：Host `QueryEditorSection` 记录 Builder 当前绑定的 contribution/panel/context；Builder 保持打开且 connection/session/database/schema props 变化时，通过 `useLayoutEffect` 在绘制前调用 `openFor` 重绑上下文，使 Pro controller 清除旧 draft 后再用新 props 展示。BUG 报告已更新为“已修复，待 Tester 复测”。
- **新增行为测试**：Host `QueryEditorSection.qbContext.test.tsx` 覆盖打开 Builder 后 database/schema 变化会再次绑定当前 panel/context。Pro `QueryBuilderPanelCommit.test.tsx` 增加 formatter 异常 fallback、Ctrl+Enter 提交和 Escape 保留/丢弃流程；`DiagramCanvas.interactions.test.tsx` 覆盖卡片操作回调、手动 join 完成/自连接拒绝与取消、列列表滚动更新关系锚点。
- **Host tests/typecheck**：BUG-001 focused test 1/1、Query 目录 7 files / 125 tests、Host 全量 `npx vitest run` 456 files / 4,514 tests 均通过；Host `npx tsc --noEmit` 通过。
- **Pro tests/typecheck/coverage**：`npx vitest run` — 62 files / 774 tests 通过；Pro `npx tsc --noEmit` 通过。覆盖率命令保持 Round 1 原始 include scope，62 files / 774 tests 通过，`QueryBuilderPanel.tsx` lines 83.88%、`DiagramCanvas.tsx` lines 96.72%，总 lines 88.72%。
- **WebDriver**：项目入口 `pnpm e2e:qb:build` 因 pnpm 检查共享 `node_modules` 后在无 TTY 时尝试 install 而中止（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，未触发安装）。按此前自验流程临时覆盖 Tauri `beforeBuildCommand` 为 locale/menu generation、`npx tsc --noEmit` 与 `VITE_E2E=1 npx vite build`，并在 Pro 打包阶段与 Host 前端阶段均设置 `VITE_E2E=1`；通过 `with-driver-inject` 和 `e2e-tauri-build --pro` 重建后恢复 `tauri.conf.json`。命令 `node e2e/run.mjs --pro --skip-build -- --suite pro-query-builder` — 4 specs / 22 tests 通过，用时 2m47s；E2E fixtures 已 teardown。
- **当前变更范围**：Host 修改 Builder context lifecycle、Pro lock pin 与本轨 bug/progress 文档；Pro commit `2a45c90f28041e81c948e67b9416fade8ac5472f` 只增加两组 UI 行为测试。

## Round 3 修复：Pro lock ref 上游可达

- **BUG-002**：Host lock 中的 Pro commit 原先仅存在于本地 feature branch，上游 clean clone 无法 checkout。已将现有 Pro 分支 `codex/qb-editor-pro` 非强制推送到 Host lock 所配置的远端 `https://github.com/flyxl/datazen-extension-sql-editor-pro.git`；Pro commit SHA 未变，Host lock 无需改动。
- **远端确认**：`git ls-remote --heads <lock.git> refs/heads/codex/qb-editor-pro refs/heads/main` 返回 `refs/heads/codex/qb-editor-pro`=`2a45c90f28041e81c948e67b9416fade8ac5472f`，`refs/heads/main` 仍为 `c60f7fc8e1d552c6a37d3f70128d9c8e42555750`。仅创建并更新 feature branch；未强推、未改 main、未创建 release。
- **Clean resolver clone**：从 `pro-extension.lock.json` 读取 URL/ref，调用 `scripts/resolve-pro.mjs` 的 `ensureProCheckout` 在全新临时目录 clone 并 detached checkout；打印 `HEAD=2a45c90f28041e81c948e67b9416fade8ac5472f`、与 lock 一致，clone `status=clean`。临时 clone 已清理。
- BUG-002 报告已更新为“已修复，待 Tester Round 3 复测”。本轮未修改 Pro 源码或 Host lock；等待独立 Tester 从公开远端重新验证。

## 剩余发布门槛

- 已补做本机 macOS arm64 Community 与 Pro all-driver Tauri release builds；产物、临时配置和 bundle 状态见“macOS Release Build”小节。
- 常规 Query 执行 E2E 与 `e2e:qb:regression` 尚未运行；Windows/Linux release builds、正式 Developer ID 签名/公证、最终签名 manifest/bundle hash 与远端正式 release 未验证。
- 因此本轮确认的是本机 macOS 构建可出包和 Pro extension pin 可复现，不代表跨平台正式发行签名已通过。

## macOS Release Build

- 标准 `pnpm tauri:build:community` 在执行脚本前因 PNPM 无 TTY 依赖目录检查中止，未运行安装。为不改动共享 `node_modules`，通过 `node scripts/tauri-build.mjs --edition=community --drivers=all` 执行同一 Host release build；构建期间仅临时把 `src-tauri/tauri.conf.json` 的 `beforeBuildCommand` 改为 `npx tsc --noEmit && npx vite build`，结束后恢复原始文件内容（当前仍为 `pnpm build`）。
- Community all-driver release build 成功，15 个 path 驱动完成编译，生成 macOS arm64 `DataZen.app` 与 `DataZen_0.2.1_aarch64.dmg`。
- Pro all-driver release build 使用 Host lock pin 的 Pro commit `2a45c90f28041e81c948e67b9416fade8ac5472f`，成功 clone/pack Pro、生成签名 extension staging 并通过 production Vite + Release Rust 编译；同样生成 `DataZen.app` 与 `DataZen_0.2.1_aarch64.dmg`。打包的 app resources 中有对应 `manifest.json`、`dist/index.esm.js` 和 `signature.sig`。
- 对 Pro `.app` 执行 `codesign -dv --verbose=2` 显示 `Signature=adhoc`、`TeamIdentifier=not set`；这不是正式 Developer ID 签名或 notarization。Community 与 Pro 使用同一 Tauri bundle 路径，后一次 Pro build 覆盖前一次 Community bundle 目录，因此最终保留的 `.app`/DMG 是 Pro 产物。
- 构建仅改写了生成产物和 Cargo lock 的驱动 feature 列表；驱动注入已恢复，自动生成的 `Cargo.lock` feature 变更已还原，Tauri 配置字节级恢复。Pro staging 在 `with-driver-inject` 退出后按脚本清理。

## Tester 与 Bug 记录

第 1 轮 Tester 判定：`TEST_FAILED`。BUG-001 已由 Round 2 独立复测确认修复。

## Tester 独立复验（Round 2）

- Host commit `d1c44f3cedf3d4685e8d767e698258edeb89bee9` 与 Pro commit `2a45c90f28041e81c948e67b9416fade8ac5472f` 已核对；Host `pro-extension.lock.json` ref 与 Pro HEAD 完全一致。本轮 Pro 工作树干净；Host 仅有未跟踪临时实现说明 `query-builder-editor-pro-implementation.md`，两仓 `git diff --check` 通过。
- `node scripts/generate-builtin-locales.mjs`：通过。Host `npx vitest run`：456 files / 4,514 tests 通过；`npx tsc --noEmit` 与 `node scripts/check-module-layers.mjs` 通过。Pro `npx vitest run`：62 files / 774 tests 通过；Pro `npx tsc --noEmit` 与 `npx tsc --noEmit -p e2e/tsconfig.json` 通过。
- 覆盖率使用 Round 1 原始 include scope：`npx vitest run --coverage --coverage.include='src/components/query-builder/**/*.ts' --coverage.include='src/components/query-builder/**/*.tsx' --coverage.include='src/query-builder/**/*.ts' --coverage.include='src/query-builder/**/*.tsx' --coverage.include='src/stores/queryBuilderStore.ts' --coverage.include='src/lib/sqlDialects/queryBuilder.ts' --coverage.reporter=json --coverage.reporter=text`。总行覆盖率 88.72%；`QueryBuilderPanel.tsx` 83.88%（Round 1：76.85%）；`DiagramCanvas.tsx` 96.72%（Round 1：64.75%）。两项均达到 ≥80%。
- Pro `npx vite build` 通过，生产 bundle 不含 `__qbTest`、`__qbStore`、`@host/` 或裸 external imports，并引用 `globalThis.__DATAZEN_HOST__` singleton。构建存在现有 host-globals sourcemap 提示。
- 本轮独立重建当前源码的 macOS Pro WebDriver app：官方 `node e2e/run.mjs --pro -- --suite pro-query-builder` runner 通过；因 pnpm 的无 TTY 自动安装问题，将 `beforeBuildCommand` 临时改为 locale/menu 生成、`npx tsc --noEmit` 与 `VITE_E2E=1 npx vite build`，Tauri 配置在运行完成后 byte-for-byte 恢复。Tauri webdriver app build 成功，`node e2e/run.mjs --pro --skip-build -- --suite pro-query-builder` 4 specs / 22 tests 通过，worker database teardown 完成。旧二进制单独复跑也通过，但早于 BUG-001 commit；只将新建 app 的结果计入修复复验。
- **Round 2 历史判定：`TEST_FAILED`，BUG-002。** 当时独立 `git ls-remote https://github.com/flyxl/datazen-extension-sql-editor-pro.git HEAD refs/heads/main refs/heads/master` 仅返回上游 main；隔离 clone 无法 checkout Host lock pin。Bug 报告 commit：`7fb60778e`。该阻塞已在 Round 3 将同一 Pro commit 发布到 lock 配置的 feature branch 并通过 clean resolver clone 验证，详见上方。
- 本机 full release build 后仍未独立验证的发行项：Windows/Linux release build、正式签名凭据/公证、最终签名 manifest/bundle hash 与远端正式 release。

## Tester 独立复验（Round 3）

- Round 3 独立复验报告 commit：Host `eb409fc1ca63855a631ca5df8b5fc336f05e044b`。
- Host lock 精确内容：`git=https://github.com/flyxl/datazen-extension-sql-editor-pro.git`，`ref=2a45c90f28041e81c948e67b9416fade8ac5472f`；与 Pro 分支 `codex/qb-editor-pro` HEAD 一致。
- 独立 `git ls-remote --heads <lock.git> refs/heads/codex/qb-editor-pro refs/heads/main` 返回 feature ref=`2a45c90f28041e81c948e67b9416fade8ac5472f`、main=`c60f7fc8e1d552c6a37d3f70128d9c8e42555750`。只发布并更新 feature branch，main 未变。
- 从 Host lock 读取 URL/ref，独立调用 `scripts/resolve-pro.mjs` 的真实 `ensureProCheckout` 在新临时目录 clone + detached checkout；返回 `HEAD=2a45c90f28041e81c948e67b9416fade8ac5472f`，与 lock 完全相同；`git status --porcelain` 为空，验证后已清理临时 clone。
- BUG-001 focused regression：`npx vitest run src/windows/connection/query/__tests__/QueryEditorSection.qbContext.test.tsx` — 1 file / 1 test 通过。
- 前两轮 Host 全量单测（456 files / 4,514 tests）、Pro 全量单测（62 files / 774 tests）、Host/Pro TypeScript 检查、Panel（83.88%）及 DiagramCanvas（96.72%）行覆盖率、以及当前源码重建后 Pro WebDriver journey（4 specs / 22 tests）结果仍对应当前代码：Host 业务源码提交仍为 `d1c44f3cedf3d4685e8d767e698258edeb89bee9`，Pro 源码 HEAD 仍为 `2a45c90f28041e81c948e67b9416fade8ac5472f`；两者后续仅 Host 追踪文档提交，没有源码变更。Pro bundle、TypeScript 与 E2E 对应源码 commit 均未变化。
- 当前 Host 工作树只有临时未跟踪实现说明 `query-builder-editor-pro-implementation.md`；Pro 工作树 clean。Host `git diff --check d1c44f3..HEAD` 与 Pro `git diff --check e87541f..HEAD` 通过。全仓历史 i18n 缺口和未覆盖的发行构建门槛仍按前文记录，不计作本轮 pin gate 通过。

## 主分支集成后复核

- Host `feature/qb-editor-pro` 已用 merge commit `5c756c34945c2f60e06aa043f880f41ca8c414ca` 集成至本地 `main`；用户原有 Redis 原型文件和实现施工单仍保留为未跟踪文件，没有进入提交。集成后的 Host `npx vitest run` 456 files / 4,514 tests、`npx tsc --noEmit` 均通过。
- 使用当前源码之前刚生成的 Pro WebDriver app 运行 Pro SQL Editor E2E：`node e2e/run.mjs --pro --skip-build -- --suite pro-sql-editor` — 3 specs / 16 tests 通过。
- Blast-radius Query regression：`node e2e/run.mjs --pro --skip-build --instances 5 -- --suite qb-regression` — 5/5 workers 通过；包含连接后执行 SQL、query edge、工具栏响应式、navigator expansion 与 table-data；fixture teardown 完成。
- 以上 `--skip-build` 运行的 WebDriver binary 来自本次 BUG-001 修复后的 fresh Pro WebDriver build；随后只运行了 Vite production build 和 Tauri release build，Host/Pro runtime 源码未改变。runner 因 dist 时间戳更新显示 stale warning，但 E2E 覆盖的是同一 runtime commit。
- 本地构建只在 main 合并后重跑了 Host 全量测试/typecheck；Pro 全量测试、coverage、typecheck、fresh QB journey 和 pin clean-clone 检查由 Tester Round 2/3 对同一源码 SHA 独立完成。
