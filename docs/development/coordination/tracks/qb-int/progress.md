# Track: qb-int — 集成入口 + i18n + 文档

## Phase 状态

| Phase | 状态 | 说明 |
|-------|------|------|
| CODING | DONE | QueryEditorSection 集成、QueryBuilderPanel 重写、i18n、文档完成 |
| TEST | READY_FOR_TEST | 等待 Tester 验收 |

## 编码范围

- `src/windows/connection/query/QueryEditorSection.tsx` — 添加工具栏按钮 + 面板渲染 ✅
- `src/components/query-builder/QueryBuilderPanel.tsx` — 重写为画布 + CriteriaGrid + SQL Preview 布局 ✅
- `src/locales/en/query.ts` — 添加 i18n key（含 v2 新增 key）✅
- `src/locales/zh-CN/query.ts` — 添加中文翻译（含 v2 新增 key）✅
- `docs/features/query-builder.md` — 用户文档 ✅

### 已删除旧组件

- `src/components/query-builder/ColumnSelector.tsx` — 被 DiagramCanvas 表卡片替代 ✅
- `src/components/query-builder/SortClause.tsx` — 被 CriteriaGrid 替代 ✅
- `src/components/query-builder/GroupByClause.tsx` — 被 CriteriaGrid 替代 ✅
- `src/components/query-builder/ConditionRow.tsx` — 被 CriteriaRow 替代 ✅
- `src/components/query-builder/ConditionGroup.tsx` — 迁移到 CriteriaGrid ✅
- `src/components/query-builder/WhereClause.tsx` — 迁移到 CriteriaGrid WhereEditor ✅

## 依赖

依赖 qb-core 轨道的 Store 和 qb-ui 轨道的子组件（DiagramCanvas, CriteriaGrid）。

## 验收标准

1. 工具栏按钮正确显示 ✅
2. 点击按钮切换构建器面板展开/收起 ✅
3. 面板展开时编辑器高度压缩 ✅
4. "应用到编辑器" 回调正确触发 ✅
5. 所有 UI 文本支持中英文 ✅
6. npx tsc --noEmit — ✅ 通过
7. QueryBuilderPanel 正确渲染三区域布局 ✅
8. 所有子组件 Props 正确传递 ✅
9. 旧组件安全删除（无残留引用）✅
10. 现有单测通过（179 tests passed）✅

## 自验结果

- QueryEditorSection.tsx: WandSparkles import + useQueryBuilderStore hooks + ToolbarButton + QueryBuilderPanel rendering ✅
- QueryBuilderPanel.tsx: 重写为画布布局，整合 DiagramCanvas + CriteriaGrid + SqlPreview ✅
- en/query.ts: 28+ visualBuilder keys + v2 新增 key（qb/join/criteria/canvas）✅
- zh-CN/query.ts: 对应中文翻译 ✅
- docs/features/query-builder.md: Feature documentation created ✅
- npx tsc --noEmit: 0 errors ✅
- npx vitest run: 179 tests passed (3 test files) ✅
- Deleted 7 old component files, verified no remaining imports ✅

## Commit Hash

_Pending commit_
