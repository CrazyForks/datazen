import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEPARATOR,
  SEPARATOR_CHOICES,
  buildFlatTreeRows,
  buildKeyTreeRows,
  buildServerTreeRows,
  folderLabel,
  separatorsFor,
  splitKeyNamespace,
} from '../key-browser/keyTree';
import type { ChildEntry } from '../shared/redisInvoke';
import type { KeyEntry } from '@datazen/driver-sdk';

/** The historical two-char grouping, now passed explicitly by every caller. */
const COLON_DOT = [':', '.'];

function entry(key: string): KeyEntry {
  return { key, keyType: 'string', ttl: -1, size: 0, preview: '' };
}

function folder(prefix: string, count: number): ChildEntry {
  return { kind: 'folder', prefix, count };
}

function leaf(key: string): ChildEntry {
  return { kind: 'key', key, keyType: 'string', ttl: -1, logicalLen: 5, memBytes: null };
}

describe('separator plumbing (R3 / D-3)', () => {
  it('offers exactly the three documented separators and defaults to colon', () => {
    expect(SEPARATOR_CHOICES).toEqual([':', '.', '/']);
    expect(DEFAULT_SEPARATOR).toBe(':');
    // A caller-supplied separator becomes a one-element list: no hidden fallback.
    expect(separatorsFor('.')).toEqual(['.']);
    // An empty pref (never expected from the UI) still resolves to the server
    // default rather than sending `sep: ""` and grouping on nothing.
    expect(separatorsFor('')).toEqual([':']);
  });

  it('groups on the requested separator only', () => {
    expect(splitKeyNamespace('a.b:c', [':'])).toEqual(['a.b', 'c']);
    expect(splitKeyNamespace('a.b:c', ['.'])).toEqual(['a', 'b:c']);
    expect(splitKeyNamespace('cache/user/1', ['/'])).toEqual(['cache', 'user', '1']);
    // The historical colon-then-dot order is now an explicit argument.
    expect(splitKeyNamespace('user:profile:1', COLON_DOT)).toEqual(['user', 'profile', '1']);
    expect(splitKeyNamespace('a.b.c', COLON_DOT)).toEqual(['a', 'b', 'c']);
    expect(splitKeyNamespace('plain', COLON_DOT)).toEqual(['plain']);
  });

  it('labels a prefix with the configured separator but survives a foreign one', () => {
    expect(folderLabel('app:cache:', ':')).toBe('cache');
    expect(folderLabel('app/cache/', '/')).toBe('cache');
    expect(folderLabel('a.b.c.', '.')).toBe('c');
    expect(folderLabel('bare')).toBe('bare');
  });
});

describe('splitKeyNamespace', () => {
  it('splits on colon by default', () => {
    expect(splitKeyNamespace('user:profile:1', separatorsFor(':'))).toEqual([
      'user',
      'profile',
      '1',
    ]);
  });

  it('falls back to dot', () => {
    expect(splitKeyNamespace('a.b.c', COLON_DOT)).toEqual(['a', 'b', 'c']);
  });

  it('returns whole key when no separator', () => {
    expect(splitKeyNamespace('plain', COLON_DOT)).toEqual(['plain']);
  });
});

describe('buildKeyTreeRows', () => {
  it('builds collapsed folders and expands when path is open', () => {
    const keys = [entry('user:1'), entry('user:2'), entry('order:9')];
    const collapsed = buildKeyTreeRows(keys, new Set(), separatorsFor(':'));
    expect(
      collapsed.filter((r) => r.kind === 'folder').map((r) => (r as { path: string }).path),
    ).toEqual(['order', 'user']);

    const expanded = buildKeyTreeRows(keys, new Set(['user']), separatorsFor(':'));
    const labels = expanded.map((r) =>
      r.kind === 'folder' ? `folder:${r.label}` : `key:${r.label}`,
    );
    expect(labels).toContain('folder:user');
    expect(labels).toContain('key:1');
    expect(labels).toContain('key:2');
  });

  it('re-groups the whole tree when the separator changes (R3 state machine)', () => {
    // Same keys, two separators ⇒ two different top-level folder sets: switching
    // the preference must recompute the tree, not keep the stale grouping.
    const keys = [entry('svc.a:1'), entry('svc.b:2')];
    const byColon = buildKeyTreeRows(keys, new Set(), separatorsFor(':'));
    const byDot = buildKeyTreeRows(keys, new Set(), separatorsFor('.'));
    // Colon first: the dots are opaque, so the split lands on `:` and each
    // `svc.a` / `svc.b` prefix becomes its own folder.
    expect(byColon.map((r) => `${r.kind}:${r.kind === 'folder' ? r.path : r.entry.key}`)).toEqual([
      'folder:svc.a',
      'folder:svc.b',
    ]);
    // Dot instead: everything folds under one `svc` folder holding both leaves.
    expect(byDot.map((r) => `${r.kind}:${r.kind === 'folder' ? r.path : r.entry.key}`)).toEqual([
      'folder:svc',
    ]);
    expect(byDot[0].kind === 'folder' && byDot[0].count).toBe(2);
  });
});

describe('buildFlatTreeRows', () => {
  it('turns off grouping entirely: depth 0 and the full key name', () => {
    const rows = buildFlatTreeRows([entry('user:profile:1'), entry('plain')]);
    expect(rows.map((r) => (r.kind === 'key' ? `${r.depth}:${r.label}` : 'folder'))).toEqual([
      '0:user:profile:1',
      '0:plain',
    ]);
    expect(rows.every((r) => r.kind === 'key')).toBe(true);
  });

  it('is empty, not undefined, for an unpopulated database', () => {
    expect(buildFlatTreeRows([])).toEqual([]);
  });
});

describe('folderLabel', () => {
  it('strips trailing separator and returns last segment', () => {
    expect(folderLabel('app:cache:')).toBe('cache');
    expect(folderLabel('app:')).toBe('app');
    expect(folderLabel('a.b.c.')).toBe('c');
  });

  it('returns whole prefix when no separator', () => {
    expect(folderLabel('bare')).toBe('bare');
  });
});

describe('buildServerTreeRows', () => {
  it('renders root level as folders + leaves at depth 0', () => {
    const levels = {
      '': { children: [folder('app:', 6), leaf('root-key')], done: true },
    };
    const rows = buildServerTreeRows(levels, new Set());
    expect(rows.map((r) => r.kind)).toEqual(['folder', 'key']);
    const f = rows[0];
    expect(f.kind === 'folder' && f.path).toBe('app:');
    expect(f.kind === 'folder' && f.label).toBe('app');
    const k = rows[1];
    expect(k.kind === 'key' && k.entry.key).toBe('root-key');
  });

  it('recurses into expanded folders at deeper depth', () => {
    const levels = {
      '': { children: [folder('app:', 2)], done: true },
      'app:': { children: [leaf('app:cache:1')], done: true },
    };
    const collapsed = buildServerTreeRows(levels, new Set());
    expect(collapsed).toHaveLength(1);

    const expanded = buildServerTreeRows(levels, new Set(['app:']));
    expect(expanded.map((r) => r.kind)).toEqual(['folder', 'key']);
    const leafRow = expanded[1];
    expect(leafRow.kind === 'key' && leafRow.depth).toBe(1);
    expect(leafRow.kind === 'key' && leafRow.label).toBe('1');
  });

  it('omits missing levels for un-expanded prefixes', () => {
    const levels = { '': { children: [folder('app:', 2)], done: false } };
    const rows = buildServerTreeRows(levels, new Set(['app:']));
    // 'app:' level not loaded yet → only the folder row renders
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('folder');
  });
});
