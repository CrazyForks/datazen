/**
 * Identity of one Redis top-level tab (one "panel" in the host's sense).
 *
 * ## Why not `dbSessionId`
 *
 * `dbSessionId` names the *live connection session*, and every db tab opened
 * against one Redis connection shares it - `ConnectionPage` copies
 * `useActiveConnectionStore.connections[connectionId].dbSessionId` onto each
 * `RedisDbPanel` it creates. Keying per-tab UI state by it therefore made
 * db0 and db1 share one console transcript and one sub-tab choice: switching
 * db0 to the console also opened a freshly created db1 tab on the console.
 *
 * The host itself identifies these panels by `(connectionId, dbName)` - it
 * reuses an existing panel instead of creating a duplicate for the same pair
 * (`ConnectionPage.openRedisDbPanel`) - and `initialDatabase` is that
 * `dbName` (`PanelContentRenderer` passes `initialDatabase={kvPanel.dbName}`).
 * So the same pair is the correct key for state that must not cross tabs.
 */
export function panelScopeKey(connectionId: string, database: string): string {
  // NUL separator: it cannot occur in a connection id or a Redis database
  // name, so distinct pairs can never collide.
  return `${connectionId}\u0000${database}`;
}
