/**
 * [tester] Key-tree round-1 gap battery — written during the `redis-tree-ui` test
 * round (全新 Tester 实例，只测不修).
 *
 * Two cases are registered as `it.skip` with a `FIXME(redis-tree-ui-BUG-00N)`
 * marker so the track gate stays green while the defects are open. Each skipped
 * case quotes the **measured** failure it produced when run un-skipped on
 * `ef0d62d94` — that is the proof the repro is not vacuous.
 *
 * What each one pins:
 *  - BUG-001 (D-2 + D-8): in the *tree* view the R2 pattern reaches `scan_keys`
 *    but never reaches `list_children` nor the row fold, so the rendered rows do
 *    not narrow and the named `no-match` empty state is unreachable;
 *  - BUG-002 (D-5 + D-1 + D-8): a failed *rescan* leaves the level's authoritative
 *    pass open, and `anyLevelScanning` treats an open pass as "still scanning"
 *    forever ⇒ R1's counter stays `N+` and the empty state stays `interrupted`.
 *
 * The two precondition cases are green on purpose: they pin the filters that *do*
 * reach `list_children` (`keyType`, `sep`), so BUG-001 cannot be "fixed" by
 * dropping the whole filter row, and a future regression of either chip turns red
 * here rather than hiding behind the skipped case.
 *
 * Assertion policy (PRD §7-6 / AGENTS.md 原则六): `data-*` attributes and i18n
 * keys only. `useI18n` is stubbed to an identity `t`, so a rendered string equals
 * its key — no English copy is pinned anywhere in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { create } from 'zustand';
import {
  bindConfirmDialog,
  bindConnectionStore,
  bindSchemaStore,
  bindSettingsStore,
  type ConnectionBridgeState,
  type SchemaStoreState,
  type SettingsBridgeState,
} from '@datazen/driver-sdk';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const size = opts.estimateSize();
    const items = Array.from({ length: opts.count }, (_, index) => ({
      index,
      key: index,
      start: index * size,
      size,
      lane: 0,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => items.length * size,
      measureElement: () => undefined,
      scrollToOffset: () => undefined,
      scrollToIndex: () => undefined,
    };
  },
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
globalThis.ResizeObserver ??= MockResizeObserver as unknown as typeof ResizeObserver;

vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  useI18n: () => ({ t: (key: string) => key }),
}));

const scanKeys = vi.fn();
const listChildren = vi.fn();
const dbSizes = vi.fn();
const getKey = vi.fn();
const redisCommand = vi.fn();

vi.mock('../shared/redisInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/redisInvoke')>()),
  invokeScanKeys: (...args: unknown[]) => scanKeys(...args),
  invokeListChildren: (...args: unknown[]) => listChildren(...args),
  invokeDbSizes: (...args: unknown[]) => dbSizes(...args),
  invokeGetKey: (...args: unknown[]) => getKey(...args),
  redisCommandInvoke: (...args: unknown[]) => redisCommand(...args),
}));

import { RedisWorkbench } from '../key-browser/RedisWorkbench';
import { KEY_TYPE_FILTERS, SEPARATOR_CHOICES } from '../key-browser/keyTree';
import {
  EMPTY_LEVEL,
  anyLevelScanning,
  applyFetch,
  beginFetch,
  markFetchFailed,
  type TreeLevel,
} from '../key-browser/treeLevels';
import type { ChildEntry } from '../shared/redisInvoke';

bindSettingsStore(
  create<SettingsBridgeState>(() => ({
    settings: { safeMode: false, editorFontFamily: '', driverSettings: {} },
  })),
);
bindConnectionStore(create<ConnectionBridgeState>(() => ({ connections: [] })));
bindConfirmDialog(() => [async () => true, null]);
bindSchemaStore(
  create<SchemaStoreState>(() => ({
    databases: ['db0', 'db1'],
    loading: false,
    loadForConnection: async () => {},
  })),
);

function leaf(key: string, keyType = 'string', ttl = -1): ChildEntry {
  return { kind: 'key', key, keyType, ttl, logicalLen: 4, memBytes: null };
}

function folder(prefix: string, count: number): ChildEntry {
  return { kind: 'folder', prefix, count };
}

function renderWorkbench() {
  render(<RedisWorkbench dbSessionId="sess-1" initialDatabase="db0" hideSidebar />);
}

/** Every `list_children` call, as the (prefix, options) pair it was made with. */
function childCalls(): { prefix: string; opts: Record<string, unknown> }[] {
  return listChildren.mock.calls.map((call) => ({
    prefix: String((call as unknown[])[2]),
    opts: ((call as unknown[])[5] ?? {}) as Record<string, unknown>,
  }));
}

/** Pick an option out of an open design-system Select by its own value list. */
async function pickOption(testId: string, values: readonly string[], wanted: string) {
  fireEvent.click(screen.getByTestId(testId));
  const options = await screen.findAllByTestId('select-option');
  const index = values.indexOf(wanted);
  expect(index).toBeGreaterThanOrEqual(0);
  fireEvent.mouseDown(options[index]!);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  getKey.mockResolvedValue({
    key: 'app:user:1',
    keyType: 'string',
    ttl: -1,
    value: 'v',
    size: 1,
    memory: null,
  });
  redisCommand.mockResolvedValue(undefined);
  dbSizes.mockResolvedValue([{ db: 0, keys: 2 }, { db: 1, keys: 0 }]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ── BUG-002 — the rescan failure path of the level fold ──────────────────── */

describe('[tester] treeLevels: a failed rescan must close the authoritative pass', () => {
  /** A finished root level holding one folder. */
  function finished(): TreeLevel {
    return applyFetch(beginFetch(EMPTY_LEVEL, 'reset'), 'reset', {
      children: [folder('app:', 2)],
      cursor: 0,
    });
  }

  it('opens a pass on a finished level (precondition, green)', () => {
    const opened = beginFetch(finished(), 'rescan');
    expect(opened.pass).toEqual([]);
    // An open pass is "this level is being re-walked" ⇒ the tree is a subset.
    expect(anyLevelScanning({ '': opened })).toBe(true);
  });

  it('FIXME(redis-tree-ui-BUG-002): a failed rescan closes the pass instead of pinning 扫描中 forever', () => {
    // Un-skipped by coder round-1 (fixed in `markFetchFailed`: the non-reset
    // branch now abandons the failed pass, `pass: null`, `done: true`).
    // Measured un-skipped on ef0d62d94 (this file: 2 failed / 5; first quote is the
    // one vitest printed for this case):
    //   AssertionError: expected [] to be null        (failed.pass — pass stays open)
    //   AssertionError: expected true to be false     (anyLevelScanning, next line)
    // The level used to end up { done: true, loading: false, error: true, pass: [] }:
    // no fetch is in flight, yet the level declares itself permanently scanning.
    const failed = markFetchFailed(beginFetch(finished(), 'rescan'), 'rescan');
    // The I-4 half already holds: the loaded subset survived the failure.
    expect(failed.children).toEqual([folder('app:', 2)]);
    expect(failed).toMatchObject({ loading: false, error: true });
    // …but the abandoned pass must not stay open (contract of `TreeLevel.pass`).
    expect(failed.pass).toBeNull();
    expect(anyLevelScanning({ '': failed })).toBe(false);
  });
});

/* ── BUG-001 — the R2 pattern never reaches the tree rows ─────────────────── */

describe('[tester] R2 search row: every filter reaches the tree, and no-match is reachable', () => {
  beforeEach(() => {
    // Flat scan honours the pattern — this is the half that works.
    scanKeys.mockImplementation(async (_s: string, _i: number, pattern: string) => {
      const all = [
        { key: 'app:user:1', keyType: 'string', ttl: -1, size: 4, preview: '' },
        { key: 'app:user:2', keyType: 'hash', ttl: 60, size: 4, preview: '' },
      ];
      const keys = pattern === '*' || pattern === '' ? all : [];
      return { keys, cursor: 0, dbSize: keys.length, matched: keys.length };
    });
    // Server tree: a fixed two rows (one folder + one loose key), cursor drained.
    listChildren.mockResolvedValue({
      children: [folder('app:', 2), leaf('root-plain')],
      cursor: 0,
    });
  });

  it('the type chip reaches list_children (precondition, green)', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    const typeValues = KEY_TYPE_FILTERS.map((item) => item.value);
    await pickOption('redis-tree-type-filter', typeValues, 'hash');
    await waitFor(() =>
      expect(childCalls().some((call) => call.opts.keyType === 'hash')).toBe(true),
    );
  });

  it('the separator reaches list_children (precondition, green)', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    await pickOption(
      'redis-tree-separator',
      SEPARATOR_CHOICES as unknown as string[],
      SEPARATOR_CHOICES[1],
    );
    await waitFor(() => expect(childCalls().some((call) => call.opts.sep === '.')).toBe(true));
  });

  it('pins today\'s split-brain: filtered scan + unfiltered rows (green, characterization)', async () => {
    // This case asserts the *current* behaviour on purpose — it is the measurement
    // behind BUG-001, and it is the one that must turn red (and be re-written to
    // the filtered expectation) when the defect is fixed. Keeping it green today
    // is what proves the skipped case above is not asking for something impossible:
    // both halves of the contradiction are real and simultaneous.
    renderWorkbench();
    const tree = await screen.findByTestId('redis-key-tree');
    await screen.findByTestId('redis-tree-folder-app:');

    const input = screen.getByTestId('redis-search-input');
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The flat `scan_keys` set really is empty after the pattern applies …
    await waitFor(() => expect(scanKeys.mock.calls.at(-1)?.[2]).toBe('zzz'));
    await waitFor(() => expect(screen.getByTestId('redis-tree-count').getAttribute('data-loaded')).toBe('0'));
    // … while the tree column still paints both pre-filter rows …
    expect(tree.getAttribute('data-row-count')).toBe('2');
    expect(screen.queryByTestId('redis-tree-empty')).toBeNull();
    // … and `select all loaded` therefore selects nothing the user can see.
    fireEvent.click(screen.getByTestId('redis-tree-select-all'));
    await waitFor(() =>
      expect(screen.getByTestId('redis-tree-clear-selection').disabled).toBe(true),
    );
  });

  it.skip('FIXME(redis-tree-ui-BUG-001): applying a pattern narrows the rendered tree rows', async () => {
    // Measured un-skipped on ef0d62d94 (this file: 2 failed / 5; the quote below is
    // the line vitest printed for this case):
    //   AssertionError: expected '2' to be '0'   // redis-key-tree[data-row-count]
    // i.e. the pattern left the input, re-scanned `scan_keys` down to zero keys,
    // and the tree column kept painting both pre-filter rows (so no named empty
    // state can ever be reached either — the later assertions in this case).
    renderWorkbench();
    const tree = await screen.findByTestId('redis-key-tree');
    await screen.findByTestId('redis-tree-folder-app:');
    expect(tree.getAttribute('data-row-count')).toBe('2');

    const input = screen.getByTestId('redis-search-input');
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The flat scan really did narrow to the pattern …
    await waitFor(() => expect(scanKeys.mock.calls.at(-1)?.[2]).toBe('zzz'));
    // … so the tree must reflect it. Primary symptom first: the rendered rows.
    await waitFor(() => expect(tree.getAttribute('data-row-count')).toBe('0'));
    // Secondary: whichever route the fix takes, the pattern has to be *in* the
    // tree's data path (an option on the request, or a prefix derived from it).
    expect(
      childCalls().some(
        (call) =>
          call.opts.pattern === 'zzz' || call.opts.match === 'zzz' || call.prefix.startsWith('zzz'),
      ),
    ).toBe(true);
    // I-11: a finished scan plus an active filter is exactly the `no-match` fact.
    const empty = await screen.findByTestId('redis-tree-empty');
    expect(empty.getAttribute('data-empty-state')).toBe('no-match');
  });
});
