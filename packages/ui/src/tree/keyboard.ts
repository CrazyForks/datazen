/**
 * Keyboard map for a virtualized tree — **pure**, so it can be unit-tested
 * without a DOM and reused by any tree built on {@link VirtualTree}.
 *
 * `planTreeNavigation` answers "what does this keystroke do?" and nothing
 * else: it never touches state, never reads a ref, and never mutates a row
 * model. The shell (`VirtualTree`) owns the event plumbing, the controlled
 * `activeIndex` and the scroll reveal; the consumer keeps the state.
 *
 * The two behaviours that are easy to lose in a rewrite, and are therefore
 * spelled out here rather than left to each caller:
 *
 * 1. **Recognised means handled.** A keystroke that maps to an action is
 *    `preventDefault`-ed even when the list is empty or the current row cannot
 *    move, so the browser never scrolls the panel behind the tree's back.
 * 2. **Skipped rows are walked through, never landed on.** `isNavigable`
 *    filters the *destination*, not the starting point: if the current row is
 *    itself not navigable (its subtree was filtered away underneath it),
 *    forward motion re-seeds from the top instead of stepping onto a row that
 *    is decoration.
 */

/** Every action a tree key map can resolve to. */
export type TreeNavAction =
  | 'next'
  | 'previous'
  | 'expand'
  | 'fold'
  | 'activate'
  | 'select-all'
  | 'refresh'
  | 'clear';

/**
 * The caret moves to `index` and nothing is done to that row.
 *
 * `action` records which keystroke asked, not what happens to the row. It
 * includes the row-scoped keys because a re-seed is one: pressing Enter with
 * nothing active lands the caret on the first navigable row and deliberately
 * does *not* open it. See the re-seed branch in `planTreeNavigation` — the key
 * browser has a test pinning exactly that, and "act on whatever the caret just
 * happened to land on" is not a thing either tree wants.
 */
export interface TreeNavMove {
  kind: 'move';
  action: 'next' | 'previous' | 'expand' | 'fold' | 'activate';
  index: number;
}

/** A row-scoped action: toggle the branch, or activate the row. */
export interface TreeNavRowAction {
  kind: 'toggle' | 'activate';
  action: 'expand' | 'fold' | 'activate';
  index: number;
}

/** A tree-wide action that carries no row. */
export interface TreeNavCommand {
  kind: 'command';
  action: Extract<TreeNavAction, 'select-all' | 'refresh' | 'clear'>;
}

/** Nothing to do — either the key is not a tree key, or the step is clamped. */
export interface TreeNavNone {
  kind: 'none';
}

export type TreeNavPlan = TreeNavMove | TreeNavRowAction | TreeNavCommand | TreeNavNone;

export interface TreeKeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface TreeNavPlanInput<R> {
  /** Painted row count — navigation never looks past it. */
  rowCount: number;
  /** Currently focused row, or `-1` when the tree has no active row yet. */
  activeIndex: number;
  action: TreeNavAction;
  /** Branch probe — whether the row at `index` owns a child list. */
  isBranch: (row: R, index: number) => boolean;
  /** Expanded probe for the same row. */
  isExpanded: (index: number) => boolean;
  /** Rows a user may land on (decorations are `false`). */
  isNavigable: (index: number) => boolean;
  step: (from: number, direction: 1 | -1) => number;
  /** First child of a branch, or `-1` when it is a leaf. */
  firstChildIndex: (index: number) => number;
  /** Nearest ancestor branch, or `-1` at the top. */
  parentIndexOf: (index: number) => number;
  /** Next navigable row at or after `from` in `direction`, or `-1`. */
  nextNavigableIndex: (from: number, direction: 1 | -1) => number;
  /** Narrow `activeIndex` to the painted range, `-1` when it points past it. */
  clamp: (index: number) => number;
  /** The row at an index, for the branch probe. */
  rowAt: (index: number) => R;
}

/**
 * Resolve one tree keystroke.
 *
 * `action` must already be classified by the caller's own key map (hosts differ:
 * the navigator has no arrow-key map at all, the Redis key browser does). What
 * this adds is the *transition* — the part both trees used to re-implement:
 * which index a step lands on, when a step is suppressed, and when a branch
 * action becomes a plain move.
 */
export function planTreeNavigation<R>(input: TreeNavPlanInput<R>): TreeNavPlan {
  const { rowCount, action, isBranch, isExpanded, isNavigable, clamp } = input;
  if (action === 'select-all' || action === 'refresh' || action === 'clear') {
    return { kind: 'command', action };
  }

  // The single starting point, derived once: a stale `activeIndex` past the end
  // is clamped rather than trusted, and `-1` stays `-1` ("no active row").
  const from = clamp(input.activeIndex);

  if (action === 'next' || action === 'previous') {
    const direction: 1 | -1 = action === 'next' ? 1 : -1;
    const target = input.step(from, direction);
    // A step that leaves the list is not a move — stay put rather than clamp
    // onto the opposite end.
    if (target < 0 || target >= rowCount) return { kind: 'none' };
    const landed = input.nextNavigableIndex(target, direction);
    if (landed < 0) {
      // Nothing navigable that way. Keep the active row if it still exists,
      // otherwise drop selection entirely (its subtree was filtered away).
      return { kind: 'move', action, index: from >= 0 && isNavigable(from) ? from : -1 };
    }
    return { kind: 'move', action, index: landed };
  }

  // expand / fold / activate are row-scoped: they need a row to act on. That
  // row is the active one, and the active one has to be *navigable* — a
  // breadcrumb is painted but is not something ↑/↓ should ever land on, and a
  // row whose subtree was filtered away underneath it is gone. In both cases
  // the keystroke re-seeds the caret onto the first navigable row rather than
  // guessing: moving to "somewhere plausible" is worse than moving to the one
  // row the user can definitely act on.
  //
  // The re-seed moves and stops. It does not then perform the key's own action
  // on the row it just landed on, so Enter on an unfocused tree enters the
  // list instead of opening its first key — pinned by
  // `keyTreeTesterCoverage.test.tsx` ("→ / ← / Enter with no active row enter
  // the list instead of acting on nothing"). Acting on a row the user never
  // chose is the failure mode this guard exists to prevent.
  if (from < 0 || !isNavigable(from)) {
    const first = input.nextNavigableIndex(0, 1);
    return first < 0 ? { kind: 'none' } : { kind: 'move', action, index: first };
  }
  const row = input.rowAt(from);

  if (action === 'expand') {
    if (isBranch(row, from) && !isExpanded(from)) return { kind: 'toggle', action, index: from };
    const child = input.firstChildIndex(from);
    if (child < 0) return { kind: 'none' };
    const landed = input.nextNavigableIndex(child, 1);
    return landed < 0 ? { kind: 'none' } : { kind: 'move', action, index: landed };
  }

  if (action === 'fold') {
    if (isBranch(row, from) && isExpanded(from)) return { kind: 'toggle', action, index: from };
    const parent = input.parentIndexOf(from);
    return parent < 0 ? { kind: 'none' } : { kind: 'move', action, index: parent };
  }

  return { kind: 'activate', action, index: from };
}

/** `true` when the plan is a real destination (`-1` = "drop the active row"). */
export function planMovesTo(plan: TreeNavPlan, index: number): boolean {
  return plan.kind === 'move' && plan.index === index;
}
