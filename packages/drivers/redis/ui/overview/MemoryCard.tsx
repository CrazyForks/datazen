import { useI18n, cn } from '@datazen/ui';
import { OverviewCard } from './OverviewCard';
import { formatSize } from '../shared/formatSize';
import type { MemoryModel } from './overviewModel';
import type { OverviewSourceStatus } from './useOverviewData';

/**
 * 卡 2 — 内存（PRD §3.1：used/max 进度条 + 碎片率）.
 *
 * Big Keys have been moved to PerformanceCard (combined with Slowlog)
 * to reduce vertical space waste in the grid layout.
 */
export interface MemoryCardProps {
  infoStatus: OverviewSourceStatus;
  memoryStatus: OverviewSourceStatus;
  model: MemoryModel;
  onRetry: () => void;
}

const FRAG_DECIMALS = 2;

function fragText(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(FRAG_DECIMALS);
}

function percentText(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(1)}%`;
}

export function MemoryCard({
  infoStatus,
  memoryStatus: _memoryStatus,
  model,
  onRetry,
}: MemoryCardProps) {
  const { t } = useI18n();
  const barPercent = model.usedPercent ?? 0;
  const nothingToReport =
    infoStatus === 'ready' && model.usedBytes === null && model.fragRatio === null;

  return (
    <OverviewCard
      cardId="memory"
      titleKey="redis.overview.memory.title"
      source="info"
      status={infoStatus}
      empty={nothingToReport}
      emptyKey="redis.overview.memory.empty"
      unauthorizedKey="redis.overview.memory.unauthorized"
      onRetry={onRetry}
    >
      <div className="flex flex-col gap-1.5 p-2.5 text-xs">
        <div data-overview-memory-gauge className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-fg-muted">{t('redis.overview.memory.used')}</span>
            <span data-overview-memory-used className="font-mono tabular-nums text-fg">
              {model.usedHuman ?? (model.usedBytes === null ? '—' : formatSize(model.usedBytes))}
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={model.unlimited ? undefined : 100}
            aria-valuenow={model.unlimited ? undefined : Math.round(barPercent)}
            aria-label={t('redis.overview.memory.title')}
            data-overview-memory-bar
            data-overview-memory-bar-state={model.unlimited ? 'unlimited' : 'bounded'}
            data-overview-memory-bar-percent={Math.round(barPercent)}
            className="h-2 w-full overflow-hidden rounded-full bg-surface-raised"
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-300',
                !model.unlimited && barPercent >= 90 ? 'bg-danger' : 'bg-accent',
              )}
              style={{ width: `${model.unlimited ? 100 : barPercent}%` }}
            />
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="text-fg-muted">
              {model.unlimited
                ? t('redis.overview.memory.maxUnlimited')
                : t('redis.overview.memory.max')}
            </span>
            <span
              data-overview-memory-max={model.unlimited ? 'unlimited' : 'bounded'}
              className="font-mono tabular-nums text-fg-secondary"
            >
              {model.unlimited
                ? t('redis.overview.memory.unlimited')
                : (model.maxHuman ?? (model.maxBytes === null ? '—' : formatSize(model.maxBytes)))}
            </span>
          </div>

          <div className="mt-0.5 flex items-baseline justify-between gap-2">
            <span className="text-fg-muted">{t('redis.overview.memory.fragRatio')}</span>
            <span
              data-overview-memory-frag={
                model.fragRatio === null ? 'unknown' : model.fragWarn ? 'warn' : 'ok'
              }
              className={cn(
                'font-mono tabular-nums',
                model.fragWarn ? 'font-semibold text-warning' : 'text-fg',
              )}
            >
              {fragText(model.fragRatio)}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="text-fg-muted">{t('redis.overview.memory.policy')}</span>
            <span
              data-overview-memory-policy={model.policy ?? 'none'}
              className="font-mono text-fg-secondary"
            >
              {model.policy ?? '—'}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-2 border-t border-edge/50 pt-1">
            <span className="text-fg-muted">{t('redis.overview.memory.usedPercent')}</span>
            <span data-overview-memory-percent className="font-mono tabular-nums text-fg-secondary">
              {percentText(model.usedPercent)}
            </span>
          </div>
        </div>
      </div>
    </OverviewCard>
  );
}
