/**
 * Right-hand cluster of the 48px KV context bar: Safe-mode badge, the four band
 * buttons (refresh / `+` / import / export) and the `⋯` overflow menu.
 *
 * Split out of `RedisContextBar.tsx` so the bar itself stays a thin field
 * renderer (PRD §5 「组件薄 + 纯逻辑模块厚」, AGENTS.md's file-size rule). The
 * split is by *responsibility*, not by line count: everything here is a control
 * that asks the host for something, while the bar's own file renders server
 * facts.
 *
 * Every control routes through `request` with the frozen `KvSlotAction` payload
 * — including `flushDb`, which deliberately shows **no** driver-side confirm:
 * the host dispatcher runs the shared write gate first (PRD I-6 / contract F-3
 * ruling 2). Nothing here is hidden because the host might not have a handler
 * (ruling 1); an unwired action is the host's no-op plus warning.
 */
import { Download, MoreHorizontal, Plus, RefreshCw, Upload } from 'lucide-react';
import type { KvSlotAction } from '@datazen/driver-sdk';
import { Button, useI18n } from '@datazen/ui';
import { SafeModeBadge } from '../shared/SafeModeBadge';
import { formatSize } from '../shared/formatSize';
import { formatCompactCount, SCAN_BUDGET_TIERS, type MemoryReadout, type TypeChipsModel } from './contextBarModel';

/** i18n keys of the four scan-budget tiers (PRD §4 I-2). */
const BUDGET_OPTION_KEYS: Record<number, string> = {
  10_000: 'redis.contextBar.budget.10k',
  50_000: 'redis.contextBar.budget.50k',
  200_000: 'redis.contextBar.budget.200k',
  1_000_000: 'redis.contextBar.budget.1M',
};

export interface ContextBarActionsProps {
  request: (action: KvSlotAction) => void;
  /** `compact` ⇒ labels first, then the decorations move into the ⋯ menu. */
  compact: boolean;
  /** Carried into the ⋯ menu in `compact`, where the band no longer shows it. */
  memory: MemoryReadout | null;
  /** Carried into the ⋯ menu in `compact`; `null` when the band already shows it. */
  types: TypeChipsModel | null;
}

export function ContextBarActions({ request, compact, memory, types }: ContextBarActionsProps) {
  return (
    <>
      <SafeModeBadge />
      <ContextBarButton
        compact={compact}
        testId="redis-context-refresh"
        labelKey="redis.refresh"
        icon={<RefreshCw className="h-3.5 w-3.5" />}
        onClick={() => request({ type: 'refresh' })}
      />
      <ContextBarButton
        compact={compact}
        testId="redis-context-new-key"
        labelKey="redis.createKey"
        icon={<Plus className="h-3.5 w-3.5" />}
        onClick={() => request({ type: 'newKey' })}
      />
      <ContextBarButton
        compact={compact}
        testId="redis-context-import"
        labelKey="redis.importExportImport"
        icon={<Upload className="h-3.5 w-3.5" />}
        onClick={() => request({ type: 'import' })}
      />
      <ContextBarButton
        compact={compact}
        testId="redis-context-export"
        labelKey="redis.importExportExport"
        icon={<Download className="h-3.5 w-3.5" />}
        onClick={() => request({ type: 'export' })}
      />
      <OverflowMenu request={request} compact={compact} memory={memory} types={types} />
    </>
  );
}

/** A labelled-or-icon-only band button; `title` survives the label being dropped. */
function ContextBarButton({
  compact,
  testId,
  labelKey,
  icon,
  onClick,
}: {
  compact: boolean;
  testId: string;
  labelKey: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const label = t(labelKey);
  return (
    <Button
      variant="ghost"
      className="h-7 shrink-0 gap-1 px-1.5 text-xs"
      data-testid={testId}
      data-i18n-key={labelKey}
      data-labelled={compact ? 'false' : 'true'}
      title={label}
      onClick={onClick}
    >
      {icon}
      {!compact && <span className="whitespace-nowrap">{label}</span>}
    </Button>
  );
}

/**
 * `⋯` overflow menu (PRD §3.4): FLUSH / monitor / driver settings / scan-budget
 * tiers — plus, in `compact`, the two fields that left the band (memory and
 * chips), carrying the same numbers so no fact is lost to the narrow layout.
 *
 * A `<details>` element rather than a popover library: it is keyboard-operable
 * and dismissible without a portal or a focus trap, and the 48px band has no
 * room for an anchored panel's positioning problem.
 */
function OverflowMenu({
  request,
  compact,
  memory,
  types,
}: {
  request: (action: KvSlotAction) => void;
  compact: boolean;
  memory: { usedBytes: number; maxBytes: number | null } | null;
  types: { chips: Array<{ type: string; count: number }>; sample: unknown } | null;
}) {
  const { t } = useI18n();
  return (
    <details className="shrink-0" data-testid="redis-context-overflow">
      <summary
        className="flex h-7 cursor-pointer list-none items-center rounded px-1.5 text-fg-secondary hover:bg-surface-raised hover:text-fg"
        data-testid="redis-context-overflow-toggle"
        data-i18n-key="redis.contextBar.more"
        title={t('redis.contextBar.more')}
      >
        <MoreHorizontal className="h-4 w-4" />
      </summary>
      <div
        className="absolute right-2 z-20 mt-1 flex w-56 flex-col gap-0.5 rounded border border-edge bg-surface p-1 shadow-lg"
        data-testid="redis-context-overflow-menu"
        data-compact={compact ? 'true' : 'false'}
      >
        {compact && memory && (
          <OverflowRow
            testId="redis-context-overflow-memory"
            i18nKey="redis.contextBar.memory"
            text={t('redis.contextBar.memory', {
              used: formatSize(memory.usedBytes),
              max: memory.maxBytes === null ? '—' : formatSize(memory.maxBytes),
            })}
          />
        )}
        {compact && types && (
          <OverflowRow
            testId="redis-context-overflow-types"
            i18nKey="redis.contextBar.types"
            text={types.chips
              .map((chip) => `${chip.type} ${formatCompactCount(chip.count)}`)
              .join(' · ')}
          />
        )}
        <MenuItem
          testId="redis-context-menu-flush"
          variant="danger"
          labelKey="redis.flushDb"
          // No driver-side confirm: the host's gate runs first (PRD I-6 / F-3).
          onClick={() => request({ type: 'flushDb' })}
        />
        <MenuItem
          testId="redis-context-menu-monitor"
          labelKey="redis.monitor"
          onClick={() => request({ type: 'openMonitor' })}
        />
        <MenuItem
          testId="redis-context-menu-settings"
          labelKey="redis.contextBar.driverSettings"
          onClick={() => request({ type: 'openSettings' })}
        />
        <div className="my-0.5 border-t border-edge" />
        <span
          className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted"
          data-i18n-key="redis.contextBar.scanBudget"
        >
          {t('redis.contextBar.scanBudget')}
        </span>
        {SCAN_BUDGET_TIERS.map((tier) => (
          <MenuItem
            key={tier}
            testId={`redis-context-budget-${tier}`}
            labelKey={BUDGET_OPTION_KEYS[tier]}
            data={{ budget: tier }}
            onClick={() => request({ type: 'setScanBudget', value: tier })}
          />
        ))}
      </div>
    </details>
  );
}

function OverflowRow({
  testId,
  i18nKey,
  text,
}: {
  testId: string;
  i18nKey: string;
  text: string;
}) {
  return (
    <span
      className="px-2 py-1 font-mono text-[11px] text-fg-secondary"
      data-testid={testId}
      data-i18n-key={i18nKey}
    >
      {text}
    </span>
  );
}

function MenuItem({
  testId,
  labelKey,
  onClick,
  variant,
  data,
}: {
  testId: string;
  labelKey: string;
  onClick: () => void;
  variant?: 'danger';
  data?: Record<string, string | number>;
}) {
  const { t } = useI18n();
  const attributes: Record<string, string | number> = { ...data };
  return (
    <button
      type="button"
      className={
        variant === 'danger'
          ? 'rounded px-2 py-1 text-left text-xs text-danger hover:bg-danger/10'
          : 'rounded px-2 py-1 text-left text-xs text-fg-secondary hover:bg-surface-raised hover:text-fg'
      }
      data-testid={testId}
      data-i18n-key={labelKey}
      {...attributes}
      onClick={onClick}
    >
      {t(labelKey)}
    </button>
  );
}
