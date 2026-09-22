import type { KvSlotState } from '@datazen/driver-sdk';

/**
 * Public prop/handle surface of `RedisWorkbench` (屏 B). Kept in its own module
 * so the sidebar, toolbar and column components can type against the workbench
 * contract without importing the component (and its hook tree) — D-0 split.
 */

export interface RedisWorkbenchProps {
  dbSessionId: string;
  /**
   * Persistent connection id, when the host view forwards one (D-3 uses it as
   * the key-tree preference bucket). Absent ⇒ preferences stay scoped to
   * `dbSessionId`, which is the only identity `ConnectionViewProps` guarantees
   * every host mount provides.
   */
  connectionId?: string;
  initialDatabase?: string;
  hideSidebar?: boolean;
  onDbIndexChange?: (dbIndex: number) => void;
  onDatabaseChange?: (database: string) => void;
  onKeysChange?: (keys: string[]) => void;
  /**
   * Host-owned selection/dirty atom of this panel (`driver-sdk` `KvSlotState`),
   * forwarded by `RedisConnectionView`. The workbench is the only writer: the
   * host-rendered KV slots read selection and dirtiness from here instead of
   * calling back into the driver (PRD §7-2, contract F-2). Absent when the
   * driver declares no KV slot capability, so every publish below is optional.
   */
  kvSlotState?: KvSlotState;
}

export interface RedisWorkbenchHandle {
  refreshKeys: () => void;
  selectDatabase: (db: string) => void;
}
