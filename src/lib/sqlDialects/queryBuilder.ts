/**
 * SQL dialect adapter for the Visual Query Builder.
 *
 * Encapsulates per-database differences in identifier quoting, ILIKE support,
 * LIMIT/OFFSET formatting, NULL comparison syntax, and IN-list generation.
 */

import { DB_REGISTRY } from '../databaseTypes';
import type { DatabaseType } from '../../types';
import type { QbColumnPair, QbJoin } from '../../components/query-builder/types';

// ── Adapter interface ─────────────────────────────────────────

/**
 * Per-dialect *syntax*: how a dialect spells things. Capability is not part of
 * this — a dialect family never decides whether a feature is available, the
 * driver does.
 */
export interface QbDialectSyntax {
  /** Wrap an identifier (table/column/alias) in the dialect-specific quote characters. */
  quoteIdentifier(name: string): string;
  /** Whether this dialect supports ILIKE for case-insensitive LIKE. */
  supportsILike: boolean;
  /**
   * Format a LIMIT / OFFSET clause.
   * Returns `null` when the dialect has no LIMIT/OFFSET spelling at all.
   */
  formatLimitOffset(limit: number, offset: number): string | null;
  /** Format an `IS [NOT] NULL` comparison. */
  formatNullComparison(quotedColumn: string, isNull: boolean): string;
  /** Format an `[NOT] IN (val1, val2, …)` clause. Values are already SQL-escaped. */
  formatInList(quotedColumn: string, values: string[], negated: boolean): string;
}

/**
 * A resolved adapter: dialect syntax plus the driver's declared capabilities.
 *
 * `supportsLimitOffset` is read from {@link DatabaseTypeMeta.supportsOffset} by
 * {@link getQbDialectAdapter}; it is never hard-coded per dialect family.
 */
export interface QbDialectAdapter extends QbDialectSyntax {
  /**
   * Whether this driver can be given a `LIMIT`/`OFFSET` row window.
   *
   * LIMIT/OFFSET is standard SQL, so a driver that declares nothing supports it;
   * only an explicit `supportsOffset: false` turns it off.
   */
  supportsLimitOffset: boolean;
}

// ── Per-dialect implementations ───────────────────────────────

const postgresqlAdapter: QbDialectSyntax = {
  quoteIdentifier: (n) => `"${n}"`,
  supportsILike: true,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${l} OFFSET ${o}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const mysqlAdapter: QbDialectSyntax = {
  quoteIdentifier: (n) => `\`${n}\``,
  supportsILike: false,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${o}, ${l}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const sqliteAdapter: QbDialectSyntax = {
  quoteIdentifier: (n) => `"${n}"`,
  supportsILike: false,
  formatLimitOffset: (l, o) => (o > 0 ? `LIMIT ${l} OFFSET ${o}` : `LIMIT ${l}`),
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const sqlserverAdapter: QbDialectSyntax = {
  quoteIdentifier: (n) => `[${n}]`,
  supportsILike: false,
  // T-SQL has no LIMIT/OFFSET spelling: it uses OFFSET…FETCH, which is only legal
  // with an ORDER BY. The driver declares the capability; this is the syntax-level
  // backstop for a driver that declares support before one exists here.
  formatLimitOffset: () => null,
  formatNullComparison: (c, isNull) => `${c} IS${isNull ? '' : ' NOT'} NULL`,
  formatInList: (c, v, neg) => `${c} ${neg ? 'NOT ' : ''}IN (${v.join(', ')})`,
};

const genericAdapter: QbDialectSyntax = {
  quoteIdentifier: (n) => `"${n}"`,
  supportsILike: false,
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

  // One JOIN per (left table, right table, type), with every column pair ANDed
  // into its ON clause. Two JOINs on the same table would reference it twice,
  // which PostgreSQL and MySQL reject outright — a composite foreign key would
  // hit that on its own if each pair became its own JOIN. Order follows the
  // first appearance of each group, so the FROM/JOIN ordering stays stable.
  const groups = new Map<string, { join: QbJoin; pairs: QbColumnPair[] }>();
  const order: string[] = [];

  for (const join of joins) {
    const key = `${join.leftTable}\u0000${join.rightTable}\u0000${join.type}`;
    const existing = groups.get(key);
    if (existing) {
      existing.pairs.push(...join.columnPairs);
      continue;
    }
    groups.set(key, { join, pairs: [...join.columnPairs] });
    order.push(key);
  }

  const lines = order.map((key) => {
    const { join, pairs } = groups.get(key)!;
    const leftTableRef = aliases[join.leftTable] ? q(aliases[join.leftTable]) : q(join.leftTable);
    const rightTableRef = q(join.rightTable);
    const predicates = pairs
      .map((pair) => `${leftTableRef}.${q(pair.left)} = ${rightTableRef}.${q(pair.right)}`)
      .join(' AND ');
    return `${join.type} JOIN ${rightTableRef} ON ${predicates}`;
  });

  return `\n${lines.join('\n')}`;
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

const DIALECT_FAMILY_MAP: Record<string, QbDialectSyntax> = {
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
  const meta = dbType ? DB_REGISTRY[dbType as DatabaseType] : undefined;
  const family = meta?.sqlDialect ?? (dbType as string);
  const syntax = DIALECT_FAMILY_MAP[family] ?? genericAdapter;

  // LIMIT/OFFSET is standard SQL, so the default is supported and only a driver
  // that explicitly declares `supportsOffset: false` opts out. Attaching the
  // capability here keeps the row-window controls and the generated SQL reading
  // one source of truth.
  return { ...syntax, supportsLimitOffset: meta?.supportsOffset !== false };
}

/**
 * Whether the driver can be given a `LIMIT`/`OFFSET` row window.
 *
 * Purely a capability read. LIMIT/OFFSET is standard SQL, so a driver that does
 * not declare {@link DatabaseTypeMeta.supportsOffset} supports it; only an
 * explicit `false` (mirroring the driver's Rust `supports_offset()`) turns it
 * off. Callers disable row-window controls when this is `false` rather than let
 * a typed value vanish from the generated SQL.
 */
export function supportsLimitOffset(dbType?: string): boolean {
  return getQbDialectAdapter(dbType).supportsLimitOffset;
}
