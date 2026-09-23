/**
 * redis-tree-backend BUG-002 (round-1 coder fix) — `count_matching` consumer guard.
 *
 * W3-B changed that command's payload from a bare number to the frozen object
 * `{ count, truncated, consumed, dbsize }`, but the two key-browser dialogs kept
 * reading it `as number`, so every "match N keys" label rendered
 * `[object Object]` and its `!== null` empty-state check could never fall back.
 * `tsc` said nothing (an explicit cast silences it) and the drivers suite stayed
 * green because this path had no test at all — that hole is what these cases
 * close, so they must exercise the *components*, not just the helper.
 *
 * Assertion policy (PRD §7-6): `data-testid` markers and digits only. No rendered
 * English copy is asserted anywhere in this file — `redis.matchCount` is mocked to
 * echo only the substituted value, so a locale edit can never redden these cases,
 * and an accidental `[object Object]` cannot hide inside a sentence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// Every Redis command the components fire goes through this journal, so the
// suite controls the payload and can assert which command was asked for.
const commandInvoke = vi.fn();
vi.mock('../shared/redisInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/redisInvoke')>()),
  redisCommandInvoke: (...args: unknown[]) => commandInvoke(...(args as [])),
}));

// Components take `useI18n` from the single @datazen/ui runtime; keep the suite
// locale-independent, and make the label under test yield only its substituted
// value so assertions see digits (or `[object Object]`) and nothing else.
vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  useI18n: () => ({
    t: (key: string) => (key === 'redis.matchCount' ? '{count}' : key),
  }),
}));

// The write gate reads both host bridges at render time.
vi.mock('../shared/useRedisGate', () => ({
  useRedisGate: () => ({ gateWrite: async () => true, gateDialog: null }),
}));

import { formatMatchCount, invokeCountMatching } from '../key-browser/BatchBar';
import { useBatchActions } from '../key-browser/useBatchActions';
import { BatchPatternBar } from '../key-browser/BatchBar';
import { ImportExport, type ImportExportProps } from '../key-browser/ImportExport';
import type { CountMatchingResult } from '../shared/redisInvoke';

/** The wire payload the `## 契约冻结` manufactures. */
function outcome(overrides: Partial<CountMatchingResult> = {}): CountMatchingResult {
  return { count: 777, truncated: false, consumed: 1000, dbsize: 90_000, ...overrides };
}

/**
 * Harness for the pattern strip (D-1 moved the dialogs into `useBatchActions`,
 * so the strip alone cannot open them). Renders the same pair the workbench
 * mounts: the controller hook's dialogs plus the strip that triggers them.
 */
function PatternStripHarness({
  dbSessionId = 'sess',
  dbIndex = 3,
  selectedKeys = ['app:a'],
  searchPattern = 'app:*',
}: {
  dbSessionId?: string;
  dbIndex?: number;
  selectedKeys?: string[];
  searchPattern?: string;
}) {
  const actions = useBatchActions({
    dbSessionId,
    dbIndex,
    selectedKeys,
    searchPattern,
    onRemoveFromSelection: () => {},
    onRefresh: async () => {},
  });
  return (
    <>
      <BatchPatternBar actions={actions} dbIndex={dbIndex} />
      {actions.dialogs}
    </>
  );
}

function exportProps(overrides: Partial<ImportExportProps> = {}): ImportExportProps {
  return {
    dbSessionId: 'sess',
    dbIndex: 3,
    selectedKeys: ['app:a'],
    searchPattern: 'app:*',
    open: true,
    onOpenChange: () => {},
    onRefresh: async () => {},
    ...overrides,
  };
}

/** Names the driver command and the input it was handed. */
function countCall(): { command: string; input: Record<string, unknown> } {
  const call = commandInvoke.mock.calls.find((args) => args[1] === 'count_matching');
  if (!call) throw new Error('count_matching was never invoked');
  return { command: String(call[1]), input: (call[2] ?? {}) as Record<string, unknown> };
}

beforeEach(() => {
  cleanup();
  commandInvoke.mockReset();
  commandInvoke.mockResolvedValue(outcome());
});

describe('invokeCountMatching', () => {
  it('hands the caller the frozen object, not a coerced number', async () => {
    const invoke = vi.fn(async () => outcome({ count: 7 }));

    const result = await invokeCountMatching('sess', 0, 'app:*', invoke);

    expect(typeof result).toBe('object');
    expect(result.count).toBe(7);
    expect(result.truncated).toBe(false);
    expect(result.consumed).toBe(1000);
    expect(result.dbsize).toBe(90_000);
    expect(invoke).toHaveBeenCalledWith('redis', 'count_matching', {
      dbSessionId: 'sess',
      dbIndex: 0,
      pattern: 'app:*',
    });
  });
});

describe('formatMatchCount', () => {
  it('marks a truncated floor with + and leaves a census bare', () => {
    expect(formatMatchCount(outcome({ count: 777, truncated: false }))).toBe('777');
    expect(formatMatchCount(outcome({ count: 777, truncated: true }))).toBe('777+');
  });
});

describe('BatchBar pattern dialog', () => {
  /** Open the dialog, type a pattern, and let the blur-triggered count land. */
  async function openAndCount(payload: CountMatchingResult) {
    commandInvoke.mockResolvedValue(payload);
    render(<PatternStripHarness />);
    expect(screen.queryByTestId('redis-batch-pattern-count')).toBeNull();

    fireEvent.click(screen.getByTestId('redis-batch-pattern'));
    // `request()` awaits the write gate before the dialog mounts, so wait for
    // the confirm marker rather than assuming the inputs exist synchronously.
    await screen.findByTestId('redis-batch-pattern-confirm');
    const input = screen.getByTestId('redis-batch-pattern-input');
    fireEvent.change(input, { target: { value: 'app:*' } });
    fireEvent.blur(input);

    const label = await screen.findByTestId('redis-batch-pattern-count');
    return { label };
  }

  it('renders .count for a complete census', async () => {
    const { label } = await openAndCount(outcome({ count: 777, truncated: false }));
    expect(label.textContent).toBe('777');
    expect(label.textContent).not.toContain('[object');
    expect(countCall().input.pattern).toBe('app:*');
  });

  it('renders n+ when the budget truncated the census', async () => {
    const { label } = await openAndCount(outcome({ count: 1000, truncated: true }));
    expect(label.textContent).toBe('1000+');
  });

  it('clears a stale count when the pattern changes', async () => {
    const { label } = await openAndCount(outcome({ count: 42 }));
    expect(label.textContent).toBe('42');
    // Typing resets the read, so the old number cannot be quoted for a new filter.
    fireEvent.change(screen.getByTestId('redis-batch-pattern-input'), {
      target: { value: 'other:*' },
    });
    expect(screen.queryByTestId('redis-batch-pattern-count')).toBeNull();
  });
});

describe('ImportExport pattern count', () => {
  async function switchToPatternMode() {
    render(<ImportExport {...exportProps()} />);
    await act(async () => {
      fireEvent.click(screen.getByText('redis.importExportPattern'));
    });
    return screen.findByTestId('redis-export-match-count');
  }

  it('renders .count after the estimate is requested', async () => {
    commandInvoke.mockResolvedValue(outcome({ count: 12, truncated: false }));
    const button = await switchToPatternMode();
    // Pre-load state must be a placeholder, never a stringified object.
    expect(button.textContent).not.toContain('[object');

    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.textContent).toBe('12');
    expect(countCall().input.pattern).toBe('app:*');
  });

  it('renders n+ for a truncated count', async () => {
    commandInvoke.mockResolvedValue(outcome({ count: 12, truncated: true }));
    const button = await switchToPatternMode();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.textContent).toBe('12+');
  });

  it('falls back to the placeholder when the read fails', async () => {
    commandInvoke.mockRejectedValue(new Error('unreachable'));
    const button = await switchToPatternMode();
    await act(async () => {
      fireEvent.click(button);
    });
    // The failed read yields null state, and an object payload can never make
    // `matchCount !== null` lie again.
    expect(button.textContent).toBe('…');
    expect(button.textContent).not.toContain('[object');
  });
});
