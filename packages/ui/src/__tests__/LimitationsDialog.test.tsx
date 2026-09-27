/**
 * LimitationsDialog: the `limitationKeys` bullet list, the "don't show again"
 * checkbox → `onDismiss` contract, and the prefix-derived `data-*` locators that
 * both the host (`data-transfer`, `schema-diff` windows) and E2E depend on.
 *
 * Uses the real shared i18n engine with a probe locale so every assertion is
 * wiring-proof (see ResultMessageDialog.test.tsx for the rationale).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LimitationsDialog } from '../LimitationsDialog';
import { registerTranslations } from '../i18n';

const PROBE = {
  'common.close': 'PROBE::Close',
  'probe.limitations.title': 'PROBE::Known limits',
  'probe.limitations.dontShowAgain': 'PROBE::Do not show again',
  'probe.limitations.a': 'PROBE::Limit A',
  'probe.limitations.b': 'PROBE::Limit B',
} as const;

/**
 * Registered into the DEFAULT locale, not switched to with `setLocale()`: the
 * boundary guard `scripts/check-driver-import-boundaries.mjs` rule R2 allows
 * `setLocale()` only in host `src/**` and in `i18n.ts` / `i18n.test.tsx`, and a
 * package test has a fresh module registry with no host dictionaries in it, so
 * seeding `en` is equivalent and stays legal.
 */
registerTranslations({ en: { ...PROBE } });

const PREFIX = 'probe-scope';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof LimitationsDialog>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    titleKey: 'probe.limitations.title',
    dontShowAgainKey: 'probe.limitations.dontShowAgain',
    limitationKeys: ['probe.limitations.a', 'probe.limitations.b'] as const,
    testIdPrefix: PREFIX,
    onDismiss: vi.fn(),
    ...overrides,
  };
  const view = render(<LimitationsDialog {...props} />);
  return {
    ...props,
    onClose: props.onClose as ReturnType<typeof vi.fn>,
    onDismiss: props.onDismiss as ReturnType<typeof vi.fn>,
    rerender: (next: Partial<Parameters<typeof LimitationsDialog>[0]>) =>
      view.rerender(<LimitationsDialog {...props} {...next} />),
  };
}

describe('LimitationsDialog', () => {
  it('renders the localized title from titleKey', () => {
    renderDialog();
    expect(screen.getByText(PROBE['probe.limitations.title'])).toBeInTheDocument();
  });

  it('renders one localized bullet per limitationKeys entry, in order', () => {
    renderDialog();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(PROBE['probe.limitations.a']);
    expect(items[1]).toHaveTextContent(PROBE['probe.limitations.b']);
  });

  it('renders an empty bullet list without crashing when no keys are given', () => {
    renderDialog({ limitationKeys: [] });
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText(PROBE['probe.limitations.dontShowAgain'])).toBeInTheDocument();
  });

  it('prefixes every data-* locator with testIdPrefix', () => {
    renderDialog();
    expect(screen.getByTestId(`${PREFIX}-limitations`)).toBeInTheDocument();
    expect(screen.getByTestId(`${PREFIX}-limitations-dismiss`)).toBeInTheDocument();
    expect(screen.getByTestId(`${PREFIX}-limitations-close`)).toHaveTextContent(
      PROBE['common.close'],
    );
  });

  it('labels the header close button with the localized common.close', () => {
    renderDialog();
    // Two buttons carry the localized string: the Dialog header close (aria-label)
    // and the footer button (text). The header one is identified by aria-label so
    // the assertion targets the `closeLabel` prop specifically.
    const headerClose = screen
      .getAllByRole('button')
      .filter((el) => el.getAttribute('aria-label') === PROBE['common.close']);
    expect(headerClose).toHaveLength(1);
    expect(
      screen.getAllByRole('button').filter((el) => el.getAttribute('aria-label') === 'Close'),
    ).toHaveLength(0);
  });

  describe("'don't show again' checkbox", () => {
    it('starts unchecked and fires onDismiss only after it was checked', () => {
      const { onClose, onDismiss } = renderDialog();
      const checkbox = screen.getByTestId(`${PREFIX}-limitations-dismiss`);
      expect(checkbox).not.toBeChecked();

      fireEvent.click(screen.getByTestId(`${PREFIX}-limitations-close`));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('fires onDismiss alongside onClose once checked', () => {
      const { onClose, onDismiss } = renderDialog();
      fireEvent.click(screen.getByTestId(`${PREFIX}-limitations-dismiss`));
      expect(screen.getByTestId(`${PREFIX}-limitations-dismiss`)).toBeChecked();

      fireEvent.click(screen.getByTestId(`${PREFIX}-limitations-close`));

      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('resets the checkbox on close so a later open does not replay onDismiss', () => {
      // This is the regression that would silently persist a "don't show again"
      // the user never chose on the *next* visit of the same window.
      const { onDismiss, rerender } = renderDialog();
      fireEvent.click(screen.getByTestId(`${PREFIX}-limitations-dismiss`));
      fireEvent.click(screen.getByTestId(`${PREFIX}-limitations-close`));
      expect(onDismiss).toHaveBeenCalledTimes(1);

      // Host keeps the component mounted and only flips `open`.
      rerender({ open: false });
      rerender({ open: true });

      expect(screen.getByTestId(`${PREFIX}-limitations-dismiss`)).not.toBeChecked();
      fireEvent.click(screen.getByTestId(`${PREFIX}-limitations-close`));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('tolerates a missing onDismiss handler (optional prop)', () => {
      const { onClose } = renderDialog({ onDismiss: undefined });
      fireEvent.click(screen.getByTestId(`${PREFIX}-limitations-dismiss`));
      expect(() =>
        fireEvent.click(screen.getByTestId(`${PREFIX}-limitations-close`)),
      ).not.toThrow();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId(`${PREFIX}-limitations`)).not.toBeInTheDocument();
    expect(screen.queryByText(PROBE['probe.limitations.title'])).not.toBeInTheDocument();
  });
});
