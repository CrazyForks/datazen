# Track: qb-core (Phase 1: Foundation)

## 目标
扩展类型系统、重构 Zustand Store、扩展 SQL 生成引擎，为画布和网格组件提供数据基础。

## Scope
- `src/components/query-builder/types.ts` — 扩展 QbJoin / QbColumnSelection / QbJoinType
- `src/stores/queryBuilderStore.ts` — 新增 joins / autoJoins / tableAliases / tablePositions / canvasOffset / zoom / limit / offset + Actions
- `src/lib/sqlDialects/queryBuilder.ts` — 新增 generateJoinClause / generateLimitOffset，增强 generateWhereClause 支持嵌套
- `src/components/query-builder/hooks/useSqlGenerator.ts` — 重构适配新 Store 结构

## 验收标准
1. ✅ TypeScript 编译通过（`npx tsc --noEmit`）
2. ✅ Store 单测全部通过：新增 JOIN / 画布 / LIMIT action 测试
3. ✅ SQL 生成器单测通过：JOIN / LIMIT / 嵌套 WHERE / 方言差异

## Status
- [x] CODING
- [x] READY_FOR_TEST
- [ ] TEST_DONE

## Commits

## Test Results
- **tsc**: ✅ 零错误
- **vitest**: ✅ 179 tests passed (3 suites)
  - queryBuilderStore.test.ts: 71 tests
  - queryBuilder.test.ts: 64 tests
  - useSqlGenerator.test.ts: 44 tests
