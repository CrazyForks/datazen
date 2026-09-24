/**
 * Right panel of the Redis DB view: tabbed detail area with 键详情/命令行/发布订阅/慢日志.
 *
 * Extracted from `RedisConnectionView` during the left-right split refactoring.
 * The panel renders the active tab content.  Tabs stay mounted once visited so
 * their internal state (console draft, pubsub subscriptions, slowlog data) is
 * never lost on switch.
 *
 * State machine (AGENTS.md):
 *  - enter: panel mounts with `activeTab` defaulting to `'detail'`;
 *  - state: switching tabs updates `activeTab` and adds to `visitedTabs`;
 *  - exit: the panel is unmounted when the connection closes.
 */
import { useCallback, useState } from 'react';
import { cn, useI18n } from '@datazen/ui';
import type { KeyDetail } from '../shared/types';
import { DetailColumn } from './DetailColumn';
import { RedisConsole } from '../console/RedisConsole';
import { PubSubPanel } from '../observe/PubSubPanel';
import { SlowlogPanel } from '../observe/SlowlogPanel';
import { requestDraftLeave } from '../shared/draftGuard';

/** Right-panel tab ids — matches the prototype's tab order. */
export type RightTab = 'detail' | 'console' | 'pubsub' | 'slowlog';

const RIGHT_TABS: RightTab[] = ['detail', 'console', 'pubsub', 'slowlog'];

const RIGHT_TAB_LABEL_KEYS: Record<RightTab, string> = {
  detail: 'redis.items',
  console: 'redis.console',
  pubsub: 'redis.pubsub',
  slowlog: 'redis.slowlog',
};

export interface RedisRightPanelProps {
  dbSessionId: string;
  dbIndex: number;
  /** Key currently selected in the left tree. */
  selectedKey: string | null;
  /** Fetched key detail (null when nothing selected or still loading). */
  detail: KeyDetail | null;
  detailLoading: boolean;
  modules: string[] | null;
  onRefresh: () => void;
  onRenamed: (newKey: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onClose: () => void;
  /** Console completion feed — the current key list from the left panel. */
  keySuggestions?: string[];
  /** Cluster node for console/monitor. */
  pinnedNodeAddr?: string;
  onPinnedNodeAddrChange?: (addr: string) => void;
  /** Connection name shown in the header for context. */
  connectionName?: string;
  selectedDb?: string;
  /** Currently active tab (controlled by parent). */
  activeTab?: RightTab;
  /** Callback when the user clicks a tab (controlled by parent). */
  onTabChange?: (tab: RightTab) => void;
}

/**
 * Tab bar + content of the right panel.  The caller is responsible for the
 * resize handle and the overall left-right split layout.
 */
export function RedisRightPanel({
  dbSessionId,
  dbIndex,
  selectedKey,
  detail,
  detailLoading,
  modules,
  onRefresh,
  onRenamed,
  onDirtyChange,
  onClose,
  keySuggestions,
  pinnedNodeAddr,
  onPinnedNodeAddrChange,
  connectionName,
  selectedDb,
  activeTab: controlledTab,
  onTabChange,
}: RedisRightPanelProps) {
  const { t } = useI18n();
  // Support both controlled and uncontrolled tab mode.
  const [internalTab, setInternalTab] = useState<RightTab>('detail');
  const activeTab = controlledTab ?? internalTab;
  const [visitedTabs, setVisitedTabs] = useState<RightTab[]>(['detail']);

  const handleTabClick = useCallback(
    async (tab: RightTab) => {
      if (tab === activeTab) return;
      // I-1: switching tabs hides the current panel, so an unsaved draft would be
      // stranded.  Ask first; the leave dialog lives inside the dirty editor and
      // portals to `document.body`, so it stays visible on the hidden tab.
      if (!(await requestDraftLeave())) return;
      if (onTabChange) {
        onTabChange(tab);
      } else {
        setInternalTab(tab);
      }
      setVisitedTabs((prev) => (prev.includes(tab) ? prev : [...prev, tab]));
    },
    [activeTab, onTabChange],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="redis-right-panel">
      {/* Tab bar */}
      <div
        className="flex shrink-0 items-center gap-0 border-b border-edge bg-surface-alt"
        data-testid="redis-right-tab-bar"
      >
        {RIGHT_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            data-testid={`redis-right-tab-${tab}`}
            data-active={activeTab === tab ? 'true' : 'false'}
            className={cn(
              'relative px-4 py-2.5 text-xs transition-colors',
              activeTab === tab ? 'text-fg font-medium' : 'text-fg-secondary hover:text-fg',
            )}
            onClick={() => void handleTabClick(tab)}
          >
            {t(RIGHT_TAB_LABEL_KEYS[tab])}
            <span
              className={cn(
                'absolute inset-x-0 bottom-0 h-0.5 bg-accent transition-opacity duration-300',
                activeTab === tab ? 'opacity-100' : 'opacity-0',
              )}
            />
          </button>
        ))}
        <div className="flex-1" />
        {connectionName && selectedDb && (
          <span
            className="max-w-[40%] truncate px-3 text-[11px] text-fg-muted"
            title={`${connectionName} · ${selectedDb}`}
            data-testid="redis-right-context"
          >
            {connectionName} · {selectedDb}
          </span>
        )}
      </div>

      {/* Tab content — each visited tab stays mounted */}
      {visitedTabs.includes('detail') && (
        <div className={cn('flex min-h-0 flex-1 flex-col', activeTab !== 'detail' && 'hidden')}>
          <DetailColumn
            dbSessionId={dbSessionId}
            dbIndex={dbIndex}
            selectedKey={selectedKey}
            detail={detail}
            detailLoading={detailLoading}
            modules={modules}
            onRefresh={onRefresh}
            onRenamed={onRenamed}
            onDirtyChange={onDirtyChange}
            onClose={onClose}
          />
        </div>
      )}
      {visitedTabs.includes('console') && (
        <div className={cn('flex min-h-0 flex-1 flex-col', activeTab !== 'console' && 'hidden')}>
          <RedisConsole
            dbSessionId={dbSessionId}
            dbIndex={dbIndex}
            keySuggestions={keySuggestions}
            pinnedNodeAddr={pinnedNodeAddr}
            onPinnedNodeAddrChange={onPinnedNodeAddrChange}
          />
        </div>
      )}
      {visitedTabs.includes('pubsub') && (
        <div className={cn('flex min-h-0 flex-1 flex-col', activeTab !== 'pubsub' && 'hidden')}>
          <PubSubPanel dbSessionId={dbSessionId} />
        </div>
      )}
      {visitedTabs.includes('slowlog') && (
        <div className={cn('flex min-h-0 flex-1 flex-col', activeTab !== 'slowlog' && 'hidden')}>
          <SlowlogPanel dbSessionId={dbSessionId} />
        </div>
      )}
    </div>
  );
}
