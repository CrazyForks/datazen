import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { Database } from 'lucide-react';
import { useI18n } from '@datazen/ui';
import { useBoundSchemaStore, useBoundSettingsStore, readBooleanField } from '@datazen/driver-sdk';
import { BatchBar } from './BatchBar';
import { ImportExport } from './ImportExport';
import { KeyTreeColumn } from './KeyTreeColumn';
import { DetailColumn } from './DetailColumn';
import type { SearchMode } from './SearchModeTabs';
import { useValueSearch } from '../value-search/useValueSearch';
import { useRedisKeyScan } from './useRedisKeyScan';
import { useKeyTree } from './useKeyTree';
import { buildServerTreeRows } from './keyTree';
import { KeyWorkbenchDialogs } from './KeyWorkbenchDialogs';
import { mergeDatabases, dbIndexOfName } from './workbenchDatabases';
import { DbSidebar } from './DbSidebar';
import { BatchSummaryBanner, WorkbenchToolbar } from './WorkbenchToolbar';
import { useWorkbenchSplit } from './useWorkbenchSplit';
import { useKeySelection } from './useKeySelection';
import { useKeyDetailState } from './useKeyDetailState';
import { useKeyRowActions } from './useKeyRowActions';
import { useKvSlotRelay } from './useKvSlotRelay';
import { useDbKeyCounts } from './useDbKeyCounts';
import { useCreateTypes, useReJsonModules } from './useReJsonModules';
import { useWorkbenchOverlays } from './useWorkbenchOverlays';

export type { RedisWorkbenchProps, RedisWorkbenchHandle } from './workbenchTypes';
import type { RedisWorkbenchProps, RedisWorkbenchHandle } from './workbenchTypes';

/**
 * 屏 B of the Redis workbench: database picker + key tree (left) + key detail
 * (right).
 *
 * This file is deliberately a *composition*. After the D-0 split every block of
 * the previous 705-line wall owns a module (`DbSidebar`, `WorkbenchToolbar`,
 * `KeyTreeColumn`, `DetailColumn`, `useRedisKeyScan`/`useKeyTree`, the `useKey*`
 * state hooks, `useWorkbenchOverlays` and `KeyWorkbenchDialogs`). What stays here
 * is only what genuinely has to be shared: the single writers of selection and
 * detail state, the refresh fan-out, the host KV relay (contract F-2) and the
 * imperative handle the host tabs drive.
 */
export const RedisWorkbench = forwardRef<RedisWorkbenchHandle, RedisWorkbenchProps>(
  function RedisWorkbench(
    {
      dbSessionId,
      initialDatabase,
      hideSidebar,
      onDbIndexChange,
      onDatabaseChange,
      onKeysChange,
      kvSlotState,
    },
    ref,
  ) {
    const { t } = useI18n();
    const databasesFromStore = useBoundSchemaStore((s) => s.databases);
    const loading = useBoundSchemaStore((s) => s.loading);
    const loadForConnection = useBoundSchemaStore((s) => s.loadForConnection);
    const driverSettings = useBoundSettingsStore((s) => s.settings.driverSettings);
    const allowFlush = readBooleanField(
      (driverSettings?.redis ?? {}) as Record<string, unknown>,
      'allowFlush',
      false,
    );

    const databases = useMemo(() => mergeDatabases(databasesFromStore), [databasesFromStore]);

    const [selectedDb, setSelectedDb] = useState<string | null>(null);
    const [dbIndex, setDbIndex] = useState(0);
    const [searchMode, setSearchMode] = useState<SearchMode>('key');

    const overlays = useWorkbenchOverlays();
    const { treeWidth, startSplitDrag } = useWorkbenchSplit();
    const selection = useKeySelection();
    const detail = useKeyDetailState(dbSessionId, dbIndex);

    const {
      keys,
      cursor,
      dbSize,
      keysLoading,
      searchPattern,
      setSearchPattern,
      keyTypeFilter,
      setKeyTypeFilter,
      withMemory,
      setWithMemory,
      noTtlOnly,
      setNoTtlOnly,
      loadKeys,
      resetSelectionState,
      refresh: scanRefresh,
      loadMore,
      search: scanSearch,
    } = useRedisKeyScan({
      dbSessionId,
      dbIndex,
      enabled: selectedDb !== null,
    });

    const tree = useKeyTree({
      dbSessionId,
      dbIndex,
      enabled: selectedDb !== null,
      noTtlOnly,
      keyType: keyTypeFilter,
    });

    const {
      state: valueSearchState,
      start: startValueSearch,
      cancel: cancelValueSearch,
      reset: resetValueSearch,
    } = useValueSearch({ dbSessionId, dbIndex });

    // Exit transition: leaving value search (mode → key, or db/session change)
    // tears down any running task so no stale scan keeps polling.
    useEffect(() => {
      if (searchMode === 'key') resetValueSearch();
    }, [searchMode, dbIndex, dbSessionId, resetValueSearch]);

    const treeRows = useMemo(
      () => buildServerTreeRows(tree.levels, tree.expanded),
      [tree.levels, tree.expanded],
    );

    useEffect(() => {
      void loadForConnection(dbSessionId, { skipLoadTables: true });
    }, [dbSessionId, loadForConnection]);

    const modules = useReJsonModules(dbSessionId);
    const { dbCounts, loadDbSizes } = useDbKeyCounts(dbSessionId, dbIndex, selectedDb, dbSize);
    const createTypes = useCreateTypes(modules);

    /** Drop the mounted detail *and* the checkbox selection (db switch, refresh). */
    const clearFocus = useCallback(() => {
      detail.clearDetail();
      selection.clearSelection();
    }, [detail.clearDetail, selection.clearSelection]);

    const handleSelectDb = useCallback(
      (db: string) => {
        const idx = dbIndexOfName(db);
        setSelectedDb(db);
        setDbIndex(idx);
        onDbIndexChange?.(idx);
        onDatabaseChange?.(db);
        clearFocus();
        setSearchPattern('*');
        resetSelectionState();
        void loadKeys(idx, '*', 0, true);
      },
      [
        clearFocus,
        loadKeys,
        resetSelectionState,
        setSearchPattern,
        onDatabaseChange,
        onDbIndexChange,
      ],
    );

    useEffect(() => {
      onKeysChange?.(keys.map((entry) => entry.key));
    }, [keys, onKeysChange]);

    useEffect(() => {
      if (databases.length > 0 && !selectedDb) {
        const initial = initialDatabase
          ? (databases.find((d) => d === initialDatabase) ?? initialDatabase)
          : databases[0];
        if (initial) handleSelectDb(initial);
      }
    }, [databases, initialDatabase, selectedDb, handleSelectDb]);

    const refreshKeys = useCallback(() => {
      if (!selectedDb) return;
      clearFocus();
      scanRefresh();
      tree.refresh();
    }, [selectedDb, clearFocus, scanRefresh, tree]);

    const handleRefresh = useCallback(() => {
      void loadForConnection(dbSessionId, { skipLoadTables: true });
      refreshKeys();
      loadDbSizes();
    }, [dbSessionId, loadForConnection, refreshKeys, loadDbSizes]);

    useImperativeHandle(ref, () => ({ refreshKeys, selectDatabase: handleSelectDb }), [
      refreshKeys,
      handleSelectDb,
    ]);

    const handleSearch = useCallback(() => {
      clearFocus();
      if (searchMode === 'key') {
        scanSearch();
        return;
      }
      const query = searchPattern.trim();
      if (!query) {
        resetValueSearch();
        return;
      }
      startValueSearch({ mode: searchMode, query, pattern: '*' });
    }, [clearFocus, searchMode, scanSearch, searchPattern, startValueSearch, resetValueSearch]);

    const reloadDetail = useCallback(async () => {
      if (!detail.selectedKey) return;
      await detail.selectKey(detail.selectedKey);
      refreshKeys();
    }, [detail, refreshKeys]);

    // Contract F-2: publish selection + draft flag into the host's KV atom.
    useKvSlotRelay(kvSlotState, dbSessionId, detail.selectedKey, detail.editorDirty);

    // Row context menu + hover delete (confirm → write gate → refresh).
    const { handleKeyContextMenu, handleDeleteRow, actionDialogs } = useKeyRowActions({
      dbSessionId,
      dbIndex,
      onRefreshKeys: refreshKeys,
      onBatchSummary: overlays.setBatchSummary,
      onKeyCtxDialog: overlays.setKeyCtxDialog,
    });

    return (
      <div className="flex min-h-0 flex-1">
        {!hideSidebar && (
          <DbSidebar
            searchMode={searchMode}
            onSearchModeChange={setSearchMode}
            searchPattern={searchPattern}
            onSearchPatternChange={setSearchPattern}
            onSearchSubmit={handleSearch}
            loading={loading}
            databases={databases}
            selectedDb={selectedDb}
            dbCounts={dbCounts}
            onSelectDb={handleSelectDb}
          />
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedDb ? (
            <>
              <WorkbenchToolbar
                selectedDb={selectedDb}
                dbSize={dbSize}
                loadedCount={keys.length}
                hasMore={cursor !== 0}
                searchMode={searchMode}
                allowFlush={allowFlush}
                filters={{
                  keyType: keyTypeFilter,
                  onKeyTypeChange: setKeyTypeFilter,
                  withMemory,
                  onWithMemoryChange: setWithMemory,
                  noTtlOnly,
                  onNoTtlOnlyChange: setNoTtlOnly,
                }}
                onRefresh={handleRefresh}
                onCreate={() => overlays.setCreateOpen(true)}
                onImportExport={() => overlays.setImportExportOpen(true)}
                onFlushDb={() => overlays.setFlushDialog('db')}
                onFlushAll={() => overlays.setFlushDialog('all')}
              />

              <BatchSummaryBanner
                summary={overlays.batchSummary}
                onDismiss={() => overlays.setBatchSummary(null)}
              />

              <BatchBar
                dbSessionId={dbSessionId}
                dbIndex={dbIndex}
                selectedKeys={[...selection.selectedKeys]}
                searchPattern={searchPattern}
                onClearSelection={selection.clearSelection}
                onRefresh={refreshKeys}
                onSummary={overlays.setBatchSummary}
              />

              <div className="flex min-h-0 flex-1">
                <div
                  className="flex min-w-0 shrink-0 flex-col"
                  style={{ width: treeWidth }}
                  data-testid="redis-tree-pane"
                  data-tree-width={treeWidth}
                >
                  <KeyTreeColumn
                    searchMode={searchMode}
                    treeRows={treeRows}
                    allKeys={keys.map((k) => k.key)}
                    expandedFolders={tree.expanded}
                    onToggleFolder={tree.toggleFolder}
                    selectedKey={detail.selectedKey}
                    selectedKeys={selection.selectedKeys}
                    onSelectKey={detail.selectKey}
                    onToggleKey={selection.toggleKey}
                    onToggleKeys={selection.toggleKeys}
                    onKeyContextMenu={handleKeyContextMenu}
                    onDeleteRow={handleDeleteRow}
                    loading={keysLoading}
                    hasMore={cursor !== 0}
                    onLoadMore={loadMore}
                    valueSearchState={valueSearchState}
                    onCancelValueSearch={cancelValueSearch}
                  />
                </div>

                <div
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={startSplitDrag}
                  className="w-1 shrink-0 cursor-col-resize bg-edge transition-colors hover:bg-accent/60"
                  data-testid="redis-split-handle"
                />

                <div className="flex min-w-0 flex-1 flex-col border-l border-edge">
                  <DetailColumn
                    dbSessionId={dbSessionId}
                    dbIndex={dbIndex}
                    selectedKey={detail.selectedKey}
                    detail={detail.keyDetail}
                    detailLoading={detail.detailLoading}
                    modules={modules}
                    onRefresh={reloadDetail}
                    onRenamed={(newKey) => {
                      detail.retargetKey(newKey);
                      refreshKeys();
                    }}
                    onDirtyChange={detail.setEditorDirty}
                    onClose={detail.clearDetail}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-fg-muted">
              <div className="text-center" data-testid="redis-select-db-state">
                <Database className="mx-auto h-10 w-10 opacity-20" />
                <div className="mt-3 text-sm">{t('redis.selectDb')}</div>
              </div>
            </div>
          )}
        </div>

        <ImportExport
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          selectedKeys={[...selection.selectedKeys]}
          searchPattern={searchPattern}
          open={overlays.importExportOpen}
          onOpenChange={overlays.setImportExportOpen}
          onRefresh={refreshKeys}
          onSummary={overlays.setBatchSummary}
        />

        <KeyWorkbenchDialogs
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          allowFlush={allowFlush}
          createTypes={createTypes}
          selectedKey={detail.selectedKey}
          onRefreshKeys={refreshKeys}
          onSelectKey={detail.selectKey}
          onClearSelectedKey={detail.clearDetail}
          onUpdateSelectedKey={detail.retargetKey}
          onUpdateSelectedKeys={selection.update}
          onBatchSummary={overlays.setBatchSummary}
          createOpen={overlays.createOpen}
          onCreateOpenChange={overlays.setCreateOpen}
          flushDialog={overlays.flushDialog}
          onFlushDialogChange={overlays.setFlushDialog}
          keyCtxDialog={overlays.keyCtxDialog}
          onKeyCtxDialogChange={overlays.setKeyCtxDialog}
        />

        {actionDialogs}
      </div>
    );
  },
);
