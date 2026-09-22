import { useI18n, cn } from '@datazen/ui';
import { OverviewCard } from './OverviewCard';
import { formatSize } from '../shared/formatSize';
import type { BigKeyRow, MemoryModel } from './overviewModel';
import type { OverviewSourceStatus } from './useOverviewData';
import type { OverviewJumpHandler, OverviewJumpTarget } from './overviewNavigation';
import { jumpStateAttribute, typeBadgeClass } from './overviewNavigation';

/**
 * 卡 2 — 内存（PRD §3.1：used/max 进度条 + 碎片率 + `memory_sample` Top5 大 key）.
 *
 * The gauge is pure `INFO` (always available); only the Top-5 list depends on the
 * gated `memory_sample` command, so its 未授权 / 空 / 失败 states are resolved
 * separately below the gauge instead of blanking the whole card (I-11).
 *
 * `memory_sample` resolves `MEMORY USAGE` + `TYPE` + `PTTL` for the whole sample
 * in one backend batch, so 键名 / 类型 / 字节 / TTL are all four PRD columns and
 * they come from that single 屏 A command — no extra per-key round trip, so the
 * "zero 键级往返" invariant is intact. A key deleted between `SCAN` and the field
 * read renders a distinguishable 已消失 / empty state, never a red error.
 */
export interface MemoryCardProps {
  infoStatus: OverviewSourceStatus;
  memoryStatus: OverviewSourceStatus;
  model: MemoryModel;
  bigKeys: BigKeyRow[];
  /** db the sample was taken from — 屏 A has no panel, so this is the connection's db. */
  sampledDbIndex: number;
  truncated?: boolean;
  onRetry: () => void;
  onJump: (target: OverviewJumpTarget) => void;
  jumpHandler?: OverviewJumpHandler;
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

type TFn = ReturnType<typeof useI18n>['t'];

/**
 * TTL cell for a big-key row. `PTTL` sentinels map to the same vocabulary the
 * key tree uses (`redis.noExpiry` / `redis.seconds`); a key that vanished
 * between `SCAN` and the field read gets its own labelled empty state, and an
 * unreadable reply shows the neutral em dash — never a fabricated count.
 */
function bigKeyTtlText(row: BigKeyRow, t: TFn): string {
  if (row.missing) return t('redis.overview.memory.bigKeyGone');
  const ttl = row.ttlMs;
  if (ttl === null || (ttl < 0 && ttl !== -1)) return '—';
  if (ttl === -1) return t('redis.noExpiry');
  return `${Math.round(ttl / 1000)}${t('redis.seconds')}`;
}

export function MemoryCard({
  infoStatus,
  memoryStatus,
  model,
  bigKeys,
  sampledDbIndex,
  truncated = false,
  onRetry,
  onJump,
  jumpHandler,
}: MemoryCardProps) {
  const { t } = useI18n();
  const jumpState = jumpStateAttribute(jumpHandler);
  // `buildMemoryModel` already clamps `usedPercent` to [0,100] (null when the
  // instance has no maxmemory); the unlimited gauge shape is driven off
  // `model.unlimited` below, so the view only needs the null→0 fallback here.
  const barPercent = model.usedPercent ?? 0;
  const nothingToReport =
    infoStatus === 'ready' &&
    model.usedBytes === null &&
    model.fragRatio === null &&
    bigKeys.length === 0;

  return (
    <OverviewCard
      cardId="memory"
      titleKey="redis.overview.memory.title"
      source="info + memory_sample"
      status={infoStatus}
      empty={nothingToReport}
      emptyKey="redis.overview.memory.empty"
      unauthorizedKey="redis.overview.memory.unauthorized"
      onRetry={onRetry}
    >
      <div className="flex flex-col gap-3 p-3 text-xs">
        <div data-overview-memory-gauge className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-fg-muted">{t('redis.overview.memory.used')}</span>
            <span
              data-overview-memory-used
              className="font-mono tabular-nums text-fg"
            >
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
              {model.unlimited ? t('redis.overview.memory.maxUnlimited') : t('redis.overview.memory.max')}
            </span>
            <span
              data-overview-memory-max={model.unlimited ? 'unlimited' : 'bounded'}
              className="font-mono tabular-nums text-fg-secondary"
            >
              {model.unlimited
                ? t('redis.overview.memory.unlimited')
                : model.maxHuman ?? (model.maxBytes === null ? '—' : formatSize(model.maxBytes))}
            </span>
          </div>

          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-fg-muted">{t('redis.overview.memory.fragRatio')}</span>
            <span
              data-overview-memory-frag={model.fragRatio === null ? 'unknown' : model.fragWarn ? 'warn' : 'ok'}
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
            <span data-overview-memory-policy={model.policy ?? 'none'} className="font-mono text-fg-secondary">
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

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-secondary">
              {t('redis.overview.memory.bigKeys')}
            </h4>
            <code data-overview-memory-sample-db className="font-mono text-[10px] text-fg-muted">
              {t('redis.overview.memory.sampledDb', { db: `db${sampledDbIndex}` })}
            </code>
          </div>

          {memoryStatus === 'loading' ? (
            <p data-overview-bigkey-state="loading" className="py-2 text-fg-muted">
              {t('redis.overview.loading')}
            </p>
          ) : null}

          {memoryStatus === 'unauthorized' ? (
            <div data-overview-bigkey-state="unauthorized" className="flex flex-col gap-0.5 py-2">
              <span className="text-warning">{t('redis.overview.memory.bigKeysUnauthorized')}</span>
              <span className="text-fg-muted">{t('redis.overview.memory.bigKeysUnauthorizedHint')}</span>
            </div>
          ) : null}

          {memoryStatus === 'failed' ? (
            <p data-overview-bigkey-state="failed" className="py-2 text-danger">
              {t('redis.overview.loadFailed')}
            </p>
          ) : null}

          {memoryStatus === 'ready' && bigKeys.length === 0 ? (
            <p data-overview-bigkey-state="empty" className="py-2 text-fg-muted">
              {t('redis.overview.memory.bigKeysEmpty')}
            </p>
          ) : null}

          {memoryStatus === 'ready' && bigKeys.length > 0 ? (
            <>
              {truncated ? (
                <p data-overview-bigkey-truncated className="text-warning">
                  {t('redis.overview.memory.truncated')}
                </p>
              ) : null}
              <ul className="flex flex-col">
                {bigKeys.map((row) => (
                  <li key={row.key}>
                    <button
                      type="button"
                      data-overview-bigkey={row.rank}
                      data-overview-key={row.key}
                      data-overview-db-index={sampledDbIndex}
                      data-overview-bigkey-type={row.keyType ?? 'unknown'}
                      data-overview-bigkey-ttl-ms={row.ttlMs ?? ''}
                      data-overview-bigkey-missing={row.missing ? 'true' : 'false'}
                      data-overview-jump={jumpState}
                      className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-surface-raised"
                      onClick={() =>
                        onJump({
                          kind: 'key',
                          dbIndex: sampledDbIndex,
                          key: row.key,
                          keyType: row.keyType,
                        })
                      }
                    >
                      <span className="w-4 shrink-0 font-mono text-[10px] text-fg-muted">{row.rank}</span>
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-fg"
                        title={row.key}
                      >
                        {row.key}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded border px-1 py-0.5 font-mono text-[10px] leading-none',
                          typeBadgeClass(row.keyType),
                        )}
                      >
                        {row.keyType ?? t('redis.overview.typeUnknown')}
                      </span>
                      <span data-overview-bigkey-bytes={row.rank} className="shrink-0 font-mono tabular-nums text-fg-secondary">
                        {formatSize(row.bytes)}
                      </span>
                      <span
                        data-overview-bigkey-ttl={row.rank}
                        className={cn(
                          'w-14 shrink-0 text-right font-mono tabular-nums',
                          row.missing ? 'text-fg-muted' : 'text-fg-secondary',
                        )}
                      >
                        {bigKeyTtlText(row, t)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </OverviewCard>
  );
}
