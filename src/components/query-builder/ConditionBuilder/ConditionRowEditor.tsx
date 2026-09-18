import { X } from 'lucide-react';
import type { QbCondition, QbOperator } from '../types';
import { Select, type SelectOption } from '../../ui/Select';
import { Input } from '../../ui/Input';
import { useI18n } from '../../../hooks/useI18n';
import { LIST_OPERATORS, NULL_OPERATORS, OPERATOR_OPTIONS } from '../operators';

export interface ConditionRowEditorProps {
  condition: QbCondition;
  /** `table.column` options drawn from the selected tables. */
  fieldOptions: SelectOption[];
  onChange: (patch: Partial<QbCondition>) => void;
  onRemove: () => void;
}

/** One `table.column <operator> value` row inside a condition group. */
export function ConditionRowEditor({
  condition,
  fieldOptions,
  onChange,
  onRemove,
}: ConditionRowEditorProps) {
  const { t } = useI18n();
  const isNullOp = NULL_OPERATORS.has(condition.operator);
  const isListOp = LIST_OPERATORS.has(condition.operator);

  return (
    <div className="flex items-center gap-1.5" data-testid="condition-row">
      <div className="min-w-[170px]" data-testid="condition-field-select">
        <Select
          value={`${condition.table}.${condition.column}`}
          options={fieldOptions}
          onChange={(val) => {
            const dot = val.indexOf('.');
            if (dot === -1) return;
            onChange({ table: val.substring(0, dot), column: val.substring(dot + 1) });
          }}
          placeholder="table.column"
          searchable
        />
      </div>

      <div className="w-[110px]">
        <Select
          value={condition.operator}
          options={OPERATOR_OPTIONS}
          onChange={(val) => onChange({ operator: val as QbOperator })}
          triggerDataAttrs={{ 'data-testid': 'condition-operator-select' }}
        />
      </div>

      {/* Value — omitted for IS NULL / IS NOT NULL */}
      {!isNullOp && (
        <Input
          value={condition.value ?? ''}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={isListOp ? t('query.visualBuilder.inHint') : t('query.visualBuilder.value')}
          className="h-8 flex-1 text-xs"
          data-testid="condition-value-input"
        />
      )}

      <button
        type="button"
        onClick={onRemove}
        title={t('query.visualBuilder.removeCondition')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-surface-raised hover:text-danger"
        data-testid="condition-remove-button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
