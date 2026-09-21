/**
 * Host-owned per-panel KV slot state.
 *
 * A KV panel's surfaces (workbench tab, 48px context bar, status bar, key-props
 * sidebar) are mounted in three different React subtrees, yet they have to agree
 * on two facts: which key is selected, and whether there are unsaved edits.
 * Neither the driver nor the host can own this alone — the driver may not import
 * host stores (boundary guard R1) and the host must not know what a "draft" is.
 * So the host keeps an opaque, per-panel state atom and hands the same object to
 * every party through props; the contract lives in
 * `@datazen/driver-sdk` (`KvSlotState`).
 *
 * The getters + `subscribe` pair is `useSyncExternalStore`-shaped on purpose:
 * consumers subscribe to the single field they render, so key-tree selection
 * never re-renders the whole workspace.
 */
import type { KvSlotState } from '@datazen/driver-sdk';

/** Create a detached KV state atom (exported for tests and host-side callers). */
export function createKvSlotState(): KvSlotState {
  const listeners = new Set<() => void>();
  let selectedKey: string | null = null;
  let dirty = false;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSelectedKey() {
      return selectedKey;
    },
    selectKey(key) {
      if (key === selectedKey) return;
      selectedKey = key;
      notify();
    },
    getDirty() {
      return dirty;
    },
    setDirty(next) {
      if (next === dirty) return;
      dirty = next;
      notify();
    },
  };
}

const atoms = new Map<string, KvSlotState>();

/**
 * The atom for {@link panelId}, created on first use.
 *
 * Keyed by panel id (not `dbSessionId`) because two panels of the same KV
 * connection can be open on different databases and must not share a selection.
 */
export function getKvSlotState(panelId: string): KvSlotState {
  let atom = atoms.get(panelId);
  if (!atom) {
    atom = createKvSlotState();
    atoms.set(panelId, atom);
  }
  return atom;
}

/**
 * Drop the atoms of every panel absent from {@link livePanelIds}.
 * Called by the workspace whenever its panel list changes, mirroring how
 * table-data slices are pruned. This is the single recycling path — the host
 * never disposes one panel's atom directly, so atoms cannot accumulate.
 */
export function pruneKvSlotStates(livePanelIds: ReadonlySet<string>): void {
  for (const panelId of [...atoms.keys()]) {
    if (!livePanelIds.has(panelId)) atoms.delete(panelId);
  }
}

/** Test helper: forget every atom (production code must not call this). */
export function resetKvSlotStatesForTests(): void {
  atoms.clear();
}
