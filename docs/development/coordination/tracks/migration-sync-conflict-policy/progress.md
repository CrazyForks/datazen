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

- cargo test -p datazen --lib data_sync::execute::tests:: 10 passed.
- cargo test -p datazen --lib data_sync::sql::tests::skip_keeps_expected_predicates: passed.
- cargo test -p datazen --lib commands::sync:: 36 passed.
- pnpm exec tsc --noEmit: passed.
- Data Sync UI tests (OptionsBar, DataSyncWindow): 31 passed.

A live PostgreSQL/MySQL skip or force journey was not run in this track because
the configured environment does not expose E2E_PG_RO_PASSWORD. Formal
WebDriver build and independent verification remain release-gate work.
