import { useCallback, useEffect, useState } from 'react';
import { useValueSearch } from '../value-search/useValueSearch';
import type { SearchMode } from './SearchModeTabs';
import type { ValueSearchState } from '../value-search/useValueSearch';

/**
 * Search scope of 屏 B: the `key | value | all` segment control (R1) and the
 * value-search task it drives.
 *
 * State machine (AGENTS.md 「状态机三要素」):
 *  - enter: picking `value`/`all` and applying a non-empty query starts a task;
 *  - state: the task reports progress through {@link valueSearchState}, and the
 *    result list replaces the tree in the same column (`KeyTreeColumn`);
 *  - exit: switching back to `key` **or** changing db/session resets the task,
 *    so a scan that no longer has a visible result list cannot keep polling;
 *    `Esc`/cancel in the result list cancels it too.
 *
 * An empty query in value mode is a *reset*, not a no-op — otherwise the previous
 * hit list would keep showing for a pattern the input no longer contains.
 */

export interface WorkbenchSearchOptions {
  dbSessionId: string;
  dbIndex: number;
  /** Applying a search drops the mounted detail + selection (same as before). */
  clearFocus: () => void;
  /** Key mode: re-scan with the resolved glob pattern. */
  runKeySearch: (pattern: string) => void;
}

export interface WorkbenchSearch {
  searchMode: SearchMode;
  setSearchMode: (mode: SearchMode) => void;
  valueSearchState: ValueSearchState;
  cancelValueSearch: () => void;
  /** Apply the raw pattern from the search row (mode decides the semantics). */
  applySearch: (rawPattern: string, fuzzy: boolean) => void;
}

export function useWorkbenchSearch({
  dbSessionId,
  dbIndex,
  clearFocus,
  runKeySearch,
}: WorkbenchSearchOptions): WorkbenchSearch {
  const [searchMode, setSearchMode] = useState<SearchMode>('key');
  const {
    state: valueSearchState,
    start: startValueSearch,
    cancel: cancelValueSearch,
    reset: resetValueSearch,
  } = useValueSearch({ dbSessionId, dbIndex });

  useEffect(() => {
    if (searchMode === 'key') resetValueSearch();
  }, [searchMode, dbIndex, dbSessionId, resetValueSearch]);

  const applySearch = useCallback(
    (rawPattern: string, fuzzy: boolean) => {
      clearFocus();
      if (searchMode === 'key') {
        runKeySearch(toScanPattern(rawPattern, fuzzy));
        return;
      }
      const query = rawPattern.trim();
      if (!query) {
        resetValueSearch();
        return;
      }
      startValueSearch({ mode: searchMode, query, pattern: '*' });
    },
    [clearFocus, searchMode, runKeySearch, startValueSearch, resetValueSearch],
  );

  return { searchMode, setSearchMode, valueSearchState, cancelValueSearch, applySearch };
}

/**
 * Glob chars that make a pattern a *pattern* rather than a literal key name.
 * Mirrors the server-side short-circuit rule (PRD §4 I-3): with none of these a
 * search is addressable as a single key.
 */
const GLOB_CHARS = /[*?[\]\\]/;

export function patternHasGlob(pattern: string): boolean {
  return GLOB_CHARS.test(pattern);
}

/**
 * Resolve the raw input of the search row into the SCAN pattern:
 *  - blank ⇒ match everything (`*`), which is the pre-filter state of the tree;
 *  - fuzzy ⇒ a literal substring is wrapped in `*…*` so "user" finds `app:user:1`;
 *  - an input that already carries a glob char is sent verbatim — wrapping it
 *    would silently widen a pattern the user wrote on purpose.
 */
export function toScanPattern(rawPattern: string, fuzzy: boolean): string {
  const trimmed = rawPattern.trim();
  if (!trimmed) return '*';
  if (!fuzzy || patternHasGlob(trimmed)) return trimmed;
  return `*${trimmed}*`;
}
