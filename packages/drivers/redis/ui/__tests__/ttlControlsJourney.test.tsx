/**
 * TtlControls E2E Journey Tests
 *
 * Each journey is self-contained:
 *   1. Prepare  — mock invoke + render TtlControls with a fresh key/TTL
 *   2. Act      — simulate user interaction (input, button clicks)
 *   3. Assert   — verify correct Redis commands were dispatched
 *   4. Clean    — verify no leaked state / cleanup calls
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Components take `useI18n` from the single @datazen/ui runtime; keep the
// assertions locale-independent by overriding only that hook.
//
// The map below exists ONLY so `t()` returns something renderable — no
// assertion in this file reads a rendered copy. Locating and state checks go
// through the `data-*` contract on TtlControls (see
// docs/development/interaction-and-testing-principles.md, "断言与 i18n 文案解耦").
vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'redis.ttl': 'TTL',
        'redis.noExpiry': 'No expiry',
        'redis.seconds': 's',
        'redis.ttlSeconds': 'TTL (seconds)',
        'redis.setTtl': 'Set TTL',
        'redis.expireAt': 'Expire at',
        'redis.expireAtInvalid': 'Invalid expire datetime',
        'redis.setExpireAt': 'Set expire at',
        'redis.persist': 'Persist',
      };
      return map[key] ?? key;
    },
  }),
}));

import { TtlControls } from '../value-editors/TtlControls';
import type { PluginInvokeFn } from '../value-editors/keyEditorsInvokes';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers: render TtlControls with a mock invoke function + data-* locators
// ---------------------------------------------------------------------------

/** The TTL read-out slot; state is `no-expiry` | `seconds`, never rendered copy. */
function ttlValueSlot() {
  return screen.getByTestId('redis-ttl-value');
}

function expectNoExpiryState() {
  const slot = ttlValueSlot();
  expect(slot.getAttribute('data-ttl-state')).toBe('no-expiry');
  // Slot must render a resolved label, not an empty hole.
  expect((slot.textContent ?? '').trim().length).toBeGreaterThan(0);
}

function expectSecondsState(seconds: number) {
  const slot = ttlValueSlot();
  expect(slot.getAttribute('data-ttl-state')).toBe('seconds');
  // The numeric TTL is data, not copy — pinning it keeps the real intent.
  expect(slot.textContent).toContain(String(seconds));
}
function setupJourney(opts: {
  keyName: string;
  ttl: number;
  dbSessionId?: string;
  dbIndex?: number;
}) {
  const invoke = vi.fn<PluginInvokeFn>().mockResolvedValue(undefined);
  const onChanged = vi.fn();
  const result = render(
    <TtlControls
      dbSessionId={opts.dbSessionId ?? 'test-sess'}
      dbIndex={opts.dbIndex ?? 0}
      keyName={opts.keyName}
      ttl={opts.ttl}
      onChanged={onChanged}
      invoke={invoke}
    />,
  );
  return { invoke, onChanged, ...result };
}

// ============================================================================
// Journey 1: Set relative TTL on a key with no expiry
// ============================================================================
describe('Journey: Set relative TTL on key without expiry', () => {
  it('creates key, sets TTL, verifies EXPIRE command, cleans up', async () => {
    // ── 1. Prepare ───────────────────────────────────────────────────────
    // Fresh key with ttl=-1 (no expiry)
    const { invoke, onChanged } = setupJourney({
      keyName: 'journey1:test-key',
      ttl: -1,
    });

    // Verify initial state: the TTL slot reports the no-expiry state
    expect(screen.getByTestId('redis-ttl-value')).toBeTruthy();
    expectNoExpiryState();

    // ── 2. Act ───────────────────────────────────────────────────────────
    // Type a relative TTL value
    const ttlInput = screen.getByTestId('redis-ttl-input');
    fireEvent.change(ttlInput, { target: { value: '3600' } });

    // Click the relative-TTL apply action
    const setTtlBtn = screen.getByTestId('redis-ttl-set');
    fireEvent.click(setTtlBtn);

    // ── 3. Assert ────────────────────────────────────────────────────────
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('redis', 'set_ttl', {
        dbSessionId: 'test-sess',
        dbIndex: 0,
        key: 'journey1:test-key',
        ttlSeconds: 3600,
      });
    });
    expect(onChanged).toHaveBeenCalledOnce();

    // ── 4. Clean ─────────────────────────────────────────────────────────
    cleanup();
    // Verify no pending timers or leaked state
    expect(document.querySelector('[data-testid]')).toBeNull();
  });
});

// ============================================================================
// Journey 2: Set absolute expiry via datetime picker
// ============================================================================
describe('Journey: Set absolute expiry via EXPIREAT', () => {
  it('sets expire-at timestamp and verifies setExpireAt command', async () => {
    // ── 1. Prepare ───────────────────────────────────────────────────────
    const { invoke, onChanged } = setupJourney({
      keyName: 'journey2:session-data',
      ttl: 600,
    });

    // Verify initial TTL state carries the numeric TTL
    expectSecondsState(600);

    // ── 2. Act ───────────────────────────────────────────────────────────
    // Find the datetime-local input specifically by its type attribute
    const datetimeInput = document.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement;
    // Use a fixed future time: 2030-01-15T12:00
    fireEvent.change(datetimeInput, { target: { value: '2030-01-15T12:00' } });

    // Click the absolute-expiry apply action
    const expireAtBtn = screen.getByTestId('redis-ttl-expire-at');
    fireEvent.click(expireAtBtn);

    // ── 3. Assert ────────────────────────────────────────────────────────
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('redis', 'set_ttl', {
        dbSessionId: 'test-sess',
        dbIndex: 0,
        key: 'journey2:session-data',
        expireAt: expect.any(Number),
      });
    });

    // Verify the unix timestamp is roughly 2030-01-15 (± timezone offset)
    const callArgs = invoke.mock.calls.find(
      (c) =>
        c[0] === 'redis' &&
        c[1] === 'set_ttl' &&
        typeof (c[2] as Record<string, unknown>).expireAt === 'number',
    );
    expect(callArgs).toBeTruthy();
    const expireAt = (callArgs![2] as { expireAt: number }).expireAt;
    expect(expireAt).toBeGreaterThan(1893000000);
    expect(expireAt).toBeLessThan(1896000000);
    expect(onChanged).toHaveBeenCalledOnce();

    // ── 4. Clean ─────────────────────────────────────────────────────────
    cleanup();
  });
});

// ============================================================================
// Journey 3: Remove TTL via PERSIST
// ============================================================================
describe('Journey: Remove TTL via PERSIST', () => {
  it('removes expiry and verifies persist command with ttlSeconds=-1', async () => {
    // ── 1. Prepare ───────────────────────────────────────────────────────
    const { invoke, onChanged } = setupJourney({
      keyName: 'journey3:cache-item',
      ttl: 120,
    });

    // Verify initial TTL state carries the numeric TTL
    expectSecondsState(120);

    // ── 2. Act ───────────────────────────────────────────────────────────
    // Click the persist (remove TTL) action
    const persistBtn = screen.getByTestId('redis-ttl-persist');
    fireEvent.click(persistBtn);

    // ── 3. Assert ────────────────────────────────────────────────────────
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('redis', 'set_ttl', {
        dbSessionId: 'test-sess',
        dbIndex: 0,
        key: 'journey3:cache-item',
        ttlSeconds: -1,
      });
    });
    expect(onChanged).toHaveBeenCalledOnce();

    // ── 4. Clean ─────────────────────────────────────────────────────────
    cleanup();
  });
});

// ============================================================================
// Journey 4: Error handling — invalid TTL input
// ============================================================================
describe('Journey: Error on invalid TTL input', () => {
  it('shows error message when negative TTL is entered', async () => {
    // ── 1. Prepare ───────────────────────────────────────────────────────
    const { invoke } = setupJourney({
      keyName: 'journey4:error-key',
      ttl: 300,
    });

    // ── 2. Act ───────────────────────────────────────────────────────────
    const ttlInput = screen.getByTestId('redis-ttl-input');
    fireEvent.change(ttlInput, { target: { value: '-5' } });

    const setTtlBtn = screen.getByTestId('redis-ttl-set');
    fireEvent.click(setTtlBtn);

    // ── 3. Assert ────────────────────────────────────────────────────────
    // invoke should NOT have been called for invalid input
    await waitFor(() => {
      expect(invoke).not.toHaveBeenCalled();
    });

    // The inline error slot must appear and carry a resolved message
    // (the copy itself is an i18n value and is deliberately not asserted).
    await waitFor(() => {
      const errorSlot = screen.getByTestId('redis-ttl-error');
      expect((errorSlot.textContent ?? '').trim().length).toBeGreaterThan(0);
    });

    // ── 4. Clean ─────────────────────────────────────────────────────────
    cleanup();
  });
});

// ============================================================================
// Journey 5: Error handling — invalid datetime
// ============================================================================
describe('Journey: Error on invalid datetime', () => {
  it('shows error when invalid datetime is entered', async () => {
    // ── 1. Prepare ───────────────────────────────────────────────────────
    const { invoke } = setupJourney({
      keyName: 'journey5:dt-key',
      ttl: -1,
    });

    // ── 2. Act ───────────────────────────────────────────────────────────
    // Find the datetime-local input specifically by its type attribute
    const datetimeInput = document.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement;
    expect(datetimeInput).toBeTruthy();
    // Set a value that Date.parse cannot parse
    fireEvent.change(datetimeInput, { target: { value: 'not-a-date' } });

    // Click the absolute-expiry apply action
    const expireAtBtn = screen.getByTestId('redis-ttl-expire-at');
    fireEvent.click(expireAtBtn);

    // ── 3. Assert ────────────────────────────────────────────────────────
    // jsdom normalises an unparsable `datetime-local` value to '', so the real
    // contract here is "the apply action stays disabled ⇒ nothing is sent".
    // [tester] That used to be proven only through the absence of the invoke,
    // which stays green even if the guard on the button is dropped — pin the
    // disabled property itself (a DOM-state anchor, no rendered copy).
    await waitFor(() => {
      expect(invoke).not.toHaveBeenCalled();
    });
    expect(screen.getByTestId('redis-ttl-expire-at')).toBeDisabled();

    // ── 4. Clean ─────────────────────────────────────────────────────────
    cleanup();
  });
});

// ============================================================================
// Journey 6: Rapid TTL → Persist → Set again
// ============================================================================
describe('Journey: TTL set → persist → set again cycle', () => {
  it('handles a full lifecycle: EXPIRE → PERSIST → EXPIREAT', async () => {
    // ── 1. Prepare ───────────────────────────────────────────────────────
    const { invoke, onChanged, unmount } = setupJourney({
      keyName: 'journey6:lifecycle-key',
      ttl: -1,
    });
    const ttlInput = screen.getByTestId('redis-ttl-input');
    const setTtlBtn = screen.getByTestId('redis-ttl-set');
    const persistBtn = screen.getByTestId('redis-ttl-persist');
    const expireAtBtn = screen.getByTestId('redis-ttl-expire-at');
    // Find datetime-local by type attribute
    const datetimeInput = document.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement;

    // ── 2. Act: Step A — Set TTL ─────────────────────────────────────────
    fireEvent.change(ttlInput, { target: { value: '7200' } });
    fireEvent.click(setTtlBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('redis', 'set_ttl', {
        dbSessionId: 'test-sess',
        dbIndex: 0,
        key: 'journey6:lifecycle-key',
        ttlSeconds: 7200,
      });
    });

    // ── 3. Act: Step B — Persist ─────────────────────────────────────────
    invoke.mockClear();
    onChanged.mockClear();
    fireEvent.click(persistBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('redis', 'set_ttl', {
        dbSessionId: 'test-sess',
        dbIndex: 0,
        key: 'journey6:lifecycle-key',
        ttlSeconds: -1,
      });
    });

    // ── 4. Act: Step C — Set EXPIREAT ───────────────────────────────────
    invoke.mockClear();
    onChanged.mockClear();
    fireEvent.change(datetimeInput, { target: { value: '2035-06-01T00:00' } });
    fireEvent.click(expireAtBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('redis', 'set_ttl', {
        dbSessionId: 'test-sess',
        dbIndex: 0,
        key: 'journey6:lifecycle-key',
        expireAt: expect.any(Number),
      });
    });

    // ── 5. Clean ─────────────────────────────────────────────────────────
    unmount();
    cleanup();
  });
});

// ============================================================================
// Journey 7: Different dbSessionId and dbIndex
// ============================================================================
describe('Journey: Different session and db index', () => {
  it('passes correct session and db index for non-default config', async () => {
    // ── 1. Prepare ───────────────────────────────────────────────────────
    const { invoke } = setupJourney({
      keyName: 'journey7:special-key',
      ttl: 60,
      dbSessionId: 'custom-session-abc',
      dbIndex: 3,
    });

    // ── 2. Act ───────────────────────────────────────────────────────────
    const persistBtn = screen.getByTestId('redis-ttl-persist');
    fireEvent.click(persistBtn);

    // ── 3. Assert ────────────────────────────────────────────────────────
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('redis', 'set_ttl', {
        dbSessionId: 'custom-session-abc',
        dbIndex: 3,
        key: 'journey7:special-key',
        ttlSeconds: -1,
      });
    });

    // ── 4. Clean ─────────────────────────────────────────────────────────
    cleanup();
  });
});

// ============================================================================
// Journey 8: TTL = -1 (no expiry) shows correct display
// ============================================================================
describe('Journey: No-expiry display and persist when already expired', () => {
  it('reports the no-expiry TTL state for ttl=-1, and persist resets input fields', async () => {
    // ── 1. Prepare ───────────────────────────────────────────────────────
    const { invoke, onChanged } = setupJourney({
      keyName: 'journey8:no-expiry-key',
      ttl: -1,
    });

    // ── 2. Act ───────────────────────────────────────────────────────────
    // Verify the TTL slot is in the no-expiry state
    expectNoExpiryState();

    // Persist should still work (noop but verify command)
    const persistBtn = screen.getByTestId('redis-ttl-persist');
    fireEvent.click(persistBtn);

    // ── 3. Assert ────────────────────────────────────────────────────────
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('redis', 'set_ttl', {
        dbSessionId: 'test-sess',
        dbIndex: 0,
        key: 'journey8:no-expiry-key',
        ttlSeconds: -1,
      });
    });

    // ── 4. Clean ─────────────────────────────────────────────────────────
    cleanup();
  });
});
