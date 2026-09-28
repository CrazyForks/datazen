import { TREE_TOP_LEVEL, type TreeRowLevel } from './types';

/**
 * A depth pair with both numbers pinned: a row built by {@link rowLevels} or
 * {@link searchedRowLevels} always announces a level, so the builders below can
 * say so and a caller that forgets to spread the result into its row fails to
 * compile rather than silently over-nesting by one.
 */
export type ResolvedRowLevel = Required<TreeRowLevel>;

/**
 * Level and indent arithmetic for tree rows.
 *
 * This is the single source of truth for "what level does a screen reader hear
 * for this row" and "how far is it indented". Both are pure: no DOM, no React,
 * no knowledge of which tree is asking. Renderers call {@link ariaLevelOf} and
 * a stylesheet-facing caller calls {@link indentOf}; neither of them does
 * arithmetic of its own.
 */

/**
 * The level a screen reader announces for `row`.
 *
 * Follows the row's *logical* parent rather than its painted indent. A row
 * without an explicit `levelDepth` announces at `depth + 1`; a row that
 * declares one announces at `levelDepth + 1`, which is how a tree whose parent
 * row was filtered away still describes a real hierarchy instead of a hole.
 */
export function ariaLevelOf(row: TreeRowLevel): number {
  return (row.levelDepth ?? row.depth) + TREE_TOP_LEVEL;
}

/**
 * The depth pair for a row painted at `painted`, with `hiddenLevels` painted
 * ancestor levels that are *not* announced.
 *
 * `hiddenLevels` is clamped at 0 so a caller that over-counts can never push a
 * row below level 1.
 */
export function rowLevels(painted: number, hiddenLevels = 0): ResolvedRowLevel {
  return { depth: painted, levelDepth: Math.max(0, painted - Math.max(0, hiddenLevels)) };
}

/**
 * The depth pair for a row painted at `painted` while a search is suppressing
 * the header rows above `firstHiddenDepth`.
 *
 * This is the whole "search removes one level" rule, in one place. It exists as
 * a function rather than as a `+ 1` / `- 1` written at the row builder and
 * again at the renderer because that is exactly how the two trees drifted: the
 * navigator subtracted at paint time in `NavigatorTreeRow`, and the key browser
 * had no equivalent correction at all.
 *
 * Only rows at or below `firstHiddenDepth` lose the level, so a connection
 * that the search moved up to depth 0 keeps announcing at level 1 rather than
 * being pushed to level 0 — there is no announced parent to hide it under.
 * `firstHiddenDepth` is the caller's depth ladder root, passed in rather than
 * hard-coded so moving the ladder still moves this with it.
 */
export function searchedRowLevels(
  painted: number,
  firstHiddenDepth: number,
  searching: boolean,
): ResolvedRowLevel {
  const hidden = searching && painted >= firstHiddenDepth ? 1 : 0;
  return rowLevels(painted, hidden);
}

/**
 * Left indent, in a caller-chosen unit, for a row at `depth`.
 *
 * Negative depths clamp to the base indent rather than indenting backwards —
 * a row that briefly loses its parent (a search dropping a header, a level
 * still loading) must never paint outside the row box. The unit belongs to the
 * caller because the two trees disagree on purpose: the key browser works in
 * whole pixels for a fixed-height virtualizer, the navigator in `rem` so the
 * indent follows the user's font size.
 */
export function indentOf(depth: number, base: number, step: number): number {
  return base + Math.max(0, depth) * step;
}
