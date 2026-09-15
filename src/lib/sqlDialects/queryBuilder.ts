/**
 * SQL dialect adapter for the Visual Query Builder.
 *
 * Encapsulates per-database differences in identifier quoting, ILIKE support,
 * LIMIT/OFFSET formatting, NULL comparison syntax, and IN-list generation.
 */

import { DB_REGISTRY } from '../databaseTypes';
import type { DatabaseType } from '../../types';

// ── Adapter interface ─────────────────────────────────────────

export interface QbDialectAdapter {
  /** Wrap an identifier (table/column/alias) in the dialect-specific quote characters. */
  quoteIdentifier(name: string): string;
  /** Whether this dialect supports ILIKE for case-insensitive LIKE. */
  supportsILike: boolean;
  /**
   * Format a LIMIT / OFFSET clause.
   * Returns `null` when the dialect cannot express this with LIMIT/OFFSET (e.g. SQL Server TOP).
   */
  formatLimitOffset(limit: number, offset: number): string | null;
  /** Format an `IS [NOT] NULL` comparison. */
  formatNullComparison(quotedColumn: string, isNull: boolean): string;
  /** Format an `[NOT] IN (val1, val2, …)` clause. Values are already SQL-escaped. */
  formatInList(quotedColumn: string, values: string[], negated: boolean): string;
}

// ── Per-dialect implementations ───────────────────────────────

const postgresqlAdapter: QbDialectAdapter = {
  quoteIdentifier: (n) => `"${n}"`,
  supportsILike: true,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${l} OFFSET ${o}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const mysqlAdapter: QbDialectAdapter = {
  quoteIdentifier: (n) => `\`${n}\``,
  supportsILike: false,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${o}, ${l}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const sqliteAdapter: QbDialectAdapter = {
  quoteIdentifier: (n) => `"${n}"`,
  supportsILike: false,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${l} OFFSET ${o}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const sqlserverAdapter: QbDialectAdapter = {
  quoteIdentifier: (n) => `[${n}]`,
  supportsILike: false,
  formatLimitOffset: () => null, // SQL Server uses TOP / OFFSET-FETCH; v1 does not handle this.
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const genericAdapter: QbDialectAdapter = {
  quoteIdentifier: (n) => `"${n}"`,
  supportsILike: false,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${l} OFFSET ${o}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

// ── Factory ───────────────────────────────────────────────────

const DIALECT_FAMILY_MAP: Record<string, QbDialectAdapter> = {
  postgresql: postgresqlAdapter,
  mysql: mysqlAdapter,
  sqlite: sqliteAdapter,
  sqlserver: sqlserverAdapter,
};

/**
 * Resolve the appropriate {@link QbDialectAdapter} for a given database type string.
 *
 * Falls back to the `generic` adapter when the type is unknown or the registry
 * entry does not specify a dialect family.
 */
export function getQbDialectAdapter(dbType?: string): QbDialectAdapter {
  if (!dbType) return genericAdapter;

  const meta = DB_REGISTRY[dbType as DatabaseType];
  const family = meta?.sqlDialect ?? (dbType as string);
  return DIALECT_FAMILY_MAP[family] ?? genericAdapter;
}
