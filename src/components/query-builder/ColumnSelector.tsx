import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from '../ui/Input';
import { Select, type SelectOption } from '../ui/Select';
import { useI18n } from '../../hooks/useI18n';
import { cn } from '../../lib/cn';
import type { QbAggregate, QbColumnSelection } from './types';

const AGGREGATE_OPTIONS: SelectOption[] = [
  { value: '', label: '—' },
  { value: 'COUNT', label: 'COUNT' },
  { value: 'SUM', label: 'SUM' },
  { value: 'AVG', label: 'AVG' },
  { value: 'MIN', label: 'MIN' },
  { value: 'MAX', label: 'MAX' },
];

interface ColumnSelectorProps {
  selectedTables: string[];
  columnMap: Record<string, string[]>;
  selectedColumns: QbColumnSelection[];
  onToggle: (table: string, column: string) => void;
  onSetAlias: (table: string, column: string, alias: string) => void;
  onSetAggregate: (table: string, column: string, agg: QbAggregate | undefined) => void;
}

export function ColumnSelector({
  selectedTables,
  columnMap,
  selectedColumns,
  onToggle,
  onSetAlias,
  onSetAggregate,
}: ColumnSelectorProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [expandedTables, setExpandedTables] = useState<Set<string>>(() => new Set(selectedTables));

  // Keep expanded tables in sync with selected tables
  const expandedSet = useMemo(() => {
    const next = new Set(expandedTables);
    for (const tbl of selectedTables) {
      next.add(tbl);
    }
    return next;
  }, [expandedTables, selectedTables]);

  const toggleExpand = (table: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(table)) {
        next.delete(table);
      } else {
        next.add(table);
      }
      return next;
    });
  };

  const filteredTables = useMemo(() => {
    if (!search.trim()) return selectedTables;
    const q = search.trim().toLowerCase();
    return selectedTables.filter((tbl) => {
      const cols = columnMap[tbl] ?? [];
      if (tbl.toLowerCase().includes(q)) return true;
      return cols.some((c) => c.toLowerCase().includes(q));
    });
  }, [selectedTables, columnMap, search]);

  const isSelected = (table: string, column: string) =>
    selectedColumns.some((c) => c.table === table && c.column === column);

  const getSelection = (table: string, column: string) =>
    selectedColumns.find((c) => c.table === table && c.column === column);

  if (selectedTables.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-fg-secondary">
          {t('query.visualBuilder.columns')}
        </span>
        <span className="py-2 text-center text-[11px] text-fg-muted">
          {t('query.visualBuilder.noColumns')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="qb-column-selector">
      <span className="text-[11px] font-medium text-fg-secondary">
        {t('query.visualBuilder.columns')}
      </span>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('query.visualBuilder.searchColumns')}
        className="h-7 text-xs"
        data-testid="qb-column-search"
      />
      <div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
        {filteredTables.length === 0 && (
          <span className="py-1 text-center text-[11px] text-fg-muted">
            {t('common.noMatches')}
          </span>
        )}
        {filteredTables.map((table) => {
          const cols = columnMap[table] ?? [];
          const isExpanded = expandedSet.has(table);
          const filteredCols = search.trim()
            ? cols.filter((c) => c.toLowerCase().includes(search.trim().toLowerCase()))
            : cols;

          return (
            <div key={table}>
              <button
                type="button"
                onClick={() => toggleExpand(table)}
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[12px] font-medium text-fg hover:bg-surface-raised"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-fg-muted" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-fg-muted" />
                )}
                <span className="truncate">{table}</span>
              </button>
              {isExpanded && (
                <div className="ml-3 flex flex-col gap-0.5">
                  {filteredCols.length === 0 && (
                    <span className="py-0.5 pl-4 text-[11px] text-fg-muted">
                      {t('common.noMatches')}
                    </span>
                  )}
                  {filteredCols.map((col) => {
                    const selected = isSelected(table, col);
                    const selection = getSelection(table, col);
                    return (
                      <div
                        key={col}
                        className={cn(
                          'flex flex-col gap-1 rounded px-1.5 py-1',
                          selected && 'bg-accent/5',
                        )}
                      >
                        <label
                          className="flex cursor-pointer items-center gap-2 text-[12px] text-fg hover:bg-surface-raised"
                          data-testid={`qb-column-item-${table}.${col}`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => onToggle(table, col)}
                            className="accent-accent"
                            data-testid={`qb-column-check-${table}.${col}`}
                          />
                          <span className="min-w-0 truncate">{col}</span>
                        </label>
                        {selected && (
                          <div className="ml-5 flex items-center gap-1.5">
                            <Input
                              value={selection?.alias ?? ''}
                              onChange={(e) => onSetAlias(table, col, e.target.value)}
                              placeholder={t('query.visualBuilder.aliasPlaceholder')}
                              className="h-6 w-20 text-[11px]"
                            />
                            <Select
                              value={selection?.aggregate ?? ''}
                              options={AGGREGATE_OPTIONS}
                              onChange={(v) =>
                                onSetAggregate(table, col, v ? (v as QbAggregate) : undefined)
                              }
                              className="h-6 w-20 text-[11px]"
                              labels={{
                                placeholder: t('query.visualBuilder.aggregate'),
                                noMatches: t('common.noMatches'),
                                toggleOptions: '',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
