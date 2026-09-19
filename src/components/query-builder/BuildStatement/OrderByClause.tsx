import { useMemo } from 'react';
import { useI18n } from '../../../hooks/useI18n';
import { Chip } from './Chip';
import { LinkSelect } from './LinkSelect';
import { buildColumnOptions, parseFieldKey, qualifiedRef } from './columnOptions';
import type { ClauseEntry } from './clauseEntries';

export interface OrderByClauseProps {
  entries: ClauseEntry[];
  allTables: string[];
  allColumns: Record<string, string[]>;
  tableAliases: Record<string, string>;
  onAdd: (table: string, column: string) => void;
  /** Click a chip → flip ASC/DESC. */
  onToggle: (entry: ClauseEntry) => void;
  onRemove: (entry: ClauseEntry) => void;
}

/**
 * ORDER BY row. Each chip shows its direction and clicking it flips that
 * direction — one click instead of a dropdown per row.
 */
export function OrderByClause({
  entries,
  allTables,
  allColumns,
  tableAliases,
  onAdd,
  onToggle,
  onRemove,
}: OrderByClauseProps) {
  const { t } = useI18n();

  const options = useMemo(
    () => buildColumnOptions(allTables, allColumns, tableAliases),
    [allTables, allColumns, tableAliases],
  );
  const used = new Set(entries.map((e) => `${e.table}.${e.column}`));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="qb-orderby-clause">
      {entries.map((entry) => (
        <Chip
          key={`${entry.table}.${entry.column}`}
          label={qualifiedRef(entry.table, entry.column, tableAliases)}
          prefix={entry.aggregate ? `${entry.aggregate}(` : ''}
          suffix={`${entry.aggregate ? ')' : ''} ${entry.direction ?? 'ASC'}`}
          title={`${entry.direction ?? 'ASC'} — ${t('query.visualBuilder.sortLabel')}`}
          onClick={() => onToggle(entry)}
          onRemove={() => onRemove(entry)}
          testId={`qb-order-chip-${entry.table}-${entry.column}`}
          removeTestId={`qb-order-remove-${entry.table}-${entry.column}`}
        />
      ))}
      <LinkSelect
        label={t('query.visualBuilder.addOrderByClause')}
        options={options.filter((o) => !used.has(o.value))}
        testId="qb-add-order-by"
        onPick={(key) => {
          const field = parseFieldKey(key);
          if (field) onAdd(field.table, field.column);
        }}
      />
    </div>
  );
}
