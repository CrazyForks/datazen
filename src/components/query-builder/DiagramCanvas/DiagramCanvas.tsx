import { useCallback, useMemo, useRef } from 'react';
import { cn } from '@datazen/ui';
import { Table2 } from 'lucide-react';
import type { ColumnInfo } from '../../../types';
import type { QbJoin, QbJoinType, QbColumnSelection } from '../types';
import { useCanvasInteraction } from './useCanvasInteraction';
import { TableCard } from './TableCard';
import { JoinLine } from './JoinLine';
import { FKLine } from './FKLine';
import { alignDroppedCard } from './cardLayout';

/** Foreign key relationship between two columns. */
export interface ForeignKeyRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

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
  /** All foreign key relationships between selected tables. */
  foreignKeyRelations?: ForeignKeyRelation[];
  onToggleColumn: (table: string, column: string) => void;
  /** Check/uncheck every column of a card. */
  onToggleAllColumns?: (table: string, columns: string[], selected: boolean) => void;
  /** Remove a table (and its references) from the query. */
  onRemoveTable?: (table: string) => void;
  onUpdatePosition: (table: string, pos: { x: number; y: number }) => void;
  onAddJoin: (join: Omit<QbJoin, 'id'>) => void;
  onUpdateJoinType: (id: string, type: QbJoinType) => void;
  onRemoveJoin: (id: string) => void;
  /** Promote an auto-detected FK candidate into the SQL (PRD F-03.2). */
  onConfirmJoin?: (id: string) => void;
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
  foreignKeyRelations = [],
  onToggleColumn,
  onToggleAllColumns,
  onRemoveTable,
  onUpdatePosition,
  onAddJoin: _onAddJoin,
  onUpdateJoinType,
  onRemoveJoin,
  onConfirmJoin,
  onSetTableAlias,
  onDropTable,
  zoom: storeZoom = 1,
  canvasOffset: storeOffset = { x: 0, y: 0 },
  onZoomChange = () => {},
  onOffsetChange = () => {},
}: DiagramCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    zoom,
    canvasOffset,
    handleZoom,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isPanning,
  } = useCanvasInteraction(storeZoom, storeOffset, onZoomChange, onOffsetChange);

  // Handle drop from app schema tree (application/datazen-schema-object MIME)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!containerRef.current || !onDropTable) return;

      const raw = e.dataTransfer.getData('application/datazen-schema-object');
      if (!raw) return;
      try {
        const payload = JSON.parse(raw) as { namespace?: { table?: string } };
        const tableName = payload.namespace?.table;
        if (!tableName) return;
        const rect = containerRef.current.getBoundingClientRect();
        const dropped = {
          x: (e.clientX - rect.left - canvasOffset.x) / zoom,
          y: (e.clientY - rect.top - canvasOffset.y) / zoom,
        };
        // Snap to the grid and share the top edge of the row being dropped
        // into, so dragging several tables in does not leave their tops askew.
        onDropTable(tableName, alignDroppedCard(dropped, tablePositions));
      } catch {
        // invalid payload — ignore
      }
    },
    [canvasOffset, zoom, onDropTable, tablePositions],
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
                onConfirm={() => onConfirmJoin?.(join.id)}
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

        {/* SVG layer for FK connecting lines */}
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{ width: '100%', height: '100%', overflow: 'visible' }}
          aria-hidden="true"
        >
          {foreignKeyRelations.map((fk) => {
            const fromPos = tablePositions[fk.fromTable];
            const toPos = tablePositions[fk.toTable];
            if (!fromPos || !toPos) return null;
            if (!selectedSet.has(fk.fromTable) || !selectedSet.has(fk.toTable)) return null;

            // Find column indices from columnInfoMap (more reliable)
            const fromColInfo = columnInfoMap[fk.fromTable] ?? [];
            const toColInfo = columnInfoMap[fk.toTable] ?? [];
            const fromIndex = fromColInfo.findIndex((c) => c.name === fk.fromColumn);
            const toIndex = toColInfo.findIndex((c) => c.name === fk.toColumn);
            if (fromIndex === -1 || toIndex === -1) return null;

            return (
              <FKLine
                key={`fk-${fk.fromTable}.${fk.fromColumn}-${fk.toTable}.${fk.toColumn}`}
                fromTable={fk.fromTable}
                fromColumn={fk.fromColumn}
                toTable={fk.toTable}
                toColumn={fk.toColumn}
                fromCardPos={fromPos}
                toCardPos={toPos}
                fromColumnIndex={fromIndex}
                toColumnIndex={toIndex}
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
            .filter((sc) => sc.table === table)
            .map((sc) => sc.column);

          return (
            <TableCard
              key={table}
              tableName={table}
              alias={tableAliases[table]}
              columns={effectiveColumns}
              selectedColumns={tableSelectedCols}
              primaryKeyColumns={primaryKeyMap[table]}
              position={pos}
              otherPositions={tablePositions}
              onToggleColumn={(col) => onToggleColumn(table, col)}
              onToggleAllColumns={(selected) => onToggleAllColumns?.(table, columnNames, selected)}
              onRemove={() => onRemoveTable?.(table)}
              onDragEnd={(newPos) => onUpdatePosition(table, newPos)}
              onSetAlias={(alias) => onSetTableAlias(table, alias)}
            />
          );
        })}

        {/* Empty state hint */}
        {selectedTables.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-fg-muted text-sm">
              <Table2 className="mb-1 size-8 opacity-30" />
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
