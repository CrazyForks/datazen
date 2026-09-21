/**
 * KV workspace slot bindings.
 *
 * Resolves, for the current connection-workspace view state, which of the four
 * driver-contributable KV surfaces (`contextBar` / `statusBar` /
 * `keyPropsSidebar` / `connectionHome`) actually exist, and freezes the props the
 * host hands each one. Nothing here knows what a Redis key is: a binding appears
 * only when the driver's `kvWorkspace` meta capability is set **and** this build
 * registered a component for the slot, so a driver declaring neither keeps today's
 * rendering untouched.
 *
 * The bindings are data, not elements — each host surface owns the pieces only it
 * knows (the toolbar's `compact` flag, the drawer's open/close) and spreads the
 * rest, which keeps the leaf components free of any driver or codegen import.
 */
import { useMemo, type ComponentType } from 'react';
import type {
  ConnectionHomeSlotProps,
  KeyPropsSidebarProps,
  KvContextBarProps,
  KvSlotState,
  KvStatusBarProps,
} from '@datazen/driver-sdk';
import { DB_REGISTRY } from '../../lib/databaseTypes';
import { getKvSlotComponent } from '../../lib/kvWorkspaceSlots';
import { getKvSlotState } from '../../lib/kvSlotState';
import type { ConnectionContext, Panel } from '../../stores/panelStore';
import type { DatabaseTypeMeta } from '../../lib/databaseMeta';
import type { DatabaseType } from '../../types';

/** Props bundle for a driver slot, minus what the receiving surface supplies itself. */
export type KvSlotPropsOf<T, Owned extends keyof T> = Omit<T, Owned>;

export interface KvContextBarBinding {
  Component: ComponentType<KvContextBarProps>;
  props: KvSlotPropsOf<KvContextBarProps, 'compact'>;
}

export interface KvStatusBarBinding {
  Component: ComponentType<KvStatusBarProps>;
  props: KvStatusBarProps;
}

export interface KvKeyPropsSidebarBinding {
  Component: ComponentType<KeyPropsSidebarProps>;
  props: KvSlotPropsOf<KeyPropsSidebarProps, 'open' | 'onClose'>;
}

export interface KvConnectionHomeBinding {
  Component: ComponentType<ConnectionHomeSlotProps>;
  props: ConnectionHomeSlotProps;
}

export interface KvWorkspaceSlots {
  /** 48px content-toolbar left cluster of the active KV panel. */
  contextBar?: KvContextBarBinding;
  /** Bottom status bar centre cluster of the active KV panel. */
  statusBar?: KvStatusBarBinding;
  /** Detail-drawer body of the active KV panel (replaces the row-detail table). */
  keyPropsSidebar?: KvKeyPropsSidebarBinding;
  /** Connected landing screen, when the driver claims 屏 A. */
  connectionHome?: KvConnectionHomeBinding;
  /**
   * Host-owned selection/dirty atom of the active KV panel. Handed to the panel's
   * connection view too, so the workbench publishes what the slots read.
   */
  panelState?: KvSlotState;
}

export interface UseKvWorkspaceSlotsArgs {
  activePanel: Panel | null;
  /** True when the active panel belongs to a key-value driver (`isKeyValue`). */
  isKvPanel: boolean;
  databaseType: DatabaseType | undefined;
  /** Logical database bound to the active panel (KV panels own their target). */
  database: string | null;
  dbSessionId: string;
  connectionId: string;
  connectionName: string;
  /** Session context shown on the landing screen (no panel open yet). */
  connectionContext: ConnectionContext | null;
  /** Database stored on the connection config, forwarded to the home slot. */
  initialDatabase: string | undefined;
}

/**
 * Numeric database index for index-addressed KV drivers.
 *
 * Driven by `databaseFieldType: 'index'` — the same metadata the connection form
 * reads — rather than by a driver id: only such drivers address databases by
 * number, and the label itself comes from the driver's own `list_databases`, so
 * the host extracts the trailing digits and nothing more.
 */
export function resolveKvDatabaseIndex(
  meta: DatabaseTypeMeta | undefined,
  database: string | null,
): number | undefined {
  if (!meta || meta.databaseFieldType !== 'index' || !database) return undefined;
  const match = /(\d+)$/.exec(database);
  if (!match) return undefined;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : undefined;
}

export function useKvWorkspaceSlots({
  activePanel,
  isKvPanel,
  databaseType,
  database,
  dbSessionId,
  connectionId,
  connectionName,
  connectionContext,
  initialDatabase,
}: UseKvWorkspaceSlotsArgs): KvWorkspaceSlots {
  const panelMeta = databaseType ? DB_REGISTRY[databaseType] : undefined;
  const dbIndex = resolveKvDatabaseIndex(panelMeta, database);
  const panelId = activePanel?.id;

  const panelState = useMemo(() => {
    if (!activePanel || !isKvPanel || !panelId) return undefined;
    return getKvSlotState(panelId);
  }, [activePanel, isKvPanel, panelId]);

  // Props every in-panel slot shares; kept stable so driver components can memo.
  const panelSlotProps = useMemo<KvSlotPropsOf<KvContextBarProps, 'compact'> | null>(
    () =>
      panelState && databaseType
        ? {
            connectionId,
            dbSessionId,
            connectionName,
            databaseType,
            database,
            dbIndex,
            state: panelState,
          }
        : null,
    [panelState, databaseType, connectionId, dbSessionId, connectionName, database, dbIndex],
  );

  const inPanelKvContext = Boolean(activePanel && isKvPanel && panelSlotProps);

  const contextBar = useMemo<KvContextBarBinding | undefined>(() => {
    if (!inPanelKvContext || !panelSlotProps) return undefined;
    const Component = getKvSlotComponent<KvContextBarProps>(databaseType, 'contextBar');
    return Component ? { Component, props: panelSlotProps } : undefined;
  }, [inPanelKvContext, panelSlotProps, databaseType]);

  const statusBar = useMemo<KvStatusBarBinding | undefined>(() => {
    if (!inPanelKvContext || !panelSlotProps) return undefined;
    const Component = getKvSlotComponent<KvStatusBarProps>(databaseType, 'statusBar');
    return Component ? { Component, props: panelSlotProps } : undefined;
  }, [inPanelKvContext, panelSlotProps, databaseType]);

  const keyPropsSidebar = useMemo<KvKeyPropsSidebarBinding | undefined>(() => {
    if (!inPanelKvContext || !panelSlotProps) return undefined;
    const Component = getKvSlotComponent<KeyPropsSidebarProps>(databaseType, 'keyPropsSidebar');
    return Component ? { Component, props: panelSlotProps } : undefined;
  }, [inPanelKvContext, panelSlotProps, databaseType]);

  // The landing screen has no panel, hence no selection/dirty atom.
  const homeContext = activePanel ? null : connectionContext;
  const connectionHome = useMemo<KvConnectionHomeBinding | undefined>(() => {
    if (!homeContext) return undefined;
    const Component = getKvSlotComponent<ConnectionHomeSlotProps>(
      homeContext.databaseType,
      'connectionHome',
    );
    if (!Component) return undefined;
    return {
      Component,
      props: {
        connectionId: homeContext.connectionId,
        dbSessionId: homeContext.dbSessionId,
        connectionName: homeContext.connectionName,
        databaseType: homeContext.databaseType,
        initialDatabase,
      },
    };
  }, [homeContext, initialDatabase]);

  return { contextBar, statusBar, keyPropsSidebar, connectionHome, panelState };
}
