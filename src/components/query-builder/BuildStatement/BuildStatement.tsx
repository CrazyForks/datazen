import { useMemo, useState } from 'react';
import { useI18n } from '../../../hooks/useI18n';
import { ConditionClause } from '../CriteriaGrid/ConditionClause';
import type {
  QbColumnSelection,
  QbCondition,
  QbConditionGroup,
  QbGroupByItem,
  QbJoin,
  QbSortItem,
} from '../types';
import { ClauseRow } from './ClauseRow';
import { Chip } from './Chip';
import { ColumnOptionsDialog } from './ColumnOptionsDialog';
import { FromClause } from './FromClause';
import { GroupByClause } from './GroupByClause';
import { OrderByClause } from './OrderByClause';
import { SelectClause } from './SelectClause';
import { buildGroupByEntries, buildOrderByEntries, type ClauseEntry } from './clauseEntries';
import { qualifiedRef } from './columnOptions';

export interface BuildStatementSchema {
  /** Tables currently in the query. */
  tables: string[];
  /** table → column names. */
  columns: Record<string, string[]>;
  /** Table → alias. */
  aliases: Record<string, string>;
  /** Connection tables not in the query yet (FROM picker). */
  availableTables: string[];
}

export interface BuildStatementState {
  selectedColumns: QbColumnSelection[];
  distinct: boolean;
  joins: QbJoin[];
  where: QbConditionGroup;
  having: QbConditionGroup;
  groupBy: QbGroupByItem[];
  orderBy: QbSortItem[];
}

export interface BuildStatementActions {
  setDistinct: (v: boolean) => void;
  addColumn: (table: string, column: string) => void;
  removeColumn: (table: string, column: string) => void;
  updateColumn: (table: string, column: string, patch: Partial<QbColumnSelection>) => void;
  setTableAlias: (table: string, alias: string) => void;
  removeTable: (table: string) => void;
  addTable: (table: string) => void;
  addCondition: (groupId: string, condition: Omit<QbCondition, 'id'>) => void;
  updateCondition: (id: string, patch: Partial<QbCondition>) => void;
  removeCondition: (id: string) => void;
  addConditionGroup: (parentId: string, logic: 'AND' | 'OR') => void;
  setGroupLogic: (groupId: string, logic: 'AND' | 'OR') => void;
  addHavingCondition: (groupId: string, condition: Omit<QbCondition, 'id'>) => void;
  updateHavingCondition: (id: string, patch: Partial<QbCondition>) => void;
  removeHavingCondition: (id: string) => void;
  addHavingGroup: (parentId: string, logic: 'AND' | 'OR') => void;
  setHavingGroupLogic: (groupId: string, logic: 'AND' | 'OR') => void;
  addGroupBy: (table: string, column: string) => void;
  removeGroupBy: (entry: ClauseEntry) => void;
  addSort: (table: string, column: string) => void;
  toggleSort: (entry: ClauseEntry) => void;
  removeSort: (entry: ClauseEntry) => void;
}

export interface BuildStatementProps {
  schema: BuildStatementSchema;
  state: BuildStatementState;
  actions: BuildStatementActions;
}

/**
 * The Build tab, Navicat style: one row per SQL clause (SELECT / FROM / WHERE /
 * GROUP BY / HAVING / ORDER BY), each row taking only the height of its own
 * content.
 *
 * The layout change is the point. The previous Excel-like grid spent one row
 * per selected column on eight inline controls, so four columns filled the
 * region and WHERE, GROUP BY, HAVING and ORDER BY were pushed out of sight —
 * `HAVING` did not exist at all. Here a column is a chip whose options live in
 * a dialog (`ColumnOptionsDialog`), which leaves the vertical space to the
 * clauses.
 */
export function BuildStatement({ schema, state, actions }: BuildStatementProps) {
  const { t } = useI18n();
  const [openColumn, setOpenColumn] = useState<{ table: string; column: string } | null>(null);

  const groupByEntries = useMemo(
    () => buildGroupByEntries(state.groupBy, state.selectedColumns),
    [state.groupBy, state.selectedColumns],
  );
  const orderByEntries = useMemo(
    () => buildOrderByEntries(state.orderBy, state.selectedColumns),
    [state.orderBy, state.selectedColumns],
  );

  /** Per-column criteria are merged into WHERE by the generator — show them. */
  const perColumnCriteria = state.selectedColumns.filter((c) => c.where);

  const openSelection = openColumn
    ? (state.selectedColumns.find(
        (c) => c.table === openColumn.table && c.column === openColumn.column,
      ) ?? { table: openColumn.table, column: openColumn.column })
    : null;

  return (
    <div className="flex min-w-0 flex-col divide-y divide-edge" data-testid="qb-statement">
      <ClauseRow label="SELECT" testId="qb-clause-select">
        <SelectClause
          selectedColumns={state.selectedColumns}
          allTables={schema.tables}
          allColumns={schema.columns}
          tableAliases={schema.aliases}
          distinct={state.distinct}
          onSetDistinct={actions.setDistinct}
          onOpenColumn={(table, column) => setOpenColumn({ table, column })}
          onRemoveColumn={actions.removeColumn}
          onAddColumn={actions.addColumn}
        />
      </ClauseRow>

      <ClauseRow label="FROM" testId="qb-clause-from">
        <FromClause
          selectedTables={schema.tables}
          tableAliases={schema.aliases}
          joins={state.joins}
          availableTables={schema.availableTables}
          onSetAlias={actions.setTableAlias}
          onRemoveTable={actions.removeTable}
          onAddTable={actions.addTable}
        />
      </ClauseRow>

      <ClauseRow label="WHERE" testId="qb-clause-where">
        {perColumnCriteria.length > 0 && (
          <div
            className="flex min-w-0 flex-wrap items-center gap-1.5"
            data-testid="qb-where-column-chips"
          >
            {perColumnCriteria.map((col) => (
              <Chip
                key={`${col.table}.${col.column}`}
                label={qualifiedRef(col.table, col.column, schema.aliases)}
                suffix={` ${col.where!.operator}${col.where!.value ? ` ${col.where!.value}` : ''}`}
                muted
                title={t('query.visualBuilder.columnOptionsTitle')}
                testId={`qb-where-column-chip-${col.table}-${col.column}`}
                onClick={() => setOpenColumn({ table: col.table, column: col.column })}
                onRemove={() => actions.updateColumn(col.table, col.column, { where: undefined })}
                removeTestId={`qb-where-column-remove-${col.table}-${col.column}`}
              />
            ))}
          </div>
        )}
        <ConditionClause
          group={state.where}
          testIdPrefix="qb-where"
          allTables={schema.tables}
          allColumns={schema.columns}
          tableAliases={schema.aliases}
          onAddCondition={actions.addCondition}
          onUpdateCondition={actions.updateCondition}
          onRemoveCondition={actions.removeCondition}
          onAddGroup={actions.addConditionGroup}
          onSetGroupLogic={actions.setGroupLogic}
        />
      </ClauseRow>

      <ClauseRow label="GROUP BY" testId="qb-clause-group-by">
        <GroupByClause
          items={groupByEntries}
          allTables={schema.tables}
          allColumns={schema.columns}
          tableAliases={schema.aliases}
          onAdd={actions.addGroupBy}
          onRemove={actions.removeGroupBy}
        />
      </ClauseRow>

      <ClauseRow
        label="HAVING"
        testId="qb-clause-having"
        title={t('query.visualBuilder.havingHint')}
      >
        <ConditionClause
          group={state.having}
          testIdPrefix="qb-having"
          allTables={schema.tables}
          allColumns={schema.columns}
          tableAliases={schema.aliases}
          allowAggregate
          onAddCondition={actions.addHavingCondition}
          onUpdateCondition={actions.updateHavingCondition}
          onRemoveCondition={actions.removeHavingCondition}
          onAddGroup={actions.addHavingGroup}
          onSetGroupLogic={actions.setHavingGroupLogic}
        />
      </ClauseRow>

      <ClauseRow label="ORDER BY" testId="qb-clause-order-by">
        <OrderByClause
          entries={orderByEntries}
          allTables={schema.tables}
          allColumns={schema.columns}
          tableAliases={schema.aliases}
          onAdd={actions.addSort}
          onToggle={actions.toggleSort}
          onRemove={actions.removeSort}
        />
      </ClauseRow>

      <ColumnOptionsDialog
        selection={openSelection}
        tableAliases={schema.aliases}
        onApply={actions.updateColumn}
        onRemove={actions.removeColumn}
        onClose={() => setOpenColumn(null)}
      />
    </div>
  );
}
