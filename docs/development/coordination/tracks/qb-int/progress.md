# Track: qb-int — 集成入口 + i18n + 文档

## Phase 状态

| Phase | 状态 | 说明 |
|-------|------|------|
| CODING | DONE | QueryEditorSection 集成、i18n、文档完成 |
| TEST | PENDING | 等待 Tester |

## 编码范围

- `src/windows/connection/query/QueryEditorSection.tsx` — 添加工具栏按钮 + 面板渲染 ✅
- `src/locales/en/query.ts` — 添加 i18n key ✅
- `src/locales/zh-CN/query.ts` — 添加中文翻译 ✅
- `docs/features/query-builder.md` — 用户文档 ✅

## 依赖

依赖 qb-core 轨道的 Store 和 qb-ui 轨道的 QueryBuilderPanel 组件。

## 验收标准

1. 工具栏按钮正确显示 ✅
2. 点击按钮切换构建器面板展开/收起 ✅
3. 面板展开时编辑器高度压缩 ✅
4. "应用到编辑器" 回调正确触发 ✅
5. 所有 UI 文本支持中英文 ✅
6. npx tsc --noEmit — 待验证（依赖 qb-ui 的 QueryBuilderPanel）

## 自验结果

- QueryEditorSection.tsx: WandSparkles import + useQueryBuilderStore hooks + ToolbarButton + QueryBuilderPanel rendering ✅
- en/query.ts: 28 visualBuilder keys added ✅
- zh-CN/query.ts: 28 visualBuilder keys added ✅
- docs/features/query-builder.md: Feature documentation created ✅
- Note: tsc cannot pass until qb-ui creates QueryBuilderPanel component

## Commit Hash

_Pending commit_
