import { describe, it, expect } from 'vitest';
import { groupRelationsIntoJoins } from '../useAutoJoin';
import type { ForeignKeyRelation } from '../useAutoJoin';

const rel = (
  fromTable: string,
  fromColumn: string,
  toTable: string,
  toColumn: string,
): ForeignKeyRelation => ({ fromTable, fromColumn, toTable, toColumn });

describe('groupRelationsIntoJoins', () => {
  it('returns nothing for no relations', () => {
    expect(groupRelationsIntoJoins([])).toEqual([]);
  });

  it('makes one join from a single-column relation', () => {
    expect(groupRelationsIntoJoins([rel('orders', 'user_id', 'users', 'id')])).toEqual([
      {
        id: 'auto-orders-users-user_id=id',
        type: 'INNER',
        leftTable: 'orders',
        rightTable: 'users',
        columnPairs: [{ left: 'user_id', right: 'id' }],
        isManual: false,
        origin: 'declared',
      },
    ]);
  });

  it('folds a composite key into ONE join with both pairs', () => {
    // The bug this prevents: two joins on the same pair reference `orders` twice,
    // which PostgreSQL and MySQL reject outright.
    const joins = groupRelationsIntoJoins([
      rel('lines', 'order_id', 'orders', 'id'),
      rel('lines', 'line_no', 'orders', 'no'),
    ]);
    expect(joins).toHaveLength(1);
    expect(joins[0]!.columnPairs).toEqual([
      { left: 'order_id', right: 'id' },
      { left: 'line_no', right: 'no' },
    ]);
  });

  it('keeps opposite directions of the same table pair apart', () => {
    // `a→b` and `b→a` are different relationships; merging them would invent an
    // ON clause the schema never stated.
    const joins = groupRelationsIntoJoins([
      rel('orders', 'user_id', 'users', 'id'),
      rel('users', 'invited_by', 'orders', 'id'),
    ]);
    expect(joins).toHaveLength(2);
    expect(joins.map((j) => `${j.leftTable}→${j.rightTable}`)).toEqual([
      'orders→users',
      'users→orders',
    ]);
  });

  it('keeps distinct table pairs separate', () => {
    const joins = groupRelationsIntoJoins([
      rel('orders', 'user_id', 'users', 'id'),
      rel('orders', 'product_id', 'products', 'id'),
    ]);
    expect(joins).toHaveLength(2);
  });

  it('groups only within a table pair, not across them', () => {
    // Same source column feeding two different tables must stay two joins.
    const joins = groupRelationsIntoJoins([
      rel('events', 'actor_id', 'users', 'id'),
      rel('events', 'actor_id', 'bots', 'id'),
    ]);
    expect(joins).toHaveLength(2);
    expect(joins.every((j) => j.columnPairs.length === 1)).toBe(true);
  });

  it('derives a deterministic id so a removal survives re-derivation', () => {
    const input = [
      rel('lines', 'order_id', 'orders', 'id'),
      rel('lines', 'line_no', 'orders', 'no'),
    ];
    const first = groupRelationsIntoJoins(input);
    const second = groupRelationsIntoJoins([...input]);
    expect(second[0]!.id).toBe(first[0]!.id);
  });

  it('lets a declared relationship outrank a prediction for the same pair', () => {
    // One of the two is enforced by the database; the canvas must not label it a
    // guess.
    const joins = groupRelationsIntoJoins([
      { ...rel('orders', 'user_id', 'users', 'id'), origin: 'predicted' },
      { ...rel('orders', 'user_id', 'users', 'id'), origin: 'declared' },
    ]);
    expect(joins).toHaveLength(1);
    expect(joins[0]!.origin).toBe('declared');
  });

  it('marks an inferred relationship as predicted', () => {
    const joins = groupRelationsIntoJoins([
      { ...rel('orders', 'user_id', 'users', 'id'), origin: 'predicted' },
    ]);
    expect(joins[0]!.origin).toBe('predicted');
  });

  it('preserves first-appearance order of the table pairs', () => {
    const joins = groupRelationsIntoJoins([
      rel('c', 'b_id', 'b', 'id'),
      rel('a', 'c_id', 'c', 'id'),
      rel('c', 'x_id', 'b', 'x'),
    ]);
    expect(joins.map((j) => `${j.leftTable}→${j.rightTable}`)).toEqual(['c→b', 'a→c']);
    expect(joins[0]!.columnPairs).toHaveLength(2);
  });
});
