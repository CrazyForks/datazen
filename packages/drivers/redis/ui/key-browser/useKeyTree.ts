import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeListChildren } from '../shared/redisInvoke';
import { DEFAULT_SEPARATOR } from './keyTree';
import {
  EMPTY_LEVEL,
  anyLevelScanning,
  applyFetch,
  beginFetch,
  fetchCursorFor,
  markFetchFailed,
  rootLevelFailed,
  type LevelFetchMode,
  type TreeLevel,
} from './treeLevels';

const PAGE_SIZE = 500;

export interface UseKeyTreeOptions {
  dbSessionId: string;
  dbIndex: number;
  enabled: boolean;
  noTtlOnly?: boolean;
  keyType?: string;
  /**
   * R3 grouping separator (D-3). Sent to `list_children` as `sep` — previously the
   * call omitted it and silently used the server default, so the UI could show a
   * `:` tree while claiming to group on `.` — and it is part of the reset trigger:
   * prefixes belong to one separator, so switching means a new tree.
   */
  separator?: string;
}

/**
 * Server-driven hierarchical key tree. Each expanded folder prefix owns one
 * `list_children` level (leaf keys + virtual folders) with its own SCAN cursor.
 *
 * The level transitions themselves live in `treeLevels.ts` as pure functions:
 * I-4 ("a refresh or a collapse never throws away what is loaded") is a property
 * of that sequence, and folding replies here is the only way to replay it in a
 * test. What stays in this hook is scheduling: one in-flight request per prefix
 * (`reqSeq` drops stale replies), reset on db/filter/separator change, and
 * `rescan` on refresh.
 */
export function useKeyTree({
  dbSessionId,
  dbIndex,
  enabled,
  noTtlOnly = false,
  keyType = 'all',
  separator,
}: UseKeyTreeOptions) {
  const [levels, setLevels] = useState<Record<string, TreeLevel>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set<string>());
  const [rootLoading, setRootLoading] = useState(false);
  // Single synchronous source of truth for the fold functions: reading `levels`
  // inside an async callback would replay a stale cursor (the bug this replaces).
  const levelsRef = useRef<Record<string, TreeLevel>>({});
  const expandedRef = useRef<Set<string>>(expanded);
  // Guards against out-of-order responses when a prefix refetches quickly.
  const reqSeq = useRef<Record<string, number>>({});

  const sep = separator && separator.length > 0 ? separator : DEFAULT_SEPARATOR;

  const writeLevel = useCallback((prefix: string, next: TreeLevel) => {
    levelsRef.current = { ...levelsRef.current, [prefix]: next };
    setLevels(levelsRef.current);
  }, []);

  const fetchLevel = useCallback(
    async (prefix: string, mode: LevelFetchMode) => {
      const seq = (reqSeq.current[prefix] ?? 0) + 1;
      reqSeq.current[prefix] = seq;
      const isRoot = prefix === '';
      if (isRoot) setRootLoading(true);
      const before = levelsRef.current[prefix] ?? EMPTY_LEVEL;
      const started = beginFetch(before, mode);
      writeLevel(prefix, started);
      try {
        const result = await invokeListChildren(
          dbSessionId,
          dbIndex,
          prefix,
          fetchCursorFor(before, mode),
          PAGE_SIZE,
          { sep, noTtlOnly, keyType },
        );
        if (reqSeq.current[prefix] !== seq) return; // stale response
        writeLevel(prefix, applyFetch(started, mode, result));
      } catch (e) {
        console.error('list_children failed:', e);
        if (reqSeq.current[prefix] === seq) writeLevel(prefix, markFetchFailed(started, mode));
      } finally {
        if (isRoot && reqSeq.current[prefix] === seq) setRootLoading(false);
      }
    },
    [dbSessionId, dbIndex, noTtlOnly, keyType, sep, writeLevel],
  );

  /**
   * Start over: this is a *different* tree (db switch, filter change, separator
   * change), not a refresh. Still re-fetches every open prefix, because a folder
   * left expanded has to be filled again — otherwise it renders as expanded and
   * empty (I-4's "collapse and re-expand shows the same rows" needs it too).
   */
  const loadRoot = useCallback(() => {
    reqSeq.current = {};
    levelsRef.current = {};
    setLevels({});
    void fetchLevel('', 'reset');
    for (const prefix of expandedRef.current) {
      if (prefix) void fetchLevel(prefix, 'reset');
    }
  }, [fetchLevel]);

  useEffect(() => {
    if (!enabled) return;
    loadRoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only on db / filter / separator changes
  }, [enabled, dbSessionId, dbIndex, noTtlOnly, keyType, sep]);

  /** Expand or collapse a folder. Collapsing keeps the level (I-4). */
  const toggleFolder = useCallback(
    (prefix: string) => {
      const next = new Set(expandedRef.current);
      if (next.has(prefix)) {
        next.delete(prefix);
      } else {
        next.add(prefix);
        if (!levelsRef.current[prefix]) void fetchLevel(prefix, 'reset');
      }
      expandedRef.current = next;
      setExpanded(next);
    },
    [fetchLevel],
  );

  /** Page one level forward from its own stored cursor. */
  const loadMore = useCallback(
    (prefix: string) => {
      const level = levelsRef.current[prefix];
      if (level && !level.done && !level.loading) void fetchLevel(prefix, 'continue');
    },
    [fetchLevel],
  );

  /**
   * ⌘R / post-write refresh (I-4). No `setLevels({})`: every *loaded* level keeps
   * its children and its cursor, a finished level restarts an authoritative pass
   * that only lands when it wraps, and an unfinished one just continues.
   */
  const refresh = useCallback(() => {
    const targets = new Set<string>(['' as string, ...Object.keys(levelsRef.current)]);
    for (const prefix of expandedRef.current) targets.add(prefix);
    for (const prefix of targets) void fetchLevel(prefix, 'rescan');
  }, [fetchLevel]);

  /** Forget the whole tree (db switch driven from the outside). */
  const clearTree = useCallback(() => {
    reqSeq.current = {};
    levelsRef.current = {};
    expandedRef.current = new Set();
    setLevels({});
    setExpanded(expandedRef.current);
  }, []);

  return {
    levels,
    expanded,
    rootLoading,
    /** Root `list_children` rejected ⇒ D-8's named `no-permission` state. */
    rootError: rootLevelFailed(levels),
    /** Any level still scanning ⇒ R1's `N+` and D-8's `interrupted`. */
    scanning: anyLevelScanning(levels),
    toggleFolder,
    loadMore,
    refresh,
    loadRoot,
    clearTree,
  };
}

export type KeyTreeState = ReturnType<typeof useKeyTree>;
export type { TreeLevel };
