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
import { BatchPatternBar } from './BatchBar';
import { ImportExport } from './ImportExport';
import { KeyTreePane } from './KeyTreePane';
import { useBatchActions } from './useBatchActions';
import { DetailColumn } from './DetailColumn';
import { useRedisKeyScan } from './useRedisKeyScan';
import { useKeyTreeView } from './useKeyTreeView';
import { KeyWorkbenchDialogs } from './KeyWorkbenchDialogs';
import { mergeDatabases, dbIndexOfName } from './workbenchDatabases';
import { DbSidebar } from './DbSidebar';
import { BatchSummaryBanner, WorkbenchToolbar } from './WorkbenchToolbar';
import { useWorkbenchSplit } from './useWorkbenchSplit';
import { useKeySelection } from './useKeySelection';
import { useKeyDetailState } from './useKeyDetailState';
import { useKeyRowActions } from './useKeyRowActions';
import { useKvSlotRelay } from './useKvSlotRelay';
import { useWorkbenchSearch } from './useWorkbenchSearch';
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
 * `KeyTreePane` — the whole left column, R1/R2/R3 header plus the list —,
 * `DetailColumn`, `useRedisKeyScan`/`useKeyTreeView`, the `useKey*` state hooks,
 * `useWorkbenchOverlays` and `KeyWorkbenchDialogs`). What stays here is only what
 * genuinely has to be shared: the single writers of selection and detail state,
 * the refresh fan-out (including the I-8 "refresh without dropping the
 * selection" variant), the host KV relay (contract F-2) and the imperative handle
 * the host tabs drive.
 */
export const RedisWorkbench = forwardRef<RedisWorkbenchHandle, RedisWorkbenchProps>(
  function RedisWorkbench(
    {
      dbSessionId,
      connectionId,
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
    // R2 chip: wrap a literal input in `*…*` when applying (see toScanPattern).
    const [fuzzyPattern, setFuzzyPattern] = useState(false);

    const overlays = useWorkbenchOverlays();
    const { treeWidth, startSplitDrag } = useWorkbenchSplit();
    const selection = useKeySelection();
    const detail = useKeyDetailState(dbSessionId, dbIndex);

    // Flat `scan_keys` list — kept as one object (`scan.*`) because 屏 B reads a
    // dozen of its fields and a destructure block is 18 lines of noise.
    const scan = useRedisKeyScan({
      dbSessionId,
      dbIndex,
      enabled: selectedDb !== null,
    });

    /*
     * D-3 + D-8 in a single owner: the R3 separator has to reach both the
     * `list_children` request and the row fold (two places, one value), and the
     * four named empty states (I-11) are derived from the same rows.
     */
    const treeView = useKeyTreeView({
      connectionId,
      dbSessionId,
      dbIndex,
      enabled: selectedDb !== null,
      noTtlOnly: scan.noTtlOnly,
      keyType: scan.keyTypeFilter,
      loadedKeys: scan.keys,
      pattern: scan.searchPattern,
      loading: scan.keysLoading,
      scanOpen: scan.cursor !== 0,
    });

    useEffect(() => {
      void loadForConnection(dbSessionId, { skipLoadTables: true });
    }, [dbSessionId, loadForConnection]);

    // Stable identities: `scan` / `treeView` are fresh objects every render, and
    // listing them in a dependency array would churn every callback below.
    const tree = treeView.tree;
    const { setSearchPattern, resetSelectionState, loadKeys, refresh: scanRefresh } = scan;

    const modules = useReJsonModules(dbSessionId);
    const { dbCounts, loadDbSizes } = useDbKeyCounts(
      dbSessionId,
      dbIndex,
      selectedDb,
      scan.dbSize,
    );
    const createTypes = useCreateTypes(modules);

    /** Drop the mounted detail *and* the checkbox selection (db switch, refresh). */
    const clearFocus = useCallback(() => {
      detail.clearDetail();
      selection.clearSelection();
    }, [detail.clearDetail, selection.clearSelection]);

    const search = useWorkbenchSearch({
      dbSessionId,
      dbIndex,
      clearFocus,
      runKeySearch: scan.search,
    });

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
      [clearFocus, setSearchPattern, resetSelectionState, loadKeys, onDatabaseChange, onDbIndexChange],
    );

    useEffect(() => {
      onKeysChange?.(scan.keys.map((entry) => entry.key));
    }, [scan.keys, onKeysChange]);

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
    }, [selectedDb, clearFocus, scanRefresh, tree.refresh]);

    const handleRefresh = useCallback(() => {
      void loadForConnection(dbSessionId, { skipLoadTables: true });
      refreshKeys();
      loadDbSizes();
    }, [dbSessionId, loadForConnection, refreshKeys, loadDbSizes]);

    /*
     * I-8 (D-6): a batch write reloads the *data* only. `refreshKeys` also drops
     * the selection, which would silently undo "failed keys stay selected" the
     * moment the post-write refresh lands, so the batch controller gets this one.
     */
    const refreshAfterWrite = useCallback(() => {
      scanRefresh();
      tree.refresh();
    }, [scanRefresh, tree.refresh]);

    useImperativeHandle(ref, () => ({ refreshKeys, selectDatabase: handleSelectDb }), [
      refreshKeys,
      handleSelectDb,
    ]);

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

    // One controller for every batch write; the R1 header and the pattern strip
    // are two trigger surfaces over the same dialogs (D-1).
    const batchActions = useBatchActions({
      dbSessionId,
      dbIndex,
      selectedKeys: [...selection.selectedKeys],
      searchPattern: scan.searchPattern,
      onRemoveFromSelection: selection.removeKeys,
      onRefresh: refreshAfterWrite,
      onSummary: overlays.setBatchSummary,
    });

    return (
      <div className="flex min-h-0 flex-1">
        {!hideSidebar && (
          <DbSidebar
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
                dbSize={scan.dbSize}
                loadedCount={scan.keys.length}
                hasMore={scan.cursor !== 0}
                withMemory={scan.withMemory}
                onWithMemoryChange={scan.setWithMemory}
                allowFlush={allowFlush}
                onImportExport={() => overlays.setImportExportOpen(true)}
                onFlushDb={() => overlays.setFlushDialog('db')}
                onFlushAll={() => overlays.setFlushDialog('all')}
              />

              <BatchSummaryBanner
                summary={overlays.batchSummary}
                onDismiss={() => overlays.setBatchSummary(null)}
              />

              <BatchPatternBar actions={batchActions} dbIndex={dbIndex} />

              <div className="flex min-h-0 flex-1">
                <div
                  className="flex min-w-0 shrink-0 flex-col"
                  style={{ width: treeWidth }}
                  data-testid="redis-tree-pane"
                  data-tree-width={treeWidth}
                >
                  <KeyTreePane
                    view={treeView}
                    scan={scan}
                    search={search}
                    selection={selection}
                    detail={detail}
                    batch={batchActions}
                    onKeyContextMenu={handleKeyContextMenu}
                    onDeleteRow={handleDeleteRow}
                    totalCount={scan.dbSize}
                    fuzzy={fuzzyPattern}
                    onFuzzyChange={setFuzzyPattern}
                    onCreateKey={() => overlays.setCreateOpen(true)}
                    onRefresh={handleRefresh}
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
          searchPattern={scan.searchPattern}
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
        {batchActions.dialogs}
      </div>
    );
  },
);
