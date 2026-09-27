/**
 * In-memory REPL transcript for the Redis console, keyed by `dbSessionId`.
 *
 * ## Why this lives in module scope instead of `useState`
 *
 * The host renders only the *active* panel: `PanelContentRenderer` returns
 * `null` for every other panel and remounts the incoming one with
 * `key={activePanel.id}`. Switching top-level tabs therefore destroys the whole
 * `RedisConnectionView → RedisRightPanel → RedisConsole` subtree, and any
 * component state with it. A module-level store outlives that unmount, which is
 * what makes each tab's console keep its scrollback when the user comes back.
 *
 * Keying by `dbSessionId` is what gives every db its own independent console:
 * one session per panel, so `db0` and `db1` never share entries or drafts.
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

function readSession(dbSessionId: string): SessionState {
  return sessions.get(dbSessionId) ?? EMPTY;
}

function writeSession(dbSessionId: string, next: SessionState): void {
  sessions.set(dbSessionId, next);
  for (const listener of listeners.get(dbSessionId) ?? []) listener();
}

/** Subscribe a component to one session's transcript. */
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

function trim(entries: TranscriptEntry[]): TranscriptEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries;
  let start = entries.length - MAX_ENTRIES;
  while (start < entries.length && entries[start].kind !== 'command') start += 1;
  return start >= entries.length ? [] : entries.slice(start);
}

/** Append one executed command line, echoed with its `dbN>` prompt. */
export function appendCommand(dbSessionId: string, text: string, dbIndex: number): void {
  const current = readSession(dbSessionId);
  writeSession(dbSessionId, {
    ...current,
    entries: trim([...current.entries, { kind: 'command', id: nextId('c'), text, dbIndex }]),
  });
}

/** Append one successful/failed server result beneath its command. */
export function appendResult(dbSessionId: string, command: string, item: ConsoleResultItem): void {
  const current = readSession(dbSessionId);
  writeSession(dbSessionId, {
    ...current,
    entries: trim([...current.entries, { kind: 'result', id: nextId('r'), command, item }]),
  });
}

/**
 * Append a client-side rejection (blocked command, declined confirmation, IPC
 * failure). Server-signalled errors travel as a `result` with `ok: false`; this
 * is for everything the server never got to answer.
 */
export function appendError(dbSessionId: string, message: string): void {
  const current = readSession(dbSessionId);
  writeSession(dbSessionId, {
    ...current,
    entries: trim([...current.entries, { kind: 'error', id: nextId('e'), message }]),
  });
}

/** Drop a session's scrollback. Called when the console is cleared explicitly. */
export function clearTranscript(dbSessionId: string): void {
  writeSession(dbSessionId, { entries: [], draft: '' });
}

/** Persist the in-progress input so it survives a tab switch, like a shell line. */
export function setDraft(dbSessionId: string, draft: string): void {
  const current = readSession(dbSessionId);
  if (current.draft === draft) return;
  writeSession(dbSessionId, { ...current, draft });
}

export function useTranscriptEntries(dbSessionId: string): TranscriptEntry[] {
  return useSyncExternalStore(
    subscribe(dbSessionId),
    () => readSession(dbSessionId).entries,
    () => EMPTY.entries,
  );
}

export function useTranscriptDraft(dbSessionId: string): string {
  return useSyncExternalStore(
    subscribe(dbSessionId),
    () => readSession(dbSessionId).draft,
    () => EMPTY.draft,
  );
}

/** Test-only: forget a session so a case starts from a clean console. */
export function resetTranscript(dbSessionId: string): void {
  sessions.delete(dbSessionId);
}
