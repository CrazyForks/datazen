/**
 * The Visual Query Builder's window onto the editor's relation metadata.
 *
 * The builder does not own a schema cache. Columns come from the schema store
 * (the same `columnMap` the editor's completion namespace is built from), and
 * relation detail — foreign keys in particular — comes from the editor's
 * `metadataCache` snapshot.
 *
 * Sharing that cache matters for more than avoiding duplicate IPC:
 *
 * - The editor's cache is wired to `subscribeSchemaInvalidation`, so a DDL
 *   statement refreshes it. A private cache in the builder would keep serving
 *   stale foreign keys after the user added or dropped a constraint.
 * - Relations are keyed by `dbSessionId::<normalized identity>`, so the identity
 *   has to be built the same way on both sides. The editor qualifies every
 *   relation with the tab's schema; asking for a bare name would create a second
 *   entry (and a second fetch) for the same physical table.
 *
 * The builder therefore depends on `lib/relationMetadata` and the store facade,
 * never on `components/sql-editor`. The editor and the builder are peers that
 * both sit on that shared layer; neither owns it.
 *
 * Everything here is a pure function over an injected snapshot so the mapping is
 * testable without rendering the panel.
 */

import type { ForeignKeyRelation } from './hooks/useAutoJoin';
import { toPredictionTable } from '../../lib/relationPrediction/fromRelationMetadata';
import { predictRelations } from '../../lib/relationPrediction/predictRelations';
import type { PredictionEvidence, PredictionTier } from '../../lib/relationPrediction/types';
import {
  ensureMetadataRelations,
  relationLookupKey,
  resolveEditorDialectId,
} from '../../stores/schemaStoreSelectors';
import type {
  EditorMetadataSnapshot,
  EditorRelationRequest,
  QualifiedRelationId,
} from '../../lib/relationMetadata/types';

/** Context a relation lookup resolves against; mirrors the editor's own. */
export interface RelationLookupContext {
  database: string;
  schema?: string;
  databaseType?: string;
}

/**
 * The editor's relation identity for a bare table name.
 *
 * Built exactly like the editor's feed (`QueryPanel`) so both sides resolve the
 * same relation to the same metadata-cache entry.
 */
export function relationIdentityFor(table: string, schema?: string): QualifiedRelationId {
  return {
    namespacePath: schema ? [{ name: schema, quoted: false }] : [],
    name: { name: table, quoted: false },
  };
}

/**
 * Queue `tables` into the editor's metadata cache.
 *
 * Identical to the call the editor makes for tables referenced in the SQL, so a
 * relation loaded by either side is reused by the other rather than re-fetched.
 */
export function ensureTableRelations(
  dbSessionId: string,
  tables: readonly string[],
  ctx: RelationLookupContext,
): void {
  if (tables.length === 0 || !ctx.database) return;
  const requests: EditorRelationRequest[] = tables.map((table) => ({
    identity: relationIdentityFor(table, ctx.schema),
    kind: 'table' as const,
  }));
  ensureMetadataRelations(dbSessionId, requests, {
    database: ctx.database,
    schema: ctx.schema,
    dialectId: resolveEditorDialectId(ctx.databaseType),
  });
}

/**
 * Foreign-key relationships among `tables`, read from the editor's snapshot.
 *
 * Relations are looked up by the exact key the editor writes, so a table is only
 * ever matched to the relation the editor actually loaded for it.
 *
 * Deliberately *not* `findRelationMetadata`: that resolver falls back to a
 * case-insensitive bare-name match for the benefit of completion, where finding
 * something beats finding nothing. Here a wrong match is worse than no match —
 * it would generate a JOIN against a same-named table in another schema — and a
 * missing match is recoverable, because the user can now draw a manual JOIN.
 * Identifier folding still applies: the key is built through the dialect
 * adapter, so `PUBLIC.ORDERS` and `public.orders` resolve to one relation while
 * a quoted `"Orders"` stays distinct.
 *
 * Tables that are not (yet) in the snapshot are skipped — the caller's effect
 * has already queued them.
 */
export function deriveForeignKeyRelations(
  snapshot: EditorMetadataSnapshot | undefined,
  tables: readonly string[],
  schema?: string,
  dialectId?: string,
): ForeignKeyRelation[] {
  if (tables.length === 0 || !snapshot) return [];
  const relations: ForeignKeyRelation[] = [];

  for (const table of tables) {
    const key = relationLookupKey(
      snapshot.dbSessionId,
      relationIdentityFor(table, schema),
      dialectId ?? 'standard',
    );
    const metadata = snapshot.relations.get(key);
    if (!metadata) continue;
    for (const fk of metadata.foreignKeys) {
      for (let i = 0; i < fk.columns.length; i++) {
        const fromColumn = fk.columns[i];
        const toColumn = fk.referencedColumns[i];
        // A malformed FK (fewer target columns than source columns) is skipped
        // rather than emitted with an undefined column.
        if (!fromColumn || !toColumn) continue;
        relations.push({
          fromTable: table,
          fromColumn,
          toTable: fk.referencedTable,
          toColumn,
        });
      }
    }
  }
  return relations;
}

/** A relationship the engine inferred rather than read from a constraint. */
export interface PredictedRelation extends ForeignKeyRelation {
  /** Deterministic candidate id, so a dismissal survives re-prediction. */
  candidateId: string;
  tier: PredictionTier;
  score: number;
  /**
   * True when more than one table matched equally well. Such a candidate is
   * never applied automatically — the caller must ask the user.
   */
  ambiguous: boolean;
  evidence: readonly PredictionEvidence[];
}

/**
 * Relationships the engine infers among `tables`, excluding declared ones.
 *
 * Declared constraints are already handled by {@link deriveForeignKeyRelations},
 * and the engine skips those columns itself, so the two never overlap.
 *
 * Only the selected tables are offered as targets: a JOIN can only reference a
 * table that is on the canvas, and predicting relationships to tables the user
 * has not chosen would fill the suggestions with noise.
 */
export function predictTableRelations(
  snapshot: EditorMetadataSnapshot | undefined,
  tables: readonly string[],
  ctx: RelationLookupContext,
): PredictedRelation[] {
  if (tables.length < 2 || !snapshot) return [];

  const dialectId = resolveEditorDialectId(ctx.databaseType);
  const inputs = [];
  for (const table of tables) {
    const key = relationLookupKey(
      snapshot.dbSessionId,
      relationIdentityFor(table, ctx.schema),
      dialectId,
    );
    const metadata = snapshot.relations.get(key);
    // A table that is not (yet) in the snapshot cannot be predicted on; the
    // caller's effect has already queued it.
    if (!metadata) continue;
    inputs.push(toPredictionTable(table, metadata, ctx.schema));
  }
  if (inputs.length < 2) return [];

  return predictRelations(inputs).flatMap((candidate) =>
    candidate.columnPairs.map((pair) => ({
      fromTable: candidate.fromTable,
      fromColumn: pair.left,
      toTable: candidate.toTable,
      toColumn: pair.right,
      origin: 'predicted' as const,
      candidateId: candidate.id,
      tier: candidate.tier,
      score: candidate.score,
      ambiguous: candidate.ambiguous,
      evidence: candidate.evidence,
    })),
  );
}

/**
 * Split inferred relationships into those safe to apply and those to offer.
 *
 * High-confidence, unambiguous relationships are applied the way a declared
 * constraint is; everything else is only *offered*, because applying a guess
 * silently changes the result set. A composite candidate's pairs always land in
 * the same bucket, so a half-applied key is impossible.
 */
export function partitionPredictedRelations(relations: readonly PredictedRelation[]): {
  applicable: ForeignKeyRelation[];
  suggestions: PredictedRelation[];
} {
  const byCandidate = new Map<string, PredictedRelation[]>();
  for (const relation of relations) {
    const bucket = byCandidate.get(relation.candidateId);
    if (bucket) bucket.push(relation);
    else byCandidate.set(relation.candidateId, [relation]);
  }

  const applicable: ForeignKeyRelation[] = [];
  const suggestions: PredictedRelation[] = [];
  for (const bucket of byCandidate.values()) {
    const first = bucket[0]!;
    if (first.tier === 'high' && !first.ambiguous) {
      for (const relation of bucket) {
        applicable.push({
          fromTable: relation.fromTable,
          fromColumn: relation.fromColumn,
          toTable: relation.toTable,
          toColumn: relation.toColumn,
          origin: 'predicted',
        });
      }
    } else {
      suggestions.push(...bucket);
    }
  }
  return { applicable, suggestions };
}
