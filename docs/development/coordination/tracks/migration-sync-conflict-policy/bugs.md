# Data Sync conflict policy defects

## Open limitations

- Live PostgreSQL/MySQL skip and force journeys require the configured
  read-only test password and were not available during implementation.
- force intentionally does not convert INSERT duplicate-key failures into
  skips; this is required to avoid silently overwriting or dropping data.
- Conflict details currently report zero-row optimistic conflicts. Database
  errors remain transaction failures and are returned through the existing
  command error path.

- The repository-wide locale synchronization check remains red for its
  existing 400 missing and 362 stale translations across eight non-builtin
  locales. The conflict policy keys are present in the English and Simplified
  Chinese packs used by this track.

- Existing `data-sync-journey.ts` has two unrelated failures: one invokes
  compare after disabling all operations, and one has a stale MySQL Next-button
  expectation. The focused conflict-policy tests and all other Data Sync E2E
  specs passed.

No implementation defect was reproduced in the focused Rust or frontend
tests.
