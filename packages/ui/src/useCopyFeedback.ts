import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared "copy to clipboard" confirmation for the copy affordances in this
 * package. `ConfirmDialog`, `CopyableError` and `ResultMessageDialog` each
 * carried their own copy of this logic, and the copies drifted — so the race
 * fixes live here once, for all three:
 *
 *  - **Optimistic, with a controlled rollback.** The confirmation flips
 *    synchronously on click so the click reads as instant, and is rolled back
 *    if the write fails for *any* reason. Telling the user "Copied" for a
 *    write that never landed is a lie, and the unguarded `void writeText()`
 *    this replaced also leaked an unhandled rejection. The exposure is a
 *    single event-loop turn.
 *  - **Each click owns a full window.** A click clears the previous timer
 *    before arming its own, so a second click gets the full `feedbackMs`
 *    instead of inheriting whatever was left of the first one's window.
 *  - **The rollback is bound to the request that started it.** A rejection
 *    that arrives after a newer click is ignored, so a late failure cannot
 *    erase a newer, successful confirmation.
 *  - **The feedback timer is cleared on unmount**, so that closure never
 *    outlives the component to call `setState` on a dead fiber. React 18
 *    dropped the setState-after-unmount warning, so without the cleanup this
 *    leaks silently. The guarantee is scoped to the timer on purpose: a
 *    `writeText()` promise that rejects *after* unmount still runs its
 *    rejection handler, because a promise cannot be cancelled. React discards
 *    that `setState` harmlessly and the closure is collectable once the
 *    promise settles, so it is not a leak — but it is not prevented either.
 *  - **Known limit: no clipboard fallback chain.** This path is
 *    `navigator.clipboard.writeText` and nothing else — no Tauri
 *    `write_clipboard` invoke, no `document.execCommand('copy')` downgrade.
 *    A browser without the async Clipboard API therefore gets a rolled-back
 *    button rather than a copy. The fallback exists in
 *    `src/lib/fetchRelationDdl.ts` and cannot move here: it depends on
 *    `@tauri-apps/api`, which `packages/ui` is not allowed to import. Sites
 *    that need the downgrade must keep using that helper.
 */
export function useCopyFeedback(feedbackMs: number): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  // `number`, not `ReturnType<typeof window.setTimeout>`: with @types/node in
  // scope that resolves to `NodeJS.Timeout` while the DOM `window.setTimeout`
  // actually returns a numeric id, and the two do not unify.
  const timerRef = useRef<number | null>(null);
  /** Monotonic id of the most recent copy request; older ones are stale. */
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  const copy = useCallback(
    (text: string) => {
      const requestId = ++requestIdRef.current;

      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setCopied(false);
      }, feedbackMs);

      // Reading `navigator.clipboard` and calling `writeText` can both throw
      // synchronously -- a missing Clipboard API, a WebKit policy that raises
      // `NotAllowedError`, a `writeText` that is not callable. Written as
      // `navigator.clipboard.writeText(text).catch(...)` that throw escapes
      // *before* `.catch` can be attached: the rollback below would never run
      // and the button would claim "Copied" for the whole window without having
      // copied anything. Swallowing it here and handing the rollback a rejected
      // promise instead makes the rollback cover every failure mode, and
      // guarantees `copy()` never throws into the caller's event handler.
      //
      // The call itself stays synchronous on purpose. Deferring the property
      // read by a turn (`Promise.resolve().then(...)`) would work too, but it
      // moves `writeText` out of the click turn, which callers and their tests
      // legitimately observe -- the write is not the thing that needed fixing.
      const write = ((): Promise<void> => {
        try {
          return navigator.clipboard.writeText(text);
        } catch {
          return Promise.reject(new Error('clipboard write unavailable'));
        }
      })();

      void write.catch(() => {
        // A newer click already owns the state: its outcome, not this one,
        // decides what the button shows. Bailing out here also leaves the
        // newer click's feedback timer running.
        if (requestId !== requestIdRef.current) return;
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        setCopied(false);
      });
    },
    [feedbackMs],
  );

  return { copied, copy };
}
