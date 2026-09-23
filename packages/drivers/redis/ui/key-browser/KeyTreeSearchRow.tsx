import { Clock, Search, Sparkles } from 'lucide-react';
import { Input, Select, cn, useI18n } from '@datazen/ui';
import { KEY_TYPE_FILTERS } from './keyTree';

/**
 * Row R2 of the key-tree column header (PRD §3.2 屏 B 左列): the pattern input
 * plus the filters that shape what the pattern means.
 *
 * The three chips are toggles over existing scan parameters, not decoration:
 *  - `* 模糊` wraps a *literal* input into `*input*` when applying (see
 *    {@link toScanPattern}); a pattern that already carries a glob char is sent
 *    verbatim, so the chip can never silently widen a hand-written glob;
 *  - `仅无过期` maps to `noTtlOnly` (server-side filter, re-scans);
 *  - `类型 ▾` maps to `keyType` — kept from the previous toolbar on purpose: the
 *    reference product has no type filter, so this is a differentiator (PRD §3.2).
 *
 * Key templates and the per-connection pattern history are P2 and deliberately
 * not here (task book §1 D-2).
 */

export interface KeyTreeSearchRowProps {
  pattern: string;
  onPatternChange: (pattern: string) => void;
  /** `Enter` / search button — resolves the pattern and restarts the scan. */
  onApply: () => void;
  /**
   * `Esc` — the row's exit transition: clear the input **and** the applied
   * filter (redis-tree-ui-BUG-001). The pattern now owns the tree rows, so
   * clearing only the text would leave the tree filtered by a pattern nothing on
   * screen mentions; a cleared filter has to take effect the same way `Enter`
   * does.
   */
  onClearFilter: () => void;
  fuzzy: boolean;
  onFuzzyChange: (fuzzy: boolean) => void;
  noTtlOnly: boolean;
  onNoTtlOnlyChange: (noTtlOnly: boolean) => void;
  keyType: string;
  onKeyTypeChange: (keyType: string) => void;
  /** Value / all scope: the input holds a substring query, not a glob. */
  scope: 'key' | 'value' | 'all';
}

export function KeyTreeSearchRow({
  pattern,
  onPatternChange,
  onApply,
  onClearFilter,
  fuzzy,
  onFuzzyChange,
  noTtlOnly,
  onNoTtlOnlyChange,
  keyType,
  onKeyTypeChange,
  scope,
}: KeyTreeSearchRowProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-1.5" data-testid="redis-tree-search-row">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
        <Input
          value={pattern}
          onChange={(e) => onPatternChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onApply();
            if (e.key === 'Escape') onClearFilter();
          }}
          placeholder={scope === 'key' ? t('redis.searchKeys') : t('redis.search.valuePlaceholder')}
          className="h-7 pl-7 text-xs"
          data-testid="redis-search-input"
          data-scope={scope}
          data-fuzzy={fuzzy ? 'on' : 'off'}
        />
      </div>
      <Chip
        testId="redis-tree-chip-fuzzy"
        active={fuzzy}
        activeValue={fuzzy ? 'on' : 'off'}
        title={t('redis.tree.fuzzyHint')}
        Icon={Sparkles}
        label="*"
        onClick={() => onFuzzyChange(!fuzzy)}
      />
      <Chip
        testId="redis-tree-chip-no-ttl"
        active={noTtlOnly}
        activeValue={noTtlOnly ? 'on' : 'off'}
        title={t('redis.noTtlOnly')}
        Icon={Clock}
        label={t('redis.noTtlOnly')}
        onClick={() => onNoTtlOnlyChange(!noTtlOnly)}
      />
      <div
        className="shrink-0"
        data-testid="redis-tree-chip-type"
        data-key-type={keyType}
      >
        <Select
          value={keyType}
          onChange={(value) => onKeyTypeChange(value)}
          options={KEY_TYPE_FILTERS.map((item) => ({
            value: item.value,
            label: t(item.labelKey as 'redis.type'),
          }))}
          className="h-7 min-w-24 text-xs"
          title={t('redis.filterByType')}
          aria-label={t('redis.filterByType')}
          triggerDataAttrs={{ 'data-testid': 'redis-tree-type-filter' }}
        />
      </div>
    </div>
  );
}

interface ChipProps {
  testId: string;
  active: boolean;
  activeValue: string;
  title: string;
  Icon: typeof Search;
  label: string;
  onClick: () => void;
}

function Chip({ testId, active, activeValue, title, Icon, label, onClick }: ChipProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      data-testid={testId}
      data-active={activeValue}
      onClick={onClick}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors',
        active
          ? 'border-accent/50 bg-accent/10 text-accent'
          : 'border-edge text-fg-secondary hover:bg-surface-raised hover:text-fg',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}
