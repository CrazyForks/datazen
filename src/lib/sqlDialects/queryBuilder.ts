/**
 * SQL dialect adapter for the Visual Query Builder.
 *
 * Encapsulates per-database differences in identifier quoting, ILIKE support,
 * LIMIT/OFFSET formatting, NULL comparison syntax, and IN-list generation.
 */

import { DB_REGISTRY } from '../databaseTypes';
import type { DatabaseType } from '../../types';
import type { QbJoin } from '../../components/query-builder/types';

// ── Adapter interface ─────────────────────────────────────────

export interface QbDialectAdapter {
  /** Wrap an identifier (table/column/alias) in the dialect-specific quote characters. */
  quoteIdentifier(name: string): string;
  /** Whether this dialect supports ILIKE for case-insensitive LIKE. */
  supportsILike: boolean;
  /**
   * Whether this dialect family can be given a `LIMIT`/`OFFSET` row window at
   * all. Drivers may additionally opt out through
   * {@link DatabaseTypeMeta.supportsOffset}; the generator honours both.
   */
  supportsLimitOffset: boolean;
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
  supportsLimitOffset: true,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${l} OFFSET ${o}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const mysqlAdapter: QbDialectAdapter = {
  quoteIdentifier: (n) => `\`${n}\``,
  supportsILike: false,
  supportsLimitOffset: true,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${o}, ${l}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const sqliteAdapter: QbDialectAdapter = {
  quoteIdentifier: (n) => `"${n}"`,
  supportsILike: false,
  supportsLimitOffset: true,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${l} OFFSET ${o}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const sqlserverAdapter: QbDialectAdapter = {
  quoteIdentifier: (n) => `[${n}]`,
  supportsILike: false,
  supportsLimitOffset: false,
  formatLimitOffset: () => null, // T-SQL uses OFFSET…FETCH and needs ORDER BY; v1 does not emit it.
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const genericAdapter: QbDialectAdapter = {
  quoteIdentifier: (n) => `"${n}"`,
  supportsILike: false,
  supportsLimitOffset: true,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${l} OFFSET ${o}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

// ── JOIN clause generation ────────────────────────────────────

/**
 * Generate SQL JOIN clauses from a list of QbJoin entries.
 *
 * @param joins - The JOIN relationships to generate.
 * @param aliases - Table alias mapping (tableName → alias). Used for ON clause column references.
 * @param adapter - Dialect adapter for identifier quoting.
 * @returns The formatted JOIN clause string (including leading newline), or empty string when no joins.
 */
export function generateJoinClause(
  joins: QbJoin[],
  aliases: Record<string, string>,
  adapter: QbDialectAdapter,
): string {
  if (joins.length === 0) return '';

  const q = (name: string) => adapter.quoteIdentifier(name);

  return (
    '\n' +
    joins
      .map((join) => {
        const leftTableRef = aliases[join.leftTable]
          ? q(aliases[join.leftTable])
          : q(join.leftTable);
        const rightTableRef = q(join.rightTable);
        const leftCol = `${leftTableRef}.${q(join.leftColumn)}`;
        const rightCol = `${rightTableRef}.${q(join.rightColumn)}`;
        return `${join.type} JOIN ${rightTableRef} ON ${leftCol} = ${rightCol}`;
      })
      .join('\n')
  );
}

// ── LIMIT / OFFSET clause generation ──────────────────────────

/**
 * Generate SQL LIMIT / OFFSET clause.
 *
 * @param limit - LIMIT value (null = no limit).
 * @param offset - OFFSET value (null = no offset).
 * @param adapter - Dialect adapter for dialect-specific formatting.
 * @returns The formatted clause string (including leading space), or empty string when neither is set.
 */
export function generateLimitOffset(
  limit: number | null,
  offset: number | null,
  adapter: QbDialectAdapter,
): string {
  if (limit === null && offset === null) return '';
  // A driver that declares `supportsOffset: false` must never receive a clause,
  // even if the UI could not have set one.
  if (!adapter.supportsLimitOffset) return '';
  // Use adapter for dialect-specific formatting. Fallback: standard SQL.
  const effectiveLimit = limit ?? 0;
  const effectiveOffset = offset ?? 0;
  // Only call adapter when both are non-null to avoid confusing defaults.
  const result = adapter.formatLimitOffset(effectiveLimit, effectiveOffset);
  return result !== null ? ` ${result}` : '';
}

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
  const base = DIALECT_FAMILY_MAP[family] ?? genericAdapter;
  // The driver's own declaration is authoritative: a driver may opt out even
  // when its dialect family has a LIMIT/OFFSET spelling. Overriding here keeps
  // the row-window controls and the generated SQL in agreement.
  return meta?.supportsOffset === false ? { ...base, supportsLimitOffset: false } : base;
}

/**
 * Whether the driver can be given a `LIMIT`/`OFFSET` row window.
 *
 * Purely a capability read: the driver declares it via
 * {@link DatabaseTypeMeta.supportsOffset} (mirroring its Rust
 * `supports_offset()`), and the dialect family supplies the fallback for
 * drivers that declare nothing. Callers disable row-window controls when this
 * is `false` rather than let a typed value vanish from the generated SQL.
 */
export function supportsLimitOffset(dbType?: string): boolean {
  return getQbDialectAdapter(dbType).supportsLimitOffset;
}
