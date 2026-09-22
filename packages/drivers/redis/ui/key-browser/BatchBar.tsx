import { Replace, Trash2 } from 'lucide-react';
import { Button, useI18n } from '@datazen/ui';
import type { BatchActions } from './useBatchActions';

/**
 * Pattern / prefix strip of the key workbench.
 *
 * The *selection-scoped* batch actions (batch TTL, batch delete) moved up into
 * the R1 column header in D-1, so this row keeps only the two operations that
 * take a pattern or a prefix instead of a selection — plus the live selection
 * count, which is the only place the user sees "what the header buttons will
 * act on". Both rows drive the same {@link BatchActions} controller, so there is
 * exactly one confirmation dialog per operation.
 */

export * from './batchInvokes';

export interface BatchPatternBarProps {
  actions: BatchActions;
  dbIndex: number;
}

export function BatchPatternBar({ actions, dbIndex }: BatchPatternBarProps) {
  const { t } = useI18n();

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-surface-alt px-3 py-1.5"
      data-testid="redis-batch-bar"
      data-selection-count={actions.selectedCount}
    >
      <span className="text-xs text-fg-muted" data-testid="redis-batch-hint">
        {actions.hasSelection
          ? t('redis.selectedCount').replace('{count}', String(actions.selectedCount))
          : t('redis.batchHint')}
      </span>
      <span
        className="rounded border border-edge bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg-secondary"
        data-testid="redis-batch-context"
        title={`Redis db${dbIndex}`}
      >
        db{dbIndex}
      </span>
      <div className="flex-1" />
      <Button
        variant="secondary"
        className="h-7 gap-1 px-2 text-xs"
        data-testid="redis-batch-pattern"
        onClick={() => actions.request('pattern')}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t('redis.deletePattern')}
      </Button>
      <Button
        variant="secondary"
        className="h-7 gap-1 px-2 text-xs"
        data-testid="redis-batch-rename"
        onClick={() => actions.request('rename')}
      >
        <Replace className="h-3.5 w-3.5" />
        {t('redis.batchRenamePrefix')}
      </Button>
    </div>
  );
}
