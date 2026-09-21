# Design: 可视化查询构建器（Visual Query Builder）

> 前置文档：[PRD.md](./PRD.md)

## 1. 架构定位

可视化查询构建器属于 **SQL 编辑器的辅助工具**，定位为 Community 版内置功能。

### 1.1 在现有架构中的位置

```
ConnectionPage
├── ConnectionNavigatorTree (左侧导航树)
├── ContentView → QueryPanel
│   ├── QueryEditorSection
│   │   ├── ToolbarShell
│   │   │   ├── 执行/保存/格式化/... 按钮
│   │   │   └── [新增] 📐 可视化构建 按钮   ← 入口
│   │   ├── [新增] QueryBuilderPanel          ← 构建器面板（条件显示）
│   │   └── SqlEditor                         ← CodeMirror 编辑器
│   └── ResultSection
│       ├── ResultTable
│       └── ChartView
```

构建器面板与 SQL 编辑器**上下并列**，点击按钮切换展开/收起。展开时编辑器高度压缩（最小 120px），构建器占据剩余空间。

### 1.2 数据流全景

```
┌─────────────────────────────────────────────────────────┐
│                    QueryBuilderPanel                     │
│                                                         │
│  SchemaStore ──→ TableSelector ──→ ColumnSelector        │
│       │              │                  │                │
│       │              ↓                  ↓                │
│       │         ConditionGroup    SortClause / GroupBy   │
│       │              │                  │                │
│       │              ↓                  ↓                │
│       └──→ useSqlGenerator(state) ──→ SqlPreview        │
│                                         │                │
│                                    [应用到编辑器]         │
│                                         ↓                │
│                              SqlEditor.onUpdateSql(sql)  │
└─────────────────────────────────────────────────────────┘
```

## 2. 状态模型

### 2.1 Zustand Store：`queryBuilderStore`

独立于 `panelStore` 的轻量级纯 UI 状态 store，通过回调与 QueryPanel 联动。

```typescript
// src/stores/queryBuilderStore.ts

/** 单个条件 */
interface QbCondition {
  id: string;                    // nanoid
  table: string;                 // 表名
  column: string;                // 列名
  operator: QbOperator;         // 操作符
  value: string | null;          // 右值（IN 时逗号分隔）
  conjunction: 'AND' | 'OR';   // 与前一个条件的连接词
}

/** 条件组（支持嵌套） */
interface QbConditionGroup {
  id: string;
  logic: 'AND' | 'OR';         // 组内逻辑
  conditions: QbCondition[];
  groups: QbConditionGroup[];   // 嵌套子组（v1 仅支持一层）
}

/** 排序项 */
interface QbSortItem {
  table: string;
  column: string;
  direction: 'ASC' | 'DESC';
}

/** 构建器完整状态 */
interface QueryBuilderState {
  // ── 选择状态 ──
  selectedTables: string[];                           // 已选表名列表
  selectedColumns: Array<{
    table: string;
    column: string;
    alias?: string;
    aggregate?: QbAggregate;                          // 聚合函数
  }>;

  // ── 条件状态 ──
  where: QbConditionGroup;

  // ── 排序/分组 ──
  orderBy: QbSortItem[];
  groupBy: Array<{ table: string; column: string }>;
  distinct: boolean;

  // ── UI 状态 ──
  isOpen: boolean;                                    // 构建器面板展开
  previewSql: string;                                 // 实时预览的 SQL

  // ── Actions ──
  toggleTable: (tableName: string) => void;
  toggleColumn: (table: string, column: string) => void;
  setColumnAlias: (table: string, column: string, alias: string) => void;
  setColumnAggregate: (table: string, column: string, agg: QbAggregate | undefined) => void;
  addCondition: (group: string, condition: Omit<QbCondition, 'id'>) => void;
  updateCondition: (id: string, patch: Partial<QbCondition>) => void;
  removeCondition: (id: string) => void;
  addConditionGroup: (parentId: string, logic: 'AND' | 'OR') => void;
  addSort: (item: QbSortItem) => void;
  removeSort: (index: number) => void;
  addGroupBy: (item: { table: string; column: string }) => void;
  removeGroupBy: (index: number) => void;
  setDistinct: (v: boolean) => void;
  toggleOpen: () => void;
  applyToEditor: () => void;
  reset: () => void;
}

type QbOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL';
type QbAggregate = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
```

### 2.2 与 QueryPanel 的交互

构建器通过**回调函数**而非直接 store 操作与 QueryPanel 联动：

```typescript
// 在 QueryPanel 中
const handleApplyToEditor = useCallback((sql: string) => {
  onUpdateSql(sql);       // 更新编辑器内容
  queryBuilderStore.toggleOpen();  // 收起构建器
}, [onUpdateSql]);
```

### 2.3 Schema 元数据获取

复用现有 `schemaStore` 的数据：

```typescript
// 构建器内直接读取
const schemaState = useSchemaStore(s =>
  s.schemas.get(dbSessionId) ?? s
);
const tables = schemaState.tables;
const columnMap = schemaState.columnMap;  // Map<tableName, ColumnInfo[]>
```

不需要新增后端 IPC 命令。构建器首次展开时调用 `schemaStore.loadTables()` 确保元数据已加载。

## 3. 组件设计

### 3.1 目录结构

```
src/components/query-builder/
├── QueryBuilderPanel.tsx          # 主面板（包含布局控制）
├── TableSelector.tsx              # 表/视图多选器
├── ColumnSelector.tsx             # 列选择（含聚合/别名配置）
├── WhereClause.tsx                # WHERE 条件面板
├── ConditionGroup.tsx             # 条件组（递归渲染）
├── ConditionRow.tsx               # 单个条件行
├── SortClause.tsx                 # ORDER BY 配置
├── GroupByClause.tsx              # GROUP BY 配置
├── SqlPreview.tsx                 # 实时 SQL 预览
├── hooks/
│   ├── useSqlGenerator.ts         # 状态 → SQL 纯函数
│   └── useQueryBuilderColumns.ts  # 当前选中表的列信息
└── types.ts                       # 共享类型定义
```

### 3.2 组件层级与 Props

```tsx
// QueryBuilderPanel — 主入口
interface QueryBuilderPanelProps {
  dbSessionId: string;
  database?: string;
  databaseType?: string;
  onApplySql: (sql: string) => void;
}

// TableSelector
interface TableSelectorProps {
  tables: TableInfo[];
  selected: string[];
  onToggle: (name: string) => void;
}

// ColumnSelector
interface ColumnSelectorProps {
  columns: Map<string, ColumnInfo[]>;  // table → columns
  selected: QbColumnSelection[];
  onToggle: (table: string, column: string) => void;
  onSetAlias: (table: string, column: string, alias: string) => void;
  onSetAggregate: (table: string, column: string, agg: QbAggregate | undefined) => void;
}

// ConditionRow
interface ConditionRowProps {
  condition: QbCondition;
  availableColumns: Array<{ table: string; column: string; dataType: string }>;
  onUpdate: (patch: Partial<QbCondition>) => void;
  onRemove: () => void;
  isFirst: boolean;  // 第一行不显示 conjunction
}

// SortClause
interface SortClauseProps {
  items: QbSortItem[];
  availableColumns: Array<{ table: string; column: string }>;
  onAdd: (item: QbSortItem) => void;
  onRemove: (index: number) => void;
}

// SqlPreview
interface SqlPreviewProps {
  sql: string;
  loading: boolean;
}
```

### 3.3 UI 布局（暗色主题）

```
┌──────────────────────────────────────────────────────────┐
│ 📐 Query Builder                        [Distinct] [×]  │
├──────────────────────────────────────────────────────────┤
│ Tables                                                   │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ☑ users  ☑ orders  ☐ products  ☐ inventory  ...    │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ Columns                                                  │
│ ┌──────┬────────────┬───────────┬──────────────┐        │
│ │ Table│ Column     │ Aggregate │ Alias        │        │
│ ├──────┼────────────┼───────────┼──────────────┤        │
│ │users │ ☑ id      │           │              │        │
│ │users │ ☑ name    │           │              │        │
│ │orders│ ☑ total   │ SUM       │ sum_total    │        │
│ │orders│ ☑ user_id │           │              │        │
│ └──────┴────────────┴───────────┴──────────────┘        │
│                                                          │
│ WHERE                                                    │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ [users] [name] [=] ["John"]  AND  [users] [age] [>] │ │
│ │ [  18  ]                                            │ │
│ │                                                      │ │
│ │ + Add Condition  |  + Add Group (OR)                 │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ORDER BY                                                 │
│ [users.name ASC] [orders.total DESC]  [+ Add]           │
│                                                          │
│ GROUP BY                                                 │
│ [users.name]  [+ Add]                                   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ ── SQL Preview ──────────────────────────────────────    │
│ SELECT u.id, u.name, SUM(o.total) AS sum_total          │
│ FROM users u                                             │
│ INNER JOIN orders o ON o.user_id = u.id                  │
│ WHERE u.name = 'John' AND u.age > 18                     │
│ ORDER BY u.name ASC, o.total DESC;                       │
├──────────────────────────────────────────────────────────┤
│                                          [Apply to Editor]│
└──────────────────────────────────────────────────────────┘
```

## 4. SQL 生成引擎

### 4.1 核心算法

`useSqlGenerator` 是一个纯函数 hook，接收 `QueryBuilderState` 返回 SQL 字符串。

```typescript
// src/components/query-builder/hooks/useSqlGenerator.ts

interface SqlGeneratorInput {
  selectedTables: string[];
  selectedColumns: QbColumnSelection[];
  where: QbConditionGroup;
  orderBy: QbSortItem[];
  groupBy: Array<{ table: string; column: string }>;
  distinct: boolean;
  databaseType?: string;
}

function generateSql(input: SqlGeneratorInput): string {
  // 1. 构建 SELECT 子句
  const selectClause = buildSelectClause(input);

  // 2. 构建 FROM 子句
  const fromClause = buildFromClause(input);

  // 3. 构建 JOIN 子句（v1 仅处理自引用场景，完整 JOIN 留待 v1.1）
  const joinClause = buildJoinClause(input);

  // 4. 构建 WHERE 子句
  const whereClause = buildWhereClause(input);

  // 5. 构建 GROUP BY 子句
  const groupByClause = buildGroupByClause(input);

  // 6. 构建 ORDER BY 子句
  const orderByClause = buildOrderByClause(input);

  // 7. 拼接完整 SQL
  return `${selectClause}${fromClause}${joinClause}${whereClause}${groupByClause}${orderByClause};`;
}
```

### 4.2 方言差异处理

通过 `databaseType` 参数调整生成策略：

| 特性 | PostgreSQL | MySQL | SQLite | SQL Server |
|------|-----------|-------|--------|------------|
| 引号包裹 | `"col"` | `` `col` `` | `"col"` | `[col]` |
| LIMIT/OFFSET | `LIMIT n OFFSET m` | `LIMIT m, n` | `LIMIT n OFFSET m` | `TOP n` / `OFFSET FETCH` |
| ILIKE | 支持 | 不支持（用 LIKE） | 不支持（用 LIKE） | 不支持（用 LIKE） |
| 异名（alias） | `AS` | `AS` | `AS` | `AS` |

方言策略复用 `src/lib/sqlDialects/` 中的现有模式，新增一个 `queryBuilder.ts`：

```typescript
// src/lib/sqlDialects/queryBuilder.ts
import { DB_REGISTRY } from '../databaseTypes';
import type { DatabaseType } from '../../types';

interface DialectAdapter {
  quoteIdentifier(name: string): string;
  supportsILike: boolean;
  formatLimitOffset(limit: number, offset: number): string;
  formatNullSafe(column: string, isNull: boolean): string;
}

function getDialectAdapter(dbType?: string): DialectAdapter { ... }
```

### 4.3 SQL 生成示例

**输入状态：**
- 表：`users`, `orders`
- 列：`users.id`, `users.name`, `orders.total (SUM AS sum_total)`
- 条件：`users.name = 'John' AND users.age > 18`
- 排序：`users.name ASC`, `orders.total DESC`

**生成 SQL：**
```sql
SELECT users.id, users.name, SUM(orders.total) AS sum_total
FROM users
INNER JOIN orders ON orders.user_id = users.id
WHERE users.name = 'John' AND users.age > 18
ORDER BY users.name ASC, orders.total DESC;
```

> 注：JOIN 的 ON 条件在 v1 中从外键关系自动推断；无外键时不生成 JOIN，用户需手动切换到编辑器完成 JOIN 编写。

## 5. 与 SQL 编辑器的集成

### 5.1 入口按钮位置

在 `QueryEditorSection.tsx` 的 `ToolbarShell` 中，插入新按钮：

```tsx
// 在 ExecutionStrategySelect 之后，Save 按钮之前
<ToolbarButton
  compact={compactToolbar}
  variant={queryBuilderVisible ? 'secondary' : 'ghost'}
  label={t('query.visualBuilder')}
  icon={<LayoutGrid className="h-3.5 w-3.5" />}
  onClick={onToggleQueryBuilder}
/>
```

### 5.2 面板展开/收起

`QueryBuilderPanel` 在 `QueryEditorSection` 中条件渲染：

```tsx
{queryBuilderVisible && (
  <QueryBuilderPanel
    dbSessionId={dbSessionId}
    database={selectedDatabase}
    databaseType={databaseType}
    onApplySql={handleApplyToEditor}
  />
)}
```

编辑器区域高度通过 `useResizable` 动态调整，最小高度 120px。

### 5.3 应用 SQL 的回调链

```
QueryBuilderPanel → onApplySql(sql)
  → QueryEditorSection.handleApplyToEditor(sql)
    → onUpdateSql(sql)                    // 更新 panelStore 中的 sql
      → SqlEditor.onChange(sql)           // CodeMirror 更新
    → toggleOpen()                        // 收起构建器面板
    → editorRef.current?.focus()          // 焦点回到编辑器
```

## 6. 样式与主题

- **全部使用 `@datazen/ui` 组件**：Button, Select, Checkbox, Input, Badge, Label
- **颜色**：复用 `--c-surface` / `--c-fg` / `--c-accent` 等语义 token
- **间距**：使用 Tailwind `gap-*` / `p-*` / `m-*`
- **响应式**：`min-width: 640px` 以下切换为纵向堆叠布局
- **暗色主题**：默认暗色，跟随 `html.dark` class
- **动画**：面板展开/收起使用 `transition-all duration-200 ease-in-out`

## 7. 国际化

### 7.1 新增 i18n Key（en.ts）

```typescript
// src/locales/en.ts — 新增 key
query: {
  // ...existing keys...
  visualBuilder: 'Visual Builder',
  visualBuilderTooltip: 'Build query visually',
  qbTables: 'Tables',
  qbColumns: 'Columns',
  qbWhere: 'WHERE',
  qbOrderBy: 'ORDER BY',
  qbGroupBy: 'GROUP BY',
  qbDistinct: 'DISTINCT',
  qbAggregate: 'Aggregate',
  qbAlias: 'Alias',
  qbAnd: 'AND',
  qbOr: 'OR',
  qbAddCondition: 'Add Condition',
  qbAddGroup: 'Add Group',
  qbAddSort: 'Add Sort',
  qbAddGroupBy: 'Add Group By',
  qbApplyToEditor: 'Apply to Editor',
  qbSqlPreview: 'SQL Preview',
  qbNoTables: 'Select tables to start building your query',
  qbNoColumns: 'Select at least one column',
  qbOperatorEquals: '=',
  qbOperatorNotEquals: '!=',
  qbOperatorGreaterThan: '>',
  qbOperatorLessThan: '<',
  qbOperatorGreaterEquals: '>=',
  qbOperatorLessEquals: '<=',
  qbOperatorLike: 'LIKE',
  qbOperatorNotLike: 'NOT LIKE',
  qbOperatorIn: 'IN',
  qbOperatorNotIn: 'NOT IN',
  qbOperatorIsNull: 'IS NULL',
  qbOperatorIsNotNull: 'IS NOT NULL',
  qbAscending: 'ASC',
  qbDescending: 'DESC',
}
```

### 7.2 中文翻译

```typescript
// src/locales/zh-CN.ts
query: {
  visualBuilder: '可视化构建',
  visualBuilderTooltip: '以图形方式构建查询',
  qbTables: '表',
  qbColumns: '列',
  qbWhere: '条件',
  qbOrderBy: '排序',
  qbGroupBy: '分组',
  qbDistinct: '去重',
  qbAggregate: '聚合',
  qbAlias: '别名',
  qbAnd: '且',
  qbOr: '或',
  qbAddCondition: '添加条件',
  qbAddGroup: '添加条件组',
  qbAddSort: '添加排序',
  qbAddGroupBy: '添加分组',
  qbApplyToEditor: '应用到编辑器',
  qbSqlPreview: 'SQL 预览',
  qbNoTables: '请先选择表以开始构建查询',
  qbNoColumns: '请至少选择一列',
  // ...operators same as en (SQL keywords not translated)
}
```

## 8. 测试策略

| 层级 | 测试文件 | 覆盖内容 |
|------|---------|---------|
| **SQL 生成器单测** | `hooks/__tests__/useSqlGenerator.test.ts` | 纯函数路径覆盖：单表/多表、WHERE/AND/OR、ORDER BY、GROUP BY、聚合、DISTINCT、方言差异 |
| **条件组单测** | `__tests__/ConditionGroup.test.ts` | 嵌套条件组的增删改、逻辑切换 |
| **组件测试** | `__tests__/QueryBuilderPanel.test.tsx` | 面板渲染、表选择、列选择、应用 SQL |
| **E2E** | `e2e/specs/query-builder.spec.ts` | 完整流程：选表→选列→加条件→生成SQL→执行 |
| **方言测试** | `hooks/__tests__/dialectAdapter.test.ts` | 各数据库方言的 SQL 生成差异 |

## 9. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/components/query-builder/` | **新增** | 构建器全部组件 |
| `src/stores/queryBuilderStore.ts` | **新增** | 构建器 Zustand store |
| `src/lib/sqlDialects/queryBuilder.ts` | **新增** | SQL 方言适配器 |
| `src/windows/connection/query/QueryEditorSection.tsx` | 修改 | 添加工具栏按钮 + 面板渲染 |
| `src/locales/en.ts` | 修改 | 添加 i18n key |
| `src/locales/zh-CN.ts` | 修改 | 添加中文翻译 |
| `docs/features/query-builder.md` | **新增** | 用户文档 |
