/**
 * The 48px KV context bar — the `contextBar` slot (PRD §3.4, ruling 8-2 = full).
 *
 * Left → right: `db ▾` · `52 keys` · `used / max` · scan cluster · right
 * cluster (SafeMode badge, refresh, `+`, import/export, ⋯ menu).
 *
 * This file is a rendering shell. Every decision that could be wrong lives in
 * `contextBarModel.ts` and is unit-tested there (PRD §5 「组件薄 + 纯逻辑模块厚」).
 *
 * Two contract rules this component obeys rather than re-derives (W3-A F-3):
 *
 * 1. **Every clickable thing asks through `request`.** Never a callback prop,
 *    never a driver command: the host is the single decision point.
 * 2. **`flushDb` does not confirm here.** The host's dispatcher runs the shared
 *    write gate (PRD I-6) before anything happens.
 */
import type { KvContextBarProps } from '@datazen/driver-sdk';
import { Select, useI18n } from '@datazen/ui';
import { redisMeta } from '../shared/meta';
import { formatSize } from '../shared/formatSize';
import { ContextBarActions } from './ContextBarActions';
import {
  contextBarLayout,
  deriveScanReadout,
  formatCompactCount,
  partInBand,
  type ContextBarPart,
} from './contextBarModel';
import { useContextBarData } from './useContextBarData';
import {
  useKvScanBudgetTotal,
  useKvScanBudgetUsed,
  useKvScanCursor,
  useKvScanning,
} from './useKvSelection';

/** The db window the picker falls back to when `db_sizes` cannot answer. */
const MAX_DB_INDEX = redisMeta.maxDatabaseIndex ?? 15;

export function RedisContextBar({
  dbSessionId,
  database,
  dbIndex,
  state,
  compact,
  request,
}: KvContextBarProps) {
  const { t } = useI18n();
  const layout = contextBarLayout(compact);
  const { dbOptions, keysInDb, memory, types } = useContextBarData({
    // The relay is the panel's identity, which is what lets the status bar's own
    // count read join this one instead of duplicating `db_sizes` (dbKeyCounts).
    scope: state,
    dbSessionId,
    dbIndex,
    maxDatabaseIndex: MAX_DB_INDEX,
  });

  const scanning = useKvScanning(state);
  const budgetUsed = useKvScanBudgetUsed(state);
  const budgetTotal = useKvScanBudgetTotal(state);
  const scanCursor = useKvScanCursor(state);
  const scan = deriveScanReadout({ scanning, used: budgetUsed, total: budgetTotal, cursor: scanCursor });

  const inBand = (part: ContextBarPart) => partInBand(part, layout);
  const activeDb = database ?? (dbIndex === undefined ? '' : `db${dbIndex}`);

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5 text-xs"
      data-testid="redis-context-bar"
      data-layout={layout}
      data-active-db={activeDb}
      data-scan-state={scan?.state ?? 'idle'}
    >
      {/* ── db selector ─────────────────────────────────────────────────── */}
      <span className="shrink-0" data-part="db">
        <span className="sr-only" data-i18n-key="redis.contextBar.db">
          {t('redis.contextBar.db')}
        </span>
        <Select
          value={activeDb}
          options={dbOptions.map((option) => ({ value: option.name, label: option.name }))}
          onChange={(value) => {
            // One request per user pick; the host owns whether a panel already
            // exists for that db (contract F-3 `selectDatabase`).
            request({ type: 'selectDatabase', database: value });
          }}
          className="h-7 max-w-[7rem] text-xs"
          title={t('redis.contextBar.dbSelect')}
          triggerDataAttrs={{ 'data-testid': 'redis-context-db', 'data-db-switch': 'wired', 'data-db-count': String(dbOptions.length) }}
        />
      </span>

      {/* ── key count of this db ────────────────────────────────────────── */}
      {keysInDb !== null && (
        <span
          className="shrink-0 whitespace-nowrap text-fg-secondary"
          data-testid="redis-context-keys"
          data-part="keys"
          data-keys={keysInDb}
          data-i18n-key="redis.dbSize"
        >
          {t('redis.dbSize', { count: formatCompactCount(keysInDb) })}
        </span>
      )}

      {/* ── memory: used / max, with an explicit "no ceiling" word ──────── */}
      {memory && inBand('memory') && (
        <span
          className="shrink-0 whitespace-nowrap text-fg-secondary"
          data-testid="redis-context-memory"
          data-part="memory"
          data-used-bytes={memory.usedBytes}
          data-max-bytes={memory.maxBytes ?? 'unlimited'}
          data-i18n-key={
            memory.maxBytes === null
              ? 'redis.contextBar.memoryUnlimited'
              : 'redis.contextBar.memory'
          }
        >
          {memory.maxBytes === null
            ? t('redis.contextBar.memoryUnlimited', { used: formatSize(memory.usedBytes) })
            : t('redis.contextBar.memory', {
                used: formatSize(memory.usedBytes),
                max: formatSize(memory.maxBytes),
              })}
        </span>
      )}

      {/* ── scan cluster ────────────────────────────────────────────────── */}
      {scan && (
        <span
          className="shrink-0 whitespace-nowrap text-fg-secondary"
          data-testid="redis-context-scan"
          data-part="scan"
          data-scan-state={scan.state}
          data-budget-used={scan.used}
          data-budget-total={scan.total}
          data-budget-percent={scan.percent ?? 'unknown'}
          data-i18n-key={
            scan.total > 0 ? 'redis.contextBar.scanning' : 'redis.contextBar.scanUsed'
          }
        >
          {scan.total > 0
            ? t('redis.contextBar.scanning', {
                used: formatCompactCount(scan.used),
                total: formatCompactCount(scan.total),
              })
            : // `total === 0` ⇒ the ceiling is unknown (F-1), so there is no
              // fraction to draw: the used count is the only honest number.
              t('redis.contextBar.scanUsed', { used: formatCompactCount(scan.used) })}
          {scan.bar && (
            <span className="ml-1 font-mono text-accent" data-testid="redis-context-scan-bar">
              {scan.bar}
            </span>
          )}
        </span>
      )}

      <div className="flex-1" />

      {/* ── right cluster: badge, four band buttons, ⋯ overflow ─────────── */}
      <ContextBarActions
        request={request}
        compact={layout === 'compact'}
        memory={memory}
        types={types}
      />
    </div>
  );
}
