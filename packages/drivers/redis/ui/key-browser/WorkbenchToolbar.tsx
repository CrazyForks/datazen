import { FolderInput, Plus, RefreshCw } from 'lucide-react';
import { Button, useI18n } from '@datazen/ui';
import { SafeModeBadge } from '../shared/SafeModeBadge';
import { KeyBrowserControls, type KeyBrowserControlsProps } from './KeyBrowserControls';
import type { SearchMode } from './SearchModeTabs';

/**
 * Summary banner of the last batch write (delete / TTL / rename / import).
 * Dismissible; `null` renders nothing.
 */
export function BatchSummaryBanner({
  summary,
  onDismiss,
}: {
  summary: string | null;
  onDismiss: () => void;
}) {
  if (!summary) return null;
  return (
    <div
      className="shrink-0 border-b border-edge bg-surface-alt px-3 py-1 text-xs text-fg-secondary"
      data-testid="redis-batch-summary"
      role="status"
    >
      {summary}
      <button
        type="button"
        className="ml-2 text-fg-muted hover:text-fg"
        data-testid="redis-batch-summary-dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

export interface WorkbenchToolbarProps {
  selectedDb: string;
  /** `DBSIZE` as reported by the running scan. */
  dbSize: number;
  loadedCount: number;
  /** Scan cursor still non-zero ⇒ the loaded set is partial. */
  hasMore: boolean;
  searchMode: SearchMode;
  filters: KeyBrowserControlsProps;
  allowFlush: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onImportExport: () => void;
  onFlushDb: () => void;
  onFlushAll: () => void;
}

/**
 * Workbench toolbar row (db · sizes · loaded · filters · global actions).
 *
 * Extracted verbatim from `RedisWorkbench.tsx` in D-0. The PRD's R1 *column*
 * header is a different row and lives next to the tree; this one keeps the
 * session-wide actions (refresh / create / import-export / FLUSH).
 */
export function WorkbenchToolbar({
  selectedDb,
  dbSize,
  loadedCount,
  hasMore,
  searchMode,
  filters,
  allowFlush,
  onRefresh,
  onCreate,
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
      {searchMode === 'key' && <KeyBrowserControls {...filters} />}
      <div className="flex-1" />
      <SafeModeBadge />
      <Button
        variant="secondary"
        className="h-7 gap-1 px-2 text-xs"
        title={t('connWin.refresh')}
        data-testid="redis-refresh"
        onClick={onRefresh}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        {t('redis.refresh')}
      </Button>
      <Button
        variant="secondary"
        className="h-7 gap-1 px-2 text-xs"
        data-testid="redis-create-key"
        onClick={onCreate}
      >
        <Plus className="h-3.5 w-3.5" />
        {t('redis.createKey')}
      </Button>
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
