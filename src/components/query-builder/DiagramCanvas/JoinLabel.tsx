import { useCallback, useState } from 'react';
import { cn } from '@datazen/ui';
import { columnPairCount, primaryColumnPair } from '../types';
import type { QbJoin, QbJoinType } from '../types';
import { useI18n } from '../../../hooks/useI18n';

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
}

export function JoinLabel({ join, onUpdateType, onRemove }: JoinLabelProps) {
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
      onClick={() => setEditing(true)}
      onContextMenu={handleContextMenu}
      data-testid={`qb-join-label-${join.id}`}
    >
      <span className="font-semibold text-accent">{join.type}</span>
      <span className="text-fg-muted">ON</span>
      <span className="text-fg-secondary">
        {join.leftTable}.{primaryColumnPair(join).left} = {join.rightTable}.
        {primaryColumnPair(join).right}
        {columnPairCount(join) > 1
          ? ` ${t('query.visualBuilder.andMorePairs', { count: columnPairCount(join) - 1 })}`
          : ''}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="ml-0.5 text-fg-muted hover:text-danger transition-colors"
        title={t('query.visualBuilder.removeJoin')}
        data-testid={`qb-join-remove-${join.id}`}
      >
        ×
      </button>
    </div>
  );
}
