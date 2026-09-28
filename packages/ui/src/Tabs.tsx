import { useId, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

/** Per-tab context handed to {@link TabsProps.getTabClassName}. */
export interface TabRenderContext {
  id: string;
  index: number;
  selected: boolean;
}

export interface TabItem {
  id: string;
  label: ReactNode;
  /**
   * Panel body owned by this tab.
   *
   * **Omit it for a bar-only strip.** A mode switcher that owns no panel — the
   * Redis JSON display modes, the key-browser search scope, the server
   * dashboard's view tabs — is the same widget minus the panel, because the
   * panel lives in the parent. Passing `null` to fake one would leave a stray
   * `flex-1` box in the caller's layout, so "no panel" is spelled by leaving the
   * field off and {@link Tabs} then drops the panel element entirely rather than
   * rendering an empty one.
   */
  content?: ReactNode;
  /**
   * Accessible name for tabs whose `label` is not plain text (an icon, an
   * icon-plus-truncating-span). Omit when `label` is already a text node.
   */
  ariaLabel?: string;
  testId?: string;
}

export interface TabsProps {
  items: readonly TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  /**
   * Extra element rendered at the end of the bar (e.g. a "+" button).
   *
   * **Panel mode only.** A bar-only strip renders the tablist as its own root
   * element, so there is no sibling slot to put a trailing control in; adding
   * one would mean a wrapper div, which is the layout constraint bar-only mode
   * exists to avoid. Bar-only callers that need an extra control put it beside
   * the strip themselves.
   */
  trailing?: ReactNode;
  /**
   * The outermost element this component renders. In bar-only mode that *is*
   * the `role="tablist"` element, so `className` and `tabListClassName` both
   * land on the same node there.
   */
  className?: string;
  /** The bar row around the tablist. Panel mode only. */
  barClassName?: string;
  /** The `role="tablist"` element. */
  tabListClassName?: string;
  /** The `role="tabpanel"` element. Panel mode only. */
  panelClassName?: string;
  getTabClassName?: (ctx: TabRenderContext) => string | undefined;
  /**
   * Extra props for the `role="tablist"` element (a scroll handler, data
   * attributes). The shell owns `role` and the ARIA name and applies them
   * after the spread, so a consumer cannot accidentally un-type the tablist;
   * the name belongs in `ariaLabel`.
   */
  tabListProps?: HTMLAttributes<HTMLDivElement>;
  /** Accessible name for the tablist. */
  ariaLabel?: string;
  testId?: string;
}

/**
 * The shared tab widget: one `tablist` / `tab` / `tabpanel` + roving-tabindex +
 * arrow-key mechanism, so the host's view tabs and the drivers' mode switchers
 * stop hand-rolling four copies of it (and stop disagreeing about whether an
 * unselected tab announces itself).
 *
 * Two things here are deliberate, and both look like omissions:
 *
 * 1. **Every tab carries `aria-selected`, `"false"` included.** This is *not*
 *    the leaf rule `treeRowAria` applies to `aria-expanded`. That rule exists
 *    because `aria-expanded` answers "does this node own a child list", and a
 *    `false` on a node with no children claims a disclosure that is not
 *    there. `aria-selected` has no such trap: it answers "is this tab the
 *    current one", and `"false"` is the truthful answer for every tab that is
 *    not. Omitting it would leave assistive tech guessing from styling alone.
 * 2. **`aria-controls` appears only when this component renders the panel.**
 *    A bar-only strip's panel belongs to the caller, so pointing `aria-controls`
 *    at an id nobody renders would be a dangling reference — worse than no
 *    reference at all.
 */
export function Tabs({
  items,
  activeId,
  onChange,
  trailing,
  className,
  barClassName,
  tabListClassName,
  panelClassName,
  getTabClassName,
  tabListProps,
  ariaLabel,
  testId,
}: TabsProps) {
  const panelId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeIndex = items.findIndex((item) => item.id === activeId);
  const hasPanel = items.some((item) => item.content !== undefined);
  // With no id matching, the first item is both the fallback panel body and the
  // tab that stays reachable on Tab.
  const fallbackIndex = activeIndex >= 0 ? activeIndex : 0;
  const active = items[fallbackIndex];
  const tabId = (index: number) => `${panelId}-tab-${index}`;

  const focusTab = (index: number) => {
    const item = items[index];
    if (!item) return;
    tabRefs.current[index]?.focus();
    onChange(item.id);
  };

  // Automatic activation: the arrow keys move focus *and* select, matching the
  // navigator's panel tab bar. These are small local view switches, so the cost
  // of painting the newly selected body is not worth deferring to Enter.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (items.length === 0) return;
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else return;

    event.preventDefault();
    focusTab(nextIndex);
  };

  const tabButtons = items.map((item, index) => {
    const selected = item.id === activeId;
    return (
      <button
        key={item.id}
        ref={(element) => {
          tabRefs.current[index] = element;
        }}
        type="button"
        role="tab"
        id={tabId(index)}
        aria-selected={selected}
        aria-controls={hasPanel ? panelId : undefined}
        aria-label={item.ariaLabel}
        data-testid={item.testId}
        // Roving tabindex: the tablist is one Tab stop, arrows move within it.
        tabIndex={index === fallbackIndex ? 0 : -1}
        className={getTabClassName?.({ id: item.id, index, selected })}
        onClick={() => onChange(item.id)}
        onKeyDown={(event) => handleKeyDown(event, index)}
      >
        {item.label}
      </button>
    );
  });

  // Bar-only: the tablist is the root, so a segmented control keeps the exact
  // box it had when it hand-rolled its own.
  //
  // No layout class is injected here, unlike the panel-mode tablist below: in
  // bar-only mode the caller is the sole owner of the strip's layout, and gets
  // the class attribute back verbatim.
  //
  // (A built-in `flex` would in fact have been harmless — `cn` is
  // `twMerge(clsx(...))`, and twMerge is display-group aware, so a caller's
  // `inline-flex` deterministically displaces a default `flex`. The reason for
  // leaving it out anyway is the API boundary, not collision avoidance: a shell
  // that quietly supplies layout is a shell whose layout every call site has to
  // override to get the box it actually wants. The segmented strips here are
  // the reason that matters — they are `inline-flex` or fixed-height rows, not
  // the default bottom-bordered bar, and they say so themselves.)
  if (!hasPanel) {
    return (
      <div
        {...tabListProps}
        role="tablist"
        aria-label={ariaLabel}
        data-testid={testId}
        className={cn(className, tabListClassName)}
      >
        {tabButtons}
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <div
        className={cn(
          'flex h-10 shrink-0 items-center gap-1 border-b border-edge bg-surface-alt px-2',
          barClassName,
        )}
      >
        {/* Only tabs live in the tablist. `trailing` is a sibling on purpose: a
            "+" button is not a tab, and a tablist that adopts one loses the
            "tablist holds tabs" contract the role asserts. */}
        <div
          {...tabListProps}
          role="tablist"
          aria-label={ariaLabel}
          data-testid={testId}
          className={cn('flex min-w-0 items-center gap-1 overflow-x-auto', tabListClassName)}
        >
          {tabButtons}
        </div>
        {trailing}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(fallbackIndex)}
        className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', panelClassName)}
      >
        {active?.content}
      </div>
    </div>
  );
}
