# Track: qb-ui — UI 组件

## Phase 状态

| Phase | 状态 | 说明 |
|-------|------|------|
| CODING | READY_FOR_TEST | 9 个组件创建完成，类型检查通过 |
| TEST | PENDING | 待集成后测试 |

## 编码范围

- `QueryBuilderPanel.tsx` — 主面板容器 ✅
- `TableSelector.tsx` — 表选择器 ✅
- `ColumnSelector.tsx` — 列选择器 ✅
- `WhereClause.tsx` — WHERE 子句 ✅
- `ConditionGroup.tsx` — 条件组（递归） ✅
- `ConditionRow.tsx` — 单行条件 ✅
- `SortClause.tsx` — ORDER BY ✅
- `GroupByClause.tsx` — GROUP BY ✅
- `SqlPreview.tsx` — SQL 预览 ✅

## 自验结果

- tsc --noEmit: ✅ EXIT 0 — 零错误
- vitest: ✅ 33/33 通过（useSqlGenerator.test.ts）
- 所有组件使用 @datazen/ui 组件（Button, Select, Input）、i18n keys、Tailwind CSS

## i18n

- `src/locales/en/query.ts` — 新增 39 个 `query.visualBuilder.*` 键
- `src/locales/zh-CN/query.ts` — 对应中文翻译

## Commit Hash

- `47f7bc2a3` — feat(query-builder): add UI components
- _(待提交: i18n 键 + 组件重写使用 @datazen/ui)_
