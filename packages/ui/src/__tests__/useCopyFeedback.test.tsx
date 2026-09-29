/**
 * `useCopyFeedback` — the failure-mode contract of the shared copy confirmation.
 *
 * The per-site convergence tests assert each affordance's *window*; what lives
 * here is the part that is the hook's own responsibility and must hold for every
 * caller: what happens when the clipboard is not merely refusing the write, but
 * not there at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useCopyFeedback } from '../useCopyFeedback';

const FEEDBACK_MS = 1500;

function installClipboard(value: unknown) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value,
  });
}

/** Let the microtask queue drain, which is when a deferred write settles. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useCopyFeedback', () => {
  it('confirms on click and reverts after the window', async () => {
    const writeText = vi.fn(async () => undefined);
    installClipboard({ writeText });
    const { result } = renderHook(() => useCopyFeedback(FEEDBACK_MS));

    act(() => result.current.copy('SELECT 1'));
    expect(result.current.copied).toBe(true);

    act(() => void vi.advanceTimersByTime(FEEDBACK_MS));
    expect(result.current.copied).toBe(false);
    await flush();
  });

  /**
   * The regression this exists for. `navigator.clipboard.writeText(text).catch(...)`
   * reads the property *before* `.catch` can be attached, so a missing
   * `navigator.clipboard` throws a TypeError synchronously: the rollback never
   * runs, `copy()` throws into the caller's event handler, and the confirmation
   * sits there claiming a copy that never happened. The property read has to
   * live inside the promise chain for the rollback to cover this mode.
   */
  it('rolls back without throwing when navigator.clipboard is undefined', async () => {
    installClipboard(undefined);
    const { result } = renderHook(() => useCopyFeedback(FEEDBACK_MS));

    act(() => {
      expect(() => result.current.copy('SELECT 1')).not.toThrow();
    });
    // Optimistic first: the click still reads as instant.
    expect(result.current.copied).toBe(true);

    await flush();

    // Rolled back, and not merely after the window elapsed.
    expect(result.current.copied).toBe(false);
  });

  it('rolls back without throwing when navigator.clipboard is absent entirely', async () => {
    // `delete` is different from `value: undefined`: the property is gone, so
    // the read yields a prototype miss rather than an explicit undefined.
    Reflect.deleteProperty(window.navigator, 'clipboard');
    const { result } = renderHook(() => useCopyFeedback(FEEDBACK_MS));

    act(() => {
      expect(() => result.current.copy('SELECT 1')).not.toThrow();
    });
    expect(result.current.copied).toBe(true);

    await flush();

    expect(result.current.copied).toBe(false);
  });

  it('rolls back without throwing when writeText itself throws synchronously', async () => {
    installClipboard({
      writeText: () => {
        throw new Error('clipboard blocked by policy');
      },
    });
    const { result } = renderHook(() => useCopyFeedback(FEEDBACK_MS));

    act(() => {
      expect(() => result.current.copy('SELECT 1')).not.toThrow();
    });
    expect(result.current.copied).toBe(true);

    await flush();

    expect(result.current.copied).toBe(false);
  });

  it('ignores a failure that arrives after a newer click succeeded', async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockImplementationOnce(
        () => new Promise<void>((_resolve, reject) => reject(new Error('denied'))),
      )
      .mockImplementation(async () => undefined);
    installClipboard({ writeText });
    const { result } = renderHook(() => useCopyFeedback(FEEDBACK_MS));

    act(() => result.current.copy('first'));
    // The first write is still in flight; click again.
    act(() => result.current.copy('second'));
    await flush();

    // The stale failure must not take down the second click's confirmation.
    expect(result.current.copied).toBe(true);
  });
});
