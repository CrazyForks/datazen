- 任务：将 Visual Query Builder 实现、私有状态、单测与 WebDriver journeys 迁入独立 SQL Editor Pro；Host 保留公共契约、Query tab 适配与容器。
- 状态：READY_FOR_TEST
- 编码 commit：Pro `e87541fed6759d79971a4e8e9cfc01d3b9ba4a7b`；Host 随本文件一起提交（SHA 由最终报告记录）
- 测试 commit：由 Tester 阶段后补
- Worktree：`.worktrees/datazen-qb-editor-pro`
- Host 分支：`feature/qb-editor-pro`
- Pro 初始 HEAD：`c60f7fc8e1d552c6a37d3f70128d9c8e42555750`
- Pro 分支：`codex/qb-editor-pro`
- 执行方式：单一并发；Coder 自验完成，现交 Tester/R 复核

## 范围与实现

施工依据：`docs/development/query-builder-editor-pro-implementation.md`（临时未跟踪副本，不提交）及 `docs/development/query-builder-editor-pro-migration.md`。

- `@datazen/extension-points` 提供可选 Query Builder 契约；Host 通过 Query Editor Pro adapter 注入当前 Query tab 的 connection/session/database/schema、schema catalog、方言、SQL formatter 与关系预测服务。
- Query Editor Pro 私有持有 Builder store、SQL generator、validation、dialect adapter、组件与 locale；controller 按 panel/context 管理会话，并在 tab 销毁、context 切换和 EP dispose 时清理状态。
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
| 生产 bundle / Pro 打包 | 完成（本机 macOS 开发构建） | Host `node node_modules/vite/bin/vite.js build` 通过；生产 bundle 外部依赖、测试 bridge 与宿主绝对路径静态检查通过；Pro E2E Tauri build 生成并加载本机 Pro app |

## WebDriver journeys

命令：`node e2e/run.mjs --pro --skip-build -- --suite pro-query-builder`（4 spec passed）

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

## 留给 Tester / R 的发布门槛

- 从最终提交再次跑 Pro / Host 单测、类型检查和生产 Pro bundle 检查，并审查两仓提交与 lock SHA。
- Community 完整 webdriver build 与常规 Query 执行回归尚未在本轮运行；单测确认无 Pro contribution 时菜单不显示，Host 全量单测/类型检查通过。
- 多 OS release builds、正式签名凭据与远端发布尚未运行；本轮只验证本机开发签名加载与 macOS webdriver app。
- i18n 全仓 checker 的既有 Host/Redis locale 差额仍需发布流程决策；QB 的 Pro locale parity 已通过。

## Tester 与 Bug 记录

等待独立 Tester。Bug 使用 `bugs/qb-editor-pro-BUG-nnn.md`，本轮尚无待转交 Bug。
