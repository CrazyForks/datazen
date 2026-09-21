# Implementation: 可视化查询构建器（Visual Query Builder）

> 前置文档：[PRD.md](./PRD.md) · [DESIGN.md](./DESIGN.md)

## 0. 实施前提

- 遵循 [AGENTS.md](../../AGENTS.md) 所有约定
- 遵循 [docs/development/interaction-and-testing-principles.md](../../docs/development/interaction-and-testing-principles.md) 的状态机思维与连续旅程测试规范
- 单文件不超过 800 行，超大文件必须拆分
- 禁止裸 `unwrap()` / `expect()`（`#[cfg(test)]` 除外）
- 所有 UI 文本走 i18n
- 前端组件全部使用 `@datazen/ui` 基础组件

## Phase 1: 类型定义 + Store（2d）

### 1.1 创建类型定义

**文件**: `src/components/query-builder/types.ts`

```typescript
/** 构建器操作符 */
export type QbOperator =
  | '=' | '!=' | '>' | '<' | '>=' | '<='
  | 'LIKE' | 'NOT LIKE'
  | 'IN' | 'NOT IN'
  | 'IS NULL' | 'IS NOT NULL';

/** 聚合函数 */
export type QbAggregate = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';

/** 单个条件 */
export interface QbCondition {
  id: string;
  table: string;
  column: string;
  operator: QbOperator;
  value: string | null;
  conjunction: 'AND' | 'OR';
}

/** 条件组 */
export interface QbConditionGroup {
  id: string;
  logic: 'AND' | 'OR';
  conditions: QbCondition[];
  groups: QbConditionGroup[];
}

/** 排序项 */
export interface QbSortItem {
  table: string;
  column: string;
  direction: 'ASC' | 'DESC';
}

/** 列选择项 */
export interface QbColumnSelection {
  table: string;
  column: string;
  alias?: string;
  aggregate?: QbAggregate;
}
```

### 1.2 创建 Zustand Store

**文件**: `src/stores/queryBuilderStore.ts`

- 采用 `create` from `zustand`
- 初始状态：空选中，`isOpen: false`
- `reset()` 清除所有选择状态（切换连接/数据库时调用）
- 所有 mutator action 遵循 Zustand immutable 更新模式
- 条件组操作：`addCondition` / `updateCondition` / `removeCondition` / `addConditionGroup`
- SQL 预览通过 `subscribe` + `useSqlGenerator` 实时更新 `previewSql`

### 1.3 验证点

- [ ] `pnpm build` 通过（TypeScript 无错误）
- [ ] Store 单测覆盖所有 action 路径

---

## Phase 2: SQL 生成器（3d）

### 2.1 方言适配器

**文件**: `src/lib/sqlDialects/queryBuilder.ts`

```typescript
import { DB_REGISTRY } from '../databaseTypes';
import type { DatabaseType } from '../../types';

interface DialectAdapter {
  quoteIdentifier(name: string): string;
  supportsILike: boolean;
  formatLimitOffset(limit: number, offset: number): string | null;
  formatNullComparison(column: string, isNull: boolean): string;
  formatInList(column: string, values: string[], negated: boolean): string;
}

function getDialectAdapter(dbType?: string): DialectAdapter {
  const dialect = dbType ? DB_REGISTRY[dbType as DatabaseType]?.sqlDialect : undefined;
  switch (dialect) {
    case 'postgresql':
      return {
        quoteIdentifier: (n) => `"${n}"`,
        supportsILike: true,
        formatLimitOffset: (l, o) => o > 0 ? `LIMIT ${l} OFFSET ${o}` : `LIMIT ${l}`,
        formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
        formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.map(i => `'${i}'`).join(', ')})`,
      };
    case 'mysql':
      return {
        quoteIdentifier: (n) => `\`${n}\``,
        supportsILike: false,
        formatLimitOffset: (l, o) => o > 0 ? `LIMIT ${o}, ${l}` : `LIMIT ${l}`,
        formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
        formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.map(i => `'${i}'`).join(', ')})`,
      };
    case 'sqlite':
      return {
        quoteIdentifier: (n) => `"${n}"`,
        supportsILike: false,
        formatLimitOffset: (l, o) => o > 0 ? `LIMIT ${l} OFFSET ${o}` : `LIMIT ${l}`,
        formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
        formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.map(i => `'${i}'`).join(', ')})`,
      };
    default:
      // SQL Server / 其他
      return {
        quoteIdentifier: (n) => `[${n}]`,
        supportsILike: false,
        formatLimitOffset: () => null, // SQL Server 用 TOP，v1 不处理
        formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
        formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.map(i => `'${i}'`).join(', ')})`,
      };
  }
}
```

### 2.2 SQL 生成核心

**文件**: `src/components/query-builder/hooks/useSqlGenerator.ts`

```typescript
import { useMemo } from 'react';
import { getDialectAdapter } from '../../../lib/sqlDialects/queryBuilder';
import type { QbConditionGroup, QbCondition, QbSortItem, QbColumnSelection, QbOperator } from '../types';

interface GenerateSqlInput {
  selectedTables: string[];
  selectedColumns: QbColumnSelection[];
  where: QbConditionGroup;
  orderBy: QbSortItem[];
  groupBy: Array<{ table: string; column: string }>;
  distinct: boolean;
  databaseType?: string;
}

export function useSqlGenerator(input: GenerateSqlInput): string {
  return useMemo(() => generateSql(input), [
    input.selectedTables,
    input.selectedColumns,
    input.where,
    input.orderBy,
    input.groupBy,
    input.distinct,
    input.databaseType,
  ]);
}

function generateSql(input: GenerateSqlInput): string {
  if (input.selectedTables.length === 0 || input.selectedColumns.length === 0) {
    return '';
  }

  const dialect = getDialectAdapter(input.databaseType);
  const q = (name: string) => dialect.quoteIdentifier(name);

  // 1. SELECT
  const selectItems = input.selectedColumns.map(col => {
    const colPath = `${q(col.table)}.${q(col.column)}`;
    const expr = col.aggregate ? `${col.aggregate}(${colPath})` : colPath;
    return col.alias ? `${expr} AS ${q(col.alias)}` : expr;
  });
  const distinct = input.distinct ? 'DISTINCT ' : '';
  const selectClause = `SELECT ${distinct}${selectItems.join(', ')}`;

  // 2. FROM
  const fromClause = ` FROM ${q(input.selectedTables[0])}`;

  // 3. WHERE
  const whereClause = buildWhereClause(input.where, dialect);

  // 4. GROUP BY
  const groupByClause = input.groupBy.length > 0
    ? ` GROUP BY ${input.groupBy.map(g => `${q(g.table)}.${q(g.column)}`).join(', ')}`
    : '';

  // 5. ORDER BY
  const orderByClause = input.orderBy.length > 0
    ? ` ORDER BY ${input.orderBy.map(o => `${q(o.table)}.${q(o.column)} ${o.direction}`).join(', ')}`
    : '';

  return `${selectClause}${fromClause}${whereClause}${groupByClause}${orderByClause};`;
}

function buildWhereClause(group: QbConditionGroup, dialect: ReturnType<typeof getDialectAdapter>): string {
  const parts: string[] = [];

  for (const cond of group.conditions) {
    parts.push(formatCondition(cond, dialect));
  }

  for (const subGroup of group.groups) {
    const sub = buildWhereClause(subGroup, dialect);
    if (sub) parts.push(`(${sub})`);
  }

  if (parts.length === 0) return '';
  return ` WHERE ${parts.join(` ${group.logic} `)}`;
}

function formatCondition(cond: QbCondition, dialect: ReturnType<typeof getDialectAdapter>): string {
  const col = `${dialect.quoteIdentifier(cond.table)}.${dialect.quoteIdentifier(cond.column)}`;

  switch (cond.operator) {
    case '=':
    case '!=':
    case '>':
    case '<':
    case '>=':
    case '<=':
      return `${col} ${cond.operator} ${formatValue(cond.value, cond.column)}`;
    case 'LIKE':
    case 'NOT LIKE':
      return `${col} ${cond.operator} ${formatValue(cond.value, cond.column)}`;
    case 'IN':
    case 'NOT IN':
      return dialect.formatInList(col, parseInValues(cond.value), cond.operator === 'NOT IN');
    case 'IS NULL':
    case 'IS NOT NULL':
      return dialect.formatNullComparison(col, cond.operator === 'IS NULL');
    default:
      return `${col} = ${formatValue(cond.value, cond.column)}`;
  }
}

function formatValue(value: string | null, columnHint?: string): string {
  if (value === null || value === '') return 'NULL';
  // 简单的类型推断：数字不加引号
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  // 转义单引号
  return `'${value.replace(/'/g, "''")}'`;
}

function parseInValues(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map(v => v.trim()).filter(Boolean);
}
```

### 2.3 单元测试

**文件**: `src/components/query-builder/hooks/__tests__/useSqlGenerator.test.ts`

覆盖场景：
- 单表无条件 SELECT
- 多列选择 + 别名
- 聚合函数 (COUNT, SUM, AVG)
- WHERE 单条件 (=, !=, >, <, LIKE, IN, IS NULL)
- WHERE AND/OR 组合
- 嵌套条件组
- ORDER BY 多列
- GROUP BY + 聚合
- DISTINCT
- 方言差异（PostgreSQL 引号、MySQL 引号、LIMIT 语法）
- 空状态返回空字符串
- 特殊字符转义（单引号）

---

## Phase 3: 表/列选择 UI（3d）

### 3.1 TableSelector

**文件**: `src/components/query-builder/TableSelector.tsx`

```tsx
// 使用 @datazen/ui 的 Checkbox 和 Badge
// 水平布局，可换行
// 每个表显示：Checkbox + 表名 + 行数 Badge（如果有）
// 支持"全选/全不选"快捷操作
```

**关键交互**：
- 点击 Checkbox → `queryBuilderStore.toggleTable(name)`
- 选中表时自动加载其列信息（通过 `schemaStore.columnMap`）
- 取消选中表时，同步移除该表的所有列选择和条件

### 3.2 ColumnSelector

**文件**: `src/components/query-builder/ColumnSelector.tsx`

```tsx
// 表格布局：Table | Column Checkbox | Aggregate Select | Alias Input
// 仅显示已选中表的列
// 列信息来自 schemaStore.columnMap
```

**关键交互**：
- Checkbox 勾选列 → `queryBuilderStore.toggleColumn(table, column)`
- Aggregate 下拉选择聚合函数 → `queryBuilderStore.setColumnAggregate(...)`
- Alias 输入框 → `queryBuilderStore.setColumnAlias(...)`
- 当选中聚合函数但无 GROUP BY 时，显示提示

### 3.3 集成到 QueryEditorSection

**修改文件**: `src/windows/connection/query/QueryEditorSection.tsx`

```tsx
// 1. 导入 QueryBuilderPanel 和 store
import { QueryBuilderPanel } from '../../../components/query-builder/QueryBuilderPanel';
import { useQueryBuilderStore } from '../../../stores/queryBuilderStore';

// 2. 在 QueryEditorSection 内部添加状态
const qbVisible = useQueryBuilderStore(s => s.isOpen);
const toggleQb = useQueryBuilderStore(s => s.toggleOpen);

// 3. 添加工具栏按钮（在 ExecutionStrategySelect 之后）
<ToolbarButton
  compact={compactToolbar}
  variant={qbVisible ? 'secondary' : 'ghost'}
  label={t('query.visualBuilder')}
  icon={<LayoutGrid className="h-3.5 w-3.5" />}
  onClick={toggleQb}
  data-testid="query-visual-builder-toggle"
/>

// 4. 在 SqlEditor 上方条件渲染 QueryBuilderPanel
{qbVisible && (
  <QueryBuilderPanel
    dbSessionId={dbSessionId}
    database={selectedDatabase}
    databaseType={databaseType}
    onApplySql={(sql) => {
      onUpdateSql(sql);
      toggleQb();
      editorRef.current?.focus?.();
    }}
  />
)}
```

---

## Phase 4: 条件/排序/分组 UI（4d）

### 4.1 WhereClause + ConditionGroup + ConditionRow

**文件**:
- `src/components/query-builder/WhereClause.tsx`
- `src/components/query-builder/ConditionGroup.tsx`
- `src/components/query-builder/ConditionRow.tsx`

**ConditionRow 设计**：

```tsx
// 每行条件：[Conjunction] [Table Select] [Column Select] [Operator Select] [Value Input] [Delete]
// conjunction 仅在非首行显示
// Table/Column Select 根据已选表动态更新选项
// Value Input 在 IS NULL/IS NOT NULL 时禁用
// IN/NOT IN 时显示多值输入提示
```

**ConditionGroup 设计**：

```tsx
// 递归组件，渲染 conditions + groups
// 每个 Group 有独立的 AND/OR 逻辑切换
// 支持嵌套一层（v1 限制）
// 底部有 "+ Add Condition" 和 "+ Add Group" 按钮
```

### 4.2 SortClause

**文件**: `src/components/query-builder/SortClause.tsx`

```tsx
// 每行：[Table Select] [Column Select] [Direction Select (ASC/DESC)] [Delete]
// [+ Add Sort] 按钮
// 可拖拽排序（v1.1，v1 仅支持添加/删除）
```

### 4.3 GroupByClause

**文件**: `src/components/query-builder/GroupByClause.tsx`

```tsx
// 每行：[Table Select] [Column Select] [Delete]
// [+ Add Group By] 按钮
// 选中聚合函数的列必须出现在 GROUP BY 中（智能提示，不强制）
```

### 4.4 SQL 预览

**文件**: `src/components/query-builder/SqlPreview.tsx`

```tsx
// 只读 CodeMirror 实例，语言为 SQL
// 实时更新，使用 SqlEditor 的只读模式
// 或简化为 <pre> + 语法高亮（使用 Prism/highlight.js）
// v1 使用 <pre> + monospace 字体简化实现
```

---

## Phase 5: SQL 预览 + 编辑器集成（2d）

### 5.1 实时预览联动

`QueryBuilderPanel` 内部通过 `subscribe` 监听 store 变化，触发 `useSqlGenerator` 重新计算：

```typescript
// QueryBuilderPanel.tsx
const {
  selectedTables, selectedColumns, where, orderBy, groupBy, distinct
} = useQueryBuilderStore();

const previewSql = useSqlGenerator({
  selectedTables,
  selectedColumns,
  where,
  orderBy,
  groupBy,
  distinct,
  databaseType,
});
```

### 5.2 "Apply to Editor" 按钮

```tsx
<Button
  onClick={() => onApplySql(previewSql)}
  disabled={!previewSql.trim()}
  data-testid="qb-apply-to-editor"
>
  {t('query.qbApplyToEditor')}
</Button>
```

### 5.3 编辑器内容同步

```typescript
// QueryEditorSection.tsx
const handleApplyToEditor = useCallback((sql: string) => {
  onUpdateSql(sql);
  queryBuilderStore.getState().toggleOpen();
  // 延迟聚焦确保面板收起动画完成后焦点回到编辑器
  setTimeout(() => editorRef.current?.focus?.(), 200);
}, [onUpdateSql, editorRef]);
```

---

## Phase 6: i18n + 测试 + 文档（2d）

### 6.1 国际化

- 修改 `src/locales/en.ts`：添加 `query.visualBuilder` 等所有 key（见 DESIGN.md §7）
- 修改 `src/locales/zh-CN.ts`：添加对应中文翻译
- 运行 `node scripts/i18n-sync-check.mjs` 确认无遗漏

### 6.2 单元测试

```bash
# 运行所有构建器相关测试
npx vitest run --grep "query-builder"
```

### 6.3 E2E 测试

**文件**: `e2e/specs/query-builder.spec.ts`

```typescript
// 测试场景：
// 1. 点击工具栏按钮打开构建器
// 2. 选择一个表，验证列列表更新
// 3. 勾选列，验证 SQL 预览更新
// 4. 添加 WHERE 条件，验证 SQL 预览
// 5. 点击"应用到编辑器"，验证编辑器内容
// 6. 执行 SQL，验证结果正确
// 7. 点击按钮收起构建器
```

### 6.4 用户文档

**文件**: `docs/features/query-builder.md`

内容：
- 功能介绍与使用场景
- 快速入门指南（图文）
- 操作说明（表选择、列配置、条件构建、排序分组）
- SQL 预览说明
- 支持的操作符列表
- 方言差异说明
- 常见问题

---

## 依赖关系图

```
Phase 1 (类型+Store) ──→ Phase 2 (SQL生成器)
         │                     │
         ↓                     ↓
Phase 3 (表/列选择UI) ←──── Phase 4 (条件/排序UI)
         │                     │
         ↓                     ↓
Phase 5 (预览+集成) ←──── Phase 4
         │
         ↓
Phase 6 (i18n+测试+文档)
```

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 复杂嵌套条件的 SQL 生成正确性 | 高 | 充分的单测覆盖，特别是边界情况 |
| 多方言 SQL 语法差异 | 中 | 方言适配器隔离差异，逐方言测试 |
| 构建器面板占用编辑器空间 | 中 | 可拖拽分割，最小高度保护 |
| 大表（>100 列）的列选择性能 | 低 | 虚拟滚动，延迟加载列信息 |
| 与 Pro EP 的潜在冲突 | 低 | 构建器位于 Community 基础层，不涉及 EP 插槽 |

## 验收检查清单

- [ ] 选表 → 选列 → 加条件 → 生成 SQL → 执行 → 结果正确
- [ ] PostgreSQL / MySQL / SQLite 三种方言 SQL 生成正确
- [ ] 嵌套 AND/OR 条件生成正确括号
- [ ] 聚合函数 + GROUP BY 组合正确
- [ ] DISTINCT 选项生效
- [ ] 空状态显示友好提示
- [ ] 暗色主题样式一致
- [ ] 中英文切换正常
- [ ] 窗口缩小时布局自适应
- [ ] 构建器收起后编辑器高度恢复
- [ ] 所有单元测试通过
- [ ] E2E 核心路径通过
