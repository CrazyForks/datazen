import { Plus, X } from 'lucide-react';
import type { QbCondition, QbConditionGroup } from '../types';
import type { SelectOption } from '../../ui/Select';
import { useI18n } from '../../../hooks/useI18n';
import { ConditionRowEditor } from './ConditionRowEditor';

/** Nesting depth allowed by the v1 spec: root group + one nested level. */
export const MAX_GROUP_DEPTH = 2;

export interface ConditionGroupEditorProps {
  group: QbConditionGroup;
  /** 1 for the root group, 2 for a nested group. */
  depth: number;
  /** `table.column` options drawn from the selected tables. */
  fieldOptions: SelectOption[];
  onAddCondition: (groupId: string) => void;
  onUpdateCondition: (id: string, patch: Partial<QbCondition>) => void;
  onRemoveCondition: (id: string) => void;
  onAddGroup: (groupId: string, logic: 'AND' | 'OR') => void;
  onUpdateGroupLogic: (id: string, logic: 'AND' | 'OR') => void;
  onRemoveGroup: (id: string) => void;
}

/**
 * Recursive editor for a WHERE condition group.
 *
 * Renders its own conditions, then its nested groups (which recurse). Nesting is
 * capped at {@link MAX_GROUP_DEPTH}; the "Add group" affordance disappears past
 * the cap rather than silently ignoring clicks.
 */
export function ConditionGroupEditor({
  group,
  depth,
  fieldOptions,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onAddGroup,
  onUpdateGroupLogic,
  onRemoveGroup,
}: ConditionGroupEditorProps) {
  const { t } = useI18n();
  const isRoot = depth === 1;
  const canNest = depth < MAX_GROUP_DEPTH;

  return (
    <div
      className={
        isRoot
          ? 'flex flex-col gap-1.5'
          : 'flex flex-col gap-1.5 rounded border border-edge bg-surface-inset/40 p-2'
      }
      data-testid={isRoot ? 'condition-group-root' : 'condition-group-nested'}
    >
      {/* Group header: logic toggle + remove */}
      <div className="flex items-center gap-2">
        <div className="inline-flex overflow-hidden rounded border border-edge" role="group">
          {(['AND', 'OR'] as const).map((logic) => (
            <button
              key={logic}
              type="button"
              onClick={() => onUpdateGroupLogic(group.id, logic)}
              aria-pressed={group.logic === logic}
              className={
                'px-2 py-0.5 text-[11px] font-medium transition-colors ' +
                (group.logic === logic
                  ? 'bg-accent text-accent-fg'
                  : 'text-fg-muted hover:bg-surface-raised hover:text-fg')
              }
              data-testid={`condition-group-logic-${logic.toLowerCase()}`}
            >
              {t(logic === 'AND' ? 'query.visualBuilder.and' : 'query.visualBuilder.or')}
            </button>
          ))}
        </div>

        {!isRoot && (
          <button
            type="button"
            onClick={() => onRemoveGroup(group.id)}
            title={t('query.visualBuilder.removeGroup')}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-surface-raised hover:text-danger"
            data-testid="condition-group-remove-button"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Conditions */}
      {group.conditions.map((condition) => (
        <ConditionRowEditor
          key={condition.id}
          condition={condition}
          fieldOptions={fieldOptions}
          onChange={(patch) => onUpdateCondition(condition.id, patch)}
          onRemove={() => onRemoveCondition(condition.id)}
        />
      ))}

      {/* Nested groups */}
      {group.groups.map((sub) => (
        <ConditionGroupEditor
          key={sub.id}
          group={sub}
          depth={depth + 1}
          fieldOptions={fieldOptions}
          onAddCondition={onAddCondition}
          onUpdateCondition={onUpdateCondition}
          onRemoveCondition={onRemoveCondition}
          onAddGroup={onAddGroup}
          onUpdateGroupLogic={onUpdateGroupLogic}
          onRemoveGroup={onRemoveGroup}
        />
      ))}

      {/* Add actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onAddCondition(group.id)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-surface-raised"
          data-testid="condition-add-button"
        >
          <Plus className="h-3 w-3" />
          {t('query.visualBuilder.addCondition')}
        </button>
        {canNest && (
          <button
            type="button"
            onClick={() => onAddGroup(group.id, 'OR')}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-secondary hover:bg-surface-raised hover:text-fg"
            data-testid="condition-add-group-button"
          >
            <Plus className="h-3 w-3" />
            {t('query.visualBuilder.addGroup')}
          </button>
        )}
      </div>
    </div>
  );
}
