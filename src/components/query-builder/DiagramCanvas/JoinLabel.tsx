import { useCallback, useState } from 'react';
import { cn } from '@datazen/ui';
import { useI18n } from '../../../hooks/useI18n';
import type { QbJoin, QbJoinType } from '../types';

const JOIN_TYPE_OPTIONS: readonly { value: QbJoinType; label: string }[] = [
  { value: 'INNER', label: 'INNER' },
  { value: 'LEFT', label: 'LEFT' },
  { value: 'RIGHT', label: 'RIGHT' },
  { value: 'FULL', label: 'FULL' },
] as const;

/** Label displayed on a JOIN line showing type and ON condition. */
export interface JoinLabelProps {
  join: QbJoin;
  onUpdateType: (type: QbJoinType) => void;
  onRemove: () => void;
  /** True for an auto-detected FK candidate (dashed line, not yet in the SQL). */
  isAuto?: boolean;
  /** Promote a candidate into the SQL (PRD F-03.2). */
  onConfirm?: () => void;
}

export function JoinLabel({
  join,
  onUpdateType,
  onRemove,
  isAuto = false,
  onConfirm,
}: JoinLabelProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);

  const handleTypeChange = useCallback(
    (type: QbJoinType) => {
      onUpdateType(type);
      setEditing(false);
    },
    [onUpdateType],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onRemove();
    },
    [onRemove],
  );

  const handleLabelClick = useCallback(() => {
    // A candidate is not in the SQL yet, so editing its type is meaningless
    // until it is confirmed.
    if (isAuto) {
      onConfirm?.();
      return;
    }
    setEditing(true);
  }, [isAuto, onConfirm]);

  if (editing) {
    return (
      <div
        className={cn(
          'flex items-center gap-0.5 rounded border border-edge bg-surface-alt shadow-lg',
          'px-1 py-0.5 text-[10px]',
        )}
        data-testid="qb-join-type-editor"
      >
        {JOIN_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleTypeChange(opt.value)}
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
              opt.value === join.type
                ? 'bg-accent text-on-accent'
                : 'text-fg-secondary hover:bg-surface-raised hover:text-fg',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1 select-none cursor-pointer',
        'rounded border border-edge bg-surface-alt shadow-sm',
        'px-1.5 py-0.5 text-[10px]',
        'hover:border-accent hover:shadow-md transition-all',
      )}
      onClick={handleLabelClick}
      onContextMenu={handleContextMenu}
      data-testid={`qb-join-label-${join.id}`}
    >
      <span className="font-semibold text-accent">{join.type}</span>
      <span className="text-fg-muted">ON</span>
      <span className="text-fg-secondary">
        {join.leftTable}.{join.leftColumn} = {join.rightTable}.{join.rightColumn}
      </span>
      {isAuto && onConfirm && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
          className="ml-0.5 rounded bg-accent/15 px-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent/25"
          title={t('query.visualBuilder.confirmJoin')}
          data-testid={`qb-join-confirm-${join.id}`}
        >
          {t('query.visualBuilder.confirmJoin')}
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="ml-0.5 text-fg-muted hover:text-danger transition-colors"
        title="Remove JOIN"
        data-testid={`qb-join-remove-${join.id}`}
      >
        ×
      </button>
    </div>
  );
}
