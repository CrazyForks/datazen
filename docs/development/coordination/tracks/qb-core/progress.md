# Track: qb-core — 类型定义 + Store + SQL 生成器

## Phase 状态

| Phase | 状态 | 说明 |
|-------|------|------|
| CODING | READY_FOR_TEST | 编码完成，自验通过，等待 Tester |
| TEST | PENDING | 等待 Tester |

## 编码范围

- `src/components/query-builder/types.ts` — 共享类型定义
- `src/stores/queryBuilderStore.ts` — Zustand store
- `src/lib/sqlDialects/queryBuilder.ts` — SQL 方言适配器
- `src/components/query-builder/hooks/useSqlGenerator.ts` — SQL 生成纯函数
- `src/components/query-builder/hooks/__tests__/useSqlGenerator.test.ts` — 单元测试（33 cases）

## 验收标准

1. ✅ 所有类型导出正确（QbCondition, QbConditionGroup, QbSortItem, QbColumnSelection, QbOperator, QbAggregate, QbGroupByItem）
2. ✅ Store action 覆盖：toggleTable, toggleColumn, setColumnAlias, setColumnAggregate, addCondition, updateCondition, removeCondition, addConditionGroup, addSort, removeSort, addGroupBy, removeGroupBy, setDistinct, toggleOpen, reset
3. ✅ SQL 生成器覆盖：单表/多表 SELECT, WHERE (=, !=, >, <, >=, <=, LIKE, NOT LIKE, IN, NOT IN, IS NULL, IS NOT NULL), AND/OR 组合, 嵌套条件组, ORDER BY, GROUP BY, 聚合 (COUNT/SUM/AVG), DISTINCT
4. ✅ 方言适配：PostgreSQL 双引号, MySQL 反引号, SQLite 双引号, SQL Server 方括号
5. ✅ `npx tsc --noEmit` 通过（零错误）
6. ✅ `npx vitest run src/components/query-builder/` 通过（33/33 passed）

## 自验结果

- **tsc**: ✅ 零错误
- **vitest**: ✅ 33 tests passed (0 failed)
- 测试覆盖：空状态、单表 SELECT、多列+别名、聚合函数、WHERE 所有操作符、AND/OR 组合、嵌套条件组、ORDER BY、GROUP BY、DISTINCT、方言差异（PG/MySQL/SQLite/SQLServer）、特殊字符转义、未知数据库回退

## Commit Hash

`47da5ef8f`
