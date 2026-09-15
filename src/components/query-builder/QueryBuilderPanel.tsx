import { useEffect, useCallback, useMemo, useState } from 'react';
import { X, BarChart3 } from 'lucide-react';
import { useSchemaStore } from '../../stores/schemaStore';
import { useQueryBuilderStore } from '../../stores/queryBuilderStore';
import { useSqlGenerator } from './hooks/useSqlGenerator';
import { useAutoJoin } from './hooks/useAutoJoin';
import type { ForeignKeyRelation } from './hooks/useAutoJoin';
import { ObjectTreePanel } from './ObjectTreePanel';
import { DiagramCanvas } from './DiagramCanvas/DiagramCanvas';
import { CriteriaGrid } from './CriteriaGrid/CriteriaGrid';
import { SqlPreview } from './SqlPreview';
import { Button } from '../ui/Button';
import { useI18n } from '../../hooks/useI18n';
import { getCachedTableSchema } from '../../lib/schemaCache';
import type { ColumnInfo } from '../../types';

export interface QueryBuilderPanelProps {
  dbSessionId: string;
  databaseType?: string;
  onApplySql: (sql: string) => void;
}

/**
 * Main visual query builder panel.
 *
 * Three-region layout:
 * ┌──────────────────────────────────────────────────────┐
 * │ Header: [📊 Visual Builder] [DISTINCT ☐] [Reset] [×]│
 * ├──────────┬───────────────────────────────────────────┤
 * │ Object   │           DiagramCanvas (画布)              │
 * │ Tree     │  ┌─────────┐  JOIN连线  ┌─────────┐      │
 * │ (200px)  │  │TableCard│══════════│TableCard│      │
 * │          │  └─────────┘          └─────────┘      │
 * ├──────────┼───────────────────────────────────────────┤
 * │          │        CriteriaGrid (配置区)                │
 * ├──────────┼───────────────────────────────────────────┤
 * │          │        SQL Preview + Apply SQL             │
 * └──────────┴───────────────────────────────────────────┘
 */
export function QueryBuilderPanel({
  dbSessionId,
  databaseType,
  onApplySql,
}: QueryBuilderPanelProps) {
  const { t } = useI18n();

  // ── Schema data ────────────────────────────────────────
  const tables = useSchemaStore((s) => s.tables);
  const columnMap = useSchemaStore((s) => s.columnMap);
  const ensureColumns = useSchemaStore((s) => s.ensureColumns);

  // ── Query builder state ────────────────────────────────
  const selectedTables = useQueryBuilderStore((s) => s.selectedTables);
  const selectedColumns = useQueryBuilderStore((s) => s.selectedColumns);
  const joins = useQueryBuilderStore((s) => s.joins);
  const autoJoins = useQueryBuilderStore((s) => s.autoJoins);
  const tableAliases = useQueryBuilderStore((s) => s.tableAliases);
  const tablePositions = useQueryBuilderStore((s) => s.tablePositions);
  const canvasOffset = useQueryBuilderStore((s) => s.canvasOffset);
  const zoom = useQueryBuilderStore((s) => s.zoom);
  const where = useQueryBuilderStore((s) => s.where);
  const orderBy = useQueryBuilderStore((s) => s.orderBy);
  const groupBy = useQueryBuilderStore((s) => s.groupBy);
  const distinct = useQueryBuilderStore((s) => s.distinct);
  const limit = useQueryBuilderStore((s) => s.limit);
  const offset = useQueryBuilderStore((s) => s.offset);

  // ── Query builder actions ──────────────────────────────
  const toggleTable = useQueryBuilderStore((s) => s.toggleTable);
  const toggleColumn = useQueryBuilderStore((s) => s.toggleColumn);
  const updateColumnConfig = useQueryBuilderStore((s) => s.updateColumnConfig);
  const addJoin = useQueryBuilderStore((s) => s.addJoin);
  const removeJoin = useQueryBuilderStore((s) => s.removeJoin);
  const updateJoinType = useQueryBuilderStore((s) => s.updateJoinType);
  const setTableAlias = useQueryBuilderStore((s) => s.setTableAlias);
  const updateTablePosition = useQueryBuilderStore((s) => s.updateTablePosition);
  const setZoom = useQueryBuilderStore((s) => s.setZoom);
  const setCanvasOffset = useQueryBuilderStore((s) => s.setCanvasOffset);
  const setDistinct = useQueryBuilderStore((s) => s.setDistinct);
  const reset = useQueryBuilderStore((s) => s.reset);
  const toggleOpen = useQueryBuilderStore((s) => s.toggleOpen);

  // ── Load columns for selected tables ───────────────────
  useEffect(() => {
    if (selectedTables.length === 0) return;
    void ensureColumns(selectedTables);
  }, [selectedTables, ensureColumns]);

  // ── Foreign key detection ──────────────────────────────
  const [fkRelations, setFkRelations] = useState<ForeignKeyRelation[]>([]);

  // Load foreign keys for selected tables from schema cache
  useEffect(() => {
    if (selectedTables.length === 0) {
      setFkRelations([]);
      return;
    }

    let cancelled = false;
    const loadFks = async () => {
      const allFks: ForeignKeyRelation[] = [];
      for (const tableName of selectedTables) {
        try {
          const schema = await getCachedTableSchema(dbSessionId, tableName);
          for (const fk of schema.foreignKeys) {
            for (let i = 0; i < fk.columns.length; i++) {
              allFks.push({
                fromTable: tableName,
                fromColumn: fk.columns[i]!,
                toTable: fk.referencedTable,
                toColumn: fk.referencedColumns[i]!,
              });
            }
          }
        } catch {
          // Schema not available — skip silently
        }
      }
      if (!cancelled) {
        setFkRelations(allFks);
      }
    };
    void loadFks();
    return () => {
      cancelled = true;
    };
  }, [selectedTables, dbSessionId]);

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

  // ── Generate SQL preview ───────────────────────────────
  const sql = useSqlGenerator({
    selectedTables,
    selectedColumns,
    joins,
    tableAliases,
    where,
    orderBy,
    groupBy,
    distinct,
    limit,
    offset,
    databaseType,
  });

  // ── Table items for ObjectTreePanel ────────────────────
  const tableItems = useMemo(
    () =>
      tables.map((tbl) => ({
        name: tbl.name,
        type: (tbl.tableType === 'view' ? 'view' : 'table') as 'table' | 'view',
      })),
    [tables],
  );

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

      {/* ── Main content: sidebar + canvas/grid/preview ── */}
      <div className="flex min-h-[400px]">
        {/* Left: Object Tree Panel */}
        <ObjectTreePanel
          dbSessionId={dbSessionId}
          tables={tableItems}
          selectedTables={selectedTables}
          onAddTable={toggleTable}
        />

        {/* Right: Canvas + CriteriaGrid + SQL Preview */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Canvas area */}
          <div className="flex-1 overflow-hidden">
            <DiagramCanvas
              selectedTables={selectedTables}
              tablePositions={tablePositions}
              joins={joins}
              autoJoins={autoJoins}
              columnMap={columnMap}
              columnInfoMap={columnInfoMap}
              selectedColumns={selectedColumns}
              tableAliases={tableAliases}
              onToggleColumn={toggleColumn}
              onUpdatePosition={updateTablePosition}
              onAddJoin={addJoin}
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

          {/* SQL Preview + Apply */}
          <div className="flex flex-col gap-2 border-t border-edge p-3">
            <SqlPreview sql={sql} />
            <div className="flex justify-end">
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
