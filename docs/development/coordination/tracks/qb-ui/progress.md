# Track: qb-ui — 查询构建器 UI 组件

## Phase 状态

| Phase | 状态 | 说明 |
|-------|------|------|
| CODING | PENDING | 等待 Wave 1 (qb-core) 完成 |
| TEST | PENDING | 等待 Tester |

## 编码范围

- `src/components/query-builder/QueryBuilderPanel.tsx` — 主面板
- `src/components/query-builder/TableSelector.tsx` — 表/视图选择
- `src/components/query-builder/ColumnSelector.tsx` — 列选择（含聚合/别名）
- `src/components/query-builder/WhereClause.tsx` — WHERE 条件面板
- `src/components/query-builder/ConditionGroup.tsx` — 条件组（递归）
- `src/components/query-builder/ConditionRow.tsx` — 单个条件行
- `src/components/query-builder/SortClause.tsx` — ORDER BY
- `src/components/query-builder/GroupByClause.tsx` — GROUP BY
- `src/components/query-builder/SqlPreview.tsx` — SQL 预览

## 依赖

依赖 qb-core 轨道的类型定义和 Store（`queryBuilderStore`、`types.ts`、`useSqlGenerator`）。

## 验收标准

1. 所有组件正确渲染
2. 组件使用 `@datazen/ui` 基础组件
3. 表选择联动列选择
4. 条件组支持嵌套 AND/OR
5. SQL 预览实时更新
6. npx tsc --noEmit 通过
7. npx vitest run 通过

## 自验结果

_待填写_

## Commit Hash

_待填写_
