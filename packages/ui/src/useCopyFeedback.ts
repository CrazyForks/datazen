import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared "copy to clipboard" confirmation for the copy affordances in this
 * package. `ConfirmDialog`, `CopyableError` and `ResultMessageDialog` each
 * carried their own copy of this logic, and the copies drifted — so the race
 * fixes live here once, for all three:
 *
 *  - **Optimistic, with a controlled rollback.** The confirmation flips
 *    synchronously on click so the click reads as instant, and is rolled back
 *    if the write rejects. Telling the user "Copied" for a write that never
 *    landed is a lie, and the unguarded `void writeText()` this replaced also
 *    leaked an unhandled rejection. The exposure is a single event-loop turn.
 *  - **Each click owns a full window.** A click clears the previous timer
 *    before arming its own, so a second click gets the full `feedbackMs`
 *    instead of inheriting whatever was left of the first one's window.
 *  - **The rollback is bound to the request that started it.** A rejection
 *    that arrives after a newer click is ignored, so a late failure cannot
 *    erase a newer, successful confirmation.
 *  - **The timer is cleared on unmount**, so the closure never outlives the
 *    component and call `setState` on a dead fiber. React 18 dropped the
 *    setState-after-unmount warning, so this leaks silently without this.
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

      void navigator.clipboard.writeText(text).catch(() => {
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
