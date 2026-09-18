import { useState, useCallback } from 'react';
import { ChevronRight, Database, Table, Eye } from 'lucide-react';
import { cn } from '@datazen/ui';

export interface ObjectTreePanelProps {
  dbSessionId: string;
  tables: Array<{ name: string; type: 'table' | 'view' }>;
  selectedTables: string[];
  onAddTable: (tableName: string) => void;
}

/**
 * Left-side panel (200px) displaying database objects in a tree structure.
 *
 * Tree: Schema → Tables / Views
 * - Table nodes are draggable (drag → canvas adds the table).
 * - Selected tables are highlighted.
 * - Clicking a table toggles its selection.
 */
export function ObjectTreePanel({
  dbSessionId: _dbSessionId,
  tables,
  selectedTables,
  onAddTable,
}: ObjectTreePanelProps) {
  const [expanded, setExpanded] = useState(true);
  const selectedSet = new Set(selectedTables);

  const tableItems = tables.filter((t) => t.type === 'table');
  const viewItems = tables.filter((t) => t.type === 'view');

  const toggleExpand = useCallback(() => setExpanded((prev) => !prev), []);

  const handleDragStart = useCallback((e: React.DragEvent, tableName: string) => {
    e.dataTransfer.setData('table', tableName);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleClick = useCallback(
    (tableName: string) => {
      onAddTable(tableName);
    },
    [onAddTable],
  );

  return (
    <div
      className="flex w-[200px] shrink-0 flex-col overflow-hidden border-r border-edge bg-surface"
      data-testid="object-tree-panel"
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-edge px-3 py-2">
        <Database className="h-3.5 w-3.5 text-fg-muted" />
        <span className="text-xs font-medium text-fg-secondary">Database Objects</span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {/* Schema node (collapsible) */}
        <button
          type="button"
          onClick={toggleExpand}
          className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-surface-raised"
          data-testid="schema-node-toggle"
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-fg-muted transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <Database className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
          <span className="truncate text-xs">schema</span>
        </button>

        {expanded && (
          <div className="ml-2">
            {/* Tables section */}
            {tableItems.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                  Tables
                </div>
                {tableItems.map((table) => (
                  <div
                    key={table.name}
                    draggable
                    onDragStart={(e) => handleDragStart(e, table.name)}
                    onClick={() => handleClick(table.name)}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
                      'hover:bg-surface-raised',
                      selectedSet.has(table.name) ? 'bg-accent/10 text-accent' : 'text-fg',
                    )}
                    data-testid={`tree-table-${table.name}`}
                  >
                    <Table className="h-3 w-3 shrink-0 text-fg-muted" />
                    <span className="truncate">{table.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Views section */}
            {viewItems.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                  Views
                </div>
                {viewItems.map((view) => (
                  <div
                    key={view.name}
                    draggable
                    onDragStart={(e) => handleDragStart(e, view.name)}
                    onClick={() => handleClick(view.name)}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
                      'hover:bg-surface-raised',
                      selectedSet.has(view.name) ? 'bg-accent/10 text-accent' : 'text-fg',
                    )}
                    data-testid={`tree-view-${view.name}`}
                  >
                    <Eye className="h-3 w-3 shrink-0 text-fg-muted" />
                    <span className="truncate">{view.name}</span>
                  </div>
                ))}
              </div>
            )}

            {tableItems.length === 0 && viewItems.length === 0 && (
              <div className="px-2 py-3 text-xs text-fg-muted">No objects</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
