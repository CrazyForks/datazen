import { useCallback, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@datazen/ui';
import { useI18n } from '../../../hooks/useI18n';
import { Select, type SelectOption } from '../../ui/Select';
import { Input } from '../../ui/Input';
import type { QbCondition, QbConditionGroup, QbOperator } from '../types';

const OPERATOR_OPTIONS: SelectOption[] = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: 'LIKE', label: 'LIKE' },
  { value: 'NOT LIKE', label: 'NOT LIKE' },
  { value: 'IN', label: 'IN' },
  { value: 'NOT IN', label: 'NOT IN' },
  { value: 'IS NULL', label: 'IS NULL' },
  { value: 'IS NOT NULL', label: 'IS NOT NULL' },
];

const LOGIC_OPTIONS: SelectOption[] = [
  { value: 'AND', label: 'AND' },
  { value: 'OR', label: 'OR' },
];

const NULL_OPERATORS = new Set<QbOperator>(['IS NULL', 'IS NOT NULL']);
const LIST_OPERATORS = new Set<QbOperator>(['IN', 'NOT IN']);

export interface WhereClauseEditorProps {
  /** Root condition group from the store. */
  where: QbConditionGroup;
  /** Tables available for the field picker. */
  allTables: string[];
  /** table → column names. */
  allColumns: Record<string, string[]>;
  /** Table → alias, shown as the column qualifier. */
  tableAliases?: Record<string, string>;
  onAddCondition: (groupId: string, condition: Omit<QbCondition, 'id'>) => void;
  onUpdateCondition: (id: string, patch: Partial<QbCondition>) => void;
  onRemoveCondition: (id: string) => void;
  onAddGroup: (parentId: string, logic: 'AND' | 'OR') => void;
  onSetGroupLogic: (groupId: string, logic: 'AND' | 'OR') => void;
}

/**
 * Editing surface for the store's nested `where` tree.
 *
 * `CriteriaRow` only covers *per-column* conditions; the root group and its
 * sub-groups (PRD F-04.5) had no UI, which made nested `AND (… OR …)` only
 * reachable through the store. This component closes that gap and is what the
 * complex E2E journey drives through real DOM interactions.
 */
export function WhereClauseEditor({
  where,
  allTables,
  allColumns,
  tableAliases = {},
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onAddGroup,
  onSetGroupLogic,
}: WhereClauseEditorProps) {
  const { t } = useI18n();

  /** table.column options, in table order, labelled with the effective qualifier. */
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

  /** Default field for a freshly added condition — never an empty identifier. */
  const defaultField = fieldOptions[0]?.value ?? null;

  const handleAdd = useCallback(
    (groupId: string) => {
      if (!defaultField) return;
      const dot = defaultField.indexOf('.');
      onAddCondition(groupId, {
        table: defaultField.slice(0, dot),
        column: defaultField.slice(dot + 1),
        operator: '=',
        value: '',
        conjunction: 'AND',
      });
    },
    [defaultField, onAddCondition],
  );

  return (
    <div className="border-t border-edge" data-testid="qb-where-editor">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          WHERE
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => handleAdd(where.id)}
          disabled={!defaultField}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg disabled:opacity-40"
          data-testid="qb-where-add-condition"
        >
          <Plus className="h-3 w-3" />
          {t('query.visualBuilder.addCondition')}
        </button>
        <button
          type="button"
          onClick={() => onAddGroup(where.id, 'OR')}
          disabled={!defaultField}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg disabled:opacity-40"
          data-testid="qb-where-add-group"
        >
          <Plus className="h-3 w-3" />
          {t('query.visualBuilder.addGroup')}
        </button>
      </div>

      <GroupNode
        group={where}
        depth={0}
        isRoot
        fieldOptions={fieldOptions}
        onAdd={handleAdd}
        onUpdateCondition={onUpdateCondition}
        onRemoveCondition={onRemoveCondition}
        onAddGroup={onAddGroup}
        onSetGroupLogic={onSetGroupLogic}
      />

      {where.conditions.length === 0 && where.groups.length === 0 && (
        <div className="px-3 pb-2 text-[11px] text-fg-muted" data-testid="qb-where-empty">
          {t('query.visualBuilder.conditions')}
        </div>
      )}
    </div>
  );
}

interface GroupNodeProps {
  group: QbConditionGroup;
  depth: number;
  isRoot?: boolean;
  fieldOptions: SelectOption[];
  onAdd: (groupId: string) => void;
  onUpdateCondition: (id: string, patch: Partial<QbCondition>) => void;
  onRemoveCondition: (id: string) => void;
  onAddGroup: (parentId: string, logic: 'AND' | 'OR') => void;
  onSetGroupLogic: (groupId: string, logic: 'AND' | 'OR') => void;
}

function GroupNode({
  group,
  depth,
  isRoot = false,
  fieldOptions,
  onAdd,
  onUpdateCondition,
  onRemoveCondition,
  onAddGroup,
  onSetGroupLogic,
}: GroupNodeProps) {
  return (
    <div
      className={cn('flex flex-col gap-1 px-3 pb-2', !isRoot && 'ml-3 border-l border-edge pl-2')}
      data-testid={isRoot ? 'qb-where-root' : 'qb-where-group'}
      data-group-id={group.id}
      data-group-logic={group.logic}
      data-depth={depth}
    >
      {!isRoot && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-fg-muted">(</span>
          <Select
            value={group.logic}
            options={LOGIC_OPTIONS}
            onChange={(v) => onSetGroupLogic(group.id, v as 'AND' | 'OR')}
            triggerDataAttrs={{ 'data-testid': 'qb-where-group-logic' }}
          />
          <span className="text-[11px] text-fg-muted">)</span>
        </div>
      )}

      {group.conditions.map((cond, index) => (
        <ConditionRow
          key={cond.id}
          condition={cond}
          showConjunction={index > 0}
          fieldOptions={fieldOptions}
          onUpdate={(patch) => onUpdateCondition(cond.id, patch)}
          onRemove={() => onRemoveCondition(cond.id)}
        />
      ))}

      {group.groups.map((sub) => (
        <GroupNode
          key={sub.id}
          group={sub}
          depth={depth + 1}
          fieldOptions={fieldOptions}
          onAdd={onAdd}
          onUpdateCondition={onUpdateCondition}
          onRemoveCondition={onRemoveCondition}
          onAddGroup={onAddGroup}
          onSetGroupLogic={onSetGroupLogic}
        />
      ))}

      {!isRoot && (
        <button
          type="button"
          onClick={() => onAdd(group.id)}
          className="self-start rounded px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface-raised hover:text-fg"
          data-testid="qb-where-subgroup-add-condition"
        >
          + {group.logic}
        </button>
      )}
    </div>
  );
}

interface ConditionRowProps {
  condition: QbCondition;
  showConjunction: boolean;
  fieldOptions: SelectOption[];
  onUpdate: (patch: Partial<QbCondition>) => void;
  onRemove: () => void;
}

function ConditionRow({
  condition,
  showConjunction,
  fieldOptions,
  onUpdate,
  onRemove,
}: ConditionRowProps) {
  const isNullOp = NULL_OPERATORS.has(condition.operator);
  const isListOp = LIST_OPERATORS.has(condition.operator);
  const fieldValue = `${condition.table}.${condition.column}`;

  return (
    <div className="flex items-center gap-1.5" data-testid="qb-where-row">
      {showConjunction ? (
        <div className="w-[74px] shrink-0">
          <Select
            value={condition.conjunction}
            options={LOGIC_OPTIONS}
            onChange={(v) => onUpdate({ conjunction: v as 'AND' | 'OR' })}
            triggerDataAttrs={{ 'data-testid': 'qb-where-conjunction' }}
          />
        </div>
      ) : (
        <div className="w-[74px] shrink-0" />
      )}

      <div className="min-w-[170px] flex-1" data-testid="qb-where-field">
        <Select
          value={fieldValue}
          options={fieldOptions}
          searchable
          placeholder="table.column"
          onChange={(v) => {
            const dot = v.indexOf('.');
            if (dot === -1) return;
            onUpdate({ table: v.slice(0, dot), column: v.slice(dot + 1) });
          }}
        />
      </div>

      <div className="w-[110px] shrink-0">
        <Select
          value={condition.operator}
          options={OPERATOR_OPTIONS}
          onChange={(v) => onUpdate({ operator: v as QbOperator })}
          triggerDataAttrs={{ 'data-testid': 'qb-where-operator' }}
        />
      </div>

      {isNullOp ? (
        <div className="w-[160px] shrink-0" />
      ) : (
        <div className="w-[160px] shrink-0">
          <Input
            value={condition.value ?? ''}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder={isListOp ? 'v1, v2, …' : 'Value'}
            className="h-8 text-xs"
            data-testid="qb-where-value"
          />
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded p-1 text-fg-muted transition-colors hover:bg-surface-raised hover:text-danger"
        title="Remove"
        data-testid="qb-where-remove"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
