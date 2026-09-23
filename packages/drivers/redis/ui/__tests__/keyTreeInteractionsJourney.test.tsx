/**
 * 键树 track interaction journeys (PRD §3.2 R3 + 行规格/sticky, §4 I-4/I-8/I-9/I-11;
 * task book D-3..D-8).
 *
 * Same assertion policy as `keyTreeJourney.test.tsx`: `useI18n` is stubbed with
 * an identity `t` so a rendered string equals its i18n key — **no test reads
 * copy**; locators are `data-testid`, state comes from `data-*` attributes or
 * from the recorded command calls. The virtualizer is stubbed to yield every
 * row (jsdom measures a zero-size scroll element).
 *
 * The journeys are step-by-step on purpose (AGENTS.md 连续旅程测试): every
 * transition — including the intermediate ones (rows still on screen while a
 * refresh is in flight, a failed key still checked after the post-write
 * refresh, an open cursor masking a filter) — is asserted, not just the final
 * legal state.
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
import { TREE_PREFS_STORAGE_KEY } from '../key-browser/treePreferences';

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

function leaf(key: string, keyType = 'string', ttl = -1) {
  return { kind: 'key', key, keyType, ttl, logicalLen: 4, memBytes: null };
}

function folder(prefix: string, count: number) {
  return { kind: 'folder', prefix, count };
}

function renderWorkbench() {
  render(<RedisWorkbench dbSessionId="sess-1" initialDatabase="db0" hideSidebar />);
}

/** Root-level `list_children` calls so a rescan/re-expand can be counted. */
function rootCalls(): number {
  return listChildren.mock.calls.filter((call) => String((call as unknown[])[2]) === '').length;
}

/** `list_children` calls for the `app:` subtree (re-expand must not add one). */
function childCalls(): number {
  return listChildren.mock.calls.filter((call) => String((call as unknown[])[2]) === 'app:').length;
}

/** Last `invokeScanKeys` call, as the pattern/cursor tuple it was made with. */
function lastScan(): { pattern: string; cursor: number; opts: Record<string, unknown> } {
  const call = scanKeys.mock.calls.at(-1) as unknown[];
  return {
    pattern: String(call[2]),
    cursor: Number(call[3]),
    opts: (call[5] ?? {}) as Record<string, unknown>,
  };
}

function emptyState(): string | null {
  return screen.queryByTestId('redis-tree-empty')?.getAttribute('data-empty-state') ?? null;
}

/** The page `data-empty-state` must show right now. */
async function expectEmptyState(state: string): Promise<void> {
  await waitFor(() => expect(emptyState()).toBe(state));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Default flat scan: both keys on one finished page (cursor drained ⇒ the
  // counter is exact and `scanning` never masks an empty state by accident).
  scanKeys.mockImplementation(async () => ({
    keys: [
      { key: 'app:user:1', keyType: 'string', ttl: -1, size: 4, preview: '' },
      { key: 'app:user:2', keyType: 'hash', ttl: 60, size: 4, preview: '' },
    ],
    cursor: 0,
    dbSize: 2,
    matched: 2,
  }));
  // Server-driven tree: root folds `app:`; the subtree holds both keys.
  listChildren.mockImplementation(async (...args: unknown[]) => {
    const prefix = String(args[2]);
    if (prefix === 'app:') return { children: [leaf('app:user:1'), leaf('app:user:2')], cursor: 0 };
    return { children: [folder('app:', 2), leaf('root-plain')], cursor: 0 };
  });
  dbSizes.mockResolvedValue([{ db: 0, keys: 2 }, { db: 1, keys: 0 }]);
  getKey.mockResolvedValue({
    key: 'app:user:1',
    keyType: 'string',
    ttl: -1,
    value: 'v',
    size: 1,
    memory: null,
  });
  // Batch driver command: one of the two requested keys is rejected by ACL.
  redisCommand.mockImplementation(async (_driver: string, command: string) => {
    if (command === 'batch_set_ttl') {
      return {
        updated: 1,
        errors: [{ key: 'app:user:1', error: 'NOPERM this user has no permissions to run this command' }],
      };
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('R3 grouping row journey (D-3)', () => {
  it('re-folds the tree on the chosen separator and persists it per connection', async () => {
    listChildren.mockImplementation(async (...args: unknown[]) => {
      const opts = (args[5] ?? {}) as { sep?: string };
      if (opts.sep === '.') return { children: [folder('app.', 1)], cursor: 0 };
      return { children: [folder('app:', 2), leaf('root-plain')], cursor: 0 };
    });
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    const tree = screen.getByTestId('redis-key-tree');
    expect(tree.getAttribute('data-separator')).toBe(':');
    expect(screen.getByTestId('redis-tree-group-row').getAttribute('data-separator')).toBe(':');

    // Enter: open the separator select and pick `.` (design-system Select
    // commits on mousedown — the journey walks the real pointer order).
    fireEvent.click(screen.getByTestId('redis-tree-separator'));
    const options = await screen.findAllByTestId('select-option');
    fireEvent.mouseDown(options[SEPARATOR_CHOICES.findIndex((sep) => sep === '.')]);

    // The new option reaches `list_children` …
    await waitFor(() => {
      const reFold = listChildren.mock.calls
        .map((call) => call as unknown[])
        .find((call) => call[2] === '' && ((call[5] ?? {}) as { sep?: string }).sep === '.');
      expect(reFold).toBeTruthy();
    });
    // … the old fold is replaced, not appended to: `app.` exists, `app:` is gone.
    await screen.findByTestId('redis-tree-folder-app.');
    expect(screen.queryByTestId('redis-tree-folder-app:')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('redis-key-tree').getAttribute('data-separator')).toBe('.'));
    expect(screen.getByTestId('redis-tree-group-row').getAttribute('data-separator')).toBe('.');

    // Exit/durability: the preference lands in this connection's bucket only.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(TREE_PREFS_STORAGE_KEY) ?? '{}') as Record<
        string,
        unknown
      >;
      expect(stored['sess-1']).toEqual({ view: 'tree', sep: '.' });
    });
  });

  it('switches between the folded tree and the flat list without losing keys', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');

    fireEvent.click(screen.getByTestId('redis-tree-view-list'));
    await waitFor(() =>
      expect(screen.getByTestId('redis-tree-group-row').getAttribute('data-view')).toBe('list'),
    );
    // Flat mode lists the loaded keys themselves — no fold, no folder rows.
    expect(await screen.findByTestId('redis-key-row-app:user:1')).toBeTruthy();
    expect(screen.queryByTestId('redis-tree-folder-app:')).toBeNull();
    expect(screen.getByTestId('redis-key-tree').getAttribute('data-row-count')).toBe('2');

    fireEvent.click(screen.getByTestId('redis-tree-view-tree'));
    await waitFor(() =>
      expect(screen.getByTestId('redis-tree-group-row').getAttribute('data-view')).toBe('tree'),
    );
    expect(await screen.findByTestId('redis-tree-folder-app:')).toBeTruthy();
    expect(screen.queryByTestId('redis-key-row-app:user:1')).toBeNull();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(TREE_PREFS_STORAGE_KEY) ?? '{}') as Record<
        string,
        { view?: string }
      >;
      expect(stored['sess-1']?.view).toBe('tree');
    });
  });
});

describe('row spec + sticky group headers (D-4)', () => {
  it('indents 4+depth×10 and pins the ancestor chain while scrolling', async () => {
    renderWorkbench();
    fireEvent.click(await screen.findByTestId('redis-tree-folder-app:'));
    await screen.findByTestId('redis-key-row-app:user:1');

    // Row spec published as data, not geometry: depth 0 ⇒ 4px, depth 1 ⇒ 14px.
    const folderRow = screen.getByTestId('redis-tree-folder-app:');
    expect(folderRow.getAttribute('data-depth')).toBe('0');
    expect(folderRow.getAttribute('data-indent')).toBe('4');
    const child = screen.getByTestId('redis-key-row-app:user:1');
    expect(child.getAttribute('data-depth')).toBe('1');
    expect(child.getAttribute('data-indent')).toBe('14');

    // At the top nothing is pinned: the folder is still painted in flow.
    const tree = screen.getByTestId('redis-key-tree');
    expect(tree.getAttribute('data-sticky-depth')).toBe('0');
    expect(screen.queryByTestId('redis-tree-sticky-headers')).toBeNull();

    // One row down the folder is a strict ancestor of the top row ⇒ pinned.
    Object.defineProperty(tree, 'scrollTop', { value: 30, writable: true, configurable: true });
    fireEvent.scroll(tree);
    await waitFor(() => expect(tree.getAttribute('data-sticky-depth')).toBe('1'));
    expect(screen.getByTestId('redis-tree-sticky-headers')).toBeTruthy();
    const pinned = screen.getByTestId('redis-tree-sticky-folder-app:');
    expect(pinned.getAttribute('data-sticky-order')).toBe('0');
    expect(pinned.getAttribute('data-sticky-depth')).toBe('0');

    // Exit transition: back to the top, the pin is released.
    Object.defineProperty(tree, 'scrollTop', { value: 0, writable: true, configurable: true });
    fireEvent.scroll(tree);
    await waitFor(() => expect(tree.getAttribute('data-sticky-depth')).toBe('0'));
    expect(screen.queryByTestId('redis-tree-sticky-headers')).toBeNull();
  });

  it('cascades a folder check over the whole loaded key set, both ways', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-check-app:');
    expect(screen.getByTestId('redis-tree-batch-delete').disabled).toBe(true);
    expect(screen.getByTestId('redis-tree-clear-selection').disabled).toBe(true);

    // Enter: check the (collapsed) folder — cascade reads the full loaded set.
    fireEvent.click(screen.getByTestId('redis-tree-folder-check-app:'));
    await waitFor(() =>
      expect(screen.getByTestId('redis-tree-batch-delete-count').getAttribute('data-count')).toBe(
        '2',
      ),
    );
    expect(screen.getByTestId('redis-tree-clear-selection').disabled).toBe(false);

    // Opening the subtree shows both leaf checks following the cascade.
    fireEvent.click(screen.getByTestId('redis-tree-folder-app:'));
    await screen.findByTestId('redis-key-row-app:user:1');
    expect(screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked')).toBe(
      'true',
    );
    expect(screen.getByTestId('redis-tree-key-check-app:user:2').getAttribute('data-checked')).toBe(
      'true',
    );

    // Exit: unchecking the folder releases exactly its subtree.
    fireEvent.click(screen.getByTestId('redis-tree-folder-check-app:'));
    await waitFor(() => expect(screen.getByTestId('redis-tree-batch-delete').disabled).toBe(true));
    expect(screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked')).toBe(
      'false',
    );
    expect(screen.getByTestId('redis-tree-key-check-app:user:2').getAttribute('data-checked')).toBe(
      'false',
    );
  });
});

describe('level-preserving refresh journey (I-4 / D-5)', () => {
  it('keeps the rows on screen while the refresh is in flight, then lands the new count', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    expect(screen.getByTestId('redis-tree-folder-count-app:').getAttribute('data-count')).toBe('2');

    // Hold the next root fetch hostage so the intermediate state is observable.
    let release: (value: { children: unknown[]; cursor: number }) => void = () => {};
    listChildren.mockImplementationOnce(
      () =>
        new Promise<{ children: unknown[]; cursor: number }>((resolve) => {
          release = resolve;
        }),
    );

    const rootsBefore = rootCalls();
    fireEvent.click(screen.getByTestId('redis-tree-refresh'));
    await waitFor(() => expect(rootCalls()).toBe(rootsBefore + 1));

    // Intermediate state of a rescan: the old level stays visible (no blank
    // flash, no forced collapse) while the replacement fetch is pending.
    expect(screen.getByTestId('redis-tree-folder-app:')).toBeTruthy();
    expect(screen.getByTestId('redis-tree-folder-count-app:').getAttribute('data-count')).toBe('2');

    release({ children: [folder('app:', 5)], cursor: 0 });
    await waitFor(() =>
      expect(screen.getByTestId('redis-tree-folder-count-app:').getAttribute('data-count')).toBe(
        '5',
      ),
    );

    // The rescan asked a finished level from cursor 0 with the same separator.
    const rescan = listChildren.mock.calls.at(-1) as unknown[];
    expect(rescan[2]).toBe('');
    expect(rescan[3]).toBe(0);
    expect(((rescan[5] ?? {}) as { sep?: string }).sep).toBe(':');
  });

  it('folds an expanded folder and re-expands it from the retained level (no refetch)', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    fireEvent.click(screen.getByTestId('redis-tree-folder-app:'));
    await screen.findByTestId('redis-key-row-app:user:1');
    expect(childCalls()).toBe(1);

    // Collapse keeps the level …
    fireEvent.click(screen.getByTestId('redis-tree-folder-app:'));
    await waitFor(() =>
      expect(screen.getByTestId('redis-tree-folder-app:').getAttribute('data-expanded')).toBe(
        'false',
      ),
    );
    expect(screen.queryByTestId('redis-key-row-app:user:1')).toBeNull();

    // … so re-expanding renders from memory instead of hitting the server.
    fireEvent.click(screen.getByTestId('redis-tree-folder-app:'));
    expect(await screen.findByTestId('redis-key-row-app:user:1')).toBeTruthy();
    expect(childCalls()).toBe(1);
  });
});

describe('keyboard navigation journey (I-9 / D-7)', () => {
  it('walks expand/step/fold/activate and the chords as one state machine', async () => {
    renderWorkbench();
    const tree = await screen.findByTestId('redis-key-tree');
    await screen.findByTestId('redis-tree-folder-app:');
    expect(tree.getAttribute('data-active-index')).toBe('-1');

    // ↓ enters the list on the first row.
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(tree.getAttribute('data-active-index')).toBe('0');
    expect(screen.getByTestId('redis-tree-folder-app:').getAttribute('data-active')).toBe('true');
    // ↓ reaches the sibling key row, ↑ clamps back.
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(tree.getAttribute('data-active-index')).toBe('1');
    expect(screen.getByTestId('redis-key-row-root-plain').getAttribute('data-active')).toBe('true');
    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    expect(tree.getAttribute('data-active-index')).toBe('0');

    // → on a collapsed folder expands it (one fetch for the subtree) …
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(screen.getByTestId('redis-tree-folder-app:').getAttribute('data-expanded')).toBe('true');
    await screen.findByTestId('redis-key-row-app:user:1');
    expect(childCalls()).toBe(1);
    // … a second → steps into the first child …
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(tree.getAttribute('data-active-index')).toBe('1');
    expect(screen.getByTestId('redis-key-row-app:user:1').getAttribute('data-active')).toBe('true');
    // … ← returns to the parent folder …
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(tree.getAttribute('data-active-index')).toBe('0');
    // … the next ← folds it (exit of expand).
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(screen.getByTestId('redis-tree-folder-app:').getAttribute('data-expanded')).toBe('false');
    expect(screen.queryByTestId('redis-key-row-app:user:1')).toBeNull();

    // → re-expands WITHOUT refetching: the level was retained (I-4).
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(await screen.findByTestId('redis-key-row-app:user:1')).toBeTruthy();
    expect(childCalls()).toBe(1);

    // Enter activates the key row → its detail loads and mounts as selected.
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(tree.getAttribute('data-active-index')).toBe('1');
    fireEvent.keyDown(tree, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('redis-key-row-app:user:1').getAttribute('data-selected')).toBe(
        'true',
      ),
    );
    expect(
      getKey.mock.calls.some((call) => String((call as unknown[])[2]) === 'app:user:1'),
    ).toBe(true);

    // ⌘A selects everything loaded; the clear action becomes available.
    fireEvent.keyDown(tree, { key: 'a', metaKey: true });
    await waitFor(() =>
      expect(
        screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked'),
      ).toBe('true'),
    );
    expect(screen.getByTestId('redis-tree-key-check-app:user:2').getAttribute('data-checked')).toBe(
      'true',
    );
    expect(screen.getByTestId('redis-tree-clear-selection').disabled).toBe(false);
    expect(
      (screen.getByTestId('redis-tree-folder-check-app:') as HTMLInputElement).checked,
    ).toBe(true);

    // Esc is the exit transition: checks cleared, active row left behind.
    fireEvent.keyDown(tree, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked'),
      ).toBe('false'),
    );
    expect(tree.getAttribute('data-active-index')).toBe('-1');
    expect(screen.getByTestId('redis-tree-clear-selection').disabled).toBe(true);

    // ⌘R refreshes both feeds: the flat scan and the tree root rescan.
    const rootsBefore = rootCalls();
    const scansBefore = scanKeys.mock.calls.length;
    fireEvent.keyDown(tree, { key: 'r', metaKey: true });
    await waitFor(() => expect(rootCalls()).toBe(rootsBefore + 1));
    expect(scanKeys.mock.calls.length).toBe(scansBefore + 1);
  });
});

describe('batch selection journey (I-8 / D-6)', () => {
  it('keeps the failed key checked after a partial batch TTL and groups its reason', async () => {
    // Flat rows so both selected keys have a visible checkbox.
    listChildren.mockResolvedValue({
      children: [leaf('app:user:1'), leaf('app:user:2')],
      cursor: 0,
    });
    renderWorkbench();
    await screen.findByTestId('redis-tree-count');

    // Enter: select both loaded keys.
    fireEvent.click(screen.getByTestId('redis-tree-select-all'));
    await waitFor(() =>
      expect(screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked')).toBe(
        'true',
      ),
    );
    expect(screen.getByTestId('redis-tree-key-check-app:user:2').getAttribute('data-checked')).toBe(
      'true',
    );

    // Open the batch-TTL dialog and type a TTL.
    fireEvent.click(screen.getByTestId('redis-tree-batch-ttl'));
    const input = await screen.findByTestId('redis-batch-ttl-input');
    fireEvent.change(input, { target: { value: '60' } });
    const rootsBefore = rootCalls();
    fireEvent.click(screen.getByTestId('redis-batch-ttl-confirm'));
    await waitFor(() =>
      expect(
        redisCommand.mock.calls.some(
          (call) => String((call as unknown[])[1]) === 'batch_set_ttl',
        ),
      ).toBe(true),
    );

    // The structured summary: 1 updated, 1 failed, action = ttl.
    const banner = await screen.findByTestId('redis-batch-summary');
    expect(banner.getAttribute('data-kind')).toBe('batch');
    expect(banner.getAttribute('data-action')).toBe('ttl');
    expect(banner.getAttribute('data-ok')).toBe('1');
    expect(banner.getAttribute('data-failed')).toBe('1');
    expect(screen.queryByTestId('redis-batch-ttl-confirm')).toBeNull();

    // The post-write refresh ran (both feeds) and must NOT eat the failed key.
    await waitFor(() => expect(rootCalls()).toBeGreaterThan(rootsBefore));
    await waitFor(() =>
      expect(
        screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked'),
      ).toBe('true'),
    );
    expect(screen.getByTestId('redis-tree-key-check-app:user:2').getAttribute('data-checked')).toBe(
      'false',
    );

    // Expand the banner: failures grouped by stable code, never by copy.
    fireEvent.click(screen.getByTestId('redis-batch-summary-toggle'));
    const failures = await screen.findByTestId('redis-batch-summary-failures');
    expect(failures.getAttribute('data-group-count')).toBe('1');
    const group = screen.getByTestId('redis-batch-failure-group-noAcl');
    expect(group.getAttribute('data-failure-code')).toBe('noAcl');
    expect(group.getAttribute('data-count')).toBe('1');
    expect(group.getAttribute('data-reason-key')).toBe('redis.tree.error.noAcl');

    // Dismiss is the exit transition of the banner.
    fireEvent.click(screen.getByTestId('redis-batch-summary-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('redis-batch-summary')).toBeNull());
    // …and the failed key is still checked afterwards.
    expect(screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked')).toBe(
      'true',
    );
  });

  it('keeps the whole selection when the batch invoke itself throws', async () => {
    listChildren.mockResolvedValue({
      children: [leaf('app:user:1'), leaf('app:user:2')],
      cursor: 0,
    });
    redisCommand.mockImplementation(async (_driver: string, command: string) => {
      if (command === 'batch_set_ttl') throw new Error('connection reset by peer');
      return undefined;
    });
    renderWorkbench();
    await screen.findByTestId('redis-tree-count');

    fireEvent.click(screen.getByTestId('redis-tree-select-all'));
    await waitFor(() =>
      expect(
        screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked'),
      ).toBe('true'),
    );
    fireEvent.click(screen.getByTestId('redis-tree-batch-ttl'));
    const input = await screen.findByTestId('redis-batch-ttl-input');
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('redis-batch-ttl-confirm'));

    // No per-key verdict exists ⇒ every requested key failed (safe side of I-8),
    // and the dialog stays open with its error slot — the raw message is shown,
    // not parsed.
    const banner = await screen.findByTestId('redis-batch-summary');
    expect(banner.getAttribute('data-ok')).toBe('0');
    expect(banner.getAttribute('data-failed')).toBe('2');
    expect(await screen.findByTestId('redis-batch-error')).toBeTruthy();
    expect(screen.getByTestId('redis-batch-ttl-confirm')).toBeTruthy();
    expect(screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked')).toBe(
      'true',
    );
    expect(screen.getByTestId('redis-tree-key-check-app:user:2').getAttribute('data-checked')).toBe(
      'true',
    );

    // Cancel closes the dialog but must not release the kept selection.
    fireEvent.click(screen.getByTestId('redis-batch-ttl-cancel'));
    await waitFor(() => expect(screen.queryByTestId('redis-batch-ttl-confirm')).toBeNull());
    expect(screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked')).toBe(
      'true',
    );
    expect(screen.getByTestId('redis-tree-key-check-app:user:2').getAttribute('data-checked')).toBe(
      'true',
    );
  });
});

describe('named empty states journey (I-11 / D-8)', () => {
  it('walks none → no-match → none as the pattern and type filter cross states', async () => {
    listChildren.mockResolvedValue({ children: [], cursor: 0 });
    scanKeys.mockImplementation(async () => ({
      keys: [],
      cursor: 0,
      dbSize: 0,
      matched: 0,
    }));
    renderWorkbench();
    await expectEmptyState('none');

    // Typing narrows the fact: the filter, not the server, is to blame.
    const input = await screen.findByTestId('redis-search-input');
    fireEvent.change(input, { target: { value: 'zzz' } });
    await expectEmptyState('no-match');

    // Enter applies: the scan really ran with the typed pattern …
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(lastScan().pattern).toBe('zzz'));
    await expectEmptyState('no-match');

    // … and Esc (the row's exit) drops the filter back to the whole keyspace.
    fireEvent.keyDown(input, { key: 'Escape' });
    await expectEmptyState('none');

    // The type chip is a filter too — picking one narrows the fact again.
    fireEvent.click(screen.getByTestId('redis-tree-type-filter'));
    const options = await screen.findAllByTestId('select-option');
    fireEvent.mouseDown(options[KEY_TYPE_FILTERS.findIndex((item) => item.value === 'hash')]);
    await waitFor(() => expect(lastScan().opts.keyType).toBe('hash'));
    await expectEmptyState('no-match');
  });

  it('names an open cursor as interrupted and returns to none once drained', async () => {
    listChildren.mockResolvedValue({ children: [], cursor: 0 });
    scanKeys.mockImplementation(async (...args: unknown[]) => {
      const cursor = Number(args[3]);
      return { keys: [], cursor: cursor === 0 ? 7 : 0, dbSize: 0, matched: 0 };
    });
    renderWorkbench();
    // Rows are empty but the cursor never returned 0 ⇒ "absence proves nothing".
    await expectEmptyState('interrupted');

    // Paging the open cursor to its end is the exit: back to `none`.
    fireEvent.click(screen.getByTestId('redis-tree-load-more'));
    await waitFor(() => expect(lastScan().cursor).toBe(7));
    await expectEmptyState('none');
  });

  it('names a rejected root as no-permission, outranking an open cursor', async () => {
    // The flat scan stays open (cursor 7) — the precedence contract: a failed
    // root outranks everything, including the `interrupted` it would otherwise
    // resolve to.
    listChildren.mockRejectedValue(new Error('NOPERM this user has no permissions'));
    scanKeys.mockImplementation(async () => ({
      keys: [],
      cursor: 7,
      dbSize: 0,
      matched: 0,
    }));
    renderWorkbench();
    await expectEmptyState('no-permission');
  });
});

describe('row delete journeys (I-6 write gate, D-0 extraction)', () => {
  it('deletes a single key: confirm → gate → write → text summary → refresh', async () => {
    listChildren.mockResolvedValue({
      children: [leaf('app:user:1'), leaf('app:user:2')],
      cursor: 0,
    });
    // The single-key invoke answers the raw count (see `invokeDeleteKeys`).
    redisCommand.mockImplementation(async (_driver: string, command: string) => {
      if (command === 'delete_keys') return 1;
      return undefined;
    });
    renderWorkbench();
    await screen.findByTestId('redis-tree-key-delete-app:user:1');

    const rootsBefore = rootCalls();
    fireEvent.click(screen.getByTestId('redis-tree-key-delete-app:user:1'));

    // Confirm auto-approves in this harness and safe mode is off, so the write
    // goes out and the banner reports the row action as a plain text summary.
    const banner = await screen.findByTestId('redis-batch-summary');
    expect(banner.getAttribute('data-kind')).toBe('text');
    expect(
      redisCommand.mock.calls.some((call) => String((call as unknown[])[1]) === 'delete_keys'),
    ).toBe(true);
    // Refresh-after-success re-roots the tree (the gone row drops out).
    await waitFor(() => expect(rootCalls()).toBeGreaterThan(rootsBefore));

    // Exit transition of the banner.
    fireEvent.click(screen.getByTestId('redis-batch-summary-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('redis-batch-summary')).toBeNull());
  });

  it('deletes a whole folder subtree through the pattern invoke', async () => {
    redisCommand.mockImplementation(async (_driver: string, command: string) => {
      if (command === 'batch_delete_pattern') return { deleted: 2, errors: [] };
      return undefined;
    });
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-delete-app:');

    const rootsBefore = rootCalls();
    // The folder delete button stops propagation: only the subtree delete runs.
    fireEvent.click(screen.getByTestId('redis-tree-folder-delete-app:'));

    const banner = await screen.findByTestId('redis-batch-summary');
    expect(banner.getAttribute('data-kind')).toBe('text');
    const call = redisCommand.mock.calls.find(
      (item) => String((item as unknown[])[1]) === 'batch_delete_pattern',
    );
    expect(call).toBeTruthy();
    expect(((call as unknown[])[2] as { pattern: string }).pattern).toBe('app:*');
    await waitFor(() => expect(rootCalls()).toBeGreaterThan(rootsBefore));
    expect(screen.queryByTestId('redis-batch-ttl-confirm')).toBeNull();
  });
});
