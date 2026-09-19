import { useCallback, useRef } from 'react';
import { cn } from '@datazen/ui';
import { X } from 'lucide-react';
import { useI18n } from '../../../hooks/useI18n';
import type { ColumnInfo } from '../../../types';
import { resolveDragPosition, type CardPositions } from './cardLayout';

/** A single table card rendered on the diagram canvas. */
export interface TableCardProps {
  tableName: string;
  alias?: string;
  columns: ColumnInfo[];
  /** Column names that are currently selected (checked). */
  selectedColumns: string[];
  /** Primary key column names (optional, derived from schema). */
  primaryKeyColumns?: string[];
  position: { x: number; y: number };
  /** Positions of every card, used to align this one while dragging. */
  otherPositions?: CardPositions;
  onToggleColumn: (column: string) => void;
  /** Check/uncheck every column at once. */
  onToggleAllColumns: (selected: boolean) => void;
  /** Remove the table (and everything referencing it) from the query. */
  onRemove: () => void;
  onDragEnd: (pos: { x: number; y: number }) => void;
  onSetAlias: (alias: string) => void;
}

/** Elements that must keep their own pointer behaviour inside a draggable card. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('input, button, select, textarea, a, label');
}

export function TableCard({
  tableName,
  alias,
  columns,
  selectedColumns,
  primaryKeyColumns = [],
  position,
  otherPositions = {},
  onToggleColumn,
  onToggleAllColumns,
  onRemove,
  onDragEnd,
  onSetAlias,
}: TableCardProps) {
  const { t } = useI18n();
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);

  const selectedSet = new Set(selectedColumns);
  const allSelected = columns.length > 0 && columns.every((c) => selectedSet.has(c.name));
  const someSelected = columns.some((c) => selectedSet.has(c.name));

  /**
   * Drag the whole card, not just a small grip: users reach for the header.
   * Pointer capture goes on the card itself so moves keep arriving even when the
   * cursor outruns the element.
   */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || isInteractiveTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const card = e.currentTarget as HTMLElement;
      card.setPointerCapture?.(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPosX: position.x,
        startPosY: position.y,
      };
    },
    [position.x, position.y],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const next = resolveDragPosition(
        {
          x: drag.startPosX + (e.clientX - drag.startX),
          y: drag.startPosY + (e.clientY - drag.startY),
        },
        otherPositions,
        tableName,
      );
      if (next.x !== position.x || next.y !== position.y) {
        onDragEnd(next);
      }
    },
    [onDragEnd, otherPositions, position.x, position.y, tableName],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    const card = e.currentTarget as HTMLElement;
    const drag = dragRef.current;
    if (drag && card.hasPointerCapture?.(drag.pointerId)) {
      card.releasePointerCapture(drag.pointerId);
    }
    dragRef.current = null;
  }, []);

  return (
    <div
      className={cn(
        'absolute min-w-[200px] max-w-[280px] select-none',
        'bg-surface-raised border border-edge rounded-lg shadow-lg',
        'text-fg cursor-grab active:cursor-grabbing',
      )}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        willChange: 'transform',
        touchAction: 'none',
      }}
      data-table={tableName}
      data-testid={`qb-drag-${tableName}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Table header */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-edge">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = !allSelected && someSelected;
          }}
          onChange={(e) => onToggleAllColumns(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          className="accent-accent h-3.5 w-3.5 shrink-0"
          title={t('query.visualBuilder.selectAllColumns')}
          aria-label={t('query.visualBuilder.selectAllColumns')}
          data-testid={`qb-selectall-${tableName}`}
        />
        <span className="truncate text-[13px] font-semibold" title={tableName}>
          {tableName}
        </span>
        <input
          type="text"
          value={alias ?? ''}
          onChange={(e) => onSetAlias(e.target.value)}
          placeholder={t('query.visualBuilder.alias')}
          className={cn(
            'ml-auto h-5 w-14 shrink-0 rounded border border-edge bg-surface-inset px-1.5 text-[11px]',
            'text-fg placeholder:text-fg-muted outline-none',
            'focus:border-accent focus:ring-1 focus:ring-accent-ring',
          )}
          title={t('query.visualBuilder.alias')}
          data-testid={`qb-alias-${tableName}`}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="shrink-0 rounded p-0.5 text-fg-muted transition-colors hover:bg-surface-inset hover:text-danger"
          title={t('query.visualBuilder.removeTable')}
          aria-label={t('query.visualBuilder.removeTable')}
          data-testid={`qb-remove-${tableName}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Column list */}
      <div className="max-h-[240px] overflow-y-auto px-2 py-1">
        {columns.map((col, idx) => {
          const isPk = primaryKeyColumns.includes(col.name);
          return (
            <label
              key={col.name}
              className="-mx-1 flex cursor-pointer items-center gap-2 rounded px-1 py-[3px] text-[12px] hover:bg-surface-inset"
              data-testid={`qb-col-${tableName}-${col.name}`}
              data-table={tableName}
              data-column={col.name}
              data-column-index={idx}
            >
              <input
                type="checkbox"
                checked={selectedSet.has(col.name)}
                onChange={() => onToggleColumn(col.name)}
                className="accent-accent h-3.5 w-3.5 shrink-0"
              />
              <span className="truncate">{col.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-fg-muted">{col.dataType}</span>
              {isPk && (
                <span className="inline-flex shrink-0 items-center rounded bg-amber-500/20 px-1 py-0 text-[9px] font-semibold text-amber-400">
                  PK
                </span>
              )}
            </label>
          );
        })}
        {columns.length === 0 && (
          <div className="py-2 text-center text-[11px] text-fg-muted">
            {t('query.visualBuilder.noColumns')}
          </div>
        )}
      </div>
    </div>
  );
}
