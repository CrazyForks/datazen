# Query Builder → Editor-Pro：Luna 逐文件施工单

本文件补足 [迁移与发布方案](query-builder-editor-pro-migration.md) 的实施步骤。按以下顺序改代码；前一阶段未通过测试不要开始后一阶段。目标是把 QB 的 UI、状态和 SQL 逻辑迁入独立 Pro Git 仓库，宿主只保留数据适配及 UI 插槽。

## 1. 固定运行数据流

```text
宿主 schemaStore/settingsStore → QueryBuilderHostAdapter → 插件 QueryBuilderPanel
工具栏 QB 图标按钮 → 插件 QB controller → 插件私有 Zustand store
QueryPanel 订阅 controller 的 openPanelId → 隐藏/显示结果区
插件 onCommit(sql, mode) → 宿主 updateSql → CodeMirror（绝不自动执行）
```

插件未加载时 `sqlEditorEnhancedEP.queryBuilder` 为 `undefined`，工具栏按钮和面板均不渲染。CodeMirror 打开 QB 时只 CSS 隐藏，保持挂载。

## 2. 宿主公共契约：按下面类型实现

新建 `packages/extension-points/src/queryBuilder.ts`，`TableSchema` 复用同包 `sql-editor/databaseTypes.ts`。在 `sqlEditorEnhancedEP.ts` 的 `SqlEditorEnhancedFeatures` 增加 `queryBuilder?: QueryBuilderContribution`；在包 `index.ts` 导出类型。不要导出插件 Zustand store。

```ts
import type { ComponentType } from 'react';
import type { TableSchema } from './sql-editor/databaseTypes';

export interface QueryBuilderCatalog {
  tables: readonly { name: string; schema: string | null }[];
  columnMap: Readonly<Record<string, readonly string[]>>;
  typedColumnMap: Readonly<Record<string, Readonly<Record<string, string>>>>;
}
export interface QueryBuilderRelationCandidate {
  id: string;
  fromTable: string;
  toTable: string;
  columnPairs: readonly { left: string; right: string }[];
  tier: 'high' | 'medium';
  ambiguous: boolean;
}
export interface QueryBuilderPanelProps {
  panelId: string;
  connectionId: string;
  dbSessionId: string;
  databaseType: string;
  database: string;
  schema: string | null;
  currentSql: string;
  catalog: QueryBuilderCatalog;
  dialectFamily: string;
  enableFkPrediction: boolean;
  ensureColumns(names: readonly string[]): Promise<void>;
  loadTableSchema(name: string): Promise<TableSchema | null>;
  predictRelations(schemas: readonly TableSchema[]): readonly QueryBuilderRelationCandidate[];
  formatSql(sql: string): string;
  onCommit(sql: string | null, mode: 'replace' | 'append'): void;
  onCancel(): void;
}
export interface QueryBuilderContribution {
  getOpenPanelId(): string | null;
  subscribe(listener: () => void): () => void;
  openFor(panelId: string, contextKey: string): void;
  hideFor(): void;
  closeFor(reason: 'ok' | 'cancel'): void;
  destroyFor(panelId: string): void;
  Panel: ComponentType<QueryBuilderPanelProps>;
  dispose(): void;
}
```

`getOpenPanelId()` 返回稳定原始值，避免 `useSyncExternalStore` 因新建对象循环渲染。fallback 不定义 `queryBuilder`。先给契约/registry 写测试：插件注册、卸载、热替换时监听器切换正确。

## 3. 宿主四处接线：具体代码位置

新建 `src/windows/connection/query/useQueryBuilderContribution.ts`：先 `useExtension(sqlEditorEnhancedEP)`，再 `useSyncExternalStore(qb?.subscribe ?? subscribeNone, qb?.getOpenPanelId ?? getNone, getNone)`，`subscribeNone`/`getNone` 是模块级常量；返回 `{ qb, openPanelId }`。控制器方法用稳定箭头函数，不能让 `this` 丢失。

新建 `src/windows/connection/query/QueryBuilderHostAdapter.tsx`，它接收控制器、当前 Query tab 的 `panelId/connectionId/dbSessionId/databaseType/database/schema/currentSql/onCommit/onCancel`，渲染 `<qb.Panel ... />`。在组件内：

1. `useSchemaStore(s => s.schemas.get(dbSessionId))` 读取**指定会话**的 `tables`、`columnMap`、`typedColumnMap`，映射成 `catalog`；不要读顶层 `s.tables`（它是活动连接镜像）。无会话数据时传空 catalog。
2. `ensureColumns(names)` 调 `useSchemaStore.getState().ensureColumns([...names], dbSessionId, database, { requireTypes: true })`。
3. `loadTableSchema(name)` 调 `getCachedTableSchema(dbSessionId, name, database, useSchemaStore.getState().schemaOfRelation(name, dbSessionId))`，失败返回 `null`。
4. `predictRelations(schemas)` 调 `predictRelations(toPredictionTablesFromSchemas(schemas))`。若 readonly 类型不匹配，改适配函数接收 readonly，不用 `any`。
5. `formatSql(sql)` 调 `formatSql(sql, databaseType, settings.sqlFormatOptions)`；传 `dialectFamily = DB_REGISTRY[databaseType]?.sqlDialect ?? databaseType` 和 `enableFkPrediction = settings.enableFkPrediction ?? false`。

`database`/`schema` 必须来自该 Query tab 的 `selectedDatabase/selectedSchema`，不能取活动 tab 的全局字段。`ensureColumns`/schema 请求在插件 effect 内加取消标志或 request generation；上下文切换后迟到结果不能写入当前画布。

逐文件替换：

| 文件 | 确切修改 |
| --- | --- |
| `QueryEditorSection.tsx` | 删除旧 QB store/Panel import。`qbOpen = openPanelId === panelId`；More 点击时 `qb?.openFor(panelId, JSON.stringify([connectionId,dbSessionId,selectedDatabase ?? '',selectedSchema ?? '']))` 或 `qb?.hideFor()`。旧 OK 的 replace/append、焦点、toast 逻辑保留，关闭改调 `qb?.closeFor('ok')`；Cancel 改调 `qb?.closeFor('cancel')`；旧 `<QueryBuilderPanel>` 换 `<QueryBuilderHostAdapter>`。只有 `qb` 存在时向菜单传 `onToggleQb`。 |
| `QueryPanel.tsx` | `qbOpenHere = openPanelId === panelId`，继续控制结果区挂载；删除旧 store import。 |
| `ContentView.tsx` | 保留现有 `knownPanelIdsRef` 比较，关闭 tab 时改调用 `useExtension(sqlEditorEnhancedEP).queryBuilder?.destroyFor(id)`；删除旧 store import。 |
| `QueryToolbarMoreMenu.tsx` | 保留 `onToggleQb && ...` 条件。菜单 `query.visualBuilder.title` 暂留宿主作为共享入口文案；面板内词条迁入插件。 |

此阶段结束，Community 无 QB 入口，SQL 编辑及结果区正常；旧 QB 实现文件暂留，待 Pro 功能测试通过后删除。

## 4. Pro 仓库：搬运顺序与每处依赖替换

在 `packages/pro-extensions/sql-editor-pro/src/query-builder/` 建模块，不把代码堆到 `proFeatures.ts`：

| 从宿主复制 | 插件目标 | 必须改动 |
| --- | --- | --- |
| `src/stores/queryBuilderStore.ts` | `store.ts` | 保持 per-panel sessions、entrySnapshot、Cancel 回滚；不从插件入口向宿主导出 store |
| `src/lib/sqlDialects/queryBuilder.ts` | `dialect.ts` | 移除宿主 `DB_REGISTRY` import；`getQbDialectAdapter` 改收 `dialectFamily`，未知值仍用 generic |
| `src/components/query-builder/types.ts`、验证/时间/类型/布局纯函数 | 对应同名文件 | 只改相对 import，原测试随文件迁入 |
| `hooks/useSqlGenerator.ts` | 同路径 | `databaseType` 用传入的 `dialectFamily` 解析；保留转义与分页诊断 |
| `DiagramCanvas/`、`BuildStatement/`、Preview/Dialogs | 同结构 | 宿主 UI import 换 `@datazen/ui`，文案 hook 换插件 `src/locales` |
| `QueryBuilderPanel.tsx` | 同名 | Props 换公共 `QueryBuilderPanelProps`；删所有宿主 store/lib/hook import |

`QueryBuilderPanel.tsx` 逐块替换：原 80–88 行 schema/settings 读取改用 props；150 行改调用 `props.ensureColumns`；175 行改 `props.loadTableSchema`；227 行改 `props.predictRelations(schemas)`；340 行从 `catalog.columnMap/typedColumnMap` 组卡片列；400 行改 `props.formatSql(sql)` 并保留 formatter 抛错时回退原 SQL；575 行从 `catalog.tables` 列候选。保留 FK 去重、组合键成组确认、预测仅 high 且非 ambiguous、SQL 冲突 replace/append/keep。预览与 OK 必须使用同一格式化 SQL。

宿主 `useConfirmDialog` 改成插件局部 `ConfirmDiscardDialog.tsx`，使用 `@datazen/ui/Dialog` 和 `Button`；宿主 `useResizable` 改局部 `useBuilderSplitter.ts`，沿用 `resize:qb-split-height`、默认 360、边界 140–620、reverse 方向。`cn`、`SelectOption` 都从 `@datazen/ui` 导入。`ColumnInfo` 可在插件局部定义 `{name,dataType,nullable}`。任何 `@host/*` 或指向宿主 `src/` 的相对 import 都是失败。

新建 `src/query-builder/contribution.tsx`：实例化单个私有 store/controller，`proFeatures.ts` 返回 `queryBuilder: createQueryBuilderContribution()`。方法语义：

- `getOpenPanelId`: `s.isOpen ? s.openPanelId : null`。
- `subscribe`: 订阅 store，只在上述标量变化时通知；返回真实 unsubscribe。
- `openFor(panelId, contextKey)`: 私有 `Map<panelId,contextKey>` 比较上下文，变了先 `destroyFor(panelId)` 再 `store.openFor(panelId)`；同 key 复用草稿。
- `hideFor/closeFor/destroyFor`: 转发原 store 对应方法；destroy 还删除 Map key。
- `Panel`: 指向新 `QueryBuilderPanel`；`dispose`: 清 Map、重置 store、解绑订阅；多次调用安全。

`src/index.ts` 的 cleanup 先注销 registry，再 `controller.dispose()`；再次 `activate` 先清旧实例，避免两个控制器并存。给这个生命周期写单测。

画布 `DiagramCanvas.tsx` 原来只读拖拽 payload 的 `namespace.table`。增加 `parseBuilderDrop(dataTransfer, context)`，校验 V1 `version/kind/connectionId/dbSessionId/database/schema/table`，且 table 在 catalog 中；非法数据返回 null，不改 store。旧 payload 没有 dbSessionId 时仍强制校验 connectionId。测试覆盖同连接、跨连接、跨会话、跨 schema、坏 JSON、未知表。

## 5. 测试、文案和产物的具体迁移

1. 把面板 `query.visualBuilder.*` 文案迁到 Pro `src/locales/en.ts`/`zh-CN.ts`，组件从插件 `locales/index.ts` 取 `useI18n`。保留宿主菜单标题 key。两语言 key 集合一致，其他宿主语言按发布 i18n 流程清理失效 key。
2. Pro `package.json` 显式加 `zustand`、`lucide-react` 等新增运行依赖；React、EP、`@datazen/ui` 继续与宿主共享。`pnpm build` 后检查 `dist/index.esm.js` 无未解析裸 import、`@host/*`、宿主绝对路径和重复 React。若修改 external，同步核对 `src/main.tsx` 与 `scripts/pack-ep.mjs` 的 host globals。
3. 原 QB 组件、store、方言测试复制到 Pro 对应 `__tests__`，mock 改公共 props；增补上下文隔离、controller 生命周期及 drop 安全测试。每次改 Pro 代码后在其目录运行 `pnpm test`。
4. 四条 `e2e/specs/journeys/visual-query-builder-*.ts` 和 `visualQueryBuilderHelpers.ts` 搬进 Pro `e2e/`，复用该目录现有 spec 对宿主 `e2e/helpers.js` 的相对导入方式。`e2e/wdio.conf.ts` 从 Community `journeys/query-builder` suite 移除，加入新的 `pro-query-builder` suite；根 `package.json` 把 `e2e:qb` 改为 `node e2e/run.mjs --pro -- --suite pro-query-builder`，另设 `e2e:qb:skip-build` 才允许复用已构建 Pro app。原 `qb-regression` 保留宿主交互回归。
5. 旧 E2E 依赖 `__qbStore`。仅 WebDriver 测试构建让插件注册 `window.__qbTest`，暴露受限 `reset/call/patch/read`；`call` 仅允许现有动作名白名单。当前 `scripts/e2e-tauri-build.mjs` 在 **Pro 打包之后** 才设置 `VITE_E2E=1`，因此还须在 `e2e/run.mjs` 启动 `with-driver-inject.mjs` 之前设置该变量，使 `pack-ep` 构建插件时也继承它。插件入口用 `import.meta.env.VITE_E2E` 编译期门控并在 `deactivate` 时删除测试全局；普通 `pnpm build` 不设置此变量。helper 改用 `__qbTest`。发行包不注册，需静态检查 bundle 和运行时断言。DOM 旅程继续验证真实点击路径。
6. Pro E2E 通过后删除宿主 QB 组件、store、专属 dialect 和 `src/main.tsx` 的 `__qbStore`。运行 `rg -n 'queryBuilderStore|components/query-builder|sqlDialects/queryBuilder|__qbStore' src e2e` 清余留引用。文档同步改为 Pro 功能。

## 6. 每阶段验收与提交

```bash
cd packages/pro-extensions/sql-editor-pro
pnpm test
pnpm exec tsc --noEmit
pnpm build

cd /Users/wuxiaolong/code/rust-projects/datazen
pnpm exec tsc --noEmit
pnpm test:unit
pnpm build
pnpm tauri:build:community
pnpm tauri:build:pro
pnpm e2e:pro:sql-editor
pnpm e2e:qb
pnpm e2e:qb:regression
node scripts/i18n-sync-check.mjs
git diff --check
```

发布判定：Community 没有入口且普通查询可用；Pro 的两个 tab 草稿隔离、隐藏恢复、Cancel 回滚、关闭 tab 清理、切库清理、OK 不执行、冲突三选项、方言分页和组合 FK 全通过；四条原 QB 旅程与 Pro suite 通过；签名生产包实际打开 QB。E2E 构建只用项目 Tauri/WebDriver 脚本，禁止裸 `cargo build`。

先提交宿主契约与接线，再提交 Pro 实现，最后清宿主旧代码。Pro 独立仓库提交后取得不可变 SHA，更新宿主 `pro-extension.lock.json`，重打签名包，核对 manifest、bundle hash 与 lock。两个 Git 仓库分别检查 status，不要提交无关 Redis 改动。Luna 每完成一阶段报告文件、命令和结果；有失败先修复再进入下一阶段。
