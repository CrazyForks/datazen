import { useI18n, cn } from '@datazen/ui';
import type { DatabaseTypeMeta } from '@datazen/driver-sdk';
import type { BannerPill } from './overviewModel';
import type { OverviewJumpHandler, OverviewJumpTarget } from './overviewNavigation';
import { jumpStateAttribute } from './overviewNavigation';
import { redisMeta } from '../shared/meta';

/**
 * 屏 A 头部横幅 —— 压缩到 56px（PRD §3.1 第一行）。
 *
 * The SQL home banner carries a one-line subtitle; here the subtitle is replaced
 * by three **clickable pills** (`redis_version` / `mode` / `used_memory`) that
 * request the matching monitor sub-page. Height is fixed at `h-14` = 56px.
 */
export interface RedisOverviewBannerProps {
  connectionName: string;
  pills: BannerPill[];
  loading: boolean;
  onJump: (target: OverviewJumpTarget) => void;
  jumpHandler?: OverviewJumpHandler;
  meta?: Pick<DatabaseTypeMeta, 'iconBg' | 'iconColor' | 'label'>;
}

const PILL_LABEL: Record<BannerPill['id'], string> = {
  version: 'redis.overview.pill.version',
  mode: 'redis.overview.pill.mode',
  usedMemory: 'redis.overview.pill.usedMemory',
};

export function RedisOverviewBanner({
  connectionName,
  pills,
  loading,
  onJump,
  jumpHandler,
  meta = redisMeta,
}: RedisOverviewBannerProps) {
  const { t } = useI18n();
  const jumpState = jumpStateAttribute(jumpHandler);

  return (
    <header
      data-overview-banner
      className="flex h-14 shrink-0 items-center gap-3 border-b border-edge bg-surface-alt px-4"
    >
      <span
        data-overview-banner-icon
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
          meta.iconBg,
          meta.iconColor,
        )}
        aria-hidden="true"
      >
        {(meta.label ?? 'R').slice(0, 1)}
      </span>

      <div className="flex min-w-0 flex-col justify-center">
        <div className="flex items-center gap-2">
          <span
            data-overview-banner-name
            className="truncate text-sm font-semibold text-fg"
            title={connectionName}
          >
            {connectionName}
          </span>
          <span
            data-overview-banner-status={loading ? 'loading' : 'connected'}
            className={cn(
              'shrink-0 rounded-[9px] border px-2 py-0.5 text-[11px] font-semibold',
              loading
                ? 'border-edge text-fg-muted'
                : 'border-success/20 bg-success/10 text-success',
            )}
          >
            {loading ? t('redis.overview.loading') : t('redis.overview.connected')}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-x-auto">
        {pills.map((pill) => (
          <button
            key={pill.id}
            type="button"
            data-overview-pill={pill.id}
            data-overview-jump={jumpState}
            data-overview-jump-target={`monitor:${pill.monitorTarget}`}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 text-[11px] text-fg-secondary transition-colors hover:border-accent/40 hover:text-fg"
            onClick={() => onJump({ kind: 'monitor', section: pill.monitorTarget })}
          >
            <span className="text-fg-muted">{t(PILL_LABEL[pill.id])}</span>
            <span
              data-overview-pill-value={pill.id}
              className="font-mono font-semibold text-fg"
            >
              {pill.value ?? '—'}
            </span>
          </button>
        ))}
      </div>
    </header>
  );
}
