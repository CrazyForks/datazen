/**
 * Read-side hooks for the host-owned KV slot relay (contract F-2).
 *
 * The KV slots live in different React subtrees from the workbench, so the
 * per-panel `KvSlotState` atom is the only channel between them — and the atom's
 * getters plus `subscribe` are `useSyncExternalStore`-shaped for exactly this
 * consumer: each slot subscribes to the single field it renders, so a selection
 * change never re-renders the whole workspace.
 *
 * The host freezes the atom object for the panel's lifetime, hence `state.subscribe`
 * is a stable identity and safe to hand straight to `useSyncExternalStore`.
 */
import { useSyncExternalStore } from 'react';
import type { KvSlotState } from '@datazen/driver-sdk';

/** Key currently selected in the workbench's key tree, `null` when none. */
export function useKvSelectedKey(state: KvSlotState): string | null {
  return useSyncExternalStore(state.subscribe, state.getSelectedKey);
}

/** Whether the panel holds an unsaved editor draft (PRD §4 I-1 dirty gate). */
export function useKvDirty(state: KvSlotState): boolean {
  return useSyncExternalStore(state.subscribe, state.getDirty);
}
