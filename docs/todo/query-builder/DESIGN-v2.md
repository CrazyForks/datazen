# Design v2: 可视化查询构建器（Visual Query Builder）

> 前置文档：[PRD-v2.md](./PRD-v2.md) · 参考：[Navicat Query Builder](https://www.navicat.com/en/company/aboutus/blog/673-design-select-queries-using-navicat-s-query-builder)

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
│   │   │   └── [新增] 📊 Visual Builder 按钮   ← 入口
│   │   ├── [新增] QueryBuilderPanel             ← 构建器面板（条件显示）
│   │   │   ├── ObjectTreePanel                  ← 左侧：数据库对象树
│   │   │   ├── DiagramCanvas                    ← 中间：画布（表卡片 + JOIN 连线）
│   │   │   ├── CriteriaGrid                     ← 下方：条件/排序/聚合网格
│   │   │   └── SqlPreview                       ← 底部：SQL 预览
│   │   └── SqlEditor                            ← CodeMirror 编辑器
│   └── ResultSection
│       ├── ResultTable
│       └── ChartView
```

### 1.2 数据流全景

```
┌──────────────────────────────────────────────────────────────────────┐
│                        QueryBuilderPanel                             │
│                                                                      │
│  ┌──────────┐    ┌─────────────────────────────────────────────┐    │
│  │ Schema   │───→│ DiagramCanvas                               │    │
│  │ Store    │    │  ┌─────────┐   JOIN连线   ┌─────────┐      │    │
│  │          │    │  │ TableCard│══════════════│TableCard│      │    │
│  │  Tables  │    │  │ (columns │   SVG路径    │ (columns │      │    │
│  │  Columns │    │  │  PK/FK)  │             │  PK/FK)  │      │    │
│  │  FK refs │    │  └─────────┘             └─────────┘      │    │
│  └──────────┘    └──────────────────────┬──────────────────────┘    │
│                                         │                           │
│                                         ↓                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    CriteriaGrid                              │    │
│  │  ┌───────┬───────┬───────┬──────┬──────┬──────┬──────┐    │    │
│  │  │ ☑     │ Field │ Table │Alias │ Sort │ Func │Where │    │    │
│  │  ├───────┼───────┼───────┼──────┼──────┼──────┼──────┤    │    │
│  │  │ ☑     │ id    │ users │      │ ASC  │      │      │    │    │
│  │  │ ☑     │ amount│orders │      │      │ SUM  │ >100 │    │    │
│  │  └───────┴───────┴───────┴──────┴──────┴──────┴──────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                         │                           │
│                                         ↓                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ useSqlGenerator(state) ──→ SqlPreview                       │    │
│  │                                          [Apply SQL]        │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. 状态模型

### 2.1 Zustand Store：`queryBuilderStore`

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

/** JOIN 关系 */
interface QbJoin {
  id: string;
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
  isManual: boolean;            // true=手动创建, false=自动检测
}

/** 列选择项（增强版，含排序/分组/条件） */
interface QbColumnSelection {
  table: string;
  column: string;
  alias?: string;
  aggregate?: QbAggregate;
  sort?: 'ASC' | 'DESC';       // 排序方向
  groupBy?: boolean;            // 是否参与 GROUP BY
  where?: QbCondition;         // WHERE 条件
}

/** 构建器完整状态 */
interface QueryBuilderState {
  // ── 选择状态 ──
  selectedTables: string[];
  tableAliases: Record<string, string>;        // 表别名映射
  selectedColumns: QbColumnSelection[];

  // ── JOIN 状态 ──
  joins: QbJoin[];
  autoJoins: QbJoin[];                         // 自动检测的 FK 关系（虚线）

  // ── 条件状态 ──
  where: QbConditionGroup;

  // ── 排序/分组 ──
  orderBy: QbSortItem[];
  groupBy: Array<{ table: string; column: string }>;
  distinct: boolean;
  limit: number | null;
  offset: number | null;

  // ── UI 状态 ──
  isOpen: boolean;
  previewSql: string;
  canvasOffset: { x: number; y: number };
  zoom: number;

  // ── 画布中表卡片位置 ──
  tablePositions: Record<string, { x: number; y: number }>;

  // ── Actions ──
  toggleTable: (tableName: string) => void;
  setTableAlias: (tableName: string, alias: string) => void;
  toggleColumn: (table: string, column: string) => void;
  updateColumnConfig: (table: string, column: string, patch: Partial<QbColumnSelection>) => void;

  // JOIN actions
  addJoin: (join: Omit<QbJoin, 'id'>) => void;
  removeJoin: (id: string) => void;
  updateJoinType: (id: string, type: QbJoin['type']) => void;

  // 条件 actions
  addCondition: (group: string, condition: Omit<QbCondition, 'id'>) => void;
  updateCondition: (id: string, patch: Partial<QbCondition>) => void;
  removeCondition: (id: string) => void;
  addConditionGroup: (parentId: string, logic: 'AND' | 'OR') => void;

  // 排序/分组 actions
  addSort: (item: QbSortItem) => void;
  removeSort: (index: number) => void;
  addGroupBy: (item: { table: string; column: string }) => void;
  removeGroupBy: (index: number) => void;

  // 通用 actions
  setDistinct: (v: boolean) => void;
  setLimit: (limit: number | null) => void;
  setOffset: (offset: number | null) => void;
  toggleOpen: () => void;
  updateTablePosition: (table: string, pos: { x: number; y: number }) => void;
  setZoom: (zoom: number) => void;
  setCanvasOffset: (offset: { x: number; y: number }) => void;
  reset: () => void;
}

type QbOperator = '=' | '!=' | '>' | '<' | '>=' | '<='
  | 'LIKE' | 'NOT LIKE' | 'ILIKE'
  | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL';
type QbAggregate = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
type QbJoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
```

## 3. 组件设计

### 3.1 目录结构

```
src/components/query-builder/
├── QueryBuilderPanel.tsx              # 主面板（三区域布局控制）
├── ObjectTreePanel.tsx                # 左侧：数据库对象树
├── DiagramCanvas/
│   ├── DiagramCanvas.tsx              # 画布容器（SVG + 拖拽/缩放）
│   ├── TableCard.tsx                  # 表卡片（列列表 + PK/FK 徽章）
│   ├── JoinLine.tsx                   # JOIN 连线（SVG 贝塞尔曲线）
│   ├── JoinLabel.tsx                  # JOIN 标签（类型 + ON 条件）
│   └── useCanvasInteraction.ts        # 画布交互 hook（拖拽/缩放/平移）
├── CriteriaGrid/
│   ├── CriteriaGrid.tsx               # 条件网格容器
│   ├── CriteriaRow.tsx                # 单行（字段/别名/排序/聚合/条件）
│   ├── CriteriaCell.tsx               # 单元格（下拉/输入/复选）
│   └── WhereEditor.tsx                # WHERE 条件编辑弹窗
├── SqlPreview.tsx                     # 实时 SQL 预览
├── hooks/
│   ├── useSqlGenerator.ts             # 状态 → SQL 纯函数
│   ├── useAutoJoin.ts                 # 自动检测 FK 关系
│   └── useCanvasInteraction.ts        # 画布拖拽/缩放
└── types.ts                           # 共享类型定义
```

### 3.2 组件层级与 Props

```tsx
// QueryBuilderPanel — 主入口
interface QueryBuilderPanelProps {
  dbSessionId: string;
  databaseType?: string;
  onApplySql: (sql: string) => void;
}

// ObjectTreePanel
interface ObjectTreePanelProps {
  dbSessionId: string;
  tables: TableInfo[];
  selectedTables: string[];
  onAddTable: (tableName: string) => void;
}

// DiagramCanvas
interface DiagramCanvasProps {
  selectedTables: string[];
  tablePositions: Record<string, { x: number; y: number }>;
  joins: QbJoin[];
  autoJoins: QbJoin[];
  columnMap: Record<string, string[]>;
  columnInfoMap: Record<string, ColumnInfo[]>;
  selectedColumns: QbColumnSelection[];
  tableAliases: Record<string, string>;
  onToggleColumn: (table: string, column: string) => void;
  onUpdatePosition: (table: string, pos: { x: number; y: number }) => void;
  onAddJoin: (join: Omit<QbJoin, 'id'>) => void;
  onUpdateJoinType: (id: string, type: QbJoinType) => void;
  onRemoveJoin: (id: string) => void;
}

// TableCard
interface TableCardProps {
  tableName: string;
  alias?: string;
  columns: ColumnInfo[];
  selectedColumns: string[];
  position: { x: number; y: number };
  onToggleColumn: (column: string) => void;
  onDragEnd: (pos: { x: number; y: number }) => void;
}

// JoinLine (SVG)
interface JoinLineProps {
  join: QbJoin;
  fromPos: { x: number; y: number };
  toPos: { x: number; y: number };
  isAuto: boolean;
  onUpdateType: (type: QbJoinType) => void;
  onRemove: () => void;
}

// CriteriaGrid
interface CriteriaGridProps {
  selectedColumns: QbColumnSelection[];
  onUpdateColumn: (table: string, column: string, patch: Partial<QbColumnSelection>) => void;
  onRemoveColumn: (table: string, column: string) => void;
}

// CriteriaRow
interface CriteriaRowProps {
  selection: QbColumnSelection;
  onUpdate: (patch: Partial<QbColumnSelection>) => void;
  onRemove: () => void;
}
```

### 3.3 UI 布局（暗色主题）

```
┌──────────────────────────────────────────────────────────────────┐
│ 📊 Visual Builder                        [DISTINCT ☐] [Reset] [×]│
├──────────┬───────────────────────────────────────────────────────┤
│ 对象树    │              画布区 (Diagram Canvas)                   │
│ (200px)  │                                                       │
│          │   ┌───────────┐    JOIN 连线    ┌───────────┐         │
│ Schema   │   │  users    │════════════════│  orders   │         │
│ ├─ users │   │ ■ id  PK  │                │ ■ id      │         │
│ ├─ orders│   │ □ name    │                │ ■ user_id │         │
│ └─ films │   │ □ email   │                │ □ amount  │         │
│          │   └───────────┘                └───────────┘         │
│  [拖入表] │                                                       │
├──────────┼───────────────────────────────────────────────────────┤
│          │          Criteria Grid (配置区)                        │
│          │  ┌────┬───────┬───────┬──────┬──────┬──────┬──────┐ │
│          │  │ ☑  │ Field │ Table │Alias │ Sort │ Func │Where │ │
│          │  ├────┼───────┼───────┼──────┼──────┼──────┼──────┤ │
│          │  │ ☑  │ id    │ users │      │ ASC  │      │      │ │
│          │  │ ☑  │ name  │ users │      │      │      │      │ │
│          │  │ ☑  │amount │orders │      │      │ SUM  │ >100 │ │
│          │  └────┴───────┴───────┴──────┴──────┴──────┴──────┘ │
├──────────┼───────────────────────────────────────────────────────┤
│          │          SQL Preview (语法区)                          │
│          │  SELECT users.id, users.name, SUM(orders.amount)     │
│          │  FROM users                                           │
│          │  INNER JOIN orders ON users.id = orders.user_id      │
│          │  GROUP BY users.id, users.name                        │
│          │  HAVING SUM(orders.amount) > 100                     │
│          │  ORDER BY users.id ASC                                │
│          │  LIMIT 50;                         [Apply SQL ▶]      │
└──────────┴───────────────────────────────────────────────────────┘
```

### 3.4 表卡片详细设计

```
┌─ users ─────────────────┐
│ 📋 users    Alias: [  ] │
│ ─────────────────────────│
│ ☑ id      INT      PK   │  ← Checkbox + 列名 + 类型 + PK 徽章
│ ☑ name    VARCHAR       │
│ ☐ email   VARCHAR       │
│ ☐ created_at TIMESTAMP  │
│ ─────────────────────────│
│ Drag handle ⋮⋮           │  ← 拖拽移动手柄
└──────────────────────────┘
```

**列项设计**：
- 左侧 Checkbox：勾选进入 SELECT
- 列名：正常字体
- 数据类型：灰色小字
- PK 徽章：金色背景 `PK`
- FK 徽章：蓝色背景 `FK` + 关联表名

### 3.5 JOIN 连线设计

**连线样式**：
- 实线 + 动画虚线：已确认的 JOIN
- 虚线：自动检测到的 FK 关系（未确认）
- 线上标签：`INNER JOIN` / `LEFT JOIN` 等
- 线下标签：`ON users.id = orders.user_id`

**交互**：
- 从一表字段拖到另一表字段 → 建立 JOIN
- 点击连线 → 编辑 JOIN 类型
- 右键连线 → 删除 JOIN

### 3.6 Criteria Grid 设计

采用类似 Excel 的网格布局：

| 列 | 宽度 | 描述 |
|----|------|------|
| ☑ | 30px | 勾选是否包含在 SELECT |
| Field | auto | 字段名（下拉选择） |
| Table | 100px | 所属表名（自动填充） |
| Alias | 100px | 字段别名（可选） |
| Sort | 80px | 排序方向（None/ASC/DESC） |
| Func | 100px | 聚合函数（None/COUNT/SUM/AVG/MIN/MAX） |
| Where | auto | WHERE 条件（操作符 + 值） |
| Group | 50px | 是否 GROUP BY |

## 4. SQL 生成引擎

### 4.1 核心算法

```typescript
// src/components/query-builder/hooks/useSqlGenerator.ts

interface SqlGeneratorInput {
  selectedTables: string[];
  tableAliases: Record<string, string>;
  selectedColumns: QbColumnSelection[];
  joins: QbJoin[];
  where: QbConditionGroup;
  orderBy: QbSortItem[];
  groupBy: Array<{ table: string; column: string }>;
  distinct: boolean;
  limit: number | null;
  offset: number | null;
  databaseType?: string;
}

function generateSql(input: SqlGeneratorInput): string {
  const select = buildSelectClause(input);
  const from = buildFromClause(input);
  const join = buildJoinClause(input);
  const where = buildWhereClause(input);
  const groupBy = buildGroupByClause(input);
  const having = buildHavingClause(input);
  const orderBy = buildOrderByClause(input);
  const limitOffset = buildLimitOffsetClause(input);

  return `${select}${from}${join}${where}${groupBy}${having}${orderBy}${limitOffset};`;
}
```

### 4.2 JOIN 生成

```typescript
function buildJoinClause(input: SqlGeneratorInput): string {
  if (input.joins.length === 0) return '';

  return '\n' + input.joins.map(join => {
    const left = formatTableColumn(join.leftTable, join.leftColumn, input.tableAliases);
    const right = formatTableColumn(join.rightTable, join.rightColumn, input.tableAliases);
    return `${join.type} JOIN ${join.rightTable} ON ${left} = ${right}`;
  }).join('\n');
}
```

### 4.3 方言差异

| 特性 | PostgreSQL | MySQL | SQLite |
|------|-----------|-------|--------|
| 引号包裹 | `"col"` | `` `col` `` | `"col"` |
| LIMIT/OFFSET | `LIMIT n OFFSET m` | `LIMIT m, n` | `LIMIT n OFFSET m` |
| ILIKE | 支持 | 不支持（用 LIKE） | 不支持（用 LIKE） |
| JOIN 语法 | 标准 | 标准 | 标准 |

## 5. 与 SQL 编辑器的集成

### 5.1 入口按钮

```tsx
// QueryEditorSection.tsx — ToolbarShell 中
<ToolbarButton
  compact={compactToolbar}
  variant={qbOpen ? 'secondary' : 'ghost'}
  label={t('query.visualBuilder.title')}
  icon={<WandSparkles className="h-3.5 w-3.5" />}
  onClick={toggleQb}
  data-testid="qb-toggle-button"
/>
```

### 5.2 面板展开/收起

```tsx
// QueryEditorSection.tsx
{qbOpen && (
  <QueryBuilderPanel
    dbSessionId={dbSessionId}
    databaseType={databaseType}
    onApplySql={(sql) => {
      onUpdateSql(sql);
      toggleQb();
    }}
  />
)}
```

### 5.3 应用 SQL 回调链

```
QueryBuilderPanel.onApplySql(sql)
  → QueryEditorSection.handleApplyToEditor(sql)
    → onUpdateSql(sql)           // 更新 panelStore 中的 sql
      → SqlEditor.onChange(sql)  // CodeMirror 更新
    → toggleQb()                 // 收起构建器
    → editorRef.current?.focus() // 焦点回到编辑器
```

## 6. 自动 JOIN 检测

### 6.1 FK 元数据获取

通过现有 `execute_driver_command` 获取外键信息：

```typescript
// Schema Store 已有外键信息
const foreignKeys = useSchemaStore(s => s.foreignKeys);
// foreignKeys: Array<{ fromTable, fromColumn, toTable, toColumn }>

// 当用户选择多表时，自动检测 FK 关系
function detectAutoJoins(
  selectedTables: string[],
  foreignKeys: ForeignKeyInfo[]
): QbJoin[] {
  return foreignKeys
    .filter(fk =>
      selectedTables.includes(fk.fromTable) &&
      selectedTables.includes(fk.toTable)
    )
    .map(fk => ({
      id: `auto-${fk.fromTable}.${fk.fromColumn}-${fk.toTable}.${fk.toColumn}`,
      type: 'INNER',
      leftTable: fk.fromTable,
      leftColumn: fk.fromColumn,
      rightTable: fk.toTable,
      rightColumn: fk.toColumn,
      isManual: false,
    }));
}
```

### 6.2 手动 JOIN

用户从一表字段拖到另一表字段时：

1. 检测目标字段是否在不同表
2. 创建 `QbJoin`（`isManual: true`）
3. 在画布上绘制实线

## 7. 画布交互

### 7.1 拖拽移动表卡片

- 使用 `onPointerDown/Move/Up` 实现拖拽
- 更新 `tablePositions` 状态
- 卡片边界检测（不超出画布）

### 7.2 缩放/平移

- 鼠标滚轮：缩放（0.5x ~ 2x）
- 空格 + 拖拽：平移画布
- 画布偏移存储在 `canvasOffset` 状态

### 7.3 JOIN 连线绘制

使用 SVG `<path>` 绘制贝塞尔曲线：

```typescript
// 两点之间的贝塞尔曲线
function bezierPath(from: Point, to: Point): string {
  const dx = Math.abs(to.x - from.x);
  const cp = dx * 0.5; // 控制点偏移
  return `M ${from.x} ${from.y} C ${from.x + cp} ${from.y}, ${to.x - cp} ${to.y}, ${to.x} ${to.y}`;
}
```

## 8. 样式与主题

- **全部使用 `@datazen/ui` 组件**：Button, Select, Checkbox, Input, Badge, Label
- **画布背景**：网格点阵（`dot pattern`）
- **表卡片**：`bg-surface-raised border border-edge rounded-lg shadow-lg`
- **JOIN 连线**：`stroke-accent` 实线，`stroke-muted` 虚线
- **PK 徽章**：`bg-amber-500/20 text-amber-400`
- **FK 徽章**：`bg-blue-500/20 text-blue-400`
- **暗色主题**：默认暗色，跟随 `html.dark` class

## 9. 国际化

### 9.1 新增 i18n Key（en.ts）

```typescript
query: {
  visualBuilder: { title: 'Visual Builder', tooltip: 'Build query visually' },
  // 画布
  qbDragHint: 'Drag tables here to build your query',
  qbAutoJoin: 'Auto-detected relationship',
  // 表卡片
  qbTableAlias: 'Alias',
  qbPrimaryKey: 'PK',
  qbForeignKey: 'FK',
  // JOIN
  qbJoinType: 'Join Type',
  qbInnerJoin: 'INNER JOIN',
  qbLeftJoin: 'LEFT JOIN',
  qbRightJoin: 'RIGHT JOIN',
  qbFullJoin: 'FULL JOIN',
  qbJoinOn: 'ON',
  qbRemoveJoin: 'Remove JOIN',
  // Criteria Grid
  qbField: 'Field',
  qbTable: 'Table',
  qbAlias: 'Alias',
  qbSort: 'Sort',
  qbFunc: 'Function',
  qbWhere: 'Where',
  qbGroup: 'Group',
  qbNone: 'None',
  qbAscending: 'ASC',
  qbDescending: 'DESC',
  // LIMIT
  qbLimit: 'Limit',
  qbOffset: 'Offset',
  // 通用
  qbReset: 'Reset',
  qbApplySql: 'Apply SQL',
  qbClose: 'Close',
  qbDistinct: 'DISTINCT',
  qbNoTables: 'Drag tables from the left panel to start',
  qbNoColumns: 'Select at least one column',
}
```

## 10. 测试策略

| 层级 | 测试文件 | 覆盖内容 |
|------|---------|---------|
| **SQL 生成器单测** | `hooks/__tests__/useSqlGenerator.test.ts` | 纯函数：单表/多表、JOIN、WHERE/AND/OR、ORDER BY、GROUP BY、聚合、DISTINCT、LIMIT/OFFSET、方言差异 |
| **Store 单测** | `__tests__/queryBuilderStore.test.ts` | 所有 action 路径 |
| **自动 JOIN 单测** | `hooks/__tests__/useAutoJoin.test.ts` | FK 检测、多表关联、无 FK 场景 |
| **组件测试** | `__tests__/QueryBuilderPanel.test.tsx` | 面板渲染、表选择、列选择、应用 SQL |
| **E2E** | `e2e/specs/journeys/visual-query-builder-journey.ts` | 完整流程：拖入表→选列→建JOIN→条件→生成SQL→执行 |

## 11. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/components/query-builder/` | **重构** | 画布组件、表卡片、JOIN 连线、Criteria Grid |
| `src/stores/queryBuilderStore.ts` | **重构** | 新增 JOIN/画布/LIMIT 状态 |
| `src/lib/sqlDialects/queryBuilder.ts` | **扩展** | 新增 JOIN/LIMIT 生成 |
| `src/windows/connection/query/QueryEditorSection.tsx` | 修改 | 面板布局调整 |
| `src/locales/en/query.ts` | 修改 | 新增 i18n key |
| `src/locales/zh-CN/query.ts` | 修改 | 新增中文翻译 |
