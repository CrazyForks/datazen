import { useI18n } from '@datazen/ui';
import { OverviewCard } from './OverviewCard';
import type { SlowlogRow } from './overviewModel';
import type { OverviewSourceStatus } from './useOverviewData';

/**
 * 卡 4 — 慢查询 Top5（PRD §3.1：序号 / 耗时 µs / 命令摘要 / 客户端地址）.
 *
 * The empty state is not a blank hole: it explains what `SLOWLOG GET` reports and
 * why it can legitimately be empty (I-11). A locked-down server that refuses
 * `SLOWLOG GET` (`redis:allow-slowlog-get`) gets its own 未授权 wording.
 */
export interface SlowlogCardProps {
  status: OverviewSourceStatus;
  rows: SlowlogRow[];
  onRetry: () => void;
}

export function SlowlogCard({ status, rows, onRetry }: SlowlogCardProps) {
  const { t } = useI18n();

  return (
    <OverviewCard
      cardId="slowlog"
      titleKey="redis.overview.slowlog.title"
      source="slowlog_get"
      status={status}
      empty={status === 'ready' && rows.length === 0}
      emptyKey="redis.overview.slowlog.empty"
      unauthorizedKey="redis.overview.slowlog.unauthorized"
      unauthorizedHintKey="redis.overview.slowlog.unauthorizedHint"
      onRetry={onRetry}
    >
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wide text-fg-muted">
            <th className="w-6 px-3 py-1.5 font-medium">#</th>
            <th className="w-24 px-2 py-1.5 font-medium">{t('redis.overview.slowlog.duration')}</th>
            <th className="px-2 py-1.5 font-medium">{t('redis.overview.slowlog.command')}</th>
            <th className="w-32 px-3 py-1.5 text-right font-medium">{t('redis.overview.slowlog.client')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.id}-${row.rank}`}
              data-overview-slowlog-row={row.rank}
              className="border-b border-edge/50 last:border-b-0"
            >
              <td className="px-3 py-1.5 font-mono text-fg-muted">{row.rank}</td>
              <td
                data-overview-slowlog-duration={row.rank}
                data-overview-duration-us={row.durationUs}
                className="px-2 py-1.5 font-mono tabular-nums text-fg"
              >
                {t('redis.overview.unit.microseconds', { value: row.durationUs })}
              </td>
              <td className="max-w-0 px-2 py-1.5">
                <code
                  data-overview-slowlog-command={row.rank}
                  className="block truncate font-mono text-fg-secondary"
                  title={row.commandSummary}
                >
                  {row.commandSummary || '—'}
                </code>
              </td>
              <td className="px-3 py-1.5 text-right">
                <span
                  data-overview-slowlog-client={row.rank}
                  data-overview-client-state={row.client === null ? 'unknown' : 'known'}
                  className="block truncate font-mono text-fg-muted"
                  title={row.client ?? undefined}
                >
                  {row.client ?? t('redis.overview.slowlog.noClient')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </OverviewCard>
  );
}
