/**
 * Active right-panel sub-tab, keyed by panel scope (see `panelScope.ts`).
 *
 * ## Why this is not `useState`
 *
 * The host renders only the active panel and remounts the incoming one with
 * `key={activePanel.id}` (`PanelContentRenderer`). Everything below the top-level
 * tab bar - `RedisConnectionView -> RedisWorkbench -> RedisRightPanel` - is
 * therefore destroyed whenever the user switches tabs, taking component state
 * with it. A `useState<RightTab>('detail')` reset the user back to the item
 * sub-tab every time they came back, which read as "my console vanished".
 *
 * Same trade-off as `consoleTranscript.ts`, and for the same reason: module
 * scope outlives the unmount.
 *
 * ## Why keyed by scope and not `dbSessionId`
 *
 * `dbSessionId` is shared by every db tab of one connection, so keying by it
 * leaked one tab's sub-tab into a sibling: db0 on the console also opened a
 * fresh db1 tab on the console. The key is the panel scope instead, so state
 * survives a remount of *the same* tab and never crosses to another one.
 */
import { useSyncExternalStore } from 'react';

export type RightTab = 'detail' | 'console' | 'pubsub' | 'slowlog';

const DEFAULT_TAB: RightTab = 'detail';

const tabs = new Map<string, RightTab>();
const listeners = new Map<string, Set<() => void>>();

/**
 * Bound subscribe, cached per scope.
 *
 * `useSyncExternalStore` compares `subscribe` by identity and re-subscribes
 * whenever it changes. A freshly built closure on every render would therefore
 * unsubscribe/resubscribe on each commit - churn during render, and lost
 * notifications if a write lands in the gap. One stable function is kept for as
 * long as the scope exists.
 */
const subscribes = new Map<string, (listener: () => void) => () => void>();

function stableSubscribe(scope: string): (listener: () => void) => () => void {
  let sub = subscribes.get(scope);
  if (!sub) {
    sub = (listener) => {
      let set = listeners.get(scope);
      if (!set) {
        set = new Set();
        listeners.set(scope, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(scope);
      };
    };
    subscribes.set(scope, sub);
  }
  return sub;
}

/** Read a scope's tab without subscribing. */
export function readRightTab(scope: string): RightTab {
  return tabs.get(scope) ?? DEFAULT_TAB;
}

/** Persist a tab choice. A no-op write is skipped so `useSyncExternalStore` stays quiet. */
export function writeRightTab(scope: string, tab: RightTab): void {
  if (readRightTab(scope) === tab) return;
  tabs.set(scope, tab);
  for (const listener of listeners.get(scope) ?? []) listener();
}

export function useRightTab(scope: string): RightTab {
  return useSyncExternalStore(
    stableSubscribe(scope),
    () => readRightTab(scope),
    () => DEFAULT_TAB,
  );
}

/** Test-only: forget a scope so a case starts from the default tab. */
export function resetRightTab(scope: string): void {
  tabs.delete(scope);
  subscribes.delete(scope);
  listeners.delete(scope);
}
