import { useCallback, useRef } from 'react';
import { cn } from '@datazen/ui';
import type { ColumnInfo } from '../../../types';
import { useI18n } from '../../../hooks/useI18n';

/** A single table card rendered on the diagram canvas. */
export interface TableCardProps {
  tableName: string;
  alias?: string;
  columns: ColumnInfo[];
  /** Column names that are currently selected (checked). */
  selectedColumns: string[];
  /** Primary key column names (optional, derived from schema). */
  primaryKeyColumns?: string[];
  /** Map of column name → foreign key target table (optional). */
  foreignKeyMap?: Record<string, string>;
  position: { x: number; y: number };
  onToggleColumn: (column: string) => void;
  /** Click a column name to start / complete a manual column-to-column JOIN. */
  onClickColumn: (column: string) => void;
  /** Column currently armed as the JOIN anchor, if any. */
  joinAnchorColumn?: string | null;
  onDragEnd: (pos: { x: number; y: number }) => void;
  onSetAlias: (alias: string) => void;
}

export function TableCard({
  tableName,
  alias,
  columns,
  selectedColumns,
  primaryKeyColumns = [],
  foreignKeyMap = {},
  position,
  onToggleColumn,
  onClickColumn,
  joinAnchorColumn = null,
  onDragEnd,
  onSetAlias,
}: TableCardProps) {
  const { t } = useI18n();
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      // Only initiate drag from the handle area
      if (!(e.target as HTMLElement).dataset.dragHandle) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPosX: position.x,
        startPosY: position.y,
      };
    },
    [position.x, position.y],
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      onDragEnd({
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      });
    },
    [onDragEnd],
  );

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  const selectedSet = new Set(selectedColumns);

  return (
    <div
      className={cn(
        'absolute min-w-[200px] max-w-[280px] select-none',
        'bg-surface-raised border border-edge rounded-lg shadow-lg',
        'text-fg',
      )}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        willChange: 'transform',
      }}
      data-table={tableName}
    >
      {/* Table header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-edge">
        <span className="text-[13px] font-semibold truncate">{tableName}</span>
        <input
          type="text"
          value={alias ?? ''}
          onChange={(e) => onSetAlias(e.target.value)}
          placeholder={t('query.visualBuilder.alias')}
          className={cn(
            'ml-auto w-16 h-5 px-1.5 text-[11px] rounded border border-edge bg-surface-inset',
            'text-fg placeholder:text-fg-muted outline-none',
            'focus:border-accent focus:ring-1 focus:ring-accent-ring',
          )}
          data-testid={`qb-alias-${tableName}`}
        />
      </div>

      {/* Column list */}
      <div className="px-2 py-1 max-h-[240px] overflow-y-auto">
        {columns.map((col) => {
          const isPk = primaryKeyColumns.includes(col.name);
          const fkTarget = foreignKeyMap[col.name];
          const isAnchor = joinAnchorColumn === col.name;
          return (
            <div
              key={col.name}
              className={cn(
                'flex items-center gap-2 py-[3px] text-[12px] rounded px-1 -mx-1',
                isAnchor && 'bg-accent/15 ring-1 ring-accent',
              )}
              data-testid={`qb-col-${tableName}-${col.name}`}
            >
              <input
                type="checkbox"
                checked={selectedSet.has(col.name)}
                onChange={() => onToggleColumn(col.name)}
                aria-label={col.name}
                className="accent-accent h-3.5 w-3.5 shrink-0"
                data-testid={`qb-col-check-${tableName}-${col.name}`}
              />
              <button
                type="button"
                onClick={() => onClickColumn(col.name)}
                title={t('query.visualBuilder.joinColumnHint')}
                aria-pressed={isAnchor}
                className="min-w-0 flex-1 truncate text-left cursor-pointer hover:text-accent"
                data-testid={`qb-col-join-${tableName}-${col.name}`}
              >
                {col.name}
              </button>
              <span className="text-fg-muted text-[10px] shrink-0">{col.dataType}</span>
              {isPk && (
                <span className="shrink-0 inline-flex items-center rounded px-1 py-0 text-[9px] font-semibold bg-amber-500/20 text-amber-400">
                  PK
                </span>
              )}
              {fkTarget && (
                <span className="shrink-0 inline-flex items-center rounded px-1 py-0 text-[9px] font-semibold bg-blue-500/20 text-blue-400">
                  FK
                </span>
              )}
            </div>
          );
        })}
        {columns.length === 0 && (
          <div className="py-2 text-[11px] text-fg-muted text-center">
            {t('query.visualBuilder.noColumns')}
          </div>
        )}
      </div>

      {/* Drag handle */}
      <div
        data-drag-handle="true"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        className="px-3 py-1.5 border-t border-edge cursor-grab text-fg-muted text-center text-[11px] select-none active:cursor-grabbing"
        data-testid={`qb-drag-${tableName}`}
      >
        ⋮⋮
      </div>
    </div>
  );
}
