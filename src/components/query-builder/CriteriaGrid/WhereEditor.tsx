import { useState, useCallback } from 'react';
import type { QbCondition, QbOperator } from '../types';
import { Dialog } from '../../ui/Dialog';
import { Select } from '../../ui/Select';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { useI18n } from '../../../hooks/useI18n';
import { LIST_OPERATORS, NULL_OPERATORS, OPERATOR_OPTIONS } from '../operators';

export interface WhereEditorProps {
  open: boolean;
  /** The condition being edited, or null for a new condition. */
  condition: QbCondition | null;
  /** The table.column label for the field being edited. */
  fieldLabel: string;
  onClose: () => void;
  onSave: (patch: Partial<QbCondition>) => void;
}

export function WhereEditor({ open, condition, fieldLabel, onClose, onSave }: WhereEditorProps) {
  const { t } = useI18n();
  const [operator, setOperator] = useState<QbOperator>(condition?.operator ?? '=');
  const [value, setValue] = useState(condition?.value ?? '');

  const isNullOp = NULL_OPERATORS.has(operator);
  const isListOp = LIST_OPERATORS.has(operator);

  const handleSave = useCallback(() => {
    onSave({ operator, value: isNullOp ? null : value });
    onClose();
  }, [operator, value, isNullOp, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  return (
    <Dialog
      open={open}
      title={`${t('query.visualBuilder.where')} — ${fieldLabel}`}
      onClose={onClose}
      testId="where-editor-dialog"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="where-cancel-button">
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} data-testid="where-save-button">
            {t('common.save')}
          </Button>
        </>
      }
      className="max-w-sm"
    >
      <div className="flex flex-col gap-4" onKeyDown={handleKeyDown}>
        {/* Operator */}
        <div>
          <label className="mb-1 block text-xs text-fg-secondary">
            {t('query.visualBuilder.operator')}
          </label>
          <Select
            value={operator}
            options={OPERATOR_OPTIONS}
            onChange={(v) => setOperator(v as QbOperator)}
            triggerDataAttrs={{ 'data-testid': 'where-operator-select' }}
          />
        </div>

        {/* Value — hidden for IS NULL / IS NOT NULL */}
        {!isNullOp && (
          <div>
            <label className="mb-1 block text-xs text-fg-secondary">
              {t('query.visualBuilder.value')}
            </label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                isListOp
                  ? t('query.visualBuilder.inHint')
                  : t('query.visualBuilder.valuePlaceholder')
              }
              data-testid="where-value-input"
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
