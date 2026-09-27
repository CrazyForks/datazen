/**
 * In-memory REPL transcript for the Redis console, keyed by panel scope (see
 * `shared/panelScope.ts`).
 *
 * ## Why this lives in module scope instead of `useState`
 *
 * The host renders only the *active* panel: `PanelContentRenderer` returns
 * `null` for every other panel and remounts the incoming one with
 * `key={activePanel.id}`. Switching top-level tabs therefore destroys the whole
 * `RedisConnectionView -> RedisRightPanel -> RedisConsole` subtree, and any
 * component state with it. A module-level store outlives that unmount, which is
 * what makes each tab's console keep its scrollback when the user comes back.
 *
 * ## Why keyed by scope and not `dbSessionId`
 *
 * `dbSessionId` is the *connection* session, and every db tab of one connection
 * shares it - so keying by it gave db0 and db1 the same scrollback, the exact
 * opposite of what was intended. The panel scope keys one store per top-level
 * tab, so a sibling db opens with an empty console.
 *
 * Memory-only by design. This is session scratch that dies with the app; the
 * command *history* used for ↑↓ recall is a separate concern and stays in
 * localStorage (see `consoleHistory.ts`).
 */
import { useSyncExternalStore } from 'react';

import type { ConsoleResultItem } from './consoleResultRenderer';

export type TranscriptEntry =
  | { kind: 'command'; id: string; text: string; dbIndex: number }
  | { kind: 'result'; id: string; command: string; item: ConsoleResultItem }
  | { kind: 'error'; id: string; message: string };

interface SessionState {
  entries: TranscriptEntry[];
  draft: string;
}

const EMPTY: SessionState = { entries: [], draft: '' };

/**
 * Cap the scrollback so a long-lived tab cannot grow without bound. The cap
 * applies to the array length, but trimming always realigns to a `command`
 * entry so the oldest visible line is never a result whose command scrolled
 * out of view.
 */
const MAX_ENTRIES = 500;

const sessions = new Map<string, SessionState>();
const listeners = new Map<string, Set<() => void>>();

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function readSession(scope: string): SessionState {
  return sessions.get(scope) ?? EMPTY;
}

function writeSession(scope: string, next: SessionState): void {
  sessions.set(scope, next);
  for (const listener of listeners.get(scope) ?? []) listener();
}

/**
 * Bound subscribe, cached per scope.
 *
 * `useSyncExternalStore` compares `subscribe` by identity and re-subscribes
 * whenever it changes. A freshly built closure on every render would therefore
 * unsubscribe/resubscribe on each commit - churn during render, and lost
 * notifications if a write lands in the gap.
 */
const subscribes = new Map<string, (listener: () => void) => () => void>();

function subscribe(scope: string): (listener: () => void) => () => void {
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

function trim(entries: TranscriptEntry[]): TranscriptEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries;
  let start = entries.length - MAX_ENTRIES;
  while (start < entries.length && entries[start].kind !== 'command') start += 1;
  return start >= entries.length ? [] : entries.slice(start);
}

/** Append one executed command line, echoed with its `dbN>` prompt. */
export function appendCommand(scope: string, text: string, dbIndex: number): void {
  const current = readSession(scope);
  writeSession(scope, {
    ...current,
    entries: trim([...current.entries, { kind: 'command', id: nextId('c'), text, dbIndex }]),
  });
}

/** Append one successful/failed server result beneath its command. */
export function appendResult(scope: string, command: string, item: ConsoleResultItem): void {
  const current = readSession(scope);
  writeSession(scope, {
    ...current,
    entries: trim([...current.entries, { kind: 'result', id: nextId('r'), command, item }]),
  });
}

/**
 * Append a client-side rejection (blocked command, declined confirmation, IPC
 * failure). Server-signalled errors travel as a `result` with `ok: false`; this
 * is for everything the server never got to answer.
 */
export function appendError(scope: string, message: string): void {
  const current = readSession(scope);
  writeSession(scope, {
    ...current,
    entries: trim([...current.entries, { kind: 'error', id: nextId('e'), message }]),
  });
}

/** Drop a session's scrollback. Called when the console is cleared explicitly. */
export function clearTranscript(scope: string): void {
  writeSession(scope, { entries: [], draft: '' });
}

/** Persist the in-progress input so it survives a tab switch, like a shell line. */
export function setDraft(scope: string, draft: string): void {
  const current = readSession(scope);
  if (current.draft === draft) return;
  writeSession(scope, { ...current, draft });
}

export function useTranscriptEntries(scope: string): TranscriptEntry[] {
  return useSyncExternalStore(
    subscribe(scope),
    () => readSession(scope).entries,
    () => EMPTY.entries,
  );
}

export function useTranscriptDraft(scope: string): string {
  return useSyncExternalStore(
    subscribe(scope),
    () => readSession(scope).draft,
    () => EMPTY.draft,
  );
}

/** Test-only: forget a session so a case starts from a clean console. */
export function resetTranscript(scope: string): void {
  sessions.delete(scope);
  subscribes.delete(scope);
  listeners.delete(scope);
}
