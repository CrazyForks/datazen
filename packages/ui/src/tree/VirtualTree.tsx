import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../cn';
import { ariaLevelOf } from './geometry';
import type { TreeRowLevel } from './types';
import {
  ancestorIndexes,
  firstChildIndex,
  nextNavigableIndex,
  parentIndexOf,
  stepIndex,
  type BranchProbe,
} from './navigation';
import { planTreeNavigation, type TreeKeyEventLike, type TreeNavAction } from './keyboard';

/**
 * Shared virtualization + ARIA shell for every tree surface in the app.
 *
 * ## Why it exists
 *
 * The host connection navigator and the Redis key browser are two completely
 * different trees — different row models, different row heights, different
 * keyboard maps, only one of them with pinned group headers — yet both
 * hand-rolled the same four things: a virtualizer, a `role="tree"` container,
 * a row `<React key>` scheme, and "keep the active row in the viewport". Each
 * hand-rolled copy was a chance to get key stability wrong, and one of them did
 * (see the key contract below).
 *
 * ## The boundary
 *
 * The shell owns the *mechanism*, never the meaning:
 *
 * | Owned by the shell | Owned by the consumer (row model + business) |
 * | --- | --- |
 * | windowing / row measurement | what a row **is** (`rows`) |
 * | the `role="tree"` container and its accessible name | what a row looks like (`renderRow`) |
 * | the stable React key (`getKey`) | whether a row is a branch / expanded |
 * | the key→action map and the movement maths | the `activeIndex` state itself |
 * | scrolling the active row into view | which keys mean what (`navigation.mapKey`) |
 * | the pinned-header overlay geometry | how pinned headers are drawn |
 *
 * Nothing here imports a host store, a driver SDK or an i18n domain, so
 * `packages/ui` stays free of all three — and a driver can have a real ARIA
 * tree without forking the design system.
 *
 * ## The key contract (read this before touching `getKey`)
 *
 * `getKey` takes **only the row**; there is deliberately no index parameter, so
 * a position-derived key cannot even be written, let alone shipped. Under a
 * virtualizer an index is not an identity: scroll one row out of the window and
 * every row after it changes index, so an index key remounts — losing focus,
 * scroll-into-view and in-flight transitions — a suffix of the list on every
 * scroll frame. A key is therefore derived from **what the row is**: its
 * connection id, its redis key, its `(connectionId, dbName, kind, name)`
 * tuple. It must stay stable while the row is on screen, including across the
 * re-sorts and re-filterings a live tree performs.
 *
 * The shell uses `getKey(row)` for the React key on the positioned wrapper and
 * *never* `virtualRow.key`: several suites mock `@tanstack/react-virtual` with
 * `key: index`, and trusting the virtualizer's key there would smuggle an index
 * identity straight back in. That exact mistake is pinned by
 * `packages/ui/src/__tests__/virtualTree.test.tsx`.
 */

/** ARIA attributes a row contributes to the element that owns `role="treeitem"`. */
export interface VirtualTreeItemAria {
  role?: 'treeitem';
  'aria-level'?: number;
  'aria-expanded'?: boolean;
  [attribute: `aria-${string}`]: string | number | boolean | undefined;
}

/**
 * Per-row render context.
 *
 * `itemProps` is spread onto the element the consumer renders: the shell
 * computes it, but the element — and therefore the DOM shape — stays the
 * consumer's, so an existing `<button role="treeitem">` keeps working
 * untouched. Spread it at the position where `role` / `aria-level` /
 * `aria-expanded` already sat, so attribute order (and any `outerHTML`
 * assertion) does not move.
 */
export interface VirtualTreeRowContext<R> {
  row: R;
  index: number;
  /** `{}` for a decoration row — see {@link VirtualTreeProps.getRowAria}. */
  itemProps: VirtualTreeItemAria;
  /** `true` when the row owns a child list (branch probe result). */
  isBranch: boolean;
  /** Painted offset of this row inside the row grid, in pixels. */
  start: number;
  size: number;
}

/** Opt-in keyboard map. Omit `navigation` and the tree takes no keys at all. */
export interface VirtualTreeNavigation<R> {
  /**
   * Classify a key press. Return `null` when the key belongs to somebody else
   * (a text input, the browser) — the shell then neither handles nor
   * `preventDefault`s it.
   */
  mapKey: (event: TreeKeyEventLike) => TreeNavAction | null;
  /** Controlled active row; `-1` means "no active row". */
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  /** Rows a keyboard user may land on. Default: every row. */
  isNavigable?: (index: number) => boolean;
  isExpanded?: (index: number) => boolean;
  onToggle?: (row: R, index: number) => void;
  onActivate?: (row: R, index: number) => void;
  onCommand?: (action: Extract<TreeNavAction, 'select-all' | 'refresh' | 'clear'>) => void;
}

export interface VirtualTreeOverlayContext {
  /** Ancestor rows of the topmost visible row, outermost first. */
  stickyIndexes: number[];
  /** Current scroll offset — pin the overlay at exactly this offset. */
  scrollTop: number;
}

export interface VirtualTreeProps<R extends TreeRowLevel> {
  /** Flat pre-order row list. Its length is the virtualizer's `count`. */
  rows: readonly R[];
  /**
   * Stable identity for a row. **No index parameter on purpose** — see the key
   * contract above.
   */
  getKey: (row: R) => string;
  renderRow: (ctx: VirtualTreeRowContext<R>) => ReactNode;
  /**
   * Row-scoped ARIA override. Omitted ⇒ `{ 'aria-level': ariaLevelOf(row) }`;
   * returning `null` ⇒ the row is decoration and gets **no** tree semantics
   * (an "empty group" hint, a filter breadcrumb).
   *
   * `aria-expanded` is never defaulted: "does this row own a child list" is
   * row-model knowledge, and a leaf that grows `aria-expanded="false"` tells a
   * screen reader it has children it does not have.
   */
  getRowAria?: (row: R, index: number) => VirtualTreeItemAria | null | undefined;
  isBranch?: BranchProbe<R>;
  /** Uniform row height in pixels. */
  rowHeight: number;
  overscan?: number;
  /** Scroll container class. */
  className?: string;
  /**
   * Extra props on the scroll container (drag handlers, data attributes).
   *
   * Pass a **function** when an attribute has to track the scroll position —
   * the pinned-header depth a tree publishes as `data-sticky-depth`, say. The
   * shell owns `scrollTop` (it has to, to place the overlay), so a consumer
   * cannot read it any other way; handing the context back here is what keeps
   * that state from having to be duplicated per tree. A function also switches
   * scroll tracking on, exactly like {@link renderOverlay} does.
   */
  containerProps?:
    | HTMLAttributes<HTMLDivElement>
    | ((ctx: VirtualTreeOverlayContext) => HTMLAttributes<HTMLDivElement>);
  /**
   * Extra props on the `role="tree"` grid (e.g. `data-row-count`). The shell
   * owns `role` and the ARIA name and applies them after the spread.
   */
  gridProps?: HTMLAttributes<HTMLDivElement>;
  /** Accessible name. Prefer `ariaLabelledBy` when a visible caption exists. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /**
   * Rendered in flow after the grid, **outside** `role="tree"` — a load-more
   * button is not a tree item. In flow rather than absolutely positioned so it
   * stays reachable in the scrollable area and costs nothing when absent.
   */
  trailing?: ReactNode;
  /** Rendered in flow after `trailing` (loading / empty states). */
  afterRows?: ReactNode;
  /**
   * Pinned-header layer, rendered as a **sibling of the grid** inside the
   * scroll container and positioned at `scrollTop`. Outside `role="tree"` on
   * purpose: a pinned copy of an ancestor is path context, not a second tree
   * item. Supplying this slot is also what makes the shell track `scrollTop`,
   * so a tree without pinned headers pays no scroll re-renders.
   */
  renderOverlay?: (ctx: VirtualTreeOverlayContext) => ReactNode;
  navigation?: VirtualTreeNavigation<R>;
  /** The consumer's own scroll ref, when it also needs the element. */
  scrollRef?: RefObject<HTMLDivElement>;
  testId?: string;
}

const EMPTY_INDEXES: number[] = [];

/** Default branch probe: the `hasChildren` flag of the shared row contract. */
function isBranchByFlag<R extends TreeRowLevel>(row: R): boolean {
  return (row as R & { hasChildren?: boolean }).hasChildren === true;
}

/** Row index at the top of the viewport for a uniform-height list. */
export function firstVisibleTreeIndex(
  scrollTop: number,
  rowCount: number,
  rowHeight: number,
): number {
  if (rowCount <= 0 || rowHeight <= 0) return 0;
  const raw = Math.floor(Math.max(0, scrollTop) / rowHeight);
  return Math.min(raw, rowCount - 1);
}

/** Keep `index` inside the painted range; `-1` ("no active row") survives. */
function clampActiveIndex(index: number, rowCount: number): number {
  if (index < 0) return -1;
  return Math.min(index, rowCount - 1);
}

export function VirtualTree<R extends TreeRowLevel>({
  rows,
  getKey,
  renderRow,
  getRowAria,
  isBranch = isBranchByFlag,
  rowHeight,
  overscan = 25,
  className,
  containerProps,
  gridProps,
  ariaLabel,
  ariaLabelledBy,
  trailing,
  afterRows,
  renderOverlay,
  navigation,
  scrollRef: externalScrollRef,
  testId,
}: VirtualTreeProps<R>) {
  const ownScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = externalScrollRef ?? ownScrollRef;
  // Tracking costs a re-render per scroll frame, so it is on only when
  // something actually reads the offset.
  const tracksScroll = renderOverlay !== undefined || typeof containerProps === 'function';
  const [scrollTop, setScrollTop] = useState(0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => {
      const row = rows[index];
      // Unreachable: `count === rows.length`. Answering with the index keeps
      // the virtualizer total instead of throwing on a torn render.
      return row === undefined ? `missing:${index}` : getKey(row);
    },
    overscan,
  });

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (tracksScroll) setScrollTop(event.currentTarget.scrollTop);
    },
    [tracksScroll],
  );

  /*
   * The shell owns `onScroll` and `onKeyDown` because it has to: both are
   * where its mechanism lives. A consumer handler supplied through
   * `containerProps` runs first and is never dropped — silently ignoring it
   * would make `containerProps` a trap for anything that scrolls or listens
   * for keys.
   */
  const stickyIndexes = useMemo(() => {
    if (!tracksScroll) return EMPTY_INDEXES;
    const top = firstVisibleTreeIndex(scrollTop, rows.length, rowHeight);
    return ancestorIndexes(rows, top, isBranch);
  }, [isBranch, rowHeight, rows, scrollTop, tracksScroll]);

  const consumerContainerProps =
    typeof containerProps === 'function'
      ? containerProps({ stickyIndexes, scrollTop })
      : containerProps;
  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      consumerContainerProps?.onScroll?.(event);
      handleScroll(event);
    },
    [consumerContainerProps, handleScroll],
  );
  const revealIndex = useCallback(
    (index: number) => {
      if (index < 0) return;
      const el = scrollRef.current;
      if (!el) {
        virtualizer.scrollToIndex(index, { align: 'auto' });
        return;
      }
      const top = index * rowHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + rowHeight > el.scrollTop + el.clientHeight) {
        el.scrollTop = top + rowHeight - el.clientHeight;
      }
    },
    [rowHeight, scrollRef, virtualizer],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!navigation) return;
      const action = navigation.mapKey(event);
      if (!action) return;
      /*
       * Recognised means handled, even when the list is empty or the step turns
       * out to be suppressed: otherwise the browser scrolls the panel behind
       * the tree's back on a key the tree just consumed.
       */
      event.preventDefault();
      const rowCount = rows.length;
      const isNavigable = navigation.isNavigable ?? (() => true);
      const plan = planTreeNavigation<R>({
        rowCount,
        activeIndex: navigation.activeIndex,
        action,
        rowAt: (index) => rows[index]!,
        isBranch,
        isExpanded: navigation.isExpanded ?? (() => false),
        isNavigable,
        step: (from, direction) => stepIndex(from, direction, rowCount),
        firstChildIndex: (index) => firstChildIndex(rows, index, isBranch),
        parentIndexOf: (index) => (index < 0 ? -1 : parentIndexOf(rows, index, isBranch)),
        nextNavigableIndex: (from, direction) =>
          nextNavigableIndex(from, direction, rowCount, isNavigable),
        clamp: (index) => clampActiveIndex(index, rowCount),
      });
      if (plan.kind === 'none') return;
      if (plan.kind === 'command') {
        if (plan.action === 'clear') navigation.onActiveIndexChange(-1);
        navigation.onCommand?.(plan.action);
        return;
      }
      const row = rows[plan.index];
      if (row === undefined) return;
      if (plan.kind === 'toggle') {
        navigation.onToggle?.(row, plan.index);
        return;
      }
      if (plan.kind === 'activate') {
        navigation.onActivate?.(row, plan.index);
        return;
      }
      navigation.onActiveIndexChange(plan.index);
      revealIndex(plan.index);
    },
    [isBranch, navigation, revealIndex, rows],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      consumerContainerProps?.onKeyDown?.(event);
      handleKeyDown(event);
    },
    [consumerContainerProps, handleKeyDown],
  );

  return (
    <div
      {...consumerContainerProps}
      ref={scrollRef}
      className={cn(tracksScroll && 'relative', className, consumerContainerProps?.className)}
      onKeyDown={onKeyDown}
      onScroll={onScroll}
      data-testid={testId}
    >
      {renderOverlay ? renderOverlay({ stickyIndexes, scrollTop }) : null}
      <div
        {...gridProps}
        role="tree"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (row === undefined) return null;
          const custom = getRowAria?.(row, virtualRow.index);
          return (
            <div
              key={getKey(row)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderRow({
                row,
                index: virtualRow.index,
                isBranch: isBranch(row, virtualRow.index),
                start: virtualRow.start,
                size: virtualRow.size,
                itemProps:
                  custom === undefined ? { 'aria-level': ariaLevelOf(row) } : (custom ?? {}),
              })}
            </div>
          );
        })}
      </div>
      {trailing}
      {afterRows}
    </div>
  );
}
