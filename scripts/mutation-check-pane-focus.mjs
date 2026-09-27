/**
 * [tester] Mutation check for the BUG-001 pane-focus single-writer rule.
 *
 * `focusedPaneIdByPanel` has exactly one writer in production: `syncPaneFocus`
 * (plus the two whole-state literals at module scope and in `reset`). Reading
 * the code cannot tell you whether an action actually routes through it — only a
 * mutation can. This script reverts each focus-touching action in
 * `src/stores/panelStore.ts` to its pre-BUG-001 shape and requires the pane test
 * suite to go red.
 *
 * Usage:  node scripts/mutation-check-pane-focus.mjs [--keep-going]
 *
 * The store file is restored byte-for-byte after every mutation (a plain file
 * copy from an in-memory backup taken up front). No git command is used, and no
 * mutation is ever committed.
 *
 * `--testTimeout=30000` is passed deliberately: several tests here drive a
 * never-settling query stream, and a busy machine must not turn CPU contention
 * into a false RED. Every mutation below is expected to be caught by a specific
 * named assertion, not by a timeout.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = resolve(ROOT, 'src/stores/panelStore.ts');

const TESTS = [
  'src/stores/__tests__/panelStore.test.ts',
  'src/stores/__tests__/panelStore.panes.test.ts',
  'src/stores/__tests__/paneFocusScope.tester.test.ts',
  'src/stores/__tests__/paneFocusDifferentialRepro.tester.test.ts',
  'src/stores/__tests__/paneFocusEntryLifecycle.tester.test.ts',
  'src/stores/__tests__/paneP2ContractProbes.tester.test.ts',
  'src/stores/__tests__/paneRealSequence.tester.test.ts',
  'src/stores/__tests__/panelCloseNotifier.test.ts',
  'src/hooks/__tests__/useQueryExec.pane.tester.test.tsx',
  'src/windows/connection/__tests__/QueryPanel.paneRouting.test.tsx',
];

// The syncPaneFocus call site shared by removePanelsFor{Relation,Database}.
const REMOVE_SYNC = `      ...syncPaneFocus(
        s,
        remaining,
        activeStillExists ? activePanelId : (remaining.at(-1)?.id ?? null),
      ),`;
const REMOVE_PLAIN =
  '      activePanelId: activeStillExists ? activePanelId : (remaining.at(-1)?.id ?? null),';

// The syncPaneFocus call site shared by closePanelsTo{Left,Right}.
const CLOSESYNC_TO_RIGHT = `        panels: kept,
        queryExec: nextExec,
        ...syncPaneFocus(s, kept, activeStillExists ? s.activePanelId : panelId),
      };
    });
  },

  closePanelsToTheLeft: (panelId) => {`;
const CLOSE_TO_RIGHT = `        panels: kept,
        queryExec: nextExec,
        activePanelId: activeStillExists ? s.activePanelId : panelId,
      };
    });
  },

  closePanelsToTheLeft: (panelId) => {`;
const CLOSESYNC_TO_LEFT = `        panels: kept,
        queryExec: nextExec,
        ...syncPaneFocus(s, kept, activeStillExists ? s.activePanelId : panelId),
      };
    });
  },

  // ── Panes ─`;
const CLOSE_TO_LEFT = `        panels: kept,
        queryExec: nextExec,
        activePanelId: activeStillExists ? s.activePanelId : panelId,
      };
    });
  },

  // ── Panes ─`;

const MUTATIONS = [
  [
    'addPanel: drop syncPaneFocus (revert to a plain activePanelId write)',
    `      panels: [...s.panels, panel],
      queryExec: nextExec,
      // A freshly opened tab starts on its own default pane, so activating it
      // must not inherit the pane id the previously active tab had focused.
      ...syncPaneFocus(s, [...s.panels, panel], activate ? panel.id : s.activePanelId),`,
    `      panels: [...s.panels, panel],
      queryExec: nextExec,
      activePanelId: activate ? panel.id : s.activePanelId,`,
  ],
  [
    'removePanel: drop syncPaneFocus (no map pruning)',
    `      panels: nextPanels,
      queryExec: nextExec,
      ...syncPaneFocus(s, nextPanels, nextActive),`,
    `      panels: nextPanels,
      queryExec: nextExec,
      activePanelId: nextActive,`,
  ],
  [
    'removeAllForConnection: drop syncPaneFocus',
    `      panels: remaining,
      queryExec: nextExec,
      ...syncPaneFocus(s, remaining, nextActive),`,
    `      panels: remaining,
      queryExec: nextExec,
      activePanelId: nextActive,`,
  ],
  [
    'removePanelsForRelation: drop syncPaneFocus',
    `${REMOVE_SYNC}
    }));
  },

  removePanelsForDatabase: (connectionId, database, sessionDatabase) => {`,
    `${REMOVE_PLAIN}
    }));
  },

  removePanelsForDatabase: (connectionId, database, sessionDatabase) => {`,
  ],
  [
    'removePanelsForDatabase: drop syncPaneFocus',
    `${REMOVE_SYNC}
    }));
  },

  setActivePanel: (panelId) => {`,
    `${REMOVE_PLAIN}
    }));
  },

  setActivePanel: (panelId) => {`,
  ],
  [
    'setActivePanel: drop syncPaneFocus (mirror not re-derived)',
    '    set((s) => syncPaneFocus(s, s.panels, panelId ?? null));',
    '    set({ activePanelId: panelId ?? null });',
  ],
  [
    'closeOtherPanels: drop syncPaneFocus',
    `      panels: kept,
      queryExec: nextExec,
      ...syncPaneFocus(s, kept, panelId),`,
    `      panels: kept,
      queryExec: nextExec,
      activePanelId: panelId,`,
  ],
  [
    'closeAllPanels: drop syncPaneFocus',
    '    set((s) => ({ panels: [], queryExec: nextExec, ...syncPaneFocus(s, [], null) }));',
    '    set({ panels: [], queryExec: nextExec, activePanelId: null });',
  ],
  ['closePanelsToTheRight: drop syncPaneFocus', CLOSESYNC_TO_RIGHT, CLOSE_TO_RIGHT],
  ['closePanelsToTheLeft: drop syncPaneFocus', CLOSESYNC_TO_LEFT, CLOSE_TO_LEFT],
  [
    'setFocusedPane: revert to a single global write',
    '    set((cur) => syncPaneFocus(cur, cur.panels, cur.activePanelId, { panelId: target, paneId }));',
    '    set({ focusedPaneId: paneId || null });',
  ],
  [
    'openPane: revert to a single global write (and no activation)',
    `      const focus = syncPaneFocus(s, s.panels, panelId, { panelId, paneId });
      if (s.queryExec.has(key)) return focus;
      return { queryExec: new Map(s.queryExec).set(key, emptyQueryExecState()), ...focus };`,
    `      if (s.queryExec.has(key)) return s;
      return { queryExec: new Map(s.queryExec).set(key, emptyQueryExecState()), focusedPaneId: paneId };`,
  ],
  [
    'closePane: always clear the closed tab focus (even for an unfocused pane)',
    '          clearsFocus ? { panelId, paneId: null } : undefined,',
    '          { panelId, paneId: null },',
  ],
  [
    'closePane: never clear the focus of the tab it closed',
    `        queryExec: nextExec,
        ...syncPaneFocus(
          s,
          s.panels,
          s.activePanelId,
          clearsFocus ? { panelId, paneId: null } : undefined,
        ),`,
    `        queryExec: nextExec,
        ...syncPaneFocus(s, s.panels, s.activePanelId),`,
  ],
  [
    'reset: forget to clear focusedPaneIdByPanel',
    `      queryExec: new Map(),
      focusedPaneIdByPanel: {},
      focusedPaneId: null,`,
    `      queryExec: new Map(),
      focusedPaneId: null,`,
  ],
];

function runTests() {
  try {
    return {
      code: 0,
      out: execFileSync('npx', ['vitest', 'run', '--testTimeout=30000', ...TESTS], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      }),
    };
  } catch (err) {
    return {
      code: err.status ?? 1,
      out: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
}

const redTests = (out) =>
  out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('×') || l.startsWith('✗'));

const original = readFileSync(STORE, 'utf8');
const backup = `${STORE}.mutation-backup`;
writeFileSync(backup, original);

const summary = [];
try {
  const base = runTests();
  if (base.code !== 0) {
    console.error('!! baseline is not green — refusing to mutate. Stop and investigate.');
    console.error(base.out.slice(-4000));
    process.exitCode = 2;
  } else {
    console.log('BASELINE (unmutated) exit=0 — all pane tests green\n');

    for (const [name, old, next] of MUTATIONS) {
      const hits = original.split(old).length - 1;
      if (hits !== 1) {
        console.log(`SKIP  ${name}: anchor matched ${hits} times (refusing to guess)`);
        summary.push([name, 'SKIP']);
        continue;
      }
      writeFileSync(STORE, original.replace(old, next));
      const { code, out } = runTests();
      const failed = redTests(out);
      const status = code !== 0 ? 'RED' : 'GREEN(!)';
      console.log(`${status.padEnd(8)} ${name}`);
      for (const f of failed.slice(0, 8)) console.log(`           ${f}`);
      if (code !== 0 && failed.length === 0) {
        console.log('           (non-zero exit with no test name captured — suspect a timeout)');
      }
      summary.push([name, status]);
      writeFileSync(STORE, original);
    }

    const holes = summary.filter(([, s]) => s !== 'RED');
    console.log('\n===== SUMMARY =====');
    for (const [name, status] of summary) console.log(`  ${status.padEnd(8)} ${name}`);
    console.log(`\n${summary.length - holes.length}/${summary.length} mutations caught`);
    if (holes.length) {
      console.log('UNCOVERED (a defense hole — the suite cannot see this regression):');
      for (const [name] of holes) console.log(`  - ${name}`);
      process.exitCode = 1;
    } else {
      console.log('0 uncovered — every focus-touching action is pinned.');
    }
  }
} finally {
  writeFileSync(STORE, original);
  if (existsSync(backup)) unlinkSync(backup);
  const restored = readFileSync(STORE, 'utf8') === original;
  console.log(`\npanelStore.ts restored byte-for-byte: ${restored}`);
  if (!restored) process.exitCode = 3;
}
