import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createKvSlotState,
  disposeKvSlotState,
  getKvSlotState,
  pruneKvSlotStates,
  resetKvSlotStatesForTests,
} from '../kvSlotState';

beforeEach(() => {
  resetKvSlotStatesForTests();
});

describe('createKvSlotState', () => {
  it('starts with no selection and no unsaved edits', () => {
    const state = createKvSlotState();
    expect(state.getSelectedKey()).toBeNull();
    expect(state.getDirty()).toBe(false);
  });

  it('notifies subscribers when the selected key changes', () => {
    const state = createKvSlotState();
    const listener = vi.fn();
    state.subscribe(listener);

    state.selectKey('user:42');

    expect(state.getSelectedKey()).toBe('user:42');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stays silent when a selection is replayed unchanged', () => {
    const state = createKvSlotState();
    state.selectKey('user:42');
    const listener = vi.fn();
    state.subscribe(listener);

    state.selectKey('user:42');

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies on dirty transitions in both directions only when they change', () => {
    const state = createKvSlotState();
    const listener = vi.fn();
    state.subscribe(listener);

    state.setDirty(true);
    state.setDirty(true);
    expect(state.getDirty()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    state.setDirty(false);
    expect(state.getDirty()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops notifying after unsubscribe', () => {
    const state = createKvSlotState();
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);

    unsubscribe();
    state.selectKey('k1');
    state.setDirty(true);

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies every subscriber, e.g. context bar and key-props sidebar at once', () => {
    const state = createKvSlotState();
    const first = vi.fn();
    const second = vi.fn();
    state.subscribe(first);
    state.subscribe(second);

    state.selectKey('k9');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('panel-scoped KV slot atoms', () => {
  it('hands out the same atom for the same panel', () => {
    expect(getKvSlotState('panel-a')).toBe(getKvSlotState('panel-a'));
  });

  it('keeps two panels of one connection independent', () => {
    // Two KV tabs of the same Redis connection on different databases must not
    // share a selected key — hence the atoms are keyed by panel, not by session.
    const panelA = getKvSlotState('panel-a');
    const panelB = getKvSlotState('panel-b');

    panelA.selectKey('only-in-a');
    panelA.setDirty(true);

    expect(panelB.getSelectedKey()).toBeNull();
    expect(panelB.getDirty()).toBe(false);
  });

  it('drops a disposed panel atom and hands the next one a clean state', () => {
    const before = getKvSlotState('panel-a');
    before.selectKey('stale');
    before.setDirty(true);

    disposeKvSlotState('panel-a');
    const after = getKvSlotState('panel-a');

    expect(after).not.toBe(before);
    expect(after.getSelectedKey()).toBeNull();
    expect(after.getDirty()).toBe(false);
  });

  it('prunes every atom whose panel is gone and keeps the live ones', () => {
    const closed = getKvSlotState('panel-closed');
    const live = getKvSlotState('panel-live');
    closed.selectKey('x');
    live.selectKey('y');

    pruneKvSlotStates(new Set(['panel-live']));

    expect(getKvSlotState('panel-closed')).not.toBe(closed);
    expect(getKvSlotState('panel-live')).toBe(live);
    expect(getKvSlotState('panel-live').getSelectedKey()).toBe('y');
  });

  it('prunes nothing when every panel is still live', () => {
    const live = getKvSlotState('panel-live');
    pruneKvSlotStates(new Set(['panel-live', 'panel-other']));
    expect(getKvSlotState('panel-live')).toBe(live);
  });
});
