import { X } from 'lucide-react';
import { Input } from '../ui/Input';
import { Select, type SelectOption } from '../ui/Select';
import { useI18n } from '../../hooks/useI18n';
import type { QbCondition, QbOperator } from './types';

const OPERATORS: QbOperator[] = [
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'LIKE',
  'NOT LIKE',
  'IN',
  'NOT IN',
  'IS NULL',
  'IS NOT NULL',
];

const OPERATOR_OPTIONS: SelectOption[] = OPERATORS.map((op) => ({
  value: op,
  label: op,
}));

interface ConditionRowProps {
  condition: QbCondition;
  selectedTables: string[];
  columnMap: Record<string, string[]>;
  onUpdate: (patch: Partial<QbCondition>) => void;
  onRemove: () => void;
}

export function ConditionRow({
  condition,
  selectedTables,
  columnMap,
  onUpdate,
  onRemove,
}: ConditionRowProps) {
  const { t } = useI18n();

  const currentColumns = columnMap[condition.table] ?? [];
  const isNullOp = condition.operator === 'IS NULL' || condition.operator === 'IS NOT NULL';
  const isInOp = condition.operator === 'IN' || condition.operator === 'NOT IN';

  const tableOptions: SelectOption[] = selectedTables.map((tbl) => ({
    value: tbl,
    label: tbl,
  }));

  const columnOptions: SelectOption[] = currentColumns.map((col) => ({
    value: col,
    label: col,
  }));

  return (
    <div className="flex items-center gap-1.5">
      {/* Table selector */}
      <Select
        value={condition.table}
        options={tableOptions}
        onChange={(v) => onUpdate({ table: v, column: '' })}
        className="h-7 w-24 text-[11px]"
        fitContent
        labels={{
          placeholder: t('query.visualBuilder.table'),
          noMatches: t('common.noMatches'),
          toggleOptions: '',
        }}
      />

      {/* Column selector */}
      <Select
        value={condition.column}
        options={columnOptions}
        onChange={(v) => onUpdate({ column: v })}
        className="h-7 w-24 text-[11px]"
        fitContent
        labels={{
          placeholder: t('query.visualBuilder.column'),
          noMatches: t('common.noMatches'),
          toggleOptions: '',
        }}
      />

      {/* Operator */}
      <Select
        value={condition.operator}
        options={OPERATOR_OPTIONS}
        onChange={(v) => onUpdate({ operator: v as QbOperator })}
        className="h-7 w-24 text-[11px]"
        fitContent
        labels={{
          placeholder: t('query.visualBuilder.operator'),
          noMatches: t('common.noMatches'),
          toggleOptions: '',
        }}
      />

      {/* Value (hidden for IS NULL / IS NOT NULL) */}
      {!isNullOp && (
        <Input
          value={condition.value ?? ''}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder={
            isInOp
              ? t('query.visualBuilder.inPlaceholder')
              : t('query.visualBuilder.valuePlaceholder')
          }
          className="h-7 min-w-0 flex-1 text-[11px]"
        />
      )}

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        title={t('query.visualBuilder.removeCondition')}
        className="flex h-7 shrink-0 items-center justify-center rounded px-1.5 text-fg-muted hover:bg-danger/15 hover:text-danger"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
