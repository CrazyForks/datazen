# Data Sync conflict policies

## Scope

This track adds explicit optimistic-concurrency handling for reviewed Data
Sync plans:

- abort (the default) preserves the existing fail-closed behaviour: a
  zero-row UPDATE or DELETE is a conflict and the complete transaction rolls
  back.
- skip keeps the expected-target predicates, records zero-row UPDATE/DELETE
  conflicts, skips those statements, and commits independent writes.
- force removes expected-target predicates from UPDATE/DELETE while keeping
  the primary-key predicate. INSERT statements retain normal database
  conflict handling and still roll back on duplicate-key or other errors.

The conflict policy is part of SyncOptions, is accepted by the compare IPC,
and is copied into the server-owned immutable plan. A separate SHA-256 policy
fingerprint is checked at SQL generation and execution, so a client cannot
replace the policy after comparison. Missing policy payloads deserialize to
abort for compatibility.

Execution results retain the existing fields and add optional wire fields:
skipped and conflicts. The UI exposes the three choices with warnings and
shows the skipped count after a successful skip run. Changing policy after a
comparison clears the row-level comparison state and returns to setup.

## Validation

- `cargo test -p datazen --lib data_sync::execute::tests::`: 11 passed.
- `cargo test -p datazen --lib data_sync::sql::tests::`: 15 passed,
  including the expected-target predicate checks for Skip and Force.
- `cargo test -p datazen --lib commands::sync::`: 36 passed.
- Full Host Rust library: 1458 passed, 3 ignored.
- PostgreSQL driver: 104 passed; MySQL driver: 89 passed.
- Data Sync frontend tests: 46 passed across 8 files.
- `pnpm exec tsc --noEmit`: passed.
- `cargo test -p datazen --lib i18n_locale`: 9 passed.
- Formal `pnpm tauri:build:webdriver`: passed with PostgreSQL, MySQL, SQLite,
  and Redis injected; application and DMG bundles were produced.

Existing Data Sync E2E coverage was also run against the writable local
fixtures: `data-sync-window.ts` passed 12/12, `data-sync-edge-cases.ts`
passed 15/15, and `data-sync-real.ts` passed 23 tests. The real suite's
permission fixture could not connect because `E2E_PG_RO_PASSWORD` is unset.
The two full-journey failures are pre-existing assertions: PostgreSQL sends a
compare with all operations disabled, and the MySQL journey expects a disabled
Next button in a state where the current UI enables it. Neither exercises the
new conflict policy.

The locale synchronization script still reports the repository baseline of
400 missing and 362 stale translations across the eight non-builtin locales;
this track only updates the English and Simplified Chinese domain packs per
the development rule.

A live PostgreSQL/MySQL skip or force mutation journey was not run because the
configured environment does not expose the read-only fixture password. The
focused executor and SQL tests cover the policy semantics and transaction
boundaries.
