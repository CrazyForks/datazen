import { useState, useCallback } from 'react';
import type { QbCondition, QbOperator } from '../types';
import { Dialog } from '../../ui/Dialog';
import { Select, type SelectOption } from '../../ui/Select';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';

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

const NULL_OPERATORS = new Set<QbOperator>(['IS NULL', 'IS NOT NULL']);

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
  const [operator, setOperator] = useState<QbOperator>(condition?.operator ?? '=');
  const [value, setValue] = useState(condition?.value ?? '');

  const isNullOp = NULL_OPERATORS.has(operator);

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
      title={`Where — ${fieldLabel}`}
      onClose={onClose}
      testId="where-editor-dialog"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave}>
            Save
          </Button>
        </>
      }
      className="max-w-sm"
    >
      <div className="flex flex-col gap-4" onKeyDown={handleKeyDown}>
        {/* Operator */}
        <div>
          <label className="mb-1 block text-xs text-fg-secondary">Operator</label>
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
            <label className="mb-1 block text-xs text-fg-secondary">Value</label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                operator === 'IN' || operator === 'NOT IN' ? 'val1, val2, ...' : 'Enter value…'
              }
              data-testid="where-value-input"
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
