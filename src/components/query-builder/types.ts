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

/** A column selection entry with optional alias and aggregate. */
export interface QbColumnSelection {
  table: string;
  column: string;
  alias?: string;
  aggregate?: QbAggregate;
}

/** A group-by entry. */
export interface QbGroupByItem {
  table: string;
  column: string;
}
