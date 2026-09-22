/**
 * redis-kvbar-ui — round-1 bug-fix regressions (BUG-001 … BUG-004).
 *
 * The two suites this complements already pin the happy path
 * (`kvBarSlots.test.tsx`) and the branch gaps the first test round found
 * (`kvBarSlotTesterGaps.test.tsx`, whose three `FIXME` cases the fix commits
 * un-skip). What lives here is the part a *fix* has to defend against its own
 * regressions: rules that hold inside the hook's state and therefore cannot be
 * observed through the rendered DOM, because every test renderer flushes effects
 * before asserting (the frame these rules cover is the one *between* the render
 * that moves a selection and the effect that starts the next read).
 *
 * Mutation policy for this file (per the coordination ruling on BUG-001): each
 * identity field of a read — database session, database index, key name — is
 * pinned by its own case, so dropping any one of them from the ownership token
 * reddens exactly that case instead of leaving a silent survivor.
 *
 * Assertion policy (PRD §7-6): `data-*` markers, i18n keys and values echoed by
 * Redis only. No rendered English copy is asserted anywhere in this file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
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

import { RedisKvStatusBar } from '../kv-bar';
import type { KeyObjectInfo } from '../kv-bar/keyObjectInfo';
import { publishRead, type KeyReadOwner, type OwnedKeyRead } from '../kv-bar/useKeyObjectInfo';

/** Local stand-in for the host's per-panel atom (same reason as the other suites). */
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

/**
 * One deferred per `key_object_info` call, keyed by the **whole** read identity.
 *
 * Keying by session + index + name is what lets a case resolve "the reply for the
 * previous database" separately from the current one; a name-only map cannot
 * express that, which is why the shared helper in the other suites is not reused.
 */
function queueReadsByIdentity(): Map<string, Deferred<KeyObjectInfo>> {
  const pending = new Map<string, Deferred<KeyObjectInfo>>();
  commandInvoke.mockImplementation((_plugin: string, command: string, payload: unknown) => {
    if (command !== 'key_object_info') return Promise.resolve({ sections: [] });
    const { dbSessionId, dbIndex, key } = payload as {
      dbSessionId: string;
      dbIndex: number;
      key: string;
    };
    const slot = deferred<KeyObjectInfo>();
    pending.set(`${dbSessionId}|${dbIndex}|${key}`, slot);
    return slot.promise;
  });
  return pending;
}

const NOTHING = { info: null, loading: false, failed: false };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('[fix:BUG-001] read ownership rule (publishRead, pure)', () => {
  const owner: KeyReadOwner = { dbSessionId: 'sess-1', dbIndex: 5, key: 'first' };
  const settled: OwnedKeyRead = {
    owner,
    info: info({ type: 'hash', memoryBytes: 2048 }),
    loading: false,
    failed: false,
  };

  it('publishes a read to exactly the key it was read from', () => {
    expect(publishRead(settled, { ...owner })).toEqual({
      info: settled.info,
      loading: false,
      failed: false,
    });
  });

  it('publishes nothing to any other read identity, one field at a time', () => {
    // Each case deletes one mutation target: dropping any single field from the
    // ownership token makes exactly one of these four assertions wrong.
    expect(publishRead(settled, { ...owner, key: 'second' })).toEqual(NOTHING);
    expect(publishRead(settled, { ...owner, dbIndex: 6 })).toEqual(NOTHING);
    expect(publishRead(settled, { ...owner, dbSessionId: 'sess-2' })).toEqual(NOTHING);
    expect(publishRead(settled, null)).toEqual(NOTHING);
  });

  it('does not let another key\'s in-flight flag reach the renderer', () => {
    // `loading` is published with the same ownership test as `info`: a borrowed
    // loading flag would name the new key `loading` before its own read exists,
    // which is the mirror image of the stale-payload bug.
    const inflight: OwnedKeyRead = { owner, info: null, loading: true, failed: false };
    expect(publishRead(inflight, { ...owner, key: 'second' })).toEqual(NOTHING);
    expect(publishRead(inflight, { ...owner })).toEqual({
      info: null,
      loading: true,
      failed: false,
    });
  });

  it('keeps a failure owned by its key', () => {
    const failed: OwnedKeyRead = { owner, info: null, loading: false, failed: true };
    expect(publishRead(failed, { ...owner })).toEqual({
      info: null,
      loading: false,
      failed: true,
    });
    expect(publishRead(failed, null)).toEqual(NOTHING);
  });

  it('publishes an empty read for no selection without inventing a state', () => {
    expect(publishRead({ owner: null, ...NOTHING }, null)).toEqual(NOTHING);
  });
});

describe('[fix:BUG-001] superseded replies (rendered through the statusBar slot)', () => {
  /**
   * Move one identity field of the read while the first reply is still in
   * flight, land the *new* reply, then land the old one out of order.
   *
   * The old reply must be discarded where it arrives: painting it would show
   * another database's key, and simply writing it to state would clear the
   * current key's `loading`/`ready` markers without showing anything.
   */
  async function outOfOrderReadLands(vary: 'dbSessionId' | 'dbIndex'): Promise<void> {
    const relay = makeRelay();
    const pending = queueReadsByIdentity();
    const { container, rerender } = render(<RedisKvStatusBar {...slotProps(relay)} />);

    act(() => relay.selectKey('same'));
    await waitFor(() => expect(pending.size).toBe(1));
    const staleId = [...pending.keys()][0]!;

    rerender(
      <RedisKvStatusBar
        {...slotProps(relay, vary === 'dbSessionId' ? { dbSessionId: 'sess-2' } : { dbIndex: 6 })}
      />,
    );
    await waitFor(() => expect(pending.size).toBe(2));
    const currentId = [...pending.keys()].find((id) => id !== staleId)!;

    pending.get(currentId)!.resolve(info({ type: 'hash', memoryBytes: 2048 }));
    await waitFor(() =>
      expect(container.querySelector('[data-part="type"]')?.textContent).toBe('hash'),
    );

    pending.get(staleId)!.resolve(info({ type: 'string', memoryBytes: 640 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('[data-part="type"]')?.textContent).toBe('hash');
    expect(container.querySelector('[data-part="size"]')?.textContent).toBe('2.0 KB');
    // The state marker has to stay `ready`: a discarded reply that still reaches
    // the state would leave the bar at `unavailable` for a key it has data for.
    expect(container.querySelector('[data-status-state]')?.getAttribute('data-status-state')).toBe(
      'ready',
    );
  }

  it('discards a reply from a database session that has been replaced', async () => {
    await outOfOrderReadLands('dbSessionId');
  });

  it('discards a reply from a database index that has been replaced', async () => {
    await outOfOrderReadLands('dbIndex');
  });

  it('publishes no known facts between selecting another key and starting its read', async () => {
    // The in-flight window itself, measured from the outside: while a read is
    // open the bar carries `loading` and *no* attribute parts at all.
    const relay = makeRelay();
    const pending = queueReadsByIdentity();
    const { container } = render(<RedisKvStatusBar {...slotProps(relay)} />);
    act(() => relay.selectKey('user:1'));
    await waitFor(() => expect(pending.size).toBe(1));

    expect(container.querySelector('[data-status-state]')?.getAttribute('data-status-state')).toBe(
      'loading',
    );
    expect(container.querySelector('[data-part="type"]')).toBeNull();
    expect(container.querySelector('[data-part="size"]')).toBeNull();
    expect(container.querySelector('[data-part="ttl"]')).toBeNull();

    pending.get('sess-1|5|user:1')!.resolve(info({ ttlMs: 125_000 }));
    await waitFor(() =>
      expect(container.querySelector('[data-status-state]')?.getAttribute('data-status-state')).toBe(
        'ready',
      ),
    );
    expect(container.querySelector('[data-part="size"]')?.textContent).toBe('640 B');
    expect(container.querySelector('[data-part="ttl"]')?.textContent).toBe('2m 05s');
  });
});
