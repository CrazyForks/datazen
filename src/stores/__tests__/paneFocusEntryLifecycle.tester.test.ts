/**
 * [tester] Every action that touches pane focus must go through `syncPaneFocus`.
 *
 * `focusedPaneIdByPanel` has exactly one writer (`syncPaneFocus`, plus the two
 * whole-state literals at module scope and in `reset`). A reader cannot tell from
 * reading the code whether an action actually uses it, so the rule is pinned the
 * only way a store rule can be: by **mutation**.
 *
 * The accompanying harness `scripts-tester-mutation-pane-focus.py` reverts each
 * of the actions below to its pre-BUG-001 shape (a plain `activePanelId` write,
 * a plain global `focusedPaneId` write, or no focus patch at all) and requires
 * this file to go red. The first run of that harness caught 7/15 mutations; the
 * six that survived are exactly the six behaviours pinned here.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../../locales/t', () => ({
  t: (key: string) => key,
}));

const mockGetQueryHistory = vi.fn().mockResolvedValue([]);
const mockCancelQuery = vi.fn().mockResolvedValue(undefined);
const mockExecuteQueryStream = vi.fn().mockResolvedValue(undefined);

const activeConnectionState = {
  connections: {
    'cfg-1': {
      capabilities: {
        supportsCancelQuery: true,
        supportsQueryExecutionCancel: true,
        supportsExplain: true,
        supportsStreamingResults: true,
      },
    },
    'cfg-2': {
      capabilities: {
        supportsCancelQuery: true,
        supportsQueryExecutionCancel: true,
        supportsExplain: true,
        supportsStreamingResults: true,
      },
    },
  },
};

vi.mock('../../commands/query', () => ({
  queryCommands: {
    getQueryHistory: (...args: unknown[]) => mockGetQueryHistory(...args),
    getFavoriteQueries: vi.fn().mockResolvedValue([]),
    addFavoriteQuery: vi.fn().mockResolvedValue(undefined),
    deleteFavoriteQuery: vi.fn().mockResolvedValue(undefined),
    executeQueryStream: (...args: unknown[]) => mockExecuteQueryStream(...args),
    cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
    executeQuery: vi.fn().mockResolvedValue({ results: [], totalTimeMs: 10 }),
  },
}));

vi.mock('../../stores/activeConnectionStore', () => ({
  useActiveConnectionStore: {
    getState: () => activeConnectionState,
  },
}));

const A = 'panel-q-1';
const B = 'panel-q-2';
const C = 'panel-q-3';
const TBL = 'panel-tbl-1';
const P2 = 'p2';

describe('[tester] every focus-touching action goes through syncPaneFocus', () => {
  let usePanelStore: typeof import('../panelStore').usePanelStore;
  let paneKey: typeof import('../paneKeys').paneKey;
  let resolveFocusedPaneId: typeof import('../paneKeys').resolveFocusedPaneId;

  function makeQueryPanel(
    id: string,
    connectionId = 'cfg-1',
    database = 'app',
  ): import('../panelStore').QueryPanel {
    return {
      type: 'query',
      id,
      title: 'Q',
      connectionId,
      connectionName: 'TestDB',
      dbSessionId: 'sess-1',
      databaseType: 'postgresql',
      database,
      schema: null,
    };
  }

  function makeTablePanel(id: string, tableName: string, connectionId = 'cfg-1') {
    return {
      type: 'table' as const,
      id,
      tableName,
      connectionId,
      connectionName: 'TestDB',
      dbSessionId: 'sess-1',
      databaseType: 'postgresql' as const,
      database: 'app',
      tableSchema: 'public',
      subTab: 'data' as const,
    };
  }

  const st = () => usePanelStore.getState();
  const route = (panelId: string) => paneKey(panelId, resolveFocusedPaneId(st().focusedPaneId));

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    usePanelStore = (await import('../panelStore')).usePanelStore;
    const keys = await import('../paneKeys');
    paneKey = keys.paneKey;
    resolveFocusedPaneId = keys.resolveFocusedPaneId;
    usePanelStore.setState({
      panels: [],
      activePanelId: null,
      queryExec: new Map(),
      focusedPaneId: null,
      focusedPaneIdByPanel: {},
    });
  });

  it('addPanel: a newly activated tab must not inherit the tab being left focus', () => {
    st().addPanel(makeQueryPanel(A));
    st().openPane(A, P2);
    expect(st().focusedPaneId).toBe(P2);

    // The everyday P2 action: while tab A is split, the user opens a NEW query
    // tab. It is not split, so it must show its own pane — not `panel-q-2::p2`.
    st().addPanel(makeQueryPanel(B));
    expect(st().activePanelId).toBe(B);
    expect(st().focusedPaneId).toBeNull();
    expect(st().focusedPaneIdByPanel[B]).toBeUndefined();
    expect(route(B)).toBe(B);
    // And the split tab kept its own focus for when the user comes back.
    expect(st().focusedPaneIdByPanel[A]).toBe(P2);
    st().setActivePanel(A);
    expect(st().focusedPaneId).toBe(P2);
  });

  it('addPanel: a non-activated tab addition leaves the on-screen focus alone', () => {
    st().addPanel(makeQueryPanel(A));
    st().openPane(A, P2);
    st().addPanel(makeQueryPanel(B, 'cfg-1', 'app'), false);
    expect(st().activePanelId).toBe(A);
    expect(st().focusedPaneId).toBe(P2);
    expect(route(A)).toBe(`${A}::${P2}`);
  });

  it('removeAllForConnection: drops the focus of every tab it removes', () => {
    st().addPanel(makeQueryPanel(A));
    st().addPanel(makeQueryPanel(B));
    st().addPanel(makeQueryPanel(C, 'cfg-2'));
    st().openPane(A, P2);
    st().openPane(C, P2);
    st().openPane(B, P2);
    expect(Object.keys(st().focusedPaneIdByPanel).sort()).toEqual([A, B, C].sort());

    st().removeAllForConnection('cfg-1');
    // Only the surviving tab keeps an entry.
    expect(st().focusedPaneIdByPanel).toEqual({ [C]: P2 });
    expect(st().panels.map((p) => p.id)).toEqual([C]);
    expect(st().activePanelId).toBe(C);
    expect(st().focusedPaneId).toBe(P2);
  });

  it('removePanelsForRelation: drops the focus of the tabs it removes', () => {
    st().addPanel(makeQueryPanel(A));
    st().addPanel(makeTablePanel(TBL, 'users'));
    st().openPane(A, P2);
    st().setFocusedPane(P2, TBL);
    expect(Object.keys(st().focusedPaneIdByPanel).sort()).toEqual([A, TBL].sort());

    st().removePanelsForRelation('cfg-1', 'users');
    // A table tab owns no exec state, so it can be "split" in focus terms only;
    // what matters is that its entry does not outlive it.
    expect(Object.keys(st().focusedPaneIdByPanel)).not.toContain(TBL);
    expect(st().panels.map((p) => p.id)).toEqual([A]);
    expect(st().focusedPaneIdByPanel[A]).toBe(P2);
    expect(st().focusedPaneId).toBe(P2);
  });

  it('removePanelsForDatabase: drops the focus of the tabs it removes', () => {
    st().addPanel(makeQueryPanel(A, 'cfg-1', 'app'));
    st().addPanel(makeQueryPanel(B, 'cfg-1', 'other'));
    st().openPane(A, P2);
    st().openPane(B, P2);
    st().setActivePanel(B);
    expect(Object.keys(st().focusedPaneIdByPanel).sort()).toEqual([A, B].sort());

    st().removePanelsForDatabase('cfg-1', 'app');
    expect(st().focusedPaneIdByPanel).toEqual({ [B]: P2 });
    expect(st().panels.map((p) => p.id)).toEqual([B]);
    expect(st().activePanelId).toBe(B);
    expect(st().focusedPaneId).toBe(P2);
  });

  it('closeOtherPanels: drops the focus of every tab it closes', () => {
    st().addPanel(makeQueryPanel(A));
    st().addPanel(makeQueryPanel(B));
    st().addPanel(makeQueryPanel(C));
    st().openPane(A, P2);
    st().openPane(B, P2);
    st().openPane(C, P2);
    st().setActivePanel(B);
    expect(Object.keys(st().focusedPaneIdByPanel).sort()).toEqual([A, B, C].sort());

    st().closeOtherPanels(C);
    expect(st().panels.map((p) => p.id)).toEqual([C]);
    expect(st().focusedPaneIdByPanel).toEqual({ [C]: P2 });
    expect(st().focusedPaneId).toBe(P2);
  });

  it('closeAllPanels: clears the whole focus map and the mirror', () => {
    st().addPanel(makeQueryPanel(A));
    st().addPanel(makeQueryPanel(B));
    st().openPane(A, P2);
    st().openPane(B, P2);
    expect(st().focusedPaneId).toBe(P2);

    st().closeAllPanels();
    expect(st().panels).toEqual([]);
    expect(st().activePanelId).toBeNull();
    expect(st().focusedPaneIdByPanel).toEqual({});
    expect(st().focusedPaneId).toBeNull();
  });

  it('closePanelsToTheLeft: drops the focus of the tabs it closes', () => {
    st().addPanel(makeQueryPanel(A));
    st().addPanel(makeQueryPanel(B));
    st().addPanel(makeQueryPanel(C));
    st().openPane(A, P2);
    st().openPane(B, P2);
    st().openPane(C, P2);
    st().setActivePanel(B);
    expect(Object.keys(st().focusedPaneIdByPanel).sort()).toEqual([A, B, C].sort());

    st().closePanelsToTheLeft(C);
    expect(st().panels.map((p) => p.id)).toEqual([C]);
    expect(st().focusedPaneIdByPanel).toEqual({ [C]: P2 });
    expect(st().activePanelId).toBe(C);
    expect(st().focusedPaneId).toBe(P2);
  });

  it('reset: clears the focus map, not just the mirror', () => {
    st().addPanel(makeQueryPanel(A));
    st().addPanel(makeQueryPanel(B));
    st().openPane(A, P2);
    st().openPane(B, P2);
    expect(st().focusedPaneIdByPanel).toEqual({ [A]: P2, [B]: P2 });

    st().reset();
    expect(st().panels).toEqual([]);
    expect(st().focusedPaneIdByPanel).toEqual({});
    expect(st().focusedPaneId).toBeNull();
  });

  it('invariant: the mirror is correct on EVERY state emission, not just after it settles', () => {
    // The view subscribes to the mirror (`ContentView.tsx`: `focusedPaneId`).
    // Point-in-time checks cannot see a drift that exists for one `set()` and is
    // corrected by the next, and a React render can land exactly there. Watching
    // every emission closes that gap: the map and the mirror are written in the
    // same `set()`, so the invariant must hold at all times.
    const violations: string[] = [];
    const seen: Array<() => void> = [];
    const check = (s: ReturnType<typeof usePanelStore.getState>) => {
      const expected = s.activePanelId ? (s.focusedPaneIdByPanel[s.activePanelId] ?? null) : null;
      if (s.focusedPaneId !== expected) {
        violations.push(
          `active=${s.activePanelId} mirror=${JSON.stringify(s.focusedPaneId)} ` +
            `expected=${JSON.stringify(expected)} map=${JSON.stringify(s.focusedPaneIdByPanel)}`,
        );
      }
    };

    usePanelStore.subscribe((s) => {
      check(s);
      seen.push(() => undefined);
    });

    st().addPanel(makeQueryPanel(A));
    st().openPane(A, P2);
    st().addPanel(makeQueryPanel(B));
    st().addPanel(makeQueryPanel(C, 'cfg-2'));
    st().openPane(C, P2);
    st().setFocusedPane(P2, A);
    st().setActivePanel(B);
    st().setActivePanel(A);
    st().setFocusedPane(null);
    st().closePane(A, P2);
    st().openPane(A, P2);
    st().closePane(A, P2);
    st().closeOtherPanels(B);
    st().closeAllPanels();
    st().addPanel(makeQueryPanel(A));
    st().removePanel(A);
    st().addPanel(makeQueryPanel(A));
    st().reset();

    expect(violations).toEqual([]);
    expect(seen.length).toBeGreaterThanOrEqual(18);
  });

  it('invariant: no focus entry ever names a tab that is not open', () => {
    st().addPanel(makeQueryPanel(A));
    st().addPanel(makeQueryPanel(B));
    st().addPanel(makeQueryPanel(C, 'cfg-2'));
    st().openPane(A, P2);
    st().openPane(B, P2);
    st().openPane(C, P2);

    const openTabs = () => new Set(st().panels.map((p) => p.id));
    const orphanEntries = () =>
      Object.keys(st().focusedPaneIdByPanel).filter((id) => !openTabs().has(id));

    expect(orphanEntries()).toEqual([]);
    st().removeAllForConnection('cfg-1');
    expect(orphanEntries()).toEqual([]);
    st().closeAllPanels();
    expect(orphanEntries()).toEqual([]);
    st().reset();
    expect(orphanEntries()).toEqual([]);
  });
});
