/**
 * [tester] Fallback contract for the 1.1.0 generic hooks.
 *
 * `createExtraExtensions` / `createExtraKeymap` / `createEditorPanelSlot` are
 * optional members on `SqlEditorEnhancedFeatures`, so a *host with no EP
 * registered* must degrade to inert — that is the whole point of the contract,
 * and it is the state every Community build boots in.
 *
 * This file exists because the track's own suites only ever exercise the two
 * hooks the host happens to call (`createExtraExtensions`, `createExtraKeymap`).
 * `createEditorPanelSlot` has no host call site at all — P3 is out of scope — so
 * nothing invoked it, and the "new hooks return null/empty under fallback"
 * half of acceptance item §四.1 was asserted by nobody. A coverage run over the
 * contract file confirmed it: `sqlEditorEnhancedEP.ts:164` was the single
 * uncovered changed executable line in the whole track.
 */
import { describe, expect, it } from 'vitest';
import { extensionRegistry, sqlEditorEnhancedEP } from '../index';

describe('[tester] sqlEditorEnhancedEP fallback contract', () => {
  it('the default implementation is frozen, so no consumer can mutate the shared fallback', () => {
    // Every editor instance shares one `fallbackFeatures` object. A consumer
    // that wrote to it would corrupt every other instance's editor.
    expect(Object.isFrozen(sqlEditorEnhancedEP.getDefault())).toBe(true);
  });

  it('degrades each generic hook to its inert value when nothing is registered', () => {
    const fallback = sqlEditorEnhancedEP.getDefault();

    // Empty arrays, not `undefined` — the compartment factories pass this
    // straight into `Compartment.of()`, which rejects `undefined`.
    expect(fallback.createExtraExtensions?.()).toEqual([]);
    expect(fallback.createExtraKeymap?.()).toEqual([]);

    // `null` (not `[]`, not `throw`) for a slot: a panel slot that does not
    // exist must read as "no slot", which is what the host branches on.
    expect(fallback.createEditorPanelSlot?.('sql-editor.query-actions', {})).toBeNull();
  });

  it('calls the slot hook with arbitrary ids without a host-side registry lookup', () => {
    // `slotId` is extension-owned data, not a host-known enum; the fallback
    // must not care and must not throw on an id it has never seen.
    const fallback = sqlEditorEnhancedEP.getDefault();
    for (const slotId of ['sql-editor.query-actions', '', 'a'.repeat(512)]) {
      expect(fallback.createEditorPanelSlot?.(slotId, {})).toBeNull();
    }
  });

  it('hands the same frozen object back to every caller (no per-call allocation)', () => {
    expect(extensionRegistry.get(sqlEditorEnhancedEP)).toBe(sqlEditorEnhancedEP.getDefault());
    expect(extensionRegistry.get(sqlEditorEnhancedEP)).toBe(
      sqlEditorEnhancedEP.getDefault(),
    );
  });

  it('returns to the untouched fallback after a partial implementation is unregistered', () => {
    const before = sqlEditorEnhancedEP.getDefault();
    const unregister = extensionRegistry.register(sqlEditorEnhancedEP, {
      createExtraKeymap: () => [{ key: 'Alt-x' }],
    });
    expect(extensionRegistry.get(sqlEditorEnhancedEP).createExtraKeymap?.()).toHaveLength(1);

    unregister();

    const after = extensionRegistry.get(sqlEditorEnhancedEP);
    expect(after).toBe(before);
    expect(after.createExtraKeymap?.()).toEqual([]);
    // The registration must not have leaked into the frozen object it replaced.
    expect(Object.isFrozen(after)).toBe(true);
  });
});
