/**
 * [redis-tree-ui-BUG-001] Pattern-filter journey (D-2 + D-8, coder round-1).
 *
 * Keystroke-by-keystroke over the *tree* view, because the defect was exactly a
 * missing link in this path: the applied pattern reaches `scan_keys` but not the
 * server-driven rows. Assertions follow the state machine of the filter — enter
 * (type → nothing happens until `Enter`), state (rows narrow, breadcrumb appears,
 * counter + select-all agree with the screen), exit (`Esc`, then a narrower
 * pattern, then the empty-folder case) — and only ever read `data-*` attributes,
 * i18n keys and recorded mock arguments. No English copy, no geometry (AGENTS.md
 * 原则六 / PRD §7-6).
 *
 * The virtualizer is stubbed to hand back every row: jsdom measures a zero-size
 * scroll element and would mount none, which would make "which rows exist"
 * untestable rather than cheap.
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

vi.mock('../shared/redisInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/redisInvoke')>()),
  invokeScanKeys: (...args: unknown[]) => scanKeys(...args),
  invokeListChildren: (...args: unknown[]) => listChildren(...args),
  invokeDbSizes: (...args: unknown[]) => dbSizes(...args),
  invokeGetKey: (...args: unknown[]) => getKey(...args),
}));

import { RedisWorkbench } from '../key-browser/RedisWorkbench';
import { patternToTreePrefix } from '../key-browser/useKeyTree';
import { globToRegExp } from '../key-browser/keyTreeFilter';
import { DEFAULT_SEPARATOR } from '../key-browser/keyTree';
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

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function leaf(key: string, keyType = 'string'): ChildEntry {
  return { kind: 'key', key, keyType, ttl: -1, logicalLen: 4, memBytes: null };
}

function folder(prefix: string, count: number): ChildEntry {
  return { kind: 'folder', prefix, count };
}

function renderWorkbench() {
  render(<RedisWorkbench dbSessionId="sess-1" initialDatabase="db0" hideSidebar />);
}

/** Root-level rows the server hands back: a folder and two loose keys. */
function rootChildren(): ChildEntry[] {
  return [folder('app:', 2), leaf('cache-hit'), leaf('root-plain')];
}

/** Every `list_children` call as the prefix it asked for. */
function childPrefixes(): string[] {
  return listChildren.mock.calls.map((call) => String((call as unknown[])[2]));
}

function tree(): HTMLElement {
  return screen.getByTestId('redis-key-tree');
}

function attr(testId: string, name: string): string | null {
  return screen.getByTestId(testId).getAttribute(name);
}

async function applyPattern(value: string): Promise<void> {
  const input = await screen.findByTestId('redis-search-input');
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  scanKeys.mockImplementation(async (_s: string, _i: number, pattern: string) => {
    const all = [
      { key: 'app:user:1', keyType: 'string', ttl: -1, size: 4, preview: '' },
      { key: 'app:user:2', keyType: 'hash', ttl: 60, size: 4, preview: '' },
      { key: 'root-plain', keyType: 'string', ttl: -1, size: 4, preview: '' },
    ];
    // The flat scan is a real Redis SCAN: it honours the glob it was given. The
    // tree's client-side filter must end up with the same verdict, which is what
    // this fixture lets the assertions compare.
    const re = globToRegExp(pattern);
    const keys = !pattern || pattern === '*' ? all : (re ? all.filter((k) => re.test(k.key)) : []);
    return { keys, cursor: 0, dbSize: 3, matched: keys.length };
  });
  listChildren.mockImplementation(async (_s: string, _i: number, prefix: string) => {
    if (prefix === '') return { children: rootChildren(), cursor: 0 };
    if (prefix === 'app:') {
      return { children: [leaf('app:user:1'), leaf('app:user:2')], cursor: 0 };
    }
    return { children: [], cursor: 0 };
  });
  dbSizes.mockResolvedValue([{ db: 0, keys: 3 }, { db: 1, keys: 0 }]);
  getKey.mockResolvedValue({
    key: 'app:user:1',
    keyType: 'string',
    ttl: -1,
    value: 'v',
    size: 1,
    memory: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ── prefix routing (pure, the server half of the fix) ─────────────────────── */

describe('[redis-tree-ui-BUG-001] patternToTreePrefix routes the literal head', () => {
  const sep = DEFAULT_SEPARATOR;

  it.each([
    // pattern, expected root prefix
    ['', ''],
    ['*', ''],
    ['   ', ''],
    // a leading star means the head is unbounded: no prefix at all
    ['*user*', ''],
    ['*plain', ''],
    // a head that already ends at a separator is kept whole
    ['app:*', 'app:'],
    ['app:user:*', 'app:user:'],
    // a head cut inside a segment falls back to the last separator …
    ['app:us*', 'app:'],
    // … and a head with no separator at all becomes the literal itself
    ['zzz', 'zzz'],
    ['zzz*', 'zzz'],
    // no star ⇒ the whole pattern is the literal head
    ['root-plain', 'root-plain'],
  ] as const)('%s ⇒ prefix %s', (pattern, expected) => {
    expect(patternToTreePrefix(pattern, sep)).toBe(expected);
  });

  it('honours the configured separator, never a hardcoded colon', () => {
    // The cut happens at the *configured* boundary: with `.` the segment is
    // `app`, so that is the prefix the server should fold on — a `:`-based cut
    // here would address a namespace the tree is not grouping by.
    expect(patternToTreePrefix('app.user:*', '.')).toBe('app.');
    expect(patternToTreePrefix('app.user.', '.')).toBe('app.user.');
    expect(patternToTreePrefix('app/user/*', '/')).toBe('app/user/');
    // A pattern whose only separator is someone else's has no boundary here, so
    // the literal head is used rather than silently splitting on `:`.
    expect(patternToTreePrefix('app:user:*', '.')).toBe('app:user:');
  });
});

/* ── the journey ──────────────────────────────────────────────────────────── */

describe('[redis-tree-ui-BUG-001] the applied pattern narrows the tree view', () => {
  it('nothing matched: rows drop to 0 and no-match becomes reachable', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    expect(tree().getAttribute('data-row-count')).toBe('3');

    await applyPattern('zzz');

    // Server half: the root request is now a `zzz*` scan.
    await waitFor(() => expect(childPrefixes).toBeTruthy());
    expect(childPrefixes().some((prefix) => prefix.startsWith('zzz'))).toBe(true);
    // Client half: the rows the fold produced are gone.
    await waitFor(() => expect(tree().getAttribute('data-row-count')).toBe('0'));
    // I-11: a finished scan plus an active filter is exactly `no-match`.
    const empty = await screen.findByTestId('redis-tree-empty');
    expect(empty.getAttribute('data-empty-state')).toBe('no-match');
    // The pattern quoted by the copy is the applied one, published as data.
    expect(tree().getAttribute('data-filter-active')).toBe('true');
  });

  it('clearing the filter brings the rows back and the empty state goes', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    await applyPattern('zzz');
    await waitFor(() => expect(tree().getAttribute('data-row-count')).toBe('0'));
    await screen.findByTestId('redis-tree-empty');

    // `Esc` is the row's exit: input cleared *and* filter dropped, not just text.
    const input = screen.getByTestId('redis-search-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(input).toHaveValue(''));
    await waitFor(() => expect(tree().getAttribute('data-row-count')).toBe('3'));
    expect(screen.queryByTestId('redis-tree-empty')).toBeNull();
    // Back to the whole keyspace: the root scan asks for `*` again.
    await waitFor(() => expect(childPrefixes()).toContain(''));
  });

  it('a prefix pattern routes the root request and re-roots the tree inside it', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    const rootsBefore = childPrefixes().length;

    await applyPattern('app:*');
    // Server half: the root `list_children` now asks for prefix `app:`, so the
    // tree is rooted inside the namespace instead of painting one folder.
    await waitFor(() => expect(childPrefixes().length).toBeGreaterThan(rootsBefore));
    expect(childPrefixes().slice(rootsBefore)).toContain('app:');
    await waitFor(() => expect(tree().getAttribute('data-row-count')).toBe('2'));
    expect(await screen.findByTestId('redis-key-row-app:user:1')).toBeTruthy();
    // Keys the pattern rejects are gone from both halves of the pipe.
    expect(screen.queryByTestId('redis-key-row-root-plain')).toBeNull();
    expect(screen.queryByTestId('redis-key-row-cache-hit')).toBeNull();
    // …and R1's counter agrees with the painted rows (BUG-001 single source).
    await waitFor(() => expect(attr('redis-tree-count', 'data-loaded')).toBe('2'));
  });

  it('a deep-only match paints its parent as a non-interactive breadcrumb', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    fireEvent.click(screen.getByTestId('redis-tree-folder-app:'));
    await screen.findByTestId('redis-key-row-app:user:1');
    expect(tree().getAttribute('data-row-count')).toBe('5');

    // Leading star ⇒ no root prefix to route, so this is pure client filtering:
    // only `app:user:1` survives, and `app:` comes back as path context.
    await applyPattern('*user:1');
    await waitFor(() => expect(tree().getAttribute('data-row-count')).toBe('1'));
    const crumb = await screen.findByTestId('redis-tree-folder-app:');
    expect(crumb.getAttribute('data-breadcrumb')).toBe('true');
    // The surviving leaf is a real row.
    expect(screen.getByTestId('redis-key-row-app:user:1').getAttribute('data-row-kind')).toBe(
      'key',
    );
    // Path context only: clicking the breadcrumb does not fold, and it cannot be
    // checked — there is no checkbox in that row at all.
    const before = childPrefixes().length;
    fireEvent.click(crumb);
    expect(childPrefixes().length).toBe(before);
    expect(screen.queryByTestId('redis-tree-folder-check-app:')).toBeNull();
  });

  it('R1, 「全选已加载」 and the painted rows read one set, both ways', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    // No filter: the counter counts the loaded keys the tree can show.
    await waitFor(() => expect(attr('redis-tree-count', 'data-loaded')).toBe('3'));
    expect(tree().getAttribute('data-row-count')).toBe('3');

    // Enter half of the contradiction: a pattern that cuts everything.
    await applyPattern('zzz');
    await waitFor(() => expect(attr('redis-tree-count', 'data-loaded')).toBe('0'));
    await waitFor(() => expect(tree().getAttribute('data-row-count')).toBe('0'));
    // Select-all over an empty visible set is disabled, not silently empty.
    expect(screen.getByTestId('redis-tree-select-all').disabled).toBe(true);

    // A pattern that keeps the two app keys: select-all takes exactly those,
    // never the `root-plain` key the same tree had before the filter.
    await applyPattern('app:*');
    await waitFor(() => expect(screen.getByTestId('redis-tree-select-all').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('redis-tree-select-all'));
    await waitFor(() =>
      expect(attr('redis-tree-batch-delete-count', 'data-count')).toBe('2'),
    );
    expect(
      screen.getByTestId('redis-tree-key-check-app:user:1').getAttribute('data-checked'),
    ).toBe('true');
    expect(screen.queryByTestId('redis-tree-key-check-root-plain')).toBeNull();
  });

  it('an unapplied edit does not repaint the tree, applied does', async () => {
    renderWorkbench();
    await screen.findByTestId('redis-tree-folder-app:');
    const input = screen.getByTestId('redis-search-input');

    // Intermediate keystrokes: D-2's applied/typed split must survive the new
    // wiring — half-typed text must not cut rows nor fire a tree re-root.
    const rootsBefore = childPrefixes().length;
    fireEvent.change(input, { target: { value: 'zz' } });
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(tree().getAttribute('data-row-count')).toBe('3');
    expect(childPrefixes().length).toBe(rootsBefore);

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(tree().getAttribute('data-row-count')).toBe('0'));
  });

  it('a folder with an open scan admits its remainder is unfiltered', async () => {
    // Root level stays mid-scan (cursor 41 ⇒ the folder count is `(2+)`).
    listChildren.mockImplementation(async (_s: string, _i: number, prefix: string) => {
      if (prefix !== '') return { children: [leaf('app:user:1')], cursor: 0 };
      return { children: rootChildren(), cursor: 41 };
    });
    renderWorkbench();
    const count = await screen.findByTestId('redis-tree-folder-count-app:');
    expect(count.getAttribute('data-partial')).toBe('true');
    // Without a filter: just the `+`.
    expect(count.textContent).toContain('redis.tree.folderPartial');
    expect(count.textContent).not.toContain('redis.tree.filterUnloaded');

    // With a filter in force the same badge must name the unfiltered tail: the
    // pattern applies to loaded rows only, so `(n)` of an unfinished level is
    // neither a match count nor a total (the recorded known limitation).
    await applyPattern('*:*');
    await waitFor(() => expect(attr('redis-key-tree', 'data-filter-active')).toBe('true'));
    const filtered = screen.getByTestId('redis-tree-folder-count-app:');
    expect(filtered.textContent).toContain('redis.tree.folderPartial');
    expect(filtered.textContent).toContain('redis.tree.filterUnloaded');

    // Exit: dropping the filter keeps the `+` but drops the caveat.
    fireEvent.keyDown(screen.getByTestId('redis-search-input'), { key: 'Escape' });
    await waitFor(() => expect(attr('redis-key-tree', 'data-filter-active')).toBe('false'));
    expect(screen.getByTestId('redis-tree-folder-count-app:').textContent).not.toContain(
      'redis.tree.filterUnloaded',
    );
  });
});
