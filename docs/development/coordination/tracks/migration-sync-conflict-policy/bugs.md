# Data Sync conflict policy defects

## Open limitations

- Live PostgreSQL/MySQL skip and force journeys require the configured
  read-only test password and were not available during implementation.
- force intentionally does not convert INSERT duplicate-key failures into
  skips; this is required to avoid silently overwriting or dropping data.
- Conflict details currently report zero-row optimistic conflicts. Database
  errors remain transaction failures and are returned through the existing
  command error path.

No implementation defect was reproduced in the focused Rust or frontend
tests.

