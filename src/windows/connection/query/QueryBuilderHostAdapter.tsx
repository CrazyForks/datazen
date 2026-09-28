import { useCallback, useMemo } from 'react';
import type {
  QueryBuilderCatalog,
  QueryBuilderContribution,
  QueryBuilderPanelProps,
  QueryBuilderRelationCandidate,
  TableSchema,
} from '@datazen/extension-points';
import type { TableSchema as HostTableSchema } from '../../../types';
import { DB_REGISTRY } from '../../../lib/databaseTypes';
import { formatSql } from '../../../lib/sqlFormat';
import { getCachedTableSchema } from '../../../lib/schemaCache';
import { toPredictionTablesFromSchemas } from '../../../lib/relationPrediction/fromTableSchema';
import { predictRelations } from '../../../lib/relationPrediction/predictRelations';
import { useSchemaStore } from '../../../stores/schemaStore';
import { useSettingsStore } from '../../../stores/settingsStore';

export interface QueryBuilderHostAdapterProps {
  contribution: QueryBuilderContribution;
  panelId: string;
  connectionId: string;
  dbSessionId: string;
  databaseType: string;
  database: string;
  schema: string | null;
  currentSql: string;
  onCommit: QueryBuilderPanelProps['onCommit'];
  onCancel: () => void;
}

/** Supplies the active query tab's schema and host-owned services to Pro. */
export function QueryBuilderHostAdapter({
  contribution,
  panelId,
  connectionId,
  dbSessionId,
  databaseType,
  database,
  schema,
  currentSql,
  onCommit,
  onCancel,
}: QueryBuilderHostAdapterProps) {
  const sessionSchema = useSchemaStore((state) => state.schemas.get(dbSessionId));
  const sqlFormatOptions = useSettingsStore((state) => state.settings.sqlFormatOptions);
  const enableFkPrediction = useSettingsStore(
    (state) => state.settings.enableFkPrediction ?? false,
  );

  const catalog = useMemo<QueryBuilderCatalog>(() => {
    const relations = [
      ...(sessionSchema?.tables ?? []),
      ...(sessionSchema?.views ?? []),
      ...Object.values(sessionSchema?.pathItems ?? {}).flat(),
    ].filter((relation) => !schema || (relation.schema ?? null) === schema);
    const hasMatchingDatabase =
      !sessionSchema?.currentDatabase || sessionSchema.currentDatabase === database;
    const counts = new Map<string, number>();
    if (hasMatchingDatabase) {
      for (const relation of relations) {
        counts.set(relation.name, (counts.get(relation.name) ?? 0) + 1);
      }
    }
    return {
      tables: hasMatchingDatabase
        ? relations
            .filter((relation) => counts.get(relation.name) === 1)
            .map((relation) => ({ name: relation.name, schema: relation.schema ?? null }))
        : [],
      columnMap: hasMatchingDatabase ? (sessionSchema?.columnMap ?? {}) : {},
      typedColumnMap: hasMatchingDatabase ? (sessionSchema?.typedColumnMap ?? {}) : {},
    };
  }, [sessionSchema, schema, database]);

  const ensureColumns = useCallback(
    async (names: readonly string[]) => {
      if (!dbSessionId || !database.trim() || names.length === 0) return;
      await useSchemaStore.getState().ensureColumns([...names], dbSessionId, database, {
        requireTypes: true,
      });
    },
    [dbSessionId, database],
  );

  const loadTableSchema = useCallback(
    async (name: string): Promise<TableSchema | null> => {
      if (!dbSessionId || !database.trim() || !name.trim()) return null;
      try {
        const relationSchema =
          useSchemaStore.getState().schemaOfRelation(name, dbSessionId) ?? schema;
        return await getCachedTableSchema(dbSessionId, name, database, relationSchema);
      } catch {
        return null;
      }
    },
    [dbSessionId, database, schema],
  );

  const predict = useCallback(
    (schemas: readonly TableSchema[]): readonly QueryBuilderRelationCandidate[] => {
      const hostSchemas: HostTableSchema[] = schemas.map((item) => ({
        ...item,
        columns: item.columns.map((column) => ({
          ...column,
          comment: column.comment ?? undefined,
        })),
      }));
      return predictRelations(toPredictionTablesFromSchemas(hostSchemas)).map((candidate) => ({
        id: candidate.id,
        fromTable: candidate.fromTable,
        toTable: candidate.toTable,
        columnPairs: candidate.columnPairs,
        tier: candidate.tier,
        ambiguous: candidate.ambiguous,
      }));
    },
    [],
  );

  const format = useCallback(
    (sql: string) => formatSql(sql, databaseType, sqlFormatOptions),
    [databaseType, sqlFormatOptions],
  );

  const Panel = contribution.Panel;
  return (
    <Panel
      panelId={panelId}
      connectionId={connectionId}
      dbSessionId={dbSessionId}
      databaseType={databaseType}
      database={database}
      schema={schema}
      currentSql={currentSql}
      catalog={catalog}
      dialectFamily={DB_REGISTRY[databaseType as keyof typeof DB_REGISTRY]?.sqlDialect ?? databaseType}
      enableFkPrediction={enableFkPrediction}
      ensureColumns={ensureColumns}
      loadTableSchema={loadTableSchema}
      predictRelations={predict}
      formatSql={format}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
}
