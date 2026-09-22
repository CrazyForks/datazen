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
 * **State ownership** (redis-kvbar-ui-BUG-001): every read is tagged with the key
 * it was issued for, and {@link publishRead} publishes a read only to that key.
 * Consequences, structural rather than "remember to clear":
 * - a fast key→key click cannot paint the previous key's type / size / TTL,
 *   because the attributes die on the *render* that moves the selection, before
 *   the effect for the new key has even run;
 * - while a read is in flight the caller has no known facts, so the slots render
 *   nothing instead of a half-truth (§3.4 “不渲染，不是渲染 0”);
 * - a reply for a superseded read is discarded where it lands, so it can neither
 *   paint another key's row nor clear the current one's `loading` marker.
 */
import { useCallback, useEffect, useState } from 'react';
import { invokeKeyObjectInfo, type KeyObjectInfo } from './keyObjectInfo';

/** The three things a published read may say about the key being rendered. */
export interface PublishedKeyRead {
  /** Attributes of the key currently selected; `null` while nothing is known about it. */
  info: KeyObjectInfo | null;
  loading: boolean;
  /** Command-level failure (transport, wrong db, …) — a named empty state, not a throw. */
  failed: boolean;
}

export interface KeyObjectInfoView extends PublishedKeyRead {
  /** Re-read the current key (wired to the sidebar / status bar refresh action). */
  reload: () => void;
}

/**
 * Which key a read belongs to.
 *
 * All three fields are part of the identity: the panel can swap the database
 * session or move to another database index while the selected key *name* stays
 * the same string, and attributes read under the old identity are just as wrong
 * then as after a rename.
 */
export interface KeyReadOwner {
  dbSessionId: string;
  dbIndex: number;
  key: string;
}

/**
 * Hook-internal state: the last read **plus the key it describes**.
 *
 * Exported together with {@link publishRead} so the ownership rule is testable as
 * a pure function — the frame it covers (selection already moved, effect for the
 * new key not yet run) cannot be observed through the DOM, because every renderer
 * in the suite flushes effects before asserting.
 */
export interface OwnedKeyRead extends PublishedKeyRead {
  owner: KeyReadOwner | null;
}

/**
 * Identity of a read, in a single comparison.
 *
 * Deliberately one string compare instead of three `===`s chained with `&&`:
 * per-field comparisons short-circuit, so keeping each field's branch covered
 * would need one cross-key case per field — the kind of coverage that quietly
 * loses a field later. `''` means "no read", and a real token always carries two
 * separators, so the two can never collide.
 */
function readToken(owner: KeyReadOwner | null): string {
  return owner ? `${owner.dbSessionId}\u0000${owner.dbIndex}\u0000${owner.key}` : '';
}

/** The key a read would belong to, or `null` when nothing is addressable. */
function ownerOf(
  dbSessionId: string,
  dbIndex: number | undefined,
  key: string | null,
): KeyReadOwner | null {
  return key !== null && dbIndex !== undefined ? { dbSessionId, dbIndex, key } : null;
}

/**
 * The ownership rule behind both KV slots: publish a read to the key it came
 * from, publish *nothing* to any other key.
 *
 * Anything weaker — "keep the last payload and mark it loading", "clear only when
 * the name changes" — leaves one exit path open and re-opens
 * redis-kvbar-ui-BUG-001. Renderers must consume this, never {@link OwnedKeyRead}.
 */
export function publishRead(read: OwnedKeyRead, current: KeyReadOwner | null): PublishedKeyRead {
  if (readToken(read.owner) !== readToken(current)) {
    return { info: null, loading: false, failed: false };
  }
  return { info: read.info, loading: read.loading, failed: read.failed };
}

const NO_READ: OwnedKeyRead = { owner: null, info: null, loading: false, failed: false };

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
  const [read, setRead] = useState<OwnedKeyRead>(NO_READ);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const owner = enabled ? ownerOf(dbSessionId, dbIndex, key) : null;
    if (!owner) {
      setRead(NO_READ);
      return;
    }
    // A read opens with "no known facts about this key", never with the previous
    // key's payload (BUG-001). `reload` re-reads the same owner and takes the same
    // path, so refreshing also starts from nothing instead of from stale numbers.
    setRead({ owner, info: null, loading: true, failed: false });
    void invokeKeyObjectInfo(owner.dbSessionId, owner.dbIndex, owner.key).then(
      (info) => {
        // Apply the reply only while the state still belongs to this read; a
        // superseded one must not even flip `loading` off (see the docblock).
        setRead((prev) =>
          readToken(prev.owner) === readToken(owner)
            ? { owner, info, loading: false, failed: false }
            : prev,
        );
      },
      () => {
        // A key deleted mid-flight can also surface as an error on some servers;
        // either way the renderers fall back to the unavailable state.
        setRead((prev) =>
          readToken(prev.owner) === readToken(owner)
            ? { owner, info: null, loading: false, failed: true }
            : prev,
        );
      },
    );
  }, [dbSessionId, dbIndex, key, enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  // Derived while rendering, so moving the selection invalidates the attributes
  // at once instead of waiting for the effect that runs after the paint.
  const published = publishRead(read, ownerOf(dbSessionId, dbIndex, key));
  return { ...published, reload };
}
