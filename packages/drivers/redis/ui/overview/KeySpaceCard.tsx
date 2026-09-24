import { useI18n, cn } from '@datazen/ui';
import { OverviewCard } from './OverviewCard';
import type { KeySpaceModel } from './overviewModel';
import type { OverviewSourceStatus } from './useOverviewData';
import type { OverviewJumpHandler, OverviewJumpTarget } from './overviewNavigation';
import { jumpStateAttribute } from './overviewNavigation';

/**
 * 卡 3 — Key Space（PRD §3.1：16 个 db 网格，db 名 + 键数 + 占比条）.
 *
 * This grid is the overview's answer to "只能去左树点" — 有数据的 db 高亮、空 db
 * 灰化，点击即请求打开该 db 页签。Data source is `db_sizes` alone (one round trip;
 * `INFO keyspace` would add a second for the same numbers).
 */
export interface KeySpaceCardProps {
  status: OverviewSourceStatus;
  model: KeySpaceModel;
  onRetry: () => void;
  onJump: (target: OverviewJumpTarget) => void;
  jumpHandler?: OverviewJumpHandler;
}

/** 占比条至少留 2% 可见，否则 1 键的库在网格里看起来像空的。 */
function barWidth(sharePercent: number, empty: boolean): number {
  if (empty) return 0;
  return Math.max(2, Math.min(100, sharePercent));
}

export function KeySpaceCard({ status, model, onRetry, onJump, jumpHandler }: KeySpaceCardProps) {
  const { t } = useI18n();
  const jumpState = jumpStateAttribute(jumpHandler);

  return (
    <OverviewCard
      cardId="keyspace"
      titleKey="redis.overview.keyspace.title"
      source="db_sizes"
      status={status}
      empty={status === 'ready' && model.totalKeys === 0}
      emptyKey="redis.overview.keyspace.empty"
      unauthorizedKey="redis.overview.keyspace.unauthorized"
      onRetry={onRetry}
    >
      <div className="flex flex-col gap-2 p-2.5 text-xs">
        <p data-overview-keyspace-summary className="text-fg-muted">
          {t('redis.overview.keyspace.summary', {
            dbCount: model.dbCount,
            nonEmpty: model.nonEmptyCount,
            totalKeys: model.totalKeys,
          })}
        </p>

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {model.cells.map((cell) => (
            <button
              key={cell.dbIndex}
              type="button"
              data-overview-db-cell={cell.dbIndex}
              data-overview-db-name={cell.name}
              data-overview-db-state={cell.empty ? 'empty' : 'active'}
              data-overview-jump={jumpState}
              className={cn(
                'flex flex-col gap-1 rounded border px-2 py-1.5 text-left transition-colors',
                cell.empty
                  ? 'border-edge/60 bg-transparent text-fg-muted'
                  : 'border-accent/25 bg-accent/5 text-fg hover:border-accent/50',
              )}
              onClick={() => onJump({ kind: 'database', dbIndex: cell.dbIndex })}
            >
              <span className="flex items-baseline justify-between gap-1">
                <span className="font-mono font-semibold">{cell.name}</span>
                <span
                  data-overview-db-keys={cell.dbIndex}
                  className={cn(
                    'font-mono tabular-nums',
                    cell.empty ? 'text-fg-muted' : 'text-accent',
                  )}
                >
                  {cell.keys}
                </span>
              </span>
              <span
                data-overview-db-share={cell.dbIndex}
                data-overview-share-percent={Math.round(cell.sharePercent)}
                className="h-1 w-full overflow-hidden rounded-full bg-surface-raised"
              >
                <span
                  className={cn('block h-full rounded-full', cell.empty ? 'bg-edge' : 'bg-accent')}
                  style={{ width: `${barWidth(cell.sharePercent, cell.empty)}%` }}
                />
              </span>
            </button>
          ))}
        </div>
      </div>
    </OverviewCard>
  );
}
