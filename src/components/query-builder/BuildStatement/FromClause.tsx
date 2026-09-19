import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../../hooks/useI18n';
import { buildJoinSteps } from '../../../lib/sqlDialects/queryBuilder';
import type { QbJoin } from '../types';
import { LinkSelect } from './LinkSelect';
import { qualifiedRef } from './columnOptions';

export interface FromClauseProps {
  selectedTables: string[];
  tableAliases: Record<string, string>;
  joins: QbJoin[];
  /** Tables of the connection that are not in the query yet. */
  availableTables: string[];
  onSetAlias: (table: string, alias: string) => void;
  onRemoveTable: (table: string) => void;
  onAddTable: (table: string) => void;
}

/**
 * The FROM row: the driving table, one line per JOIN and a link to add tables.
 *
 * The join lines are produced by `buildJoinSteps` — the same graph walk the SQL
 * generator uses — so the order, the orientation of each `ON` predicate and the
 * merging of composite keys are identical to the emitted statement by
 * construction, not by coincidence.
 */
export function FromClause({
  selectedTables,
  tableAliases,
  joins,
  availableTables,
  onSetAlias,
  onRemoveTable,
  onAddTable,
}: FromClauseProps) {
  const { t } = useI18n();

  const fromTable = selectedTables[0];
  const steps = useMemo(() => buildJoinSteps(joins, fromTable), [joins, fromTable]);

  const included = useMemo(() => {
    const set = new Set<string>();
    if (fromTable) set.add(fromTable);
    for (const step of steps) set.add(step.targetTable);
    return set;
  }, [fromTable, steps]);

  const unjoined = selectedTables.filter((table) => table !== fromTable && !included.has(table));

  const aliasInput = (table: string) => (
    <input
      type="text"
      value={tableAliases[table] ?? ''}
      placeholder={t('query.visualBuilder.alias')}
      onChange={(e) => onSetAlias(table, e.target.value)}
      className="h-6 w-16 rounded border border-edge bg-surface-inset px-1.5 text-[12px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
      data-testid={`qb-from-alias-${table}`}
    />
  );

  const removeButton = (table: string) => (
    <button
      type="button"
      onClick={() => onRemoveTable(table)}
      title={t('query.visualBuilder.removeTable')}
      className="rounded p-0.5 text-fg-muted transition-colors hover:text-danger"
      data-testid={`qb-from-remove-${table}`}
    >
      <X className="h-3 w-3" />
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="qb-from-clause">
      {fromTable && (
        <div
          className="flex min-w-0 items-center gap-1.5"
          data-testid={`qb-from-table-${fromTable}`}
        >
          <span className="truncate text-[12px] font-medium text-fg">{fromTable}</span>
          <span className="text-[11px] text-fg-muted">AS</span>
          {aliasInput(fromTable)}
          {removeButton(fromTable)}
        </div>
      )}

      {steps.map((step, index) => {
        const on = step.predicates
          .map(
            (p) =>
              `${qualifiedRef(p.sourceTable, p.sourceColumn, tableAliases)} = ` +
              `${qualifiedRef(step.targetTable, p.targetColumn, tableAliases)}`,
          )
          .join(' AND ');
        return (
          // One line per join: a clause row only earns its vertical space if it
          // says something per line, and the JOIN type reads fine inline.
          <div
            key={`${step.targetTable}-${index}`}
            className="flex min-w-0 flex-wrap items-center gap-1.5"
            data-testid={`qb-from-join-${index}`}
            data-join-target={step.targetTable}
            data-join-detached={step.detached ? 'true' : undefined}
          >
            <span className="shrink-0 text-[11px] font-medium text-fg-muted">{step.type} JOIN</span>
            <span className="truncate text-[12px] font-medium text-fg">{step.targetTable}</span>
            <span className="text-[11px] text-fg-muted">AS</span>
            {aliasInput(step.targetTable)}
            <span className="text-[11px] text-fg-muted">ON</span>
            <span className="truncate font-mono text-[12px] text-accent">{on}</span>
            {removeButton(step.targetTable)}
          </div>
        );
      })}

      {unjoined.map((table) => (
        <div
          key={table}
          className="flex min-w-0 items-center gap-1.5"
          data-testid={`qb-from-unjoined-${table}`}
        >
          <span className="truncate text-[12px] text-fg-muted">{table}</span>
          <span className="text-[11px] text-fg-muted">AS</span>
          {aliasInput(table)}
          <span className="text-[11px] text-warning">{t('query.visualBuilder.unjoinedTable')}</span>
          {removeButton(table)}
        </div>
      ))}

      <LinkSelect
        label={t('query.visualBuilder.addTables')}
        options={availableTables.map((table) => ({ value: table, label: table }))}
        testId="qb-add-tables"
        onPick={onAddTable}
      />
    </div>
  );
}
