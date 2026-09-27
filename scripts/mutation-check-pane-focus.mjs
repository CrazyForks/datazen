/**
 * [tester] Mutation check for the BUG-001 pane-focus single-writer rule.
 *
 * `focusedPaneIdByPanel` has exactly one writer in production: `syncPaneFocus`
 * (plus the two whole-state literals at module scope and in `reset`). Reading
 * the code cannot tell you whether an action actually routes through it — only a
 * mutation can. This script reverts each focus-touching action in
 * `src/stores/panelStore.ts` to its pre-BUG-001 shape and requires the **pane
 * suite** to go red: the 10 files in `TESTS` below, run together. Nothing here
 * looks at one file — a cell is RED when the whole `TESTS` run exits non-zero, so
 * a mutation that only some *other* file in that list can see still counts as
 * caught. "This file went red" is not a criterion this script evaluates.
 *
 * Usage:  node scripts/mutation-check-pane-focus.mjs [--keep-going]
 *   `--keep-going` is accepted and is also the default: the loop never stops at
 *   the first uncovered mutation, it reports every one of them.
 *
 * The restore is **anchored to git, not to a disk re-read**. `PRISTINE` is always
 * `git show HEAD:src/stores/panelStore.ts`, and every mutated file is built from
 * it — never from whatever happens to be on disk. Two guards follow from that,
 * and both are load-bearing; an earlier version had neither, and was measured to
 * be silently wrong on both:
 *
 *   - **INTERFERENCE** — if the file on disk already differs from HEAD *before*
 *     the first injection, this run would not be measuring the committed state.
 *     It says so on stdout AND stderr, refuses to run, and exits 4 without
 *     touching the file.
 *   - **VOID** — if after a mutation the file on disk is not byte-identical to
 *     what this run wrote, that mutation's result cannot be read at all: a
 *     write-back that silently failed used to be printed as `RED`. It is recorded
 *     as VOID and exits 5.
 *
 * That earlier version snapshotted the file from disk, restored the snapshot,
 * and then compared the file with **that same snapshot**: a tautology, blind to
 * git, which can only ever prove "the file equals what I just wrote". It printed
 * `restored byte-for-byte: true` even when the working tree had already been
 * drifted by someone else — measured: one pure-comment line added to
 * `panelStore.ts`, harness run to completion, the drifted bytes written back and
 * a clean restore reported, exit 0.
 *
 * The write-back target is the committed file, which on any run that got past the
 * interference assertion is byte-identical to what was found on disk (that
 * equality is exactly what the assertion proves). The single exception is at
 * `restoreTarget` below and is deliberately **not** a restore — read it before
 * "simplifying" the two arms into one. `<path>.mutation-backup` holds the startup
 * bytes and is removed only on a clean exit. No mutation is ever committed.
 *
 * Exit codes — 0 is the only value that means "this measurement is trustworthy":
 *   0 clean · 1 uncovered · 2 baseline not green · 3 write-back verification
 *   failed · 4 pre-injection interference with HEAD · 5 a mutation was VOID.
 * If several apply, the highest wins, and **every** condition found is printed.
 *
 * `PANE_MUTATION_FAULT` is a debug-only fault injector (off by default), the
 * counterpart of `NEW_WT_FORCE_FAIL` in scripts/new-feature-worktree.sh:
 *   write-back — corrupt the file right after the harness writes it back, so the
 *               VOID guard is exercised by a real external write rather than only
 *               by reasoning that one would break it.
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
const STORE_REL = 'src/stores/panelStore.ts';
const STORE = resolve(ROOT, STORE_REL);

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

// Exit codes. 0 is the only one that means "this measurement is trustworthy".
const EXIT = {
  CLEAN: 0,
  UNCOVERED: 1,
  BASELINE: 2,
  WRITE_BACK: 3,
  INTERFERENCE: 4,
  VOID: 5,
};
const exitReasons = [];
/** Record a non-clean condition: printed on stderr, folded into the exit code. */
const fail = (code, why) => {
  exitReasons.push(code);
  console.error(`✖ ${why}`);
};

/** The committed bytes of `rel` — the only source of truth for the base file. */
function headBlob(rel) {
  try {
    return execFileSync('git', ['show', `HEAD:${rel}`], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    console.error(`✖ cannot read the committed blob: git show HEAD:${rel}`);
    console.error(String(err.stderr ?? err.message ?? err));
    process.exit(EXIT.INTERFERENCE);
  }
}

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

// PRISTINE is the committed file; PRE_DISK is what the working tree actually
// held. They are equal in a clean tree, and *comparing* them is the whole point:
// without that comparison the harness cannot tell "I restored my own snapshot"
// (true for whatever the snapshot was) from "the tree is where it should be".
const head = headBlob(STORE_REL);
const pristine = head.toString('utf8');
const preDisk = readFileSync(STORE);
const driftedBeforeRun = !preDisk.equals(head);

const backup = `${STORE}.mutation-backup`;
writeFileSync(backup, preDisk);

if (driftedBeforeRun) {
  console.log(
    `\nINTERFERENCE: ${STORE_REL} differs from HEAD before injection.\n` +
      `  The base file is taken from HEAD, so the mutations below would be applied to a\n` +
      `  code state nobody committed, and the resulting numbers would not be a measurement\n` +
      `  of the pane focus rule. Refusing to run; the file is left exactly as found.\n` +
      `  What is on disk right now was kept byte-for-byte here: ${backup}\n` +
      `  (manual restore: cp ${backup} ${STORE})`,
  );
  fail(
    EXIT.INTERFERENCE,
    `${STORE_REL} differs from HEAD before injection — see: git diff HEAD -- ${STORE_REL}`,
  );
}

// What every write-back in this script targets.
//
// Normal path: the committed file. The assertion above proved the startup bytes
// ARE the HEAD blob, so `head` and `preDisk` are the same bytes here — naming
// `head` states what is actually restored instead of leaving it implicit.
//
// INTERFERENCE path: `preDisk`, and **this arm is deliberately not a restore at
// all**. That run refused before injecting anything, so there is nothing to undo.
// A "unified" write-back of the HEAD blob here would delete the very drift the
// run just reported — reporting interference and then silently reverting it is a
// new way to destroy someone's uncommitted work. Writing `preDisk` is a no-op,
// and it is also the honest one. Do not collapse these two arms into one.
const restoreTarget = driftedBeforeRun ? preDisk : head;

const summary = [];
// The debug-only fault injector fires once, so a single VOID row is demonstrable
// without turning a whole run into an unreadable wall of VOID.
let faultFired = false;
try {
  if (driftedBeforeRun) {
    // Reported above. Running the baseline here would spend minutes measuring a
    // code state nobody committed, and the numbers could not be trusted
    // afterwards anyway, so the run stops here on purpose.
    console.log('(no baseline run, no mutation run — see INTERFERENCE above)');
  } else {
    const base = runTests();
    if (base.code !== 0) {
      console.error('!! baseline is not green — refusing to mutate. Stop and investigate.');
      console.error(base.out.slice(-4000));
      fail(EXIT.BASELINE, 'baseline (unmutated) pane suite is not green');
    } else {
      console.log('BASELINE (unmutated) exit=0 — all pane tests green\n');

      for (const [name, old, next] of MUTATIONS) {
        const hits = pristine.split(old).length - 1;
        if (hits !== 1) {
          console.log(`SKIP  ${name}: anchor matched ${hits} times (refusing to guess)`);
          summary.push([name, 'SKIP']);
          continue;
        }
        writeFileSync(STORE, pristine.replace(old, next));
        const { code, out } = runTests();
        const failed = redTests(out);
        const status = code !== 0 ? 'RED' : 'GREEN(!)';
        console.log(`${status.padEnd(8)} ${name}`);
        for (const f of failed.slice(0, 8)) console.log(`           ${f}`);
        if (code !== 0 && failed.length === 0) {
          console.log('           (non-zero exit with no test name captured — suspect a timeout)');
        }
        writeFileSync(STORE, restoreTarget);
        if (!faultFired && process.env.PANE_MUTATION_FAULT === 'write-back') {
          // Debug-only: impersonate an external writer that lands right after the
          // harness writes the file back, so the guard below is exercised by a
          // real external write instead of only by reasoning that one would break it.
          faultFired = true;
          writeFileSync(
            STORE,
            `${restoreTarget.toString('utf8')}// PANE_MUTATION_FAULT=write-back\n`,
          );
        }
        if (!readFileSync(STORE).equals(restoreTarget)) {
          // The write-back did not land (or something else touched the file right
          // after it did). A restore that silently failed must never be reported as
          // a caught regression, so this cell is VOID and the run exits non-zero.
          writeFileSync(STORE, restoreTarget);
          const recovered = readFileSync(STORE).equals(restoreTarget);
          console.log(
            `VOID      ${name} — the file was not what this run wrote back (re-written: ${recovered});` +
              ` the ${status} above cannot be read.`,
          );
          fail(EXIT.VOID, `write-back after "${name}" did not land`);
          summary.push([name, 'VOID']);
          continue;
        }
        summary.push([name, status]);
      }

      const voids = summary.filter(([, s]) => s === 'VOID');
      const holes = summary.filter(([, s]) => s !== 'RED' && s !== 'VOID');
      const caught = summary.length - holes.length - voids.length;
      console.log('\n===== SUMMARY =====');
      for (const [name, status] of summary) console.log(`  ${status.padEnd(8)} ${name}`);
      console.log(`\n${caught}/${summary.length} mutations caught`);
      if (voids.length) {
        console.log(
          `${voids.length} VOID — write-back verification failed, those results cannot be read.`,
        );
      }
      if (holes.length) {
        console.log('UNCOVERED (a defense hole — the suite cannot see this regression):');
        for (const [name] of holes) console.log(`  - ${name}`);
        fail(EXIT.UNCOVERED, `${holes.length} mutation(s) uncovered`);
      } else if (!voids.length) {
        console.log('0 uncovered — every focus-touching action is pinned.');
      }
    }
  }
} finally {
  writeFileSync(STORE, restoreTarget);
  const now = readFileSync(STORE);
  const wroteBack = now.equals(restoreTarget);
  const atHead = now.equals(head);
  console.log('\n===== RESTORE CHECK (anchored to git, not to a disk re-read) =====');
  console.log(`  on disk == the bytes this run wrote back     : ${wroteBack}`);
  console.log(`  on disk == git HEAD (${STORE_REL}) : ${atHead}`);
  if (!wroteBack) {
    console.log(`  the file is NOT what this run wrote — its byte backup was kept: ${backup}`);
  } else if (existsSync(backup)) {
    unlinkSync(backup);
  }
  if (!atHead) {
    console.log(
      `  INTERFERENCE: ${STORE_REL} differs from HEAD` +
        `${driftedBeforeRun ? ' — it was already drifted before the run; this run changed nothing' : ''}.`,
    );
  }
  if (!wroteBack) fail(EXIT.WRITE_BACK, `${STORE_REL} is not the content this run wrote back`);
  process.exitCode = exitReasons.length ? Math.max(...exitReasons) : EXIT.CLEAN;
}
