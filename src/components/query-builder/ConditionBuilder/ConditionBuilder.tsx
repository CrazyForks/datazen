import { useCallback, useMemo } from 'react';
import type { QbCondition } from '../types';
import type { SelectOption } from '../../ui/Select';
import { useQueryBuilderStore } from '../../../stores/queryBuilderStore';
import { useI18n } from '../../../hooks/useI18n';
import { ConditionGroupEditor } from './ConditionGroupEditor';

export interface ConditionBuilderProps {
  /** Table → column names, used to populate the field pickers. */
  columnMap: Record<string, string[]>;
}

/**
 * WHERE-clause editor for the visual query builder.
 *
 * The store keeps the WHERE clause as a tree (`QbConditionGroup` with nested
 * `groups`), which is what the SQL generator walks. This component is the
 * missing UI for that tree: it renders the root group and its nested groups,
 * each with its own AND/OR toggle.
 */
export function ConditionBuilder({ columnMap }: ConditionBuilderProps) {
  const { t } = useI18n();

  const where = useQueryBuilderStore((s) => s.where);
  const selectedTables = useQueryBuilderStore((s) => s.selectedTables);
  const addCondition = useQueryBuilderStore((s) => s.addCondition);
  const updateCondition = useQueryBuilderStore((s) => s.updateCondition);
  const removeCondition = useQueryBuilderStore((s) => s.removeCondition);
  const addConditionGroup = useQueryBuilderStore((s) => s.addConditionGroup);
  const updateConditionGroupLogic = useQueryBuilderStore((s) => s.updateConditionGroupLogic);
  const removeConditionGroup = useQueryBuilderStore((s) => s.removeConditionGroup);

  const fieldOptions: SelectOption[] = useMemo(
    () =>
      selectedTables.flatMap((table) =>
        (columnMap[table] ?? []).map((column) => ({
          value: `${table}.${column}`,
          label: `${table}.${column}`,
        })),
      ),
    [selectedTables, columnMap],
  );

  /**
   * New rows start on the first available field so the row is immediately valid
   * instead of rendering an empty picker the user must fix first.
   */
  const handleAddCondition = useCallback(
    (groupId: string) => {
      const first = fieldOptions[0];
      if (!first) return;
      const dot = first.value.indexOf('.');
      const condition: Omit<QbCondition, 'id'> = {
        table: first.value.substring(0, dot),
        column: first.value.substring(dot + 1),
        operator: '=',
        value: '',
        conjunction: 'AND',
      };
      addCondition(groupId, condition);
    },
    [fieldOptions, addCondition],
  );

  return (
    <div className="flex flex-col gap-2 border-t border-edge p-3" data-testid="condition-builder">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        {t('query.visualBuilder.conditions')}
      </div>

      {fieldOptions.length === 0 ? (
        <div className="text-xs text-fg-muted" data-testid="condition-builder-empty">
          {t('query.visualBuilder.noColumnsSelected')}
        </div>
      ) : (
        <ConditionGroupEditor
          group={where}
          depth={1}
          fieldOptions={fieldOptions}
          onAddCondition={handleAddCondition}
          onUpdateCondition={updateCondition}
          onRemoveCondition={removeCondition}
          onAddGroup={addConditionGroup}
          onUpdateGroupLogic={updateConditionGroupLogic}
          onRemoveGroup={removeConditionGroup}
        />
      )}
    </div>
  );
}
