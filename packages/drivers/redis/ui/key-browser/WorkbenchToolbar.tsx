import { useEffect, useState } from 'react';
import { FolderInput } from 'lucide-react';
import { Button, useI18n } from '@datazen/ui';
import { SafeModeBadge } from '../shared/SafeModeBadge';
import {
  BATCH_FAILURE_KEYS,
  failuresByCode,
  type BatchSummaryPayload,
} from './batchErrors';

/**
 * Result banner of the last batch write (delete / TTL / rename / import).
 *
 * Two shapes (D-6 / I-8):
 *  - a plain string, from import / export and the single-row actions — one line;
 *  - a {@link BatchResultSummary}, from every batch write that gets a per-key
 *    verdict back: `成功 N / 失败 M`, expandable into the failed keys grouped by
 *    *stable reason code* (`data-failure-code`), never by an English sentence.
 *
 * Dismissible; `null` renders nothing.
 */
export function BatchSummaryBanner({
  summary,
  onDismiss,
}: {
  summary: BatchSummaryPayload | null;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  // A new result always starts collapsed: the previous run's expanded reasons must
  // not leak into the next banner.
  useEffect(() => setExpanded(false), [summary]);

  if (!summary) return null;

  if (typeof summary === 'string') {
    return (
      <div
        className="shrink-0 border-b border-edge bg-surface-alt px-3 py-1 text-xs text-fg-secondary"
        data-testid="redis-batch-summary"
        data-kind="text"
        role="status"
      >
        {summary}
        <DismissButton onDismiss={onDismiss} />
      </div>
    );
  }

  const groups = failuresByCode(summary.failures);

  return (
    <div
      className="shrink-0 border-b border-edge bg-surface-alt px-3 py-1 text-xs text-fg-secondary"
      data-testid="redis-batch-summary"
      data-kind="batch"
      data-action={summary.action}
      data-ok={summary.ok}
      data-failed={summary.failed}
      role="status"
    >
      <span data-testid="redis-batch-summary-text">
        {t('redis.tree.batchResult')
          .replace('{ok}', String(summary.ok))
          .replace('{failed}', String(summary.failed))}
      </span>
      {summary.failed > 0 && (
        <>
          <button
            type="button"
            className="ml-2 text-accent hover:underline"
            aria-expanded={expanded}
            data-testid="redis-batch-summary-toggle"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {t('redis.tree.batchResultToggle')}
          </button>
          {expanded && (
            <ul
              className="mt-1 max-h-32 list-none space-y-0.5 overflow-auto border-t border-edge pt-1"
              data-testid="redis-batch-summary-failures"
              data-group-count={groups.length}
            >
              {groups.map((group) => (
                <li
                  key={group.code}
                  className="flex flex-wrap items-baseline gap-1"
                  data-testid={`redis-batch-failure-group-${group.code}`}
                  data-failure-code={group.code}
                  data-count={group.keys.length}
                  data-reason-key={BATCH_FAILURE_KEYS[group.code]}
                >
                  <span className="font-medium text-danger">
                    {t(BATCH_FAILURE_KEYS[group.code])}
                  </span>
                  <span className="text-fg-muted">×{group.keys.length}</span>
                  <span className="min-w-0 break-all font-mono text-[11px]">
                    {group.keys.join(' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <DismissButton onDismiss={onDismiss} />
    </div>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      className="ml-2 text-fg-muted hover:text-fg"
      data-testid="redis-batch-summary-dismiss"
      onClick={onDismiss}
    >
      ×
    </button>
  );
}

export interface WorkbenchToolbarProps {
  selectedDb: string;
  /** `DBSIZE` as reported by the running scan. */
  dbSize: number;
  loadedCount: number;
  /** Scan cursor still non-zero ⇒ the loaded set is partial. */
  hasMore: boolean;
  /** Optional `MEMORY USAGE` per key — expensive, so it stays opt-in here. */
  withMemory: boolean;
  onWithMemoryChange: (withMemory: boolean) => void;
  allowFlush: boolean;
  onImportExport: () => void;
  onFlushDb: () => void;
  onFlushAll: () => void;
}

/**
 * Workbench toolbar row (db · sizes · session actions).
 *
 * Extracted verbatim from `RedisWorkbench.tsx` in D-0. Since D-1/D-2 the
 * key-tree actions (refresh, `+` create, select/batch) and the pattern/type/
 * no-expiry filters live in the R1/R2 column header next to the tree they act
 * on; this row keeps the session-wide ones (import/export, FLUSH) and the
 * server-cost switch, which is not a per-tree filter.
 */
export function WorkbenchToolbar({
  selectedDb,
  dbSize,
  loadedCount,
  hasMore,
  withMemory,
  onWithMemoryChange,
  allowFlush,
  onImportExport,
  onFlushDb,
  onFlushAll,
}: WorkbenchToolbarProps) {
  const { t } = useI18n();

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-edge bg-surface-alt px-3 py-1.5 text-xs text-fg-secondary"
      data-testid="redis-workbench-toolbar"
    >
      <span>{selectedDb}</span>
      <span className="text-edge">|</span>
      <span>{t('redis.dbSize').replace('{count}', String(dbSize))}</span>
      <span className="text-edge">|</span>
      <span>{t('redis.loadedCount').replace('{count}', String(loadedCount))}</span>
      {hasMore && <span className="text-fg-muted">({t('redis.loadMore')}…)</span>}
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-secondary">
        <input
          type="checkbox"
          checked={withMemory}
          onChange={(e) => onWithMemoryChange(e.target.checked)}
          className="rounded border-edge"
          data-testid="redis-with-memory"
        />
        {t('redis.withMemory')}
      </label>
      <div className="flex-1" />
      <SafeModeBadge />
      <Button
        variant="secondary"
        className="h-7 gap-1 px-2 text-xs"
        data-testid="redis-import-export"
        onClick={onImportExport}
      >
        <FolderInput className="h-3.5 w-3.5" />
        {t('redis.importExportTitle')}
      </Button>
      {allowFlush && (
        <>
          <Button
            variant="secondary"
            className="h-7 px-2 text-xs text-danger"
            data-testid="redis-flush-db"
            onClick={onFlushDb}
          >
            {t('redis.flushDb')}
          </Button>
          <Button
            variant="secondary"
            className="h-7 px-2 text-xs text-danger"
            data-testid="redis-flush-all"
            onClick={onFlushAll}
          >
            {t('redis.flushAll')}
          </Button>
        </>
      )}
    </div>
  );
}
