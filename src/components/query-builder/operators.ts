import type { SelectOption } from '../ui/Select';
import type { QbOperator } from './types';

/**
 * Comparison operators offered by the visual query builder.
 *
 * Symbols are intentionally not translated; `LIKE`/`IN`/`IS NULL` read the same
 * in SQL as they do in the picker.
 */
export const OPERATOR_OPTIONS: SelectOption[] = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: 'LIKE', label: 'LIKE' },
  { value: 'NOT LIKE', label: 'NOT LIKE' },
  { value: 'IN', label: 'IN' },
  { value: 'NOT IN', label: 'NOT IN' },
  { value: 'IS NULL', label: 'IS NULL' },
  { value: 'IS NOT NULL', label: 'IS NOT NULL' },
];

/** Operators that take no right-hand value. */
export const NULL_OPERATORS = new Set<QbOperator>(['IS NULL', 'IS NOT NULL']);

/** Operators whose value is a comma-separated list. */
export const LIST_OPERATORS = new Set<QbOperator>(['IN', 'NOT IN']);
