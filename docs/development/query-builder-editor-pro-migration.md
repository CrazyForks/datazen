# Query Builder 迁入 SQL Editor Pro

## 状态

Query Builder 已迁入独立的 SQL Editor Pro 扩展，并通过第三轮独立验收。Pro 仓库 commit `2a45c90f28041e81c948e67b9416fade8ac5472f` 已发布到 `codex/qb-editor-pro` 分支；Host 的 `pro-extension.lock.json` 固定到该不可变 SHA。验收和剩余发行门槛见[轨道记录](coordination/tracks/qb-editor-pro/progress.md)。

代码完成并不代表跨平台发行签名已完成：Community/Pro 完整 release build、Windows/Linux 构建、正式签名凭据、最终签名 manifest/hash 与远端 release 尚未验证。

## 运行时边界

- Host `@datazen/extension-points` 导出可选 `QueryBuilderContribution`。SQL Editor Pro 未加载或加载失败时，契约为空，Builder 入口隐藏，Community 仍使用普通 SQL 编辑器。
- Host `QueryBuilderHostAdapter` 只适配当前 Query tab：提供连接与会话 ID、database/schema、只读 schema catalog、SQL 方言、格式化、列补全、表结构读取和关系预测。Host 不向扩展暴露 Zustand store 或整个 `DB_REGISTRY`。
- Pro contribution 独占 Builder React 面板、store、SQL generator、校验、方言规则、关系画布和 Pro 文案。扩展卸载时释放订阅和 panel 草稿。
- Query tab 的 connection/session/database/schema 构成 context key。Builder 打开期间 context 改变时，Host 在绘制前重新绑定 contribution；Pro controller 清理旧 context 草稿，避免旧表和 join 被新 database/schema 使用。tab 关闭时销毁对应 panel 状态。
- Builder 只生成并回填 SQL，不执行 SQL。Commit 支持 replace/append；取消可回滚未提交草稿。Pro 不可用时不显示 Builder 菜单。

## 数据与打包流程

1. Host 从当前 `dbSessionId` 的 schema state 构造 catalog，并通过 `ensureColumns` / `loadTableSchema` 提供惰性元数据读取。只选择与当前 database/schema 一致且表名无歧义的对象。
2. Host 通过公共契约传递 `connectionId`、`dbSessionId`、database/schema、catalog、dialect family、关系预测回调和格式化回调。Pro 不导入 Host 的 `src/` 文件。
3. Pro 拖放解析器只接受 schema-tree V1 payload，并校验版本、kind、connection、session、database、schema 以及 catalog 中存在的 table。过期或跨上下文的 payload 会被拒绝。
4. Pro 单独打包其非共享依赖；React、`@datazen/ui` 与 extension-points 使用 Host 单例。`VITE_E2E` 测试 bridge 只进入测试构建，生产 bundle 不含 `__qbTest` / `__qbStore`。
5. Pro 先独立提交并发布 feature ref；随后 Host lock 固定 Pro SHA。Release resolver 从 lock URL clone，再 detached checkout 该 SHA，因此 clean build 与本地测试使用相同版本。

## 代码与测试位置

- 公共契约：`packages/extension-points/src/queryBuilder.ts`。
- Host 适配和生命周期：`src/windows/connection/query/QueryBuilderHostAdapter.tsx`、`QueryEditorSection.tsx`、`QueryPanel.tsx`、`ContentView.tsx`。
- Pro 面板、controller、store、SQL 生成、校验、图表和 locale：`packages/pro-extensions/sql-editor-pro/src/query-builder/`、`src/components/query-builder/`、`src/stores/queryBuilderStore.ts`。
- Pro 专属单测和四条 WebDriver journeys 位于 SQL Editor Pro 仓库；Host 仅保留扩展契约、菜单、context lifecycle 等集成测试。旧 Host Builder、store、方言实现和 `__qbStore` 测试全局已移除。
- Pro E2E suite：`node e2e/run.mjs --pro --skip-build -- --suite pro-query-builder`。

## 验收结果

- Host 全量 Vitest：456 files / 4,514 tests；Pro 全量 Vitest：62 files / 774 tests。
- Host、Pro、Pro E2E TypeScript 检查和 Host module-layer 检查通过。
- Pro 原覆盖率 include scope：总体行覆盖率 88.72%；`QueryBuilderPanel` 83.88%，`DiagramCanvas` 96.72%。
- 当前源码重建的 macOS Pro WebDriver app：4 journeys / 22 tests 通过，测试数据库 fixture 已清理。
- Pro production Vite bundle 静态检查通过：无测试 bridge、Host 源码路径或未解析的 bare imports；共享运行时从 `__DATAZEN_HOST__` 获取。
- 独立测试通过远端 `git ls-remote` 和实际 `ensureProCheckout` clean clone 验证：lock SHA 可达，checkout SHA 与 lock 一致，checkout clean；远端 main 未变。
- `pnpm` 命令在本机无 TTY 环境会因依赖目录检查而尝试自动安装并中止（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）。为避免触碰共享 `node_modules`，已用项目 Node runner 和等价 Tauri 前端 build 命令完成 Pro WebDriver 构建；Tauri 配置随后恢复。

## 后续发行门槛

发布前仍需在实际发行流水线运行 Community 与 Pro 完整 Tauri release build、常规 Query 执行和 `e2e:qb:regression`，在 Windows/Linux 构建并验证正式签名、manifest 与 bundle hash，再执行正式 release。全仓 i18n checker 的历史 Host/Redis 翻译差额也需由发布翻译流程处理；Pro `en` / `zh-CN` key parity 已通过。
