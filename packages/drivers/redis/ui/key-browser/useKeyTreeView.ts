import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyEntry } from '@datazen/driver-sdk';
import { buildFlatTreeRows, buildServerTreeRows } from './keyTree';
import { resolveTreeEmptyState, type TreeEmptyState } from './treeEmptyState';
import {
  readTreePrefs,
  treePrefsBucket,
  writeTreePrefs,
  type TreePrefs,
  type TreeViewMode,
} from './treePreferences';
import { useKeyTree } from './useKeyTree';

/**
 * R3's view state, in the two halves the composition root needs at different
 * times (task book D-3 + D-8):
 *
 *  - {@link useTreePreferences} is the *durable* half (tree-vs-list + the
 *    grouping separator, persisted per connection). It has to run before
 *    `useKeyTree`, because the separator is a `list_children` argument: the
 *    server folds on the same character the UI shows.
 *  - {@link useKeyTreeView} is the *derivation* half: the row list for whichever
 *    mode is on, and which of the four named empty states (I-11) applies.
 *
 * Carving both out of `RedisWorkbench` is what keeps that file at its D-0 size
 * budget instead of re-growing it ("不许换个地方堆") — the workbench stays one
 * line per half.
 */
export interface UseTreePreferencesOptions {
  /** Stable host connection id when available; falls back to the live session. */
  connectionId?: string;
  dbSessionId: string;
}

export function useTreePreferences({ connectionId, dbSessionId }: UseTreePreferencesOptions) {
  const bucket = treePrefsBucket(connectionId, dbSessionId);
  const [prefs, setPrefs] = useState<TreePrefs>(() => readTreePrefs(bucket));

  // A different connection — or a reconnect, which changes the session bucket —
  // re-reads its own persisted pair instead of inheriting the previous one.
  useEffect(() => {
    setPrefs(readTreePrefs(bucket));
  }, [bucket]);

  const persist = useCallback(
    (next: TreePrefs) => {
      setPrefs(next);
      writeTreePrefs(bucket, next);
    },
    [bucket],
  );

  const setView = useCallback(
    (view: TreeViewMode) => persist({ ...prefs, view }),
    [persist, prefs],
  );

  const setSeparator = useCallback(
    (separator: string) => persist({ ...prefs, separator }),
    [persist, prefs],
  );

  return { view: prefs.view, separator: prefs.separator, setView, setSeparator, bucket };
}

export interface UseKeyTreeViewOptions {
  /* ── forwarded to `useKeyTree` ──────────────────────────────────────────── */
  dbSessionId: string;
  dbIndex: number;
  enabled: boolean;
  noTtlOnly: boolean;
  keyType: string;
  /** Stable host connection id when available; falls back to the live session. */
  connectionId?: string;
  /* ── the flat `scan_keys` list, i.e. what `list` mode shows ─────────────── */
  loadedKeys: KeyEntry[];
  pattern: string;
  loading: boolean;
  /** Scan cursor of the flat list still open. */
  scanOpen: boolean;
}

/**
 * Composition of the two halves above: preferences → server-driven levels →
 * rows → named empty state. One call site, because the separator has to reach
 * both the `list_children` request *and* the row fold, and a second one anywhere
 * else is how the UI ends up claiming a `.` tree over a `:` scan.
 */
export function useKeyTreeView({
  connectionId,
  dbSessionId,
  dbIndex,
  enabled,
  noTtlOnly,
  keyType,
  loadedKeys,
  pattern,
  loading,
  scanOpen,
}: UseKeyTreeViewOptions) {
  const prefs = useTreePreferences({ connectionId, dbSessionId });
  const tree = useKeyTree({ dbSessionId, dbIndex, enabled, noTtlOnly, keyType, separator: prefs.separator });

  /*
   * The separator is not a client-side cosmetic: switching it re-fetches the
   * server levels (see `useKeyTree`), so `treeRows` keys off it here rather than
   * post-processing a `:`-built tree. `list` turns namespace folding off entirely,
   * which is the escape hatch for keys whose names contain the separator.
   */
  const treeRows = useMemo(() => {
    if (prefs.view === 'list') return buildFlatTreeRows(loadedKeys);
    return buildServerTreeRows(tree.levels, tree.expanded, prefs.separator);
  }, [prefs.view, prefs.separator, tree.levels, tree.expanded, loadedKeys]);

  const scanning = tree.scanning || scanOpen;

  const emptyState: TreeEmptyState | null = useMemo(
    () =>
      resolveTreeEmptyState({
        rowCount: treeRows.length,
        loading,
        rootError: tree.rootError,
        scanning,
        pattern,
        keyType,
        noTtlOnly,
      }),
    [treeRows.length, loading, tree.rootError, scanning, pattern, keyType, noTtlOnly],
  );

  return {
    tree,
    mode: prefs.view,
    separator: prefs.separator,
    setMode: prefs.setView,
    setSeparator: prefs.setSeparator,
    treeRows,
    emptyState,
    scanning,
  };
}

/** What {@link KeyTreePane} consumes: the view, its rows and the owned tree state. */
export type KeyTreeView = ReturnType<typeof useKeyTreeView>;
