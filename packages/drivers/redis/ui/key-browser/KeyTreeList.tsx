import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type UIEvent,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileKey2,
  Folder,
  FolderOpen,
  Loader2,
  Search,
  ShieldAlert,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useI18n } from '@datazen/ui';
import { cn } from '@datazen/ui';
import type { KeyTreeRow } from './keyTree';
import { keyUnderFolder } from './keyTree';
import { countSelectableRows, isBreadcrumbRow } from './keyTreeFilter';
import { TREE_EMPTY_STATE_KEYS, type TreeEmptyState } from './treeEmptyState';
import {
  ROW_HEIGHT,
  firstChildIndex,
  firstVisibleIndex,
  nextActiveIndex,
  parentIndexOf,
  rowIndent,
  stickyFolderChain,
  treeNavAction,
} from './treeRowSpec';

/**
 * Delete target for a hover action on a tree row: a single leaf key, or a
 * folder prefix (delete every key under its subtree).
 */
export type KeyTreeDeleteTarget =
  | { kind: 'key'; key: string }
  | { kind: 'folder'; prefix: string; label: string; count: number };

/** Outlined pill colors per Redis type, keyed by the raw `keyType` string. */
const TYPE_BADGE: Record<string, string> = {
  string: 'border-success/40 text-success',
  hash: 'border-accent/40 text-accent',
  list: 'border-warning/40 text-warning',
  set: 'border-fg-secondary/40 text-fg-secondary',
  zset: 'border-danger/40 text-danger',
  stream: 'border-fg-muted/40 text-fg-muted',
};

/** Icon per named empty state (I-11) — the copy itself always comes from i18n. */
const EMPTY_ICON: Record<TreeEmptyState, typeof Search> = {
  none: Folder,
  'no-match': Search,
  interrupted: WifiOff,
  'no-permission': ShieldAlert,
};

export interface KeyTreeListProps {
  treeRows: KeyTreeRow[];
  /**
   * The keys **visible** under the applied pattern (BUG-001 single source, owned
   * by `useKeyTreeView`): the prefix cascade on folder checkboxes and R1's
   * `{loaded}` both read this, so no surface can select or count a key the
   * pattern rejected.
   */
  allKeys: string[];
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  selectedKey: string | null;
  selectedKeys: Set<string>;
  onSelectKey: (key: string) => void;
  onToggleKey: (key: string, checked: boolean) => void;
  onToggleKeys: (keys: string[], checked: boolean) => void;
  onKeyContextMenu: (e: ReactMouseEvent, key: string) => void;
  onDeleteRow: (target: KeyTreeDeleteTarget) => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  /** R3 separator — decides which folder/leaf boundary counts as a match. */
  separator: string;
  /** I-11: named empty state to render, or `null` when the list is not empty. */
  emptyState: TreeEmptyState | null;
  /** Pattern quoted back by the `no-match` state. */
  pattern: string;
  /**
   * A pattern is *applied* (not blank / `*`), so a folder whose level scan is
   * still open must admit that part of its `(n+)` remainder is unfiltered
   * (D-2 / BUG-001; the wording is `redis.tree.filterUnloaded`).
   */
  filterActive: boolean;
  /** I-9 chords the tree owns: select-all-loaded / refresh / leave selection. */
  onSelectAllLoaded: () => void;
  onRefresh: () => void;
  onClearSelection: () => void;
}

/**
 * Compact hierarchical key tree (server-driven `list_children` levels):
 * one 30 px row per folder/leaf with a leading checkbox, folder icon + child
 * count, inline type / TTL badges, and a hover delete action (folder rows
 * delete their whole subtree).
 *
 * Row geometry and the pinned folder stack come from `treeRowSpec` (D-4), and so
 * does the keyboard map (D-7 / I-9): the tree is focusable, tracks one
 * `activeIndex`, and clamps at both ends rather than wrapping.
 */
export function KeyTreeList({
  treeRows,
  allKeys,
  expandedFolders,
  onToggleFolder,
  selectedKey,
  selectedKeys,
  onSelectKey,
  onToggleKey,
  onToggleKeys,
  onKeyContextMenu,
  onDeleteRow,
  loading,
  hasMore,
  onLoadMore,
  separator,
  emptyState,
  pattern,
  filterActive,
  onSelectAllLoaded,
  onRefresh,
  onClearSelection,
}: KeyTreeListProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  /*
   * `paintedRows` is the grid the virtualizer and the sticky stack lay out over;
   * `rowCount` is what `data-row-count`, R1's counter and every selection surface
   * agree on (BUG-001 single source). They differ exactly by the breadcrumb rows
   * the pattern filter back-fills as path context: painted, but not rows — not
   * clickable, not checkable, not navigable (see `keyTreeFilter.ts`).
   */
  const paintedRows = treeRows.length;
  const rowCount = countSelectableRows(treeRows);
  const [scrollTop, setScrollTop] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);

  const virtualizer = useVirtualizer({
    count: paintedRows + (hasMore ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const handleScroll = (e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop);

  /** Rows a keyboard user can land on: everything a breadcrumb is not. */
  const isNavigable = (index: number): boolean => {
    const row = treeRows[index];
    return !!row && !isBreadcrumbRow(row);
  };

  /**
   * One navigation step, skipping breadcrumbs. The clamp is `nextActiveIndex`'s
   * (a step past either end stays put — I-9's exit rule), so a breadcrumb sitting
   * between two real rows is passed through and never stopped on.
   */
  const stepActiveIndex = (from: number, direction: 1 | -1): number => {
    const target = nextActiveIndex(from, direction, paintedRows);
    let index = target;
    while (index >= 0 && index < paintedRows && !isNavigable(index)) index += direction;
    // Every row in that direction is a breadcrumb ⇒ stay on the current one.
    if (index < 0 || index >= paintedRows) return target;
    return index;
  };

  // Folder checkboxes select every key under the prefix from the *visible* key
  // set (D-2 / BUG-001), so collapsed (unexpanded) folders are selectable too and
  // a filter can never select a key the pattern rejected.
  const folderSelection = useMemo(() => {
    const map = new Map<string, { keys: string[]; all: boolean }>();
    for (const row of treeRows) {
      if (row.kind !== 'folder' || isBreadcrumbRow(row)) continue;
      const keys = allKeys.filter((k) => keyUnderFolder(k, row.path, separator));
      const all = keys.length > 0 && keys.every((k) => selectedKeys.has(k));
      map.set(row.path, { keys, all });
    }
    return map;
  }, [treeRows, allKeys, selectedKeys, separator]);

  const sticky = useMemo(
    () => stickyFolderChain(treeRows, firstVisibleIndex(scrollTop, paintedRows)),
    [treeRows, scrollTop, paintedRows],
  );

  /**
   * `(n)` for a complete level, `(n+)` while its scan is still open (I-4). Under an
   * applied pattern the `+` also carries the unloaded-tail hint: a level whose scan
   * has not finished holds keys the client-side filter never saw, so the visible
   * subset cannot be presented as the whole remainder (D-2 known limitation /
   * redis-tree-ui-BUG-001). Only `level.partial` (⇒ `level.done === false`) adds
   * it — a drained level is fully filtered and needs no caveat.
   */
  const countLabel = (count: number, partial: boolean | undefined) => {
    if (!partial) return String(count);
    const shown = t('redis.tree.folderPartial').replace('{count}', String(count));
    return filterActive ? `${shown} ${t('redis.tree.filterUnloaded')}` : shown;
  };

  /** Keep the active row inside the viewport by arithmetic on the row grid. */
  const revealRow = (index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  };

  /*
   * I-9 (D-7) state machine. Enter: the tree is focusable, so a key press has an
   * owner. State: one `activeIndex`, clamped at both ends — ↑ on the first row
   * and ↓ on the last stay put instead of flinging the viewport to the other end
   * of a 10k-key tree. Exit: `←` on a root row and `Esc` both leave selection
   * mode (`Esc` clears the checks, which is the visible half of the exit).
   *
   * Navigation runs over the painted grid but only ever *lands* on a real row:
   * a pattern breadcrumb is path context, so `↑/↓` pass through it
   * (`stepActiveIndex`) and no intent can select, toggle or delete it.
   */
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const action = treeNavAction(e);
    if (!action) return;
    e.preventDefault();
    if (action === 'select-all') {
      onSelectAllLoaded();
      return;
    }
    if (action === 'refresh') {
      onRefresh();
      return;
    }
    if (action === 'clear') {
      onClearSelection();
      setActiveIndex(-1);
      return;
    }
    if (rowCount === 0) return;
    const from = activeIndex < 0 ? -1 : Math.min(activeIndex, paintedRows - 1);
    const row = from >= 0 && isNavigable(from) ? treeRows[from] : undefined;

    if (action === 'next' || action === 'previous') {
      const next = stepActiveIndex(from, action === 'next' ? 1 : -1);
      setActiveIndex(next);
      revealRow(next);
      return;
    }
    if (from < 0 || !row) {
      const first = stepActiveIndex(-1, 1);
      setActiveIndex(first);
      revealRow(first);
      return;
    }
    if (action === 'expand') {
      if (row.kind === 'folder') {
        if (!expandedFolders.has(row.path)) onToggleFolder(row.path);
        else {
          let child = firstChildIndex(treeRows, from);
          // Step into the subtree, past any breadcrumb the filter back-filled.
          while (child >= 0 && child < paintedRows && !isNavigable(child)) child += 1;
          if (child >= 0 && child < paintedRows) {
            setActiveIndex(child);
            revealRow(child);
          }
        }
      }
      return;
    }
    if (action === 'fold') {
      if (row.kind === 'folder' && expandedFolders.has(row.path)) onToggleFolder(row.path);
      else {
        const parent = parentIndexOf(treeRows, from);
        setActiveIndex(parent);
        revealRow(parent);
      }
      return;
    }
    // activate
    if (row.kind === 'key') onSelectKey(row.entry.key);
    else onToggleFolder(row.path);
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      // I-9: the tree is a focusable list surface, so ⌘A / ⌘R / arrows have one
      // owner instead of racing the browser default.
      tabIndex={0}
      className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-accent"
      data-testid="redis-key-tree"
      data-row-count={rowCount}
      data-sticky-depth={sticky.length}
      data-active-index={activeIndex}
      data-separator={separator}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {/*
          Multi-level sticky group headers (D-4): the ancestors of the row at the
          viewport top stay pinned so the user never loses "which folder am I in"
          while scrolling a long subtree. In flow at the very top of the tall
          container + `position: sticky`, so it needs no scroll listener of its
          own beyond the container's `scrollTop`.
        */}
        {sticky.length > 0 && (
          <div
            className="sticky top-0 z-10 bg-surface"
            style={{ height: sticky.length * ROW_HEIGHT }}
            data-testid="redis-tree-sticky-headers"
          >
            {sticky.map((row, i) =>
              row.kind === 'folder' ? (
                <div
                  key={`sticky:${row.path}`}
                  role="button"
                  tabIndex={-1}
                  className={cn(
                    'absolute left-0 flex w-full items-center gap-1.5 border-b border-edge bg-surface pr-3',
                    // A filter breadcrumb stays decoration even while pinned.
                    isBreadcrumbRow(row) ? 'opacity-70' : 'cursor-pointer hover:bg-accent/5',
                  )}
                  style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, paddingLeft: rowIndent(row.depth) }}
                  onClick={isBreadcrumbRow(row) ? undefined : () => onToggleFolder(row.path)}
                  data-testid={`redis-tree-sticky-folder-${row.path}`}
                  data-sticky-depth={row.depth}
                  data-sticky-order={i}
                  data-partial={row.partial === true ? 'true' : 'false'}
                  data-breadcrumb={isBreadcrumbRow(row) ? 'true' : 'false'}
                >
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                  <FolderOpen className="h-4 w-4 shrink-0 text-warning" />
                  <span className="truncate font-mono text-xs font-medium text-fg">
                    {row.label}
                  </span>
                  <span className="shrink-0 text-[11px] text-fg-muted">
                    ({countLabel(row.count, row.partial)})
                  </span>
                </div>
              ) : null,
            )}
          </div>
        )}

        {virtualizer.getVirtualItems().map((vRow) => {
          if (vRow.index >= paintedRows) {
            return (
              <div
                key="load-more"
                className="absolute left-0 flex w-full items-center justify-center border-b border-edge"
                style={{ top: vRow.start, height: ROW_HEIGHT }}
              >
                <button
                  type="button"
                  className="text-xs text-accent hover:underline"
                  onClick={onLoadMore}
                  disabled={loading}
                  data-testid="redis-tree-load-more"
                  data-loading={loading ? 'true' : 'false'}
                >
                  {loading ? (
                    <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
                  ) : (
                    t('redis.loadMore')
                  )}
                </button>
              </div>
            );
          }

          const row = treeRows[vRow.index]!;
          const indent = rowIndent(row.depth);

          if (row.kind === 'folder') {
            /*
             * Breadcrumb arm (D-2 / BUG-001): the folder does not match the
             * pattern itself — it is painted only so a surviving deeper row keeps
             * its path. It therefore has no checkbox, no delete, no expansion
             * click, and the renderer marks it (`data-breadcrumb`) so tests never
             * have to guess from styling.
             */
            const breadcrumb = isBreadcrumbRow(row);
            const open = expandedFolders.has(row.path);
            const sel = folderSelection.get(row.path);
            const descendants = sel?.keys ?? [];
            const allChecked = sel?.all ?? false;
            if (breadcrumb) {
              return (
                <div
                  key={`crumb:${row.path}`}
                  aria-hidden="true"
                  className={cn(
                    'absolute left-0 flex w-full items-center gap-1.5 border-b border-edge pr-3 opacity-70',
                    vRow.index % 2 === 0 ? 'bg-surface' : 'bg-surface-raised/40',
                  )}
                  style={{ top: vRow.start, height: ROW_HEIGHT, paddingLeft: indent }}
                  data-testid={`redis-tree-folder-${row.path}`}
                  data-row-index={vRow.index}
                  data-row-kind="folder"
                  data-row-path={row.path}
                  data-depth={row.depth}
                  data-indent={indent}
                  data-expanded={open ? 'true' : 'false'}
                  data-active="false"
                  data-breadcrumb="true"
                >
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                  )}
                  <Folder className="h-4 w-4 shrink-0 text-warning" />
                  <span className="truncate font-mono text-xs font-medium text-fg-muted">
                    {row.label}
                  </span>
                </div>
              );
            }
            return (
              <div
                key={`folder:${row.path}`}
                className={cn(
                  'group absolute left-0 flex w-full items-center gap-1.5 border-b border-edge pr-3',
                  vRow.index % 2 === 0 ? 'bg-surface' : 'bg-surface-raised/40',
                  'hover:bg-accent/5',
                  vRow.index === activeIndex && 'bg-accent/10 ring-1 ring-inset ring-accent',
                )}
                style={{ top: vRow.start, height: ROW_HEIGHT, paddingLeft: indent }}
                onClick={() => onToggleFolder(row.path)}
                data-testid={`redis-tree-folder-${row.path}`}
                data-row-index={vRow.index}
                data-row-kind="folder"
                data-row-path={row.path}
                data-depth={row.depth}
                data-indent={indent}
                data-expanded={open ? 'true' : 'false'}
                data-active={vRow.index === activeIndex ? 'true' : 'false'}
                data-breadcrumb="false"
              >
                <span
                  className="flex shrink-0 items-center justify-center"
                  style={{ width: 16 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => onToggleKeys(descendants, e.target.checked)}
                    aria-label={row.label}
                    data-testid={`redis-tree-folder-check-${row.path}`}
                  />
                </span>
                {open ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                )}
                {open ? (
                  <FolderOpen className="h-4 w-4 shrink-0 text-warning" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-warning" />
                )}
                <span className="truncate font-mono text-xs font-medium text-fg">{row.label}</span>
                <span
                  className="shrink-0 text-[11px] text-fg-muted"
                  data-testid={`redis-tree-folder-count-${row.path}`}
                  data-count={row.count}
                  data-partial={row.partial === true ? 'true' : 'false'}
                >
                  ({countLabel(row.count, row.partial)})
                </span>
                <button
                  type="button"
                  className="ml-auto shrink-0 rounded p-1 text-fg-muted opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                  title={t('redis.delete')}
                  aria-label={t('redis.delete')}
                  data-testid={`redis-tree-folder-delete-${row.path}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteRow({
                      kind: 'folder',
                      prefix: row.path,
                      label: row.label,
                      count: row.count,
                    });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }

          const { entry } = row;
          const isSelected = selectedKey === entry.key;
          const isChecked = selectedKeys.has(entry.key);
          return (
            <div
              key={entry.key}
              className={cn(
                'group absolute left-0 flex w-full items-center gap-1.5 border-b border-edge pr-3',
                isSelected
                  ? 'bg-accent/10'
                  : vRow.index % 2 === 0
                    ? 'bg-surface'
                    : 'bg-surface-raised/40',
                'hover:bg-accent/5',
                vRow.index === activeIndex && 'bg-accent/10 ring-1 ring-inset ring-accent',
              )}
              style={{ top: vRow.start, height: ROW_HEIGHT, paddingLeft: indent }}
              onClick={() => onSelectKey(entry.key)}
              onContextMenu={(e) => onKeyContextMenu(e, entry.key)}
              data-testid={`redis-key-row-${entry.key}`}
              data-row-index={vRow.index}
              data-row-kind="key"
              data-row-path={entry.key}
              data-depth={row.depth}
              data-indent={indent}
              data-selected={isSelected ? 'true' : 'false'}
              data-active={vRow.index === activeIndex ? 'true' : 'false'}
            >
              {/*
                Leaf affordance swap (D-4): a key row shows its key icon and only
                reveals the checkbox on hover — unless it *is* checked, in which
                case the checkbox stays so the selection set never hides itself.
                Folders keep a resident checkbox because their subtree state is
                meaningful without hovering.
              */}
              <span
                className="flex shrink-0 items-center justify-center"
                style={{ width: 16 }}
                onClick={(e) => e.stopPropagation()}
              >
                <FileKey2
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-fg-muted',
                    isChecked ? 'hidden' : 'block group-hover:hidden',
                  )}
                  data-testid={`redis-tree-key-icon-${entry.key}`}
                  aria-hidden="true"
                />
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => onToggleKey(entry.key, e.target.checked)}
                  aria-label={entry.key}
                  className={isChecked ? 'block' : 'hidden group-hover:block'}
                  data-testid={`redis-tree-key-check-${entry.key}`}
                  data-key={entry.key}
                  data-checked={isChecked ? 'true' : 'false'}
                />
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary">
                {row.label}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-tight',
                  TYPE_BADGE[entry.keyType] ?? 'border-edge text-fg-muted',
                )}
              >
                {entry.keyType}
              </span>
              <span className="shrink-0 rounded-full border border-warning/40 px-1.5 py-px text-[10px] font-medium leading-tight text-warning">
                {entry.ttl < 0 ? t('redis.noExpiry') : `${entry.ttl}${t('redis.seconds')}`}
              </span>
              <button
                type="button"
                className="ml-auto shrink-0 rounded p-1 text-fg-muted opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                title={t('redis.delete')}
                aria-label={t('redis.delete')}
                data-testid={`redis-tree-key-delete-${entry.key}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteRow({ kind: 'key', key: entry.key });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {loading && rowCount === 0 && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {/*
        I-11 (D-8): "no rows" is four different facts, each named by its own
        i18n key — never a shared blank. `resolveTreeEmptyState` picks which one,
        and the state is also published as a data attribute so the assertion does
        not depend on English copy.
      */}
      {emptyState && !loading && (
        <div
          className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center"
          data-testid="redis-tree-empty"
          data-empty-state={emptyState}
        >
          {(() => {
            const Icon = EMPTY_ICON[emptyState];
            return <Icon className="h-6 w-6 text-fg-muted opacity-40" aria-hidden="true" />;
          })()}
          <div className="text-xs text-fg-muted" data-testid="redis-tree-empty-label">
            {t(TREE_EMPTY_STATE_KEYS[emptyState])
              .replace('{pattern}', pattern)
              .replace('{loaded}', String(allKeys.length))}
          </div>
        </div>
      )}
    </div>
  );
}
