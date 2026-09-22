import { List, Network } from 'lucide-react';
import { Select, cn, useI18n } from '@datazen/ui';
import { SEPARATOR_CHOICES } from './keyTree';
import type { TreeViewMode } from './treePreferences';

/**
 * Row R3 of the key-tree column header (PRD §3.2 屏 B 左列 / task book D-3).
 *
 * Two controls, both per-connection and both pure *view* state:
 *  - `树 / 列表` — fold namespaces, or list the loaded keys flat. The escape
 *    hatch for a keyspace whose names legitimately contain the separator;
 *  - 分隔符 `:` / `.` / `/` — the one character `list_children` groups on. It is
 *    sent to the server *and* used to fold the flat fallback list, so a change
 *    re-computes the whole tree immediately (state machine asserted in
 *    `keyTree.test.ts`, DOM journey in `keyTreeInteractionsJourney.test.tsx`).
 *
 * `规则分组` (regex grouping) is P2 and deliberately absent (task book §1 D-3).
 */
export interface KeyTreeGroupRowProps {
  view: TreeViewMode;
  onViewChange: (view: TreeViewMode) => void;
  separator: string;
  onSeparatorChange: (separator: string) => void;
  /** Value-search hit list has no namespaces to fold. */
  disabled?: boolean;
}

export function KeyTreeGroupRow({
  view,
  onViewChange,
  separator,
  onSeparatorChange,
  disabled = false,
}: KeyTreeGroupRowProps) {
  const { t } = useI18n();

  return (
    <div
      className="flex items-center gap-1.5"
      data-testid="redis-tree-group-row"
      data-view={view}
      data-separator={separator}
      data-disabled={disabled ? 'true' : 'false'}
    >
      <div className="flex shrink-0 items-center rounded-md border border-edge p-px">
        <ViewOption
          testId="redis-tree-view-tree"
          active={view === 'tree'}
          disabled={disabled}
          label={t('redis.tree.groupTree')}
          Icon={Network}
          onClick={() => onViewChange('tree')}
        />
        <ViewOption
          testId="redis-tree-view-list"
          active={view === 'list'}
          disabled={disabled}
          label={t('redis.tree.groupList')}
          Icon={List}
          onClick={() => onViewChange('list')}
        />
      </div>
      <div className="shrink-0" data-testid="redis-tree-separator-option" data-separator={separator}>
        <Select
          value={separator}
          onChange={(value) => onSeparatorChange(value)}
          options={SEPARATOR_CHOICES.map((sep) => ({ value: sep, label: sep }))}
          className="h-7 w-12 text-xs"
          disabled={disabled}
          title={t('redis.tree.separatorHint')}
          aria-label={t('redis.tree.separator')}
          triggerDataAttrs={{ 'data-testid': 'redis-tree-separator' }}
        />
      </div>
      <span className="ml-auto min-w-0 truncate text-[10px] text-fg-muted" data-testid="redis-tree-nav-hint">
        {t('redis.tree.navHint')}
      </span>
    </div>
  );
}

interface ViewOptionProps {
  testId: string;
  active: boolean;
  disabled: boolean;
  label: string;
  Icon: typeof List;
  onClick: () => void;
}

function ViewOption({ testId, active, disabled, label, Icon, onClick }: ViewOptionProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
      className={cn(
        'flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition-colors',
        active ? 'bg-accent/10 text-accent' : 'text-fg-secondary hover:bg-surface-raised',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
