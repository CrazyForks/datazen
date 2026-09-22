/**
 * The whole left column of 屏 B: the three-row column header (R1 actions / R2
 * search / R3 grouping) above the key list.
 *
 * Extracted from `RedisWorkbench` (D-3) because from here on the header grows a
 * row per PRD §3.2 requirement, and the composition root has a hard size budget.
 * This pane is *presentation only*: every object it reads is owned elsewhere
 * (`useKeyTreeView` for the view + rows, `useRedisKeyScan` for the flat list,
 * `useWorkbenchSearch` for the scope, `useKeySelection` for the checks,
 * `useKeyDetailState` for the mounted key, `useBatchActions` for the writes), so
 * no state and no I/O moved here — only the wiring of one to the other.
 */
import { KeyTreeColumn } from './KeyTreeColumn';
import { KeyTreeGroupRow } from './KeyTreeGroupRow';
import { KeyTreeHeader } from './KeyTreeHeader';
import { KeyTreeSearchRow } from './KeyTreeSearchRow';
import type { KeySelection } from './useKeySelection';
import type { KeyTreeView } from './useKeyTreeView';
import type { KeyScanApi } from './useRedisKeyScan';
import type { WorkbenchSearch } from './useWorkbenchSearch';
import type { BatchActions } from './useBatchActions';
import type { KeyDetailState } from './useKeyDetailState';
import type { KeyTreeDeleteTarget } from './KeyTreeList';
import type { MouseEvent as ReactMouseEvent } from 'react';

export interface KeyTreePaneProps {
  view: KeyTreeView;
  scan: KeyScanApi;
  search: WorkbenchSearch;
  selection: KeySelection;
  detail: KeyDetailState;
  batch: BatchActions;
  onKeyContextMenu: (e: ReactMouseEvent, key: string) => void;
  onDeleteRow: (target: KeyTreeDeleteTarget) => void;
  /** `DBSIZE` — the denominator of R1's `已加载 N / 共 M`. */
  totalCount: number;
  /** R2's fuzzy chip: literal → `*literal*` on apply. */
  fuzzy: boolean;
  onFuzzyChange: (fuzzy: boolean) => void;
  onCreateKey: () => void;
  /** ⌘R / header refresh (also the I-9 chord target inside the tree). */
  onRefresh: () => void;
}

export function KeyTreePane({
  view,
  scan,
  search,
  selection,
  detail,
  batch,
  onKeyContextMenu,
  onDeleteRow,
  totalCount,
  fuzzy,
  onFuzzyChange,
  onCreateKey,
  onRefresh,
}: KeyTreePaneProps) {
  const { tree: treeState, treeRows, emptyState, mode, separator, setMode, setSeparator } = view;
  const loadedKeys = scan.keys.map((entry) => entry.key);
  const isKeyMode = search.searchMode === 'key';

  const selectAllLoaded = () => selection.selectMany(loadedKeys);

  return (
    <>
      <KeyTreeHeader
        searchMode={search.searchMode}
        onSearchModeChange={search.setSearchMode}
        loadedCount={scan.keys.length}
        totalCount={totalCount}
        scanning={scan.cursor !== 0}
        selectedCount={selection.selectionCount}
        onSelectAll={selectAllLoaded}
        onClearSelection={selection.clearSelection}
        onBatchTtl={() => batch.request('ttl')}
        onBatchDelete={() => batch.request('delete')}
        onRefresh={onRefresh}
        onCreateKey={onCreateKey}
      >
        <KeyTreeSearchRow
          scope={search.searchMode}
          pattern={scan.searchPattern}
          onPatternChange={scan.setSearchPattern}
          onApply={() => search.applySearch(scan.searchPattern, fuzzy)}
          fuzzy={fuzzy}
          onFuzzyChange={onFuzzyChange}
          noTtlOnly={scan.noTtlOnly}
          onNoTtlOnlyChange={scan.setNoTtlOnly}
          keyType={scan.keyTypeFilter}
          onKeyTypeChange={scan.setKeyTypeFilter}
        />
        <KeyTreeGroupRow
          view={mode}
          onViewChange={setMode}
          separator={separator}
          onSeparatorChange={setSeparator}
          disabled={!isKeyMode}
        />
      </KeyTreeHeader>
      <KeyTreeColumn
        searchMode={search.searchMode}
        treeRows={treeRows}
        allKeys={loadedKeys}
        expandedFolders={treeState.expanded}
        onToggleFolder={treeState.toggleFolder}
        selectedKey={detail.selectedKey}
        selectedKeys={selection.selectedKeys}
        onSelectKey={detail.selectKey}
        onToggleKey={selection.toggleKey}
        onToggleKeys={selection.toggleKeys}
        onKeyContextMenu={onKeyContextMenu}
        onDeleteRow={onDeleteRow}
        loading={scan.keysLoading || treeState.rootLoading}
        hasMore={scan.cursor !== 0}
        onLoadMore={scan.loadMore}
        separator={separator}
        emptyState={emptyState}
        pattern={scan.searchPattern}
        onSelectAllLoaded={selectAllLoaded}
        onRefresh={onRefresh}
        onClearSelection={selection.clearSelection}
        valueSearchState={search.valueSearchState}
        onCancelValueSearch={search.cancelValueSearch}
      />
    </>
  );
}
