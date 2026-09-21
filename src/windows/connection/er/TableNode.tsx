import { memo, Fragment, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { useI18n } from '../../../hooks/useI18n';

interface TableNodeData {
  tableName: string;
  columns: { name: string; type: string; isPk: boolean; isFk: boolean }[];
  highlighted?: boolean;
  dimmed?: boolean;
  collapsed?: boolean;
  [key: string]: unknown;
}

/**
 * Connection points are per column, not per table: a relationship is a statement
 * about two columns, and a line that lands on the node's vertical centre reads as
 * a claim about whatever row happens to sit there.
 */
export const TableNode = memo(function TableNode({ id, data }: NodeProps) {
  const { t } = useI18n();
  const { tableName, columns, highlighted, dimmed, collapsed } = data as unknown as TableNodeData;
  const updateNodeInternals = useUpdateNodeInternals();
  const handleClass =
    '!w-1.5 !h-1.5 !bg-accent opacity-0 transition-opacity group-hover:opacity-100';

  // React Flow measures handles once; collapsing a table or scrolling its column
  // list moves every connection point, and stale bounds leave the lines pointing
  // at rows they no longer touch.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, collapsed, columns.length, updateNodeInternals]);

  return (
    <div
      data-testid="er-table-node"
      className={cn(
        'group relative min-w-[180px] max-w-[280px] rounded-lg border shadow-md',
        highlighted ? 'border-accent bg-accent/5' : 'border-edge bg-surface',
        dimmed && 'opacity-30',
      )}
      style={{ WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}
    >
      <div
        className={cn(
          'flex items-center gap-1 rounded-t-lg px-3 py-2 text-xs font-semibold',
          highlighted ? 'bg-accent/15 text-accent' : 'bg-surface-alt text-fg',
        )}
      >
        <button
          type="button"
          className="shrink-0 opacity-60 hover:opacity-100"
          title={collapsed ? t('erDiagram.expand') : t('erDiagram.collapse')}
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('er-toggle-collapse', { detail: tableName }));
          }}
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <span className="truncate">{tableName}</span>
        <span className="ml-auto text-[10px] font-normal text-fg-muted">{columns.length}</span>
      </div>
      {!collapsed && (
        <div className="max-h-[300px] overflow-y-auto" onScroll={() => updateNodeInternals(id)}>
          {columns.map((col) => (
            <div
              key={col.name}
              className={cn(
                'relative flex items-center gap-2 border-t border-edge/50 px-3 py-1 text-[11px]',
                col.isPk && 'bg-yellow-500/5',
                col.isFk && 'bg-accent/5',
              )}
            >
              {col.isPk && (
                <span className="shrink-0 rounded bg-yellow-500/20 px-1 text-[9px] font-bold text-yellow-500">
                  PK
                </span>
              )}
              {col.isFk && (
                <span className="shrink-0 rounded bg-accent/20 px-1 text-[9px] font-bold text-accent">
                  FK
                </span>
              )}
              <span className="truncate text-fg">{col.name}</span>
              <span className="ml-auto shrink-0 text-fg-muted">{col.type}</span>
              <Handle
                type="target"
                id={`t:${col.name}`}
                position={Position.Left}
                className={handleClass}
              />
              <Handle
                type="source"
                id={`s:${col.name}`}
                position={Position.Right}
                className={handleClass}
              />
            </div>
          ))}
        </div>
      )}
      {collapsed && (
        <>
          <div className="border-t border-edge/50 px-3 py-1 text-[10px] text-fg-muted">
            {columns.length} {t('erDiagram.columns')}
          </div>
          {/* Collapsing hides the rows, but the connection points must survive it or
              every line into this table disappears with them. */}
          <div className="pointer-events-none absolute inset-0 opacity-0">
            {columns.map((col) => (
              <Fragment key={col.name}>
                <Handle type="target" id={`t:${col.name}`} position={Position.Left} />
                <Handle type="source" id={`s:${col.name}`} position={Position.Right} />
              </Fragment>
            ))}
          </div>
        </>
      )}
      {columns.length === 0 && (
        <>
          <Handle type="target" position={Position.Left} className={handleClass} />
          <Handle type="source" position={Position.Right} className={handleClass} />
        </>
      )}
    </div>
  );
});
