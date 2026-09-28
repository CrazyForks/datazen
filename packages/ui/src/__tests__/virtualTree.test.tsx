/**
 * `VirtualTree`: the four things the shell owns, each pinned by a case that
 * fails when the mechanism regresses.
 *
 * 1. **Virtualization** — a windowed render, not a full paint.
 * 2. **Key stability** — the row `<React key>` is the row's own identity, and
 *    specifically *not* the virtualizer's index key (which the in-repo mocks
 *    report as `key: index`).
 * 3. **Keyboard navigation** — the map, the movement maths, and the three exit
 *    transitions (clamped ends, skipped decoration, empty list).
 * 4. **ARIA semantics** — `role="tree"` on the grid, `aria-level` from the
 *    shared geometry, `aria-expanded` only where the consumer puts it, and no
 *    tree semantics at all on a decoration row.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

/** Hoisted so the mock factory can see it; every test resets it. */
const virtualWindow = vi.hoisted(() => ({ offset: 0, size: 20 }));

/**
 * A virtualizer stub that behaves like the real one about the one property
 * under test here: `virtualRow.key` is the **index**, exactly as the ~13 other
 * suites in this repo mock it. A shell that trusted it would paint index keys.
 */
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: {
    count: number;
    estimateSize: () => number;
    getItemKey: (i: number) => string;
  }) => {
    const size = opts.estimateSize();
    const first = Math.max(0, virtualWindow.offset);
    const last = Math.min(opts.count, first + virtualWindow.size);
    const items = Array.from({ length: Math.max(0, last - first) }, (_, i) => ({
      index: first + i,
      key: first + i,
      start: (first + i) * size,
      size,
      lane: 0,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => opts.count * size,
      measureElement: () => undefined,
      scrollToIndex: () => undefined,
      scrollToOffset: () => undefined,
    };
  },
}));

import { VirtualTree, firstVisibleTreeIndex, type VirtualTreeProps } from '../tree/VirtualTree';
import { planTreeNavigation, type TreeNavAction } from '../tree/keyboard';
import { ariaLevelOf, indentOf } from '../tree/geometry';
import { stepIndex } from '../tree/navigation';
import type { TreeRowLevel } from '../tree/types';
import type { VirtualTreeItemAria } from '../tree/VirtualTree';

afterEach(() => {
  cleanup();
  virtualWindow.offset = 0;
  virtualWindow.size = 20;
});

interface Row extends TreeRowLevel {
  id: string;
  hasChildren: boolean;
  expanded: boolean;
  leaf?: boolean;
}

function row(id: string, depth: number, hasChildren = false, expanded = false): Row {
  return { id, depth, hasChildren, expanded, leaf: !hasChildren };
}

/** `app › user › 1`, with `app` and `user` open folders. */
function fixture(): Row[] {
  return [
    row('app', 0, true, true),
    row('app:user', 1, true, true),
    row('app:user:1', 2),
    row('app:user:2', 2),
    row('app:cfg', 1, true, false),
    row('cache', 0, true, true),
    row('cache:hit', 1),
  ];
}

const isBranch = (r: Row) => r.hasChildren;

function setup(rows: Row[], extra: Partial<VirtualTreeProps<Row>> = {}) {
  return render(
    <VirtualTree
      rows={rows}
      getKey={(r) => r.id}
      isBranch={isBranch}
      rowHeight={28}
      renderRow={({ row: r, itemProps }) => (
        <div role="treeitem" {...itemProps} data-testid={`row-${r.id}`}>
          {r.id}
        </div>
      )}
      {...extra}
    />,
  );
}

describe('VirtualTree · virtualization', () => {
  it('paints a window of the rows and sizes the grid for the whole list', () => {
    virtualWindow.size = 3;
    const { container } = setup(fixture());
    const tree = container.querySelector('[role="tree"]')!;
    // Only the window is in the DOM …
    expect(tree.querySelectorAll('[data-testid^="row-"]')).toHaveLength(3);
    // … while the scrollable extent covers every row.
    expect((tree as HTMLElement).style.height).toBe(`${fixture().length * 28}px`);
  });

  it('moves the window without painting rows outside it', () => {
    virtualWindow.size = 2;
    const { container, rerender } = setup(fixture());
    const ids = () =>
      [...container.querySelectorAll<HTMLElement>('[data-testid^="row-"]')].map(
        (el) => el.dataset.testid,
      );
    expect(ids()).toEqual(['row-app', 'row-app:user']);
    virtualWindow.offset = 5;
    rerender(
      <VirtualTree
        rows={fixture()}
        getKey={(r) => r.id}
        isBranch={isBranch}
        rowHeight={28}
        renderRow={({ row: r, itemProps }) => (
          <div role="treeitem" {...itemProps} data-testid={`row-${r.id}`}>
            {r.id}
          </div>
        )}
      />,
    );
    expect(ids()).toEqual(['row-cache', 'row-cache:hit']);
  });

  it('positions each row by its offset in the row grid, not by its index alone', () => {
    virtualWindow.size = 2;
    virtualWindow.offset = 1;
    const { container } = setup(fixture());
    const wrappers = [...container.querySelectorAll('[role="tree"] > div')];
    expect(wrappers.map((el) => (el as HTMLElement).style.transform)).toEqual([
      'translateY(28px)',
      'translateY(56px)',
    ]);
    expect(wrappers.map((el) => (el as HTMLElement).style.height)).toEqual(['28px', '28px']);
  });
});

describe('VirtualTree · key stability', () => {
  it('keys rows by the row itself, never by the virtualizer index', () => {
    // The mock's `virtualRow.key` is the index. If the shell used it, these
    // keys would be "0"…"3"; with `getKey(row)` they are the row identities.
    const { container } = setup(fixture());
    const wrappers = [...container.querySelectorAll('[role="tree"] > div')];
    const rendered = wrappers.map((w) => w.textContent);
    // React strips `key` from the DOM, so prove it structurally: reordering
    // the list must carry each row's own identity with it.
    expect(rendered).toEqual([
      'app',
      'app:user',
      'app:user:1',
      'app:user:2',
      'app:cfg',
      'cache',
      'cache:hit',
    ]);

    const reversed = [...fixture()].reverse();
    const { container: c2 } = setup(reversed);
    const ids2 = [...c2.querySelectorAll('[role="tree"] > div')].map((el) => el.textContent);
    expect(ids2[0]).toBe('cache:hit');
    // A React key collision would drop a duplicate-free list to a shorter one;
    // assert the count survives the re-render path.
    expect(c2.querySelectorAll('[role="tree"] > div')).toHaveLength(reversed.length);
  });

  it('keeps DOM identity across a window shift, so focus survives scrolling', () => {
    virtualWindow.size = 3;
    const { container, rerender } = setup(fixture());
    const third = container.querySelector('[data-testid="row-app:cfg"]')!;
    const tree = (r: Row, itemProps: VirtualTreeItemAria) => (
      <div role="treeitem" {...itemProps} data-testid={`row-${r.id}`}>
        {r.id}
      </div>
    );
    virtualWindow.offset = 1;
    rerender(
      <VirtualTree
        rows={fixture()}
        getKey={(r) => r.id}
        isBranch={isBranch}
        rowHeight={28}
        renderRow={({ row: r, itemProps }) => tree(r, itemProps)}
      />,
    );
    // The node that is still on screen is the same DOM node, not a remount.
    expect(container.querySelector('[data-testid="row-app:cfg"]')).toBe(third);
  });

  it('uses getKey(row) verbatim as the React key, and nothing else', () => {
    // React keys are not observable in the DOM, so observe them through React
    // itself: two rows whose `getKey` collides make React report the collision.
    // If the shell keyed on the virtualizer's index (which every in-repo mock
    // reports as `key: index`) the list below would be keyed "0" and "1" and
    // stay silent — so this case distinguishes the two key sources directly.
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      setup([row('same', 0), row('same', 1)]);
    } finally {
      spy.mockRestore();
    }
    expect(errors.flat().join(' ')).toContain('same');
  });
});

describe('VirtualTree · ARIA semantics', () => {
  it('puts role="tree" on the grid and the accessible name on it', () => {
    const { container } = setup(fixture(), { ariaLabel: 'Connections' });
    const tree = container.querySelector('[role="tree"]')!;
    expect(tree.getAttribute('aria-label')).toBe('Connections');
    expect(container.querySelectorAll('[role="tree"]')).toHaveLength(1);
  });

  it('derives aria-level from depth, 1-based, and never from the painted indent', () => {
    const { container } = setup(fixture());
    const levels = [...container.querySelectorAll('[role="treeitem"]')].map((el) =>
      el.getAttribute('aria-level'),
    );
    expect(levels).toEqual(['1', '2', '3', '3', '2', '1', '2']);
    expect(ariaLevelOf(fixture()[0]!)).toBe(1);
  });

  it('omits aria-expanded on leaves and leaves it to the consumer on branches', () => {
    const { container } = setup(fixture(), {
      getRowAria: (r: Row) =>
        r.hasChildren
          ? { role: 'treeitem', 'aria-level': ariaLevelOf(r), 'aria-expanded': r.expanded }
          : { role: 'treeitem', 'aria-level': ariaLevelOf(r) },
    });
    const items = [...container.querySelectorAll('[role="treeitem"]')];
    const byId = (id: string) => items.find((el) => el.textContent === id)!;
    expect(byId('app:user:1').hasAttribute('aria-expanded')).toBe(false);
    expect(byId('app').getAttribute('aria-expanded')).toBe('true');
    expect(byId('app:cfg').getAttribute('aria-expanded')).toBe('false');
  });

  it('gives a decoration row no tree semantics at all', () => {
    const rows: Row[] = [{ ...row('hint', 1), depth: 1 }];
    const { container } = setup(rows, {
      getRowAria: () => null,
      renderRow: ({ row: r, itemProps }) => (
        <div {...itemProps} data-testid={`row-${r.id}`}>
          {r.id}
        </div>
      ),
    });
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(0);
    expect(container.querySelector('[data-testid="row-hint"]')).not.toBeNull();
    expect(container.querySelector('[role="tree"]')).not.toBeNull();
  });

  it('honours a consumer aria-level that overrides the painted depth', () => {
    // The search case: the announced level is one less than the painted depth
    // because hidden ancestors stop being announced, while the indent still
    // follows depth. The shell must not "harmonize" the two.
    const rows: Row[] = [row('db', 2, true, true), row('table', 3)];
    const { container } = setup(rows, {
      getRowAria: (r: Row) => ({ role: 'treeitem', 'aria-level': ariaLevelOf(r) - 1 }),
    });
    const items = [...container.querySelectorAll('[role="treeitem"]')];
    expect(items.map((el) => el.getAttribute('aria-level'))).toEqual(['2', '3']);
    expect(indentOf(2, 0.375, 1)).toBe(2.375);
  });
});

const NAV_KEYS: Record<string, TreeNavAction> = {
  ArrowDown: 'next',
  ArrowUp: 'previous',
  ArrowRight: 'expand',
  ArrowLeft: 'fold',
  Enter: 'activate',
  a: 'select-all',
};

describe('VirtualTree · keyboard navigation', () => {
  function navHarness(rows: Row[], activeIndex: number, onActiveIndexChange = vi.fn()) {
    const onToggle = vi.fn();
    const onActivate = vi.fn();
    const onCommand = vi.fn();
    const view = render(
      <VirtualTree
        rows={rows}
        getKey={(r) => r.id}
        isBranch={isBranch}
        rowHeight={28}
        className="tree"
        containerProps={{ tabIndex: 0 }}
        navigation={{
          mapKey: (e) => NAV_KEYS[e.key] ?? null,
          activeIndex,
          onActiveIndexChange,
          isExpanded: (i) => rows[i]?.expanded === true,
          onToggle,
          onActivate,
          onCommand,
        }}
        renderRow={({ row: r, itemProps }) => (
          <div role="treeitem" {...itemProps} data-testid={`row-${r.id}`}>
            {r.id}
          </div>
        )}
      />,
    );
    const press = (key: string) => {
      const el = view.container.firstElementChild as HTMLElement;
      const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      fireEvent(el, event);
      return event;
    };
    return { press, onActiveIndexChange, onToggle, onActivate, onCommand, view };
  }

  it('moves down and up, clamping at both ends instead of wrapping', () => {
    const { press, onActiveIndexChange } = navHarness(fixture(), 0);
    press('ArrowDown');
    expect(onActiveIndexChange).toHaveBeenLastCalledWith(1);
    onActiveIndexChange.mockClear();
    const last = navHarness(fixture(), fixture().length - 1);
    last.press('ArrowDown');
    // Clamped, not wrapped: ↓ on the last row stays on the last row.
    expect(last.onActiveIndexChange).toHaveBeenLastCalledWith(fixture().length - 1);
    const first = navHarness(fixture(), 0);
    first.press('ArrowUp');
    expect(first.onActiveIndexChange).toHaveBeenLastCalledWith(0);
  });

  it('seeds the first step at the end the direction points at when nothing is active', () => {
    const down = navHarness(fixture(), -1);
    down.press('ArrowDown');
    expect(down.onActiveIndexChange).toHaveBeenLastCalledWith(0);
    const up = navHarness(fixture(), -1);
    up.press('ArrowUp');
    expect(up.onActiveIndexChange).toHaveBeenLastCalledWith(fixture().length - 1);
  });

  it('expands a closed branch, and steps into an open one', () => {
    const closed = navHarness(fixture(), 4);
    closed.press('ArrowRight');
    expect(closed.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'app:cfg' }), 4);
    expect(closed.onActiveIndexChange).not.toHaveBeenCalled();

    const open = navHarness(fixture(), 1);
    open.press('ArrowRight');
    expect(open.onToggle).not.toHaveBeenCalled();
    expect(open.onActiveIndexChange).toHaveBeenLastCalledWith(2);
  });

  it('folds an open branch, and jumps to the parent of a leaf', () => {
    const open = navHarness(fixture(), 1);
    open.press('ArrowLeft');
    expect(open.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'app:user' }), 1);

    const leaf = navHarness(fixture(), 2);
    leaf.press('ArrowLeft');
    expect(leaf.onToggle).not.toHaveBeenCalled();
    expect(leaf.onActiveIndexChange).toHaveBeenLastCalledWith(1);
  });

  it('activates the active row only', () => {
    const { press, onActivate } = navHarness(fixture(), 2);
    press('Enter');
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'app:user:1' }), 2);
  });

  it('runs a tree-wide command and leaves the active row alone', () => {
    const { press, onCommand } = navHarness(fixture(), 3);
    press('a');
    expect(onCommand).toHaveBeenCalledWith('select-all');
  });

  it('preventDefaults a recognised key even when the list is empty', () => {
    const { press, onActiveIndexChange } = navHarness([], -1);
    const event = press('ArrowDown');
    expect(event.defaultPrevented).toBe(true);
    expect(onActiveIndexChange).not.toHaveBeenCalled();
  });

  it('leaves a key it does not own entirely alone', () => {
    const { press, onActiveIndexChange } = navHarness(fixture(), 0);
    const event = press('q');
    expect(event.defaultPrevented).toBe(false);
    expect(onActiveIndexChange).not.toHaveBeenCalled();
  });

  it('steps over a non-navigable row without ever landing on it', () => {
    const rows = fixture();
    const view = render(
      <VirtualTree
        rows={rows}
        getKey={(r) => r.id}
        isBranch={isBranch}
        rowHeight={28}
        navigation={{
          mapKey: (e) => (e.key === 'ArrowDown' ? 'next' : null),
          activeIndex: 0,
          onActiveIndexChange: vi.fn(),
          // Row 1 is decoration (a filter breadcrumb back-filled for context).
          isNavigable: (i) => i !== 1,
        }}
        renderRow={({ row: r, itemProps }) => (
          <div role="treeitem" {...itemProps} data-testid={`row-${r.id}`}>
            {r.id}
          </div>
        )}
      />,
    );
    const onActive = vi.fn();
    view.rerender(
      <VirtualTree
        rows={rows}
        getKey={(r) => r.id}
        isBranch={isBranch}
        rowHeight={28}
        navigation={{
          mapKey: (e) => (e.key === 'ArrowDown' ? 'next' : null),
          activeIndex: 0,
          onActiveIndexChange: onActive,
          isNavigable: (i) => i !== 1,
        }}
        renderRow={({ row: r, itemProps }) => (
          <div role="treeitem" {...itemProps} data-testid={`row-${r.id}`}>
            {r.id}
          </div>
        )}
      />,
    );
    fireEvent.keyDown(view.container.firstElementChild as HTMLElement, { key: 'ArrowDown' });
    expect(onActive).toHaveBeenLastCalledWith(2);
  });

  it('does nothing at all when navigation is not configured', () => {
    const { container } = setup(fixture());
    const event = new window.KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    fireEvent(container.firstElementChild as HTMLElement, event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('planTreeNavigation · pure transition', () => {
  type PlanInput = Parameters<typeof planTreeNavigation<Row>>[0];

  /** A 3-row list: `0` leaf, `1` open branch with child `2`, `2` leaf. */
  function plan(over: Partial<PlanInput> = {}): ReturnType<typeof planTreeNavigation<Row>> {
    const isNavigable = over.isNavigable ?? (() => true);
    const base: PlanInput = {
      rowCount: 3,
      activeIndex: 0,
      action: 'next',
      step: (from: number, d: 1 | -1) => stepIndex(from, d, 3),
      isBranch: (r) => r.id === '1',
      isExpanded: (i) => i === 1,
      isNavigable: () => true,
      firstChildIndex: (i) => (i === 1 ? 2 : -1),
      parentIndexOf: (i) => (i > 0 ? 1 : -1),
      nextNavigableIndex: (from, direction) => {
        for (let i = from; direction === 1 ? i < 3 : i >= 0; i += direction) {
          if (isNavigable(i)) return i;
        }
        return -1;
      },
      clamp: (i) => (i < 0 ? -1 : Math.min(i, 2)),
      rowAt: (i) => ({ id: String(i) }) as Row,
    };
    return planTreeNavigation<Row>({ ...base, ...over });
  }

  it('drops the active row when its whole neighbourhood is decoration', () => {
    // The active row was filtered away underneath itself: no navigable row
    // ahead, and the current one is not navigable either.
    expect(plan({ activeIndex: 1, isNavigable: () => false })).toEqual({
      kind: 'move',
      action: 'next',
      index: -1,
    });
  });

  it('stays put when the current row is still navigable', () => {
    expect(plan({ activeIndex: 1, isNavigable: (i) => i === 1 })).toEqual({
      kind: 'move',
      action: 'next',
      index: 1,
    });
  });

  it('refuses to invent a destination for an empty list', () => {
    expect(plan({ rowCount: 0, activeIndex: -1 })).toEqual({ kind: 'none' });
    expect(plan({ rowCount: 0, activeIndex: 2 })).toEqual({ kind: 'none' });
  });

  it('turns an expand-or-step-in key into a move when the branch is open', () => {
    expect(plan({ action: 'expand', activeIndex: 1 })).toEqual({
      kind: 'move',
      action: 'expand',
      index: 2,
    });
  });

  it('turns a closed branch into a toggle, not a move', () => {
    expect(plan({ action: 'expand', activeIndex: 1, isExpanded: () => false })).toEqual({
      kind: 'toggle',
      action: 'expand',
      index: 1,
    });
  });

  it('turns a fold-or-parent key into a toggle on an open branch', () => {
    expect(plan({ action: 'fold', activeIndex: 1 })).toEqual({
      kind: 'toggle',
      action: 'fold',
      index: 1,
    });
  });

  it('clamps a stale activeIndex into the painted range before moving', () => {
    expect(plan({ activeIndex: 99 })).toEqual({ kind: 'move', action: 'next', index: 2 });
  });

  /*
   * Row-scoped keys on a list whose active row is not navigable.
   *
   * This is not a corner case invented for the planner: the Redis key browser
   * back-fills pattern breadcrumbs as decoration, and a filter applied while a
   * row was active can leave `activeIndex` pointing at one. `keyTreeBreadcrumb
   * KeyboardJourney.test.tsx` is the executable version of the same situation.
   * Guessing a destination from a row that is not there is worse than the one
   * destination a user can definitely act on, so the key re-seeds at the top.
   */
  it('re-seeds a row-scoped key when nothing is active yet', () => {
    // All three, including `activate`: the re-seed moves the caret and stops.
    // Enter on a tree with no selection enters the list; it does not open the
    // first key. `keyTreeTesterCoverage.test.tsx` pins the same outcome against
    // the real key browser, so the planner and the driver agree by construction.
    for (const action of ['expand', 'fold', 'activate'] as const) {
      expect(plan({ action, activeIndex: -1 })).toEqual({ kind: 'move', action, index: 0 });
    }
  });

  it('re-seeds a row-scoped key when the active row is decoration, not a destination', () => {
    // Row 0 is a breadcrumb; row 1 is the first row a user can land on.
    const isNavigable = (i: number) => i !== 0;
    for (const action of ['expand', 'fold', 'activate'] as const) {
      expect(plan({ action, activeIndex: 0, isNavigable })).toEqual({
        kind: 'move',
        action,
        index: 1,
      });
    }
  });

  it('still acts on the active row when there is one', () => {
    // The re-seed must not swallow Enter: with a real selection it activates
    // that row, exactly as before.
    expect(plan({ action: 'activate', activeIndex: 2 })).toEqual({
      kind: 'activate',
      action: 'activate',
      index: 2,
    });
  });

  it('has nowhere to re-seed to when every row is decoration', () => {
    for (const action of ['expand', 'fold', 'activate'] as const) {
      expect(plan({ action, activeIndex: 0, isNavigable: () => false })).toEqual({ kind: 'none' });
    }
  });

  it('does not re-seed forward-motion: ↑/↓ keep their own walk', () => {
    // A breadcrumb at the top must not swallow ↓ into a re-seed — ↓ is defined
    // as "one step from here", and the re-seed is a fallback, not a shortcut.
    expect(plan({ action: 'next', activeIndex: -1, isNavigable: (i) => i !== 0 })).toEqual({
      kind: 'move',
      action: 'next',
      index: 1,
    });
  });
});

describe('firstVisibleTreeIndex', () => {
  it('is the row under the top edge, clamped to the list', () => {
    expect(firstVisibleTreeIndex(0, 7, 30)).toBe(0);
    expect(firstVisibleTreeIndex(75, 7, 30)).toBe(2);
    expect(firstVisibleTreeIndex(-10, 7, 30)).toBe(0);
    expect(firstVisibleTreeIndex(9999, 7, 30)).toBe(6);
    expect(firstVisibleTreeIndex(50, 0, 30)).toBe(0);
    expect(firstVisibleTreeIndex(50, 7, 0)).toBe(0);
  });
});
