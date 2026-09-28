/**
 * The shared tab widget's ARIA + keyboard contract.
 *
 * These are the assertions that make the three converged strips (the server
 * dashboard's view tabs, the Redis JSON display modes, the key-browser search
 * scope) safe to delegate their tab semantics to `@datazen/ui`'s `Tabs`. If any
 * of them is deleted or weakened, the delegation is no longer paying for
 * itself — the whole point of the shell is that one place owns the role, the
 * selection state and the arrow keys.
 *
 * The `aria-selected` test is deliberately an *attribute* assertion rather than
 * a "is selected" helper: a tab that simply dropped the attribute would still
 * look unselected to a role query, and the regression this guards is exactly
 * that quiet disappearance.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tabs, type TabItem } from '../Tabs';

afterEach(cleanup);

const ITEMS: TabItem[] = [
  { id: 'alpha', label: 'Alpha' },
  { id: 'beta', label: 'Beta' },
  { id: 'gamma', label: 'Gamma' },
];

function renderTabs(overrides: Partial<React.ComponentProps<typeof Tabs>> = {}) {
  const onChange = vi.fn();
  render(
    <Tabs items={ITEMS} activeId="alpha" onChange={onChange} ariaLabel="Views" {...overrides} />,
  );
  return { onChange, tabs: screen.getAllByRole('tab') };
}

describe('Tabs — roles and naming', () => {
  it('exposes a named tablist holding one tab per item', () => {
    const { tabs } = renderTabs();
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument();
    expect(tabs).toHaveLength(ITEMS.length);
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('keeps role="tablist" even when a consumer spreads a conflicting role', () => {
    // The shell owns the role and applies it after the spread, the same way
    // `VirtualTree` does for `role="tree"`: a consumer cannot un-type the
    // widget it delegates to.
    render(
      <Tabs
        items={ITEMS}
        activeId="alpha"
        onChange={vi.fn()}
        ariaLabel="Views"
        tabListProps={{ role: 'listbox' }}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Tabs — selection state', () => {
  it('marks the active tab true and every other tab "false" by attribute', () => {
    const { tabs } = renderTabs();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    // "false", not absent: `aria-selected` describes which tab is current, so
    // there is a truthful answer for every tab. (This is deliberately *not* the
    // leaf rule `treeRowAria` applies to `aria-expanded`, where `false` would
    // claim a child list that does not exist.)
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('follows activeId when the selection moves', () => {
    const { tabs } = renderTabs({ activeId: 'gamma' });
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
    ]);
  });

  it('reports a click on an unselected tab', () => {
    const { onChange, tabs } = renderTabs();
    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenCalledWith('beta');
  });
});

describe('Tabs — roving tabindex', () => {
  it('keeps the whole tablist at a single tab stop', () => {
    const { tabs } = renderTabs();
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('moves the tab stop with the selection', () => {
    const { tabs } = renderTabs({ activeId: 'beta' });
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('still leaves one tab stop reachable when no id matches', () => {
    const { tabs } = renderTabs({ activeId: 'nope' });
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });
});

describe('Tabs — keyboard navigation', () => {
  it('ArrowRight moves focus and selection, wrapping past the last tab', () => {
    const { onChange, tabs } = renderTabs({ activeId: 'gamma' });
    fireEvent.keyDown(tabs[2], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    expect(onChange).toHaveBeenCalledWith('alpha');
  });

  it('ArrowLeft moves focus and selection, wrapping before the first tab', () => {
    const { onChange, tabs } = renderTabs();
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2]);
    expect(onChange).toHaveBeenCalledWith('gamma');
  });

  it('Home and End jump to the first and last tab', () => {
    const { onChange, tabs } = renderTabs();
    fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('gamma');
    fireEvent.keyDown(tabs[2], { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('alpha');
  });

  it('leaves keys it does not own to the browser', () => {
    const { onChange, tabs } = renderTabs();
    // `fireEvent` returns false when a handler called preventDefault().
    expect(fireEvent.keyDown(tabs[0], { key: 'a' })).toBe(true);
    expect(fireEvent.keyDown(tabs[0], { key: 'Enter' })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Tabs — panel wiring', () => {
  const PANEL_ITEMS: TabItem[] = [
    { id: 'alpha', label: 'Alpha', content: 'alpha body' },
    { id: 'beta', label: 'Beta', content: 'beta body' },
  ];

  it('points each tab at the panel it renders and labels the panel from the active tab', () => {
    render(<Tabs items={PANEL_ITEMS} activeId="beta" onChange={vi.fn()} ariaLabel="Views" />);
    const tabs = screen.getAllByRole('tab');
    const panel = screen.getByRole('tabpanel');
    expect(tabs[1]).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[1].id);
    expect(panel.textContent).toBe('beta body');
  });

  it('emits no aria-controls on a bar-only strip', () => {
    // The panel belongs to the caller, so there is no id to point at. A dangling
    // reference would be worse than none.
    const { tabs } = renderTabs();
    tabs.forEach((tab) => expect(tab).not.toHaveAttribute('aria-controls'));
    expect(screen.queryByRole('tabpanel')).toBeNull();
  });

  it('falls back to the first panel when no id matches', () => {
    render(<Tabs items={PANEL_ITEMS} activeId="missing" onChange={vi.fn()} ariaLabel="Views" />);
    expect(screen.getByRole('tabpanel').textContent).toBe('alpha body');
  });
});

describe('Tabs — composition', () => {
  it('renders trailing outside the tablist', () => {
    // A "+" button is not a tab; a tablist that adopts one breaks the
    // "tablist holds tabs" contract the role asserts.
    render(
      <Tabs
        items={[
          { id: 'alpha', label: 'Alpha', content: 'alpha body' },
          { id: 'beta', label: 'Beta', content: 'beta body' },
        ]}
        activeId="alpha"
        onChange={vi.fn()}
        ariaLabel="Views"
        trailing={<button type="button">Add</button>}
      />,
    );
    const tablist = screen.getByRole('tablist');
    const add = screen.getByRole('button', { name: 'Add' });
    expect(tablist.contains(add)).toBe(false);
  });

  it('leaves a bar-only strip layout entirely to the caller', () => {
    // The segmented strips are `inline-flex`. A built-in `flex` default would
    // collide with it, and the winner is decided by stylesheet order rather than
    // class-attribute order — so bar-only mode injects nothing of its own.
    render(
      <Tabs
        items={ITEMS}
        activeId="alpha"
        onChange={vi.fn()}
        className="inline-flex items-center gap-1 rounded-md border border-edge p-0.5"
      />,
    );
    expect(screen.getByRole('tablist').getAttribute('class')).toBe(
      'inline-flex items-center gap-1 rounded-md border border-edge p-0.5',
    );
  });
});
