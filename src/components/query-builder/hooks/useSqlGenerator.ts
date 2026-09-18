import { useMemo } from 'react';
import {
  getQbDialectAdapter,
  generateJoinClause,
  generateLimitOffset,
} from '../../../lib/sqlDialects/queryBuilder';
import type {
  QbConditionGroup,
  QbCondition,
  QbSortItem,
  QbColumnSelection,
  QbGroupByItem,
  QbJoin,
} from '../types';

// ── Public types ──────────────────────────────────────────────

export interface GenerateSqlInput {
  selectedTables: string[];
  selectedColumns: QbColumnSelection[];
  joins: QbJoin[];
  tableAliases: Record<string, string>;
  where: QbConditionGroup;
  orderBy: QbSortItem[];
  groupBy: QbGroupByItem[];
  distinct: boolean;
  limit: number | null;
  offset: number | null;
  databaseType?: string;
}

// ── Value formatting helpers ──────────────────────────────────

/**
 * Format a raw value for inclusion in a SQL expression.
 * - `null` / empty → `NULL`
 * - Numeric literals → unquoted
 * - Everything else → single-quoted with escaped single quotes
 */
function formatValue(value: string | null): string {
  if (value === null || value === '') return 'NULL';
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

/** Parse a comma-separated IN-list value into individual SQL-escaped strings. */
function parseInValues(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => formatValue(v));
}

// ── Condition formatting ──────────────────────────────────────

function formatCondition(
  cond: QbCondition,
  q: (name: string) => string,
  adapter: ReturnType<typeof getQbDialectAdapter>,
): string {
  const col = `${q(cond.table)}.${q(cond.column)}`;

  switch (cond.operator) {
    case '=':
    case '!=':
    case '>':
    case '<':
    case '>=':
    case '<=':
      return `${col} ${cond.operator} ${formatValue(cond.value)}`;

    case 'LIKE':
      return `${col} LIKE ${formatValue(cond.value)}`;

    case 'NOT LIKE':
      return `${col} NOT LIKE ${formatValue(cond.value)}`;

    case 'IN':
      return adapter.formatInList(col, parseInValues(cond.value), false);

    case 'NOT IN':
      return adapter.formatInList(col, parseInValues(cond.value), true);

    case 'IS NULL':
      return adapter.formatNullComparison(col, true);

    case 'IS NOT NULL':
      return adapter.formatNullComparison(col, false);

    default:
      return `${col} = ${formatValue(cond.value)}`;
  }
}

// ── WHERE clause builder (recursive) ─────────────────────────

/** Build the inner expression of a condition group (without the leading ` WHERE `). */
function buildGroupExpr(
  group: QbConditionGroup,
  q: (name: string) => string,
  adapter: ReturnType<typeof getQbDialectAdapter>,
): string {
  const parts: string[] = [];

  for (const cond of group.conditions) {
    parts.push(formatCondition(cond, q, adapter));
  }

  for (const subGroup of group.groups) {
    const sub = buildGroupExpr(subGroup, q, adapter);
    if (sub) parts.push(`(${sub})`);
  }

  if (parts.length === 0) return '';
  return parts.join(` ${group.logic} `);
}

function buildWhereClause(
  group: QbConditionGroup,
  q: (name: string) => string,
  adapter: ReturnType<typeof getQbDialectAdapter>,
): string {
  const expr = buildGroupExpr(group, q, adapter);
  if (!expr) return '';
  return ` WHERE ${expr}`;
}

// ── Core SQL generator ────────────────────────────────────────

function generateSql(input: GenerateSqlInput): string {
  if (input.selectedTables.length === 0 || input.selectedColumns.length === 0) {
    return '';
  }

  const adapter = getQbDialectAdapter(input.databaseType);
  const q = (name: string) => adapter.quoteIdentifier(name);

  // 1. SELECT
  const selectItems = input.selectedColumns.map((col) => {
    const colPath = `${q(col.table)}.${q(col.column)}`;
    const expr = col.aggregate ? `${col.aggregate}(${colPath})` : colPath;
    return col.alias ? `${expr} AS ${q(col.alias)}` : expr;
  });
  const distinct = input.distinct ? 'DISTINCT ' : '';
  const selectClause = `SELECT ${distinct}${selectItems.join(', ')}`;

  // 2. FROM — use alias when available
  const firstTable = input.selectedTables[0];
  const firstAlias = input.tableAliases[firstTable];
  const fromTable = firstAlias ? `${q(firstTable)} ${q(firstAlias)}` : q(firstTable);
  const fromClause = ` FROM ${fromTable}`;

  // 3. JOIN
  const joinClause = generateJoinClause(input.joins, input.tableAliases, adapter);

  // 4. WHERE — merge per-column where conditions into the root where group
  const perColumnConditions = input.selectedColumns
    .filter((c) => c.where)
    .map((c, i) => ({
      ...c.where!,
      conjunction: (i === 0 ? 'AND' : c.where!.conjunction || 'AND') as 'AND' | 'OR',
    }));
  const effectiveWhere: QbConditionGroup = {
    ...input.where,
    conditions: [...input.where.conditions, ...perColumnConditions],
  };
  const whereClause = buildWhereClause(effectiveWhere, q, adapter);

  // 5. GROUP BY — merge store-level groupBy with per-column groupBy flags
  const perColumnGroupBy: QbGroupByItem[] = input.selectedColumns
    .filter((c) => c.groupBy)
    .map((c) => ({ table: c.table, column: c.column }));
  const effectiveGroupBy = [...input.groupBy, ...perColumnGroupBy];
  const groupByClause =
    effectiveGroupBy.length > 0
      ? ` GROUP BY ${effectiveGroupBy.map((g) => `${q(g.table)}.${q(g.column)}`).join(', ')}`
      : '';

  // 6. ORDER BY — merge store-level orderBy with per-column sort
  const perColumnSorts: QbSortItem[] = input.selectedColumns
    .filter((c) => c.sort)
    .map((c) => ({ table: c.table, column: c.column, direction: c.sort! }));
  const effectiveOrderBy = [...input.orderBy, ...perColumnSorts];
  const orderByClause =
    effectiveOrderBy.length > 0
      ? ` ORDER BY ${effectiveOrderBy.map((o) => `${q(o.table)}.${q(o.column)} ${o.direction}`).join(', ')}`
      : '';

  // 7. LIMIT / OFFSET
  const limitOffsetClause = generateLimitOffset(input.limit, input.offset, adapter);

  return `${selectClause}${fromClause}${joinClause}${whereClause}${groupByClause}${orderByClause}${limitOffsetClause};`;
}

// ── Public hook ───────────────────────────────────────────────

/**
 * React hook that memoises the generated SQL string from the current
 * query builder state. Returns an empty string when there are no
 * selected tables or columns.
 */
export function useSqlGenerator(input: GenerateSqlInput): string {
  return useMemo(
    () => generateSql(input),
    // Zustand state references are stable primitives / structured clones,
    // so we serialise the complex objects for the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      input.selectedTables,
      input.selectedColumns,
      input.joins,
      input.tableAliases,
      input.where,
      input.orderBy,
      input.groupBy,
      input.distinct,
      input.limit,
      input.offset,
      input.databaseType,
    ],
  );
}

// ── Pure-function export for testing without React ────────────

export { generateSql };
