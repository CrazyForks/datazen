import type { TreeRowLevel } from './types';

/**
 * Navigation and visibility arithmetic over a **flat, pre-order** row list.
 *
 * Both trees flatten their business objects into exactly this shape — a parent
 * row is always immediately followed by its expanded children — and both used
 * to answer "is this open", "where is my parent", "which rows disappear when
 * I fold this" with private scans. Everything here is a pure function over row
 * indexes: no DOM, no React, no state.
 *
 * Rows are addressed by index rather than by key because every question asked
 * of a flat list is a question about *position* (the next row, the row above),
 * and because a virtualizer only ever hands a renderer indexes.
 */

/**
 * Tells a row that owns a child list apart from a terminal one.
 *
 * Injected because both trees model rows as discriminated unions that answer
 * this with a `type` / `kind` fork rather than a field (see `./types`), and a
 * union cannot be narrowed to `hasChildren: boolean` without lying. Omit it and
 * a row model that does carry `hasChildren` is used instead.
 */
export type BranchProbe<R> = (row: R, index: number) => boolean;

/** The two optional capabilities a row *may* carry; see `./types` for why. */
type RowExtras = { hasChildren?: boolean; expanded?: boolean };

function defaultIsBranch<R extends TreeRowLevel>(row: R): boolean {
  return (row as R & RowExtras).hasChildren === true;
}

function rowIsExpanded<R extends TreeRowLevel>(row: R): boolean {
  return (row as R & RowExtras).expanded === true;
}

/**
 * The effective expand state of a row: its own flag, or a forced expand.
 *
 * A forced expand is what a search does — every match must be reachable without
 * a second keystroke — and it is the reason the navigator's "expanded" check
 * used to be spelled `expandedDbs.has(key) || !!query` at seven separate call
 * sites. Naming the rule once means "what does a search do to this tree" has
 * one answer instead of seven that can drift.
 */
export function effectiveExpanded(ownExpanded: boolean, forceExpand: boolean): boolean {
  return ownExpanded || forceExpand;
}

/**
 * Whether `row`'s children belong in the list: always for a terminal row,
 * otherwise whenever it is effectively expanded.
 *
 * This is the visibility question in its smallest form — "folding a sibling
 * hides exactly the rows under that sibling" — and it is what a builder asks
 * before recursing.
 */
export function showsSubtree<R extends TreeRowLevel>(
  row: R,
  forceExpand = false,
  isBranch: BranchProbe<R> = defaultIsBranch,
): boolean {
  return !isBranch(row, -1) || effectiveExpanded(rowIsExpanded(row), forceExpand);
}

/**
 * Half-open index range `[start, end)` of the rows strictly below `from`, or
 * `null` when `from` is not a row.
 *
 * Exact for a pre-order list: a descendant is simply every following row
 * deeper than `from`, so the subtree ends at the first row that is not. A leaf
 * and a collapsed branch both yield an empty range, because neither has any
 * descendants *in the list* — the difference between the two is a question
 * about whether a range will ever be non-empty, which is {@link showsSubtree}'s
 * job, not this one's.
 */
export function descendantRange<R extends TreeRowLevel>(
  rows: readonly R[],
  from: number,
): { start: number; end: number } | null {
  const row = rows[from];
  if (!row) return null;
  let end = from + 1;
  while (end < rows.length && rows[end]!.depth > row.depth) end += 1;
  return { start: from + 1, end };
}

/** The descendant indexes of `from`, as a list (empty for a leaf). */
export function descendantIndexes<R extends TreeRowLevel>(
  rows: readonly R[],
  from: number,
): number[] {
  const range = descendantRange(rows, from);
  if (!range) return [];
  const out: number[] = [];
  for (let i = range.start; i < range.end; i++) out.push(i);
  return out;
}

/**
 * The branch rows the list has descended into after consuming `[0, from)`,
 * outermost first — the chain a screen reader holds open and a multi-level
 * sticky header pins.
 *
 * Maintained as a running stack with "pop everything at my depth or deeper",
 * which is exact for pre-order rows. Two consequences are deliberate, because
 * both are what the callers want:
 *
 * - `from` at or past the end of the list yields the chain still open at the
 *   end rather than throwing. A scrolled-past-the-end index has no row of its
 *   own, and the previous rows' chain is the honest answer.
 * - `from` pointing at a row that is a *sibling* of the one before it reports
 *   the chain the list was in, not that row's parents. Callers are asking
 *   "what is open here", which is a question about the scroll position rather
 *   than about any single row.
 */
export function ancestorIndexes<R extends TreeRowLevel>(
  rows: readonly R[],
  from: number,
  isBranch: BranchProbe<R> = defaultIsBranch,
): number[] {
  const stack: number[] = [];
  const limit = Math.max(0, Math.min(from, rows.length));
  for (let i = 0; i < limit; i++) {
    const row = rows[i]!;
    while (stack.length > 0 && rows[stack[stack.length - 1]!]!.depth >= row.depth) stack.pop();
    if (isBranch(row, i)) stack.push(i);
  }
  return stack;
}

/**
 * Index of the branch that owns `rows[from]`, or `from` itself.
 *
 * Returning `from` rather than `-1` is the "stay put" exit transition of ← on
 * a root row: it has nowhere to go, and a caller that treated the absence as
 * an error would either clear the selection or scroll the list to the top.
 */
export function parentIndexOf<R extends TreeRowLevel>(
  rows: readonly R[],
  from: number,
  isBranch: BranchProbe<R> = defaultIsBranch,
): number {
  const row = rows[from];
  if (!row || row.depth === 0) return from;
  for (let i = from - 1; i >= 0; i--) {
    const candidate = rows[i]!;
    if (candidate.depth === row.depth - 1 && isBranch(candidate, i)) return i;
  }
  return from;
}

/**
 * Index of the first child of the branch at `from`, or `-1` for a leaf, a
 * collapsed branch, and an out-of-range index.
 *
 * A collapsed branch has no child *row*, not a hidden one — the builder never
 * emitted it — which is why −1 and "expanded but empty" are the same answer
 * here and only distinguishable through the row's own expand state.
 */
export function firstChildIndex<R extends TreeRowLevel>(
  rows: readonly R[],
  from: number,
  isBranch: BranchProbe<R> = defaultIsBranch,
): number {
  const row = rows[from];
  if (!row || !isBranch(row, from)) return -1;
  const next = rows[from + 1];
  return next && next.depth === row.depth + 1 ? from + 1 : -1;
}

/**
 * Index `offset` rows away from `from`, clamped to the list.
 *
 * Clamping instead of wrapping is the exit transition of keyboard navigation:
 * ↑ on the first row and ↓ on the last row stay put rather than jumping the
 * viewport to the other end of a 10k-row tree. `from < 0` means "nothing is
 * active yet", and the first step lands on the end the direction points at.
 */
export function stepIndex(from: number, offset: number, rowCount: number): number {
  if (rowCount <= 0) return -1;
  const next = from < 0 ? (offset > 0 ? 0 : rowCount - 1) : from + offset;
  return Math.max(0, Math.min(rowCount - 1, next));
}

/**
 * Starting at `first` (inclusive) and moving in `direction`, the first index
 * `isNavigable` accepts, or `-1` when the walk leaves the list without finding
 * one.
 *
 * `first` is the *candidate*, not the current row: callers advance first (with
 * {@link stepIndex} or {@link firstChildIndex}) and this helper only skips what
 * the caller marked as decoration. A `-1` means "nowhere to go" — callers must
 * stay put, or leave selection when the current row is itself no longer
 * navigable. Returning the row the walk skipped past would defeat that, which
 * is how a filtered-out row used to swallow a whole keystroke.
 */
export function nextNavigableIndex(
  first: number,
  direction: 1 | -1,
  rowCount: number,
  isNavigable: (index: number) => boolean,
): number {
  let index = first;
  while (index >= 0 && index < rowCount && !isNavigable(index)) index += direction;
  return index >= 0 && index < rowCount ? index : -1;
}
