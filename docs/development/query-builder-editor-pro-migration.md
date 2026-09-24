# Query Builder 迁入 SQL Editor Pro：实施与发布方案

> 目标：将现有 Visual Query Builder 的实现、状态、文案和专属测试迁入独立的 `packages/pro-extensions/sql-editor-pro` 仓库；宿主只保留通用扩展契约、数据适配和界面容器。本文是开发任务书，不表示迁移已完成。执行者每完成一个阶段都应运行该阶段的验收命令并记录结果。

## 0. 已核实的基线与边界

- 当前入口在 `src/windows/connection/query/QueryEditorSection.tsx`；More 菜单在同目录的 `QueryToolbarMoreMenu.tsx`；结果区显隐在 `QueryPanel.tsx`；关闭 tab 时清状态在 `ContentView.tsx`。这些位置直接引用宿主 `src/stores/queryBuilderStore.ts`。`src/main.tsx` 将该 store 暴露为 `__qbStore` 供 E2E 使用。
- 实现位于 `src/components/query-builder/`、`src/lib/sqlDialects/queryBuilder.ts` 和 `src/stores/queryBuilderStore.ts`。它读取 `schemaStore`、`settingsStore`、schema cache、关系预测和宿主的 UI/Hook。现有行为见 `docs/features/query-builder.md`；PRD 见 `docs/prd/query-builder-prd.md`。
- Pro 插件是独立 Git 仓库，`packages/pro-extensions/sql-editor-pro/AGENTS.md` 禁止导入宿主内部路径。运行时由 `sqlEditorEnhancedEP` 注册，经 `scripts/resolve-pro.mjs`、`scripts/pack-ep.mjs` 打包签名，生产环境从 blob URL 加载。插件只能依赖公开契约及 `@datazen/ui` 等声明的包。
- 目前 Community 已公开发布 Query Builder 源码。迁走当前文件只能改变未来构建内容，不能抹去 Git 历史；发布文案、许可证和版本说明应如实说明功能归属变化。
- 现有根工作区有 Redis UI 的未提交改动，与本任务无关。执行迁移时不要覆盖、暂存或提交这些改动。宿主与 Pro 仓库必须分别提交。

## 1. 固定的产品行为

1. 仅 Pro 且插件已成功激活时，More 菜单出现 `Visual Builder`。Community 或插件加载失败时，该入口消失；SQL 编辑、执行、结果区照常工作，不能留下空白按钮或错误面板。
2. Builder 继续占用编辑器区域；CodeMirror 保持挂载，保留撤销历史、焦点和参数状态；结果区在 Builder 打开时隐藏。OK 只把 SQL 写回编辑器，绝不执行。已有 SQL 的替换/追加/继续编辑冲突对话框保持原语义。Cancel/× 处理未保存画布变更；菜单切换仅隐藏，不丢草稿。
3. 多 query tab 各有草稿；切换 tab 保留草稿，关闭 tab 删除其草稿；切换数据库会话不能展示旧 schema/关系。关系预测只有明确启用、高置信且无歧义时才给候选，且须用户确认后进入 SQL。
4. 保持当前 SELECT/FROM/WHERE/GROUP BY/HAVING/ORDER BY、聚合、别名、JOIN、DISTINCT、LIMIT/OFFSET、预览格式化、拖拽和 SQL 方言行为。保留现有 `data-testid` 以减少 E2E 重写。

## 2. 契约先行：宿主仓库的最小公共接口

在 `packages/extension-points/src/sqlEditorEnhancedEP.ts` 给 `SqlEditorEnhancedFeatures` 增加**可选**的 `queryBuilder?: QueryBuilderContribution`，类型单独放 `packages/extension-points/src/queryBuilder.ts` 并从包入口导出。不要把 Zustand store、宿主 React Hook 或 `Record<string, any>` 当作契约。建议结构：

```ts
interface QueryBuilderContribution {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Readonly<{ openPanelId: string | null; visible: boolean }>;
  openFor(panelId: string): void;
  hideFor(panelId: string): void;
  closeFor(panelId: string, reason: 'ok' | 'cancel'): void;
  destroyFor(panelId: string): void;
  render(props: QueryBuilderRenderProps): React.ReactNode;
}
interface QueryBuilderRenderProps {
  panelId: string;
  connectionId: string;
  dbSessionId: string;
  databaseType: string;
  database: string;
  schema: string | null;
  currentSql: string;
  catalog: QueryBuilderCatalog; // 表/列/类型/主键的只读快照
  options: { dialectFamily: string; enableFkPrediction: boolean; sqlFormatOptions: SqlFormatOptions };
  ensureColumns(tableNames: readonly string[]): Promise<void>;
  loadTableSchema(tableName: string): Promise<TableSchema | null>;
  predictRelations?(schemas: readonly TableSchema[]): readonly QueryBuilderRelationCandidate[];
  formatSql(sql: string): string;
  onCommit(sql: string | null, mode: 'replace' | 'append'): void;
  onCancel(): void;
}
```

以上是契约草图，写代码前应把 `QueryBuilderCatalog`、`SqlFormatOptions`、预测候选和只读 `TableSchema` 的完整字段定义写在公共包，映射当前消费者需要的字段。`getSnapshot` 在没有状态变化时必须返回同一对象引用，以供 `useSyncExternalStore` 使用。`subscribe` 取消订阅后不得继续通知。插件未安装时 `queryBuilder` 为 `undefined`，宿主不调用任何 Builder 方法。插件热插拔后使用新的 contribution，不缓存旧对象；卸载时订阅须清理，UI 关闭，旧草稿不得泄漏到新实例。

数据边界：宿主负责从 `schemaStore`/schema cache 构建 `catalog`、提供 `ensureColumns` 和 `loadTableSchema`，并通过当前 `predictRelations(toPredictionTablesFromSchemas(...))` 暴露预测结果。插件负责 FK 归一化、关系展示和确认。宿主传 `DB_REGISTRY[databaseType]?.sqlDialect ?? databaseType`，插件据此选择自身的方言适配器；未知方言沿用 generic 行为。不要把 `DB_REGISTRY` 整体传给插件。`formatSql` 调用宿主现有格式化逻辑，保证预览与编辑器设置一致。

拖拽沿用 `application/datazen-schema-object` V1 payload；在插件中校验 `version`、`kind`、`connectionId`、`dbSessionId`、namespace/database/schema 和非空 table，再决定是否接受。当前画布只读 `namespace.table`，跨连接拖入会被接受，这是迁移时必须补的缺陷。保留 legacy MIME 供 SQL 编辑器现有 drop 功能使用，Builder 不依赖 legacy 数据。

## 3. 实施顺序：每阶段一个可验收提交

### A. 建契约和宿主空壳（宿主提交）

1. 加 `QueryBuilderContribution` 和强类型 props；扩展点保持可选，原 fallback 保持无 Builder。加订阅/卸载/快照稳定性契约测试。
2. 新建宿主 `QueryBuilderHostAdapter`（放在 `src/windows/connection/query/`，必要时拆分），只负责从当前 session 的 schema/settings 获取数据和提供回调。对异步 `ensureColumns`、schema 请求使用 session/database key 与取消标记，迟到结果不得污染新会话。
3. 将 `QueryEditorSection`、`QueryPanel`、`ContentView` 和 More 菜单改用 `useExtension(sqlEditorEnhancedEP).queryBuilder`；用 `useSyncExternalStore` 观察状态，采用单一 helper 判定 `visible && openPanelId === panelId`。不要使用旧 `s.openPanelId ? ... : s.isOpen` 双模回退。OK、Cancel、焦点和 toast 仍由宿主容器处理；插件只决定生成的 SQL 和冲突选项。
4. 本阶段暂时保留旧实现及其测试，但不得让 Pro 和旧 Builder 同时出现；可以用临时适配器注册旧实现以保证开发期间可编译。阶段末 Community 的查询入口要按目标行为隐藏。

### B. 迁移 Builder 核心（Pro 仓库提交）

1. 按模块复制 `types`、store、`hooks/useSqlGenerator`、`validation`、`sqlDialects/queryBuilder`、关系组/画布/BuildStatement/Preview/对话框到 `src/query-builder/`；保留小文件结构，禁止汇成单个巨型 `proFeatures.ts`。
2. 将 `useQueryBuilderStore` 移入插件并只由 contribution 控制 open/hide/close/destroy。迁移 per-panel `sessions`、entrySnapshot、取消回滚；新增关闭 tab、session 变化、热卸载测试。
3. 所有 `../../stores/*`、`../../lib/*`、`../../hooks/*`、`../../components/ui/*` 和宿主 `types` 引用逐个替换：数据来自契约 props，UI 用 `@datazen/ui`；确认/可调分隔条在插件内实现小型局部组件；纯算法（方言、SQL 生成、验证、布局）直接迁入。禁止 `@host/*`、指向宿主 `src/` 的相对导入或运行时 `globalThis.__qbStore` 依赖。
4. 插件 `proFeatures.ts` 返回 `queryBuilder` contribution；`src/index.ts` 激活/卸载时确保订阅与会话清理。不要再用宿主 queryBuilderStore 作为真相源。

### C. 文案、打包和清理（先 Pro，后宿主分别提交）

1. 将 `query.visualBuilder.*` 文案迁入插件 `src/locales/en.ts` 与 `zh-CN.ts`，沿用相同 key 与共享 `@datazen/ui` i18n 单例。宿主开发期间只改 `en.ts`；本次是所有权迁移，其他宿主语言中的旧 key 应在发布前按 i18n 流程检查并清除，避免 Community 携带失效的 Pro 文案。
2. 处理插件打包依赖。`lucide-react`、Zustand、格式化器若由插件引用，应显式声明并验证签名后的 bundle 可加载；共享 React 必须仍从 `__DATAZEN_HOST__` 取同一单例。优先让插件自身打包非共享依赖；不要仅把裸包名加入 Vite external 而忘记同步 `src/main.tsx`、`scripts/pack-ep.mjs` 的 host globals 表。打包产物不得含未解析的 bare import、宿主绝对路径或重复 React。
3. Pro 功能与 E2E 稳定后，删除宿主 `src/components/query-builder/`、`src/stores/queryBuilderStore.ts`、`src/lib/sqlDialects/queryBuilder.ts` 中仅供 Builder 使用的代码，以及 `src/main.tsx` 的 `__qbStore`。先用 `rg` 检查余留引用；若宿主其他模块仍调用纯算法，应保留真正共享部分并写清边界。E2E 将 `__qbStore` 操作改为插件专属测试入口或真实 UI 交互；测试入口只在测试构建暴露，不进入发行包。
4. 更新 `docs/features/query-builder.md`、`docs/development/sql-editor-pro-development.zh-CN.md`、`packages/pro-extensions/sql-editor-pro/README.md`、Pro `AGENTS.md`、发布说明，明确 Pro 可用性、Community 行为和发布测试方法。

## 4. 测试与发布门槛

迁移原有单测到 Pro 仓库对应目录，保留 SQL 生成/方言/校验/存储/画布行为断言。新增最少这些契约/旅程：Community 无入口且查询正常；Pro 激活出现入口；插件加载失败降级；两 tab 草稿隔离和关闭清理；会话切换不串 schema；拖拽同连接成功、异连接/无效 payload 拒绝；OK 只写入不执行；冲突 replace/append/keep；Cancel 未保存确认；别名转义、组合 FK、预测需确认、各方言分页；卸载再加载无 stale listener；中英切换；生产签名 bundle 启动。沿用四条现有 QB journeys 并迁至 Pro suite，不能仅删旧 E2E。

执行命令（按实际脚本和平台配置运行，失败必须修复后重跑）：

```bash
# Pro 仓库
cd packages/pro-extensions/sql-editor-pro
pnpm test
pnpm exec tsc --noEmit
pnpm build

# 宿主仓库
cd /path/to/datazen
pnpm exec tsc --noEmit
pnpm test:unit
pnpm build
pnpm tauri:build:community
pnpm tauri:build:pro
pnpm e2e:pro:sql-editor
# 更新 Pro QB suite 后，运行其明确的脚本；旧 pnpm e2e:qb 仅在
# 尚指向同一 Pro suite 时可继续使用。
node scripts/i18n-sync-check.mjs
```

E2E 构建只能用项目的 Tauri/WebDriver 脚本，不能用裸 `cargo build`。手工在 macOS、Windows、Linux 各做一次生产包验证：打开 Pro、拖拽表、生成并应用 SQL、关闭/切 tab、重启；Community 入口隐藏且基本 SQL 流程可用。若某平台无法执行，应在发布记录中标明未验证，不能写“全平台通过”。

**发布顺序**：先在 Pro 仓库提交、构建、测试并取得不可变 commit SHA；再更新宿主 `pro-extension.lock.json` 的 `ref` 为该 SHA，按现有流程重新 `publish-pro-prebuilt`/签名打包并跑生产构建；最后单独提交宿主契约、容器、清理、文档和 lock。核对签名包中的 `manifest.json`、版本、实际 bundle hash 与 lock SHA 对应。发布前检查两仓库 `git status`，确认无生成文件、私有源码或无关 Redis 改动进入宿主提交。

## 5. 给 GPT Luna 的执行约束

一次只做一个阶段，每阶段开工先读所涉及目录的 `AGENTS.md` 和本文对应小节。每次改插件代码后在插件目录跑 `pnpm test`。每个阶段输出：修改文件清单、契约变化、测试命令与结果、尚未覆盖的风险；只有当前阶段所有门槛通过才进入下一阶段。若契约字段与现有类型不吻合，先修公共契约和适配器，再迁 UI；不要使用 `any`、宿主私有 import、临时全局变量或删除失败测试来使编译通过。最终以本节全部发布门槛为完成标准。
