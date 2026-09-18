import { useEffect, useCallback, useMemo } from 'react';
import { X, BarChart3, Link2, Sparkles } from 'lucide-react';
import { useSchemaStore } from '../../stores/schemaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMetadataSnapshot, resolveEditorDialectId } from '../../stores/schemaStoreSelectors';
import {
  deriveForeignKeyRelations,
  ensureTableRelations,
  partitionPredictedRelations,
  predictTableRelations,
} from './relationMetadataSource';
import { useQueryBuilderStore, mergeJoins } from '../../stores/queryBuilderStore';
import { useSqlGenerator } from './hooks/useSqlGenerator';
import { useAutoJoin } from './hooks/useAutoJoin';
import { DiagramCanvas } from './DiagramCanvas/DiagramCanvas';
import { CriteriaGrid } from './CriteriaGrid/CriteriaGrid';
import { ConditionBuilder } from './ConditionBuilder/ConditionBuilder';
import { SqlPreview } from './SqlPreview';
import { PaginationControls } from './PaginationControls';
import { Button } from '../ui/Button';
import { useI18n } from '../../hooks/useI18n';
import { supportsLimitOffset } from '../../lib/sqlDialects/queryBuilder';
import type { ColumnInfo } from '../../types';

export interface QueryBuilderPanelProps {
  dbSessionId: string;
  /**
   * Name of the database the session is attached to. Required: it is the
   * namespace the schema/FK lookups resolve against, and it is *not* the same
   * value as `databaseType` (passing the type here silently queries a database
   * literally named "postgresql").
   */
  database: string;
  /** Schema context of the tab — the same value the editor resolves relations against. */
  schema?: string;
  databaseType?: string;
  onApplySql: (sql: string) => void;
}

/**
 * Main visual query builder panel.
 *
 * Two-region layout:
 * ┌──────────────────────────────────────────────────────┐
 * │ Header: [📊 Visual Builder] [DISTINCT ☐] [Reset] [×]│
 * ├──────────────────────────────────────────────────────┤
 * │           DiagramCanvas (画布)                        │
 * │  ┌─────────┐  JOIN连线  ┌─────────┐                 │
 * │  │TableCard│══════════│TableCard│                 │
 * │  └─────────┘          └─────────┘                 │
 * ├──────────────────────────────────────────────────────┤
 * │           CriteriaGrid (配置区)                       │
 * ├──────────────────────────────────────────────────────┤
 * │           SQL Preview + Apply SQL                    │
 * └──────────────────────────────────────────────────────┘
 */
export function QueryBuilderPanel({
  dbSessionId,
  database,
  schema,
  databaseType,
  onApplySql,
}: QueryBuilderPanelProps) {
  const { t } = useI18n();

  // ── Schema data ────────────────────────────────────────
  // Read the column map of *this* session, not the globally active one: the
  // store's `columnMap` getter flattens `activeDbSessionId`, which only happens
  // to match this panel's session while it is the focused tab.
  const columnMap = useSchemaStore((s) => s.getConnectionSchema(dbSessionId)?.columnMap) ?? {};
  const ensureColumns = useSchemaStore((s) => s.ensureColumns);

  // Relation metadata comes from the editor's own cache so both sides share one
  // entry per relation and one invalidation path (DDL refreshes both).
  const metadataSnapshot = useMetadataSnapshot(dbSessionId);
  const dialectId = resolveEditorDialectId(databaseType);

  // ── Query builder state ────────────────────────────────
  const selectedTables = useQueryBuilderStore((s) => s.selectedTables);
  const selectedColumns = useQueryBuilderStore((s) => s.selectedColumns);
  const joins = useQueryBuilderStore((s) => s.joins);
  const autoJoins = useQueryBuilderStore((s) => s.autoJoins);
  const removedAutoJoinIds = useQueryBuilderStore((s) => s.removedAutoJoinIds);
  const autoJoinTypes = useQueryBuilderStore((s) => s.autoJoinTypes);
  const tableAliases = useQueryBuilderStore((s) => s.tableAliases);
  const joinAnchor = useQueryBuilderStore((s) => s.joinAnchor);
  const clickJoinColumn = useQueryBuilderStore((s) => s.clickJoinColumn);
  const setJoinAnchor = useQueryBuilderStore((s) => s.setJoinAnchor);
  const tablePositions = useQueryBuilderStore((s) => s.tablePositions);
  const canvasOffset = useQueryBuilderStore((s) => s.canvasOffset);
  const zoom = useQueryBuilderStore((s) => s.zoom);
  const where = useQueryBuilderStore((s) => s.where);
  const orderBy = useQueryBuilderStore((s) => s.orderBy);
  const groupBy = useQueryBuilderStore((s) => s.groupBy);
  const distinct = useQueryBuilderStore((s) => s.distinct);
  const limit = useQueryBuilderStore((s) => s.limit);
  const offset = useQueryBuilderStore((s) => s.offset);
  const setLimit = useQueryBuilderStore((s) => s.setLimit);
  const setOffset = useQueryBuilderStore((s) => s.setOffset);

  // ── Query builder actions ──────────────────────────────
  const toggleTable = useQueryBuilderStore((s) => s.toggleTable);
  const toggleColumn = useQueryBuilderStore((s) => s.toggleColumn);
  const updateColumnConfig = useQueryBuilderStore((s) => s.updateColumnConfig);
  const removeJoin = useQueryBuilderStore((s) => s.removeJoin);
  const updateJoinType = useQueryBuilderStore((s) => s.updateJoinType);
  const addJoin = useQueryBuilderStore((s) => s.addJoin);
  const fkPredictionEnabled = useSettingsStore((s) => s.settings.enableFkPrediction ?? true);
  const setTableAlias = useQueryBuilderStore((s) => s.setTableAlias);
  const updateTablePosition = useQueryBuilderStore((s) => s.updateTablePosition);
  const setZoom = useQueryBuilderStore((s) => s.setZoom);
  const setCanvasOffset = useQueryBuilderStore((s) => s.setCanvasOffset);
  const setDistinct = useQueryBuilderStore((s) => s.setDistinct);
  const reset = useQueryBuilderStore((s) => s.reset);
  const toggleOpen = useQueryBuilderStore((s) => s.toggleOpen);

  // ── Esc cancels an armed JOIN anchor ───────────────────
  useEffect(() => {
    if (!joinAnchor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setJoinAnchor(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [joinAnchor, setJoinAnchor]);

  // ── Load columns for selected tables ───────────────────
  useEffect(() => {
    if (selectedTables.length === 0 || !database) return;
    void ensureColumns(selectedTables, dbSessionId, database);
  }, [selectedTables, ensureColumns, dbSessionId, database]);

  // ── Foreign key detection ──────────────────────────────
  // Queue the selected tables into the editor's metadata cache. This is the same
  // call the editor makes for tables referenced in the SQL, so a table loaded by
  // either side is reused by the other instead of being fetched twice.
  useEffect(() => {
    ensureTableRelations(dbSessionId, selectedTables, { database, schema, databaseType });
  }, [selectedTables, dbSessionId, database, schema, databaseType]);

  // Resolve each selected table through the editor's own snapshot + resolver, so
  // identifier folding and the schema-tree fallback behave identically.
  const declaredFkRelations = useMemo(
    () => deriveForeignKeyRelations(metadataSnapshot, selectedTables, schema, dialectId),
    [selectedTables, metadataSnapshot, schema, dialectId],
  );

  // Relationships the schema does not declare, inferred from structure and
  // naming. Applied only when the engine is confident and unambiguous; the rest
  // are offered for the user to accept. Declared constraints are unaffected by the
  // setting — turning prediction off must not hide what the database states.
  const predicted = useMemo(
    () =>
      fkPredictionEnabled
        ? predictTableRelations(metadataSnapshot, selectedTables, {
            database,
            schema,
            databaseType,
          })
        : [],
    [fkPredictionEnabled, metadataSnapshot, selectedTables, database, schema, databaseType],
  );
  const { applicable: applicablePredictions, suggestions: predictedSuggestions } = useMemo(
    () => partitionPredictedRelations(predicted),
    [predicted],
  );

  // Declared constraints and confident predictions feed the same auto-join path;
  // `origin` keeps them distinguishable on the canvas.
  const fkRelations = useMemo(
    () => [...declaredFkRelations, ...applicablePredictions],
    [declaredFkRelations, applicablePredictions],
  );

  const detectedAutoJoins = useAutoJoin(selectedTables, fkRelations);

  // Sync auto-detected joins to store
  useEffect(() => {
    // Only update if the auto joins have changed
    const store = useQueryBuilderStore.getState();
    const currentAutoIds = new Set(store.autoJoins.map((j) => j.id));
    const newAutoIds = new Set(detectedAutoJoins.map((j) => j.id));
    const changed =
      currentAutoIds.size !== newAutoIds.size ||
      [...currentAutoIds].some((id) => !newAutoIds.has(id));
    if (changed) {
      useQueryBuilderStore.setState({ autoJoins: detectedAutoJoins });
    }
  }, [detectedAutoJoins]);

  // ── Build column info map for DiagramCanvas ────────────
  const columnInfoMap: Record<string, ColumnInfo[]> = useMemo(() => {
    const map: Record<string, ColumnInfo[]> = {};
    for (const [table, cols] of Object.entries(columnMap)) {
      map[table] = cols.map((name) => ({ name, dataType: '', nullable: true }));
    }
    return map;
  }, [columnMap]);

  // Manual + auto-detected joins, so the canvas and the SQL agree.
  const effectiveJoins = useMemo(
    () => mergeJoins(joins, autoJoins, removedAutoJoinIds, autoJoinTypes),
    [joins, autoJoins, removedAutoJoinIds, autoJoinTypes],
  );

  // ── Generate SQL preview ───────────────────────────────
  const sql = useSqlGenerator({
    selectedTables,
    selectedColumns,
    joins: effectiveJoins,
    tableAliases,
    where,
    orderBy,
    groupBy,
    distinct,
    limit,
    offset,
    databaseType,
  });

  // ── Handlers ───────────────────────────────────────────
  const handleApply = useCallback(() => {
    if (sql) {
      onApplySql(sql);
    }
  }, [sql, onApplySql]);

  const handleClose = useCallback(() => {
    toggleOpen();
  }, [toggleOpen]);

  const handleRemoveColumn = useCallback(
    (table: string, column: string) => {
      // Remove column from selection by toggling it off
      toggleColumn(table, column);
    },
    [toggleColumn],
  );

  const handleAddColumn = useCallback(() => {
    // Add column from first selected table's first column
    if (selectedTables.length > 0) {
      const firstTable = selectedTables[0]!;
      const cols = columnMap[firstTable];
      if (cols && cols.length > 0) {
        toggleColumn(firstTable, cols[0]!);
      }
    }
  }, [selectedTables, columnMap, toggleColumn]);

  const handleDropTable = useCallback(
    (tableName: string, pos: { x: number; y: number }) => {
      toggleTable(tableName);
      updateTablePosition(tableName, pos);
    },
    [toggleTable, updateTablePosition],
  );

  return (
    <div className="flex flex-col border-b border-edge bg-surface" data-testid="qb-panel">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-accent" />
          <span className="text-[13px] font-semibold text-fg">
            {t('query.visualBuilder.title')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-fg-secondary">
            <input
              type="checkbox"
              checked={distinct}
              onChange={(e) => setDistinct(e.target.checked)}
              className="accent-accent"
              data-testid="qb-distinct-checkbox"
            />
            {t('query.visualBuilder.distinct')}
          </label>
          <button
            type="button"
            onClick={reset}
            className="rounded px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface-raised hover:text-fg"
            data-testid="qb-reset"
          >
            {t('query.visualBuilder.reset')}
          </button>
          <button
            type="button"
            onClick={handleClose}
            title={t('query.visualBuilder.close')}
            className="flex items-center justify-center rounded px-2 py-0.5 text-fg-muted hover:bg-surface-raised hover:text-fg"
            data-testid="qb-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Main content: canvas + grid/preview ─────────── */}
      <div className="flex min-h-[400px]">
        {/* Canvas + CriteriaGrid + SQL Preview */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* JOIN anchor banner — the only visible trace of the armed state */}
          {joinAnchor && (
            <div
              className="flex items-center gap-2 border-b border-edge bg-accent/10 px-3 py-1 text-[11px] text-fg"
              data-testid="qb-join-anchor-banner"
            >
              <Link2 className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="truncate">
                {t('query.visualBuilder.joinAnchorHint')}
                {' — '}
                <span className="font-semibold">
                  {joinAnchor.table}.{joinAnchor.column}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setJoinAnchor(null)}
                className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-fg-muted hover:bg-surface-raised hover:text-fg"
                data-testid="qb-join-anchor-cancel"
              >
                {t('query.visualBuilder.cancelJoin')}
              </button>
            </div>
          )}

          {/* Predicted-relationship suggestions — offered, never applied.
              A guess must not change the query silently, so these wait for a
              click while high-confidence predictions join the canvas directly. */}
          {predictedSuggestions.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-1.5 border-b border-dashed border-edge bg-surface-alt/40 px-3 py-1"
              data-testid="qb-predicted-suggestions"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="text-[11px] text-fg-muted">
                {t('query.visualBuilder.predictedHint')}
              </span>
              {predictedSuggestions.map((suggestion) => (
                <button
                  key={`${suggestion.candidateId}-${suggestion.fromColumn}`}
                  type="button"
                  onClick={() =>
                    addJoin({
                      type: 'INNER',
                      leftTable: suggestion.fromTable,
                      rightTable: suggestion.toTable,
                      columnPairs: [{ left: suggestion.fromColumn, right: suggestion.toColumn }],
                      isManual: true,
                    })
                  }
                  title={suggestion.evidence.map((e) => e.detail).join('\n')}
                  className="rounded border border-dashed border-accent/50 bg-accent/5 px-1.5 py-0.5 text-[10px] text-fg-secondary hover:border-accent hover:bg-accent/10"
                  data-testid={`qb-predicted-accept-${suggestion.fromTable}-${suggestion.fromColumn}-${suggestion.toTable}-${suggestion.toColumn}`}
                >
                  {suggestion.fromTable}.{suggestion.fromColumn} → {suggestion.toTable}.
                  {suggestion.toColumn}
                  {suggestion.ambiguous ? ` (${t('query.visualBuilder.predictedAmbiguous')})` : ''}
                </button>
              ))}
            </div>
          )}

          {/* Canvas area */}
          <div className="flex-1 overflow-hidden">
            <DiagramCanvas
              selectedTables={selectedTables}
              tablePositions={tablePositions}
              joins={effectiveJoins}
              columnMap={columnMap}
              columnInfoMap={columnInfoMap}
              selectedColumns={selectedColumns}
              tableAliases={tableAliases}
              onToggleColumn={toggleColumn}
              onClickColumn={clickJoinColumn}
              joinAnchor={joinAnchor}
              onUpdatePosition={updateTablePosition}
              onUpdateJoinType={updateJoinType}
              onRemoveJoin={removeJoin}
              onSetTableAlias={setTableAlias}
              onDropTable={handleDropTable}
              zoom={zoom}
              canvasOffset={canvasOffset}
              onZoomChange={setZoom}
              onOffsetChange={setCanvasOffset}
            />
          </div>

          {/* CriteriaGrid */}
          <CriteriaGrid
            selectedColumns={selectedColumns}
            allTables={selectedTables}
            allColumns={columnMap}
            onUpdateColumn={updateColumnConfig}
            onRemoveColumn={handleRemoveColumn}
            onAddColumn={handleAddColumn}
          />

          {/* WHERE condition tree */}
          <ConditionBuilder columnMap={columnMap} />

          {/* SQL Preview + Apply */}
          <div className="flex flex-col gap-2 border-t border-edge p-3">
            <SqlPreview sql={sql} />
            <div className="flex items-center justify-between gap-3">
              <PaginationControls
                limit={limit}
                offset={offset}
                supported={supportsLimitOffset(databaseType)}
                onLimitChange={setLimit}
                onOffsetChange={setOffset}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={!sql}
                data-testid="qb-apply-sql"
              >
                {t('query.visualBuilder.applySql')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
