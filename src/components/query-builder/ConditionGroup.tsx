import { Plus } from 'lucide-react';
import { Select, type SelectOption } from '../ui/Select';
import { ConditionRow } from './ConditionRow';
import { useI18n } from '../../hooks/useI18n';
import type { QbCondition, QbConditionGroup } from './types';

interface ConditionGroupProps {
  group: QbConditionGroup;
  depth: number;
  selectedTables: string[];
  columnMap: Record<string, string[]>;
  onAddCondition: (groupId: string, condition: Omit<QbCondition, 'id'>) => void;
  onUpdateCondition: (id: string, patch: Partial<QbCondition>) => void;
  onRemoveCondition: (id: string) => void;
  onAddGroup: (parentId: string, logic: 'AND' | 'OR') => void;
}

const CONJUNCTION_OPTIONS: SelectOption[] = [
  { value: 'AND', label: 'AND' },
  { value: 'OR', label: 'OR' },
];

export function ConditionGroup({
  group,
  depth,
  selectedTables,
  columnMap,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onAddGroup,
}: ConditionGroupProps) {
  const { t } = useI18n();

  const handleAddCondition = () => {
    onAddCondition(group.id, {
      table: selectedTables[0] ?? '',
      column: '',
      operator: '=',
      value: '',
      conjunction: 'AND',
    });
  };

  return (
    <div
      className="flex flex-col gap-1.5 rounded border border-edge p-2"
      style={{ marginLeft: depth > 0 ? 12 : 0 }}
      data-testid={depth === 0 ? 'qb-condition-group' : `qb-condition-group-nested-${depth}`}
    >
      {/* Group logic indicator */}
      <div className="flex items-center gap-2">
        <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-fg-secondary">
          {group.logic === 'AND'
            ? t('query.visualBuilder.logicAnd')
            : t('query.visualBuilder.logicOr')}
        </span>
        {depth > 0 && <span className="text-[10px] text-fg-muted">(group)</span>}
      </div>

      {/* Conditions */}
      {group.conditions.map((cond, i) => (
        <div key={cond.id} className="flex items-start gap-1.5">
          {i > 0 && (
            <Select
              value={cond.conjunction}
              options={CONJUNCTION_OPTIONS}
              onChange={(v) =>
                onUpdateCondition(cond.id, {
                  conjunction: v as 'AND' | 'OR',
                })
              }
              className="mt-1 h-6 w-14 text-[10px]"
              fitContent
              labels={{
                placeholder: '',
                noMatches: '',
                toggleOptions: '',
              }}
            />
          )}
          <div className="min-w-0 flex-1">
            <ConditionRow
              condition={cond}
              selectedTables={selectedTables}
              columnMap={columnMap}
              onUpdate={(patch) => onUpdateCondition(cond.id, patch)}
              onRemove={() => onRemoveCondition(cond.id)}
            />
          </div>
        </div>
      ))}

      {/* Nested groups */}
      {group.groups.map((subGroup) => (
        <ConditionGroup
          key={subGroup.id}
          group={subGroup}
          depth={depth + 1}
          selectedTables={selectedTables}
          columnMap={columnMap}
          onAddCondition={onAddCondition}
          onUpdateCondition={onUpdateCondition}
          onRemoveCondition={onRemoveCondition}
          onAddGroup={onAddGroup}
        />
      ))}

      {/* Action buttons */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={handleAddCondition}
          className="inline-flex items-center gap-1 rounded bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20"
          data-testid="qb-add-condition"
        >
          <Plus className="h-3 w-3" />
          {t('query.visualBuilder.addCondition')}
        </button>
        <button
          type="button"
          onClick={() => onAddGroup(group.id, 'AND')}
          className="inline-flex items-center gap-1 rounded bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20"
          data-testid="qb-add-group"
        >
          <Plus className="h-3 w-3" />
          {t('query.visualBuilder.addGroup')}
        </button>
      </div>
    </div>
  );
}
