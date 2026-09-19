import { useCallback, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@datazen/ui';
import { useI18n } from '../../../hooks/useI18n';
import { Select, type SelectOption } from '../../ui/Select';
import { Input } from '../../ui/Input';
import type { QbAggregate, QbCondition, QbConditionGroup, QbOperator } from '../types';

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

/** Comparison operators, shared with the per-column criteria editor. */
export const QB_OPERATOR_OPTIONS = OPERATOR_OPTIONS;

const LOGIC_OPTIONS: SelectOption[] = [
  { value: 'AND', label: 'AND' },
  { value: 'OR', label: 'OR' },
];

const AGGREGATES: QbAggregate[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];

const NULL_OPERATORS = new Set<QbOperator>(['IS NULL', 'IS NOT NULL']);
const LIST_OPERATORS = new Set<QbOperator>(['IN', 'NOT IN']);

/** AND/OR of the group with `groupId`, or null when it is not in this tree. */
function findGroupLogic(group: QbConditionGroup, groupId: string): 'AND' | 'OR' | null {
  if (group.id === groupId) return group.logic;
  for (const sub of group.groups) {
    const found = findGroupLogic(sub, groupId);
    if (found) return found;
  }
  return null;
}

export interface ConditionClauseProps {
  /** Root condition group (the store's `where` or `having` tree). */
  group: QbConditionGroup;
  /**
   * Test-id namespace — `qb-where` or `qb-having`. Every interactive element
   * below is addressed as `${testIdPrefix}-row`, `-field`, `-value`, … so the
   * two clause editors can share one implementation without sharing locators.
   */
  testIdPrefix: string;
  /** Tables available for the field picker. */
  allTables: string[];
  /** table → column names. */
  allColumns: Record<string, string[]>;
  /** Table → alias, shown as the column qualifier. */
  tableAliases?: Record<string, string>;
  /**
   * Offer a per-condition aggregate, i.e. `SUM(qty) >= 2000`.
   * HAVING sets this; WHERE must not (`WHERE SUM(x) > 1` is invalid SQL).
   */
  allowAggregate?: boolean;
  /** Shown under the rows while the group is empty. */
  emptyHint?: string;
  onAddCondition: (groupId: string, condition: Omit<QbCondition, 'id'>) => void;
  onUpdateCondition: (id: string, patch: Partial<QbCondition>) => void;
  onRemoveCondition: (id: string) => void;
  onAddGroup: (parentId: string, logic: 'AND' | 'OR') => void;
  onSetGroupLogic: (groupId: string, logic: 'AND' | 'OR') => void;
}

/**
 * One condition clause (WHERE or HAVING): a nested AND/OR tree plus the
 * "add condition / add group" affordances.
 *
 * The whole tree lives inside a single clause row of the statement list, which
 * is what gives the Navicat-style layout its vertical budget: a clause only
 * takes the height of the rows it actually holds.
 */
export function ConditionClause({
  group,
  testIdPrefix,
  allTables,
  allColumns,
  tableAliases = {},
  allowAggregate = false,
  emptyHint,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onAddGroup,
  onSetGroupLogic,
}: ConditionClauseProps) {
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
        // Seed the conjunction from the group's own logic, so a row added to an
        // `OR` group starts as `OR` — the generator honours each row's
        // conjunction, and a hardcoded `AND` here would silently turn
        // `(a OR b)` into `(a AND b)`.
        conjunction: findGroupLogic(group, groupId) ?? 'AND',
        // HAVING rows are only useful with an aggregate; start them there so a
        // brand-new row cannot emit the invalid `HAVING bare_column = …`.
        ...(allowAggregate ? { aggregate: 'SUM' as QbAggregate } : {}),
      });
    },
    [defaultField, onAddCondition, allowAggregate, group],
  );

  const isEmpty = group.conditions.length === 0 && group.groups.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={`${testIdPrefix}-editor`}>
      <GroupNode
        group={group}
        depth={0}
        isRoot
        testIdPrefix={testIdPrefix}
        fieldOptions={fieldOptions}
        allowAggregate={allowAggregate}
        onAdd={handleAdd}
        onUpdateCondition={onUpdateCondition}
        onRemoveCondition={onRemoveCondition}
        onAddGroup={onAddGroup}
        onSetGroupLogic={onSetGroupLogic}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => handleAdd(group.id)}
          disabled={!defaultField}
          className="rounded text-[12px] text-fg-muted transition-colors hover:text-accent disabled:opacity-40"
          data-testid={`${testIdPrefix}-add-condition`}
        >
          {isEmpty ? (
            <span data-testid={`${testIdPrefix}-empty`}>
              &lt;{emptyHint ?? t('query.visualBuilder.addConditions')}&gt;
            </span>
          ) : (
            <>+ {t('query.visualBuilder.addCondition')}</>
          )}
        </button>
        <button
          type="button"
          onClick={() => onAddGroup(group.id, 'OR')}
          disabled={!defaultField}
          className="flex items-center gap-1 rounded text-[12px] text-fg-muted transition-colors hover:text-accent disabled:opacity-40"
          data-testid={`${testIdPrefix}-add-group`}
        >
          <Plus className="h-3 w-3" />
          {t('query.visualBuilder.addGroup')}
        </button>
      </div>
    </div>
  );
}

interface GroupNodeProps {
  group: QbConditionGroup;
  depth: number;
  isRoot?: boolean;
  testIdPrefix: string;
  fieldOptions: SelectOption[];
  allowAggregate: boolean;
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
  testIdPrefix,
  fieldOptions,
  allowAggregate,
  onAdd,
  onUpdateCondition,
  onRemoveCondition,
  onAddGroup,
  onSetGroupLogic,
}: GroupNodeProps) {
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-1', !isRoot && 'ml-3 border-l border-edge pl-2')}
      data-testid={isRoot ? `${testIdPrefix}-root` : `${testIdPrefix}-group`}
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
            triggerDataAttrs={{ 'data-testid': `${testIdPrefix}-group-logic` }}
          />
          <span className="text-[11px] text-fg-muted">)</span>
        </div>
      )}

      {group.conditions.map((cond, index) => (
        <ConditionRow
          key={cond.id}
          condition={cond}
          showConjunction={index > 0}
          testIdPrefix={testIdPrefix}
          fieldOptions={fieldOptions}
          allowAggregate={allowAggregate}
          onUpdate={(patch) => onUpdateCondition(cond.id, patch)}
          onRemove={() => onRemoveCondition(cond.id)}
        />
      ))}

      {group.groups.map((sub) => (
        <GroupNode
          key={sub.id}
          group={sub}
          depth={depth + 1}
          testIdPrefix={testIdPrefix}
          fieldOptions={fieldOptions}
          allowAggregate={allowAggregate}
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
          className="self-start rounded text-[11px] text-fg-muted hover:text-accent"
          data-testid={`${testIdPrefix}-subgroup-add-condition`}
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
  testIdPrefix: string;
  fieldOptions: SelectOption[];
  allowAggregate: boolean;
  onUpdate: (patch: Partial<QbCondition>) => void;
  onRemove: () => void;
}

function ConditionRow({
  condition,
  showConjunction,
  testIdPrefix,
  fieldOptions,
  allowAggregate,
  onUpdate,
  onRemove,
}: ConditionRowProps) {
  const { t } = useI18n();
  const isNullOp = NULL_OPERATORS.has(condition.operator);
  const isListOp = LIST_OPERATORS.has(condition.operator);
  const fieldValue = `${condition.table}.${condition.column}`;

  const aggregateOptions: SelectOption[] = [
    { value: '', label: '—' },
    ...AGGREGATES.map((a) => ({ value: a, label: a })),
  ];

  return (
    <div className="flex min-w-0 items-center gap-1.5" data-testid={`${testIdPrefix}-row`}>
      {showConjunction ? (
        <div className="w-[70px] shrink-0">
          <Select
            value={condition.conjunction}
            options={LOGIC_OPTIONS}
            onChange={(v) => onUpdate({ conjunction: v as 'AND' | 'OR' })}
            triggerDataAttrs={{ 'data-testid': `${testIdPrefix}-conjunction` }}
          />
        </div>
      ) : (
        <div className="w-[70px] shrink-0" />
      )}

      {allowAggregate && (
        <div className="w-[86px] shrink-0">
          <Select
            value={condition.aggregate ?? ''}
            options={aggregateOptions}
            title={t('query.visualBuilder.aggregate')}
            onChange={(v) => onUpdate({ aggregate: (v || undefined) as QbAggregate | undefined })}
            triggerDataAttrs={{ 'data-testid': `${testIdPrefix}-aggregate` }}
          />
        </div>
      )}

      <div className="min-w-[150px] flex-1" data-testid={`${testIdPrefix}-field`}>
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

      <div className="w-[104px] shrink-0">
        <Select
          value={condition.operator}
          options={OPERATOR_OPTIONS}
          onChange={(v) => onUpdate({ operator: v as QbOperator })}
          triggerDataAttrs={{ 'data-testid': `${testIdPrefix}-operator` }}
        />
      </div>

      {isNullOp ? (
        <div className="w-[140px] shrink-0" />
      ) : (
        <div className="w-[140px] shrink-0">
          <Input
            value={condition.value ?? ''}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder={isListOp ? 'v1, v2, …' : t('query.visualBuilder.valuePlaceholder')}
            className="h-8 text-xs"
            data-testid={`${testIdPrefix}-value`}
          />
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded p-1 text-fg-muted transition-colors hover:bg-surface-raised hover:text-danger"
        title={t('query.visualBuilder.removeJoin')}
        data-testid={`${testIdPrefix}-remove`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
