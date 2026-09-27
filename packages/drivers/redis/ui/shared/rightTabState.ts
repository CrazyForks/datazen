/**
 * Active right-panel tab, keyed by `dbSessionId`.
 *
 * ## Why this is not `useState`
 *
 * The host renders only the active panel and remounts the incoming one with
 * `key={activePanel.id}` (`PanelContentRenderer`). Everything below the top-level
 * tab bar — `RedisConnectionView → RedisWorkbench → RedisRightPanel` — is
 * therefore destroyed whenever the user switches tabs, taking component state
 * with it. A `useState<RightTab>('detail')` reset the user back to the item
 * sub-tab every time they came back, which read as "my console vanished".
 *
 * Same trade-off as `consoleTranscript.ts`, and for the same reason: module
 * scope outlives the unmount. Keying by `dbSessionId` keeps every tab's sub-tab
 * choice independent, matching the host's one-panel-per-db model.
 */
import { useSyncExternalStore } from 'react';

export type RightTab = 'detail' | 'console' | 'pubsub' | 'slowlog';

/** Kept here so the store does not have to import the view layer. */
export type RightTabState = RightTab;

const DEFAULT_TAB: RightTab = 'detail';

const tabs = new Map<string, RightTab>();
const listeners = new Map<string, Set<() => void>>();

function subscribe(dbSessionId: string): (listener: () => void) => () => void {
  return (listener) => {
    let set = listeners.get(dbSessionId);
    if (!set) {
      set = new Set();
      listeners.set(dbSessionId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(dbSessionId);
    };
  };
}

/**
 * Bound subscribe, cached per session.
 *
 * `useSyncExternalStore` compares `subscribe` by identity and re-subscribes
 * whenever it changes. A freshly built closure on every render would therefore
 * unsubscribe/resubscribe on each commit — churn during render, and lost
 * notifications if a write lands in the gap. The per-session entry keeps one
 * stable function for as long as the session exists.
 */
const subscribes = new Map<string, (listener: () => void) => () => void>();

function stableSubscribe(dbSessionId: string): (listener: () => void) => () => void {
  let sub = subscribes.get(dbSessionId);
  if (!sub) {
    sub = subscribe(dbSessionId);
    subscribes.set(dbSessionId, sub);
  }
  return sub;
}

/** Read a session's tab without subscribing. */
export function readRightTab(dbSessionId: string): RightTab {
  return tabs.get(dbSessionId) ?? DEFAULT_TAB;
}

/** Persist a tab choice. A no-op write is skipped so `useSyncExternalStore` stays quiet. */
export function writeRightTab(dbSessionId: string, tab: RightTab): void {
  if (readRightTab(dbSessionId) === tab) return;
  tabs.set(dbSessionId, tab);
  for (const listener of listeners.get(dbSessionId) ?? []) listener();
}

export function useRightTab(dbSessionId: string): RightTab {
  return useSyncExternalStore(
    stableSubscribe(dbSessionId),
    () => readRightTab(dbSessionId),
    () => DEFAULT_TAB,
  );
}

/** Test-only: forget a session so a case starts from the default tab. */
export function resetRightTab(dbSessionId: string): void {
  tabs.delete(dbSessionId);
  subscribes.delete(dbSessionId);
  listeners.delete(dbSessionId);
}
