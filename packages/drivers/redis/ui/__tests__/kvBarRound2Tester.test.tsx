/**
 * redis-kvbar-ui — round-2 Tester independent verification of the fix round.
 *
 * Zero-trust companion to `kvBarRound1Fixes.test.tsx`: the Coder's file argues the
 * fixes from the *inside* (the pure `publishRead` rule, one merged read per
 * selection). This file only asks the questions that round-2 has to answer on its
 * own, and each case is written so that it measures something the fix comments
 * *claim* but no existing case counts:
 *
 *  - BUG-001: the composition of the two fixes — does a *superseded* reply reach
 *    either slot while both are joined to the same in-flight read?
 *  - BUG-002: the WeakMap's lifecycle argument, measured as **round trips** for
 *    the three cases the ruling names: a `dbSessionId` swap, a second refresh of
 *    one key, and a panel that unmounts mid-flight (twice: same relay, new relay).
 *    A value cache anywhere in the merge table shows up here, not in a happy path.
 *  - BUG-003: `info_filtered` counts over *N* refreshes (round 1's complaint was
 *    "刷新 N 次 ⇒ 0 次"), and the retained "old policy stays visible" shape.
 *
 * One case here is `it.skip` by design and marked `FIXME(redis-kvbar-ui-BUG-005)`:
 * it is red on today's code (the measured failure is quoted next to it), and its
 * paired green case pins that behaviour so the pair cannot pass by accident.
 *
 * Assertion policy (PRD §7-6): `data-*` markers, i18n keys and values echoed by
 * Redis (`hash`, `noeviction`, `2.0 KB`) only. No rendered English copy is pinned.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { KvSlotState, KvStatusBarProps } from '@datazen/driver-sdk';

vi.mock('@datazen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@datazen/ui')>()),
  useI18n: () => ({ t: (key: string) => key }),
}));

const commandInvoke = vi.fn();
vi.mock('../shared/redisInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/redisInvoke')>()),
  redisCommandInvoke: (...args: unknown[]) => commandInvoke(...(args as [])),
}));

import { RedisKeyPropsSidebar, RedisKvStatusBar } from '../kv-bar';
import type { KeyObjectInfo } from '../kv-bar/keyObjectInfo';

/** Wire reply of `info_filtered`, narrowed to what the policy reader consumes. */
type PolicyReply = {
  sections: Array<{ name: string; entries: Array<{ key: string; value: string }> }>;
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Local stand-in for the host's per-panel atom (boundary guard forbids importing it). */
function makeRelay(): KvSlotState {
  const listeners = new Set<() => void>();
  let selectedKey: string | null = null;
  let dirty = false;
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
    getSelectedKey: () => selectedKey,
    selectKey(key) {
      if (key === selectedKey) return;
      selectedKey = key;
      notify();
    },
    getDirty: () => dirty,
    setDirty(next) {
      if (next === dirty) return;
      dirty = next;
      notify();
    },
  };
}

function info(overrides: Partial<KeyObjectInfo> = {}): KeyObjectInfo {
  return {
    missing: false,
    type: 'string',
    memoryBytes: 640,
    encoding: 'embstr',
    idleSeconds: 90,
    freq: null,
    ttlMs: -1,
    ...overrides,
  };
}

function slotProps(
  state: KvSlotState,
  overrides: Partial<KvStatusBarProps> = {},
): KvStatusBarProps {
  return {
    connectionId: 'conn-1',
    dbSessionId: 'sess-1',
    connectionName: 'local',
    databaseType: 'redis' as KvStatusBarProps['databaseType'],
    database: 'db5',
    dbIndex: 5,
    state,
    ...overrides,
  };
}

const policyReply = (value: string): PolicyReply => ({
  sections: [{ name: 'Memory', entries: [{ key: 'maxmemory_policy', value }] }],
});

/**
 * Deferred per (command, identity), so a case can land the key read *before* the
 * policy read (or vice versa) and count what each phase actually cost.
 */
interface Router {
  keys: Map<string, Deferred<KeyObjectInfo>>;
  policies: Map<string, Deferred<PolicyReply>>;
  calls(command: string): number;
  readKeys(): string[];
}

function routeCommands(): Router {
  const keys = new Map<string, Deferred<KeyObjectInfo>>();
  const policies = new Map<string, Deferred<PolicyReply>>();
  commandInvoke.mockImplementation((_plugin: string, command: string, payload: unknown) => {
    const body = payload as { dbSessionId?: string; dbIndex?: number; key?: string };
    if (command === 'key_object_info') {
      const slot = deferred<KeyObjectInfo>();
      keys.set(`${body.dbSessionId}|${body.dbIndex}|${body.key}`, slot);
      return slot.promise;
    }
    if (command === 'info_filtered') {
      const slot = deferred<PolicyReply>();
      policies.set(`${body.dbSessionId}`, slot);
      return slot.promise;
    }
    return Promise.resolve({ sections: [] });
  });
  return {
    keys,
    policies,
    calls: (command) => commandInvoke.mock.calls.filter(([, name]) => name === command).length,
    readKeys: () =>
      commandInvoke.mock.calls
        .filter(([, name]) => name === 'key_object_info')
        .map(([, , payload]) => (payload as { key: string }).key),
  };
}

const statusState = (el: HTMLElement | null) =>
  el?.querySelector('[data-status-state]')?.getAttribute('data-status-state') ?? null;
const propsState = (el: HTMLElement | null) =>
  el?.querySelector('[data-props-state]')?.getAttribute('data-props-state') ?? null;
const barType = (el: HTMLElement | null) =>
  el?.querySelector('[data-part="type"]')?.textContent ?? null;
const sideValue = (el: HTMLElement | null, attr: string) =>
  el?.querySelector(`[data-attr="${attr}"] dd`)?.getAttribute('data-value') ?? null;
const refreshButton = (el: HTMLElement | null) =>
  el?.querySelector<HTMLButtonElement>('[data-testid="redis-kv-props-refresh"]') ?? null;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('[tester r2] BUG-001 x BUG-002: a superseded reply in front of a merged read', () => {
  // The two fixes share a code path the round-1 file never drives at once: with the
  // drawer open, one selection is *one* promise feeding both slots. If a superseded
  // read for the previous key were still reachable through that table, it would
  // arrive as a second `.then` on the joined promise and repaint both surfaces.
  it('keeps a late reply for the previous key out of both slots that share one read', async () => {
    const relay = makeRelay();
    const router = routeCommands();
    const bar = render(<RedisKvStatusBar {...slotProps(relay)} />);
    const side = render(<RedisKeyPropsSidebar {...slotProps(relay)} open onClose={() => {}} />);

    act(() => relay.selectKey('first'));
    await waitFor(() => expect(router.keys.size).toBe(1));
    // One merged round trip for the whole panel, before anything has answered.
    expect(router.calls('key_object_info')).toBe(1);

    act(() => relay.selectKey('second'));
    await waitFor(() => expect(router.keys.size).toBe(2));
    expect(router.calls('key_object_info')).toBe(2);

    // Superseded reply lands first, then the current one.
    router.keys.get('sess-1|5|first')!.resolve(info({ type: 'zset', memoryBytes: 99 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(barType(bar.container)).toBeNull();
    expect(sideValue(side.container, 'type')).toBe(null);

    router.keys.get('sess-1|5|second')!.resolve(info({ type: 'hash', memoryBytes: 2048 }));
    await waitFor(() => expect(statusState(bar.container)).toBe('ready'));
    await waitFor(() => expect(propsState(side.container)).toBe('ready'));
    expect(barType(bar.container)).toBe('hash');
    expect(sideValue(side.container, 'type')).toBe('hash');
    expect(sideValue(side.container, 'memory')).toBe('2.0 KB');
  });
});

describe('[tester r2] BUG-002: the merge table is scoped to the panel, not to the values', () => {
  it('still costs one round trip per slot-pair after a database-session swap', async () => {
    // Measured claim under test: `dbSessionId` enters the owner token, so a new
    // session buckets on its own — but the two slots must *still* share the one
    // read it costs. Dropping the session from the token, or dropping the join on
    // a re-read, both show up here as 3 calls instead of 2.
    const relay = makeRelay();
    const router = routeCommands();
    const { container, rerender } = render(
      <>
        <RedisKvStatusBar {...slotProps(relay)} />
        <RedisKeyPropsSidebar {...slotProps(relay)} open onClose={() => {}} />
      </>,
    );

    act(() => relay.selectKey('user:1'));
    await waitFor(() => expect(router.keys.size).toBe(1));
    router.keys.get('sess-1|5|user:1')!.resolve(info({ type: 'string' }));
    await waitFor(() => expect(statusState(container)).toBe('ready'));
    expect(router.calls('key_object_info')).toBe(1);
    expect(router.calls('info_filtered')).toBe(1);

    rerender(
      <>
        <RedisKvStatusBar {...slotProps(relay, { dbSessionId: 'sess-2' })} />
        <RedisKeyPropsSidebar
          {...slotProps(relay, { dbSessionId: 'sess-2' })}
          open
          onClose={() => {}}
        />
      </>,
    );
    await waitFor(() => expect(router.keys.has('sess-2|5|user:1')).toBe(true));
    expect(router.calls('key_object_info')).toBe(2);
    // Reconnect ⇒ the eviction policy is a different server's fact and is re-read
    // once for the panel (the status bar has no policy row to feed).
    expect(router.calls('info_filtered')).toBe(2);

    router.keys.get('sess-2|5|user:1')!.resolve(info({ type: 'stream' }));
    await waitFor(() => expect(barType(container)).toBe('stream'));
    await waitFor(() => expect(sideValue(container, 'type')).toBe('stream'));
    expect(router.readKeys()).toEqual(['user:1', 'user:1']);
  });

  it('costs a fresh command when the user comes back to an already-read key', async () => {
    // The decisive "is this a value cache?" probe: A → B → A again. Anything that
    // keeps a settled reply in the table would answer the third selection from the
    // first read and paint `string` instead of `set`.
    const relay = makeRelay();
    const router = routeCommands();
    const { container } = render(
      <>
        <RedisKvStatusBar {...slotProps(relay)} />
        <RedisKeyPropsSidebar {...slotProps(relay)} open onClose={() => {}} />
      </>,
    );

    act(() => relay.selectKey('A'));
    await waitFor(() => expect(router.keys.has('sess-1|5|A')).toBe(true));
    router.keys.get('sess-1|5|A')!.resolve(info({ type: 'string' }));
    await waitFor(() => expect(statusState(container)).toBe('ready'));

    act(() => relay.selectKey('B'));
    await waitFor(() => expect(router.keys.has('sess-1|5|B')).toBe(true));
    router.keys.get('sess-1|5|B')!.resolve(info({ type: 'hash' }));
    await waitFor(() => expect(statusState(container)).toBe('ready'));

    act(() => relay.selectKey('A'));
    await waitFor(() => expect(router.calls('key_object_info')).toBe(3));
    router.keys.get('sess-1|5|A')!.resolve(info({ type: 'set', memoryBytes: 128 }));
    await waitFor(() => expect(statusState(container)).toBe('ready'));

    expect(router.readKeys()).toEqual(['A', 'B', 'A']);
    expect(barType(container)).toBe('set');
    expect(sideValue(container, 'type')).toBe('set');
    expect(sideValue(container, 'memory')).toBe('128 B');
  });

  it('re-reads through a panel that unmounts mid-flight and reopens on the same relay', async () => {
    // The WeakMap argument is "an entry cannot outlive its panel". A host panel that
    // closes and reopens with the *same* panel id gets the *same* atom back
    // (`getKvSlotState` is memoised per panel id, pruned only when the panel list
    // changes), so this is the one case where the table's scope object really does
    // come back. If a settled flight stayed in it, the reopened panel would render
    // the abandoned read's payload and issue nothing.
    const relay = makeRelay();
    const router = routeCommands();
    const first = render(
      <>
        <RedisKvStatusBar {...slotProps(relay)} />
        <RedisKeyPropsSidebar {...slotProps(relay)} open onClose={() => {}} />
      </>,
    );
    act(() => relay.selectKey('user:1'));
    await waitFor(() => expect(router.keys.has('sess-1|5|user:1')).toBe(true));
    const abandoned = router.keys.get('sess-1|5|user:1')!;
    first.unmount();
    // The read the panel stopped listening to now lands, after the unmount.
    abandoned.resolve(info({ type: 'zset', memoryBytes: 4096 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The relay still carries the selection (the host atom is per panel id), so the
    // mount effect of the reopened panel is what has to ask again — no new click.
    const again = render(
      <>
        <RedisKvStatusBar {...slotProps(relay)} />
        <RedisKeyPropsSidebar {...slotProps(relay)} open onClose={() => {}} />
      </>,
    );
    await waitFor(() => expect(router.calls('key_object_info')).toBe(2));
    router.keys.get('sess-1|5|user:1')!.resolve(info({ type: 'list' }));
    await waitFor(() => expect(statusState(again.container)).toBe('ready'));

    expect(router.readKeys()).toEqual(['user:1', 'user:1']);
    expect(barType(again.container)).toBe('list');
  });

  it('leaves a settled read behind for nothing when another panel opens', async () => {
    // Second half of the lifecycle claim: a *new* panel (new relay, same session
    // and key name) must read for itself, and must not inherit the first panel's
    // in-flight promise — which is what a module-level table would hand it.
    const panelA = makeRelay();
    const panelB = makeRelay();
    const router = routeCommands();
    const a = render(
      <>
        <RedisKvStatusBar {...slotProps(panelA)} />
        <RedisKeyPropsSidebar {...slotProps(panelA)} open onClose={() => {}} />
      </>,
    );
    act(() => panelA.selectKey('shared'));
    await waitFor(() => expect(router.keys.has('sess-1|5|shared')).toBe(true));
    router.keys.get('sess-1|5|shared')!.resolve(info({ type: 'hash' }));
    await waitFor(() => expect(statusState(a.container)).toBe('ready'));
    expect(router.calls('key_object_info')).toBe(1);

    const b = render(
      <>
        <RedisKvStatusBar {...slotProps(panelB)} />
        <RedisKeyPropsSidebar {...slotProps(panelB)} open onClose={() => {}} />
      </>,
    );
    act(() => panelB.selectKey('shared'));
    await waitFor(() => expect(router.calls('key_object_info')).toBe(2));
    router.keys.get('sess-1|5|shared')!.resolve(info({ type: 'string' }));
    await waitFor(() => expect(statusState(b.container)).toBe('ready'));

    expect(barType(a.container)).toBe('hash');
    expect(barType(b.container)).toBe('string');
    expect(router.readKeys()).toEqual(['shared', 'shared']);
  });

  it('sends a rejected read away with its promise', async () => {
    // A cached *rejection* is the same defect wearing a different hat: the next
    // selection of that key would render `failed` without ever asking the server.
    const relay = makeRelay();
    const router = routeCommands();
    const { container } = render(<RedisKvStatusBar {...slotProps(relay)} />);
    act(() => relay.selectKey('user:1'));
    await waitFor(() => expect(router.keys.has('sess-1|5|user:1')).toBe(true));
    router.keys.get('sess-1|5|user:1')!.reject(new Error('READONLY replica'));
    await waitFor(() => expect(statusState(container)).toBe('failed'));

    act(() => relay.selectKey('user:2'));
    await waitFor(() => expect(router.calls('key_object_info')).toBe(2));
    router.keys.get('sess-1|5|user:2')!.resolve(info({ type: 'set' }));
    await waitFor(() => expect(statusState(container)).toBe('ready'));
    act(() => relay.selectKey('user:1'));
    await waitFor(() => expect(router.calls('key_object_info')).toBe(3));
    router.keys.get('sess-1|5|user:1')!.resolve(info({ type: 'string' }));
    await waitFor(() => expect(statusState(container)).toBe('ready'));

    expect(router.readKeys()).toEqual(['user:1', 'user:2', 'user:1']);
    expect(barType(container)).toBe('string');
  });
});

describe('[tester r2] BUG-003: refresh covers the policy row as many times as it is clicked', () => {
  it('re-reads info_filtered once per click, not just the first time', async () => {
    // Round 1's measurement was "刷新 N 次 ⇒ info_filtered 调用 0 次". A fix whose
    // effect fires once (e.g. a one-shot flag instead of `attempt`) would show up
    // as 2 rather than 3 here.
    const relay = makeRelay();
    const router = routeCommands();
    const { container } = render(
      <RedisKeyPropsSidebar {...slotProps(relay)} open onClose={() => {}} />,
    );
    act(() => relay.selectKey('user:1'));
    await waitFor(() => expect(router.keys.has('sess-1|5|user:1')).toBe(true));
    router.keys.get('sess-1|5|user:1')!.resolve(info());
    router.policies.get('sess-1')!.resolve(policyReply('noeviction'));
    await waitFor(() => expect(sideValue(container, 'maxmemory-policy')).toBe('noeviction'));
    expect(router.calls('info_filtered')).toBe(1);

    fireEvent.click(refreshButton(container)!);
    await waitFor(() => expect(router.calls('info_filtered')).toBe(2));
    router.keys.get('sess-1|5|user:1')!.resolve(info());
    router.policies.get('sess-1')!.resolve(policyReply('allkeys-lfu'));
    await waitFor(() => expect(sideValue(container, 'maxmemory-policy')).toBe('allkeys-lfu'));

    fireEvent.click(refreshButton(container)!);
    await waitFor(() => expect(router.calls('info_filtered')).toBe(3));
    expect(router.calls('key_object_info')).toBe(3);
  });

  it('pins the previous session policy on screen while the new session attributes have landed (redis-kvbar-ui-BUG-005 evidence)', async () => {
    // Green by design: it records what the code does today so the paired skipped
    // case cannot be vacuous. `KeyPropsSidebar.tsx:62-65` justifies keeping the old
    // value "because it is a server-wide fact, not another key's attribute" — true
    // across keys, false across *sessions*: `invokeMaxmemoryPolicy(dbSessionId)` is
    // session-scoped, so this row attributes one server's fact to another server.
    const relay = makeRelay();
    const router = routeCommands();
    const { container, rerender } = render(
      <RedisKeyPropsSidebar {...slotProps(relay)} open onClose={() => {}} />,
    );
    act(() => relay.selectKey('user:1'));
    await waitFor(() => expect(router.keys.has('sess-1|5|user:1')).toBe(true));
    router.keys.get('sess-1|5|user:1')!.resolve(info({ type: 'string' }));
    router.policies.get('sess-1')!.resolve(policyReply('noeviction'));
    await waitFor(() => expect(sideValue(container, 'maxmemory-policy')).toBe('noeviction'));

    rerender(
      <RedisKeyPropsSidebar
        {...slotProps(relay, { dbSessionId: 'sess-2' })}
        open
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(router.keys.has('sess-2|5|user:1')).toBe(true));
    // The key read wins the race (one pipeline) and the policy read is still open.
    router.keys.get('sess-2|5|user:1')!.resolve(info({ type: 'hash', memoryBytes: 2048 }));
    await waitFor(() => expect(propsState(container)).toBe('ready'));

    expect(sideValue(container, 'type')).toBe('hash');
    // …and the eviction row still carries the *old* server's answer.
    expect(sideValue(container, 'maxmemory-policy')).toBe('noeviction');

    router.policies.get('sess-2')!.resolve(policyReply('allkeys-lfu'));
    await waitFor(() => expect(sideValue(container, 'maxmemory-policy')).toBe('allkeys-lfu'));
  });

  it.skip('clears the eviction-policy row while the next session has not answered (FIXME redis-kvbar-ui-BUG-005)', async () => {
    // FIXME(redis-kvbar-ui-BUG-005): red by design on `1778f592a`. Measured failure:
    //   AssertionError: expected 'noeviction' to be ''
    // i.e. the row keeps the *previous session's* `maxmemory_policy` next to a
    // freshly painted attribute list for the new session. §3.4 wants "no known
    // fact ⇒ no rendering", which is what every other row of this list does.
    const relay = makeRelay();
    const router = routeCommands();
    const { container, rerender } = render(
      <RedisKeyPropsSidebar {...slotProps(relay)} open onClose={() => {}} />,
    );
    act(() => relay.selectKey('user:1'));
    await waitFor(() => expect(router.keys.has('sess-1|5|user:1')).toBe(true));
    router.keys.get('sess-1|5|user:1')!.resolve(info({ type: 'string' }));
    router.policies.get('sess-1')!.resolve(policyReply('noeviction'));
    await waitFor(() => expect(sideValue(container, 'maxmemory-policy')).toBe('noeviction'));

    rerender(
      <RedisKeyPropsSidebar
        {...slotProps(relay, { dbSessionId: 'sess-2' })}
        open
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(router.keys.has('sess-2|5|user:1')).toBe(true));
    router.keys.get('sess-2|5|user:1')!.resolve(info({ type: 'hash' }));
    await waitFor(() => expect(propsState(container)).toBe('ready'));
    expect(sideValue(container, 'maxmemory-policy')).toBe('');
  });

  it('keeps the policy row for the same session across a key switch, which is not a mis-attribution', async () => {
    // Ruling-shape (1) checked from the other side, and the measured answer to it:
    // while a *key* switch is in flight the whole attribute list (policy row
    // included) is unmounted, because `publishRead` leaves the sidebar with no
    // facts — so the retained policy value cannot be attributed to the wrong key
    // at all. It is also not re-read for a mere key change (server-wide fact, same
    // session), which is what keeps selection from costing an extra round trip.
    const relay = makeRelay();
    const router = routeCommands();
    const { container } = render(
      <RedisKeyPropsSidebar {...slotProps(relay)} open onClose={() => {}} />,
    );
    act(() => relay.selectKey('user:1'));
    await waitFor(() => expect(router.keys.has('sess-1|5|user:1')).toBe(true));
    router.keys.get('sess-1|5|user:1')!.resolve(info({ type: 'string' }));
    router.policies.get('sess-1')!.resolve(policyReply('allkeys-lru'));
    await waitFor(() => expect(sideValue(container, 'maxmemory-policy')).toBe('allkeys-lru'));

    act(() => relay.selectKey('user:2'));
    await waitFor(() => expect(router.calls('key_object_info')).toBe(2));
    expect(propsState(container)).toBe('loading');
    expect(sideValue(container, 'maxmemory-policy')).toBe(null);
    expect(router.calls('info_filtered')).toBe(1);

    router.keys.get('sess-1|5|user:2')!.resolve(info({ type: 'hash' }));
    await waitFor(() => expect(propsState(container)).toBe('ready'));
    expect(sideValue(container, 'maxmemory-policy')).toBe('allkeys-lru');
    expect(sideValue(container, 'type')).toBe('hash');
  });
});
