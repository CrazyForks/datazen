/**
 * Round-2 independent-tester regression lock for the two fixes in `0ea9641e8`:
 *
 *  - DEFECT-A `closeLabel` override channel. The round-1 contract suite
 *    (`extractedDialogsContracts.test.tsx`) only exercises the *fallback* path
 *    (prop omitted -> `t('common.close')`). Nothing asserted the other half of
 *    the contract: that an explicit `closeLabel` actually reaches the Dialog
 *    header button's `aria-label`. These cases close that hole.
 *
 *  - DEFECT-B clipboard rollback. The two flipped contracts live in
 *    `CopyableError.test.tsx` / `ResultMessageDialog.test.tsx`; this file adds
 *    the parts neither covers — that no unhandled rejection escapes, and the
 *    two races the rollback logic still gets wrong.
 *
 * Why a probe locale: `Dialog`'s own default is `closeLabel = 'Close'` and the
 * English `common.close` is also `'Close'`, so an English-only assertion cannot
 * distinguish "the caller overrode it" from "it fell back and happened to match".
 * `CUSTOM::Close` differs from both the probe copy and every library default.
 *
 * `it.fails` marks the still-broken behaviour the way this repo already does
 * (see the contracts these replaced): the assertion is the correct contract, it
 * is red today, and it flips to green automatically the moment the component is
 * corrected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';
import { CopyableError } from '../CopyableError';
import { LimitationsDialog } from '../LimitationsDialog';
import { ResultMessageDialog } from '../ResultMessageDialog';
import { registerTranslations } from '../i18n';

const PROBE_CLOSE = 'PROBE::Dismiss';
const PROBE = {
  'common.close': PROBE_CLOSE,
  'common.cancel': 'PROBE::Cancel',
  'common.confirm': 'PROBE::Confirm',
  'common.ok': 'PROBE::OK',
  'common.copy': 'PROBE::Copy',
  'common.copied': 'PROBE::Copied',
  'common.error': 'PROBE::Error',
  'common.success': 'PROBE::Success',
} as const;
const COPIED = PROBE['common.copied'];
const COPY = PROBE['common.copy'];
const CUSTOM = 'CUSTOM::Close';

/**
 * Registered into the DEFAULT locale rather than switched with `setLocale()`:
 * boundary rule R2 in `scripts/check-driver-import-boundaries.mjs` allows
 * `setLocale()` only in host `src/**` and in `i18n.ts` / `i18n.test.tsx`, and a
 * package test has a fresh module registry with no host dictionaries in it.
 */
registerTranslations({ en: { ...PROBE } });

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The header X button is the only one whose accessible name is `aria-label`-only. */
function headerCloseNames(): string[] {
  return screen
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-label') !== null)
    .map((b) => b.getAttribute('aria-label') as string);
}

const copyBtn = () => screen.getByTestId('copyable-error-copy');
const rmdCopyBtn = () => screen.getByTestId('result-message-copy');

describe('DEFECT-A: closeLabel is an override, not a decoration', () => {
  it('ConfirmDialog puts an explicit closeLabel on the header button', () => {
    render(
      <ConfirmDialog
        open
        title="Delete"
        message="Sure?"
        closeLabel={CUSTOM}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: CUSTOM })).toBeInTheDocument();
    expect(headerCloseNames()).toEqual([CUSTOM]);
  });

  it('ResultMessageDialog puts an explicit closeLabel on the header button', () => {
    render(
      <ResultMessageDialog
        open
        kind="success"
        message="export finished"
        closeLabel={CUSTOM}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: CUSTOM })).toBeInTheDocument();
    expect(headerCloseNames()).toEqual([CUSTOM]);
  });

  it('LimitationsDialog puts an explicit closeLabel on the header button', () => {
    render(
      <LimitationsDialog
        open
        onClose={() => {}}
        titleKey="zz.t"
        dontShowAgainKey="zz.d"
        limitationKeys={[]}
        testIdPrefix="probe"
        closeLabel={CUSTOM}
      />,
    );
    // The footer also renders a "Close" *button* (by text, not aria-label), so
    // scope to aria-labelled elements: only the header X should carry CUSTOM.
    expect(screen.getByRole('button', { name: CUSTOM })).toBeInTheDocument();
    expect(headerCloseNames()).toEqual([CUSTOM]);
  });

  it.each([
    ['ConfirmDialog', 'confirm'],
    ['ResultMessageDialog', 'rmd'],
    ['LimitationsDialog', 'limitations'],
  ] as const)('%s still falls back to the localized common.close when omitted', (_name, kind) => {
    if (kind === 'confirm') {
      render(<ConfirmDialog open title="T" message="M" onConfirm={() => {}} onCancel={() => {}} />);
    } else if (kind === 'rmd') {
      render(<ResultMessageDialog open kind="error" message="boom" onClose={() => {}} />);
    } else {
      render(
        <LimitationsDialog
          open
          onClose={() => {}}
          titleKey="zz.t"
          dontShowAgainKey="zz.d"
          limitationKeys={[]}
          testIdPrefix="probe"
        />,
      );
    }
    expect(headerCloseNames()).toEqual([PROBE_CLOSE]);
  });

  it('documents that `closeLabel ?? t(...)` does NOT fall back on an empty string', () => {
    // `??` only falls back on null/undefined. Passing `closeLabel=""` yields a
    // header close button with an EMPTY accessible name — an a11y regression
    // waiting for any caller that computes the label from optional state.
    // This matches the pre-move host `Dialog` shim (`props.closeLabel ??
    // t('common.close')`), so it is a pre-existing trap, not a new one — it is
    // pinned here so a future `||` change is a deliberate, visible edit.
    render(
      <ResultMessageDialog open kind="success" message="done" closeLabel="" onClose={() => {}} />,
    );
    expect(headerCloseNames()).toEqual(['']);
    expect(screen.queryByRole('button', { name: PROBE_CLOSE })).not.toBeInTheDocument();
  });
});

describe('DEFECT-B: clipboard rejection handling', () => {
  it('[tester] CopyableError swallows the rejection — no unhandledrejection escapes', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      stubClipboard(() => Promise.reject(new Error('clipboard denied')));
      render(<CopyableError message="connection refused" copyButton />);
      fireEvent.click(copyBtn());
      // Long enough for the rejection to be reported as unhandled if it were.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(seen).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('[tester] ResultMessageDialog swallows the rejection — no unhandledrejection escapes', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      stubClipboard(() => Promise.reject(new Error('clipboard denied')));
      render(<ResultMessageDialog open kind="error" message="boom" onClose={() => {}} />);
      fireEvent.click(rmdCopyBtn());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(seen).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it.fails(
    '[tester] a stale rejection must not erase the confirmation of a LATER successful copy',
    async () => {
      // Click #1 is still in flight; click #2 lands and succeeds. The label
      // shows "Copied" for #2 — then #1 finally rejects and its unconditional
      // `setCopied(false)` wipes #2's (correct) confirmation. Today:
      //   after #2 resolved = "PROBE::Copied"; after #1's rollback = "PROBE::Copy"
      const rejecters: Array<(e: Error) => void> = [];
      let call = 0;
      stubClipboard(
        () =>
          new Promise<void>((_resolve, reject) => {
            call += 1;
            if (call === 1) rejecters.push(reject);
          }),
      );
      render(<CopyableError message="connection refused" copyButton />);

      fireEvent.click(copyBtn());
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(copyBtn());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(copyBtn()).toHaveTextContent(COPIED);

      // Now the FIRST write finally rejects.
      await act(async () => {
        rejecters[0]?.(new Error('clipboard denied'));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(copyBtn()).toHaveTextContent(COPIED);
    },
  );

  it.fails('[tester] a second click must restart the full 1.5s feedback window', () => {
    // Two successful clicks 1400ms apart. Each schedules its own 1500ms timer
    // and neither cancels the other, so click #1's timer fires 200ms into
    // click #2's window and resets the flag. Today, at t=1600 the label is
    // already back to "Copy" even though click #2 landed 200ms earlier.
    vi.useFakeTimers();
    stubClipboard(() => Promise.resolve());
    render(<CopyableError message="connection refused" copyButton />);

    fireEvent.click(copyBtn());
    act(() => {
      vi.advanceTimersByTime(1400);
    });
    fireEvent.click(copyBtn());
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(copyBtn()).toHaveTextContent(COPIED);
  });

  it.fails('[tester] CopyableError clears the feedback timer on unmount', () => {
    vi.useFakeTimers();
    stubClipboard(() => Promise.resolve());
    const { unmount } = render(<CopyableError message="connection refused" copyButton />);

    fireEvent.click(copyBtn());
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    // No `useEffect` cleanup exists, so the 1500ms timer (and the closure it
    // holds) outlives the component and later calls setState on a dead fiber.
    expect(vi.getTimerCount()).toBe(0);
  });

  it.fails('[tester] ResultMessageDialog clears the feedback timer on unmount', () => {
    vi.useFakeTimers();
    stubClipboard(() => Promise.resolve());
    const { unmount } = render(
      <ResultMessageDialog open kind="error" message="boom" onClose={() => {}} />,
    );

    fireEvent.click(rmdCopyBtn());
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('DEFECT-B: rollback reachability (guards the waitFor contracts)', () => {
  it('[tester] a rejected write always reaches the DOM — never vacuously green', async () => {
    // Guards the `waitFor` assertions in CopyableError.test.tsx /
    // ResultMessageDialog.test.tsx: they only mean something if the rollback
    // really lands. Confirmed red under both mutations (clipboard promise that
    // never settles; clipboard that rejects after 5s, past waitFor's 1s
    // default), so they are not time-unbounded passes.
    stubClipboard(() => Promise.reject(new Error('clipboard denied')));
    render(<CopyableError message="connection refused" copyButton />);
    fireEvent.click(copyBtn());

    expect(copyBtn()).toHaveTextContent(COPIED);
    await waitFor(() => expect(copyBtn()).not.toHaveTextContent(COPIED));
    expect(copyBtn()).toHaveTextContent(COPY);
  });
});
