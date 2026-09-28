/**
 * Counter-case for `dialogCloseLabelI18n.test.tsx`: `Dialog` only localizes its
 * close label when the shared registry actually HAS a `common.close` entry.
 *
 * This file registers no translations, and each test file gets its own module
 * registry, so the registry it renders against is empty — the state a
 * `@datazen/ui` consumer is in when it has loaded no dictionary, which is a real
 * production state rather than a contrivance. The first case below asserts that
 * emptiness for `common.close`, so a `registerTranslations` of that key added
 * later turns this suite red instead of quietly voiding the contract.
 *
 * `registerTranslations` cannot reproduce that state. It merges with
 * `Object.assign`, so registering `{'common.close': undefined}` still leaves an
 * own property behind, and `getRegisteredTranslations` spreads the registry
 * (`i18n.ts`) rather than dropping empties. What the cases below render against
 * is the key being *absent*, not a key that resolves to `undefined`.
 *
 * The behavior being pinned is a genuine one: `@datazen/ui` has no host
 * fallback (`i18n.ts` header), so `t()` degrades to the raw key
 * `registry[locale] ?? registry['en'] ?? key`. Rendering that dotted key as an
 * accessible name would be a regression, so the pre-i18n literal `'Close'` is
 * deliberately kept — `Dialog.tsx` applies it to this case and to a blank or
 * whitespace-only value alike, and `dialogCloseLabelI18n.test.tsx` pins the
 * other one.
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
