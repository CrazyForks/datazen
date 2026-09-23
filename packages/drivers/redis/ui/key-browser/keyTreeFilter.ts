import type { KeyTreeRow } from './keyTree';
import { isGlobalPattern } from './treeEmptyState';

/**
 * Client-side application of the R2 pattern to the *tree* rows
 * (redis-tree-ui-BUG-001).
 *
 * `list_children` takes no pattern (its options are `sep` / `noTtlOnly` /
 * `keyType`; a Rust-side contract change is outside this track), so the pattern
 * the flat `scan_keys` list already honours has to be applied to the tree here.
 * Everything in this module is a pure function over already-loaded rows, which
 * is what makes the glob semantics, the breadcrumb back-fill and the "nothing
 * matched" result testable without a DOM.
 *
 * The semantics mirror Redis' own `MATCH` glob (`*` = any run, `?` = one char,
 * everything else literal, case-sensitive, anchored): one pattern must not mean
 * "substring" in the flat list and "exact" in the tree.
 *
 * Visibility forks on `row.kind` — never on whether a `key` field happens to be
 * present. A child-level leaf row's `entry.key` is the *full* key the server
 * returned (Rust `split_children` keeps it absolute) and a folder row's `path`
 * is the full prefix including its trailing separator, so both are matched
 * against the same pattern string with the same meaning.
 *
 * Known limitation, by ruling: the pattern is applied to the *loaded* row set
 * only. A level whose scan has not finished holds keys the filter has never
 * seen, so `(n+)` counts stay server-side and `redis.tree.filterUnloaded` names
 * the gap. Full-keyset matching belongs to R / Wave 4.
 */

/** Regex metacharacters that must lose their power when the glob has no star. */
const REGEX_METACHARACTERS = /[.+^${}()|[\]\\]/g;

/**
 * Compile a Redis MATCH glob into an anchored, case-sensitive RegExp.
 *
 * `*` → `.*`, `?` → `.`, every other character escaped verbatim (so `:` and `.`
 * inside key names stay literals). A blank pattern or one that cannot compile
 * yields `null`; callers must treat `null` as "the filter matches nothing",
 * never as "match everything" — silently widening a broken pattern is the same
 * class of lie BUG-001 is about.
 */
export function globToRegExp(pattern: string): RegExp | null {
  if (pattern.length === 0) return null;
  let source = '';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += char.replace(REGEX_METACHARACTERS, '\\$&');
  }
  try {
    return new RegExp(`^${source}$`);
  } catch {
    return null;
  }
}

/** Does `name` match the glob `pattern`? Blank / uncompilable ⇒ no. */
export function globMatchesName(name: string, pattern: string): boolean {
  const re = globToRegExp(pattern);
  if (!re) return false;
  return re.test(name);
}

/**
 * The identity a pattern is matched against, chosen by `row.kind` — the single
 * place allowed to reach for `path` vs `entry.key`. Forking on whether some field
 * is *present* instead would mis-handle a child-level leaf row, whose `entry.key`
 * is absolute while a folder's `path` carries its trailing separator.
 */
function rowMatchTarget(row: KeyTreeRow): string {
  return row.kind === 'folder' ? row.path : row.entry.key;
}

/**
 * The rows to paint under `pattern`, in pre-order.
 *
 *  - blank / `*` ⇒ the input unchanged (no filter is on);
 *  - a folder row survives when its full `path` matches; an **empty** folder
 *    (`count === 0`) never shows, matching or not;
 *  - a key row survives when its full key matches. A matching folder does *not*
 *    make its children visible as a group: expanded children are judged by their
 *    own match (a collapsed folder renders no children at all, so this is the
 *    same rule the tree already follows);
 *  - a non-matching folder that owns a surviving descendant is re-emitted as a
 *    **breadcrumb** (`breadcrumb: true`) so the row never floats without its
 *    path. It is decoration: not clickable, no checkbox, excluded from
 *    `data-row-count` and from every selection set;
 *  - a non-matching folder whose *subtree* holds a key that matches (per
 *    `hasVisibleDescendant`, i.e. the caller's filtered key set) survives as a
 *    normal clickable row — that is what keeps `*user*` from blanking the
 *    `app:` folder it obviously contains, while a pattern with nothing under it
 *    (`zzz`) does drop it;
 *  - nothing matched ⇒ `[]`, which is what makes I-11's `no-match` reachable in
 *    the default (tree) view.
 */
export function filterTreeRowsByPattern(
  rows: KeyTreeRow[],
  pattern: string,
  hasVisibleDescendant: (folderPath: string) => boolean = () => false,
): KeyTreeRow[] {
  const trimmed = pattern.trim();
  if (isGlobalPattern(trimmed)) return rows;

  const re = globToRegExp(trimmed);
  // A pattern that cannot compile must not fall back to the unfiltered tree.
  if (!re) return [];

  /*
   * Two passes, because an ancestor can be needed by a descendant that appears
   * later in the list: pass one decides keeps and marks the ancestor chain of
   * every kept row, pass two emits in order. `stack[d]` is the index of the
   * folder row at depth `d` on the current path.
   */
  const matched = new Array<boolean>(rows.length);
  const candidate = new Array<boolean>(rows.length);
  const needed = new Array<boolean>(rows.length);
  const stack: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    while (stack.length > row.depth) stack.pop();
    const isFolder = row.kind === 'folder';
    // The fork is on `row.kind`, never on a field being present (`rowMatchTarget`).
    const target = rowMatchTarget(row);
    const match = isFolder
      ? re.test(target) && row.count > 0
      : re.test(target);
    // A folder whose *own* name fails the glob is not automatically irrelevant:
    // a collapsed subtree is judged by `hasVisibleDescendant` (the caller's
    // filtered key set), because that is the only honest source for keys the tree
    // never loaded. Such a folder stays an ordinary, expandable row.
    const probed =
      !match && isFolder && row.count > 0 && hasVisibleDescendant(target);
    if (probed) candidate[i] = true;
    matched[i] = match;
    if (match) for (const ancestor of stack) needed[ancestor] = true;
    if (isFolder) {
      // Any folder row is a possible ancestor route to deeper expanded rows,
      // matching or not — that is what turns it into a breadcrumb later.
      stack[row.depth] = i;
      stack.length = row.depth + 1;
    } else {
      stack.length = row.depth;
    }
  }

  /*
  /*
   * Emit precedence: a row that matches on its own wins; an ancestor of one does
   * so as a breadcrumb; and only a folder with *no* painted survivor underneath
   * may instead be kept by the probe (its whole subtree is unloaded, so
   * expanding it is the user's only way in — it stays a normal clickable row).
   */
  const out: KeyTreeRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (matched[i]) {
      out.push(row);
      continue;
    }
    // Precedence: a survivor's ancestor comes back as a *breadcrumb* (it is
    // already painted as a path, so making it inert is the honest reading), and
    // only a folder with nothing painted beneath it may be kept by the probe.
    if (needed[i] && row.kind === 'folder' && row.count > 0) {
      out.push({ ...row, breadcrumb: true });
      continue;
    }
    if (candidate[i]) out.push(row);
  }
  return out;
}

/** A breadcrumb row is path context only: never selectable, never counted. */
export function isBreadcrumbRow(row: KeyTreeRow): boolean {
  return row.kind === 'folder' && row.breadcrumb === true;
}

/** Rows the user can act on — `data-row-count`, selection and navigation. */
export function countSelectableRows(rows: KeyTreeRow[]): number {
  let n = 0;
  for (const row of rows) if (!isBreadcrumbRow(row)) n += 1;
  return n;
}

/**
 * The key names the visible row set stands for: the *single source* behind R1's
 * counter, 「全选已加载」, the folder-checkbox cascade and I-11's `{loaded}`
 * (BUG-001's contradiction pair dies here — they can no longer disagree about
 * which set is on screen). Blank / `*` ⇒ the input unchanged.
 */
export function filterKeysByPattern(keys: string[], pattern: string): string[] {
  const trimmed = pattern.trim();
  if (isGlobalPattern(trimmed)) return keys;
  const re = globToRegExp(trimmed);
  if (!re) return [];
  return keys.filter((key) => re.test(key));
}
