import { useCallback, useState } from 'react';
import { invokeGetKey } from '../shared/redisInvoke';
import type { KeyDetail } from '../shared/types';

/**
 * The mounted key detail of 屏 B's right column: which key is open, its loaded
 * `KeyDetail`, whether it is still fetching, and the editor's dirty draft flag.
 *
 * Split out of `RedisWorkbench.tsx` (D-0). The dirty invariant this hook keeps:
 * `editorDirty` can only be true while a detail with an unsaved draft is
 * mounted — every path that drops the detail goes through {@link clearDetail},
 * which resets the flag together with the key.
 */

export interface KeyDetailState {
  selectedKey: string | null;
  keyDetail: KeyDetail | null;
  detailLoading: boolean;
  editorDirty: boolean;
  setEditorDirty: (dirty: boolean) => void;
  /** Point the right column at `key`, loading its detail (keeps the draft flag). */
  selectKey: (key: string) => Promise<void>;
  /** Rename follow-up: keep the column mounted but re-point it at `newKey`. */
  retargetKey: (newKey: string) => void;
  /** Drop the mounted detail and its draft (also the unmount/db-switch path). */
  clearDetail: () => void;
}

export function useKeyDetailState(dbSessionId: string, dbIndex: number): KeyDetailState {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyDetail, setKeyDetail] = useState<KeyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);

  const selectKey = useCallback(
    async (key: string) => {
      setSelectedKey(key);
      setDetailLoading(true);
      try {
        const detail = await invokeGetKey(dbSessionId, dbIndex, key);
        setKeyDetail(detail);
      } catch (e) {
        console.error('get_key failed:', e);
        setKeyDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [dbSessionId, dbIndex],
  );

  const retargetKey = useCallback((newKey: string) => {
    setSelectedKey(newKey);
  }, []);

  const clearDetail = useCallback(() => {
    setSelectedKey(null);
    setKeyDetail(null);
    setEditorDirty(false);
  }, []);

  return {
    selectedKey,
    keyDetail,
    detailLoading,
    editorDirty,
    setEditorDirty,
    selectKey,
    retargetKey,
    clearDetail,
  };
}
