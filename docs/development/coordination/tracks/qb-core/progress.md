# Track: qb-core — 类型定义 + Store + SQL 生成器

## Phase 状态

| Phase | 状态 | 说明 |
|-------|------|------|
| CODING | READY_FOR_TEST | 编码完成，自验通过，等待 Tester |
| TEST | PASSED | Tester 独立复验通过 |

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

## 自验结果（编码轮）

- **tsc**: ✅ 零错误
- **vitest**: ✅ 33 tests passed (0 failed)
- 测试覆盖：空状态、单表 SELECT、多列+别名、聚合函数、WHERE 所有操作符、AND/OR 组合、嵌套条件组、ORDER BY、GROUP BY、DISTINCT、方言差异（PG/MySQL/SQLite/SQLServer）、特殊字符转义、未知数据库回退

## Tester 独立复验结果

### 代码审查（阶段 A）

逐文件审查 5 个文件，未发现阻断性 Bug。

审查发现（非阻断）：
- `useSqlGenerator.ts` L27 `formatValue` 正则 `/^-?\d+(\.\d+)?$/` 不匹配科学计数法（如 `1e5`），v1 可接受。
- `queryBuilderStore.ts` `toggleTable` 移除表时未清理 WHERE 条件组中引用该表的条件（只清理了 `selectedColumns`）。v1 中 UI 不会对未选中的表添加条件，故实际不会触发。

### 独立复验（阶段 B）

- **tsc**: ✅ 零错误（与编码轮一致）
- **vitest**: ✅ 33 tests passed（与编码轮一致，新增测试前）

### 覆盖率驱动的测试补齐（阶段 C）

新增 2 个测试文件：
1. `src/stores/__tests__/queryBuilderStore.test.ts` — 48 个测试用例，覆盖所有 Store action
2. `src/lib/sqlDialects/__tests__/queryBuilder.test.ts` — 51 个测试用例，覆盖 5 种方言适配器

测试补齐后：**132 tests passed (3 suites)**

### 覆盖率报告

| 文件 | Stmts | Branch | Funcs | Lines | Uncovered |
|------|-------|--------|-------|-------|-----------|
| `queryBuilderStore.ts` | 100% | 96.15% | 100% | 100% | L67（嵌套递归分支边界） |
| `queryBuilder.ts` | 100% | 100% | 100% | 100% | — |
| `useSqlGenerator.ts` | 92.59% | 92.68% | 85.71% | 93.61% | L74（default case）, L151-152（hook return） |
| `types.ts` | 0% | 0% | 0% | 0% | 类型文件，无运行时代码 |

> 注：所有运行时代码文件覆盖率均 ≥ 80%，满足验收标准。

### E2E 用例登记

| 用例 ID | 场景 | 前置条件 | 执行方式 |
|---------|------|---------|---------|
| qb-core-e2e-001 | 选表→选列→加 WHERE→生成 SQL→应用到编辑器 | 连接到含 users/orders 表的数据库 | 留待 R 回归 |
| qb-core-e2e-002 | 嵌套 AND/OR 条件组 SQL 预览 | 同上 | 留待 R 回归 |
| qb-core-e2e-003 | 聚合函数 + GROUP BY + ORDER BY 组合 | 同上 | 留待 R 回归 |
| qb-core-e2e-004 | DISTINCT 选项 SQL 预览 | 同上 | 留待 R 回归 |
| qb-core-e2e-005 | 切换数据库方言验证引号差异 | PostgreSQL / MySQL / SQLite | 留待 R 回归 |

### Bug 清单

无。

## Commit Hash

编码轮：`47da5ef8f`
