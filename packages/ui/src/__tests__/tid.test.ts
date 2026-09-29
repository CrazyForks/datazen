/**
 * `tid()` — the E2E-build-only locator gate.
 *
 * `src/lib/__tests__/tid.test.ts` already exercises the host re-export shim; this
 * suite pins the *package* side (the one implementation) plus the `@datazen/ui`
 * barrel identity, so a future move that leaves the shim pointing at a different
 * function still fails here.
 *
 * The contract this guards: production bundles must render no test attributes at
 * all, and E2E/webdriver bundles must render exactly the id given.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tid as barrelTid } from '../index';
import { tid, type TidAttrs } from '../tid';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('tid', () => {
  it('returns a data-testid attribute when VITE_E2E is enabled (E2E build)', () => {
    vi.stubEnv('VITE_E2E', '1');
    expect(tid('editor-execute-button')).toEqual({ 'data-testid': 'editor-execute-button' });
  });

  it('returns an empty object when VITE_E2E is empty (production build)', () => {
    vi.stubEnv('VITE_E2E', '');
    expect(tid('editor-execute-button')).toEqual({});
  });

  it('returns an empty object when VITE_E2E is absent', () => {
    vi.stubEnv('VITE_E2E', undefined);
    expect(tid('anything')).toEqual({});
  });

  it('propagates the semantic id verbatim (any truthy VITE_E2E value)', () => {
    vi.stubEnv('VITE_E2E', 'true');
    const attrs = tid('conn-toolbar-new-query');
    expect(attrs).toEqual({ 'data-testid': 'conn-toolbar-new-query' });
    if ('data-testid' in attrs) {
      expect(attrs['data-testid']).toBe('conn-toolbar-new-query');
    }
  });

  it('spreads to a real element without leaking data-testid in the production case', () => {
    vi.stubEnv('VITE_E2E', '');
    const el = document.createElement('div');
    // This is exactly how call sites use it: `<button {...tid('x')} />`.
    Object.assign(el, tid('should-not-appear'));
    expect(el.hasAttribute('data-testid')).toBe(false);
  });

  it('re-evaluates the env flag on every call (no stale module-level cache)', () => {
    vi.stubEnv('VITE_E2E', '');
    expect(tid('a')).toEqual({});
    vi.stubEnv('VITE_E2E', '1');
    expect(tid('a')).toEqual({ 'data-testid': 'a' });
    vi.stubEnv('VITE_E2E', '');
    expect(tid('a')).toEqual({});
  });

  it('is the same implementation the @datazen/ui barrel re-exports', () => {
    vi.stubEnv('VITE_E2E', '1');
    expect(barrelTid).toBe(tid);
    expect(barrelTid('barrel-check')).toEqual({ 'data-testid': 'barrel-check' });
  });

  it('type-checks TidAttrs as a spread-safe attribute bag', () => {
    // Compile-time contract: both arms of the union must be assignable to
    // TidAttrs, which is what keeps `<button {...tid('x')} />` type-safe.
    const e2eAttrs: TidAttrs = { 'data-testid': 'literal' };
    const prodAttrs: TidAttrs = {};
    expect(Object.keys(e2eAttrs)).toEqual(['data-testid']);
    expect(Object.keys(prodAttrs)).toEqual([]);
  });
});
