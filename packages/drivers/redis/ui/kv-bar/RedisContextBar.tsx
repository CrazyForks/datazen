/**
 * The 48px KV context bar — the `contextBar` slot (PRD §3.4, ruling 8-2 = full).
 *
 * Left → right, exactly as §3.4 specifies: `db ▾` · `52 keys` · `used / max` ·
 * type-distribution chips · scan cluster · right cluster (SafeMode badge,
 * refresh, `+`, import/export, ⋯ menu).
 *
 * This file is a rendering shell. Every decision that could be wrong — whether
 * the chips are a sample, whether `maxmemory 0` means "no ceiling", whether
 * there is a denominator for the scan bar, what `compact` drops first — lives in
 * `contextBarModel.ts` and is unit-tested there (PRD §5 「组件薄 + 纯逻辑模块厚」).
 *
 * Two contract rules this component obeys rather than re-derives (W3-A F-3):
 *
 * 1. **Every clickable thing asks through `request`.** Never a callback prop,
 *    never a driver command: the host is the single decision point. Nothing here
 *    is hidden because the host "might not handle it" — an unwired action is the
 *    host's no-op + warning, and hiding a control the user needs is the dead
 *    surface PRD P-3 exists to eliminate.
 * 2. **`flushDb` does not confirm here.** The host's dispatcher runs the shared
 *    write gate (PRD I-6) before anything happens; a driver-side dialog would be
 *    the second confirmation system the contract forbids.
 *
 * `request` and `state` are both stable identities from the host (F-2/F-3), so
 * the effects below can depend on them without a per-render refetch.
 */
import { ChevronDown } from 'lucide-react';
import type { KvContextBarProps } from '@datazen/driver-sdk';
import { useI18n } from '@datazen/ui';
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
  const showTypes = inBand('types') && types !== null;

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5 text-xs"
      data-testid="redis-context-bar"
      data-layout={layout}
      data-active-db={activeDb}
      data-scan-state={scan?.state ?? 'idle'}
    >
      {/* ── db selector ─────────────────────────────────────────────────── */}
      <label className="flex shrink-0 items-center gap-1" data-part="db">
        <span className="sr-only" data-i18n-key="redis.contextBar.db">
          {t('redis.contextBar.db')}
        </span>
        <select
          data-testid="redis-context-db"
          data-db-switch="wired"
          data-db-count={dbOptions.length}
          className="h-7 max-w-[7rem] rounded border border-edge bg-surface px-1 font-mono text-xs text-fg"
          value={activeDb}
          title={t('redis.contextBar.dbSelect')}
          onChange={(event) => {
            // One request per user pick; the host owns whether a panel already
            // exists for that db (contract F-3 `selectDatabase`).
            request({ type: 'selectDatabase', database: event.target.value });
          }}
        >
          {activeDb === '' && <option value="" />}
          {dbOptions.map((option) => (
            <option key={option.name} value={option.name}>
              {option.name}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0 text-fg-muted" />
      </label>

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

      {/* ── type-distribution chips (sample ⇒ mandatory annotation) ─────── */}
      {showTypes && types && (
        <span
          className="flex min-w-0 shrink items-center gap-1"
          data-testid="redis-context-types"
          data-part="types"
          data-chip-count={types.chips.length}
          data-sampled={types.sample ? types.sample.sampled : 'exact'}
          data-dbsize={types.sample ? types.sample.dbsize : 'exact'}
          data-truncated={types.sample ? 'true' : 'false'}
        >
          {types.chips.map((chip) => (
            <span
              key={chip.type}
              className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-fg-secondary"
              data-testid={`redis-context-chip-${chip.type}`}
              data-type={chip.type}
              data-count={chip.count}
            >
              {chip.type} {formatCompactCount(chip.count)}
            </span>
          ))}
          {types.sample && (
            // §3.4 hard constraint: an estimate must say so, in the chips group
            // itself. Never rendered when `sampled >= dbsize` (a full census).
            <span
              className="shrink-0 whitespace-nowrap text-[11px] text-warning"
              data-testid="redis-context-types-sampled"
              data-sampled={types.sample.sampled}
              data-dbsize={types.sample.dbsize}
              data-i18n-key="redis.contextBar.sampled"
            >
              {t('redis.contextBar.sampled', {
                sampled: formatCompactCount(types.sample.sampled),
                dbsize: formatCompactCount(types.sample.dbsize),
              })}
            </span>
          )}
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
        // In `compact` the band dropped the chips, so the menu carries them; in
        // `full` it must not duplicate what is already on screen.
        types={showTypes ? null : types}
      />
    </div>
  );
}
