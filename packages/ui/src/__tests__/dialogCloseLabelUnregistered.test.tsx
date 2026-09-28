/**
 * Counter-case for `dialogCloseLabelI18n.test.tsx`: `Dialog` only localizes its
 * close label when the shared registry actually HAS a `common.close` entry.
 *
 * This has to be its own file. The registry in `i18n.ts` is module-private with
 * no unregister API, and every file gets a fresh module registry — so "nothing
 * registered `common.close`" is only observable from a file that deliberately
 * registers nothing. That is not a contrivance: it is a real production state,
 * since a `@datazen/ui` consumer that has loaded no dictionary at all resolves
 * keys against an empty registry.
 *
 * Two cheaper ways to reach *near* that state were measured here and neither
 * qualifies, so the split stays:
 *
 *   - `registerTranslations({ en: { 'common.close': undefined } })` in this same
 *     file does make `t()` degrade to the raw key (the `??` chain in `i18n.ts`
 *     treats an explicit `undefined` as absent), but `Object.assign` still
 *     creates the own property — `hasOwnProperty('common.close')` stays `true`.
 *     It therefore cannot observe the property being *absent*, which is exactly
 *     what `Dialog.tsx`'s guard keys on.
 *   - `vi.resetModules()` followed by a re-import does hand back a fresh, empty
 *     registry, and the re-imported `Dialog` does render. An earlier revision of
 *     this comment claimed it could not, on the grounds that a second copy of
 *     React would leave the `react-dom` renderer without a dispatcher
 *     ("invalid hook call"). That claim was false: measured in this repo the
 *     re-imported `react` is indeed a distinct module instance
 *     (`await import('react') !== React`) and still 18.3.1, and rendering the
 *     re-imported `Dialog` through the statically imported renderer produces no
 *     hook error and the expected `["Close"]`. Do not re-derive this split from
 *     that argument.
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
