import { useCallback, useMemo } from 'react';
import { useResizable } from '../../hooks/useResizable';
import { usePanelStore, type Panel } from '../../stores/panelStore';
import { useTableDataStore } from '../../stores/tableDataStore';
import { DB_REGISTRY } from '../../lib/databaseTypes';
import { rowToRecord } from '../../lib/rowToRecord';
import type { ColumnDef } from '../../components/DataTable/TableHeader';
import { DetailPanel } from '../../components/DataTable/DetailPanel';
import { AiChatPanel } from '../../components/ai/AiChatPanel';
import type { ColumnSchema, DatabaseType } from '../../types';
import type { AiChatDraftRequest } from './query/aiDraftBridge';

const NO_COLUMNS: ColumnSchema[] = [];
const NO_ROWS: Record<string, unknown>[] = [];
const NO_SELECTED: Set<number> = new Set();

export interface ContentViewDrawersProps {
  activePanel: Panel | null;
  detailOpen: boolean;
  aiChatOpen: boolean;
  detailPanelApplicable: boolean;
  dbSessionId: string;
  currentDatabase: string | null;
  databaseType: DatabaseType | undefined;
  /** S3-B2: pending AI draft request from ContentView coordinator. */
  pendingDraftRequest: AiChatDraftRequest | null;
  /** S3-B2: called after AiChatPanel writes the draft to its textarea. */
  onDraftConsumed: (requestId: string) => void;
}

/**
 * Right-hand drawers for the connection workspace: the data-detail drawer
 * (`detailRow`) and the AI assistant sidebar (`aiChatOpen`), including the
 * resizable split handle. Pure render + state extraction from `ContentView` —
 * no behaviour change; the open state stays owned by `ContentView`.
 */
export function ContentViewDrawers({
  activePanel,
  detailOpen,
  aiChatOpen,
  detailPanelApplicable,
  dbSessionId,
  currentDatabase,
  databaseType,
  pendingDraftRequest,
  onDraftConsumed,
}: ContentViewDrawersProps) {
  const { size: aiSidebarWidth, handleRef: aiHandleRef } = useResizable({
    direction: 'horizontal',
    initialSize: 320,
    minSize: 240,
    maxSize: 600,
    reverse: true,
    storageKey: 'connection.aiSidebar',
  });

  const detailPanelId =
    activePanel && (activePanel.type === 'table' || activePanel.type === 'view')
      ? activePanel.id
      : null;
  const tableSlice = useTableDataStore((s) =>
    detailPanelId ? s.byPanel.get(detailPanelId) : undefined,
  );
  const tableColumns = tableSlice?.columns ?? NO_COLUMNS;
  const tableRows = tableSlice?.rows ?? NO_ROWS;
  const selectedRows = tableSlice?.selectedRows ?? NO_SELECTED;
  const detailRowIndex = tableSlice?.detailRowIndex ?? null;

  const activeQueryExec = usePanelStore((s) =>
    activePanel?.type === 'query' ? s.queryExec.get(activePanel.id) : undefined,
  );
  const updateResultCell = usePanelStore((s) => s.updateResultCell);
  const updateQuerySql = usePanelStore((s) => s.updateSql);

  const activeQueryResult =
    activeQueryExec && activeQueryExec.results.length > 0
      ? (activeQueryExec.results[activeQueryExec.activeResultIdx] ?? null)
      : null;
  const resultDetailRowIndex = activeQueryExec?.resultDetailRowIndex ?? null;

  const detailColumnDefs: ColumnDef[] = useMemo(() => {
    if (activePanel?.type === 'table') {
      return tableColumns.map((c) => ({ id: c.name, name: c.name, type: c.dataType }));
    }
    if (activeQueryResult) {
      return activeQueryResult.columns.map((c) => ({
        id: c.name,
        name: c.name,
        type: c.dataType,
      }));
    }
    return [];
  }, [activePanel?.type, tableColumns, activeQueryResult]);

  const detailRowIdx = activePanel?.type === 'table' ? detailRowIndex : resultDetailRowIndex;

  const detailRow: Record<string, unknown> | null = useMemo(() => {
    if (activePanel?.type === 'table') {
      return detailRowIndex !== null && detailRowIndex < tableRows.length
        ? tableRows[detailRowIndex]
        : null;
    }
    if (
      activeQueryResult &&
      resultDetailRowIndex !== null &&
      resultDetailRowIndex < activeQueryResult.rows.length
    ) {
      return rowToRecord(activeQueryResult.rows[resultDetailRowIndex], activeQueryResult.columns);
    }
    return null;
  }, [activePanel?.type, detailRowIndex, tableRows, activeQueryResult, resultDetailRowIndex]);

  const handleDetailFieldEdit = useCallback(
    (row: number, col: string, value: unknown) => {
      const store = useTableDataStore.getState();
      if (activePanel?.type === 'table') {
        if (selectedRows.size > 1) {
          store.applyColumnToRows(activePanel.id, col, value, [...selectedRows]);
        } else {
          store.stageCellChange(activePanel.id, row, col, value);
        }
      } else if (activePanel?.type === 'query' && activeQueryExec) {
        updateResultCell(activePanel.id, activeQueryExec.activeResultIdx, row, col, value);
      }
    },
    [activePanel, activeQueryExec, updateResultCell, selectedRows],
  );

  return (
    <>
      {detailPanelApplicable && (
        <DetailPanel
          open={detailOpen}
          columns={detailColumnDefs}
          row={detailRow}
          rowIndex={detailRowIdx}
          selectedRows={
            activePanel?.type === 'table' || activePanel?.type === 'view' ? selectedRows : undefined
          }
          editable
          onFieldEdit={handleDetailFieldEdit}
        />
      )}

      {aiChatOpen && dbSessionId && (
        <>
          <div
            ref={aiHandleRef}
            className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-accent/30"
          />
          <aside
            style={{ width: aiSidebarWidth }}
            className="shrink-0 border-l border-edge bg-surface"
          >
            <AiChatPanel
              dbSessionId={dbSessionId}
              database={currentDatabase ?? undefined}
              sqlDialect={databaseType ? DB_REGISTRY[databaseType]?.sqlDialect : undefined}
              onInsertSql={(sql) => {
                if (activePanel?.type === 'query') {
                  updateQuerySql(activePanel.id, sql);
                }
              }}
              draftRequest={pendingDraftRequest}
              onDraftConsumed={onDraftConsumed}
            />
          </aside>
        </>
      )}
    </>
  );
}
