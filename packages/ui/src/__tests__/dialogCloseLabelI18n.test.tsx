/**
 * `Dialog`'s header close button is localized through the ONE shared registry
 * (`packages/ui/src/i18n.ts`), not through a literal baked into the component.
 *
 * Why this file exists at all: the English `common.close` is `'Close'`, which is
 * *byte-identical* to the pre-i18n `closeLabel = 'Close'` default. Every
 * English-only assertion therefore cannot tell "the registry supplied the copy"
 * from "the component ignored the registry and hardcoded it". The fix in
 * `Dialog.tsx` has exactly zero English-language surface, so the probe below is
 * the only way to give this contract teeth:
 *
 *   - register `common.close` with wording that appears nowhere else, render a
 *     bare `<Dialog>` (no `closeLabel` prop) and require that wording;
 *   - require that *no* button carries the literal `'Close'` any more.
 *
 * The counter-case (registry has no entry at all ⇒ the literal is kept) lives in
 * `dialogCloseLabelUnregistered.test.tsx`, which needs a pristine module
 * registry to observe the empty-registry state.
 *
 * The probe is registered into the DEFAULT locale rather than selected with
 * `setLocale()`: boundary rule R2 in `scripts/check-driver-import-boundaries.mjs`
 * allows `setLocale()` only in host `src/**` and in `i18n.ts` / `i18n.test.tsx`.
 * A package test starts with no host dictionaries registered, so seeding `en`
 * is equivalent and stays legal (same reasoning as `extractedDialogsContracts`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Dialog } from '../Dialog';
import { registerTranslations } from '../i18n';

const PROBE_CLOSE = 'PROBE::DialogClose';
const LITERAL_DEFAULT = 'Close';

registerTranslations({ en: { 'common.close': PROBE_CLOSE } });

afterEach(cleanup);

/** The header X is the only button that carries an `aria-label` at all. */
function headerCloseNames(): string[] {
  return screen
    .getAllByRole('button')
    .filter((el) => el.getAttribute('aria-label') !== null)
    .map((el) => el.getAttribute('aria-label') as string);
}

describe('Dialog takes its close label from the shared i18n registry', () => {
  it('renders the registered common.close when no closeLabel prop is supplied', () => {
    render(
      <Dialog open title="PROBE::Title" onClose={() => {}}>
        <p>body</p>
      </Dialog>,
    );

    // The whole contract: a bare <Dialog> resolves its accessible name through
    // `t('common.close')`. Reverting Dialog.tsx to the hardcoded literal makes
    // this fail (the name would be 'Close', not the probe).
    expect(screen.getByRole('button', { name: PROBE_CLOSE })).toBeInTheDocument();
    expect(headerCloseNames()).toEqual([PROBE_CLOSE]);
  });

  it('no longer falls back to the hardcoded "Close" literal', () => {
    render(
      <Dialog open title="PROBE::Title" onClose={() => {}}>
        <p>body</p>
      </Dialog>,
    );

    // The inverse assertion, so the case above cannot pass by rendering the
    // probe *and* the literal on two different buttons.
    expect(headerCloseNames()).not.toContain(LITERAL_DEFAULT);
    expect(screen.queryByRole('button', { name: LITERAL_DEFAULT })).not.toBeInTheDocument();
  });

  it('an explicit closeLabel prop still overrides the registry', () => {
    // The prop is an override channel, not a decoration: the three dialogs in
    // this package (`ConfirmDialog` / `LimitationsDialog` / `ResultMessageDialog`)
    // feed it their own `t('common.close')`, and callers may pass anything.
    const CUSTOM = 'CUSTOM::DialogClose';
    render(
      <Dialog open title="PROBE::Title" closeLabel={CUSTOM} onClose={() => {}}>
        <p>body</p>
      </Dialog>,
    );

    expect(screen.getByRole('button', { name: CUSTOM })).toBeInTheDocument();
    expect(headerCloseNames()).toEqual([CUSTOM]);
  });

  it('an empty closeLabel prop still falls through to the registry', () => {
    // `||` not `??`: an empty accessible name is never what a caller wants.
    render(
      <Dialog open title="PROBE::Title" closeLabel="" onClose={() => {}}>
        <p>body</p>
      </Dialog>,
    );

    expect(screen.getByRole('button', { name: PROBE_CLOSE })).toBeInTheDocument();
    expect(headerCloseNames()).toEqual([PROBE_CLOSE]);
  });
});
