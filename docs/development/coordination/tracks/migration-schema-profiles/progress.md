# migration-schema-profiles

## Phase

PASSED / READY_TO_MERGE

## Objective

Add reusable Schema Diff profiles with versioned persisted configuration, strict validation, Tauri IPC, and UI save/load flow. Persist connection IDs, database/schema scope, object filters and diff options only; never persist sessions, generated DDL, comparison results, or credentials.

## Conflict surface

Backend schema_diff/profile.rs, store/schema_diff_profiles.rs, commands/schema_diff.rs; frontend commands/schemaDiff.ts and windows/schema-diff/\*; bootstrap registration may conflict during merge.

## Acceptance

- versioned strict profile model with unknown-field rejection and validation
- encrypted store roundtrip; invalid records filtered safely
- IPC get/save/delete with connection existence validation
- UI saves/restores reviewed setup and triggers a fresh inspect
- no runtime sessions, generated DDL, comparison results, or credentials persisted
- targeted Rust/frontend/type tests and E2E case registration

## Implemented

- Added strict version 1 `SchemaDiffProfile` with connection/database/schema scope, table filters, diff options, and type overrides only.
- Added encrypted `schema_diff_profiles.enc` persistence with atomic writes and per-record invalid profile filtering.
- Added `get_schema_diff_profiles`, `save_schema_diff_profile`, and `delete_schema_diff_profile` IPC; save rejects missing source/target connections.
- Added Schema Diff window profile list, save/edit/delete controls, and load flow that reconnects current sessions and refreshes source objects before restoring the table selection.
- Added wrapper/unit coverage and registered E2E case SD-010.
- Fixed BUG-001 so profile type overrides survive cross-endpoint loading while ordinary endpoint changes still clear stale overrides.

## Validation

- `cargo test -p datazen --lib schema_diff::` — 71 passed.
- `cargo test -p datazen --lib store::schema_diff_profiles` — 1 passed.
- `npx vitest run src/commands/__tests__/schemaDiff.test.ts src/windows/schema-diff/__tests__/SchemaDiffWindow.test.tsx` — 15 passed.
- `npx tsc --noEmit` — passed.
- `npx prettier --check` on changed frontend/E2E/i18n files — passed after formatting.
- `npx vitest run src/windows/schema-diff/__tests__/SchemaDiffProfileLoad.test.tsx` — 1 passed.
- `npx vitest run src/windows/schema-diff/__tests__/SchemaDiffProfileLoad.test.tsx src/windows/schema-diff/__tests__/SchemaDiffWindow.test.tsx src/commands/__tests__/schemaDiff.test.ts` — 16 passed.
- `npx tsc --noEmit` — passed.

## Independent tester verification (round 2)

- Code review of `593eaf22` plus fix `72c7b63c`: profile persistence excludes runtime sessions, generated DDL/plans and credentials; cross-endpoint loading keeps `typeOverrides` until the fresh inspection completes.
- `cargo test -p datazen --lib -- --test-threads=1` — 1520 passed, 3 ignored.
- `npx vitest run src/commands/__tests__/schemaDiff.test.ts src/windows/schema-diff/__tests__/SchemaDiffWindow.test.tsx src/windows/schema-diff/__tests__/SchemaDiffProfileLoad.test.tsx` — 16 passed.
- `npx tsc --noEmit` — passed.
- `cargo fmt --all -- --check`, Prettier checks for changed frontend/E2E files, and `git diff --check` — passed.
- Coverage run executed with V8 instrumentation; the repository-wide threshold is not actionable for this scoped run because the configured global threshold includes the entire host and reports 0.46% lines. The changed profile paths are exercised by the 16 frontend tests and the dedicated Rust profile/store tests.
- Generated locale output and `Cargo.lock` were restored; worktree is clean apart from this coordination commit.

## E2E cases

- SD-010: save profile, select it again, load it, and verify the window returns to Objects with a fresh source table inspection.
- SD-011: create a profile with destructive/index/rollback options and a column type override, switch to a different endpoint, load the profile, re-run inspection and plan generation, and verify the selected table, options, and override are preserved while no session/DDL/plan/credential data is exposed.
- Missing source/target connection validation is covered by the Rust command helper test; the actionable IPC error is retained for the full E2E matrix.

## Commit

- Implementation handoff commit: `6afa2fe2` (the exact final amended hash is reported with `READY_FOR_TEST`); no generated files are included.
- Independent tester round-2 commit: `8d8de55b`.
