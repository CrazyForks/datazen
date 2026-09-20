# Bugs and boundaries

- The UI preview remains a complete `TableResult[]` response for compatibility;
  very large previews can still consume client memory and IPC bandwidth. A
  future UI protocol can add server-side pagination by table or row range.
- The comparison merge engine still enforces its existing 1,000-row/8 MiB page
  guard and 10,000-difference/32 MiB per-table guard. This track removes only
  the aggregate 64 MiB plan rejection and does not redesign the merge sink.
- Disk storage is temporary JSON, not an on-disk resumable comparison database.
  Each SQL-generation or execution request reloads the stored comparison into
  memory for the existing selection and ChangeSet APIs.
- Claimed plan IDs become unknown/stale immediately after the atomic claim. The
  one-shot behavior is preserved; no client retry can reuse the stored result.
- Temporary files are private to the current process and are deleted when the
  last owner drops. A process crash can leave orphan files under the
  `datazen-sync-comparisons` temp directory; startup scavenging is a follow-up.
