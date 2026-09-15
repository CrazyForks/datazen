import { Plus, X } from 'lucide-react';
import { Select, type SelectOption } from '../ui/Select';
import { useI18n } from '../../hooks/useI18n';
import type { QbColumnSelection, QbSortItem } from './types';

interface SortClauseProps {
  orderBy: QbSortItem[];
  selectedColumns: QbColumnSelection[];
  onAdd: (item: QbSortItem) => void;
  onRemove: (index: number) => void;
}

const DIRECTION_OPTIONS: SelectOption[] = [
  { value: 'ASC', label: 'ASC' },
  { value: 'DESC', label: 'DESC' },
];

export function SortClause({ orderBy, selectedColumns, onAdd, onRemove }: SortClauseProps) {
  const { t } = useI18n();

  const columnOptions: SelectOption[] = selectedColumns.map((c) => ({
    value: `${c.table}.${c.column}`,
    label: `${c.table}.${c.column}`,
  }));

  const handleAdd = () => {
    if (selectedColumns.length === 0) return;
    const first = selectedColumns[0];
    onAdd({ table: first.table, column: first.column, direction: 'ASC' });
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="qb-sort-clause">
      <span className="text-[11px] font-medium text-fg-secondary">
        {t('query.visualBuilder.sort')}
      </span>
      {orderBy.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5" data-testid={`qb-sort-item-${i}`}>
          <Select
            value={`${item.table}.${item.column}`}
            options={columnOptions}
            onChange={(v) => {
              const [table, column] = v.split('.');
              if (table && column) {
                onRemove(i);
                onAdd({ table, column, direction: item.direction });
              }
            }}
            className="h-7 min-w-0 flex-1 text-[11px]"
            fitContent
            labels={{
              placeholder: t('query.visualBuilder.column'),
              noMatches: t('common.noMatches'),
              toggleOptions: '',
            }}
          />
          <Select
            value={item.direction}
            options={DIRECTION_OPTIONS}
            onChange={(v) => {
              onRemove(i);
              onAdd({
                table: item.table,
                column: item.column,
                direction: v as 'ASC' | 'DESC',
              });
            }}
            className="h-7 w-16 text-[11px]"
            fitContent
            labels={{
              placeholder: '',
              noMatches: '',
              toggleOptions: '',
            }}
          />
          <button
            type="button"
            onClick={() => onRemove(i)}
            title={t('query.visualBuilder.removeSort')}
            className="flex h-7 shrink-0 items-center justify-center rounded px-1.5 text-fg-muted hover:bg-danger/15 hover:text-danger"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={handleAdd}
        disabled={selectedColumns.length === 0}
        className="inline-flex w-fit items-center gap-1 self-start rounded bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
        data-testid="qb-add-sort"
      >
        <Plus className="h-3 w-3" />
        {t('query.visualBuilder.addSort')}
      </button>
    </div>
  );
}
