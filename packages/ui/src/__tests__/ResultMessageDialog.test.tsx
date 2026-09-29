/**
 * ResultMessageDialog: the two `kind` branches, the error-only copy action with
 * its "copied" confirmation state, and the `closeLabel` contract.
 *
 * This file deliberately uses the REAL shared i18n engine (no `vi.mock('../i18n')`)
 * and registers a probe locale whose copy is unmistakable. That is what makes the
 * assertions wiring-proof: the pre-i18n `closeLabel = 'Close'` default that
 * `Dialog.tsx` still falls back to when the registry holds no `common.close` is
 * byte-identical to the English `common.close`, so an English-only assertion cannot
 * distinguish "passed the localized label through" from "fell back to the default".
 * The probe copy differs from every default, so a pass proves the wiring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act, waitFor } from '@testing-library/react';
import { ResultMessageDialog } from '../ResultMessageDialog';
import { registerTranslations } from '../i18n';

const PROBE = {
  'common.error': 'PROBE::Error',
  'common.success': 'PROBE::Success',
  'common.ok': 'PROBE::OK',
  'common.close': 'PROBE::Close',
  'common.copy': 'PROBE::Copy',
  'common.copied': 'PROBE::Copied',
} as const;

/**
 * Registered into the DEFAULT locale, not switched to with `setLocale()`: the
 * boundary guard `scripts/check-driver-import-boundaries.mjs` rule R2 allows
 * `setLocale()` only in host `src/**` and in `i18n.ts` / `i18n.test.tsx` itself,
 * and a package test has a fresh module registry with no host dictionaries in
 * it, so seeding `en` is equivalent and stays legal.
 */
registerTranslations({ en: { ...PROBE } });

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
  return vi.mocked(window.navigator.clipboard.writeText);
}

describe('ResultMessageDialog', () => {
  describe('kind === "error"', () => {
    it('uses the localized error title, not the success one', () => {
      render(
        <ResultMessageDialog
          open
          kind="error"
          message="relation does not exist"
          onClose={() => {}}
        />,
      );
      expect(screen.getByText(PROBE['common.error'])).toBeInTheDocument();
      expect(screen.queryByText(PROBE['common.success'])).not.toBeInTheDocument();
    });

    it('renders the message verbatim and offers the copy action', () => {
      render(
        <ResultMessageDialog
          open
          kind="error"
          message="relation does not exist"
          onClose={() => {}}
        />,
      );
      expect(screen.getByText('relation does not exist')).toBeInTheDocument();
      expect(screen.getByTestId('result-message-copy')).toBeInTheDocument();
      expect(screen.getByTestId('result-message-copy')).toHaveTextContent(PROBE['common.copy']);
    });

    it('copies the message to the clipboard and flips to the copied state', () => {
      const writeText = stubClipboard(() => Promise.resolve());
      render(
        <ResultMessageDialog open kind="error" message="connection refused" onClose={() => {}} />,
      );

      fireEvent.click(screen.getByTestId('result-message-copy'));

      expect(writeText).toHaveBeenCalledWith('connection refused');
      const copyBtn = screen.getByTestId('result-message-copy');
      expect(copyBtn).toHaveTextContent(PROBE['common.copied']);
      expect(copyBtn).not.toHaveTextContent(PROBE['common.copy']);
      // The label swap is driven by the same i18n key pair the pre-move host
      // component used, so the copied state must survive the move.
      expect(copyBtn).toHaveAttribute('title', PROBE['common.copy']);
    });

    it('reverts the copied state after the 1.5s feedback window', () => {
      vi.useFakeTimers();
      stubClipboard(() => Promise.resolve());
      render(
        <ResultMessageDialog open kind="error" message="connection refused" onClose={() => {}} />,
      );

      fireEvent.click(screen.getByTestId('result-message-copy'));
      expect(screen.getByTestId('result-message-copy')).toHaveTextContent(PROBE['common.copied']);

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByTestId('result-message-copy')).toHaveTextContent(PROBE['common.copy']);
    });

    /**
     * The copy action is optimistic — it flips to "Copied" synchronously so the
     * click reads as instant — but a rejected clipboard write (permission
     * denied, insecure context) must roll that state back. Claiming success for
     * a write that never landed is a lie, and the unguarded `void writeText()`
     * this replaced also leaked an unhandled rejection.
     *
     * `waitFor` (not a single `await Promise.resolve()`) because the rollback
     * reaches the DOM only once React commits the re-render, which lands a few
     * microtasks after the rejection handler runs.
     */
    it('does not report "copied" when the clipboard write rejects', async () => {
      stubClipboard(() => Promise.reject(new Error('clipboard denied')));
      render(
        <ResultMessageDialog open kind="error" message="connection refused" onClose={() => {}} />,
      );

      fireEvent.click(screen.getByTestId('result-message-copy'));

      await waitFor(() =>
        expect(screen.getByTestId('result-message-copy')).not.toHaveTextContent(
          PROBE['common.copied'],
        ),
      );
    });
  });

  describe('kind === "success"', () => {
    it('uses the localized success title', () => {
      render(
        <ResultMessageDialog open kind="success" message="export finished" onClose={() => {}} />,
      );
      expect(screen.getByText(PROBE['common.success'])).toBeInTheDocument();
      expect(screen.queryByText(PROBE['common.error'])).not.toBeInTheDocument();
    });

    it('omits the copy action entirely (error-only affordance)', () => {
      render(
        <ResultMessageDialog open kind="success" message="export finished" onClose={() => {}} />,
      );
      expect(screen.queryByTestId('result-message-copy')).not.toBeInTheDocument();
    });

    it('still renders the message and the dismiss button', () => {
      render(
        <ResultMessageDialog open kind="success" message="export finished" onClose={() => {}} />,
      );
      expect(screen.getByText('export finished')).toBeInTheDocument();
      expect(screen.getByTestId('result-message-ok')).toHaveTextContent(PROBE['common.ok']);
    });
  });

  describe('dismiss', () => {
    it('calls onClose from the OK button', () => {
      const onClose = vi.fn();
      render(<ResultMessageDialog open kind="error" message="boom" onClose={onClose} />);
      fireEvent.click(screen.getByTestId('result-message-ok'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders nothing when closed', () => {
      render(<ResultMessageDialog open={false} kind="error" message="boom" onClose={() => {}} />);
      expect(screen.queryByTestId('result-message-ok')).not.toBeInTheDocument();
      expect(screen.queryByText('boom')).not.toBeInTheDocument();
    });
  });

  describe('closeLabel contract (the wiring that regressed with the move)', () => {
    it('labels the header close button with the localized common.close, not the library default', () => {
      render(<ResultMessageDialog open kind="error" message="boom" onClose={() => {}} />);
      const closeBtn = screen.getByRole('button', { name: PROBE['common.close'] });
      expect(closeBtn).toBeInTheDocument();
      // Guards the specific regression: falling back to the pre-i18n
      // `closeLabel = 'Close'` literal `Dialog.tsx` still keeps for an
      // unregistered `common.close` would produce the same English string in
      // production under `en`.
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });
  });
});
