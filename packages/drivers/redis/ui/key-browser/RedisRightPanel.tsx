/**
 * Right panel of the Redis DB view: tabbed detail area with 键详情/命令行/发布订阅/慢日志.
 *
 * Extracted from `RedisConnectionView` during the left-right split refactoring.
 *
 * ## Unmount-on-switch with state restoration
 *
 * Only the active tab is mounted at any time — switching tabs unmounts the
 * previous panel and mounts the new one (same pattern as the host's
 * `PanelContentRenderer` which uses `key={panel.id}` + Zustand stores).
 *
 * Each panel's internal state is preserved across switches via a
 * `useRef<Map>` snapshot cache:
 *  - On mount, the panel reads its initial state from the cache.
 *  - On unmount (or any state change), the panel writes its state back.
 *
 * This avoids the hidden-keep-alive antipattern where all visited panels stay
 * mounted forever, accumulating memory and making DOM queries unreliable.
 *
 * State machine (AGENTS.md):
 *  - enter: panel mounts with `activeTab` defaulting to `'detail'`;
 *  - state: switching tabs unmounts old panel, mounts new one;
 *  - exit: the panel is unmounted when the connection closes.
 */
import { useCallback, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, cn, useI18n } from '@datazen/ui';
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
  /**
   * Open the create-key dialog. Rendered as the tab bar's only action button:
   * the workbench owns the overlay, so the button needs no host round-trip.
   */
  onCreateKey?: () => void;
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
  onCreateKey,
}: RedisRightPanelProps) {
  const { t } = useI18n();
  // Support both controlled and uncontrolled tab mode.
  const [internalTab, setInternalTab] = useState<RightTab>('detail');
  const activeTab = controlledTab ?? internalTab;

  const handleTabClick = useCallback(
    async (tab: RightTab) => {
      if (tab === activeTab) return;
      // I-1: switching tabs unmounts the current panel, so an unsaved draft would be
      // lost.  Ask first; the leave dialog portals to document.body so it survives
      // the unmount.
      if (!(await requestDraftLeave())) return;
      if (onTabChange) {
        onTabChange(tab);
      } else {
        setInternalTab(tab);
      }
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
        {/*
          The panel's only action control. It used to live in the host toolbar's
          KV context bar, which put a create-key affordance for *this* panel on a
          row shared with every other driver surface; the workbench already owns
          the overlay, so the button belongs next to the tabs it creates into.
        */}
        {onCreateKey && (
          <Button
            variant="secondary"
            className="mr-2 h-7 shrink-0 gap-1 px-2 text-xs"
            title={t('redis.createKey')}
            aria-label={t('redis.createKey')}
            data-testid="redis-right-create-key"
            onClick={onCreateKey}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="whitespace-nowrap">{t('redis.createKey')}</span>
          </Button>
        )}
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

      {/* Tab content — only the active tab is mounted; React key forces unmount/remount */}
      <TabContent
        activeTab={activeTab}
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
        keySuggestions={keySuggestions}
        pinnedNodeAddr={pinnedNodeAddr}
        onPinnedNodeAddrChange={onPinnedNodeAddrChange}
      />
    </div>
  );
}

/**
 * Renders only the active tab panel.  Uses a `key` derived from `activeTab` so
 * React fully unmounts the old panel and mounts the new one on every switch.
 */
function TabContent({
  activeTab,
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
}: {
  activeTab: RightTab;
  dbSessionId: string;
  dbIndex: number;
  selectedKey: string | null;
  detail: KeyDetail | null;
  detailLoading: boolean;
  modules: string[] | null;
  onRefresh: () => void;
  onRenamed: (newKey: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onClose: () => void;
  keySuggestions?: string[];
  pinnedNodeAddr?: string;
  onPinnedNodeAddrChange?: (addr: string) => void;
}) {
  // The key forces React to unmount/remount on tab switch, matching the host's
  // PanelContentRenderer pattern (key={panel.id}).
  switch (activeTab) {
    case 'detail':
      return (
        <div key="detail" className="flex min-h-0 flex-1 flex-col">
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
      );
    case 'console':
      return (
        <div key="console" className="flex min-h-0 flex-1 flex-col">
          <RedisConsole
            dbSessionId={dbSessionId}
            dbIndex={dbIndex}
            keySuggestions={keySuggestions}
            pinnedNodeAddr={pinnedNodeAddr}
            onPinnedNodeAddrChange={onPinnedNodeAddrChange}
          />
        </div>
      );
    case 'pubsub':
      return (
        <div key="pubsub" className="flex min-h-0 flex-1 flex-col">
          <PubSubPanel dbSessionId={dbSessionId} />
        </div>
      );
    case 'slowlog':
      return (
        <div key="slowlog" className="flex min-h-0 flex-1 flex-col">
          <SlowlogPanel dbSessionId={dbSessionId} />
        </div>
      );
    default:
      return null;
  }
}
