/**
 * Counter-case for `dialogCloseLabelI18n.test.tsx`: `Dialog` only localizes its
 * close label when the shared registry actually HAS a `common.close` entry.
 *
 * This has to be its own file. The registry in `i18n.ts` is module-private with
 * no unregister API, and every file gets a fresh module registry — so "nothing
 * registered `common.close`" is only observable from a file that deliberately
 * registers nothing. `vi.resetModules()` cannot produce that state here: it
 * would hand the re-imported `Dialog` a *second* copy of React, and the old
 * `react-dom` renderer would then have no dispatcher for the new one
 * ("invalid hook call"), i.e. a test-environment artifact rather than a real
 * runtime state.
 *
 * The behavior being pinned is a genuine one: `@datazen/ui` has no host
 * fallback (`i18n.ts` header), so `t()` degrades to the raw key
 * `registry[locale] ?? registry['en'] ?? key`. Rendering that dotted key as an
 * accessible name would be a regression, so the pre-i18n literal `'Close'` is
 * deliberately kept for exactly this case — see `Dialog.tsx`.
 *
 * This file must never call `registerTranslations`: that is the whole setup.
 * It is asserted in the first case below, so a stray registration added later
 * turns the suite red rather than quietly voiding the contract.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Dialog } from '../Dialog';
import { getRegisteredTranslations, t } from '../i18n';

const CLOSE_LABEL_KEY = 'common.close';
const LITERAL_DEFAULT = 'Close';

afterEach(cleanup);

function headerCloseNames(): string[] {
  return screen
    .getAllByRole('button')
    .filter((el) => el.getAttribute('aria-label') !== null)
    .map((el) => el.getAttribute('aria-label') as string);
}

describe('Dialog close label with no common.close in the registry', () => {
  it('has an empty registry for that key, so t() degrades to the raw key', () => {
    // The precondition. Without it the cases below could pass for the wrong
    // reason, and `getRegisteredTranslations` is the read-only accessor i18n.ts
    // documents for exactly this kind of tooling/test check.
    expect(getRegisteredTranslations('en')).not.toHaveProperty(CLOSE_LABEL_KEY);
    expect(t(CLOSE_LABEL_KEY)).toBe(CLOSE_LABEL_KEY);
  });

  it('keeps the pre-i18n literal as the accessible name', () => {
    render(
      <Dialog open title="PROBE::Title" onClose={() => {}}>
        <p>body</p>
      </Dialog>,
    );

    expect(screen.getByRole('button', { name: LITERAL_DEFAULT })).toBeInTheDocument();
    expect(headerCloseNames()).toEqual([LITERAL_DEFAULT]);
  });

  it('never leaks the raw i18n key into the DOM as an accessible name', () => {
    // The defect the fallback exists to prevent. Reverting the guard in
    // Dialog.tsx (dropping the `=== CLOSE_LABEL_KEY` check and using
    // `t()` directly) makes this fail: the name becomes "common.close".
    render(
      <Dialog open title="PROBE::Title" onClose={() => {}}>
        <p>body</p>
      </Dialog>,
    );

    expect(headerCloseNames()).not.toContain(CLOSE_LABEL_KEY);
    expect(screen.queryByRole('button', { name: CLOSE_LABEL_KEY })).not.toBeInTheDocument();
  });
});
