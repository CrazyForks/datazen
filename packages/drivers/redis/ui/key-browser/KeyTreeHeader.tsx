import type { ReactNode } from 'react';
import { CheckSquare, ListChecks, Plus, RefreshCw } from 'lucide-react';
import { Button, useI18n } from '@datazen/ui';
import { SearchModeTabs, type SearchMode } from './SearchModeTabs';

/**
 * Row R1 of the key-tree column header (PRD §3.2 屏 B 左列).
 *
 * This row is *resident*: the search-scope segment control used to sit in the
 * database sidebar, which the host hides whenever it renders its own navigator
 * tree (`hideSidebar`) — so in the normal layout the user could never switch
 * between key / value / all search. R1 owns the segment control, the loaded-vs-total
 * counter and the action group that the tree's selection feeds.
 *
 * Counter semantics (PRD §3.2 R1 + I-4): `已加载 N / 共 M` while the scan cursor is
 * exhausted, `N+` while it is not — an unfinished scan never presents a partial
 * subset as a total.
 *
 * R2 search and R3 grouping rows mount as `children` so the header stays one
 * bordered block instead of sibling divs in the workbench.
 */

export interface KeyTreeHeaderProps {
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  /** Keys currently materialised in the tree. */
  loadedCount: number;
  /** `DBSIZE` of the selected database. */
  totalCount: number;
  /** Scan cursor still open ⇒ the loaded set is partial (`N+`). */
  scanning: boolean;
  onSelectAll: () => void;
  onRefresh: () => void;
  onCreateKey: () => void;
  children?: ReactNode;
}

export function KeyTreeHeader({
  searchMode,
  onSearchModeChange,
  loadedCount,
  totalCount,
  scanning,
  onSelectAll,
  onRefresh,
  onCreateKey,
  children,
}: KeyTreeHeaderProps) {
  const { t } = useI18n();
  const isKeyMode = searchMode === 'key';
  const loadedLabel = scanning ? `${loadedCount}+` : String(loadedCount);

  return (
    <div
      className="flex shrink-0 flex-col gap-1 border-b border-edge bg-surface-alt px-2 py-1.5"
      data-testid="redis-tree-header"
      data-search-mode={searchMode}
    >
      <div className="flex items-center gap-2">
        <SearchModeTabs mode={searchMode} onChange={onSearchModeChange} />
        <span className="h-4 w-px shrink-0 bg-edge" />
        <span
          className="min-w-0 truncate text-[11px] text-fg-muted"
          data-testid="redis-tree-count"
          data-loaded={loadedCount}
          data-total={totalCount}
          data-partial={scanning ? 'true' : 'false'}
        >
          {t('redis.tree.loadedOfTotal')
            .replace('{loaded}', loadedLabel)
            .replace('{total}', String(totalCount))}
        </span>
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-1">
          <HeaderIcon
            testId="redis-tree-select-all"
            labelKey="redis.tree.selectAll"
            Icon={CheckSquare}
            disabled={!isKeyMode || loadedCount === 0}
            onClick={onSelectAll}
          />
          <HeaderIcon
            testId="redis-tree-refresh"
            labelKey="connWin.refresh"
            Icon={RefreshCw}
            onClick={onRefresh}
          />
          <HeaderIcon
            testId="redis-tree-create-key"
            labelKey="redis.createKey"
            Icon={Plus}
            onClick={onCreateKey}
          />
        </div>
      </div>
      {children}
    </div>
  );
}

interface HeaderIconProps {
  testId: string;
  labelKey: string;
  Icon: typeof ListChecks;
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
}

function HeaderIcon({ testId, labelKey, Icon, disabled, onClick, children }: HeaderIconProps) {
  const { t } = useI18n();
  return (
    <Button
      variant="ghost"
      className="relative h-7 w-7 shrink-0 p-0"
      title={t(labelKey)}
      aria-label={t(labelKey)}
      data-testid={testId}
      data-action-label-key={labelKey}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Button>
  );
}
