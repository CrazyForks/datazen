import { X } from 'lucide-react';
import { Button, cn, useI18n } from '@datazen/ui';
import { OverviewCard } from './OverviewCard';
import { relativeTimeParts, type BrowseHistoryEntry } from '../lib/redisBrowseHistory';
import type { OverviewJumpHandler, OverviewJumpTarget } from './overviewNavigation';
import { jumpStateAttribute, typeBadgeClass } from './overviewNavigation';

/**
 * 最近浏览键（PRD §3.1 第七行）— 连接级 localStorage 历史，点击直达。
 *
 * The list itself is the block's "ready" state; its empty state is named
 * (`redis.overview.recent.empty`) and says what fills it, per I-11. Entries are
 * only written when a jump actually landed in 屏 B, so the list never claims a
 * key was visited because the overview merely offered it.
 */
export interface RecentKeysCardProps {
  entries: BrowseHistoryEntry[];
  /** Injected so "N minutes ago" is testable without faking timers inside React. */
  now?: number;
  onJump: (target: OverviewJumpTarget) => void;
  onClear: () => void;
  jumpHandler?: OverviewJumpHandler;
}

export function RecentKeysCard({
  entries,
  now,
  onJump,
  onClear,
  jumpHandler,
}: RecentKeysCardProps) {
  const { t } = useI18n();
  const jumpState = jumpStateAttribute(jumpHandler);

  return (
    <OverviewCard
      cardId="recent"
      titleKey="redis.overview.recent.title"
      source="localStorage"
      empty={entries.length === 0}
      emptyKey="redis.overview.recent.empty"
    >
      <div className="flex flex-col p-1.5 text-xs">
        <ul className="flex flex-col">
          {entries.map((entry) => {
            const relative = relativeTimeParts(entry.visitedAt, now);
            return (
              <li key={`${entry.dbIndex}\u0000${entry.key}`}>
                <button
                  type="button"
                  data-overview-recent-key={entry.key}
                  data-overview-db-index={entry.dbIndex}
                  data-overview-key-type={entry.keyType ?? 'unknown'}
                  data-overview-jump={jumpState}
                  className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-surface-raised"
                  onClick={() =>
                    onJump({
                      kind: 'key',
                      dbIndex: entry.dbIndex,
                      key: entry.key,
                      keyType: entry.keyType ?? null,
                    })
                  }
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-fg" title={entry.key}>
                    {entry.key}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded border px-1 py-0.5 font-mono text-[10px] leading-none',
                      typeBadgeClass(entry.keyType),
                    )}
                  >
                    {entry.keyType ?? t('redis.overview.typeUnknown')}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-fg-muted">
                    {`db${entry.dbIndex}`}
                  </span>
                  <span
                    data-overview-recent-time={entry.key}
                    data-overview-relative-unit={relative.unitKey}
                    data-overview-relative-value={relative.value}
                    className="shrink-0 text-[10px] text-fg-muted"
                  >
                    {t(relative.unitKey, { value: relative.value })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {entries.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-overview-recent-clear
            className="mt-1 self-start text-[11px]"
            onClick={onClear}
          >
            <X className="h-3 w-3" aria-hidden="true" />
            {t('redis.overview.recent.clear')}
          </Button>
        ) : null}
      </div>
    </OverviewCard>
  );
}
