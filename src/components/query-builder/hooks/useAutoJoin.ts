import { useMemo } from 'react';
import type { QbColumnPair, QbJoin, QbJoinOrigin } from '../types';

/** Foreign key relationship metadata from the schema store. */
export interface ForeignKeyRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  /**
   * Whether the database declares this relationship or it was inferred.
   * Defaults to `declared` — the safe reading, since only a declared constraint
   * is guaranteed to hold.
   */
  origin?: QbJoinOrigin;
}

/**
 * Group flat column-pair relationships into one join per table pair.
 *
 * A foreign key is a *set* of column pairs. Expanding a composite key into one
 * join per pair would make the generator emit the same table twice, which
 * PostgreSQL and MySQL reject — so grouping happens here, at the source, rather
 * than being left to the SQL writer.
 *
 * Pairs that share a table pair but disagree on direction (`a→b` and `b→a`) stay
 * separate: they are different relationships, and merging them would invent an
 * ON clause the schema never stated.
 */
export function groupRelationsIntoJoins(relations: readonly ForeignKeyRelation[]): QbJoin[] {
  const groups = new Map<
    string,
    { leftTable: string; rightTable: string; pairs: QbColumnPair[]; origin: QbJoinOrigin }
  >();
  const order: string[] = [];

  for (const relation of relations) {
    const key = `${relation.fromTable}\u0000${relation.toTable}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        leftTable: relation.fromTable,
        rightTable: relation.toTable,
        pairs: [],
        origin: relation.origin ?? 'declared',
      };
      groups.set(key, group);
      order.push(key);
    }
    // A declared constraint outranks a prediction for the same relationship: one
    // of them is enforced by the database.
    if ((relation.origin ?? 'declared') === 'declared') group.origin = 'declared';
    group.pairs.push({ left: relation.fromColumn, right: relation.toColumn });
  }

  return order.map((key) => {
    const group = groups.get(key)!;
    const pairs = group.pairs.map((pair) => `${pair.left}=${pair.right}`).join(',');
    return {
      // Deterministic id derived from the relationship, so a user's removal
      // survives a re-derivation of the same schema.
      id: `auto-${group.leftTable}-${group.rightTable}-${pairs}`,
      type: 'INNER' as const,
      leftTable: group.leftTable,
      rightTable: group.rightTable,
      columnPairs: group.pairs,
      isManual: false as const,
      origin: group.origin,
    };
  });
}

/**
 * Automatically detect FK relationships between selected tables.
 *
 * Returns one `QbJoin` (with `isManual: false`) per relationship where **both**
 * the source and target table are present in `selectedTables`.
 *
 * @param selectedTables - Currently selected table names.
 * @param foreignKeys     - All known FK relationships from the schema.
 */
export function useAutoJoin(selectedTables: string[], foreignKeys: ForeignKeyRelation[]): QbJoin[] {
  return useMemo(() => {
    if (selectedTables.length === 0 || foreignKeys.length === 0) return [];

    const tableSet = new Set(selectedTables);
    const relevant = foreignKeys.filter(
      (fk) => tableSet.has(fk.fromTable) && tableSet.has(fk.toTable),
    );

    return groupRelationsIntoJoins(relevant);
  }, [selectedTables, foreignKeys]);
}
