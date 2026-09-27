/**
 * Cross-component contract for the three dialogs that gained an explicit
 * `closeLabel={t('common.close')}` in the @datazen/ui move, plus the one i18n
 * behaviour the move silently changed: `ConfirmDialog`'s `previewTruncated`
 * interpolation, whose only existing coverage mocks `../i18n` with a `t()` that
 * discards `params` (so `{lines}` is asserted as a literal there, never a real
 * interpolation).
 *
 * Why a probe locale: `Dialog`'s own default is `closeLabel = 'Close'`, and the
 * English `common.close` is also `'Close'`. Any English-only assertion therefore
 * cannot tell "the component passed its localized label through" from "the
 * component dropped the prop and the default happened to match". Registering a
 * locale whose copy differs from every default makes the assertion wiring-proof,
 * and simultaneously proves the lookup really went through the shared registry
 * rather than a literal baked into the component.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';
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
  'query.editor.executionConfirm.previewTruncated': 'PROBE::truncated after {lines} lines',
  'query.editor.executionConfirm.copySql': 'PROBE::Copy SQL',
} as const;

/**
 * Registered into the DEFAULT locale, not switched to with `setLocale()`: the
 * boundary guard `scripts/check-driver-import-boundaries.mjs` rule R2 allows
 * `setLocale()` only in host `src/**` and in `i18n.ts` / `i18n.test.tsx`, and a
 * package test has a fresh module registry with no host dictionaries in it, so
 * seeding `en` is equivalent and stays legal.
 */
registerTranslations({ en: { ...PROBE } });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

/** The Dialog header close button is the ONLY button carrying this aria-label. */
function headerCloseButton(): HTMLElement {
  const matches = screen
    .getAllByRole('button')
    .filter((el) => el.getAttribute('aria-label') === PROBE_CLOSE);
  expect(matches).toHaveLength(1);
  return matches[0] as HTMLElement;
}

describe('closeLabel wiring for the dialogs that declare it explicitly', () => {
  it('ConfirmDialog passes the localized common.close to Dialog', () => {
    render(
      <ConfirmDialog
        open
        title="PROBE::Title"
        message="PROBE::Message"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(headerCloseButton()).toBeInTheDocument();
    expect(
      screen.getAllByRole('button').filter((el) => el.getAttribute('aria-label') === 'Close'),
    ).toHaveLength(0);
  });

  it('ResultMessageDialog passes the localized common.close to Dialog', () => {
    render(<ResultMessageDialog open kind="success" message="done" onClose={() => {}} />);
    expect(headerCloseButton()).toBeInTheDocument();
    expect(
      screen.getAllByRole('button').filter((el) => el.getAttribute('aria-label') === 'Close'),
    ).toHaveLength(0);
  });

  it('LimitationsDialog passes the localized common.close to Dialog', () => {
    render(
      <LimitationsDialog
        open
        onClose={() => {}}
        titleKey="zz.missing"
        dontShowAgainKey="zz.missing"
        limitationKeys={[]}
        testIdPrefix="probe"
      />,
    );
    expect(headerCloseButton()).toBeInTheDocument();
    expect(
      screen.getAllByRole('button').filter((el) => el.getAttribute('aria-label') === 'Close'),
    ).toHaveLength(0);
  });

  it('falls back to the raw key when the host registered no dictionary for it', () => {
    // Documents the pre-existing, package-level i18n design: @datazen/ui has no
    // host fallback, so an unregistered key degrades to the key itself with no
    // error. This is why `src/main.tsx` must evaluate `src/locales` before any
    // render, and why `src/test/driverUiSetup.ts` exists for the driver suites.
    // `common.close` IS registered here, so the *Dialog default* is what remains.
    render(<ResultMessageDialog open kind="error" message="boom" onClose={() => {}} />);
    const closeBtn = screen
      .getAllByRole('button')
      .find((el) => el.getAttribute('aria-label') === PROBE_CLOSE);
    expect(closeBtn).toBeDefined();

    // A key nobody registered renders verbatim — the silent-degradation surface.
    render(
      <LimitationsDialog
        open
        onClose={() => {}}
        titleKey="zz.neverRegistered.title"
        dontShowAgainKey="zz.neverRegistered.dontShowAgain"
        limitationKeys={['zz.neverRegistered.limit']}
        testIdPrefix="probe"
      />,
    );
    expect(screen.getByText('zz.neverRegistered.title')).toBeInTheDocument();
    expect(screen.getByText('zz.neverRegistered.limit')).toBeInTheDocument();
    expect(screen.getByText('zz.neverRegistered.dontShowAgain')).toBeInTheDocument();
  });
});

describe('ConfirmDialog code-preview truncation (real i18n interpolation)', () => {
  it('interpolates {lines} into the localized truncation notice', () => {
    const sql = Array.from({ length: 20 }, (_, i) => `SELECT ${i};`).join('\n');
    render(
      <ConfirmDialog
        open
        title="PROBE::Title"
        message="PROBE::Message"
        codePreview={sql}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // Proves the real engine interpolates params — the pre-move test mocked
    // `../i18n` with a param-dropping `t()`, so `{lines}` was never exercised.
    expect(screen.getByText('PROBE::truncated after 12 lines')).toBeInTheDocument();
  });

  it('does not render the truncation notice for a short preview', () => {
    render(
      <ConfirmDialog
        open
        title="PROBE::Title"
        message="PROBE::Message"
        codePreview="SELECT 1;"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText(/PROBE::truncated after/)).not.toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog-copy-sql')).toBeInTheDocument();
  });

  it('swaps the copy button glyph to a check after a successful copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <ConfirmDialog
        open
        title="PROBE::Title"
        message="PROBE::Message"
        codePreview="SELECT 1;"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const copyBtn = screen.getByTestId('confirm-dialog-copy-sql');
    expect(copyBtn).toHaveTextContent(PROBE['query.editor.executionConfirm.copySql']);
    expect(copyBtn).not.toHaveTextContent('✓');

    copyBtn.click();
    await vi.waitFor(() => expect(copyBtn).toHaveTextContent('✓'));
    expect(copyBtn).not.toHaveTextContent(PROBE['query.editor.executionConfirm.copySql']);
    expect(writeText).toHaveBeenCalledWith('SELECT 1;');
  });

  it('leaves the copy button un-confirmed when the clipboard write rejects', async () => {
    // Contrast case for the `it.fails` cases in CopyableError.test.tsx /
    // ResultMessageDialog.test.tsx: ConfirmDialog DOES guard the rejection
    // (ConfirmDialog.tsx handleCopy try/catch), so the check glyph must not appear.
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <ConfirmDialog
        open
        title="PROBE::Title"
        message="PROBE::Message"
        codePreview="SELECT 1;"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const copyBtn = screen.getByTestId('confirm-dialog-copy-sql');
    copyBtn.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    await Promise.resolve();

    expect(copyBtn).not.toHaveTextContent('✓');
    expect(copyBtn).toHaveTextContent(PROBE['query.editor.executionConfirm.copySql']);
  });
});
