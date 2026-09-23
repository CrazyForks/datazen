import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Database, FolderInput, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { Button, cn } from '@datazen/ui';
import { Input } from '@datazen/ui';
import {
  useBoundSchemaStore,
  useBoundSettingsStore,
  showNativeContextMenu,
  readBooleanField,
  useBoundConfirmDialog,
  type KvSlotState,
} from '@datazen/driver-sdk';
import { useI18n } from '@datazen/ui';
import { invokeGetKey, invokeDbSizes } from '../shared/redisInvoke';
import type { KeyDetail } from '../shared/types';
import { BatchBar, invokeDeleteKeys, invokeBatchDeletePattern } from './BatchBar';
import { hasRedisJson } from '../value-editors/hasRedisJson';
import { ImportExport } from './ImportExport';
import { invokeModulesList } from '../value-editors/JsonEditor';
import { buildRedisKeyContextMenuItems } from './redisKeyContextMenu';
import { KeyBrowserControls } from './KeyBrowserControls';
import { SafeModeBadge } from '../shared/SafeModeBadge';
import type { KeyTreeDeleteTarget } from './KeyTreeList';
import { KeyTreeColumn } from './KeyTreeColumn';
import { DetailColumn } from './DetailColumn';
import { SearchModeTabs, type SearchMode } from './SearchModeTabs';
import { useValueSearch } from '../value-search/useValueSearch';
import { useRedisKeyScan } from './useRedisKeyScan';
import { useKeyTree } from './useKeyTree';
import { useRedisGate } from '../shared/useRedisGate';
import { isDraftDirty, requestDraftLeave } from '../shared/draftGuard';
import { buildServerTreeRows } from './keyTree';
import {
  KeyWorkbenchDialogs,
  openKeyCtxDelete,
  openKeyCtxRename,
  openKeyCtxTtl,
  type KeyCtxDialog,
} from './KeyWorkbenchDialogs';

const REDIS_DB_COUNT = 16;

export interface RedisWorkbenchProps {
  dbSessionId: string;
  initialDatabase?: string;
  hideSidebar?: boolean;
  onDbIndexChange?: (dbIndex: number) => void;
  onDatabaseChange?: (database: string) => void;
  onKeysChange?: (keys: string[]) => void;
  /**
   * Host-owned selection/dirty atom of this panel (`driver-sdk` `KvSlotState`),
   * forwarded by `RedisConnectionView`. The workbench is the only writer: the
   * host-rendered KV slots read selection and dirtiness from here instead of
   * calling back into the driver (PRD §7-2, contract F-2). Absent when the
   * driver declares no KV slot capability, so every publish below is optional.
   */
  kvSlotState?: KvSlotState;
}

export interface RedisWorkbenchHandle {
  refreshKeys: () => void;
  selectDatabase: (db: string) => void;
}

function allRedisDbs(): string[] {
  return Array.from({ length: REDIS_DB_COUNT }, (_, i) => `db${i}`);
}

function mergeDatabases(fromServer: string[]): string[] {
  const extras = fromServer.filter((db) => !/^db(\d+)$/.test(db));
  return [...allRedisDbs(), ...extras];
}

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
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    const [keyDetail, setKeyDetail] = useState<KeyDetail | null>(null);
    const [keyDetailLoading, setKeyDetailLoading] = useState(false);
    // Unsaved draft of the mounted detail editor, mirrored to the host relay
    // below. `DetailColumn` owns who reports it; this state is what gets published.
    const [editorDirty, setEditorDirty] = useState(false);
    const [batchSummary, setBatchSummary] = useState<string | null>(null);
    const [modules, setModules] = useState<string[] | null>(null);
    const [importExportOpen, setImportExportOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [flushDialog, setFlushDialog] = useState<'db' | 'all' | null>(null);
    const [keyCtxDialog, setKeyCtxDialog] = useState<KeyCtxDialog>(null);
    const [dbCounts, setDbCounts] = useState<Record<number, number>>({});
    const [searchMode, setSearchMode] = useState<SearchMode>('key');
    const [treeWidth, setTreeWidth] = useState(360);

    const startSplitDrag = useCallback(
      (e: ReactMouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = treeWidth;
        const onMove = (ev: globalThis.MouseEvent) => {
          const next = Math.min(900, Math.max(220, startWidth + ev.clientX - startX));
          setTreeWidth(next);
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      },
      [treeWidth],
    );

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

    const { gateWrite, gateDialog } = useRedisGate();
    const [confirmDelete, confirmDeleteDialog] = useBoundConfirmDialog();

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

    useEffect(() => {
      let cancelled = false;
      setModules(null);
      void invokeModulesList(dbSessionId)
        .then((list) => {
          if (!cancelled) setModules(list);
        })
        .catch(() => {
          if (!cancelled) setModules([]);
        });
      return () => {
        cancelled = true;
      };
    }, [dbSessionId]);

    const loadDbSizes = useCallback(() => {
      void invokeDbSizes(dbSessionId)
        .then((sizes) => {
          const map: Record<number, number> = {};
          for (const s of sizes) map[s.db] = s.keys;
          setDbCounts(map);
        })
        .catch(() => {
          /* counts are best-effort enrichment */
        });
    }, [dbSessionId]);

    // Fetch key counts for every db when entering Items for a session.
    useEffect(() => {
      loadDbSizes();
    }, [loadDbSizes]);

    // Keep the active db's count fresh from scan_keys' dbSize, zero extra commands.
    useEffect(() => {
      if (selectedDb) {
        setDbCounts((prev) => (prev[dbIndex] === dbSize ? prev : { ...prev, [dbIndex]: dbSize }));
      }
    }, [selectedDb, dbIndex, dbSize]);

    const createTypes = useMemo(() => {
      const base = ['string', 'hash', 'list', 'set', 'zset'];
      if (modules && hasRedisJson(modules)) {
        return [...base, 'ReJSON'];
      }
      return base;
    }, [modules]);

    const handleSelectDb = useCallback(
      async (db: string) => {
        const idx = parseInt(db.replace('db', ''), 10) || 0;
        // Same-db re-click (including the initial auto-select) is not a 切db —
        // never route it through the I-1 leave dialog.
        if (selectedDb === db && dbIndex === idx) return;
        // I-1: switching databases drops the selection, i.e. the live draft.
        if (!(await requestDraftLeave())) return;
        setSelectedDb(db);
        setDbIndex(idx);
        onDbIndexChange?.(idx);
        onDatabaseChange?.(db);
        setSelectedKey(null);
        setSelectedKeys(new Set());
        setKeyDetail(null);
        setEditorDirty(false);
        setSearchPattern('*');
        resetSelectionState();
        void loadKeys(idx, '*', 0, true);
      },
      [
        selectedDb,
        dbIndex,
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
        if (initial) void handleSelectDb(initial);
      }
    }, [databases, initialDatabase, selectedDb, handleSelectDb]);

    const refreshKeys = useCallback(async () => {
      if (!selectedDb) return;
      // I-1: this body drops the selection (the draft with it), so every
      // refresh — toolbar, delete-row, rename, batch, import — asks first.
      if (!(await requestDraftLeave())) return;
      setSelectedKey(null);
      setSelectedKeys(new Set());
      setKeyDetail(null);
      setEditorDirty(false);
      scanRefresh();
      tree.refresh();
    }, [selectedDb, scanRefresh, tree]);

    const handleRefresh = useCallback(async () => {
      // Toolbar 刷新 is a named I-1 interception point: refuse ⇒ nothing reloads.
      if (!(await requestDraftLeave())) return;
      void loadForConnection(dbSessionId, { skipLoadTables: true });
      void refreshKeys();
      void loadDbSizes();
    }, [dbSessionId, loadForConnection, refreshKeys, loadDbSizes]);

    useImperativeHandle(ref, () => ({ refreshKeys, selectDatabase: handleSelectDb }), [
      refreshKeys,
      handleSelectDb,
    ]);

    const handleSearch = useCallback(async () => {
      // I-1: a search replaces the selection ⇒ the draft. Ask before running.
      if (!(await requestDraftLeave())) return;
      setSelectedKey(null);
      setSelectedKeys(new Set());
      setKeyDetail(null);
      setEditorDirty(false);
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
    }, [searchMode, scanSearch, searchPattern, startValueSearch, resetValueSearch]);

    const handleSelectKey = useCallback(
      async (key: string) => {
        // BUG-007: `selectedKey` and `keyDetail.key` can disagree — the ctx
        // rename updates the selection BEFORE the guard answers (deviation ⑥;
        // the round-2 probe P1a pins label=new / detail=old, so the pair never
        // resyncs on its own while the draft lives). A same-key refetch across
        // that gap is NOT the in-place one (`inPlace` below needs both to
        // match): it flips `loading`, `key={detail.key}` remounts the editor,
        // and its unmount cleanup wipes the draft silently — the BUG-001 class
        // again. Re-ask here instead: one choke point covering EVERY same-key
        // entry (tree row via the guarded handle, header reload via
        // `reloadDetail`, dialog refetches). Ask-free paths stay ask-free:
        // consistent-state refetches (`keyDetail.key === key`, BUG-001/H2) and
        // post-write reloads (draft already clean ⇒ the guard resolves with no
        // dialog). Discard heals the gap (the fresh detail carries the new
        // key); keep leaves it, but every next same-key click re-asks —
        // bounded, never silent.
        if (key === selectedKey && keyDetail?.key !== key) {
          if (!(await requestDraftLeave())) return;
        }
        // BUG-001: refetching the detail that is ALREADY mounted must not flip
        // `DetailColumn` into `loading` — the loading branch replaces the
        // editor, and its unmount cleanup wipes the draft silently. Same-key
        // refetches (tree re-click, header refresh, post-write reload, dialog
        // TTL/PERSIST refetch) stay in place; a fresh selection still reports
        // loading exactly as before.
        const inPlace = key === selectedKey && keyDetail?.key === key;
        setSelectedKey(key);
        if (!inPlace) setKeyDetailLoading(true);
        try {
          const detail = await invokeGetKey(dbSessionId, dbIndex, key);
          setKeyDetail(detail);
        } catch (e) {
          console.error('get_key failed:', e);
          // In-place failure keeps the mounted editor (and its draft) intact.
          if (!inPlace) setKeyDetail(null);
        } finally {
          if (!inPlace) setKeyDetailLoading(false);
        }
      },
      [dbSessionId, dbIndex, selectedKey, keyDetail],
    );

    /**
     * Tree-row click (I-1 切键): switching to ANOTHER key must pass the leave
     * dialog first. Re-clicking the selected key is a plain IN-PLACE refetch —
     * `handleSelectKey` keeps the mounted detail (no `loading` flip), so the
     * draft survives by construction (BUG-001) and there is nothing to ask.
     * `handleSelectKey` itself stays raw because `reloadDetail` and post-write
     * flows must bypass the guard on purpose; the dialog side receives this
     * guarded handle instead (BUG-002: 创建 / TTL / PERSIST / 重命名出口).
     */
    const handleSelectKeyGuarded = useCallback(
      async (key: string) => {
        if (key === selectedKey) {
          await handleSelectKey(key);
          return;
        }
        if (!(await requestDraftLeave())) return;
        await handleSelectKey(key);
      },
      [selectedKey, handleSelectKey],
    );

    const reloadDetail = useCallback(async () => {
      if (!selectedKey) return;
      // E-5 fix: refetch the DETAIL only. The old `refreshKeys()` cleared the
      // selection — its I-1 body drops the draft — so every save used to close
      // the panel. The list gets a direct scan/tree refresh instead (unguarded:
      // this runs after a successful save, when the draft is already gone).
      await handleSelectKey(selectedKey);
      scanRefresh();
      tree.refresh();
    }, [selectedKey, handleSelectKey, scanRefresh, tree]);

    /* ── host KV relay ───────────────────────────────────────────────────────
     * Contract F-2: the host-rendered KV slots never ask the workbench for
     * anything — they read selection and dirtiness off the per-panel
     * `KvSlotState` the host hands down. Publishing is write-only and
     * field-granular (`selectKey` / `setDirty`), so a slot subscribing to
     * `getSelectedKey()` re-renders on selection, not on every state change.
     *
     * Dirty invariant: `editorDirty` can only be true while a detail editor with
     * an unsaved draft is mounted — `StringEditor` publishes `false` when it
     * unmounts, and the paths that drop the selection reset it here.
     */
    useEffect(() => {
      kvSlotState?.selectKey(selectedKey);
    }, [kvSlotState, selectedKey]);

    useEffect(() => {
      kvSlotState?.setDirty(editorDirty);
    }, [kvSlotState, editorDirty]);

    useEffect(() => {
      if (!kvSlotState) return;
      return () => {
        // Unmount / session swap: a later mount must not inherit a key that is
        // no longer rendered, nor a draft that no longer exists.
        kvSlotState.selectKey(null);
        kvSlotState.setDirty(false);
      };
    }, [kvSlotState, dbSessionId]);

    const toggleKeySelection = (key: string, checked: boolean) => {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (checked) next.add(key);
        else next.delete(key);
        return next;
      });
    };

    const toggleKeysSelection = (keysToToggle: string[], checked: boolean) => {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        for (const key of keysToToggle) {
          if (checked) next.add(key);
          else next.delete(key);
        }
        return next;
      });
    };

    const handleKeyContextMenu = useCallback(
      (e: ReactMouseEvent, key: string) => {
        e.preventDefault();
        e.stopPropagation();
        void showNativeContextMenu(
          buildRedisKeyContextMenuItems({
            labels: {
              copyKey: t('common.copyName'),
              setTtl: t('redis.setTtl'),
              rename: t('redis.renameKey'),
              delete: t('common.delete'),
            },
            handlers: {
              onCopyKey: () => {
                void navigator.clipboard.writeText(key);
              },
              onSetTtl: () => setKeyCtxDialog(openKeyCtxTtl(key)),
              onRename: () => setKeyCtxDialog(openKeyCtxRename(key)),
              onDelete: () => setKeyCtxDialog(openKeyCtxDelete(key)),
            },
          }),
          { x: e.clientX, y: e.clientY },
        );
      },
      [t],
    );

    const handleDeleteRow = useCallback(
      async (target: KeyTreeDeleteTarget) => {
        const ok = await confirmDelete({
          title: t('redis.delete'),
          message:
            target.kind === 'folder'
              ? t('redis.deleteFolderConfirm')
                  .replace('{count}', String(target.count))
                  .replace('{label}', target.label)
              : t('redis.deleteKeyConfirm').replace('{key}', target.key),
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
          kind: 'warning',
        });
        if (!ok) return;
        if (!(await gateWrite('write-op'))) return;
        try {
          const deleted =
            target.kind === 'folder'
              ? (await invokeBatchDeletePattern(dbSessionId, dbIndex, `${target.prefix}*`)).deleted
              : await invokeDeleteKeys(dbSessionId, dbIndex, [target.key]);
          setBatchSummary(t('redis.deleted').replace('{count}', String(deleted)));
          void refreshKeys();
        } catch (e) {
          setBatchSummary(e instanceof Error ? e.message : String(e));
        }
      },
      [confirmDelete, gateWrite, dbSessionId, dbIndex, t, refreshKeys],
    );

    /**
     * Dialog-side refresh (创建 / TTL / PERSIST / 重命名 / 删除 / flush 出口,
     * BUG-002). Those flows manage the selection through their own guarded
     * outlets (`onSelectKey` / `onClearSelectedKey` below), so while a draft
     * is live this refresh must NOT run `refreshKeys`' destructive body: it
     * would drop the draft outside any guard, or stack a SECOND leave dialog
     * on the same user action (双弹). It only re-scans the list — no selection,
     * no detail, no dirty flag touched. Clean state keeps today's behaviour.
     */
    const refreshKeysForDialogs = useCallback(() => {
      if (isDraftDirty()) {
        scanRefresh();
        tree.refresh();
        return;
      }
      void refreshKeys();
    }, [scanRefresh, tree, refreshKeys]);

    return (
      <div className="flex min-h-0 flex-1">
        {!hideSidebar && (
          <aside className="flex w-48 shrink-0 flex-col overflow-y-auto border-r border-edge bg-surface-alt">
            <div className="border-b border-edge p-2">
              <div className="mb-2">
                <SearchModeTabs mode={searchMode} onChange={setSearchMode} />
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
                <Input
                  value={searchPattern}
                  onChange={(e) => setSearchPattern(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSearch();
                  }}
                  placeholder={
                    searchMode === 'key'
                      ? t('redis.searchKeys')
                      : t('redis.search.valuePlaceholder')
                  }
                  className="h-7 pl-7 text-xs"
                  data-testid="redis-search-input"
                />
              </div>
            </div>

            {loading && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('common.loading')}
              </div>
            )}

            {databases.map((db) => (
              <button
                key={db}
                type="button"
                className={cn(
                  'flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                  selectedDb === db
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-fg-secondary hover:bg-surface-raised hover:text-fg',
                )}
                aria-current={selectedDb === db ? 'page' : undefined}
                data-testid={`redis-db-${db}`}
                onClick={() => handleSelectDb(db)}
              >
                <Database className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{db}</span>
                {dbCounts[Number(db.replace('db', ''))] != null && (
                  <span className="ml-auto shrink-0 text-[11px] text-fg-muted">
                    ({dbCounts[Number(db.replace('db', ''))]})
                  </span>
                )}
              </button>
            ))}
          </aside>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selectedDb ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-edge bg-surface-alt px-3 py-1.5 text-xs text-fg-secondary">
                <span>{selectedDb}</span>
                <span className="text-edge">|</span>
                <span>{t('redis.dbSize').replace('{count}', String(dbSize))}</span>
                <span className="text-edge">|</span>
                <span>
                  {t('redis.loadedCount').replace('{count}', String(keys.length))}
                  {cursor !== 0 && ` (${t('redis.loadMore')}…)`}
                </span>
                {searchMode === 'key' && (
                  <KeyBrowserControls
                    keyType={keyTypeFilter}
                    onKeyTypeChange={setKeyTypeFilter}
                    withMemory={withMemory}
                    onWithMemoryChange={setWithMemory}
                    noTtlOnly={noTtlOnly}
                    onNoTtlOnlyChange={setNoTtlOnly}
                  />
                )}
                <div className="flex-1" />
                <SafeModeBadge />
                <Button
                  variant="secondary"
                  className="h-7 gap-1 px-2 text-xs"
                  title={t('connWin.refresh')}
                  data-testid="redis-refresh"
                  onClick={handleRefresh}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t('redis.refresh')}
                </Button>
                <Button
                  variant="secondary"
                  className="h-7 gap-1 px-2 text-xs"
                  data-testid="redis-create-key"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('redis.createKey')}
                </Button>
                <Button
                  variant="secondary"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setImportExportOpen(true)}
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  {t('redis.importExportTitle')}
                </Button>
                {allowFlush && (
                  <>
                    <Button
                      variant="secondary"
                      className="h-7 px-2 text-xs text-danger"
                      onClick={() => setFlushDialog('db')}
                    >
                      {t('redis.flushDb')}
                    </Button>
                    <Button
                      variant="secondary"
                      className="h-7 px-2 text-xs text-danger"
                      onClick={() => setFlushDialog('all')}
                    >
                      {t('redis.flushAll')}
                    </Button>
                  </>
                )}
              </div>

              {batchSummary && (
                <div className="shrink-0 border-b border-edge bg-surface-alt px-3 py-1 text-xs text-fg-secondary">
                  {batchSummary}
                  <button
                    type="button"
                    className="ml-2 text-fg-muted hover:text-fg"
                    onClick={() => setBatchSummary(null)}
                  >
                    ×
                  </button>
                </div>
              )}

              <BatchBar
                dbSessionId={dbSessionId}
                dbIndex={dbIndex}
                selectedKeys={[...selectedKeys]}
                searchPattern={searchPattern}
                onClearSelection={() => setSelectedKeys(new Set())}
                onRefresh={refreshKeys}
                onSummary={setBatchSummary}
              />

              <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 shrink-0 flex-col" style={{ width: treeWidth }}>
                  <KeyTreeColumn
                    searchMode={searchMode}
                    treeRows={treeRows}
                    allKeys={keys.map((k) => k.key)}
                    expandedFolders={tree.expanded}
                    onToggleFolder={tree.toggleFolder}
                    selectedKey={selectedKey}
                    selectedKeys={selectedKeys}
                    onSelectKey={handleSelectKeyGuarded}
                    onToggleKey={toggleKeySelection}
                    onToggleKeys={toggleKeysSelection}
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
                    selectedKey={selectedKey}
                    detail={keyDetail}
                    detailLoading={keyDetailLoading}
                    modules={modules}
                    onRefresh={reloadDetail}
                    onRenamed={(newKey) => {
                      setSelectedKey(newKey);
                      // Draft already settled upstream (rename passes the I-1
                      // guard before it runs), so this refresh sails through.
                      void refreshKeys();
                    }}
                    onDirtyChange={setEditorDirty}
                    onClose={() => {
                      // I-1: closing the panel drops the draft ⇒ ask first.
                      void (async () => {
                        if (!(await requestDraftLeave())) return;
                        setSelectedKey(null);
                        setKeyDetail(null);
                        setEditorDirty(false);
                      })();
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-fg-muted">
              <div className="text-center">
                <Database className="mx-auto h-10 w-10 opacity-20" />
                <div className="mt-3 text-sm">{t('redis.selectDb')}</div>
              </div>
            </div>
          )}
        </div>

        <ImportExport
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          selectedKeys={[...selectedKeys]}
          searchPattern={searchPattern}
          open={importExportOpen}
          onOpenChange={setImportExportOpen}
          onRefresh={refreshKeys}
          onSummary={setBatchSummary}
        />

        <KeyWorkbenchDialogs
          dbSessionId={dbSessionId}
          dbIndex={dbIndex}
          allowFlush={allowFlush}
          createTypes={createTypes}
          selectedKey={selectedKey}
          onRefreshKeys={refreshKeysForDialogs}
          onSelectKey={handleSelectKeyGuarded}
          onClearSelectedKey={() => {
            // I-1: clearing the selection drops the draft ⇒ ask first.
            void (async () => {
              if (!(await requestDraftLeave())) return;
              setSelectedKey(null);
              setKeyDetail(null);
            })();
          }}
          onUpdateSelectedKeys={setSelectedKeys}
          onBatchSummary={setBatchSummary}
          createOpen={createOpen}
          onCreateOpenChange={setCreateOpen}
          flushDialog={flushDialog}
          onFlushDialogChange={setFlushDialog}
          keyCtxDialog={keyCtxDialog}
          onKeyCtxDialogChange={setKeyCtxDialog}
        />

        {gateDialog}
        {confirmDeleteDialog}
      </div>
    );
  },
);
