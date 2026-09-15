# Track: qb-canvas (Phase 2: Canvas Components)

## 目标
实现画布容器、表卡片、JOIN 连线、画布交互，提供可视化查询构建器的核心交互界面。

## Scope
- `src/components/query-builder/DiagramCanvas/DiagramCanvas.tsx` — 画布容器（SVG + 拖拽/缩放）
- `src/components/query-builder/DiagramCanvas/TableCard.tsx` — 表卡片（列列表 + PK/FK 徽章）
- `src/components/query-builder/DiagramCanvas/JoinLine.tsx` — JOIN 连线（SVG 贝塞尔曲线）
- `src/components/query-builder/DiagramCanvas/JoinLabel.tsx` — JOIN 标签
- `src/components/query-builder/DiagramCanvas/useCanvasInteraction.ts` — 画布交互 hook

## 验收标准
1. TypeScript 编译通过（`npx tsc --noEmit`）
2. 画布可渲染表卡片，支持拖拽移动
3. JOIN 连线正确绘制（贝塞尔曲线）
4. 缩放/平移交互正常

## Status
- [x] CODING
- [x] READY_FOR_TEST
- [ ] TEST_DONE

## Commits
- `feat(qb-canvas): implement diagram canvas, table card, join line, and canvas interaction` — `02fcadd69`

## Test Results
- TypeScript compilation: ✅ `npx tsc --noEmit` — 0 errors

