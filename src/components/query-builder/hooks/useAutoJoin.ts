import { useMemo } from 'react';
import type { QbJoin } from '../types';

/** Foreign key relationship metadata from the schema store. */
export interface ForeignKeyRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/**
 * Automatically detect FK relationships between selected tables.
 *
 * Returns a list of `QbJoin` entries (with `isManual: false`) for every
 * foreign key where **both** the source and target table are present in
 * `selectedTables`.
 *
 * @param selectedTables - Currently selected table names.
 * @param foreignKeys     - All known FK relationships from the schema.
 */
export function useAutoJoin(selectedTables: string[], foreignKeys: ForeignKeyRelation[]): QbJoin[] {
  return useMemo(() => {
    if (selectedTables.length === 0 || foreignKeys.length === 0) return [];

    const tableSet = new Set(selectedTables);

    return foreignKeys
      .filter((fk) => tableSet.has(fk.fromTable) && tableSet.has(fk.toTable))
      .map((fk) => ({
        id: `auto-${fk.fromTable}.${fk.fromColumn}-${fk.toTable}.${fk.toColumn}`,
        type: 'INNER' as const,
        leftTable: fk.fromTable,
        leftColumn: fk.fromColumn,
        rightTable: fk.toTable,
        rightColumn: fk.toColumn,
        isManual: false as const,
      }));
  }, [selectedTables, foreignKeys]);
}
