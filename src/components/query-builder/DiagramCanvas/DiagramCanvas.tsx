import { useCallback, useMemo, useRef } from 'react';
import { cn } from '@datazen/ui';
import type { ColumnInfo } from '../../../types';
import type { QbJoin, QbJoinType, QbColumnSelection } from '../types';
import { useCanvasInteraction } from './useCanvasInteraction';
import { TableCard } from './TableCard';
import { JoinLine } from './JoinLine';

/** Props for the DiagramCanvas component. */
export interface DiagramCanvasProps {
  selectedTables: string[];
  tablePositions: Record<string, { x: number; y: number }>;
  joins: QbJoin[];
  autoJoins: QbJoin[];
  columnMap: Record<string, string[]>;
  columnInfoMap: Record<string, ColumnInfo[]>;
  selectedColumns: QbColumnSelection[];
  tableAliases: Record<string, string>;
  /** Map of table → column names that are primary keys. */
  primaryKeyMap?: Record<string, string[]>;
  /** Map of table → { column → foreignKeyTargetTable }. */
  foreignKeyMap?: Record<string, Record<string, string>>;
  onToggleColumn: (table: string, column: string) => void;
  onUpdatePosition: (table: string, pos: { x: number; y: number }) => void;
  onAddJoin: (join: Omit<QbJoin, 'id'>) => void;
  onUpdateJoinType: (id: string, type: QbJoinType) => void;
  onRemoveJoin: (id: string) => void;
  onSetTableAlias: (table: string, alias: string) => void;
  /** Called when a table is dropped onto the canvas from the object tree. */
  onDropTable?: (tableName: string, pos: { x: number; y: number }) => void;
  /** Current zoom level (from store). */
  zoom?: number;
  /** Current canvas offset (from store). */
  canvasOffset?: { x: number; y: number };
  /** Callback when zoom changes. */
  onZoomChange?: (zoom: number) => void;
  /** Callback when canvas offset changes. */
  onOffsetChange?: (offset: { x: number; y: number }) => void;
}

/** Estimated card dimensions for computing center positions for join lines. */
const CARD_WIDTH = 220;
const CARD_HEIGHT_ESTIMATE = 160;

/**
 * DiagramCanvas — The main canvas component for the visual query builder.
 *
 * Uses a hybrid SVG + DOM approach:
 * - SVG layer for JOIN lines (bezier curves)
 * - DOM layer for TableCard components (positioned via CSS transform)
 * - Grid dot pattern background
 * - Zoom/pan via pointer events and wheel
 */
export function DiagramCanvas({
  selectedTables,
  tablePositions,
  joins,
  autoJoins,
  columnMap,
  columnInfoMap,
  selectedColumns,
  tableAliases,
  primaryKeyMap = {},
  foreignKeyMap = {},
  onToggleColumn,
  onUpdatePosition,
  onAddJoin: _onAddJoin,
  onUpdateJoinType,
  onRemoveJoin,
  onSetTableAlias,
  onDropTable,
  zoom: storeZoom = 1,
  canvasOffset: storeOffset = { x: 0, y: 0 },
  onZoomChange = () => {},
  onOffsetChange = () => {},
}: DiagramCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { zoom, canvasOffset, handleZoom, handlePointerDown, handlePointerMove, handlePointerUp, isPanning } =
    useCanvasInteraction(storeZoom, storeOffset, onZoomChange, onOffsetChange);

  // Handle drop from object tree
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const tableName = e.dataTransfer.getData('table');
      if (!tableName || !containerRef.current || !onDropTable) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - canvasOffset.x) / zoom;
      const y = (e.clientY - rect.top - canvasOffset.y) / zoom;
      onDropTable(tableName, { x, y });
    },
    [canvasOffset, zoom, onDropTable],
  );

  // Compute center positions for join lines
  const getCardCenter = useCallback(
    (table: string) => {
      const pos = tablePositions[table];
      if (!pos) return { x: 0, y: 0 };
      return {
        x: pos.x + CARD_WIDTH / 2,
        y: pos.y + CARD_HEIGHT_ESTIMATE / 2,
      };
    },
    [tablePositions],
  );

  const selectedSet = useMemo(() => {
    const set = new Set<string>();
    for (const t of selectedTables) {
      set.add(t);
    }
    return set;
  }, [selectedTables]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full h-full overflow-hidden bg-surface',
        isPanning ? 'cursor-grab' : 'cursor-default',
      )}
      onWheel={handleZoom}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-testid="qb-diagram-canvas"
    >
      {/* Grid dot pattern background */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
        <defs>
          <pattern
            id="qb-grid-dots"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${canvasOffset.x % 20} ${canvasOffset.y % 20})`}
          >
            <circle cx="10" cy="10" r="0.8" fill="var(--color-fg-muted)" opacity="0.25" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#qb-grid-dots)" />
      </svg>

      {/* Zoom + pan transform wrapper */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {/* SVG layer for JOIN lines */}
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{ width: '100%', height: '100%', overflow: 'visible' }}
          aria-hidden="true"
        >
          {/* Render auto-detected JOINs first (behind manual) */}
          {autoJoins.map((join) => {
            const from = getCardCenter(join.leftTable);
            const to = getCardCenter(join.rightTable);
            if (!selectedSet.has(join.leftTable) || !selectedSet.has(join.rightTable)) return null;
            return (
              <JoinLine
                key={join.id}
                join={join}
                fromPos={from}
                toPos={to}
                isAuto
                onUpdateType={(type) => onUpdateJoinType(join.id, type)}
                onRemove={() => onRemoveJoin(join.id)}
              />
            );
          })}

          {/* Render manual JOINs on top */}
          {joins.map((join) => {
            const from = getCardCenter(join.leftTable);
            const to = getCardCenter(join.rightTable);
            if (!selectedSet.has(join.leftTable) || !selectedSet.has(join.rightTable)) return null;
            return (
              <JoinLine
                key={join.id}
                join={join}
                fromPos={from}
                toPos={to}
                isAuto={false}
                onUpdateType={(type) => onUpdateJoinType(join.id, type)}
                onRemove={() => onRemoveJoin(join.id)}
              />
            );
          })}
        </svg>

        {/* DOM layer for table cards */}
        {selectedTables.map((table) => {
          const pos = tablePositions[table] ?? { x: 0, y: 0 };
          const columns = columnInfoMap[table] ?? [];
          // Fall back to columnMap if columnInfoMap doesn't have data
          const columnNames = columnMap[table] ?? [];
          const effectiveColumns =
            columns.length > 0
              ? columns
              : columnNames.map((name) => ({ name, dataType: '', nullable: true }));

          // Determine which columns are selected for this table
          const tableSelectedCols = selectedColumns
            .filter(sc => sc.table === table)
            .map(sc => sc.column);

          return (
            <TableCard
              key={table}
              tableName={table}
              alias={tableAliases[table]}
              columns={effectiveColumns}
              selectedColumns={tableSelectedCols}
              primaryKeyColumns={primaryKeyMap[table]}
              foreignKeyMap={foreignKeyMap[table]}
              position={pos}
              onToggleColumn={(col) => onToggleColumn(table, col)}
              onDragEnd={(newPos) => onUpdatePosition(table, newPos)}
              onSetAlias={(alias) => onSetTableAlias(table, alias)}
            />
          );
        })}

        {/* Empty state hint */}
        {selectedTables.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-fg-muted text-sm">
              <div className="mb-1 text-2xl opacity-30">📊</div>
              <div>Drag tables here to build your query</div>
            </div>
          </div>
        )}
      </div>

      {/* Zoom indicator */}
      <div className="absolute bottom-2 right-2 text-[10px] text-fg-muted bg-surface-alt/80 px-1.5 py-0.5 rounded pointer-events-none select-none">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}
