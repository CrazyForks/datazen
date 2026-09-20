# Bugs and boundaries

- Metadata enumeration for a named PostgreSQL database may use a temporary
  catalog pool; row scans and table-schema reads remain on the stable session
  snapshot. A later driver capability wave can make catalog reads snapshot
  aware where the backend supports it.
- SQLite remains outside the current V1 Data Sync family gate. Its ordinary
  transactions therefore do not claim stable-snapshot support through this
  track.
- Snapshot lifetime is scoped to one comparison call and is always rolled back
  before the command returns. It is not a resumable scan checkpoint.
