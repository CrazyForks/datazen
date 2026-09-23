/**
 * [redis-tree-ui-BUG-001] Table-driven battery for the pure pattern filter.
 *
 * Why a pure module: `list_children` has no pattern parameter (its options are
 * `sep` / `noTtlOnly` / `keyType` — see the Rust dispatch), so the R2 pattern
 * must be applied client-side to the loaded rows. The three things that are easy
 * to get wrong and impossible to see from a DOM test are exactly what is
 * table-driven here:
 *  1. glob semantics matching Redis `MATCH` (`*`, `?`, escaped literals) rather
 *     than "substring" or "startsWith", so the tree and the flat list cannot
 *     disagree about one pattern;
 *  2. forking visibility on `row.kind`, **not** on the presence of a `key`
 *     field — a child-level leaf row carries an absolute key, a folder row
 *     carries its full prefix, and both must meet the same pattern;
 *  3. the ancestor back-fill: a surviving deep row keeps a non-matching parent
 *     as a *breadcrumb*, and a breadcrumb is not a row the user can act on.
 */
import { describe, expect, it } from 'vitest';
import type { KeyEntry } from '@datazen/driver-sdk';
import type { KeyTreeRow } from '../key-browser/keyTree';
import {
  countSelectableRows,
  filterKeysByPattern,
  filterTreeRowsByPattern,
  globMatchesName,
  globToRegExp,
  isBreadcrumbRow,
} from '../key-browser/keyTreeFilter';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function entry(key: string): KeyEntry {
  return { key, keyType: 'string', ttl: -1, size: 0, preview: '' };
}

/**
 * Fold `levels` with `buildServerTreeRows`-equivalent shapes. Written by hand
 * rather than imported from the fold so a filter test cannot be rescued by a
 * fold change (and vice versa).
 */
function rowFolder(path: string, depth: number, count = 2): KeyTreeRow {
  return { kind: 'folder', path, label: path, depth, count };
}

function rowKey(key: string, depth: number): KeyTreeRow {
  return { kind: 'key', entry: entry(key), depth, label: key };
}

/** ids as `kind:path`, breadcrumbs suffixed `#bc` — compact, order-explicit. */
function ids(rows: KeyTreeRow[]): string[] {
  return rows.map((row) => {
    const id = row.kind === 'folder' ? `f:${row.path}` : `k:${row.entry.key}`;
    return isBreadcrumbRow(row) ? `${id}#bc` : id;
  });
}

/* ── glob compilation ─────────────────────────────────────────────────────── */

describe('[redis-tree-ui-BUG-001] globToRegExp mirrors Redis MATCH', () => {
  it.each([
    // pattern      name              expected
    ['*', 'anything', true],
    ['app:*', 'app:user:1', true],
    ['app:*', 'appuser:1', false],
    ['app:*', 'other:1', false],
    ['*', '', true],
    ['a?c', 'abc', true],
    ['a?c', 'ac', false],
    ['a?c', 'aXXc', false],
    ['user', 'user', true],
    ['user', 'username', false],
    ['user', 'User', false],
    ['*user*', 'app:user:1', true],
    ['*user*', 'app:admin:1', false],
    ['app.user*', 'app.user:1', true],
    // `.` must stay a literal: an unescaped dot would let `appXuser:1` through.
    ['app.user:1', 'appXuser:1', false],
    // `:` is not special in either grammar.
    ['app:user:1', 'app:user:1', true],
    ['root-plain', 'root-plain', true],
    ['root-plain', 'root-plainx', false],
  ] as const)('glob %s vs %s ⇒ %s', (pattern, name, expected) => {
    expect(globMatchesName(name, pattern)).toBe(expected);
  });

  it('blank is not compiled (a filter that is off is handled upstream)', () => {
    expect(globToRegExp('')).toBeNull();
    expect(globMatchesName('anything', '')).toBe(false);
  });

  it('escapes metacharacters instead of throwing on them', () => {
    // Unterminated `[` is legal in a key name and would throw as a RegExp.
    for (const pattern of ['a[b', 'a(b+', 'x|y', 'a{2', 'a$b^', 'back\\slash']) {
      const re = globToRegExp(pattern);
      expect(re, `${pattern} must compile or degrade to null`).not.toBeNull();
      expect(re!.test(pattern)).toBe(true);
    }
  });
});

/* ── pattern → prefix (the routing half of the fix) ────────────────────────── */

describe('[redis-tree-ui-BUG-001] visibleTreeRows forks on row.kind', () => {
  /** Root level: one folder + one loose key; `app:` expanded with two leaves. */
  function rows(): KeyTreeRow[] {
    return [
      rowFolder('app:', 0),
      rowKey('app:user:1', 1),
      rowKey('app:user:2', 1),
      rowKey('root-plain', 0),
    ];
  }

  it('a blank or `*` pattern is no filter at all (identity, same array)', () => {
    const input = rows();
    expect(filterTreeRowsByPattern(input, '')).toBe(input);
    expect(filterTreeRowsByPattern(input, '*')).toBe(input);
    expect(filterTreeRowsByPattern(input, '   ')).toBe(input);
  });

  it('nothing matched ⇒ empty list, which is what makes no-match reachable', () => {
    expect(filterTreeRowsByPattern(rows(), 'zzz')).toEqual([]);
    expect(countSelectableRows(filterTreeRowsByPattern(rows(), 'zzz'))).toBe(0);
  });

  it('an uncompilable pattern is "matches nothing", never "matches everything"', () => {
    expect(ids(filterTreeRowsByPattern(rows(), '['))).toEqual([]);
  });

  it('a matching folder keeps its own children only where they match too', () => {
    // `app:*` matches the folder `app:` *and* both leaves: no breadcrumb needed.
    expect(ids(filterTreeRowsByPattern(rows(), 'app:*'))).toEqual([
      'f:app:',
      'k:app:user:1',
      'k:app:user:2',
    ]);
    expect(
      filterTreeRowsByPattern(rows(), 'app:*').some((row) => isBreadcrumbRow(row)),
    ).toBe(false);
  });

  it('a folder-only match does not smuggle non-matching children through', () => {
    // Pattern hits the prefix exactly; the leaves are longer, so only the
    // (collapsed-or-expanded) folder row itself survives.
    expect(ids(filterTreeRowsByPattern(rows(), 'app:'))).toEqual(['f:app:']);
  });

  it('a child-only match back-fills its parent as a breadcrumb', () => {
    const out = filterTreeRowsByPattern(rows(), 'app:user:1');
    expect(ids(out)).toEqual(['f:app:#bc', 'k:app:user:1']);
    const crumb = out[0]!;
    expect(crumb.kind).toBe('folder');
    if (crumb.kind === 'folder') {
      expect(crumb.path).toBe('app:');
      // The breadcrumb still reports the server count: it is the same folder.
      expect(crumb.count).toBe(2);
    }
    // Breadcrumbs are not rows the user acts on.
    expect(countSelectableRows(out)).toBe(1);
  });

  it('a deep match keeps the whole ancestor chain, each as a breadcrumb', () => {
    const deep: KeyTreeRow[] = [
      rowFolder('app:', 0, 5),
      rowFolder('app:user:', 1, 3),
      rowFolder('app:user:session:', 2, 1),
      rowKey('app:user:session:token-9', 3),
    ];
    expect(ids(filterTreeRowsByPattern(deep, '*token-9'))).toEqual([
      'f:app:#bc',
      'f:app:user:#bc',
      'f:app:user:session:#bc',
      'k:app:user:session:token-9',
    ]);
    expect(countSelectableRows(filterTreeRowsByPattern(deep, '*token-9'))).toBe(1);
  });

  it('an empty folder is never painted, matching or not', () => {
    const withEmpty: KeyTreeRow[] = [
      rowFolder('app:', 0, 0),
      rowKey('root-plain', 0),
    ];
    expect(ids(filterTreeRowsByPattern(withEmpty, 'app:*'))).toEqual([]);
    expect(ids(filterTreeRowsByPattern(withEmpty, '*'))).toEqual(['f:app:', 'k:root-plain']);
    expect(ids(filterTreeRowsByPattern(withEmpty, 'root-plain'))).toEqual(['k:root-plain']);
  });

  it('a matching sibling does not drag its non-matching siblings in', () => {
    const out = filterTreeRowsByPattern(rows(), 'root-plain');
    expect(ids(out)).toEqual(['k:root-plain']);
  });

  it('preserves pre-order (parents before children, server order otherwise)', () => {
    const mixed: KeyTreeRow[] = [
      rowFolder('m:', 0),
      rowKey('m:one', 1),
      rowKey('m:two', 1),
      rowFolder('z:', 0),
      rowKey('z:three', 1),
    ];
    expect(ids(filterTreeRowsByPattern(mixed, 'm:*'))).toEqual([
      'f:m:',
      'k:m:one',
      'k:m:two',
    ]);
    // Every leaf matches ⇒ nothing is dropped, order is byte-for-byte the input.
    expect(filterTreeRowsByPattern(mixed, '*')).toBe(mixed);
    // `*:t*` hits `m:two` / `z:three` but not the folder paths themselves, so
    // both parents come back as breadcrumbs and pre-order is preserved.
    expect(ids(filterTreeRowsByPattern(mixed, '*:t*'))).toEqual([
      'f:m:#bc',
      'k:m:two',
      'f:z:#bc',
      'k:z:three',
    ]);
  });
});

/* ── the selectable key set (single source of truth) ───────────────────────── */

describe('[redis-tree-ui-BUG-001] filterKeysByPattern is the one set everything reads', () => {
  const keys = ['app:user:1', 'app:user:2', 'root-plain'];

  it('blank / `*` / whitespace are no filter (same array back)', () => {
    expect(filterKeysByPattern(keys, '')).toBe(keys);
    expect(filterKeysByPattern(keys, '*')).toBe(keys);
    expect(filterKeysByPattern(keys, ' * ')).toBe(keys);
  });

  it('narrows to exactly the glob hits', () => {
    expect(filterKeysByPattern(keys, 'app:*')).toEqual(['app:user:1', 'app:user:2']);
    expect(filterKeysByPattern(keys, '*plain')).toEqual(['root-plain']);
    expect(filterKeysByPattern(keys, 'zzz')).toEqual([]);
    expect(filterKeysByPattern(keys, '[')).toEqual([]);
  });

  it('agrees with the row filter about what is visible', () => {
    const rows: KeyTreeRow[] = [
      rowFolder('app:', 0),
      rowKey('app:user:1', 1),
      rowKey('app:user:2', 1),
      rowKey('root-plain', 0),
    ];
    for (const pattern of ['app:*', '*user:1', 'root-plain', 'zzz', '*']) {
      const fromRows = filterTreeRowsByPattern(rows, pattern)
        .filter((row) => row.kind === 'key' && !isBreadcrumbRow(row))
        .map((row) => (row.kind === 'key' ? row.entry.key : ''));
      expect(fromRows, pattern).toEqual(filterKeysByPattern(keys, pattern));
    }
  });
});
