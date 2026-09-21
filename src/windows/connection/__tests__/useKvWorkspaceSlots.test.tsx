import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { KvSlotName } from '@datazen/driver-sdk';
import type { DatabaseType } from '../../../types';
import type { ConnectionContext, Panel } from '../../../stores/panelStore';
import type { DatabaseTypeMeta } from '../../../lib/databaseMeta';
import { resetKvSlotStatesForTests } from '../../../lib/kvSlotState';
import { useKvWorkspaceSlots, resolveKvDatabaseIndex } from '../useKvWorkspaceSlots';

const { contributed, registry } = vi.hoisted(() => ({
  /** `${dbType}:${slot}` → component registered by this build (codegen stand-in). */
  contributed: new Map<string, unknown>(),
  registry: {} as Record<string, unknown>,
}));

vi.mock('../../../lib/databaseTypes', () => ({ DB_REGISTRY: registry }));
vi.mock('../../../extensions/generated', () => ({
  getDriverKvSlot: (dbType: string, slot: KvSlotName) => contributed.get(`${dbType}:${slot}`),
}));

const ContextBarFixture = () => null;
const StatusBarFixture = () => null;
const KeyPropsFixture = () => null;
const HomeFixture = () => null;

function registerMeta(dbType: string, over: Partial<DatabaseTypeMeta>) {
  registry[dbType] = {
    label: dbType,
    shortLabel: 'FX',
    iconBg: 'bg-red-600',
    iconColor: 'text-red-400',
    defaultPort: 0,
    defaultHost: '127.0.0.1',
    defaultUser: '',
    quoteChar: '`',
    connectionMode: 'server',
    supportsSSH: false,
    supportsSSL: false,
    supportsBackup: false,
    supportsTables: false,
    isKeyValue: true,
    supportsSQL: false,
    category: 'kv',
    connectionView: 'keyvalue',
    databaseFieldType: 'index',
    connectionForm: 'standard',
    ...over,
  } satisfies DatabaseTypeMeta;
}

function contributeAll(dbType: string) {
  contributed.set(`${dbType}:contextBar`, ContextBarFixture);
  contributed.set(`${dbType}:statusBar`, StatusBarFixture);
  contributed.set(`${dbType}:keyPropsSidebar`, KeyPropsFixture);
  contributed.set(`${dbType}:connectionHome`, HomeFixture);
}

const PANEL = {
  id: 'panel-kv-1',
  type: 'redis-db',
  connectionId: 'cfg-1',
  dbSessionId: 'sess-1',
  connectionName: 'KV Local',
  databaseType: 'kvfull',
  dbName: 'db7',
} as unknown as Panel;

const HOME_CONTEXT: ConnectionContext = {
  connectionId: 'cfg-1',
  dbSessionId: 'sess-1',
  connectionName: 'KV Local',
  databaseType: 'kvhome',
};

function args(over: Partial<Parameters<typeof useKvWorkspaceSlots>[0]> = {}) {
  return {
    activePanel: PANEL,
    isKvPanel: true,
    databaseType: 'kvfull' as DatabaseType,
    database: 'db7',
    dbSessionId: 'sess-1',
    connectionId: 'cfg-1',
    connectionName: 'KV Local',
    connectionContext: null,
    initialDatabase: undefined,
    ...over,
  };
}

beforeEach(() => {
  resetKvSlotStatesForTests();
  contributed.clear();
  vi.resetModules();
});

describe('useKvWorkspaceSlots', () => {
  it('binds every declared + contributed slot to the same panel props', () => {
    registerMeta('kvfull', {
      kvWorkspace: { contextBar: true, statusBar: true, keyPropsSidebar: true, home: true },
    });
    contributeAll('kvfull');

    const { result } = renderHook(() => useKvWorkspaceSlots(args()));
    const slots = result.current;

    expect(slots.contextBar?.Component).toBe(ContextBarFixture);
    expect(slots.statusBar?.Component).toBe(StatusBarFixture);
    expect(slots.keyPropsSidebar?.Component).toBe(KeyPropsFixture);
    // The landing screen is only handed over when no panel is open.
    expect(slots.connectionHome).toBeUndefined();

    expect(slots.contextBar?.props).toEqual({
      connectionId: 'cfg-1',
      dbSessionId: 'sess-1',
      connectionName: 'KV Local',
      databaseType: 'kvfull',
      database: 'db7',
      dbIndex: 7,
      state: slots.panelState,
    });
    // The frozen contract: the drawer owns `open`/`onClose`, the toolbar owns
    // `compact`, so neither leaks into the shared props bundle.
    expect(slots.keyPropsSidebar?.props).toEqual(slots.contextBar?.props);
    expect(slots.keyPropsSidebar?.props).not.toHaveProperty('open');
    expect(slots.keyPropsSidebar?.props).not.toHaveProperty('onClose');
    expect(slots.contextBar?.props).not.toHaveProperty('compact');
  });

  it('hands the same state atom to the panel slots and keeps props stable across renders', () => {
    registerMeta('kvfull', { kvWorkspace: { contextBar: true, statusBar: true } });
    contributeAll('kvfull');

    const { result, rerender } = renderHook(
      ({ panel }) => useKvWorkspaceSlots(args({ activePanel: panel })),
      { initialProps: { panel: PANEL } },
    );
    const firstProps = result.current.contextBar?.props;
    const firstState = result.current.panelState;
    // Re-render with a *new* panel object (same id): driver components are
    // allowed to memo on these props, so the bundle identity must not churn.
    rerender({ panel: { ...PANEL } });

    expect(firstState).toBeDefined();
    expect(result.current.panelState).toBe(firstState);
    expect(result.current.contextBar?.props.state).toBe(firstState);
    expect(result.current.statusBar?.props.state).toBe(firstState);
    expect(result.current.contextBar?.props).toBe(firstProps);
  });

  it('returns no bindings when the driver declares the capability but contributed no component', () => {
    // Wave-2 gap path: meta says "I can", this build ships nothing ⇒ status quo.
    registerMeta('kvcapable-only', {
      kvWorkspace: { contextBar: true, statusBar: true, keyPropsSidebar: true, home: true },
    });

    const { result } = renderHook(() =>
      useKvWorkspaceSlots(args({ databaseType: 'kvcapable-only' as DatabaseType })),
    );

    expect(result.current.contextBar).toBeUndefined();
    expect(result.current.statusBar).toBeUndefined();
    expect(result.current.keyPropsSidebar).toBeUndefined();
    expect(result.current.connectionHome).toBeUndefined();
    // The panel state atom still exists, but nothing reads it — no crash either.
    expect(result.current.panelState).toBeDefined();
  });

  it('ignores contributed components for a driver without the capability', () => {
    registerMeta('kvundeclared');
    contributeAll('kvundeclared');

    const { result } = renderHook(() =>
      useKvWorkspaceSlots(args({ databaseType: 'kvundeclared' as DatabaseType })),
    );

    expect(result.current.contextBar).toBeUndefined();
    expect(result.current.statusBar).toBeUndefined();
    expect(result.current.keyPropsSidebar).toBeUndefined();
    expect(result.current.connectionHome).toBeUndefined();
    expect(result.current.panelState).toBeDefined();
  });

  it('opens no in-panel slot while the active panel is not a KV panel', () => {
    registerMeta('kvfull', { kvWorkspace: { contextBar: true } });
    contributeAll('kvfull');

    const { result } = renderHook(() => useKvWorkspaceSlots(args({ isKvPanel: false })));

    expect(result.current.contextBar).toBeUndefined();
    expect(result.current.statusBar).toBeUndefined();
    expect(result.current.keyPropsSidebar).toBeUndefined();
    expect(result.current.panelState).toBeUndefined();
  });

  it('yields the landing screen to the driver home only while no panel is open', () => {
    registerMeta('kvhome', { kvWorkspace: { home: true } });
    contributed.set('kvhome:connectionHome', HomeFixture);

    const { result } = renderHook(() =>
      useKvWorkspaceSlots(
        args({
          activePanel: null,
          databaseType: 'kvhome' as DatabaseType,
          connectionContext: HOME_CONTEXT,
          initialDatabase: 'db3',
        }),
      ),
    );

    expect(result.current.connectionHome?.Component).toBe(HomeFixture);
    expect(result.current.connectionHome?.props).toEqual({
      connectionId: 'cfg-1',
      dbSessionId: 'sess-1',
      connectionName: 'KV Local',
      databaseType: 'kvhome',
      initialDatabase: 'db3',
    });
    // No panel ⇒ no selection/dirty atom, no in-panel clusters.
    expect(result.current.panelState).toBeUndefined();
    expect(result.current.contextBar).toBeUndefined();

    const withPanel = renderHook(() =>
      useKvWorkspaceSlots(
        args({
          activePanel: { ...PANEL, databaseType: 'kvhome' } as unknown as Panel,
          databaseType: 'kvhome' as DatabaseType,
          connectionContext: HOME_CONTEXT,
        }),
      ),
    );
    expect(withPanel.result.current.connectionHome).toBeUndefined();
  });

  it('resolves dbIndex from index-addressed databases only', () => {
    const indexMeta = { databaseFieldType: 'index' } as DatabaseTypeMeta;
    const nameMeta = { databaseFieldType: 'name' } as DatabaseTypeMeta;

    expect(resolveKvDatabaseIndex(indexMeta, 'db7')).toBe(7);
    expect(resolveKvDatabaseIndex(indexMeta, 'db15')).toBe(15);
    // No trailing digits / no target yet ⇒ nothing to hand the driver.
    expect(resolveKvDatabaseIndex(indexMeta, null)).toBeUndefined();
    expect(resolveKvDatabaseIndex(indexMeta, 'keyspace')).toBeUndefined();
    // A name-addressed driver is not indexed, even if the name looks numeric.
    expect(resolveKvDatabaseIndex(nameMeta, 'db7')).toBeUndefined();
    expect(resolveKvDatabaseIndex(undefined, 'db7')).toBeUndefined();
  });
});
