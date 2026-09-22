/**
 * Bottom status bar — the `statusBar` KV slot (PRD §3.4).
 *
 * The host's generic cluster prints SQL-shaped facts (`tableName`, `columnCount`,
 * `totalRows`) which are all empty for a KV panel, leaving the bar blank. This
 * slot replaces it with the two KV facts the frozen contract actually carries:
 * the logical database the panel is bound to and the key selected in the tree,
 * enriched by the same `key_object_info` read the sidebar uses (type, size, and
 * a TTL that only shows when the key really expires).
 *
 * Selection comes off the host relay (contract F-2) — no callback into the
 * workbench, no driver-side copy of the selection. The PRD's remaining status
 * facts (`keys`, `loaded`, scan cursor, multi-select count, last write op) are
 * workbench-internal and *not* exposed by `KvSlotState`; rendering them would
 * mean widening the frozen contract, so they are reported as a gap instead of
 * faked here.
 */
import type { ReactNode } from 'react';
import { Fragment } from 'react';
import type { KvStatusBarProps } from '@datazen/driver-sdk';
import { Badge, useI18n } from '@datazen/ui';
import { formatSize } from '../shared/formatSize';
import { attributeViewState, describeTtl, formatDurationMs } from './keyObjectInfo';
import { useKvDirty, useKvSelectedKey } from './useKvSelection';
import { useKeyObjectInfo } from './useKeyObjectInfo';

export function RedisKvStatusBar({ dbSessionId, dbIndex, database, state }: KvStatusBarProps) {
  const { t } = useI18n();
  const selectedKey = useKvSelectedKey(state);
  const dirty = useKvDirty(state);
  const { info, loading, failed } = useKeyObjectInfo(state, dbSessionId, dbIndex, selectedKey);

  const dbLabel = database ?? (dbIndex === undefined ? null : `db${dbIndex}`);
  const ttl = info && !info.missing ? describeTtl(info.ttlMs) : null;
  const view = attributeViewState(selectedKey, loading, failed, info);

  const parts: Array<{ part: string; node: ReactNode }> = [
    { part: 'database', node: <span className="font-mono">{dbLabel ?? '—'}</span> },
    {
      part: 'selected-key',
      node: (
        <span className="max-w-[280px] truncate font-mono" title={selectedKey ?? undefined}>
          {selectedKey ?? t('redis.contextBar.status.noKey')}
        </span>
      ),
    },
  ];
  if (info && !info.missing) {
    if (info.type) {
      parts.push({ part: 'type', node: <span className="font-mono">{info.type}</span> });
    }
    if (info.memoryBytes !== null) {
      parts.push({
        part: 'size',
        node: <span className="font-mono">{formatSize(info.memoryBytes)}</span>,
      });
    }
    // No-expiry keys are the norm, so the pill stays silent unless there is a
    // real deadline to count down — the sidebar states "No expiry" explicitly.
    // A key the server reported gone (`-2`, redis-kvbar-ui-BUG-004) is silent here
    // too, and the sidebar words that row as *gone*: a bar pill would have to print
    // a duration it was not given, and the one claim both surfaces must avoid is
    // presenting such a key as one that simply never expires.
    if (ttl?.kind === 'remaining') {
      parts.push({
        part: 'ttl',
        node: <span className="font-mono text-warning">{formatDurationMs(ttl.ms)}</span>,
      });
    }
  }

  return (
    <div
      className="flex min-w-0 items-center gap-2"
      data-testid="redis-kv-status-bar"
      data-slot="redis-kv-status-bar"
      data-status-state={view}
      data-selected-key={selectedKey ?? ''}
      data-dirty={dirty ? 'true' : 'false'}
    >
      {parts.map((entry, index) => (
        <Fragment key={entry.part}>
          {index > 0 && (
            <span aria-hidden="true" className="text-fg-muted">
              ·
            </span>
          )}
          <span className="min-w-0 shrink-0" data-part={entry.part}>
            {entry.node}
          </span>
        </Fragment>
      ))}
      {dirty && (
        <Badge
          tone="warning"
          className="shrink-0"
          data-part="dirty"
          data-i18n-key="redis.contextBar.status.unsaved"
        >
          {t('redis.contextBar.status.unsaved')}
        </Badge>
      )}
    </div>
  );
}
