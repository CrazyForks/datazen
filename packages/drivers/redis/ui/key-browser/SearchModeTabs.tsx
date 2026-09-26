import { useI18n } from '@datazen/ui';
import { cn } from '@datazen/ui';

export type SearchMode = 'key' | 'value' | 'all';

const MODES: { value: SearchMode; labelKey: string }[] = [
  { value: 'key', labelKey: 'redis.search.modeKey' },
  { value: 'value', labelKey: 'redis.search.modeValue' },
  { value: 'all', labelKey: 'redis.search.modeAll' },
];

export interface SearchModeTabsProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
}

/**
 * Key / Value / All search-scope tabs (R6).
 *
 * Text only. Each of the three used to carry an icon, and the group shares one
 * `h-7` row with the pattern input, the two filter chips and the apply button —
 * at that width the icons cost more horizontal room than the labels needed, and
 * `key` / `value` / `all` are already unambiguous words. The selected state is
 * carried by `bg-accent/10 text-accent` plus `aria-selected`, so nothing that
 * identified the scope depended on the icon.
 */
export function SearchModeTabs({ mode, onChange }: SearchModeTabsProps) {
  const { t } = useI18n();
  return (
    <div
      className="flex overflow-hidden rounded-md border border-edge"
      role="tablist"
      data-testid="redis-search-mode-tabs"
    >
      {MODES.map(({ value, labelKey }, idx) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          data-testid={`redis-search-mode-${value}`}
          onClick={() => onChange(value)}
          className={cn(
            'flex h-7 items-center px-2 text-xs transition-colors',
            idx > 0 && 'border-l border-edge',
            mode === value
              ? 'bg-accent/10 text-accent'
              : 'text-fg-secondary hover:bg-surface-raised',
          )}
        >
          {t(labelKey as 'redis.search.modeKey')}
        </button>
      ))}
    </div>
  );
}
