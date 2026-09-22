import { useCallback, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button, useI18n } from '@datazen/ui';
import type { ConnectionHomeSlotProps } from '@datazen/driver-sdk';
import { useOverviewData } from './useOverviewData';
import {
  BIG_KEY_LIMIT,
  SLOWLOG_LIMIT,
  buildBannerPills,
  buildBigKeyRows,
  buildKeySpaceModel,
  buildMemoryModel,
  buildServerRows,
  buildSlowlogRows,
  parseInfoFieldsFromRaw,
} from './overviewModel';
import {
  parseDbIndex,
  requestOverviewJump,
  type OverviewJumpHandler,
  type OverviewJumpTarget,
} from './overviewNavigation';
import { RedisOverviewBanner } from './RedisOverviewBanner';
import { ServerInfoCard } from './ServerInfoCard';
import { MemoryCard } from './MemoryCard';
import { KeySpaceCard } from './KeySpaceCard';
import { SlowlogCard } from './SlowlogCard';
import { QuickActionsCard } from './QuickActionsCard';
import { RecentKeysCard } from './RecentKeysCard';
import { clearBrowseHistory, pushBrowseEntry, readBrowseHistory } from '../lib/redisBrowseHistory';

/**
 * 屏 A — Redis 连接总览（`kvSlots.connectionHome` 的驱动贡献）。
 *
 * Composition root only: it owns the jump intent + the pending-jump fallback and
 * hands each block its slice of the model. Seven blocks per PRD §3.1 — banner +
 * 卡 1 Server 概览 + 卡 2 内存 + 卡 3 Key Space + 卡 4 慢查询 + KV 快捷动作 +
 * 最近浏览键 — all fed by the four commands in `useOverviewData`, zero SCAN.
 *
 * The host wrapper (`ConnectionWorkspaceHome.tsx`) owns the scroll container and
 * the `data-slot="kv-connection-home"` marker; this component owns its layout.
 */
export interface RedisOverviewHomeProps extends ConnectionHomeSlotProps {
  /**
   * Host bridge that opens a db panel / selects a key (屏 A → 屏 B).
   *
   * NOT part of the frozen `ConnectionHomeSlotProps` contract yet, so the host
   * never passes it today: every jump then degrades to a named hint instead of
   * pretending to work. See `overviewNavigation.ts` + the track ledger.
   */
  onOpenTarget?: OverviewJumpHandler;
}

export function RedisOverviewHome({
  connectionId,
  dbSessionId,
  connectionName,
  initialDatabase,
  onOpenTarget,
}: RedisOverviewHomeProps) {
  const { t } = useI18n();
  const dbIndex = useMemo(() => parseDbIndex(initialDatabase), [initialDatabase]);
  const data = useOverviewData({ dbSessionId, dbIndex });
  const [recent, setRecent] = useState(() => readBrowseHistory(connectionId));
  const [hintKey, setHintKey] = useState<string | null>(null);

  const infoFields = useMemo(
    () => data.info.data?.fields ?? parseInfoFieldsFromRaw(''),
    [data.info.data],
  );
  const serverRows = useMemo(() => buildServerRows(infoFields), [infoFields]);
  const memoryModel = useMemo(() => buildMemoryModel(infoFields), [infoFields]);
  const bigKeys = useMemo(
    () => buildBigKeyRows(data.memory.data, BIG_KEY_LIMIT),
    [data.memory.data],
  );
  const keySpace = useMemo(() => buildKeySpaceModel(data.dbSizes.data), [data.dbSizes.data]);
  const slowlogRows = useMemo(
    () => buildSlowlogRows(data.slowlog.data, SLOWLOG_LIMIT),
    [data.slowlog.data],
  );
  const pills = useMemo(() => buildBannerPills(infoFields, memoryModel), [infoFields, memoryModel]);

  const handleJump = useCallback(
    (target: OverviewJumpTarget) => {
      const outcome = requestOverviewJump(target, onOpenTarget);
      if (outcome.handled) {
        setHintKey(null);
        // PRD 最近浏览键 = 真正到过的键；只有桥接成功的 key 跳转才入历史。
        if (target.kind === 'key') {
          setRecent(pushBrowseEntry(connectionId, { key: target.key, dbIndex: target.dbIndex }));
        }
        return;
      }
      setHintKey(outcome.hintKey);
    },
    [connectionId, onOpenTarget],
  );

  const handleClearRecent = useCallback(() => {
    clearBrowseHistory(connectionId);
    setRecent([]);
  }, [connectionId]);

  return (
    <div data-overview-root className="flex min-h-0 flex-1 flex-col bg-surface">
      <RedisOverviewBanner
        connectionName={connectionName}
        pills={pills}
        loading={data.info.status === 'loading'}
        onJump={handleJump}
        jumpHandler={onOpenTarget}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {hintKey ? (
          <div
            role="status"
            data-overview-jump-hint={hintKey}
            className="mb-3 flex items-center gap-2 rounded border border-warning/25 bg-warning/10 px-3 py-1.5 text-xs text-warning"
          >
            <span className="min-w-0 flex-1">{t(hintKey)}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-overview-jump-hint-dismiss
              className="h-6 px-1.5"
              onClick={() => setHintKey(null)}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        <div data-overview-grid className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ServerInfoCard
            status={data.info.status}
            rows={serverRows}
            onRetry={data.refresh}
          />
          <MemoryCard
            infoStatus={data.info.status}
            memoryStatus={data.memory.status}
            model={memoryModel}
            bigKeys={bigKeys}
            sampledDbIndex={dbIndex}
            truncated={data.memory.data?.truncated === true}
            onRetry={data.refresh}
            onJump={handleJump}
            jumpHandler={onOpenTarget}
          />
          <KeySpaceCard
            status={data.dbSizes.status}
            model={keySpace}
            onRetry={data.refresh}
            onJump={handleJump}
            jumpHandler={onOpenTarget}
          />
          <SlowlogCard status={data.slowlog.status} rows={slowlogRows} onRetry={data.refresh} />
          <QuickActionsCard
            defaultDbIndex={dbIndex}
            onJump={handleJump}
            jumpHandler={onOpenTarget}
          />
          <RecentKeysCard
            entries={recent}
            onJump={handleJump}
            onClear={handleClearRecent}
            jumpHandler={onOpenTarget}
          />
        </div>
      </div>
    </div>
  );
}

export default RedisOverviewHome;
