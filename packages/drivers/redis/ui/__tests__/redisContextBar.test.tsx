/**
 * `contextBar` slot — the 48px KV context bar (PRD §3.4, ruling 8-2 = full).
 *
 * Two halves, deliberately separated:
 *
 * 1. **Pure model** (`contextBarModel`): every §3.4 hard constraint stated as a
 *    function — the sampled-chips verdict, `maxmemory 0` ⇒ "no ceiling", the
 *    unknown-budget rule, the db-list union, the compact degradation.
 * 2. **Component**: that the model's decisions actually reach the DOM, that
 *    each of the six fields renders, and that every clickable thing asks the
 *    host through `request` with the exact `KvSlotAction` payload.
 *
 * Assertion policy (PRD §7-6): nothing here quotes translated copy. Locators are
 * `data-testid` / `data-*`; state is asserted through `data-scan-state`,
 * `data-max-bytes`, `data-truncated`, `data-i18n-key` and friends. Values echoed
 * from Redis — a type token, a byte count — are server data and asserted
 * directly.
 *
 * `t()` is mocked to echo the key, so even an accidental `getByText` would be
 * comparing keys, never translations.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { create } from 'zustand';
import type { KvContextBarProps, KvSlotAction, KvSlotState } from '@datazen/driver-sdk';
import { bindSettingsStore, type SettingsBridgeState } from '@datazen/driver-sdk';

// Key-style `t()`: the message is the i18n key (never English copy), with the
// interpolation params appended as `name=value` so tests can still assert on the
// server numbers the component stuffed into them.
vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params
        ? `${key} ${Object.entries(params)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(' ')}`
        : key,
  }),
}));

const commandInvoke = vi.fn();
vi.mock('../shared/redisInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/redisInvoke')>()),
  redisCommandInvoke: (...args: unknown[]) => commandInvoke(...(args as [])),
}));

import { RedisContextBar } from '../kv-bar';
import {
  budgetBar,
  contextBarLayout,
  dbIndexOf,
  deriveDbOptions,
  deriveMemoryReadout,
  deriveScanReadout,
  deriveTypeChips,
  formatCompactCount,
  partInBand,
  SCAN_BUDGET_TIERS,
  type TypeDistribution,
} from '../kv-bar/contextBarModel';

/**
 * The SafeMode badge reads the host settings store through the driver-SDK
 * bridge, so the suite binds one — exactly the wiring a real host mount provides
 * (`bindSettingsStore(useSettingsStore)`). Safe Mode off keeps the badge out of
 * the way; `kvBarSlots.test.tsx` owns the badge's own behaviour.
 */
bindSettingsStore(
  create<SettingsBridgeState>(() => ({
    settings: { safeMode: false, editorFontFamily: '', driverSettings: {} },
  })),
);

/**
 * Local stand-in for the host's per-panel atom. A driver test may not import
 * `src/lib/kvSlotState.ts` (boundary guard R1), so the contract under test is
 * the `KvSlotState` *type* — here with all of F-1's widened scalars, which is
 * what the context bar's scan cluster reads.
 */
interface RelayState {
  scanning: boolean;
  budgetUsed: number;
  budgetTotal: number;
  scanCursor: string;
  loadedCount: number;
  selectionCount: number;
  lastWriteCommand: string | null;
  lastWriteDurationMs: number | null;
}

function makeRelay(over: Partial<RelayState> = {}): KvSlotState & { set(next: Partial<RelayState>): void } {
  const listeners = new Set<() => void>();
  const values: RelayState = {
    scanning: false,
    budgetUsed: 0,
    budgetTotal: 0,
    scanCursor: '0',
    loadedCount: 0,
    selectionCount: 0,
    lastWriteCommand: null,
    lastWriteDurationMs: null,
    ...over,
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSelectedKey: () => null,
    selectKey: () => {},
    getDirty: () => false,
    setDirty: () => {},
    getLoadedCount: () => values.loadedCount,
    setLoadedCount: (n) => {
      values.loadedCount = n;
      notify();
    },
    getScanCursor: () => values.scanCursor,
    setScanCursor: (cursor) => {
      values.scanCursor = cursor;
      notify();
    },
    isScanning: () => values.scanning,
    setScanning: (scanning) => {
      values.scanning = scanning;
      notify();
    },
    getScanBudgetUsed: () => values.budgetUsed,
    getScanBudgetTotal: () => values.budgetTotal,
    setScanBudget: (used, total) => {
      values.budgetUsed = used;
      values.budgetTotal = total;
      notify();
    },
    getSelectionCount: () => values.selectionCount,
    setSelectionCount: (n) => {
      values.selectionCount = n;
      notify();
    },
    getLastWriteCommand: () => values.lastWriteCommand,
    getLastWriteDurationMs: () => values.lastWriteDurationMs,
    recordWrite: (command, durationMs) => {
      values.lastWriteCommand = command;
      values.lastWriteDurationMs = durationMs;
      notify();
    },
    set(next) {
      Object.assign(values, next);
      notify();
    },
  };
}

function barProps(
  state: KvSlotState,
  over: Partial<KvContextBarProps> = {},
): KvContextBarProps {
  return {
    connectionId: 'conn-1',
    dbSessionId: 'sess-1',
    connectionName: 'local',
    databaseType: 'redis' as KvContextBarProps['databaseType'],
    database: 'db5',
    dbIndex: 5,
    state,
    compact: false,
    request: vi.fn(),
    ...over,
  };
}

const DB_SIZES = [
  { db: 0, keys: 3 },
  { db: 5, keys: 52 },
];

const DISTRIBUTION: TypeDistribution = {
  counts: { string: 30, hash: 12, list: 6 },
  sampled: 48,
  dbsize: 100,
  truncated: true,
};

const INFO_MEMORY = {
  sections: [
    {
      name: 'Memory',
      entries: [
        { key: 'used_memory', value: '1258291' },
        { key: 'maxmemory', value: '4194304' },
      ],
    },
  ],
};

/** Route the three context-bar commands; unknown commands resolve empty. */
function stubSources({
  dbSizes = DB_SIZES,
  distribution = DISTRIBUTION,
  memory = INFO_MEMORY,
}: {
  dbSizes?: unknown;
  distribution?: unknown;
  memory?: unknown;
} = {}) {
  commandInvoke.mockImplementation((_plugin: string, command: string) => {
    if (command === 'db_sizes') return Promise.resolve(dbSizes);
    if (command === 'type_distribution') return Promise.resolve(distribution);
    if (command === 'info_filtered') return Promise.resolve(memory);
    return Promise.resolve(null);
  });
}

/** Let all three source promises settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// pure model
// ---------------------------------------------------------------------------

describe('contextBarModel — db list', () => {
  it('unions the declared window with whatever db_sizes reported', () => {
    const options = deriveDbOptions(DB_SIZES, 7);
    expect(options.map((o) => o.name)).toEqual([
      'db0',
      'db1',
      'db2',
      'db3',
      'db4',
      'db5',
      'db6',
      'db7',
    ]);
    expect(options[5].keys).toBe(52);
    // A db the server knows about but the window does not still gets an entry:
    // dropping it would hide a database the user can reach.
    expect(deriveDbOptions([{ db: 20, keys: 1 }], 1).map((o) => o.name)).toContain('db20');
  });

  it('survives a missing or malformed db_sizes reply', () => {
    expect(deriveDbOptions(null, 3).map((o) => o.name)).toEqual(['db0', 'db1', 'db2', 'db3']);
    expect(deriveDbOptions([], 0).map((o) => o.name)).toEqual(['db0']);
    expect(deriveDbOptions(null, -5).map((o) => o.name)).toEqual(['db0']);
    // A negative / non-integer row cannot become an option index.
    expect(deriveDbOptions([{ db: -1, keys: 9 }], 0).every((o) => o.dbIndex >= 0)).toBe(true);
  });

  it('names dbs the way Redis does, and parses only that shape', () => {
    expect(dbIndexOf('db12')).toBe(12);
    expect(dbIndexOf('db0')).toBe(0);
    expect(dbIndexOf('db')).toBeNull();
    expect(dbIndexOf('db1x')).toBeNull();
    expect(dbIndexOf('12')).toBeNull();
  });
});

describe('contextBarModel — sampled chips (the §3.4 hard constraint)', () => {
  it('marks a truncated distribution and leaves a census unmarked', () => {
    const truncated = deriveTypeChips(DISTRIBUTION);
    expect(truncated?.sample).toEqual({ sampled: 48, dbsize: 100 });

    const census = deriveTypeChips({ counts: { string: 5 }, sampled: 5, dbsize: 5 });
    expect(census?.sample).toBeNull();
    // `sampled > dbsize` cannot happen on a healthy server, but if it does the
    // distribution is not short of the census, so it must not be marked either.
    expect(deriveTypeChips({ counts: { string: 5 }, sampled: 9, dbsize: 5 })?.sample).toBeNull();
  });

  it('recomputes the verdict instead of trusting the wire flag', () => {
    // Same counts, contradictory `truncated` bits: the numbers win, because the
    // comparison is the rule §3.4 states.
    const lyingTrue = deriveTypeChips({
      counts: { string: 5 },
      sampled: 5,
      dbsize: 5,
      truncated: true,
    });
    expect(lyingTrue?.sample).toBeNull();
    const lyingFalse = deriveTypeChips({
      counts: { string: 1 },
      sampled: 1,
      dbsize: 50,
      truncated: false,
    });
    expect(lyingFalse?.sample).toEqual({ sampled: 1, dbsize: 50 });
  });

  it('orders chips by count then name, and drops nothing that has keys', () => {
    const model = deriveTypeChips({
      counts: { zset: 2, hash: 9, stream: 2, string: 30 },
      sampled: 43,
      dbsize: 43,
      truncated: false,
    });
    expect(model?.chips.map((c) => c.type)).toEqual(['string', 'hash', 'stream', 'zset']);
    expect(model?.chips.map((c) => c.count)).toEqual([30, 9, 2, 2]);
  });

  it('yields nothing for a failed / empty / malformed read — never zeros', () => {
    expect(deriveTypeChips(null)).toBeNull();
    expect(deriveTypeChips({ counts: {}, sampled: 0, dbsize: 0, truncated: false })).toBeNull();
    expect(
      deriveTypeChips({ counts: { string: 0 }, sampled: 0, dbsize: 9, truncated: true }),
    ).toBeNull();
    // A reply the driver could not shape is indistinguishable from a failure.
    expect(
      deriveTypeChips({ counts: null as unknown as Record<string, number>, sampled: 0, dbsize: 0, truncated: false }),
    ).toBeNull();
  });
});

describe('contextBarModel — memory', () => {
  it('reads used / max and treats maxmemory 0 as no ceiling', () => {
    expect(deriveMemoryReadout({ used_memory: '1000', maxmemory: '4000' })).toEqual({
      usedBytes: 1000,
      maxBytes: 4000,
    });
    // The one value that must never reach the DOM as a number.
    expect(deriveMemoryReadout({ used_memory: '1000', maxmemory: '0' })?.maxBytes).toBeNull();
    // An absent / malformed maxmemory is equally "no ceiling declared".
    expect(deriveMemoryReadout({ used_memory: '1000' })?.maxBytes).toBeNull();
    expect(deriveMemoryReadout({ used_memory: '1000', maxmemory: 'abc' })?.maxBytes).toBeNull();
  });

  it('renders nothing when used_memory itself is unreadable', () => {
    // A lone `max` would be a fragment of a fact; §3.4's rule is 不渲染.
    expect(deriveMemoryReadout({ maxmemory: '4000' })).toBeNull();
    expect(deriveMemoryReadout({})).toBeNull();
    expect(deriveMemoryReadout({ used_memory: 'x' })).toBeNull();
  });
});

describe('contextBarModel — scan budget', () => {
  it('draws a fraction only when there is a denominator', () => {
    expect(budgetBar(0)).toBe('░░░░');
    expect(budgetBar(25)).toBe('▉░░░');
    expect(budgetBar(50)).toBe('▉▉░░');
    expect(budgetBar(100)).toBe('▉▉▉▉');
    expect(budgetBar(999)).toBe('▉▉▉▉');
    // No denominator ⇒ no bar at all, not a 0% or 100% fabrication.
    expect(budgetBar(null)).toBe('');
  });

  it('is silent while idle and unused, and reports the unknown-budget case', () => {
    expect(
      deriveScanReadout({ scanning: false, used: 0, total: 0, cursor: '0' }),
    ).toBeNull();
    const unknown = deriveScanReadout({ scanning: false, used: 12_000, total: 0, cursor: '0' });
    expect(unknown?.state).toBe('done');
    expect(unknown?.percent).toBeNull();
    expect(unknown?.bar).toBe('');
  });

  it('reports progress while scanning and completion only on a wrapped cursor', () => {
    const scanning = deriveScanReadout({
      scanning: true,
      used: 12_000,
      total: 50_000,
      cursor: '17',
    });
    expect(scanning?.state).toBe('scanning');
    expect(scanning?.percent).toBe(24);
    expect(scanning?.bar).toBe('▉░░░');

    // Cursor non-zero and no scan running ⇒ it stopped early (I-2/I-4).
    const stopped = deriveScanReadout({ scanning: false, used: 900, total: 50_000, cursor: '17' });
    expect(stopped?.state).toBe('stopped');

    const done = deriveScanReadout({ scanning: false, used: 900, total: 50_000, cursor: '0' });
    expect(done?.state).toBe('done');
  });

  it("never claims completion from cursor '0' alone (F-1's explicit warning)", () => {
    // A fresh panel reports both `'0'` and `used === 0` — that is `idle`, not
    // `done`. The pair is what separates "nothing happened" from "it finished".
    expect(deriveScanReadout({ scanning: false, used: 0, total: 50_000, cursor: '0' })).toBeNull();
    expect(deriveScanReadout({ scanning: false, used: 0, total: 0, cursor: '0' })).toBeNull();
  });

  it('clamps a budget overshoot to a full bar', () => {
    const over = deriveScanReadout({ scanning: true, used: 60_000, total: 50_000, cursor: '3' });
    expect(over?.percent).toBe(100);
    expect(over?.bar).toBe('▉▉▉▉');
  });
});

describe('contextBarModel — responsive layout (I-10)', () => {
  it('keeps the identifying fields and drops the decorations first', () => {
    expect(contextBarLayout(false)).toBe('full');
    expect(contextBarLayout(true)).toBe('compact');
    for (const part of ['db', 'keys', 'scan'] as const) {
      expect(partInBand(part, 'full')).toBe(true);
      expect(partInBand(part, 'compact')).toBe(true);
    }
    for (const part of ['memory', 'types'] as const) {
      expect(partInBand(part, 'full')).toBe(true);
      expect(partInBand(part, 'compact')).toBe(false);
    }
  });
});

describe('contextBarModel — compact counts', () => {
  it('keeps a 48px band readable', () => {
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(52)).toBe('52');
    expect(formatCompactCount(999)).toBe('999');
    expect(formatCompactCount(1000)).toBe('1k');
    expect(formatCompactCount(1200)).toBe('1.2k');
    expect(formatCompactCount(12_000)).toBe('12k');
    expect(formatCompactCount(999_999)).toBe('1000k');
    expect(formatCompactCount(1_200_000)).toBe('1M');
    expect(formatCompactCount(-5)).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

describe('RedisContextBar — the six §3.4 fields', () => {
  it('renders db, keys, memory, chips and scan as separate identified parts', async () => {
    stubSources();
    const state = makeRelay({ scanning: true, budgetUsed: 12_000, budgetTotal: 50_000, scanCursor: '9' });
    const { container } = render(<RedisContextBar {...barProps(state)} />);
    await settle();

    const bar = screen.getByTestId('redis-context-bar');
    expect(bar.getAttribute('data-active-db')).toBe('db5');
    expect(bar.getAttribute('data-layout')).toBe('full');

    const select = screen.getByTestId('redis-context-db') as HTMLSelectElement;
    expect(select.value).toBe('db5');
    // The picker is wired, not a disabled placeholder.
    expect(select.getAttribute('data-db-switch')).toBe('wired');
    expect(select.disabled).toBe(false);
    // `redisMeta.maxDatabaseIndex` (15) wins the union with the `db_sizes` rows,
    // so the window is db0…db15 even though the reply only mentioned two dbs.
    expect(select.getAttribute('data-db-count')).toBe('16');

    const keys = screen.getByTestId('redis-context-keys');
    expect(keys.getAttribute('data-keys')).toBe('52');
    expect(keys.getAttribute('data-i18n-key')).toBe('redis.dbSize');
    expect(keys.textContent).toContain('52');

    const memory = screen.getByTestId('redis-context-memory');
    expect(memory.getAttribute('data-used-bytes')).toBe('1258291');
    expect(memory.getAttribute('data-max-bytes')).toBe('4194304');
    expect(memory.textContent).toContain('1.2 MB');
    expect(memory.textContent).toContain('4.0 MB');

    const types = screen.getByTestId('redis-context-types');
    expect(types.getAttribute('data-chip-count')).toBe('3');
    expect(screen.getByTestId('redis-context-chip-string').getAttribute('data-count')).toBe('30');
    expect(screen.getByTestId('redis-context-chip-hash').getAttribute('data-count')).toBe('12');
    expect(screen.getByTestId('redis-context-chip-list').getAttribute('data-count')).toBe('6');

    const scan = screen.getByTestId('redis-context-scan');
    expect(scan.getAttribute('data-scan-state')).toBe('scanning');
    expect(scan.getAttribute('data-budget-used')).toBe('12000');
    expect(scan.getAttribute('data-budget-total')).toBe('50000');
    expect(scan.getAttribute('data-budget-percent')).toBe('24');
    expect(screen.getByTestId('redis-context-scan-bar').textContent).toBe('▉░░░');

    // Six fields, six identifiable roots — nothing rendered under a blur.
    expect(container.querySelectorAll('[data-part]').length).toBeGreaterThanOrEqual(5);
  });

  it('asks the server for exactly the three documented commands and input', async () => {
    stubSources();
    render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();

    const calls = commandInvoke.mock.calls.map(([, command, args]) => [command, args]);
    expect(calls).toContainEqual([
      'db_sizes',
      { dbSessionId: 'sess-1' },
    ]);
    expect(calls).toContainEqual([
      'type_distribution',
      { dbSessionId: 'sess-1', dbIndex: 5 },
    ]);
    expect(calls).toContainEqual([
      'info_filtered',
      { dbSessionId: 'sess-1', section: 'memory' },
    ]);
  });
});

describe('RedisContextBar — sampled-chips three-state behaviour', () => {
  it('shows the mandatory annotation when the sample is short of the census', async () => {
    stubSources();
    render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();

    const types = screen.getByTestId('redis-context-types');
    expect(types.getAttribute('data-truncated')).toBe('true');
    expect(types.getAttribute('data-sampled')).toBe('48');
    expect(types.getAttribute('data-dbsize')).toBe('100');
    const note = screen.getByTestId('redis-context-types-sampled');
    expect(note.getAttribute('data-sampled')).toBe('48');
    expect(note.getAttribute('data-dbsize')).toBe('100');
    expect(note.getAttribute('data-i18n-key')).toBe('redis.contextBar.sampled');
  });

  it('omits the annotation for a full census', async () => {
    stubSources({
      distribution: { counts: { string: 52 }, sampled: 52, dbsize: 52, truncated: false },
    });
    render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();

    const types = screen.getByTestId('redis-context-types');
    expect(types.getAttribute('data-truncated')).toBe('false');
    expect(types.getAttribute('data-sampled')).toBe('exact');
    expect(screen.queryByTestId('redis-context-types-sampled')).toBeNull();
    // The chips themselves are still there — only the caveat goes away.
    expect(screen.getByTestId('redis-context-chip-string')).not.toBeNull();
  });

  it('renders no chips at all when the read fails — and no zeros either', async () => {
    commandInvoke.mockImplementation((_plugin: string, command: string) => {
      if (command === 'db_sizes') return Promise.resolve(DB_SIZES);
      if (command === 'type_distribution') return Promise.reject(new Error('NOPERM'));
      if (command === 'info_filtered') return Promise.resolve(INFO_MEMORY);
      return Promise.resolve(null);
    });
    const { container } = render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();

    expect(screen.queryByTestId('redis-context-types')).toBeNull();
    expect(container.querySelector('[data-part="types"]')).toBeNull();
    // The anti-assertion that matters: zero distribution must not be implied.
    expect(container.textContent ?? '').not.toContain('string 0');
    expect(container.querySelectorAll('[data-type]')).toHaveLength(0);
    // Everything else survives — a locked-down server still gets a usable band.
    expect(screen.getByTestId('redis-context-keys')).not.toBeNull();
    expect(screen.getByTestId('redis-context-memory')).not.toBeNull();
  });

  it('treats an empty counts map as no chips rather than zero chips', async () => {
    stubSources({
      distribution: { counts: {}, sampled: 0, dbsize: 0, truncated: false },
    });
    render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();
    expect(screen.queryByTestId('redis-context-types')).toBeNull();
  });
});

describe('RedisContextBar — memory with no ceiling', () => {
  it('says "no limit" instead of printing max 0', async () => {
    stubSources({
      memory: {
        sections: [
          {
            name: 'Memory',
            entries: [
              { key: 'used_memory', value: '1258291' },
              { key: 'maxmemory', value: '0' },
            ],
          },
        ],
      },
    });
    const { container } = render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();

    const memory = screen.getByTestId('redis-context-memory');
    // The machine-readable half is unambiguous…
    expect(memory.getAttribute('data-max-bytes')).toBe('unlimited');
    // …and the human half uses the dedicated wording, never `0`.
    expect(memory.getAttribute('data-i18n-key')).toBe('redis.contextBar.memoryUnlimited');
    expect(memory.textContent).not.toContain('max 0');
    expect(container.textContent ?? '').not.toContain('max 0 B');
  });

  it('drops the memory cluster entirely when INFO has no used_memory', async () => {
    stubSources({ memory: { sections: [{ name: 'Memory', entries: [] }] } });
    render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();
    expect(screen.queryByTestId('redis-context-memory')).toBeNull();
    // A failed INFO does not take the band down with it.
    expect(screen.getByTestId('redis-context-keys')).not.toBeNull();
  });

  it('drops the memory cluster when info_filtered fails', async () => {
    commandInvoke.mockImplementation((_plugin: string, command: string) => {
      if (command === 'db_sizes') return Promise.resolve(DB_SIZES);
      if (command === 'type_distribution') return Promise.resolve(DISTRIBUTION);
      return Promise.reject(new Error('no permission'));
    });
    render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();
    expect(screen.queryByTestId('redis-context-memory')).toBeNull();
    expect(screen.getByTestId('redis-context-types')).not.toBeNull();
  });
});

describe('RedisContextBar — scan budget rendering branches', () => {
  it('renders nothing for a fresh panel (idle, unused)', async () => {
    stubSources();
    render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();
    expect(screen.queryByTestId('redis-context-scan')).toBeNull();
    expect(screen.getByTestId('redis-context-bar').getAttribute('data-scan-state')).toBe('idle');
  });

  it('shows used only — no bar — when the ceiling is unknown', async () => {
    stubSources();
    render(<RedisContextBar {...barProps(makeRelay({ budgetUsed: 12_000, budgetTotal: 0 }))} />);
    await settle();

    const scan = screen.getByTestId('redis-context-scan');
    expect(scan.getAttribute('data-budget-total')).toBe('0');
    expect(scan.getAttribute('data-budget-percent')).toBe('unknown');
    expect(scan.getAttribute('data-i18n-key')).toBe('redis.contextBar.scanUsed');
    expect(scan.textContent).toContain('12k');
    // No denominator ⇒ no bar to draw.
    expect(screen.queryByTestId('redis-context-scan-bar')).toBeNull();
  });

  it('renders used/total with a four-cell bar while scanning', async () => {
    stubSources();
    render(
      <RedisContextBar
        {...barProps(
          makeRelay({ scanning: true, budgetUsed: 12_000, budgetTotal: 50_000, scanCursor: '9' }),
        )}
      />,
    );
    await settle();

    const scan = screen.getByTestId('redis-context-scan');
    expect(scan.getAttribute('data-i18n-key')).toBe('redis.contextBar.scanning');
    expect(scan.textContent).toContain('12k');
    expect(scan.textContent).toContain('50k');
    expect(screen.getByTestId('redis-context-scan-bar').textContent).toBe('▉░░░');
  });

  it("does not claim completion from cursor '0' with nothing scanned", async () => {
    stubSources();
    render(<RedisContextBar {...barProps(makeRelay({ scanCursor: '0', budgetUsed: 0 }))} />);
    await settle();
    expect(screen.getByTestId('redis-context-bar').getAttribute('data-scan-state')).toBe('idle');
  });

  it('follows the relay live: a broadcast tick repaints the cluster', async () => {
    stubSources();
    const state = makeRelay();
    render(<RedisContextBar {...barProps(state)} />);
    await settle();
    expect(screen.queryByTestId('redis-context-scan')).toBeNull();

    act(() => state.set({ scanning: true, budgetUsed: 500, budgetTotal: 10_000, scanCursor: '3' }));
    expect(screen.getByTestId('redis-context-scan').getAttribute('data-scan-state')).toBe(
      'scanning',
    );

    act(() => state.set({ scanning: false, scanCursor: '0', budgetUsed: 10_000 }));
    expect(screen.getByTestId('redis-context-scan').getAttribute('data-scan-state')).toBe('done');
  });

  it('follows the relay live: reading is a delta, and existing values survive', async () => {
    stubSources();
    const state = makeRelay();
    render(<RedisContextBar {...barProps(state)} />);
    await settle();
    expect(screen.getByTestId('redis-context-db')).not.toBeNull();
    expect(screen.getByTestId('redis-context-types')).not.toBeNull();
  });
});

describe('RedisContextBar — compact degradation (I-10)', () => {
  it('drops the button labels first while the icons stay', async () => {
    stubSources();
    const { rerender } = render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();
    const labels = () =>
      ['redis-context-refresh', 'redis-context-new-key', 'redis-context-import', 'redis-context-export']
        .map((id) => screen.getByTestId(id))
        .map((el) => el.getAttribute('data-labelled'));

    expect(labels()).toEqual(['true', 'true', 'true', 'true']);
    expect(screen.getByTestId('redis-context-refresh').textContent).toBe('redis.refresh');

    rerender(<RedisContextBar {...barProps(makeRelay(), { compact: true })} />);
    expect(labels()).toEqual(['false', 'false', 'false', 'false']);
    // Labels gone…
    expect(screen.getByTestId('redis-context-refresh').textContent).toBe('');
    // …icons and the action itself are still there (a hidden control would be
    // the dead-surface failure, not a responsive one).
    expect(screen.getByTestId('redis-context-refresh').querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('redis-context-bar').getAttribute('data-layout')).toBe('compact');
  });

  it('moves the decorations into the overflow menu rather than losing them', async () => {
    stubSources();
    // One relay across both renders: the relay *is* the panel identity the
    // source read is scoped to, so swapping it would re-fetch and the compact
    // assertions below would run before the new reply landed — and would not be
    // describing the same band either.
    const state = makeRelay();
    const { rerender } = render(<RedisContextBar {...barProps(state)} />);
    await settle();
    expect(screen.getByTestId('redis-context-types')).not.toBeNull();

    rerender(<RedisContextBar {...barProps(state, { compact: true })} />);

    // The identifying fields stay in the band.
    expect(screen.getByTestId('redis-context-db')).not.toBeNull();
    expect(screen.getByTestId('redis-context-keys')).not.toBeNull();
    // The two decorations leave it…
    expect(screen.queryByTestId('redis-context-memory')).toBeNull();
    expect(screen.queryByTestId('redis-context-types')).toBeNull();
    // …and reappear, with the same numbers, inside the ⋯ menu.
    expect(screen.getByTestId('redis-context-overflow-memory').textContent).toContain('1.2 MB');
    expect(screen.getByTestId('redis-context-overflow-types').textContent).toContain('string 30');
  });

  it('never drops the scan cluster, which is what a waiting user watches', async () => {
    stubSources();
    render(
      <RedisContextBar
        {...barProps(
          makeRelay({ scanning: true, budgetUsed: 12_000, budgetTotal: 50_000, scanCursor: '9' }),
          { compact: true },
        )}
      />,
    );
    await settle();
    expect(screen.getByTestId('redis-context-scan')).not.toBeNull();
    expect(screen.getByTestId('redis-context-scan-bar').textContent).toBe('▉░░░');
  });
});

describe('RedisContextBar — every control asks the host (F-3)', () => {
  /** Render, click the control, and hand back what `request` received. */
  async function clickAndCapture(testId: string) {
    // One mount per call: several ids are reused across cases in this describe,
    // and a stale tree from the previous call would make them ambiguous.
    cleanup();
    stubSources();
    const request = vi.fn();
    render(<RedisContextBar {...barProps(makeRelay(), { request })} />);
    await settle();
    fireEvent.click(screen.getByTestId(testId));
    return request.mock.calls.map(([action]) => action as KvSlotAction);
  }

  it('sends refresh / newKey / import / export as bare action tags', async () => {
    expect(await clickAndCapture('redis-context-refresh')).toEqual([{ type: 'refresh' }]);
    expect(await clickAndCapture('redis-context-new-key')).toEqual([{ type: 'newKey' }]);
    expect(await clickAndCapture('redis-context-import')).toEqual([{ type: 'import' }]);
    expect(await clickAndCapture('redis-context-export')).toEqual([{ type: 'export' }]);
  });

  it('sends the db selector choice as selectDatabase with the chosen db', async () => {
    stubSources();
    const request = vi.fn();
    render(<RedisContextBar {...barProps(makeRelay(), { request })} />);
    await settle();

    fireEvent.change(screen.getByTestId('redis-context-db'), { target: { value: 'db3' } });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toEqual({ type: 'selectDatabase', database: 'db3' });
  });

  it('sends the overflow menu items with their exact payloads', async () => {
    expect(await clickAndCapture('redis-context-menu-flush')).toEqual([{ type: 'flushDb' }]);
    expect(await clickAndCapture('redis-context-menu-monitor')).toEqual([{ type: 'openMonitor' }]);
    expect(await clickAndCapture('redis-context-menu-settings')).toEqual([{ type: 'openSettings' }]);
  });

  it('offers every budget tier with the tier as the payload value', async () => {
    stubSources();
    const request = vi.fn();
    render(<RedisContextBar {...barProps(makeRelay(), { request })} />);
    await settle();

    for (const tier of SCAN_BUDGET_TIERS) {
      fireEvent.click(screen.getByTestId(`redis-context-budget-${tier}`));
    }

    expect(request.mock.calls.map(([action]) => action)).toEqual([
      { type: 'setScanBudget', value: 10_000 },
      { type: 'setScanBudget', value: 50_000 },
      { type: 'setScanBudget', value: 200_000 },
      { type: 'setScanBudget', value: 1_000_000 },
    ]);
  });

  it('routes the dangerous flush through request alone — no driver-side confirm', async () => {
    stubSources();
    const request = vi.fn();
    render(<RedisContextBar {...barProps(makeRelay(), { request })} />);
    await settle();

    fireEvent.click(screen.getByTestId('redis-context-menu-flush'));

    // Exactly the action tag and nothing else: the host's write gate (I-6) is
    // the one confirmation system, so no dialog may appear from here.
    expect(request).toHaveBeenCalledWith({ type: 'flushDb' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not throw when the host ignores the action (unwired is a no-op)', async () => {
    stubSources();
    // The pathological host: it collects the request and does nothing with it.
    const request = vi.fn();
    render(<RedisContextBar {...barProps(makeRelay(), { request })} />);
    await settle();

    const controls = [
      'redis-context-refresh',
      'redis-context-new-key',
      'redis-context-import',
      'redis-context-export',
      'redis-context-menu-flush',
      'redis-context-menu-monitor',
      'redis-context-menu-settings',
      'redis-context-budget-10000',
    ];
    for (const id of controls) {
      expect(() => fireEvent.click(screen.getByTestId(id))).not.toThrow();
    }
    expect(() =>
      fireEvent.change(screen.getByTestId('redis-context-db'), { target: { value: 'db1' } }),
    ).not.toThrow();

    expect(request).toHaveBeenCalledTimes(controls.length + 1);
    // And the band is still standing after all of it.
    expect(screen.getByTestId('redis-context-bar')).not.toBeNull();
  });

  it('keeps every control rendered even though the host may handle none of them', async () => {
    // Contract F-3 ruling 1, stated as a test: a control is never hidden
    // because the host *might* not have a handler.
    stubSources();
    render(<RedisContextBar {...barProps(makeRelay(), { request: vi.fn() })} />);
    await settle();
    for (const id of [
      'redis-context-refresh',
      'redis-context-new-key',
      'redis-context-import',
      'redis-context-export',
      'redis-context-overflow-toggle',
      'redis-context-menu-flush',
      'redis-context-menu-monitor',
      'redis-context-menu-settings',
    ]) {
      expect(screen.getByTestId(id), id).not.toBeNull();
    }
  });
});

describe('RedisContextBar — empty and hostile inputs', () => {
  it('renders without a resolved db or any server reply', async () => {
    commandInvoke.mockRejectedValue(new Error('offline'));
    const { container } = render(
      <RedisContextBar {...barProps(makeRelay(), { database: null, dbIndex: undefined })} />,
    );
    await settle();

    const bar = screen.getByTestId('redis-context-bar');
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('data-active-db')).toBe('');
    // Window-only picker: the declared db range needs no server reply.
    expect(Number(screen.getByTestId('redis-context-db').getAttribute('data-db-count'))).toBe(16);
    expect(screen.queryByTestId('redis-context-keys')).toBeNull();
    expect(screen.queryByTestId('redis-context-memory')).toBeNull();
    expect(screen.queryByTestId('redis-context-types')).toBeNull();
    expect(screen.queryByTestId('redis-context-scan')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="redis-context-chip-"]')).toHaveLength(0);
  });

  it('renders without a key count when db_sizes does not cover this db', async () => {
    stubSources({ dbSizes: [{ db: 0, keys: 4 }] });
    render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();
    // `db5` is not in the reply ⇒ no count (not a zero).
    expect(screen.queryByTestId('redis-context-keys')).toBeNull();
  });

  it('survives a malformed db_sizes reply instead of crashing on it', async () => {
    stubSources({ dbSizes: 'not-an-array' });
    render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();
    expect(screen.getByTestId('redis-context-bar')).not.toBeNull();
    expect(screen.queryByTestId('redis-context-keys')).toBeNull();
  });

  it('survives malformed INFO and distribution replies', async () => {
    stubSources({ memory: 'a bare string', distribution: { counts: 'nope' } });
    render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();
    expect(screen.queryByTestId('redis-context-memory')).toBeNull();
    expect(screen.queryByTestId('redis-context-types')).toBeNull();
    expect(screen.getByTestId('redis-context-bar')).not.toBeNull();
  });

  it('does not issue commands without a session, and still renders the band', async () => {
    stubSources();
    render(<RedisContextBar {...barProps(makeRelay(), { dbSessionId: '' })} />);
    await settle();
    expect(commandInvoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('redis-context-bar')).not.toBeNull();
  });

  it('never paints one db\u2019s numbers on another after a switch', async () => {
    // The reply for the old identity lands *after* the panel moved on.
    let releaseOld: ((value: unknown) => void) | null = null;
    commandInvoke.mockImplementation((_plugin: string, command: string, args: unknown) => {
      const body = args as { dbIndex?: number };
      if (command === 'type_distribution') {
        if (body.dbIndex === 5) {
          return new Promise((resolve) => {
            releaseOld = resolve;
          });
        }
        return Promise.resolve({ counts: { hash: 7 }, sampled: 7, dbsize: 7, truncated: false });
      }
      if (command === 'db_sizes') return Promise.resolve(DB_SIZES);
      return Promise.resolve(INFO_MEMORY);
    });

    const { rerender } = render(<RedisContextBar {...barProps(makeRelay())} />);
    await settle();
    rerender(<RedisContextBar {...barProps(makeRelay(), { database: 'db2', dbIndex: 2 })} />);
    await waitFor(() => expect(screen.getByTestId('redis-context-chip-hash')).not.toBeNull());

    // Now the superseded db5 reply lands. It must be dropped where it lands.
    await act(async () => {
      releaseOld?.({ counts: { string: 99 }, sampled: 99, dbsize: 99, truncated: false });
      await Promise.resolve();
    });
    expect(screen.queryByTestId('redis-context-chip-string')).toBeNull();
    expect(screen.getByTestId('redis-context-chip-hash').getAttribute('data-count')).toBe('7');
  });
});
