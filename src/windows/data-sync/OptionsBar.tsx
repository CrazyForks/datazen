import { useI18n } from '../../hooks/useI18n';
import type { SyncOptions } from '../../commands/sync';

interface OptionsBarProps {
  options: SyncOptions;
  onChange: (next: SyncOptions) => void;
  onEnableDelete: () => void;
}

export function OptionsBar({ options, onChange, onEnableDelete }: OptionsBarProps) {
  const { t } = useI18n();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-edge bg-surface-alt/50 px-6 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {t('sync.optionsTitle')}
      </span>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-3.5 w-3.5"
          data-testid="data-sync-option-insert"
          checked={options.insert}
          onChange={(e) => onChange({ ...options, insert: e.target.checked })}
        />
        {t('sync.optionInsert')}
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-3.5 w-3.5"
          data-testid="data-sync-option-update"
          checked={options.update}
          onChange={(e) => onChange({ ...options, update: e.target.checked })}
        />
        {t('sync.optionUpdate')}
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-3.5 w-3.5"
          data-testid="data-sync-option-delete"
          checked={options.delete}
          onChange={(e) => {
            if (e.target.checked) onEnableDelete();
            else onChange({ ...options, delete: false });
          }}
        />
        {t('sync.optionDelete')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span>{t('sync.conflictPolicyLabel')}</span>
        <select
          className="rounded border border-edge bg-surface px-2 py-1 text-sm"
          data-testid="data-sync-conflict-policy"
          value={options.conflictPolicy ?? 'abort'}
          onChange={(e) =>
            onChange({
              ...options,
              conflictPolicy: e.target.value as NonNullable<SyncOptions['conflictPolicy']>,
            })
          }
        >
          <option value="abort">{t('sync.conflictPolicyAbort')}</option>
          <option value="skip">{t('sync.conflictPolicySkip')}</option>
          <option value="force">{t('sync.conflictPolicyForce')}</option>
        </select>
      </label>
      {options.conflictPolicy && options.conflictPolicy !== 'abort' ? (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          {options.conflictPolicy === 'skip'
            ? t('sync.conflictPolicySkipWarning')
            : t('sync.conflictPolicyForceWarning')}
        </span>
      ) : null}
      <span className="text-xs text-fg-muted">{t('sync.optionsHint')}</span>
    </div>
  );
}
