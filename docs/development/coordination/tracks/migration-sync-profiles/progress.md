# migration-sync-profiles

## Phase
READY_TO_MERGE

## Objective
Add reusable Data Sync profiles with versioned persisted configuration, strict validation, Tauri IPC, and UI save/load flow. Persist connection IDs, database/schema scope, table selection, filters/recordsets, and sync options. Never persist dbSessionId, comparison rows, plan IDs, or credentials.

## Conflict surface
Backend data_sync/profile.rs, store/sync_profiles.rs, commands/sync/*; frontend commands/sync.ts, windows/data-sync/DataSyncWindow.tsx; bootstrap registration may conflict during merge.

## Acceptance
- versioned strict profile model with unknown-field rejection and validation
- encrypted store roundtrip; invalid records filtered safely
- IPC get/save/delete with connection existence validation
- UI saves/restores reviewed setup and reapplies filters/table selections after fresh inspect
- no runtime sessions, comparison results, or credentials persisted
- targeted Rust/frontend/type tests and E2E case registration

## E2E cases (留待 R 回归)
- save profile, reopen Data Sync, load profile, inspect, verify disabled tables and source filters restored
- load profile with missing connection and verify actionable validation error

## Implementation

- Commit: 2ee43c4f21b61d5fc75e924524f128e88fb0618f
- Added strict versioned `SyncProfile` model and `sync_profiles.json` store CRUD.
- Added `get_sync_profiles`, `save_sync_profile`, and `delete_sync_profile` IPC with
  source/target connection existence validation and bootstrap registration.
- Added profile-aware inspection mappings so disabled tables, structured filters,
  and recordset bounds are restored after a fresh inspect.
- Added Data Sync window profile save/load/delete controls; runtime sessions,
  comparison rows, credentials, and plan ids remain transient.

## Validation

- `cargo test -p datazen --lib`: 1519 passed, 3 ignored.
- `npx vitest run src/commands/__tests__/syncPlan.test.ts src/windows/data-sync/__tests__/DataSyncWindow.test.tsx`: 39 passed.
- `npx tsc --noEmit`: passed.
- `cargo fmt --all`: passed after restoring generated driver files and Cargo.lock.
- `git diff --check`: passed.

## Independent tester result

- Frontend changed test files: `DataSyncWindow.test.tsx` 43 passed; `syncPlan.test.ts` 7 passed.
- Rust full host suite: 1519 passed, 3 ignored; focused profile IPC and model tests passed.
- TypeScript: `npx tsc --noEmit` passed.
- Formatting/diff: passed before tester additions; rerun after additions is required by coordinator.
- Coverage with changed frontend files included: 78.40% statements, 69.25% branches, 77.44% functions, 81.08% lines. The global threshold command failed on statements/functions/branches; added profile save/load/delete, stale connection, mapping/recordset restoration, IPC, and invalid-store tests. Core profile lines are exercised, but the changed files remain below the hard 80% all-metric target.
- Previous round: **TEST_FAILED** for `migration-sync-profiles-BUG-001`; the issue is closed in the second-round retest below.

## Second-round independent retest

- Stage A review: `store::ensure_sync_profiles_loaded` now deserializes each JSON array record independently, so one malformed, unknown-field, unsupported-version, `null`, or scalar record cannot discard valid profiles. Save/delete paths remain backed by the filtered cache. No production defects found.
- Stage B: `cargo test -p datazen --lib` — 1520 passed, 0 failed, 3 ignored; changed Vitest files — 43 passed; `npx tsc --noEmit` — passed; `cargo fmt --all -- --check` and `git diff --check` — passed.
- Stage C: added a regression assertion covering mixed malformed records followed by save and delete. Changed frontend coverage remains 78.40% statements, 69.25% branches, 77.44% functions, 81.08% lines under the existing targeted coverage command; the global 80% statement/function and 75% branch thresholds remain unmet because `DataSyncWindow.tsx` and `sync.ts` include unrelated wizard paths. Core profile save/load/delete and fresh-inspect restoration paths are covered.
- Stage D: `migration-sync-profiles-BUG-001` marked 已修复; this track is `READY_TO_MERGE`.

## BUG-001 fix

- Changed profile loading to parse each JSON record independently and filter
  malformed, unknown-field, or unsupported-version records without discarding
  valid profiles from the same array.
- Regression `store::tests::sync_profiles_filter_invalid_records_on_load` now passes.
- Status: closed after the second independent retest below.
