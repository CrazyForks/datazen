- 任务：将 Visual Query Builder 实现、私有状态、单测与 WebDriver journeys 迁入独立 SQL Editor Pro；Host 保留公共契约、Query tab 适配与容器。
- 状态：TEST_FAILED
- 编码 commit：Host `497accbd665519d67a07cec83b19d44c90e0cdbf`；Pro `e87541fed6759d79971a4e8e9cfc01d3b9ba4a7b`
- Tester bug/test commit：Host `075ed41d76b87084563e5704abf6e5330a04b176`
- Tester 收尾 commit：由本次进度记录提交
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
| Pro QB 核心、私有 store、生命周期与拖放校验 | 完成 | Pro `npx tsc --noEmit` 通过；Pro 全量 Vitest 61 files / 767 tests 通过 |
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
- 覆盖率命令：Pro `npx vitest run --coverage --coverage.include='src/components/query-builder/**/*.ts' --coverage.include='src/components/query-builder/**/*.tsx' --coverage.include='src/query-builder/**/*.ts' --coverage.include='src/query-builder/**/*.tsx' --coverage.include='src/stores/queryBuilderStore.ts' --coverage.include='src/lib/sqlDialects/queryBuilder.ts' --coverage.reporter=json --coverage.reporter=text`。收集范围 lines 85.30%、statements 83.97%、branches 74.04%、functions 82.54%。核心逻辑 `contribution.tsx` 97.36%、store 86.44%、SQL generator 97.67%、validation 89.10%、dialect 82.41%、drop parser 96.29% lines；主要 UI 模块 `QueryBuilderPanel.tsx` 76.85%、`DiagramCanvas.tsx` 64.75%，尚未达到核心模块 ≥80% 的测试目标，需补覆盖。
- Pro production bundle 静态检查通过：无 `__qbTest`、`__qbStore`、`@host/` 或裸 external imports；确认 React/EP/UI 运行时从 `__DATAZEN_HOST__` 共享。
- `node e2e/run.mjs --pro --skip-build -- --suite pro-query-builder`：4 specs / 22 tests 通过，测试 worker fixture teardown 完成。该次使用现成 macOS Pro WebDriver app；runner 提示 app binary 早于刚生成的 Host `dist/index.html`，因此本轮证明 E2E 可运行，不等同于独立完成最终签名发行包重建。
- `node scripts/i18n-sync-check.mjs --from HEAD`：仍失败，报告 3,845 missing 与 1,650 stale translations（8 个 Host locales；Redis 两 locale packs 未报 driver pack issue）。Pro en/zh-CN QB key parity 在 Pro Vitest 中通过。Host/Redis 全仓差额需发布前由 i18n 流程处理。

## 剩余发布门槛

- Community Tauri 完整构建、常规 Query 执行 E2E、`e2e:qb:regression` 与完整 Pro Tauri release build 本轮未独立重跑。
- Windows/Linux release builds、正式签名凭据、最终签名 manifest/bundle hash 与远端发布未验证。
- 上述未验证项与 `QueryBuilderPanel` / `DiagramCanvas` 覆盖率未达目标，均不能据本轮结果标记为全平台发布通过。

## Tester 与 Bug 记录

第 1 轮 Tester 判定：`TEST_FAILED`。Bug：`bugs/qb-editor-pro-BUG-001.md`。修复后需由全新 Tester 重跑完整 Pro / Host 套件、覆盖率与发布门槛。
