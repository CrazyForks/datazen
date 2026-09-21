/**
 * KV workspace slot contracts (host shell ↔ driver UI).
 *
 * The connection workspace exposes four slots that a key-value driver may fill
 * (48px context bar, bottom status bar, key-props sidebar, connection home).
 * The host owns the slot *geometry* and the panel lifecycle; the driver owns the
 * *content*. Nothing here references a concrete driver — a driver only gets a
 * slot when its {@link DatabaseTypeMeta.kvWorkspace} capability says so and the
 * build registered a component for it (see `scripts/resolve-drivers.mjs`).
 *
 * Type-only module: no host runtime import, safe for headless driver packages.
 */
import type { DatabaseType } from '../../../../src/types';

/**
 * Slots a driver can contribute to the KV workspace.
 *
 * - `contextBar` — the 48px content-toolbar left cluster of an open KV panel.
 * - `statusBar` — the bottom status-bar centre cluster of an open KV panel.
 * - `keyPropsSidebar` — the detail drawer body of an open KV panel.
 * - `connectionHome` — the landing screen of a connected session with no panel.
 */
export type KvSlotName = 'contextBar' | 'statusBar' | 'keyPropsSidebar' | 'connectionHome';

/**
 * Per-panel KV state, created and owned by the **host** and handed to every
 * in-panel slot *and* to the panel's connection view (`ConnectionViewProps.kvSlotState`).
 *
 * Why a host-owned relay instead of a driver module singleton: the workbench
 * (which knows the selected key and the unsaved-draft flag) and the toolbar /
 * status-bar / sidebar slots render in three different React subtrees, and the
 * host decides when the panel — and therefore this state — dies. A driver-side
 * module cache keyed by session would outlive the panel.
 *
 * The getters plus `subscribe` are intentionally
 * `useSyncExternalStore`-shaped so a slot subscribes to exactly the field it
 * renders (`useSyncExternalStore(state.subscribe, state.getSelectedKey)`).
 * The host does **not** subscribe on the render path: selection changes are far
 * too frequent to re-render the whole workspace, which is why the selected key
 * is *not* also passed as a plain prop.
 */
export interface KvSlotState {
  /** Register a change listener; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Key currently selected in the driver's key tree, `null` when none. */
  getSelectedKey(): string | null;
  /** Publish the selected key (called by the driver's workbench/tree). */
  selectKey(key: string | null): void;
  /** Whether the panel holds unsaved edits (drives the dirty gate, PRD I-1). */
  getDirty(): boolean;
  /** Publish the dirty flag (called by the driver's editors). */
  setDirty(dirty: boolean): void;
}

/** Props every in-panel KV slot receives from the host. */
export interface KvPanelSlotProps {
  /** Persisted connection-config id (stable across restarts). */
  connectionId: string;
  /** Live database session id (runtime only, never persisted). */
  dbSessionId: string;
  /** Display name of the connection, for titles/empty states. */
  connectionName: string;
  /** Registry key of the driver owning this panel. */
  databaseType: DatabaseType;
  /**
   * Logical database the panel is bound to, e.g. `db0`.
   * `null` while the session has not resolved one yet.
   */
  database: string | null;
  /**
   * Numeric index of {@link database} for index-addressed drivers
   * (`databaseFieldType: 'index'`, i.e. Redis). Undefined otherwise.
   */
  dbIndex?: number;
  /** Host-owned per-panel state relay (selected key + dirty flag). */
  state: KvSlotState;
}

/** Content-toolbar 48px context bar (`kvWorkspace.contextBar`). */
export interface KvContextBarProps extends KvPanelSlotProps {
  /**
   * Whether the toolbar is below its expanded-width threshold. The host measures
   * the toolbar; a driver decides what to drop first (chips → icons → overflow).
   */
  compact: boolean;
}

/** Bottom status bar centre cluster (`kvWorkspace.statusBar`). */
export type KvStatusBarProps = KvPanelSlotProps;

/** Detail-drawer key-props sidebar (`kvWorkspace.keyPropsSidebar`). */
export interface KeyPropsSidebarProps extends KvPanelSlotProps {
  /** Whether the drawer is expanded (the host owns the open state). */
  open: boolean;
  /** Collapse request wired to the host's toggle. */
  onClose: () => void;
}

/**
 * Connection home / landing screen contribution (`kvWorkspace.home`).
 *
 * Rendered instead of the host's connected-home banner when the driver declares
 * the capability and contributed the slot; the host passes no panel state here
 * because no panel is open yet on this screen.
 */
export interface ConnectionHomeSlotProps {
  /** Persisted connection-config id. */
  connectionId: string;
  /** Live database session id of the connected session. */
  dbSessionId: string;
  /** Display name of the connection. */
  connectionName: string;
  /** Registry key of the driver owning this connection. */
  databaseType: DatabaseType;
  /** Database saved on the connection config, when the user set one. */
  initialDatabase?: string;
}
