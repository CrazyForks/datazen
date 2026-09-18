/**
 * Shared type definitions for the Visual Query Builder.
 *
 * All QB components, store, and SQL generator import from this file.
 */

/** Query builder comparison operators. */
export type QbOperator =
  | '='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'LIKE'
  | 'NOT LIKE'
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL';

/** SQL aggregate functions. */
export type QbAggregate = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';

/** JOIN type. */
export type QbJoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

/** A single condition row in a WHERE clause. */
export interface QbCondition {
  id: string;
  table: string;
  column: string;
  operator: QbOperator;
  /** Right-hand value. For IN/NOT IN use comma-separated list. For IS NULL/IS NOT NULL this is ignored. */
  value: string | null;
  /** Conjunction linking this condition to the previous one (ignored for the first condition). */
  conjunction: 'AND' | 'OR';
}

/** A group of conditions joined by a common logic operator. Supports nesting. */
export interface QbConditionGroup {
  id: string;
  /** Logic operator joining conditions inside this group. */
  logic: 'AND' | 'OR';
  /** Direct conditions in this group. */
  conditions: QbCondition[];
  /** Nested sub-groups (v1 supports one level of nesting). */
  groups: QbConditionGroup[];
}

/** A single sort clause. */
export interface QbSortItem {
  table: string;
  column: string;
  direction: 'ASC' | 'DESC';
}

/** A column selection entry with optional alias, aggregate, sort, group-by, and where. */
export interface QbColumnSelection {
  table: string;
  column: string;
  alias?: string;
  aggregate?: QbAggregate;
  /** Sort direction (ASC/DESC). Undefined means no sort. */
  sort?: 'ASC' | 'DESC';
  /** Whether this column participates in GROUP BY. */
  groupBy?: boolean;
  /** Optional per-column WHERE condition. */
  where?: QbCondition;
}

/** A JOIN relationship between two tables. */
/**
 * One column pair in a JOIN predicate: `left = right`.
 *
 * A relationship is a *set* of pairs, not a single pair. A composite foreign key
 * (`lines(order_id, line_no) → orders(id, no)`) needs both pairs in one ON
 * clause; emitting them as two JOINs would reference the same table twice.
 */
export interface QbColumnPair {
  left: string;
  right: string;
}

export interface QbJoin {
  /** Unique identifier (nanoid). */
  id: string;
  /** JOIN type. */
  type: QbJoinType;
  /** Left (source) table name. */
  leftTable: string;
  /** Right (target) table name. */
  rightTable: string;
  /**
   * The ON predicate's column pairs, ANDed together. Never empty — a join with no
   * predicate is a cross join, which this model does not express.
   */
  columnPairs: readonly QbColumnPair[];
  /** true = manually created, false = auto-detected FK. */
  isManual: boolean;
}

/** The first column pair — what a single-pair join renders as. */
export function primaryColumnPair(join: QbJoin): QbColumnPair {
  const first = join.columnPairs[0];
  if (first) return first;
  // Unreachable for joins built through the store, which always sets at least one
  // pair. Returning a placeholder keeps rendering total instead of throwing.
  return { left: '', right: '' };
}

/** Total number of predicate pairs in a join. */
export function columnPairCount(join: QbJoin): number {
  return join.columnPairs.length;
}

/** A group-by entry. */
export interface QbGroupByItem {
  table: string;
  column: string;
}
