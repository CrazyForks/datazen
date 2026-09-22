import { useCallback, useEffect, useState } from 'react';
import { Button, Input } from '@datazen/ui';
import { useI18n } from '@datazen/ui';
import type { KeyDetail, ValueFrame } from '../shared/types';
import { hasRedisJson, isJsonKeyType, looksLikeJsonModuleDetail } from './hasRedisJson';
import { JsonEditor } from './JsonEditor';
import { StreamEditor } from './StreamEditor';
import { invokeRename } from './keyEditorsInvokes';
import { invokeGetKeyRaw } from '../shared/redisInvoke';
import { useRedisGate } from '../shared/useRedisGate';
import { formatSize } from '../shared/formatSize';
import { HashEditor } from './HashEditor';
import { ListEditor } from './ListEditor';
import { SetEditor } from './SetEditor';
import { ZsetEditor } from './ZsetEditor';
import { StringEditor } from './StringEditor';
import { TtlControls } from './TtlControls';

export type { PluginInvokeFn } from './keyEditorsInvokes';
export {
  invokeCreateKey,
  invokeHashDel,
  invokeHashSet,
  invokeListPop,
  invokeListPush,
  invokeListSet,
  invokeRename,
  invokeSetAdd,
  invokeSetExpireAt,
  invokeSetRemove,
  invokeSetString,
  invokeSetTtl,
  invokeZsetAdd,
  invokeZsetRemove,
} from './keyEditorsInvokes';

export interface KeyDetailEditorProps {
  dbSessionId: string;
  dbIndex: number;
  detail: KeyDetail;
  modules?: string[] | null;
  onRefresh: () => void | Promise<void>;
  onRenamed?: (newKey: string) => void;
  /**
   * Unsaved-draft signal for the PRD §4 I-1 dirty gate.
   *
   * Only `StringEditor` can hold a draft today: every other type editor writes
   * through `gateWrite('write-op')` on the spot, so there is nothing pending to
   * lose there and they keep the flag at `false`. The workbench relays the value
   * to the host's per-panel `KvSlotState` — this module never touches the relay.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

export function KeyDetailEditor({
  dbSessionId,
  dbIndex,
  detail,
  modules = null,
  onRefresh,
  onRenamed,
  onDirtyChange,
}: KeyDetailEditorProps) {
  const { t } = useI18n();
  const { gateWrite, gateDialog } = useRedisGate();
  const [renameInput, setRenameInput] = useState(detail.key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<ValueFrame | null>(null);

  // Fetch ValueFrame on mount and when key changes.
  useEffect(() => {
    let cancelled = false;
    void invokeGetKeyRaw(dbSessionId, dbIndex, detail.key).then(
      (f) => {
        if (!cancelled) setFrame(f);
      },
      () => {
        // Silently ignore — frame is optional enrichment.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dbSessionId, dbIndex, detail.key]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (!(await gateWrite('write-op'))) return;
      setBusy(true);
      setError(null);
      try {
        await fn();
        await onRefresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onRefresh, gateWrite],
  );

  const showJsonEditor =
    isJsonKeyType(detail.keyType) ||
    (modules !== null && hasRedisJson(modules) && looksLikeJsonModuleDetail(detail));

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg-muted">{t('redis.type')}:</span>
        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">{detail.keyType}</span>
        {frame && (
          <>
            {frame.memBytes != null && (
              <span className="rounded bg-surface-alt px-1.5 py-0.5 text-fg-muted">
                {formatSize(frame.memBytes)}
              </span>
            )}
            {frame.truncated && (
              <span
                className="rounded bg-warning/10 px-1.5 py-0.5 text-warning"
                data-testid="redis-key-badge-truncated"
                data-i18n-key="redis.detail.badge.truncated"
              >
                {t('redis.detail.badge.truncated')}
              </span>
            )}
          </>
        )}
      </div>

      <TtlControls
        dbSessionId={dbSessionId}
        dbIndex={dbIndex}
        keyName={detail.key}
        ttl={detail.ttl}
        gateWrite={gateWrite}
        onChanged={() => void onRefresh()}
      />

      <div className="flex flex-wrap items-end gap-2 rounded-md border border-edge bg-surface-alt p-2">
        <div className="flex min-w-[120px] flex-1 flex-col gap-1">
          <label className="text-fg-muted">{t('redis.name')}</label>
          <Input
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
            className="h-7 font-mono text-xs"
          />
        </div>
        <Button
          variant="secondary"
          className="h-7 px-2 text-xs"
          disabled={busy || !renameInput.trim() || renameInput === detail.key}
          onClick={() =>
            void run(async () => {
              await invokeRename(dbSessionId, dbIndex, detail.key, renameInput.trim());
              onRenamed?.(renameInput.trim());
            })
          }
        >
          {t('redis.renameKey')}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-danger/20 bg-danger/10 px-2 py-1.5 text-danger">
          {error}
        </div>
      )}

      {detail.keyType === 'string' && (
        <StringEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          frame={frame}
          gateWrite={gateWrite}
          onSaved={() => void onRefresh()}
          onDirtyChange={onDirtyChange}
        />
      )}
      {detail.keyType === 'hash' && (
        <HashEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          gateWrite={gateWrite}
          onChanged={() => void onRefresh()}
        />
      )}
      {detail.keyType === 'list' && (
        <ListEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          gateWrite={gateWrite}
          onChanged={() => void onRefresh()}
        />
      )}
      {detail.keyType === 'set' && (
        <SetEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          gateWrite={gateWrite}
          onChanged={() => void onRefresh()}
        />
      )}
      {detail.keyType === 'zset' && (
        <ZsetEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          detail={detail}
          gateWrite={gateWrite}
          onChanged={() => void onRefresh()}
        />
      )}
      {showJsonEditor && (
        <JsonEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          redisKey={detail.key}
          gateWrite={gateWrite}
        />
      )}
      {detail.keyType === 'stream' && (
        <StreamEditor
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          redisKey={detail.key}
          gateWrite={gateWrite}
        />
      )}
      {gateDialog}
    </div>
  );
}
