import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Blocks, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useSchemaStore } from '../../stores/schemaStore';
import { useQueryBuilderStore } from '../../stores/queryBuilderStore';
import { useSqlGenerator } from './hooks/useSqlGenerator';
import { useAutoJoin } from './hooks/useAutoJoin';
import { buildRelationGroups } from './relationGroups';
import type { ForeignKeyRelation } from './hooks/useAutoJoin';

/** Group-id prefix for a manually created join (see `buildRelationGroups`). */
const MANUAL_PREFIX = 'manual:';
import { DiagramCanvas } from './DiagramCanvas/DiagramCanvas';
import { CriteriaGrid } from './CriteriaGrid/CriteriaGrid';
import { WhereClauseEditor } from './CriteriaGrid/WhereClauseEditor';
import { SqlPreview } from './SqlPreview';
import { validateQuery, type QbDiagnostic } from './validation';
import { QueryBuilderBottomTabs } from './QueryBuilderBottomTabs';
import { CommitConflictDialog, type CommitConflictChoice } from './CommitConflictDialog';
import { Button } from '../ui/Button';
import { useI18n } from '../../hooks/useI18n';
import { useResizable } from '../../hooks/useResizable';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { getCachedTableSchema } from '../../lib/schemaCache';
import { cn } from '../../lib/cn';
import type { ColumnInfo } from '../../types';
import type { QbJoinType } from './types';

export interface QueryBuilderPanelProps {
  /** Owning query panel. Scopes the builder's open state. */
  panelId: string;
  dbSessionId: string;
  databaseType?: string;
  /** Current SQL in the editor, used for the OK conflict check. */
  currentSql: string;
  /**
   * Apply the builder result.
   * - `sql === null` → nothing to write, the editor content is already correct.
   * - `mode` → replace the editor content or append the generated SQL.
   */
  onCommit: (sql: string | null, mode: 'replace' | 'append') => void;
  /** Cancel: the caller closes the builder and focuses the editor. */
  onCancel: () => void;
}

const BOTTOM_MIN = 140;
const BOTTOM_MAX = 620;

/**
 * Visual query builder.
 *
 * Layout (see PRD §6.2) — two vertical regions only, so the canvas is not
 * squeezed by a stacked grid + preview:
 * ┌──────────────────────────────────────────┐
 * │ header  [title] [DISTINCT] [reset] [⤢][×]│
 * ├──────────────────────────────────────────┤
 * │ canvas (flex-1, collapsible)             │
 * ├══ splitter (draggable, persisted) ═══════┤
 * │ bottom tabs  [ Build | Preview ]         │
 * ├──────────────────────────────────────────┤
 * │ footer                             [×][OK]│
 * └──────────────────────────────────────────┘
 *
 * OK writes SQL back to the editor; it never executes anything (PRD §6.3).
 */
export function QueryBuilderPanel({
  panelId,
  dbSessionId,
  databaseType,
  currentSql,
  onCommit,
  onCancel,
}: QueryBuilderPanelProps) {
  const { t } = useI18n();

  // ── Schema data ────────────────────────────────────────
  const columnMap = useSchemaStore((s) => s.columnMap);
  const currentDatabase = useSchemaStore((s) => s.currentDatabase);
  const ensureColumns = useSchemaStore((s) => s.ensureColumns);

  // ── Query builder state ────────────────────────────────
  const selectedTables = useQueryBuilderStore((s) => s.selectedTables);
  const selectedColumns = useQueryBuilderStore((s) => s.selectedColumns);
  const joins = useQueryBuilderStore((s) => s.joins);
  const autoJoins = useQueryBuilderStore((s) => s.autoJoins);
  const tableAliases = useQueryBuilderStore((s) => s.tableAliases);
  const tablePositions = useQueryBuilderStore((s) => s.tablePositions);
  const zoom = useQueryBuilderStore((s) => s.zoom);
  const where = useQueryBuilderStore((s) => s.where);
  const orderBy = useQueryBuilderStore((s) => s.orderBy);
  const groupBy = useQueryBuilderStore((s) => s.groupBy);
  const distinct = useQueryBuilderStore((s) => s.distinct);
  const limit = useQueryBuilderStore((s) => s.limit);
  const offset = useQueryBuilderStore((s) => s.offset);
  const bottomTab = useQueryBuilderStore((s) => s.bottomTab);
  const canvasCollapsed = useQueryBuilderStore((s) => s.canvasCollapsed);

  // ── Query builder actions ──────────────────────────────
  const toggleTable = useQueryBuilderStore((s) => s.toggleTable);
  const toggleColumn = useQueryBuilderStore((s) => s.toggleColumn);
  const setAllColumns = useQueryBuilderStore((s) => s.setAllColumns);
  const removeTable = useQueryBuilderStore((s) => s.removeTable);
  const updateColumnConfig = useQueryBuilderStore((s) => s.updateColumnConfig);
  const setTableAlias = useQueryBuilderStore((s) => s.setTableAlias);
  const updateTablePosition = useQueryBuilderStore((s) => s.updateTablePosition);
  const setZoom = useQueryBuilderStore((s) => s.setZoom);
  const setDistinct = useQueryBuilderStore((s) => s.setDistinct);
  const reset = useQueryBuilderStore((s) => s.reset);
  const addCondition = useQueryBuilderStore((s) => s.addCondition);
  const updateCondition = useQueryBuilderStore((s) => s.updateCondition);
  const removeCondition = useQueryBuilderStore((s) => s.removeCondition);
  const addConditionGroup = useQueryBuilderStore((s) => s.addConditionGroup);
  const setGroupLogic = useQueryBuilderStore((s) => s.setGroupLogic);
  const setLimit = useQueryBuilderStore((s) => s.setLimit);
  const setOffset = useQueryBuilderStore((s) => s.setOffset);
  const setBottomTab = useQueryBuilderStore((s) => s.setBottomTab);
  const toggleCanvasCollapsed = useQueryBuilderStore((s) => s.toggleCanvasCollapsed);
  const hasChanges = useQueryBuilderStore((s) => s.hasChanges);

  // ── Local UI state ─────────────────────────────────────
  const [conflictOpen, setConflictOpen] = useState(false);
  const [confirmDiscard, confirmDiscardDialog] = useConfirmDialog();

  // Bottom region height (dragging the splitter up grows it → reverse).
  const { size: bottomHeight, handleRef: splitterRef } = useResizable({
    direction: 'vertical',
    initialSize: 300,
    minSize: BOTTOM_MIN,
    maxSize: BOTTOM_MAX,
    storageKey: 'qb-split-height',
    reverse: true,
  });

  // ── Load columns for selected tables ───────────────────
  useEffect(() => {
    if (selectedTables.length === 0) return;
    void ensureColumns(selectedTables, dbSessionId, currentDatabase ?? '');
  }, [selectedTables, ensureColumns, dbSessionId, currentDatabase]);

  // ── Foreign key detection ──────────────────────────────
  const [fkRelations, setFkRelations] = useState<ForeignKeyRelation[]>([]);

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
          const schema = await getCachedTableSchema(dbSessionId, tableName, currentDatabase ?? '');
          for (const fk of schema.foreignKeys) {
            // Composite keys are normalised to their ordered distinct columns
            // before pairing positionally: `information_schema` reports the two
            // sides of a key as independent aggregates, so an N-column FK can
            // arrive with N² entries ([pa, pa, pb, pb] vs [a, b, a, b]) and
            // pairing those index-wise yields a cartesian product — a JOIN with
            // four predicates for a two-column key.
            //
            // The Postgres driver now guarantees the collapsed shape, but the
            // guard stays here: the host must not depend on every driver being
            // correct. If the sides still disagree the FK is skipped rather than
            // guessed at.
            const fromColumns = Array.from(new Set(fk.columns));
            const toColumns = Array.from(new Set(fk.referencedColumns));
            if (fromColumns.length === 0 || fromColumns.length !== toColumns.length) continue;

            for (let i = 0; i < fromColumns.length; i += 1) {
              const fromColumn = fromColumns[i]!;
              const toColumn = toColumns[i]!;
              allFks.push({
                fromTable: tableName,
                fromColumn,
                toTable: fk.referencedTable,
                toColumn,
                constraint: fk.name,
                ordinal: i + 1,
                pairCount: fromColumns.length,
              });
            }
          }
        } catch {
          // Schema unavailable for this table — draw no relation for it.
        }
      }
      console.log('All FK relations:', allFks);
      if (!cancelled) {
        setFkRelations(allFks);
      }
    };
    void loadFks();
    return () => {
      cancelled = true;
    };
  }, [selectedTables, dbSessionId, currentDatabase]);

  /**
   * One entry per constraint (or manual join) — the canvas draws exactly this,
   * so a composite FK becomes one trunk instead of several stray lines.
   */
  const relationGroups = useMemo(
    () => buildRelationGroups({ joins, fkRelations, selectedTables }),
    [joins, fkRelations, selectedTables],
  );

  /** Re-type every confirmed pair of a group (or the single manual join). */
  const handleSetGroupType = useCallback((groupId: string, type: QbJoinType) => {
    const state = useQueryBuilderStore.getState();
    if (groupId.startsWith(MANUAL_PREFIX)) {
      state.updateJoinType(groupId.slice(MANUAL_PREFIX.length), type);
      return;
    }
    for (const join of state.joins) {
      if (join.constraint === groupId) state.updateJoinType(join.id, type);
    }
  }, []);

  const handleConfirmGroup = useCallback((groupId: string) => {
    useQueryBuilderStore.getState().confirmConstraintGroup(groupId);
  }, []);

  const handleRemoveGroup = useCallback((groupId: string) => {
    const state = useQueryBuilderStore.getState();
    if (groupId.startsWith(MANUAL_PREFIX)) {
      state.removeJoin(groupId.slice(MANUAL_PREFIX.length));
      return;
    }
    if (groupId.startsWith('join:')) {
      state.removeJoin(groupId.slice('join:'.length));
      return;
    }
    state.removeConstraintGroup(groupId);
  }, []);

  /** Manual joins are created by dragging between two columns. */
  const handleAddManualJoin = useCallback(
    (from: { table: string; column: string }, to: { table: string; column: string }) => {
      // A self join cannot be expressed, so it is refused rather than created
      // only to be reported as a validation error.
      if (from.table === to.table) return;
      useQueryBuilderStore.getState().addJoin({
        type: 'INNER',
        leftTable: from.table,
        leftColumn: from.column,
        rightTable: to.table,
        rightColumn: to.column,
        isManual: true,
      });
    },
    [],
  );

  const detectedAutoJoins = useAutoJoin(selectedTables, fkRelations);

  // Sync auto-detected joins to store
  useEffect(() => {
    const existing = useQueryBuilderStore.getState().autoJoins;
    const currentAutoIds = new Set(existing.map((j) => j.id));
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
  const sqlInput = useMemo(
    () => ({
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
    }),
    [
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
    ],
  );

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

  /**
   * Problems the generator would otherwise paper over with plausible-looking
   * SQL (`col = NULL`, `IN ()`, dropped pagination). Anything with
   * `severity: 'error'` blocks OK and is listed in the Preview tab.
   */
  const diagnostics: QbDiagnostic[] = useMemo(() => validateQuery(sqlInput), [sqlInput]);
  const blockingDiagnostics = diagnostics.filter((d) => d.severity === 'error');
  // A generation problem surfaces as a dot on the Build tab (PRD F-05.4).
  const hasBuildError = diagnostics.length > 0;

  // ── Commit / cancel ────────────────────────────────────

  const handleOk = useCallback(() => {
    if (!sql) return;
    const editorSql = currentSql.trim();
    // Editor empty → write straight through.
    if (!editorSql) {
      onCommit(sql, 'replace');
      return;
    }
    // Already identical → nothing to change, just close and focus.
    if (editorSql === sql.trim()) {
      onCommit(null, 'replace');
      return;
    }
    // Different content → never overwrite silently.
    setConflictOpen(true);
  }, [sql, currentSql, onCommit]);

  const handleConflictChoice = useCallback(
    (choice: CommitConflictChoice) => {
      setConflictOpen(false);
      if (choice === 'keep') return;
      onCommit(sql, choice);
    },
    [sql, onCommit],
  );

  const handleCancel = useCallback(async () => {
    if (hasChanges()) {
      const ok = await confirmDiscard({
        title: t('query.visualBuilder.confirmDiscardTitle'),
        message: t('query.visualBuilder.confirmDiscardMessage'),
        confirmLabel: t('query.visualBuilder.discard'),
        cancelLabel: t('query.visualBuilder.keepEditing'),
        kind: 'warning',
      });
      if (!ok) return;
    }
    onCancel();
  }, [hasChanges, confirmDiscard, t, onCancel]);

  // ── Keyboard shortcuts (only while the builder is visible) ──
  const okRef = useRef(handleOk);
  okRef.current = handleOk;
  const cancelRef = useRef(handleCancel);
  cancelRef.current = handleCancel;
  const conflictRef = useRef(conflictOpen);
  conflictRef.current = conflictOpen;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (conflictRef.current) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        okRef.current();
        return;
      }
      if (mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleCanvasCollapsed();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        void cancelRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleCanvasCollapsed]);

  // ── Handlers ───────────────────────────────────────────

  const handleRemoveColumn = useCallback(
    (table: string, column: string) => {
      toggleColumn(table, column);
    },
    [toggleColumn],
  );

  /** Add the first column of a selected table that is not already in the query. */
  const handleAddColumn = useCallback(() => {
    for (const table of selectedTables) {
      const cols = columnMap[table] ?? [];
      const next = cols.find(
        (c) => !selectedColumns.some((s) => s.table === table && s.column === c),
      );
      if (next) {
        toggleColumn(table, next);
        return;
      }
    }
  }, [selectedTables, selectedColumns, columnMap, toggleColumn]);

  const handleDropTable = useCallback(
    (tableName: string, pos: { x: number; y: number }) => {
      if (!useQueryBuilderStore.getState().selectedTables.includes(tableName)) {
        toggleTable(tableName);
      }
      updateTablePosition(tableName, pos);
    },
    [toggleTable, updateTablePosition],
  );

  const okDisabled = !sql || blockingDiagnostics.length > 0;
  const showNoRelationHint =
    selectedTables.length >= 2 && joins.length === 0 && autoJoins.length === 0;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col border-b border-edge bg-surface"
      data-testid="qb-panel"
      data-qb-panel-id={panelId}
    >
      {confirmDiscardDialog}

      {/* ── Header ─────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2"
        data-testid="qb-panel-header"
      >
        <div className="flex items-center gap-2">
          <Blocks className="h-4 w-4 text-accent" />
          <span className="text-[13px] font-semibold text-fg">
            {t('query.visualBuilder.panelTitle')}
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
            onClick={toggleCanvasCollapsed}
            title={
              canvasCollapsed
                ? t('query.visualBuilder.canvasExpand')
                : t('query.visualBuilder.canvasCollapse')
            }
            className="flex items-center justify-center rounded px-2 py-0.5 text-fg-muted hover:bg-surface-raised hover:text-fg"
            data-testid="qb-toggle-canvas"
          >
            {canvasCollapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleCancel()}
            title={t('query.visualBuilder.close')}
            className="flex items-center justify-center rounded px-2 py-0.5 text-fg-muted hover:bg-surface-raised hover:text-fg"
            data-testid="qb-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Canvas region (collapsible) ─────────────────── */}
      {!canvasCollapsed && (
        <>
          <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="qb-canvas-region">
            {showNoRelationHint && (
              <div
                className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-warning/15 px-2 py-1 text-[11px] text-warning"
                data-testid="qb-no-relation-hint"
              >
                {t('query.visualBuilder.noRelationHint')}
              </div>
            )}
            <DiagramCanvas
              selectedTables={selectedTables}
              tablePositions={tablePositions}
              relationGroups={relationGroups}
              columnMap={columnMap}
              columnInfoMap={columnInfoMap}
              selectedColumns={selectedColumns}
              tableAliases={tableAliases}
              onToggleColumn={toggleColumn}
              onToggleAllColumns={setAllColumns}
              onRemoveTable={removeTable}
              onUpdatePosition={updateTablePosition}
              onSetGroupType={handleSetGroupType}
              onConfirmGroup={handleConfirmGroup}
              onRemoveGroup={handleRemoveGroup}
              onAddManualJoin={handleAddManualJoin}
              onSetTableAlias={setTableAlias}
              onDropTable={handleDropTable}
              zoom={zoom}
              onZoomChange={setZoom}
            />
          </div>

          <div
            ref={splitterRef}
            className="h-1.5 shrink-0 cursor-row-resize bg-transparent transition-colors hover:bg-accent/30 active:bg-accent/40"
            title={t('query.visualBuilder.splitResize')}
            data-testid="qb-splitter"
          />
        </>
      )}

      {/* ── Bottom tabs region ─────────────────────────── */}
      <div
        className={cn(
          'flex min-h-0 flex-col overflow-hidden border-t border-edge',
          canvasCollapsed && 'flex-1',
        )}
        style={canvasCollapsed ? undefined : { height: bottomHeight }}
        data-testid="qb-bottom-region"
      >
        <QueryBuilderBottomTabs
          tab={bottomTab}
          onTabChange={setBottomTab}
          hasBuildError={hasBuildError}
          buildContent={
            <div className="flex flex-col" data-testid="qb-build-region">
              {/* LIMIT / OFFSET live in the build tab: they were store-only
                  before, which meant no user could actually reach them. */}
              <div
                className="sticky top-0 z-10 flex items-center gap-2 border-b border-edge bg-surface px-3 py-2"
                data-testid="qb-pagination"
              >
                <label className="flex items-center gap-1.5 text-[11px] text-fg-secondary">
                  {t('query.visualBuilder.limit')}
                  <input
                    type="number"
                    min={0}
                    value={limit ?? ''}
                    onChange={(e) =>
                      setLimit(e.target.value.trim() === '' ? null : Number(e.target.value))
                    }
                    className="h-7 w-20 rounded-[9px] border border-edge bg-surface-inset px-2 text-xs text-fg outline-none focus:border-accent"
                    data-testid="qb-limit-input"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-fg-secondary">
                  {t('query.visualBuilder.offset')}
                  <input
                    type="number"
                    min={0}
                    value={offset ?? ''}
                    onChange={(e) =>
                      setOffset(e.target.value.trim() === '' ? null : Number(e.target.value))
                    }
                    className="h-7 w-20 rounded-[9px] border border-edge bg-surface-inset px-2 text-xs text-fg outline-none focus:border-accent"
                    data-testid="qb-offset-input"
                  />
                </label>
              </div>

              <CriteriaGrid
                selectedColumns={selectedColumns}
                allTables={selectedTables}
                allColumns={columnMap}
                tableAliases={tableAliases}
                onUpdateColumn={updateColumnConfig}
                onRemoveColumn={handleRemoveColumn}
                onAddColumn={handleAddColumn}
              />
              <WhereClauseEditor
                where={where}
                allTables={selectedTables}
                allColumns={columnMap}
                tableAliases={tableAliases}
                onAddCondition={addCondition}
                onUpdateCondition={updateCondition}
                onRemoveCondition={removeCondition}
                onAddGroup={addConditionGroup}
                onSetGroupLogic={setGroupLogic}
              />
            </div>
          }
          previewContent={
            <div className="flex min-h-0 flex-1 flex-col" data-testid="qb-preview-region">
              {diagnostics.length > 0 && (
                <ul
                  className="shrink-0 border-b border-edge bg-danger/10 px-3 py-2 text-[11px] text-danger"
                  data-testid="qb-diagnostics"
                >
                  {diagnostics.map((d) => (
                    <li key={`${d.code}-${d.detail ?? ''}`} data-diagnostic-code={d.code}>
                      {t(`query.visualBuilder.diag.${d.messageKey}`)}
                      {d.detail ? ` — ${d.detail}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <SqlPreview sql={sql} databaseType={databaseType} />
            </div>
          }
        />
      </div>

      {/* ── Footer (always visible, never scrolls) ─────── */}
      <div
        className="flex shrink-0 items-center justify-end gap-2 border-t border-edge bg-surface px-3 py-2"
        data-testid="qb-footer"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleCancel()}
          data-testid="qb-cancel"
        >
          {t('query.visualBuilder.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleOk}
          disabled={okDisabled}
          title={
            blockingDiagnostics.length > 0
              ? t(`query.visualBuilder.diag.${blockingDiagnostics[0]!.messageKey}`)
              : okDisabled
                ? t('query.visualBuilder.okDisabledHint')
                : undefined
          }
          data-testid="qb-ok"
        >
          {t('query.visualBuilder.ok')}
        </Button>
      </div>

      <CommitConflictDialog open={conflictOpen} onChoose={handleConflictChoice} />
    </div>
  );
}
