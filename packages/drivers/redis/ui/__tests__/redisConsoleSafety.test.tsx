/**
 * RedisConsole fail-closed journey (track `redis-console-safety`, PRD §4 I-7,
 * task book §6.1 R-3 + §6.4 P0-3).
 *
 * Drives the real textarea through keystroke sequences so the partial states
 * ("half a command", "name only", "name + newline") are exercised, then asserts
 * on `data-*` state and i18n keys — never on English copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { create } from 'zustand';
import {
  bindConfirmDialog,
  bindConnectionStore,
  bindSettingsStore,
  useBoundSettingsStore,
  type ConnectionBridgeState,
  type ConfirmDialogFn,
  type ConfirmDialogOptions,
  type SettingsBridgeState,
} from '@datazen/driver-sdk';

const scanKeys = vi.fn();
const commandInvoke = vi.fn();

vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  // Keys are asserted verbatim; `{param}` values are appended so the batch
  // listing (which commands were refused / need confirming) stays observable.
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${Object.values(params).join(' ')}` : key,
  }),
}));

vi.mock('../shared/redisInvoke', () => ({
  redisCommandInvoke: (...args: unknown[]) => commandInvoke(...args),
  invokeScanKeys: (...args: unknown[]) => scanKeys(...args),
}));

import { RedisConsole } from '../console/RedisConsole';

function setDriverSettings(redis: Record<string, unknown>) {
  useBoundSettingsStore.setState((s) => ({
    settings: { ...s.settings, driverSettings: { redis } },
  }));
}

bindSettingsStore(
  create<SettingsBridgeState>(() => ({
    settings: { safeMode: false, editorFontFamily: '', driverSettings: { redis: {} } },
  })),
);
bindConnectionStore(create<ConnectionBridgeState>(() => ({ connections: [] })));

let confirmCalls: ConfirmDialogOptions[] = [];
let confirmBehaviour: (index: number) => boolean = () => true;

function stubConfirm(behaviour: (index: number) => boolean = () => true) {
  confirmCalls = [];
  confirmBehaviour = behaviour;
  const confirmFn = vi.fn<ConfirmDialogFn>((options) => {
    const index = confirmCalls.length;
    confirmCalls.push(options);
    return Promise.resolve(behaviour(index));
  });
  bindConfirmDialog(() => [confirmFn, null]);
}

function badge() {
  return screen.getByTestId('redis-console-danger-badge');
}

function typeInto(input: HTMLTextAreaElement, value: string) {
  fireEvent.change(input, {
    target: { value, selectionStart: value.length, selectionEnd: value.length },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setDriverSettings({});
  useBoundSettingsStore.setState((s) => ({ settings: { ...s.settings, safeMode: false } }));
});

beforeEach(() => {
  commandInvoke.mockResolvedValue({ results: [] });
  scanKeys.mockResolvedValue({ keys: [], cursor: 0, done: true });
  stubConfirm();
});

describe('typing journey — the badge leaves the unknown state as the command completes', () => {
  it('walks KEYS from a half-typed token to a known destructive command and back out', async () => {
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    // 'K' / 'KE' are not commands: fail-closed means the badge already refuses.
    for (const partial of ['K', 'KE', 'KEY']) {
      typeInto(input, partial);
      expect(badge().getAttribute('data-danger-level')).toBe('ultra-danger');
      expect(badge().getAttribute('data-danger-unknown')).toBe('true');
    }

    // the command name alone completes into the *known* destructive tier
    typeInto(input, 'KEYS');
    expect(badge().getAttribute('data-danger-level')).toBe('ultra-danger');
    expect(badge().getAttribute('data-danger-unknown')).toBe('false');

    // typing the argument keeps it destructive
    typeInto(input, 'KEYS *');
    expect(badge().getAttribute('data-danger-level')).toBe('ultra-danger');

    // exit transition: replacing the input with a read clears the red
    typeInto(input, 'GET user:1');
    expect(badge().getAttribute('data-danger-level')).toBe('safe');
    expect(badge().getAttribute('data-danger-unknown')).toBe('false');

    // trailing newline (the "command name + newline" state) stays classified
    typeInto(input, 'GET user:1\n');
    expect(badge().getAttribute('data-danger-level')).toBe('safe');
  });

  it('grades a multi-line batch by its strictest line', () => {
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'GET a\nSET b 1');
    expect(badge().getAttribute('data-danger-level')).toBe('write');

    typeInto(input, 'GET a\nDEL b');
    expect(badge().getAttribute('data-danger-level')).toBe('danger');

    typeInto(input, 'GET a\nNOT_A_COMMAND b');
    expect(badge().getAttribute('data-danger-level')).toBe('ultra-danger');
    expect(badge().getAttribute('data-danger-unknown')).toBe('true');
  });
});

describe('blocked commands never reach the server', () => {
  it('refuses a known destructive command with the destructive copy key', async () => {
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'KEYS *');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('redis-console-error')).toBeTruthy());
    expect(screen.getByTestId('redis-console-error').textContent).toContain(
      'redis.consoleSafety.blockedDestructive',
    );
    expect(commandInvoke).not.toHaveBeenCalled();
    // refusing must not degrade into a confirmation dialog
    expect(confirmCalls).toHaveLength(0);
  });

  it('refuses an unrecognised command with its own copy key', async () => {
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'JSON.GET doc');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('redis-console-error')).toBeTruthy());
    const text = screen.getByTestId('redis-console-error').textContent ?? '';
    expect(text).toContain('redis.consoleSafety.blockedUnknown');
    expect(text).not.toContain('redis.consoleSafety.blockedDestructive');
    expect(commandInvoke).not.toHaveBeenCalled();
  });

  it('refuses the whole batch when one line is blocked, but keeps the good lines typed', async () => {
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'GET a\nEVAL "return 1" 0');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('redis-console-error')).toBeTruthy());
    expect(screen.getByTestId('redis-console-error').textContent).toContain('EVAL "return 1" 0');
    expect(commandInvoke).not.toHaveBeenCalled();
  });

  it('keeps the dedicated FLUSHDB copy without the allowFlush opt-in', async () => {
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'FLUSHDB');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('redis-console-error')).toBeTruthy());
    expect(screen.getByTestId('redis-console-error').textContent).toContain(
      'redis.console.flushBlocked',
    );
    expect(commandInvoke).not.toHaveBeenCalled();
  });
});

describe('batch gate semantics (R-3)', () => {
  it('asks once for a mixed batch and lists every danger-tier-and-above command', async () => {
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'GET a\nDEL b\nEXPIRE c 1');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(commandInvoke).toHaveBeenCalledTimes(1));
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0].codePreview).toContain('DEL b, EXPIRE c 1');
    expect(commandInvoke.mock.calls[0]?.[2]).toMatchObject({ commands: 'GET a\nDEL b\nEXPIRE c 1' });
  });

  it('cancelling the single confirmation stops the whole batch', async () => {
    stubConfirm(() => false);
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'GET a\nDEL b');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(confirmCalls).toHaveLength(1));
    expect(commandInvoke).not.toHaveBeenCalled();
  });

  it('asks twice for an allowFlush FLUSHDB (destructive second brake)', async () => {
    setDriverSettings({ allowFlush: true });
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'SET a 1\nFLUSHDB');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(commandInvoke).toHaveBeenCalledTimes(1));
    expect(confirmCalls).toHaveLength(2);
    // the single batch dialog lists the flush command, the second one isolates it
    expect(confirmCalls[0].codePreview).toContain('FLUSHDB');
    expect(confirmCalls[0].badge).toBe('danger');
    expect(confirmCalls[1].codePreview).toBe('FLUSHDB');
    expect(confirmCalls[1].badge).toBe('ultra-danger');
  });

  it('stops before the server when the second confirmation is refused', async () => {
    setDriverSettings({ allowFlush: true });
    stubConfirm((index) => index === 0);
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'FLUSHDB');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(confirmCalls).toHaveLength(2));
    expect(commandInvoke).not.toHaveBeenCalled();
  });

  it('keeps Safe Mode in front of the write path (I-6 unchanged)', async () => {
    useBoundSettingsStore.setState((s) => ({ settings: { ...s.settings, safeMode: true } }));
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'SET a 1');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(confirmCalls).toHaveLength(1));
    expect(confirmCalls[0].title).toBe('settings.safeMode');
    expect(confirmCalls[0].message).toBe('redis.safeMode.blocked');
    expect(commandInvoke).not.toHaveBeenCalled();
  });
});

describe('per-command results (P0-3 / R-3.2)', () => {
  it('shows every failed command error without dropping the later results', async () => {
    commandInvoke.mockResolvedValue({
      results: [
        { command: 'GET a', ok: true, value: '1', resultType: 'scalar' },
        { command: 'GET hash:1', ok: false, error: 'WRONGTYPE', resultType: 'error' },
        { command: 'PING', ok: true, value: 'PONG', resultType: 'ok' },
      ],
    });
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'GET a\nGET hash:1\nPING');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('redis-console-failed-count')).toBeTruthy());
    expect(screen.getByTestId('redis-console-failed-count').textContent).toContain(
      'redis.errorsCount',
    );
    // sequential execution: the third command is still there and selectable
    const tabs = screen.getAllByRole('button').filter((b) => b.title?.startsWith('GET') || b.title === 'PING');
    expect(tabs).toHaveLength(3);
    fireEvent.click(tabs[1]);
    expect(screen.getByTestId('redis-console-result').textContent).toContain('WRONGTYPE');
    fireEvent.click(tabs[2]);
    expect(screen.getByTestId('redis-console-result').textContent).toContain('PONG');
  });

  it('renders the server-provided resultType instead of re-guessing it', async () => {
    commandInvoke.mockResolvedValue({
      results: [
        { command: 'HGETALL h', ok: true, value: '[a, b]', resultType: 'array' },
        { command: 'GET z', ok: true, value: 'scalar-looking', resultType: 'scalar' },
      ],
    });
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'HGETALL h');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('redis-console-result')).toBeTruthy());
    // `[a, b]` formatted as a scalar would print verbatim; as an array it becomes rows.
    expect(screen.getByTestId('redis-console-result').textContent).not.toContain('[a, b]');
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('falls back to inferring the shape when the server omits resultType', async () => {
    commandInvoke.mockResolvedValue({
      results: [{ command: 'HGETALL h', ok: true, value: '{a => 1}' }],
    });
    render(<RedisConsole dbSessionId="sess-1" dbIndex={0} />);
    const input = screen.getByTestId('redis-console-input') as HTMLTextAreaElement;

    typeInto(input, 'HGETALL h');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByTestId('redis-console-result')).toBeTruthy());
    expect(screen.getByTestId('redis-console-result').textContent).toContain('a');
  });
});
