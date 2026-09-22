import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import {
  BROWSE_HISTORY_STORAGE_KEY,
  pushBrowseEntry,
} from '../lib/redisBrowseHistory';

/**
 * 屏 A — Redis 连接总览组件测试（PRD §3.1 七个区块逐行）.
 *
 * `useI18n` is overridden so `t(key)` returns the **key**: every text assertion
 * below compares an i18n key or a server token (db name, key name, command line,
 * command token), never rendered English copy. Structural assertions go through
 * the stable `data-overview-*` attributes the components expose for exactly this
 * purpose (PRD §7-6).
 */
vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  useI18n: () => ({ t: (key: string) => key, lang: 'en' }),
}));

const redisInvoke = vi.fn();
vi.mock('../shared/redisInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/redisInvoke')>()),
  redisCommandInvoke: (...args: unknown[]) => redisInvoke(...args),
}));

import { RedisOverviewHome, type RedisOverviewHomeProps } from '../overview/RedisOverviewHome';

const SESSION = 'sess-1';
const CONNECTION = 'conn-1';

const INFO_OK = [
  '# Server',
  'redis_version:7.2.4',
  'arch_bits:64',
  'os:Linux 6.1 x86_64',
  'uptime_in_days:12',
  '# Clients',
  'connected_clients:9',
  'blocked_clients:0',
  '# Memory',
  'used_memory:1048576',
  'used_memory_human:1.00M',
  'maxmemory:4194304',
  'maxmemory_human:4.00M',
  'maxmemory_policy:allkeys-lru',
  'mem_fragmentation_ratio:1.42',
  '# Stats',
  'instantaneous_ops_per_sec:250',
  'total_commands_processed:98765',
  'evicted_keys:0',
  'expired_keys:41',
  '# Replication',
  'role:master',
  'mode:standalone',
].join('\r\n');

const DB_SIZES_OK = [
  { db: 0, keys: 3 },
  { db: 2, keys: 1 },
];

const MEMORY_OK = {
  samples: [
    { key: 'cache:small', bytes: 1024 },
    { key: 'blob:a', bytes: 5 * 1024 * 1024 },
    { key: 'blob:b', bytes: 4 * 1024 * 1024 },
    { key: 'blob:c', bytes: 3 * 1024 * 1024 },
    { key: 'blob:d', bytes: 2 * 1024 * 1024 },
    { key: 'blob:e', bytes: 1 * 1024 * 1024 },
  ],
  truncated: false,
};

const SLOWLOG_OK = [
  {
    id: 1,
    timestamp: 1700000000,
    durationUs: 500,
    command: ['GET', 'user:1'],
    clientAddr: '127.0.0.1:52114',
    clientName: 'worker',
  },
  {
    id: 2,
    timestamp: 1700000001,
    durationUs: 12345,
    command: ['KEYS', '*'],
    clientAddr: '',
    clientName: '',
  },
];

function stub(overrides: Record<string, unknown> = {}) {
  redisInvoke.mockImplementation(async (_pluginId: string, command: string) => {
    if (Object.prototype.hasOwnProperty.call(overrides, command)) {
      const value = overrides[command];
      if (value instanceof Error) throw value;
      return value;
    }
    switch (command) {
      case 'info':
        return INFO_OK;
      case 'db_sizes':
        return DB_SIZES_OK;
      case 'memory_sample':
        return MEMORY_OK;
      case 'slowlog_get':
        return SLOWLOG_OK;
      default:
        throw new Error(`unexpected command ${command}`);
    }
  });
}

function baseProps(overrides: Partial<RedisOverviewHomeProps> = {}): RedisOverviewHomeProps {
  return {
    connectionId: CONNECTION,
    dbSessionId: SESSION,
    connectionName: 'local-redis',
    databaseType: 'redis',
    ...overrides,
  } as unknown as RedisOverviewHomeProps;
}

function attr(root: HTMLElement, selector: string, name: string): string | null {
  return root.querySelector(selector)?.getAttribute(name) ?? null;
}

function ids(root: HTMLElement, selector: string): string[] {
  return [...root.querySelectorAll(`[${selector}]`)].map((el) => el.getAttribute(selector));
}

function cardState(root: HTMLElement, card: string): string | null {
  return attr(root, `[data-overview-card="${card}"]`, 'data-overview-card-state');
}

function pillValue(root: HTMLElement, pill: string): string | null | undefined {
  return root.querySelector(`[data-overview-pill-value="${pill}"]`)?.textContent;
}

function issuedCommands(): string[] {
  return [...new Set(redisInvoke.mock.calls.map((call) => String(call[1])))].sort();
}

beforeEach(() => {
  cleanup();
  redisInvoke.mockReset();
  stub();
  globalThis.localStorage.clear();
});

describe('屏 A 组装', () => {
  it('renders the banner plus the six cards, all inside the 1 / lg:2 grid', () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);

    expect(container.querySelector('[data-overview-banner]')).not.toBeNull();
    expect(ids(container, 'data-overview-card').sort()).toEqual(
      ['actions', 'keyspace', 'memory', 'recent', 'server', 'slowlog'].sort(),
    );

    const grid = container.querySelector('[data-overview-grid]');
    expect(grid?.classList.contains('grid-cols-1')).toBe(true);
    expect(grid?.classList.contains('lg:grid-cols-2')).toBe(true);
    for (const card of container.querySelectorAll('[data-overview-card]')) {
      expect(card.parentElement).toBe(grid);
    }
  });

  it('sources the whole screen through the four whitelisted commands only', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'slowlog')).toBe('ready'));

    expect(issuedCommands()).toEqual(['db_sizes', 'info', 'memory_sample', 'slowlog_get']);
    expect(redisInvoke).toHaveBeenCalledTimes(4);
    for (const call of redisInvoke.mock.calls) {
      expect(call[0]).toBe('redis');
      expect(String(call[1]).toLowerCase()).not.toContain('scan');
    }
  });

  it('binds every block to the command it reads, so 区块空态有名字', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'keyspace')).toBe('ready'));

    expect(container.querySelector('[data-overview-card-source="server"]')?.textContent).toBe('info');
    expect(container.querySelector('[data-overview-card-source="keyspace"]')?.textContent).toBe('db_sizes');
    expect(container.querySelector('[data-overview-card-source="slowlog"]')?.textContent).toBe('slowlog_get');
    expect(container.querySelector('[data-overview-card-source="recent"]')?.textContent).toBe('localStorage');
    // 卡 2 是两个源的组合，源标签如实写出组合
    expect(container.querySelector('[data-overview-card-source="memory"]')?.textContent).toContain('memory_sample');
  });

  it('keeps loading state named instead of blank', () => {
    stub({ info: new Promise(() => {}) });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);

    expect(cardState(container, 'server')).toBe('loading');
    expect(container.querySelector('[data-overview-loading="server"]')).not.toBeNull();
  });
});

describe('横幅（区块 1）', () => {
  it('is 56px tall and swaps the SQL subtitle for three clickable pills', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    const banner = container.querySelector('[data-overview-banner]');
    expect(banner?.classList.contains('h-14')).toBe(true);

    await waitFor(() => expect(pillValue(container, 'version')).toBe('7.2.4'));
    expect(ids(container, 'data-overview-pill')).toEqual(['version', 'mode', 'usedMemory']);
    expect(attr(container, '[data-overview-pill="mode"]', 'data-overview-jump-target')).toBe('monitor:info');
    expect(attr(container, '[data-overview-pill="usedMemory"]', 'data-overview-jump-target')).toBe('monitor:memory');
    expect(attr(container, '[data-overview-banner-status]', 'data-overview-banner-status')).toBe('connected');
  });

  it('routes a pill click to the matching monitor sub-page when a bridge exists', async () => {
    const onOpenTarget = vi.fn();
    const { container } = render(
      <RedisOverviewHome {...baseProps({ onOpenTarget })} />,
    );
    await waitFor(() => expect(pillValue(container, 'version')).toBe('7.2.4'));

    fireEvent.click(container.querySelector('[data-overview-pill="version"]') as Element);
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'monitor', section: 'info' });
    expect(attr(container, '[data-overview-pill="version"]', 'data-overview-jump')).toBe('wired');
  });
});

describe('卡 1 — Server 概览', () => {
  it('renders the ten PRD rows in order, two columns', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'server')).toBe('ready'));

    expect(ids(container, 'data-overview-server-row')).toEqual([
      'version',
      'mode',
      'arch',
      'uptime',
      'connectedClients',
      'blockedClients',
      'opsPerSec',
      'totalCommands',
      'evictedKeys',
      'expiredKeys',
    ]);
    const rows = container.querySelector('[data-overview-card="server"] dl');
    expect(rows?.classList.contains('sm:grid-cols-2')).toBe(true);
  });

  it('keeps server tokens raw and maps the known mode values to their key', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'server')).toBe('ready'));

    expect(
      container.querySelector('[data-overview-server-value="version"]')?.textContent,
    ).toBe('7.2.4');
    expect(
      container.querySelector('[data-overview-server-value="mode"]')?.textContent,
    ).toBe('redis.overview.mode.standalone');
    expect(
      container.querySelector('[data-overview-server-value="arch"]')?.textContent,
    ).toBe('redis.overview.unit.bits');
  });

  it('colours evicted_keys > 0 and leaves a clean server neutral', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'server')).toBe('ready'));
    expect(attr(container, '[data-overview-server-row="evictedKeys"]', 'data-overview-warn')).toBe('false');
    cleanup();

    stub({
      info: INFO_OK.replace('evicted_keys:0', 'evicted_keys:18').replace(
        'mode:standalone',
        'mode:cluster',
      ),
    });
    const second = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(second.container, 'server')).toBe('ready'));
    expect(
      attr(second.container, '[data-overview-server-row="evictedKeys"]', 'data-overview-warn'),
    ).toBe('true');
    expect(
      second.container.querySelector('[data-overview-server-value="mode"]')?.textContent,
    ).toBe('redis.overview.mode.cluster');
  });

  it('shows a dash for a field the server did not report, not a hole', async () => {
    stub({ info: '# Server\r\nredis_version:7.2.4\r\n' });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'server')).toBe('ready'));

    expect(attr(container, '[data-overview-server-row="uptime"]', 'data-overview-server-row')).toBe('uptime');
    expect(container.querySelector('[data-overview-server-value="uptime"]')?.textContent).toBe('—');
  });

  it('falls back to the named empty state when INFO carries nothing renderable', async () => {
    stub({ info: '# Server\r\n' });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'server')).toBe('empty'));
    expect(container.querySelector('[data-overview-empty="server"]')).not.toBeNull();
  });
});

describe('卡 2 — 内存', () => {
  it('draws the used/max gauge from INFO and flags fragmentation above 1.5', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(attr(container, '[data-overview-memory-bar]', 'data-overview-memory-bar-percent')).toBe('25'));

    expect(attr(container, '[data-overview-memory-bar]', 'data-overview-memory-bar-state')).toBe('bounded');
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25');
    expect(attr(container, '[data-overview-memory-frag]', 'data-overview-memory-frag')).toBe('ok');
    cleanup();

    stub({ info: INFO_OK.replace('mem_fragmentation_ratio:1.42', 'mem_fragmentation_ratio:2.9') });
    const second = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(attr(second.container, '[data-overview-memory-frag]', 'data-overview-memory-frag')).toBe('warn'));
  });

  it('names the unlimited-maxmemory case instead of dividing by zero', async () => {
    stub({
      info: INFO_OK.replace('maxmemory:4194304', 'maxmemory:0').replace('maxmemory_human:4.00M', ''),
    });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(attr(container, '[data-overview-memory-bar]', 'data-overview-memory-bar-state')).toBe('unlimited'));

    expect(attr(container, '[data-overview-memory-max]', 'data-overview-memory-max')).toBe('unlimited');
    expect(attr(container, '[data-overview-memory-bar]', 'data-overview-memory-bar-percent')).toBe('0');
    // 无上限时不显示百分比，具名破折号占位而不是 0%
    expect(container.querySelector('[data-overview-memory-percent]')?.textContent).toBe('—');
  });

  it('lists the memory_sample Top 5 ranked by size, and says when the sample was truncated', async () => {
    stub({ memory_sample: { samples: MEMORY_OK.samples, truncated: true } });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-bigkey]').length).toBe(5));

    const ranks = ids(container, 'data-overview-bigkey');
    expect(ranks).toEqual(['1', '2', '3', '4', '5']);
    expect(attr(container, '[data-overview-bigkey="1"]', 'data-overview-key')).toBe('blob:a');
    expect(attr(container, '[data-overview-bigkey="5"]', 'data-overview-key')).toBe('blob:e');
    expect(container.querySelector('[data-overview-bigkey-truncated]')).not.toBeNull();
    expect(container.querySelector('[data-overview-memory-sample-db]')).not.toBeNull();
  });

  it('shows the named 未授权 state when redis:allow-memory-sample is missing, gauge intact', async () => {
    stub({ memory_sample: new Error("NOPERM this user has no permissions to run the 'memory_sample' command") });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(attr(container, '[data-overview-bigkey-state]', 'data-overview-bigkey-state')).toBe('unauthorized'));

    expect(container.querySelector('[data-overview-memory-gauge]')).not.toBeNull();
    expect(cardState(container, 'memory')).toBe('ready');
    expect(container.querySelector('[data-overview-failed="memory"]')).toBeNull();
    expect(container.querySelector('[data-overview-bigkey]')).toBeNull();
  });

  it('names the empty sample and the failure separately', async () => {
    stub({ memory_sample: { samples: [], truncated: false } });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(attr(container, '[data-overview-bigkey-state]', 'data-overview-bigkey-state')).toBe('empty'));
    cleanup();

    stub({ memory_sample: new Error('READONLY You cant write against a read only replica') });
    const second = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(attr(second.container, '[data-overview-bigkey-state]', 'data-overview-bigkey-state')).toBe('failed'));
  });

  it('samples the connections configured database, not a hard-coded db0', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps({ initialDatabase: 'db3' })} />);
    await waitFor(() => expect(redisInvoke).toHaveBeenCalledTimes(4));

    const sample = redisInvoke.mock.calls.find((call) => call[1] === 'memory_sample');
    expect(sample?.[2]).toMatchObject({ dbSessionId: SESSION, dbIndex: 3 });
  });
});

describe('卡 3 — Key Space', () => {
  it('renders the sixteen logical databases with keys + share, active vs empty', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-db-cell]').length).toBe(16));

    expect(attr(container, '[data-overview-db-cell="0"]', 'data-overview-db-name')).toBe('db0');
    expect(attr(container, '[data-overview-db-cell="0"]', 'data-overview-db-state')).toBe('active');
    expect(attr(container, '[data-overview-db-share="0"]', 'data-overview-share-percent')).toBe('75');
    expect(attr(container, '[data-overview-db-share="2"]', 'data-overview-share-percent')).toBe('25');
    // 1 键的库也要看得见：占比条下限 2%
    expect(attr(container, '[data-overview-db-share="1"]', 'data-overview-share-percent')).toBe('0');
    expect(attr(container, '[data-overview-db-cell="15"]', 'data-overview-db-state')).toBe('empty');
    expect(container.querySelector('[data-overview-keyspace-summary]')).not.toBeNull();
  });

  it('grows past sixteen when the server exposes more databases', async () => {
    stub({ db_sizes: [{ db: 20, keys: 5 }] });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-db-cell]').length).toBe(21));
    expect(attr(container, '[data-overview-db-cell="20"]', 'data-overview-db-name')).toBe('db20');
  });

  it('names the keyless instance instead of an empty grid', async () => {
    stub({ db_sizes: [] });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'keyspace')).toBe('empty'));
    expect(container.querySelector('[data-overview-empty="keyspace"]')).not.toBeNull();
  });

  it('requests the clicked database panel through the bridge', async () => {
    const onOpenTarget = vi.fn();
    const { container } = render(<RedisOverviewHome {...baseProps({ onOpenTarget })} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-db-cell]').length).toBe(16));

    fireEvent.click(container.querySelector('[data-overview-db-cell="2"]') as Element);
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'database', dbIndex: 2 });
  });
});

describe('卡 4 — 慢查询', () => {
  it('shows the Top 5 as 序号 / 耗时 µs / 命令摘要 / 客户端', async () => {
    stub({
      slowlog_get: [
        ...SLOWLOG_OK,
        { id: 3, timestamp: 1700000002, durationUs: 700, command: ['SET', 'k', 'v'], clientAddr: '10.0.0.9:400', clientName: '' },
        { id: 4, timestamp: 1700000003, durationUs: 800, command: ['LPUSH', 'q'], clientAddr: '10.0.0.10:401', clientName: '' },
        { id: 5, timestamp: 1700000004, durationUs: 900, command: ['SMEMBERS', 's'], clientAddr: '10.0.0.11:402', clientName: '' },
        { id: 6, timestamp: 1700000005, durationUs: 950, command: ['HGETALL', 'h'], clientAddr: '10.0.0.12:403', clientName: '' },
      ],
    });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-slowlog-row]').length).toBe(5));

    expect(ids(container, 'data-overview-slowlog-row')).toEqual(['1', '2', '3', '4', '5']);
    // newest id first — Redis orders oldest-first, the card must not mirror that.
    expect(attr(container, '[data-overview-slowlog-row="1"]', 'data-overview-slowlog-row')).toBe('1');
    expect(attr(container, '[data-overview-slowlog-duration="1"]', 'data-overview-duration-us')).toBe('950');
    expect(container.querySelector('[data-overview-slowlog-command="1"]')?.textContent).toBe('HGETALL h');
    expect(container.querySelector('[data-overview-slowlog-client="1"]')?.textContent).toBe('10.0.0.12:403');
    // entry 2 is the id-5 SMEMBERS row
    expect(container.querySelector('[data-overview-slowlog-duration="2"]')?.getAttribute('data-overview-duration-us')).toBe('900');
  });

  it('names a missing client rather than leaving the cell blank', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-slowlog-row]').length).toBe(2));

    expect(attr(container, '[data-overview-slowlog-row="2"]', 'data-overview-slowlog-row')).toBe('2');
    // rank 1 是 id=2 那条（clientAddr / clientName 皆空），rank 2 才是带客户端的那条
    expect(attr(container, '[data-overview-slowlog-client="1"]', 'data-overview-client-state')).toBe('unknown');
    expect(attr(container, '[data-overview-slowlog-client="2"]', 'data-overview-client-state')).toBe('known');
    // 客户端名与地址拼在一行
    expect(container.querySelector('[data-overview-slowlog-client="2"]')?.textContent).toContain('worker');
  });

  it('explains an empty SLOWLOG with the SLOWLOG GET semantics (I-11)', async () => {
    stub({ slowlog_get: [] });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'slowlog')).toBe('empty'));
    expect(container.querySelector('[data-overview-empty="slowlog"]')).not.toBeNull();
    expect(container.querySelector('[data-overview-slowlog-row]')).toBeNull();
  });

  it('degrades a refused SLOWLOG GET into the named 未授权 state, not an error', async () => {
    stub({ slowlog_get: new Error('NOPERM this user has no permissions') });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'slowlog')).toBe('unauthorized'));

    expect(container.querySelector('[data-overview-unauthorized="slowlog"]')).not.toBeNull();
    expect(container.querySelector('[data-overview-failed="slowlog"]')).toBeNull();
    // 其余区块照常
    expect(cardState(container, 'keyspace')).toBe('ready');
  });
});

describe('区块 5 — KV 快捷动作', () => {
  it('offers key-value entries and none of the SQL ones', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'server')).toBe('ready'));

    expect(ids(container, 'data-overview-action').sort()).toEqual(
      ['browseDb', 'console', 'importExport', 'newKey', 'pubsub'].sort(),
    );
    for (const sqlAction of ['newQuery', 'newTable', 'erDiagram', 'runQuery']) {
      expect(container.querySelector(`[data-overview-action="${sqlAction}"]`)).toBeNull();
    }
  });

  it('sends browse-db to the connections configured database, db0 by default', async () => {
    const onOpenTarget = vi.fn();
    const { container } = render(<RedisOverviewHome {...baseProps({ onOpenTarget })} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-action]').length).toBe(5));

    fireEvent.click(container.querySelector('[data-overview-action="browseDb"]') as Element);
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'database', dbIndex: 0 });
    expect(attr(container, '[data-overview-action="browseDb"]', 'data-overview-action-target')).toBe('database');

    cleanup();
    const second = render(<RedisOverviewHome {...baseProps({ onOpenTarget, initialDatabase: 'db5' })} />);
    await waitFor(() => expect(second.container.querySelectorAll('[data-overview-action]').length).toBe(5));
    fireEvent.click(second.container.querySelector('[data-overview-action="newKey"]') as Element);
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'newKey', dbIndex: 5 });
  });
});

describe('区块 6 — 最近浏览键', () => {
  it('names the empty history and says what fills it', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'recent')).toBe('empty'));
    expect(container.querySelector('[data-overview-empty="recent"]')).not.toBeNull();
    expect(container.querySelector('[data-overview-recent-clear]')).toBeNull();
  });

  it('lists the connections own entries, newest first, with a relative unit key', async () => {
    // 组件按真实时间渲染，所以基准取 Date.now()，只断言单位 key + 数量级
    const now = Date.now();
    pushBrowseEntry(CONNECTION, { key: 'user:1', dbIndex: 0, keyType: 'string' }, undefined, now - 3 * 3_600_000);
    pushBrowseEntry(CONNECTION, { key: 'queue:jobs', dbIndex: 4, keyType: null }, undefined, now - 5 * 60_000);
    pushBrowseEntry('other-connection', { key: 'secret', dbIndex: 0 }, undefined, now);

    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-recent-key]').length).toBe(2));

    expect(ids(container, 'data-overview-recent-key')).toEqual(['queue:jobs', 'user:1']);
    expect(attr(container, '[data-overview-recent-key="user:1"]', 'data-overview-db-index')).toBe('0');
    expect(attr(container, '[data-overview-recent-key="user:1"]', 'data-overview-key-type')).toBe('string');
    expect(attr(container, '[data-overview-recent-key="queue:jobs"]', 'data-overview-key-type')).toBe('unknown');
    expect(attr(container, '[data-overview-recent-time="user:1"]', 'data-overview-relative-unit')).toBe(
      'redis.overview.timeAgo.hours',
    );
    expect(attr(container, '[data-overview-recent-time="user:1"]', 'data-overview-relative-value')).toBe('3');
    expect(attr(container, '[data-overview-recent-time="queue:jobs"]', 'data-overview-relative-unit')).toBe(
      'redis.overview.timeAgo.minutes',
    );
    expect(container.querySelector('[data-overview-recent-key="secret"]')).toBeNull();
  });

  it('writes history only for a jump that actually landed', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'server')).toBe('ready'));

    // 无桥接 ⇒ 不谎报到达，也不写历史
    fireEvent.click(container.querySelector('[data-overview-db-cell="1"]') as Element);
    expect(globalThis.localStorage.getItem(BROWSE_HISTORY_STORAGE_KEY)).toBeNull();

    cleanup();
    const onOpenTarget = vi.fn();
    const wired = render(<RedisOverviewHome {...baseProps({ onOpenTarget })} />);
    await waitFor(() => expect(wired.container.querySelectorAll('[data-overview-bigkey]').length).toBe(5));
    fireEvent.click(wired.container.querySelector('[data-overview-bigkey="2"]') as Element);

    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'key', dbIndex: 0, key: 'blob:b' });
    const bucket = JSON.parse(globalThis.localStorage.getItem(BROWSE_HISTORY_STORAGE_KEY) ?? '{}') as Record<
      string,
      Array<{ key: string; dbIndex: number }>
    >;
    expect(bucket[CONNECTION]?.map((entry) => [entry.key, entry.dbIndex])).toEqual([['blob:b', 0]]);
    await waitFor(() => expect(ids(wired.container, 'data-overview-recent-key')).toEqual(['blob:b']));
  });

  it('clears the list back to its named empty state', async () => {
    pushBrowseEntry(CONNECTION, { key: 'user:1', dbIndex: 0 }, undefined, 1_700_000_000_000);
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-recent-key]').length).toBe(1));

    fireEvent.click(container.querySelector('[data-overview-recent-clear]') as Element);
    await waitFor(() => expect(cardState(container, 'recent')).toBe('empty'));
    expect(globalThis.localStorage.getItem(BROWSE_HISTORY_STORAGE_KEY)).toBeNull();
  });
});

describe('屏 A → 屏 B 跳转的诚实降级', () => {
  it('marks every affordance unwired and shows the named guidance instead of a dead click', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-db-cell]').length).toBe(16));

    const states = new Set(ids(container, 'data-overview-jump'));
    expect(states.size).toBe(1);
    expect([...states][0]).toBe('unwired');

    fireEvent.click(container.querySelector('[data-overview-db-cell="2"]') as Element);
    await waitFor(() => expect(container.querySelector('[data-overview-jump-hint]')).not.toBeNull());
    expect(attr(container, '[data-overview-jump-hint]', 'data-overview-jump-hint')).toBe(
      'redis.overview.jump.pendingTree',
    );
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it('names the panel entry for console / pubsub / import-export targets', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-action]').length).toBe(5));

    fireEvent.click(container.querySelector('[data-overview-action="pubsub"]') as Element);
    await waitFor(() => expect(container.querySelector('[data-overview-jump-hint]')).not.toBeNull());
    expect(attr(container, '[data-overview-jump-hint]', 'data-overview-jump-hint')).toBe(
      'redis.overview.jump.pendingPanel',
    );
  });

  it('lets the user dismiss the guidance', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-db-cell]').length).toBe(16));

    fireEvent.click(container.querySelector('[data-overview-db-cell="1"]') as Element);
    await waitFor(() => expect(container.querySelector('[data-overview-jump-hint]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-overview-jump-hint-dismiss]') as Element);
    await waitFor(() => expect(container.querySelector('[data-overview-jump-hint]')).toBeNull());
  });

  it('degrades a throwing host bridge into a named failure instead of a blank screen', async () => {
    const onOpenTarget = vi.fn(() => {
      throw new Error('bridge exploded');
    });
    const { container } = render(<RedisOverviewHome {...baseProps({ onOpenTarget })} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-db-cell]').length).toBe(16));

    fireEvent.click(container.querySelector('[data-overview-db-cell="3"]') as Element);
    await waitFor(() => expect(container.querySelector('[data-overview-jump-hint]')).not.toBeNull());
    expect(attr(container, '[data-overview-jump-hint]', 'data-overview-jump-hint')).toBe(
      'redis.overview.jump.failed',
    );
    expect(cardState(container, 'keyspace')).toBe('ready');
  });

  it('stays silent when the bridge accepts the target', async () => {
    const onOpenTarget = vi.fn();
    const { container } = render(<RedisOverviewHome {...baseProps({ onOpenTarget })} />);
    await waitFor(() => expect(container.querySelectorAll('[data-overview-db-cell]').length).toBe(16));
    fireEvent.click(container.querySelector('[data-overview-db-cell="1"]') as Element);
    await waitFor(() => expect(onOpenTarget).toHaveBeenCalled());
    expect(container.querySelector('[data-overview-jump-hint]')).toBeNull();
  });
});

describe('失败与重试', () => {
  it('names the failed state per card and retries the whole set', async () => {
    stub({ info: new Error('connection reset by peer') });
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'server')).toBe('failed'));

    expect(container.querySelector('[data-overview-failed="server"]')).not.toBeNull();
    expect(container.querySelector('[data-overview-card-action="server"]')).toBeNull();
    // INFO 挂了不影响 db_sizes
    expect(cardState(container, 'keyspace')).toBe('ready');

    const before = redisInvoke.mock.calls.length;
    fireEvent.click(container.querySelector('[data-overview-retry="server"]') as Element);
    await waitFor(() => expect(redisInvoke.mock.calls.length).toBeGreaterThanOrEqual(before + 4));
    expect(issuedCommands()).toEqual(['db_sizes', 'info', 'memory_sample', 'slowlog_get']);
  });

  it('offers a refresh action while a card is healthy', async () => {
    const { container } = render(<RedisOverviewHome {...baseProps()} />);
    await waitFor(() => expect(cardState(container, 'server')).toBe('ready'));

    const before = redisInvoke.mock.calls.length;
    fireEvent.click(container.querySelector('[data-overview-card-action="server"]') as Element);
    await waitFor(() => expect(redisInvoke.mock.calls.length).toBeGreaterThanOrEqual(before + 4));
  });
});
