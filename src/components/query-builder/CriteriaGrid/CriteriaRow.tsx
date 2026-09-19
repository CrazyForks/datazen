import { useState, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import type { QbColumnSelection, QbAggregate } from '../types';
import { Select, type SelectOption } from '../../ui/Select';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { WhereEditor } from './WhereEditor';

const SORT_OPTIONS: SelectOption[] = [
  { value: '', label: 'None' },
  { value: 'ASC', label: 'ASC' },
  { value: 'DESC', label: 'DESC' },
];

const FUNC_OPTIONS: SelectOption[] = [
  { value: '', label: 'None' },
  { value: 'COUNT', label: 'COUNT' },
  { value: 'SUM', label: 'SUM' },
  { value: 'AVG', label: 'AVG' },
  { value: 'MIN', label: 'MIN' },
  { value: 'MAX', label: 'MAX' },
];

export interface CriteriaRowProps {
  selection: QbColumnSelection;
  /** All available table names for the Field dropdown. */
  allTables: string[];
  /** Map of table → column names. */
  allColumns: Record<string, string[]>;
  /** Table → alias, so the dropdown shows the qualifier the SQL will use. */
  tableAliases?: Record<string, string>;
  onUpdate: (patch: Partial<QbColumnSelection>) => void;
  onRemove: () => void;
}

/**
 * A single row in the CriteriaGrid, representing one QbColumnSelection.
 *
 * Columns: ☑ | Field (select) | Table (auto-fill) | Alias (input) |
 *          Sort (select) | Func (select) | Where (button → dialog) |
 *          Group (checkbox) | Delete (button)
 */
export function CriteriaRow({
  selection,
  allTables,
  allColumns,
  tableAliases = {},
  onUpdate,
  onRemove,
}: CriteriaRowProps) {
  const [whereOpen, setWhereOpen] = useState(false);

  // Build combined "table.column" options from all selected tables. The value
  // stays `table.column` (that is what the store keys on) while the label shows
  // the alias, so what the user reads matches what the SQL emits.
  const fieldOptions: SelectOption[] = useMemo(() => {
    const opts: SelectOption[] = [];
    for (const table of allTables) {
      const qualifier = tableAliases[table] || table;
      for (const col of allColumns[table] ?? []) {
        opts.push({
          value: `${table}.${col}`,
          label: qualifier === table ? `${table}.${col}` : `${qualifier}.${col}`,
        });
      }
    }
    return opts;
  }, [allTables, allColumns, tableAliases]);

  const currentFieldValue = `${selection.table}.${selection.column}`;

  const handleFieldChange = useCallback(
    (val: string) => {
      const dotIdx = val.indexOf('.');
      if (dotIdx === -1) return;
      const table = val.substring(0, dotIdx);
      const column = val.substring(dotIdx + 1);
      onUpdate({ table, column });
    },
    [onUpdate],
  );

  const handleSortChange = useCallback(
    (val: string) => {
      onUpdate({ sort: (val as 'ASC' | 'DESC') || undefined });
    },
    [onUpdate],
  );

  const handleFuncChange = useCallback(
    (val: string) => {
      onUpdate({ aggregate: (val as QbAggregate) || undefined });
    },
    [onUpdate],
  );

  const handleGroupChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ groupBy: e.target.checked || undefined });
    },
    [onUpdate],
  );

  const handleAliasChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate({ alias: e.target.value || undefined });
    },
    [onUpdate],
  );

  const handleWhereSave = useCallback(
    (
      patch: Partial<{
        operator: QbColumnSelection['where'] extends infer W
          ? W extends { operator: infer O }
            ? O
            : never
          : never;
        value: string | null;
      }>,
    ) => {
      // Build or update the per-column where condition
      const existing = selection.where;
      const id = existing?.id ?? crypto.randomUUID();
      onUpdate({
        where: {
          id,
          table: selection.table,
          column: selection.column,
          operator:
            (patch.operator as QbColumnSelection['where'] extends { operator: infer O }
              ? O
              : never) ??
            existing?.operator ??
            '=',
          value: patch.value !== undefined ? patch.value : (existing?.value ?? null),
          conjunction: existing?.conjunction ?? 'AND',
        },
      });
    },
    [selection, onUpdate],
  );

  const fieldLabel = tableAliases[selection.table]
    ? `${tableAliases[selection.table]}.${selection.column}`
    : currentFieldValue;

  return (
    <tr
      className="border-b border-edge transition-colors hover:bg-surface-raised/50"
      data-testid="criteria-row"
    >
      {/* Field (auto-filled from selection) */}
      <td className="px-1 py-1">
        <div className="min-w-[180px]" data-testid="criteria-field-select">
          <Select
            value={currentFieldValue}
            options={fieldOptions}
            onChange={handleFieldChange}
            placeholder="table.column"
            searchable
          />
        </div>
      </td>

      {/* Table (auto-fill, read-only) */}
      <td className="px-1 py-1">
        <Input
          value={selection.table}
          readOnly
          className="h-8 text-xs opacity-70"
          data-testid="criteria-table-input"
        />
      </td>

      {/* Alias */}
      <td className="px-1 py-1">
        <Input
          value={selection.alias ?? ''}
          onChange={handleAliasChange}
          placeholder="Alias"
          className="h-8 text-xs"
          data-testid="criteria-alias-input"
        />
      </td>

      {/* Sort */}
      <td className="px-1 py-1">
        <Select
          value={selection.sort ?? ''}
          options={SORT_OPTIONS}
          onChange={handleSortChange}
          triggerDataAttrs={{ 'data-testid': 'criteria-sort-select' }}
        />
      </td>

      {/* Func (aggregate) */}
      <td className="px-1 py-1">
        <Select
          value={selection.aggregate ?? ''}
          options={FUNC_OPTIONS}
          onChange={handleFuncChange}
          triggerDataAttrs={{ 'data-testid': 'criteria-func-select' }}
        />
      </td>

      {/* Where */}
      <td className="px-1 py-1">
        <button
          type="button"
          onClick={() => setWhereOpen(true)}
          className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-edge bg-surface-inset px-2 text-xs text-fg-secondary hover:border-edge-hi hover:text-fg"
          data-testid="criteria-where-button"
        >
          {selection.where
            ? `${selection.where.operator} ${selection.where.value ?? ''}`
            : 'Where…'}
        </button>
        <WhereEditor
          open={whereOpen}
          condition={selection.where ?? null}
          fieldLabel={fieldLabel}
          onClose={() => setWhereOpen(false)}
          onSave={handleWhereSave}
        />
      </td>

      {/* Group (checkbox) */}
      <td className="px-1 py-1 text-center">
        <input
          type="checkbox"
          checked={selection.groupBy ?? false}
          onChange={handleGroupChange}
          className="accent-accent"
          data-testid="criteria-group-checkbox"
        />
      </td>

      {/* Delete */}
      <td className="px-1 py-1 text-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-7 w-7 p-0 text-fg-muted hover:text-danger"
          data-testid="criteria-remove-button"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}
