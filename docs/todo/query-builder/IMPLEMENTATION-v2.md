# Implementation Plan v2: 可视化查询构建器

> 前置文档：[PRD-v2.md](./PRD-v2.md) · [DESIGN-v2.md](./DESIGN-v2.md)
> 参考：[Navicat Query Builder](https://www.navicat.com/en/company/aboutus/blog/673-design-select-queries-using-navicat-s-query-builder)

## 0. 现有代码盘点

### 可复用（保留并增强）

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/lib/sqlDialects/queryBuilder.ts` | ✅ 保留 | 5 方言 SQL 生成，需扩展 JOIN/LIMIT |
| `src/components/query-builder/types.ts` | ✅ 保留 | 类型定义，需扩展 |
| `src/stores/queryBuilderStore.ts` | 🔨 重构 | 现有字段保留，新增 JOIN/画布/LIMIT 状态 |
| `src/components/query-builder/SqlPreview.tsx` | ✅ 保留 | SQL 预览组件 |
| `src/components/query-builder/WhereClause.tsx` | 🔨 迁移 | WHERE 逻辑迁移到 CriteriaGrid |
| `src/components/query-builder/ConditionRow.tsx` | 🔨 迁移 | 条件行迁移到 CriteriaGrid |
| `src/components/query-builder/ConditionGroup.tsx` | 🔨 迁移 | 条件组迁移到 CriteriaGrid |

### 需重写

| 文件 | 原因 |
|------|------|
| `src/components/query-builder/QueryBuilderPanel.tsx` | 从两栏表单改为三区域画布布局 |
| `src/components/query-builder/TableSelector.tsx` | 从 Checkbox 列表改为对象树 + 拖拽 |
| `src/components/query-builder/ColumnSelector.tsx` | 从 Checkbox 列表改为画布内表卡片 |
| `src/components/query-builder/SortClause.tsx` | 从独立组件改为 CriteriaGrid 内置 |
| `src/components/query-builder/GroupByClause.tsx` | 从独立组件改为 CriteriaGrid 内置 |

### 需新增

| 文件 | 说明 |
|------|------|
| `src/components/query-builder/DiagramCanvas/DiagramCanvas.tsx` | 画布容器 |
| `src/components/query-builder/DiagramCanvas/TableCard.tsx` | 表卡片 |
| `src/components/query-builder/DiagramCanvas/JoinLine.tsx` | JOIN 连线 |
| `src/components/query-builder/DiagramCanvas/JoinLabel.tsx` | JOIN 标签 |
| `src/components/query-builder/DiagramCanvas/useCanvasInteraction.ts` | 画布交互 hook |
| `src/components/query-builder/CriteriaGrid/CriteriaGrid.tsx` | 条件网格 |
| `src/components/query-builder/CriteriaGrid/CriteriaRow.tsx` | 网格行 |
| `src/components/query-builder/CriteriaGrid/WhereEditor.tsx` | WHERE 编辑弹窗 |
| `src/components/query-builder/hooks/useAutoJoin.ts` | 自动 FK 检测 |

## 1. 阶段划分

### Phase 1: 基础层（3d）

**目标**：类型系统、状态模型、SQL 引擎扩展

#### 1.1 扩展类型定义 `types.ts`（0.5d）

```typescript
// 新增类型
export interface QbJoin {
  id: string;
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
  isManual: boolean;
}

export interface QbColumnSelection {
  table: string;
  column: string;
  alias?: string;
  aggregate?: QbAggregate;
  sort?: 'ASC' | 'DESC';
  groupBy?: boolean;
  where?: QbCondition;
}

export type QbJoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
```

#### 1.2 重构 Zustand Store（1.5d）

新增状态字段：
- `joins: QbJoin[]` — 已确认 JOIN
- `autoJoins: QbJoin[]` — 自动检测 FK 关系
- `tableAliases: Record<string, string>` — 表别名
- `tablePositions: Record<string, { x: number; y: number }>` — 画布中表位置
- `canvasOffset: { x: number; y: number }` — 画布偏移
- `zoom: number` — 缩放比例
- `limit: number | null` — LIMIT
- `offset: number | null` — OFFSET

新增 Actions：
- `addJoin` / `removeJoin` / `updateJoinType`
- `setTableAlias` / `updateTablePosition` / `setZoom` / `setCanvasOffset`
- `setLimit` / `setOffset`
- `updateColumnConfig` — 替代 `setColumnAlias` + `setColumnAggregate`

#### 1.3 扩展 SQL 生成器（1d）

```typescript
// 新增函数
export function generateJoinClause(joins: QbJoin[], aliases: Record<string, string>): string
export function generateLimitOffset(limit: number | null, offset: number | null): string

// 增强现有函数
export function generateWhereClause(group: QbConditionGroup, dialect: string): string
// 支持嵌套 AND/OR 条件组

export function generateSelectClause(columns: QbColumnSelection[], distinct: boolean): string
// 支持字段别名、聚合函数
```

### Phase 2: 画布组件（5d）

**目标**：表卡片、JOIN 连线、画布交互

#### 2.1 画布容器 `DiagramCanvas.tsx`（1.5d）

- SVG 画布，网格点阵背景
- 支持缩放（鼠标滚轮）和偏移（空格+拖拽）
- 渲染 TableCard 组件
- 渲染 JoinLine 组件
- 拖拽区域检测

```tsx
// 核心渲染
<svg width="100%" height="100%" onWheel={handleZoom} onMouseDown={handlePan}>
  {/* 网格背景 */}
  <defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="1" fill="var(--color-muted)" opacity="0.3" />
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#grid)" />

  {/* JOIN 连线 */}
  {joins.map(join => <JoinLine key={join.id} join={join} ... />)}

  {/* 表卡片 */}
  {selectedTables.map(table => <TableCard key={table} ... />)}
</svg>
```

#### 2.2 表卡片 `TableCard.tsx`（2d）

```tsx
// 表卡片结构
<div className="bg-surface-raised border border-edge rounded-lg shadow-lg min-w-[200px]"
     style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
  {/* 表头 */}
  <div className="px-3 py-2 border-b border-edge flex items-center justify-between">
    <span className="font-medium text-sm">{tableName}</span>
    <input value={alias} placeholder="Alias" className="w-16 text-xs bg-surface ..." />
  </div>

  {/* 列列表 */}
  <div className="px-2 py-1">
    {columns.map(col => (
      <label key={col.name} className="flex items-center gap-2 py-0.5 text-xs">
        <Checkbox checked={isSelected} onCheckedChange={onToggle} />
        <span>{col.name}</span>
        <span className="text-muted ml-auto">{col.type}</span>
        {col.isPrimaryKey && <Badge variant="amber">PK</Badge>}
        {col.isForeignKey && <Badge variant="blue">FK</Badge>}
      </label>
    ))}
  </div>

  {/* 拖拽手柄 */}
  <div className="px-3 py-1 border-t border-edge cursor-grab text-muted text-center text-xs">
    ⋮⋮
  </div>
</div>
```

#### 2.3 JOIN 连线 `JoinLine.tsx`（1.5d）

```tsx
// SVG 贝塞尔曲线连线
<svg className="absolute inset-0 pointer-events-none">
  <path d={bezierPath(from, to)}
        stroke={isAuto ? 'var(--color-muted)' : 'var(--color-accent)'}
        strokeWidth={2}
        strokeDasharray={isAuto ? '6,4' : 'none'}
        fill="none" />

  {/* JOIN 标签 */}
  <foreignObject x={midX} y={midY - 10} width="120" height="40">
    <JoinLabel join={join} onUpdateType={onUpdateType} onRemove={onRemove} />
  </foreignObject>
</svg>
```

#### 2.4 画布交互 hook（0.5d）

```typescript
function useCanvasInteraction() {
  return {
    zoom,           // 当前缩放
    canvasOffset,   // 画布偏移
    handleZoom,     // 滚轮缩放
    handlePan,      // 空格+拖拽平移
    screenToCanvas, // 屏幕坐标 → 画布坐标
  };
}
```

### Phase 3: Criteria Grid（2.5d）

**目标**：条件配置网格

#### 3.1 Criteria Grid `CriteriaGrid.tsx`（2.5d）

```tsx
// 网格容器
<div className="border-t border-edge overflow-auto">
  <table className="w-full text-sm">
    <thead>
      <tr className="bg-surface-raised text-muted text-xs">
        <th className="w-[30px]">☑</th>
        <th>Field</th>
        <th className="w-[100px]">Table</th>
        <th className="w-[100px]">Alias</th>
        <th className="w-[80px]">Sort</th>
        <th className="w-[100px]">Func</th>
        <th>Where</th>
        <th className="w-[50px]">Group</th>
        <th className="w-[30px]"></th>
      </tr>
    </thead>
    <tbody>
      {selectedColumns.map(col => (
        <CriteriaRow key={`${col.table}.${col.column}`}
                     selection={col}
                     allTables={selectedTables}
                     allColumns={columnMap}
                     onUpdate={(patch) => updateColumnConfig(col.table, col.column, patch)}
                     onRemove={() => removeColumn(col.table, col.column)} />
      ))}
    </tbody>
  </table>

  {/* 添加字段按钮 */}
  <button onClick={addEmptyRow} className="p-2 text-sm text-muted hover:text-foreground">
    + Add Column
  </button>
</div>
```

### Phase 4: 集成与 i18n（2d）

**目标**：面板集成、SQL 编辑器对接、国际化

#### 4.1 重构 QueryBuilderPanel（1d）

```tsx
export function QueryBuilderPanel({ dbSessionId, databaseType, onApplySql }: QueryBuilderPanelProps) {
  const state = useQueryBuilderStore();
  const columnMap = useSchemaStore(s => s.columnMap);
  const foreignKeys = useSchemaStore(s => s.foreignKeys);

  // 自动检测 FK
  const autoJoins = useAutoJoin(state.selectedTables, foreignKeys);

  return (
    <div className="flex flex-col h-full border-t border-edge bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-edge">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium">{t('query.visualBuilder.title')}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={state.distinct} onCheckedChange={state.setDistinct} />
            DISTINCT
          </label>
          <Button variant="ghost" size="sm" onClick={state.reset}>Reset</Button>
          <Button variant="ghost" size="sm" onClick={state.toggleOpen}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 画布 + 下方 Grid */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1">
          {/* 画布区域 (可调高度) */}
          <div className="flex-1 overflow-hidden" style={{ minHeight: 200 }}>
            <DiagramCanvas ... />
          </div>

          {/* 拖拽分割线 */}
          <ResizeHandle />

          {/* Criteria Grid */}
          <div style={{ height: 180 }}>
            <CriteriaGrid ... />
          </div>
        </div>
      </div>

      {/* 底部 SQL Preview */}
      <div className="border-t border-edge">
        <SqlPreview sql={previewSql} />
        <div className="flex justify-end p-2">
          <Button onClick={() => onApplySql(previewSql)}>Apply SQL ▶</Button>
        </div>
      </div>
    </div>
  );
}
```

#### 4.2 i18n（0.5d）

在 `src/locales/en/query.ts` 和 `src/locales/zh-CN/query.ts` 中添加新 key。

#### 4.3 QueryEditorSection 集成（0.5d）

确保面板展开时编辑器高度压缩，收起时恢复。

### Phase 5: 测试与文档（3d）

#### 5.1 单元测试（2d）

| 测试文件 | 测试内容 |
|---------|---------|
| `hooks/__tests__/useSqlGenerator.test.ts` | 增强：JOIN 生成、LIMIT/OFFSET、嵌套 WHERE |
| `hooks/__tests__/useAutoJoin.test.ts` | 新增：FK 检测、多表关联 |
| `__tests__/queryBuilderStore.test.ts` | 增强：JOIN actions、画布状态 |
| `__tests__/CriteriaGrid.test.tsx` | 新增：网格行增删改、排序切换 |

#### 5.2 E2E 测试（1d）

更新 `e2e/specs/journeys/visual-query-builder-journey.ts`：

```
1. 打开查询标签页
2. 点击 Visual Builder 按钮
3. 从左侧树拖入 users 表 → 画布出现卡片
4. 勾选 id、name 字段
5. 从左侧树拖入 orders 表
6. 自动检测 FK → 画布出现连线
7. 在 Criteria Grid 中为 amount 设置 WHERE > 100
8. 为 id 设置 Sort ASC
9. 点击 Apply SQL → 编辑器内容更新
10. 点击执行 → 结果正确
```

## 2. 技术决策

### 2.1 画布渲染方案

**选择：自定义 SVG + DOM 混合**

- 表卡片用 DOM（HTML/CSS），便于交互和排版
- JOIN 连线用 SVG `<path>`（贝塞尔曲线）
- 画布容器用 `div` + `transform` 实现缩放/平移

**备选方案评估**：
| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| `react-flow` | 开箱即用 | 依赖重，定制困难 | ❌ |
| Canvas 2D | 性能好 | 交互复杂，文本渲染差 | ❌ |
| SVG + DOM | 灵活，可访问性好 | 需自写交互 | ✅ |

### 2.2 拖拽方案

**选择：HTML5 Drag & Drop API**

- 对象树 → 画布：使用 `draggable` + `onDragStart/onDrop`
- 画布内表卡片移动：使用 `onPointerDown/Move/Up`（更流畅）

### 2.3 状态同步

- `queryBuilderStore` 是唯一数据源
- `useSqlGenerator` hook 从 store 读取状态，实时计算 SQL
- `DiagramCanvas` 和 `CriteriaGrid` 都从 store 读取和写入
- 无需额外同步机制

## 3. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 画布交互复杂度高 | 延期 | Phase 2 先实现基础拖拽，后续迭代优化 |
| SVG 连线计算性能 | 卡顿 | 仅在 `joins` 变化时重计算路径 |
| CriteriaGrid 单元格交互 | UX 不佳 | 参考 Navicat 的成熟交互模式 |
| 与现有 E2E 冲突 | 测试失败 | 新增 testid，不修改已有元素 |

## 4. 依赖

| 依赖 | 用途 | 是否必须 |
|------|------|---------|
| `@datazen/ui` | Button, Checkbox, Select, Badge, Input, Label, Collapsible | ✅ |
| `nanoid` | ID 生成 | ✅ |
| `tailwind-merge` / `cn()` | 类名合并 | ✅ |
| 无第三方画布/拖拽库 | — | — |

## 5. 里程碑验收标准

| 里程碑 | 验收标准 |
|--------|---------|
| **M1** | 类型定义编译通过；Store 单测全部通过（含 JOIN/画布 action） |
| **M2** | SQL 生成器单测通过：JOIN/LIMIT/嵌套 WHERE/方言差异 |
| **M3** | 画布可渲染表卡片；可拖拽移动；可绘制 JOIN 连线（贝塞尔曲线） |
| **M4** | 对象树可拖入表到画布；卡片内 Checkbox 勾选字段 |
| **M5** | CriteriaGrid 可配置字段/排序/聚合/条件；实时更新 store |
| **M6** | SQL Preview 实时更新；Apply 按钮正确插入编辑器 |
| **M7** | i18n 完整；E2E 通过；单测覆盖率 > 80% |

## 6. 文件变更清单

| 文件 | 变更类型 | Phase |
|------|---------|-------|
| `src/components/query-builder/types.ts` | 扩展 | P1 |
| `src/stores/queryBuilderStore.ts` | 重构 | P1 |
| `src/lib/sqlDialects/queryBuilder.ts` | 扩展 | P1 |
| `src/components/query-builder/hooks/useSqlGenerator.ts` | 重构 | P1 |
| `src/components/query-builder/DiagramCanvas/DiagramCanvas.tsx` | 新增 | P2 |
| `src/components/query-builder/DiagramCanvas/TableCard.tsx` | 新增 | P2 |
| `src/components/query-builder/DiagramCanvas/JoinLine.tsx` | 新增 | P2 |
| `src/components/query-builder/DiagramCanvas/JoinLabel.tsx` | 新增 | P2 |
| `src/components/query-builder/DiagramCanvas/useCanvasInteraction.ts` | 新增 | P2 |
| `src/components/query-builder/CriteriaGrid/CriteriaGrid.tsx` | 新增 | P3 |
| `src/components/query-builder/CriteriaGrid/CriteriaRow.tsx` | 新增 | P3 |
| `src/components/query-builder/CriteriaGrid/WhereEditor.tsx` | 新增 | P3 |
| `src/components/query-builder/hooks/useAutoJoin.ts` | 新增 | P3 |
| `src/components/query-builder/QueryBuilderPanel.tsx` | 重写 | P4 |
| `src/components/query-builder/SqlPreview.tsx` | 保留 | P4 |
| `src/locales/en/query.ts` | 修改 | P4 |
| `src/locales/zh-CN/query.ts` | 修改 | P4 |
| `e2e/specs/journeys/visual-query-builder-journey.ts` | 重写 | P5 |
| `src/components/query-builder/hooks/__tests__/useSqlGenerator.test.ts` | 扩展 | P5 |
| `src/components/query-builder/hooks/__tests__/useAutoJoin.test.ts` | 新增 | P5 |
| `src/stores/__tests__/queryBuilderStore.test.ts` | 扩展 | P5 |
| `src/components/query-builder/__tests__/CriteriaGrid.test.tsx` | 新增 | P5 |
