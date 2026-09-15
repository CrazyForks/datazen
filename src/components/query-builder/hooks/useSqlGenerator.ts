import { useMemo } from 'react';
import { getQbDialectAdapter } from '../../../lib/sqlDialects/queryBuilder';
import type { QbConditionGroup, QbCondition, QbSortItem, QbColumnSelection, QbGroupByItem } from '../types';

// ── Public types ──────────────────────────────────────────────

export interface GenerateSqlInput {
  selectedTables: string[];
  selectedColumns: QbColumnSelection[];
  where: QbConditionGroup;
  orderBy: QbSortItem[];
  groupBy: QbGroupByItem[];
  distinct: boolean;
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

function formatCondition(cond: QbCondition, q: (name: string) => string, adapter: ReturnType<typeof getQbDialectAdapter>): string {
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
function buildGroupExpr(group: QbConditionGroup, q: (name: string) => string, adapter: ReturnType<typeof getQbDialectAdapter>): string {
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

function buildWhereClause(group: QbConditionGroup, q: (name: string) => string, adapter: ReturnType<typeof getQbDialectAdapter>): string {
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

  // 2. FROM
  const fromClause = ` FROM ${q(input.selectedTables[0])}`;

  // 3. WHERE
  const whereClause = buildWhereClause(input.where, q, adapter);

  // 4. GROUP BY
  const groupByClause =
    input.groupBy.length > 0
      ? ` GROUP BY ${input.groupBy.map((g) => `${q(g.table)}.${q(g.column)}`).join(', ')}`
      : '';

  // 5. ORDER BY
  const orderByClause =
    input.orderBy.length > 0
      ? ` ORDER BY ${input.orderBy.map((o) => `${q(o.table)}.${q(o.column)} ${o.direction}`).join(', ')}`
      : '';

  return `${selectClause}${fromClause}${whereClause}${groupByClause}${orderByClause};`;
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
      input.where,
      input.orderBy,
      input.groupBy,
      input.distinct,
      input.databaseType,
    ],
  );
}

// ── Pure-function export for testing without React ────────────

export { generateSql };
