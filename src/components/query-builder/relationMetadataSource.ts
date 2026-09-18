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
