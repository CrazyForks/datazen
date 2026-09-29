import { describe, expect, it } from 'vitest';
import {
  TREE_TOP_LEVEL,
  ancestorIndexes,
  ariaLevelOf,
  descendantIndexes,
  descendantRange,
  effectiveExpanded,
  firstChildIndex,
  indentOf,
  nextNavigableIndex,
  parentIndexOf,
  rowLevels,
  searchedRowLevels,
  showsSubtree,
  stepIndex,
  type TreeRowLevel,
} from '../index';

/**
 * The two trees in DataZen that paint `role="tree"` rows share this contract.
 * These tests pin the *arithmetic* (what a level is, what a gap between levels
 * means) and the structural scans, so a change that makes the host navigator
 * and the Redis key browser disagree again has to be made here on purpose.
 */

describe('tree geometry: ariaLevelOf is the only level conversion', () => {
  it('adds the 1-based ARIA origin to the painted depth when nothing is hidden', () => {
    expect(TREE_TOP_LEVEL).toBe(1);
    for (let depth = 0; depth < 8; depth++) {
      expect(ariaLevelOf({ depth })).toBe(depth + 1);
    }
  });

  it("prefers the row's own level depth over its painted depth", () => {
    expect(ariaLevelOf({ depth: 3, levelDepth: 2 })).toBe(3);
    expect(ariaLevelOf({ depth: 3, levelDepth: 3 })).toBe(4);
    // A declared level depth is authoritative even when it is *deeper*.
    expect(ariaLevelOf({ depth: 0, levelDepth: 4 })).toBe(5);
  });
});

describe('tree geometry: the search ladder', () => {
  /**
   * Every rung of the navigator ladder, with the depth it is *painted* at
   * outside and inside a search. The searched depth is written out per rung
   * because it is not always the painted one: a search deletes the section
   * header a connection used to sit under, so the connection itself moves up a
   * level while everything below it keeps its indent.
   */
  const RUNGS: { label: string; plain: number; searched: number }[] = [
    { label: 'connection', plain: 1, searched: 0 },
    { label: 'db / kv-db / db-loading (under connection)', plain: 2, searched: 2 },
    { label: 'schema / namespace-node / category (no schema)', plain: 3, searched: 3 },
    { label: 'category (under schema) / table / object (no schema)', plain: 4, searched: 4 },
    { label: 'table / object (under schema)', plain: 5, searched: 5 },
    { label: 'namespace-node (nested)', plain: 6, searched: 6 },
  ];

  /**
   * `CONNECTION_CHILD_DEPTH` — the ladder root, passed in by the caller so the
   * two trees keep their own ladders and only share the arithmetic.
   */
  const CONNECTION_CHILD_DEPTH = 2;

  it('lowers every rung by exactly one level while a search suppresses the header', () => {
    const gaps: string[] = [];
    for (const rung of RUNGS) {
      const plain = ariaLevelOf(searchedRowLevels(rung.plain, CONNECTION_CHILD_DEPTH, false));
      const searched = ariaLevelOf(searchedRowLevels(rung.searched, CONNECTION_CHILD_DEPTH, true));
      if (searched !== plain - 1) {
        gaps.push(`${rung.label}: plain ${plain} -> searched ${searched} (expected ${plain - 1})`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it('announces the connection the search moved up a level as the tree top', () => {
    // A search paints connections at depth 0. Hiding a level there would leave
    // nothing above them to be under, so they stay at level 1.
    const movedUp = searchedRowLevels(0, CONNECTION_CHILD_DEPTH, true);
    expect(movedUp).toEqual({ depth: 0, levelDepth: 0 });
    expect(ariaLevelOf(movedUp)).toBe(1);

    // …while the same row painted under its header announces one level lower.
    expect(ariaLevelOf(searchedRowLevels(1, CONNECTION_CHILD_DEPTH, false))).toBe(2);
  });

  it('leaves the painted depth alone — only the announced level moves', () => {
    for (const rung of RUNGS) {
      expect(searchedRowLevels(rung.searched, CONNECTION_CHILD_DEPTH, true).depth).toBe(
        rung.searched,
      );
    }
  });

  it('moves the whole ladder when the caller moves its root', () => {
    // A root of 0 hides a level under every row, including the top one.
    expect(ariaLevelOf(searchedRowLevels(2, 0, true))).toBe(2);
    // A root above the row leaves it alone.
    expect(ariaLevelOf(searchedRowLevels(2, 5, true))).toBe(3);
  });

  it('never lets an over-counted caller push a row below level 1', () => {
    expect(rowLevels(2, 9)).toEqual({ depth: 2, levelDepth: 0 });
    expect(ariaLevelOf(rowLevels(2, 9))).toBe(1);
    expect(rowLevels(2, -4)).toEqual({ depth: 2, levelDepth: 2 });
  });
});

describe('tree geometry: indentOf', () => {
  it("steps the indent by the caller's unit and clamps a lost parent to the base", () => {
    expect([0, 1, 2, 5].map((d) => indentOf(d, 4, 10))).toEqual([4, 14, 24, 54]);
    expect(indentOf(-2, 4, 10)).toBe(4);
    // The navigator works in rem so the indent follows the user's font size.
    expect(indentOf(2, 0.375, 1)).toBeCloseTo(2.375);
  });
});

describe('tree navigation: expand / collapse visibility', () => {
  it('lets the row own the answer and lets a search override it', () => {
    expect(effectiveExpanded(false, false)).toBe(false);
    expect(effectiveExpanded(true, false)).toBe(true);
    expect(effectiveExpanded(false, true)).toBe(true);
    expect(effectiveExpanded(true, true)).toBe(true);
  });

  it('always shows a terminal row and shows a branch only when it is open', () => {
    // A branch that is collapsed, and one a search forces open. The row at
    // depth 1 here declares no expand state, which reads as collapsed.
    const branch: TreeRowLevel & { hasChildren: boolean; expanded?: boolean } = {
      depth: 1,
      hasChildren: true,
    };
    expect(showsSubtree({ depth: 2, hasChildren: false })).toBe(true);
    expect(showsSubtree(branch)).toBe(false);
    expect(showsSubtree(branch, true)).toBe(true);
    expect(showsSubtree({ ...branch, expanded: true })).toBe(true);
  });
});

describe('tree navigation: descendant queries over a pre-order list', () => {
  const rows: TreeRowLevel[] = [
    { depth: 0 }, // 0 branch
    { depth: 1 }, // 1 branch
    { depth: 2 }, // 2 leaf
    { depth: 2 }, // 3 leaf
    { depth: 1 }, // 4 branch
    { depth: 2 }, // 5 leaf
    { depth: 0 }, // 6 branch
  ];

  it('reads a subtree as the contiguous run of deeper rows that follows', () => {
    expect(descendantRange(rows, 0)).toEqual({ start: 1, end: 6 });
    expect(descendantRange(rows, 1)).toEqual({ start: 2, end: 4 });
    expect(descendantRange(rows, 4)).toEqual({ start: 5, end: 6 });
    // A leaf owns nothing, and a collapsed branch has no rows in the list.
    expect(descendantRange(rows, 2)).toEqual({ start: 3, end: 3 });
    expect(descendantRange(rows, 6)).toEqual({ start: 7, end: 7 });
    expect(descendantRange(rows, 99)).toBeNull();
  });

  it('lists the descendants and folds a sibling away', () => {
    expect(descendantIndexes(rows, 0)).toEqual([1, 2, 3, 4, 5]);
    expect(descendantIndexes(rows, 2)).toEqual([]);
    expect(descendantIndexes(rows, 99)).toEqual([]);
  });
});

describe('tree navigation: ancestors, parents and first children', () => {
  const rows: TreeRowLevel[] = [
    { depth: 0 }, // 0 branch
    { depth: 1 }, // 1 branch
    { depth: 2 }, // 2 leaf
    { depth: 1 }, // 3 branch
    { depth: 2 }, // 4 leaf
    { depth: 0 }, // 5 branch
  ];
  const isBranch = (_row: TreeRowLevel, index: number) =>
    index === 0 || index === 1 || index === 3 || index === 5;

  it('holds the open branch chain, outermost first', () => {
    expect(ancestorIndexes(rows, 0, isBranch)).toEqual([]);
    expect(ancestorIndexes(rows, 1, isBranch)).toEqual([0]);
    expect(ancestorIndexes(rows, 2, isBranch)).toEqual([0, 1]);
    expect(ancestorIndexes(rows, 4, isBranch)).toEqual([0, 3]);
    // Row 5 is a sibling of row 0, so the answer is the chain the list was in
    // on the way there — the question is "what is open here", not "who owns
    // this row".
    expect(ancestorIndexes(rows, 5, isBranch)).toEqual([0, 3]);
  });

  it('leaves the chain open at the end of the list instead of inventing one', () => {
    // A scrolled-past-the-end index has no row of its own, so the chain the
    // last row left open is the answer; a negative index clamps to empty.
    expect(ancestorIndexes(rows, 99, isBranch)).toEqual([5]);
    expect(ancestorIndexes(rows, -4, isBranch)).toEqual([]);
  });

  it('steps to the parent and stays put where there is none', () => {
    expect(parentIndexOf(rows, 2, isBranch)).toBe(1);
    expect(parentIndexOf(rows, 4, isBranch)).toBe(3);
    // A root row cannot fold further; an out-of-range index stays put.
    expect(parentIndexOf(rows, 5, isBranch)).toBe(5);
    expect(parentIndexOf(rows, 99, isBranch)).toBe(99);
  });

  it('steps into a branch that actually has a child row', () => {
    expect(firstChildIndex(rows, 0, isBranch)).toBe(1);
    expect(firstChildIndex(rows, 1, isBranch)).toBe(2);
    // A leaf, and a branch whose children were never emitted, are both -1.
    expect(firstChildIndex(rows, 2, isBranch)).toBe(-1);
    expect(firstChildIndex(rows, 99, isBranch)).toBe(-1);
  });

  it('defaults to a row that declares hasChildren', () => {
    const declared = [
      { depth: 0, hasChildren: true },
      { depth: 1, hasChildren: false },
    ];
    expect(firstChildIndex(declared, 0)).toBe(1);
    expect(firstChildIndex(declared, 1)).toBe(-1);
    expect(showsSubtree(declared[0]!)).toBe(false);
    expect(showsSubtree({ ...declared[0]!, expanded: true })).toBe(true);
  });
});

describe('tree navigation: stepping', () => {
  it('clamps instead of wrapping to the far end of the list', () => {
    expect(stepIndex(-1, 1, 4)).toBe(0);
    expect(stepIndex(-1, -1, 4)).toBe(3);
    expect(stepIndex(0, 1, 4)).toBe(1);
    expect(stepIndex(0, -1, 4)).toBe(0);
    expect(stepIndex(3, 1, 4)).toBe(3);
    expect(stepIndex(2, 1, 0)).toBe(-1);
  });

  it('skips what the caller marked as decoration and reports nowhere to go', () => {
    const navigable = [true, false, false, true];
    const isNavigable = (i: number) => navigable[i] === true;
    expect(nextNavigableIndex(0, 1, 4, isNavigable)).toBe(0);
    expect(nextNavigableIndex(1, 1, 4, isNavigable)).toBe(3);
    expect(nextNavigableIndex(2, -1, 4, isNavigable)).toBe(0);
    // The row the walk starts on counts as navigable, so a step that lands on
    // one stops there instead of skipping past it.
    expect(nextNavigableIndex(3, -1, 4, isNavigable)).toBe(3);
    // A trailing run of decoration must report "nowhere", not the row it
    // skipped past — that is what makes a keystroke that cannot act stay put.
    expect(nextNavigableIndex(4, 1, 4, isNavigable)).toBe(-1);
    expect(nextNavigableIndex(0, -1, 4, () => false)).toBe(-1);
  });
});
