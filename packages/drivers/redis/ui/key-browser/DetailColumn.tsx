/**
 * Right column of the Redis key browser: the detail drawer for one key.
 *
 * Owns nothing but rendering — `RedisWorkbench` keeps the selected key, the
 * fetched {@link KeyDetail} and the module list — so the workbench stays a
 * state owner (PRD §7-5 split). Carving this out is a pure move: the states
 * below are exactly the branches the workbench used to inline.
 *
 * `data-detail-state` / `data-selected-key` markers exist so tests can assert
 * which branch rendered without pinning any translated copy (the guard deleted
 * in W1-C means copy is a human-review concern, not an assertion target).
 */
import { Loader2, X } from 'lucide-react';
import { useI18n } from '@datazen/ui';
import type { KeyDetail } from '../shared/types';
import { KeyDetailEditor } from '../value-editors/KeyEditors';

export interface DetailColumnProps {
  dbSessionId: string;
  dbIndex: number;
  /** Key currently selected in the tree, `null` when nothing is selected. */
  selectedKey: string | null;
  detail: KeyDetail | null;
  detailLoading: boolean;
  modules: string[] | null;
  onRefresh: () => void;
  onRenamed: (newKey: string) => void;
  onClose: () => void;
}

export function DetailColumn({
  dbSessionId,
  dbIndex,
  selectedKey,
  detail,
  detailLoading,
  modules,
  onRefresh,
  onRenamed,
  onClose,
}: DetailColumnProps) {
  const { t } = useI18n();

  if (!selectedKey) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 text-center text-sm text-fg-muted"
        data-testid="redis-detail-column"
        data-detail-state="no-key"
        data-i18n-key="redis.selectKeyHint"
      >
        {t('redis.selectKeyHint')}
      </div>
    );
  }

  const state = detailLoading ? 'loading' : detail ? 'ready' : 'pending';

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="redis-detail-column"
      data-selected-key={selectedKey}
      data-detail-state={state}
    >
      <div className="flex items-center justify-between border-b border-edge bg-surface-alt px-3 py-2">
        <span className="truncate text-xs font-medium text-fg" title={selectedKey}>
          {selectedKey}
        </span>
        <button
          type="button"
          className="rounded p-1 text-fg-muted hover:bg-surface-raised hover:text-fg"
          data-testid="redis-detail-close"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {detailLoading ? (
          <div className="flex items-center gap-2 text-xs text-fg-muted" data-testid="redis-detail-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('common.loading')}
          </div>
        ) : detail ? (
          <KeyDetailEditor
            dbSessionId={dbSessionId}
            dbIndex={dbIndex}
            detail={detail}
            modules={modules}
            onRefresh={onRefresh}
            onRenamed={onRenamed}
          />
        ) : null}
      </div>
    </div>
  );
}
