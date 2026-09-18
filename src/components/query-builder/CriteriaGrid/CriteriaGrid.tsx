import { Plus } from 'lucide-react';
import type { QbColumnSelection } from '../types';
import { useI18n } from '../../../hooks/useI18n';
import { CriteriaRow } from './CriteriaRow';

export interface CriteriaGridProps {
  selectedColumns: QbColumnSelection[];
  /** All available table names. */
  allTables: string[];
  /** Map of table → column names for the field dropdowns. */
  allColumns: Record<string, string[]>;
  onUpdateColumn: (table: string, column: string, patch: Partial<QbColumnSelection>) => void;
  onRemoveColumn: (table: string, column: string) => void;
  /** Called when the user clicks "+ Add Column" — should add an empty row. */
  onAddColumn: () => void;
}

/**
 * Excel-like grid for configuring column selections (field, alias, sort,
 * aggregate, where, group-by).
 *
 * Layout: Field(auto) | Table(100px) | Alias(100px) | Sort(80px) |
 *         Func(100px) | Where(auto) | Group(50px) | Delete(30px)
 */
export function CriteriaGrid({
  selectedColumns,
  allTables,
  allColumns,
  onUpdateColumn,
  onRemoveColumn,
  onAddColumn,
}: CriteriaGridProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col overflow-auto border-t border-edge" data-testid="criteria-grid">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-raised text-xs text-fg-secondary">
            <th className="px-2 py-1.5 text-left font-medium">{t('query.visualBuilder.field')}</th>
            <th className="w-[100px] px-2 py-1.5 text-left font-medium">
              {t('query.visualBuilder.table')}
            </th>
            <th className="w-[100px] px-2 py-1.5 text-left font-medium">
              {t('query.visualBuilder.alias')}
            </th>
            <th className="w-[80px] px-2 py-1.5 text-left font-medium">
              {t('query.visualBuilder.sort')}
            </th>
            <th className="w-[100px] px-2 py-1.5 text-left font-medium">
              {t('query.visualBuilder.func')}
            </th>
            <th className="px-2 py-1.5 text-left font-medium">{t('query.visualBuilder.where')}</th>
            <th className="w-[50px] px-2 py-1.5 text-center font-medium">
              {t('query.visualBuilder.group')}
            </th>
            <th className="w-[30px] px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {selectedColumns.map((col) => (
            <CriteriaRow
              key={`${col.table}.${col.column}`}
              selection={col}
              allTables={allTables}
              allColumns={allColumns}
              onUpdate={(patch) => onUpdateColumn(col.table, col.column, patch)}
              onRemove={() => onRemoveColumn(col.table, col.column)}
            />
          ))}
        </tbody>
      </table>

      {/* Add Column button */}
      <button
        type="button"
        onClick={onAddColumn}
        className="flex items-center gap-1.5 px-3 py-2 text-xs text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
        data-testid="criteria-add-column"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('query.visualBuilder.addColumn')}
      </button>
    </div>
  );
}
