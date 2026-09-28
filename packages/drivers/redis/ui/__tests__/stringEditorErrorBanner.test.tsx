/**
 * ErrorBanner extraction parity — Redis value editors.
 *
 * `StringEditor`'s save error is the one driver-side bar that also carries a
 * `data-i18n-key`, which driver tests treat as an assertion contract, and its
 * copy is a post-processed translation (`t(key).replace('{error}', msg)`).
 * Both are easy to lose in an extraction, so they are pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { KeyDetail, ValueFrame } from '../shared/types';

// Components take `useI18n` from the single @datazen/ui runtime. Only the
// templated entry is translated, so a dropped or reordered `.replace()` is
// observable instead of rendering the bare key.
const DICT: Record<string, string> = { 'redis.detail.saveFailed': 'Save failed: {error}' };
vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  useI18n: () => ({
    t: (key: string) => DICT[key] ?? key,
    lang: 'en',
  }),
}));

const invokeSetString = vi.fn();
vi.mock('../value-editors/keyEditorsInvokes', () => ({
  invokeSetString: (...args: unknown[]) => invokeSetString(...args),
}));

import { StringEditor } from '../value-editors/StringEditor';

afterEach(cleanup);

const detail: KeyDetail = {
  key: 'greeting',
  keyType: 'string',
  ttl: -1,
  value: 'hello',
};

const frame: ValueFrame = {
  key: 'greeting',
  keyType: 'string',
  ttl: -1,
  logicalLen: 5,
  memBytes: null,
  rawB64: null,
  truncated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  invokeSetString.mockRejectedValue(new Error('OOM command not allowed'));
});

describe('StringEditor save error', () => {
  it('is announced, keeps its i18n contract, and shows the interpolated failure', async () => {
    render(
      <StringEditor dbSessionId="s1" dbIndex={0} detail={detail} frame={frame} onSaved={vi.fn()} />,
    );

    // The footer with the save button only exists once the draft is dirty.
    fireEvent.change(await screen.findByTestId('redis-string-input'), {
      target: { value: 'hello there' },
    });
    fireEvent.click(await screen.findByTestId('redis-string-save'));
    const banner = await screen.findByTestId('redis-string-save-error');

    expect(banner.tagName).toBe('DIV');
    expect(banner).toHaveAttribute('role', 'alert');
    // The driver test suite asserts on this key; losing it breaks callers.
    expect(banner).toHaveAttribute('data-i18n-key', 'redis.detail.saveFailed');
    expect(banner.textContent).toBe('Save failed: OOM command not allowed');
    // The template must be filled, not rendered.
    expect(banner.textContent).not.toContain('{error}');
  });

  it("keeps the boxed variant and the call site's padding override", async () => {
    render(
      <StringEditor dbSessionId="s1" dbIndex={0} detail={detail} frame={frame} onSaved={vi.fn()} />,
    );

    fireEvent.change(await screen.findByTestId('redis-string-input'), {
      target: { value: 'hello there' },
    });
    fireEvent.click(await screen.findByTestId('redis-string-save'));
    const banner = await screen.findByTestId('redis-string-save-error');

    // The variant supplies the tinted box; the call site retunes padding and
    // colour without the component knowing about it.
    expect(banner).toHaveClass('rounded-md', 'border', 'bg-red-500/10', 'text-xs');
    expect(banner).toHaveClass('px-2', 'py-1.5', 'text-danger');
    // `px-2` is ordered after the variant's `p-2`, so it wins on the x axis.
    expect(banner.className.indexOf('px-2')).toBeGreaterThan(banner.className.indexOf('p-2'));
  });

  it('is gone again once the write succeeds', async () => {
    invokeSetString.mockResolvedValue(undefined);
    render(
      <StringEditor dbSessionId="s1" dbIndex={0} detail={detail} frame={frame} onSaved={vi.fn()} />,
    );

    fireEvent.change(await screen.findByTestId('redis-string-input'), {
      target: { value: 'hello there' },
    });
    fireEvent.click(await screen.findByTestId('redis-string-save'));

    // A successful write must not leave a stale error bar on screen.
    await waitFor(() => expect(screen.queryByTestId('redis-string-save-error')).toBeNull());
  });
});
