/**
 * One-shot read of `key_object_info` for a single key, for the KV slots.
 *
 * Both the key-props sidebar and the bottom status bar show facts about the
 * selected key, and neither may call back into the workbench (contract F-2
 * makes the relay write-only for the driver and read-only for the slots), so
 * each slot reads the command itself. The read is deliberately *not* polled:
 * `OBJECT IDLETIME` / `MEMORY USAGE` are cheap but they are still two round
 * trips per call (`SELECT` + pipeline) on a key the user may click straight
 * past, so the trigger is selection, not a timer.
 *
 * Stale replies are dropped by effect identity, which is what keeps a fast
 * key→key click from painting the previous key's attributes.
 */
import { useCallback, useEffect, useState } from 'react';
import { invokeKeyObjectInfo, type KeyObjectInfo } from './keyObjectInfo';

export interface KeyObjectInfoView {
  /** Last successful reply for the current key; `null` before / after a failure. */
  info: KeyObjectInfo | null;
  loading: boolean;
  /** Command-level failure (transport, wrong db, …) — a named empty state, not a throw. */
  failed: boolean;
  /** Re-read the current key (wired to the sidebar / status bar refresh action). */
  reload: () => void;
}

const IDLE = { info: null, loading: false, failed: false } as const;

/**
 * Fetch {@link key} while `enabled`.
 *
 * Pass `enabled: false` (or `key: null`) to keep the hook mounted without
 * issuing traffic — the sidebar does exactly that while the drawer is closed,
 * because the host never unmounts it.
 */
export function useKeyObjectInfo(
  dbSessionId: string,
  dbIndex: number | undefined,
  key: string | null,
  enabled = true,
): KeyObjectInfoView {
  const [view, setView] = useState<Omit<KeyObjectInfoView, 'reload'>>(IDLE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !key || dbIndex === undefined) {
      setView(IDLE);
      return;
    }
    let stale = false;
    setView((prev) => ({ ...prev, loading: true, failed: false }));
    void invokeKeyObjectInfo(dbSessionId, dbIndex, key)
      .then((info) => {
        if (!stale) setView({ info, loading: false, failed: false });
      })
      .catch(() => {
        // A key deleted mid-flight can also surface as an error on some servers;
        // either way the renderers fall back to the unavailable state.
        if (!stale) setView({ info: null, loading: false, failed: true });
      });
    return () => {
      stale = true;
    };
  }, [dbSessionId, dbIndex, key, enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...view, reload };
}
