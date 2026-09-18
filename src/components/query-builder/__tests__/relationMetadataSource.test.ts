/**
 * The builder must read relation metadata from the editor's cache, not its own.
 *
 * These tests pin the two properties that make the sharing real rather than
 * nominal: identities are built exactly as the editor builds them (so the cache
 * key matches), and foreign keys are read from the editor's snapshot (so a DDL
 * invalidation reaches the builder).
 */

import { describe, it, expect } from 'vitest';
import {
  relationIdentityFor,
  deriveForeignKeyRelations,
  predictTableRelations,
  partitionPredictedRelations,
} from '../relationMetadataSource';
import { buildEditorRelationKey } from '../../../lib/relationMetadata/identity';
import type {
  EditorMetadataSnapshot,
  EditorRelationMetadata,
} from '../../../lib/relationMetadata/types';

const SESSION = 's1';
const DATABASE = 'shop';

function relation(
  table: string,
  foreignKeys: EditorRelationMetadata['foreignKeys'],
  schema = 'public',
): EditorRelationMetadata {
  const identity = relationIdentityFor(table, schema);
  return {
    key: buildEditorRelationKey(SESSION, identity, 'postgresql'),
    identity,
    kind: 'table',
    columns: [{ name: 'id', dataType: 'integer', nullable: false }],
    primaryKey: ['id'],
    indexes: [],
    foreignKeys,
    loadedAt: 0,
  };
}

/** A snapshot keyed the way the editor's cache keys it. */
function snapshotOf(relations: EditorRelationMetadata[]): EditorMetadataSnapshot {
  return {
    dbSessionId: SESSION,
    database: DATABASE,
    epoch: 1,
    relations: new Map(relations.map((r) => [r.key, r])),
  };
}

const ORDERS_TO_USERS = [
  { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] },
];

describe('relationIdentityFor', () => {
  it('qualifies with the tab schema, exactly like the editor feed', () => {
    expect(relationIdentityFor('orders', 'public')).toEqual({
      namespacePath: [{ name: 'public', quoted: false }],
      name: { name: 'orders', quoted: false },
    });
  });

  it('stays bare when the tab has no schema context', () => {
    expect(relationIdentityFor('orders')).toEqual({
      namespacePath: [],
      name: { name: 'orders', quoted: false },
    });
  });

  it('produces the same cache key the editor would write', () => {
    // This is the whole point: a mismatch here means a second cache entry and a
    // second fetch for one physical table.
    const identity = relationIdentityFor('orders', 'public');
    const key = buildEditorRelationKey(SESSION, identity, 'postgresql');
    expect(key).toBe('s1::public.orders');
  });

  it('folds case through the dialect but keeps quoted identifiers distinct', () => {
    // PG folds unquoted identifiers, so a differently-cased spelling is the same
    // relation; a quoted identifier is not.
    expect(
      buildEditorRelationKey(SESSION, relationIdentityFor('ORDERS', 'PUBLIC'), 'postgresql'),
    ).toBe('s1::public.orders');
    const quoted = {
      namespacePath: [{ name: 'public', quoted: false }],
      name: { name: 'Orders', quoted: true },
    };
    expect(buildEditorRelationKey(SESSION, quoted, 'postgresql')).not.toBe('s1::public.orders');
  });
});

describe('deriveForeignKeyRelations', () => {
  it('reads foreign keys out of the editor snapshot', () => {
    const snapshot = snapshotOf([relation('orders', ORDERS_TO_USERS)]);
    expect(deriveForeignKeyRelations(snapshot, ['orders'], 'public', 'postgresql')).toEqual([
      { fromTable: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id' },
    ]);
  });

  it('resolves a schema-qualified relation when asked with the same schema', () => {
    const snapshot = snapshotOf([relation('orders', ORDERS_TO_USERS)]);
    expect(deriveForeignKeyRelations(snapshot, ['orders'], 'public', 'postgresql')).toHaveLength(1);
    // A different schema is a different relation and must not match by name.
    expect(deriveForeignKeyRelations(snapshot, ['orders'], 'sales', 'postgresql')).toEqual([]);
  });

  it('returns nothing for a table the editor has not loaded yet', () => {
    const snapshot = snapshotOf([relation('orders', ORDERS_TO_USERS)]);
    expect(deriveForeignKeyRelations(snapshot, ['invoices'], 'public', 'postgresql')).toEqual([]);
  });

  it('returns nothing when there is no snapshot at all', () => {
    expect(deriveForeignKeyRelations(undefined, ['orders'], 'public', 'postgresql')).toEqual([]);
  });

  it('collects keys from several tables', () => {
    const snapshot = snapshotOf([
      relation('orders', ORDERS_TO_USERS),
      relation('invoices', [
        { columns: ['order_id'], referencedTable: 'orders', referencedColumns: ['id'] },
      ]),
    ]);
    const relations = deriveForeignKeyRelations(
      snapshot,
      ['orders', 'invoices'],
      'public',
      'postgresql',
    );
    expect(
      relations.map((r) => `${r.fromTable}.${r.fromColumn}→${r.toTable}.${r.toColumn}`),
    ).toEqual(['orders.user_id→users.id', 'invoices.order_id→orders.id']);
  });

  it('expands a composite foreign key into one relation per column pair', () => {
    const snapshot = snapshotOf([
      relation('lines', [
        {
          columns: ['order_id', 'line_no'],
          referencedTable: 'lines',
          referencedColumns: ['id', 'no'],
        },
      ]),
    ]);
    expect(deriveForeignKeyRelations(snapshot, ['lines'], 'public', 'postgresql')).toEqual([
      { fromTable: 'lines', fromColumn: 'order_id', toTable: 'lines', toColumn: 'id' },
      { fromTable: 'lines', fromColumn: 'line_no', toTable: 'lines', toColumn: 'no' },
    ]);
  });

  it('skips a malformed foreign key instead of emitting an undefined column', () => {
    const snapshot = snapshotOf([
      relation('broken', [
        { columns: ['a', 'b'], referencedTable: 'other', referencedColumns: ['x'] },
      ]),
    ]);
    expect(deriveForeignKeyRelations(snapshot, ['broken'], 'public', 'postgresql')).toEqual([
      { fromTable: 'broken', fromColumn: 'a', toTable: 'other', toColumn: 'x' },
    ]);
  });

  it('follows the snapshot, so an invalidation that reloads a relation is picked up', () => {
    // The builder holds no cache of its own: whatever the editor's cache now
    // contains is what it reads. This is what makes a post-DDL refresh visible.
    const before = snapshotOf([relation('orders', [])]);
    const after = snapshotOf([relation('orders', ORDERS_TO_USERS)]);

    expect(deriveForeignKeyRelations(before, ['orders'], 'public', 'postgresql')).toEqual([]);
    expect(deriveForeignKeyRelations(after, ['orders'], 'public', 'postgresql')).toHaveLength(1);
  });

  it('is a no-op for an empty selection', () => {
    const snapshot = snapshotOf([relation('orders', ORDERS_TO_USERS)]);
    expect(deriveForeignKeyRelations(snapshot, [], 'public', 'postgresql')).toEqual([]);
  });
});

/** A relation with full column control, for prediction. */
function typedRelation(
  table: string,
  columns: { name: string; dataType: string; indexed?: boolean }[],
  over: Partial<EditorRelationMetadata> = {},
): EditorRelationMetadata {
  const identity = relationIdentityFor(table, 'public');
  return {
    key: buildEditorRelationKey(SESSION, identity, 'postgresql'),
    identity,
    kind: 'table',
    columns: columns.map((c) => ({ name: c.name, dataType: c.dataType, nullable: true })),
    primaryKey: ['id'],
    indexes: (columns ?? [])
      .filter((c) => c.indexed)
      .map((c) => ({ name: `idx_${c.name}`, columns: [c.name], isUnique: false })),
    foreignKeys: [],
    loadedAt: 0,
    ...over,
  };
}

const PREDICTION_CTX = { database: DATABASE, schema: 'public', databaseType: 'postgresql' };

const USERS_TYPED = typedRelation('users', [{ name: 'id', dataType: 'integer' }]);
const ORDERS_TYPED = typedRelation('orders', [
  { name: 'id', dataType: 'integer' },
  { name: 'user_id', dataType: 'integer' },
]);

describe('predictTableRelations', () => {
  it('infers a relationship the schema does not declare', () => {
    const snapshot = snapshotOf([USERS_TYPED, ORDERS_TYPED]);
    const found = predictTableRelations(snapshot, ['users', 'orders'], PREDICTION_CTX);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      fromTable: 'orders',
      fromColumn: 'user_id',
      toTable: 'users',
      toColumn: 'id',
      origin: 'predicted',
      tier: 'high',
      ambiguous: false,
    });
  });

  it('needs at least two tables', () => {
    const snapshot = snapshotOf([USERS_TYPED]);
    expect(predictTableRelations(snapshot, ['users'], PREDICTION_CTX)).toEqual([]);
  });

  it('skips tables that are not in the snapshot yet', () => {
    const snapshot = snapshotOf([USERS_TYPED]);
    expect(predictTableRelations(snapshot, ['users', 'orders'], PREDICTION_CTX)).toEqual([]);
  });

  it('does not restate a declared foreign key', () => {
    const ordersWithFk = typedRelation(
      'orders',
      [
        { name: 'id', dataType: 'integer' },
        { name: 'user_id', dataType: 'integer' },
      ],
      { foreignKeys: ORDERS_TO_USERS },
    );
    const snapshot = snapshotOf([USERS_TYPED, ordersWithFk]);
    expect(predictTableRelations(snapshot, ['users', 'orders'], PREDICTION_CTX)).toEqual([]);
  });

  it('carries the evidence so the UI can explain itself', () => {
    const snapshot = snapshotOf([USERS_TYPED, ORDERS_TYPED]);
    const found = predictTableRelations(snapshot, ['users', 'orders'], PREDICTION_CTX);
    expect(found[0]!.evidence.map((e) => e.code)).toContain('target-is-primary-key');
    expect(found[0]!.score).toBeGreaterThan(0);
  });

  it('returns an empty list without a snapshot', () => {
    expect(predictTableRelations(undefined, ['users', 'orders'], PREDICTION_CTX)).toEqual([]);
  });
});

describe('partitionPredictedRelations', () => {
  const relation = (tier: 'high' | 'medium', ambiguous: boolean, candidateId: string) => ({
    fromTable: 'orders',
    fromColumn: 'user_id',
    toTable: 'users',
    toColumn: 'id',
    origin: 'predicted' as const,
    candidateId,
    tier,
    score: 0.9,
    ambiguous,
    evidence: [],
  });

  it('applies a confident, unambiguous relationship', () => {
    const { applicable, suggestions } = partitionPredictedRelations([
      relation('high', false, 'c1'),
    ]);
    expect(applicable).toHaveLength(1);
    expect(applicable[0]!.origin).toBe('predicted');
    expect(suggestions).toEqual([]);
  });

  it('only offers an ambiguous one, however high it scored', () => {
    const { applicable, suggestions } = partitionPredictedRelations([relation('high', true, 'c1')]);
    expect(applicable).toEqual([]);
    expect(suggestions).toHaveLength(1);
  });

  it('only offers a medium-confidence one', () => {
    const { applicable, suggestions } = partitionPredictedRelations([
      relation('medium', false, 'c1'),
    ]);
    expect(applicable).toEqual([]);
    expect(suggestions).toHaveLength(1);
  });

  it('keeps a composite candidate in one bucket', () => {
    // Half a composite key would generate an ON clause missing a predicate.
    const pair = (column: string) => ({
      ...relation('high', false, 'c1'),
      fromColumn: column,
    });
    const { applicable, suggestions } = partitionPredictedRelations([pair('a_id'), pair('a_no')]);
    expect(suggestions).toEqual([]);
    expect(applicable.map((r) => r.fromColumn)).toEqual(['a_id', 'a_no']);
  });
});
