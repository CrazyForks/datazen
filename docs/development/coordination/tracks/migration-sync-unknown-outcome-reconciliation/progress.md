# migration-sync-unknown-outcome-reconciliation

Phase: READY_FOR_TEST

- Task: classify Data Sync execution outcomes accurately and let users start a fresh, reviewable comparison from an unknown run
- Branch: `feature/migration-sync-unknown-outcome-reconciliation`
- Worktree: `.worktrees/datazen-migration-sync-unknown-outcome-reconciliation`
- Baseline: `codex/migration-navicat` at the latest integrated migration commit

## Scope

Current Data Sync keeps a conservative in-window write fence after an execution error and allows the user to inspect both endpoints again before creating a new plan. That is safe against blind replay, but it is not tied to run history. The history path also records broad execution failures as failed/unknown even when validation proves that no write started. This track makes those states accurate and gives an unknown history item a safe way to reopen the ordinary compare/review journey.

The recovery action must never retry the old plan, SQL, row payload, or transaction. It reconnects using stable connection identities, verifies the current endpoint context, starts a new inspection/comparison, and requires normal review and explicit execution confirmation. History stores references and status only; it must not store SQL, row values, credentials, or filter literals. If an original profile/revision is available, it may be referenced and must be revalidated. If ad-hoc scope cannot be reconstructed without persisting sensitive filter values, the UI must ask the user to reselect that scope before comparison.

## Acceptance criteria

- [x] Data Sync distinguishes at least `not_started`, `committed`, `rolled_back`, and `unknown`; preflight/plan/context rejection is never recorded as an unknown write.
- [x] An unknown result is emitted only after the executor enters a phase where writes may have reached the target and commit/rollback cannot be proven.
- [x] Backward-compatible migration/history decoding preserves older records and presents interrupted in-flight runs as unknown without asserting that data was applied.
- [x] History records contain enough stable endpoint/profile references to reopen the ordinary Sync flow, while excluding SQL, row values, secrets, and unreviewed execution payloads.
- [x] The unknown-run action performs fresh connection/schema validation and comparison; changed or missing profile revisions require re-selection/review. It never reuses or executes the old plan.
- [x] A failed or cancelled reconciliation leaves the run fenced. A successful reconciliation displays current differences and still requires the normal new-plan review/confirmation path.
- [x] Rust tests inject preflight rejection, confirmed rollback, commit response loss after commit, commit response loss before commit, and rollback failure; history state matches only the evidence actually available.
- [x] Frontend journey tests cover disabled execution while unknown, failed recompare, successful fresh compare, changed profile revision, and late/stale compare or cancel responses.
- [ ] PostgreSQL and MySQL WDIO journeys use controlled test-only fault injection to produce an unknown commit result, verify that the original operation is not replayed, and confirm the fresh compare/readback path. Specs are ready; independent Tester run is pending.
- [ ] Host/driver/UI focused checks, changed-core coverage ≥80%, formatting, and `git diff --check` pass. Focused checks and formatting pass; exact coverage percentage is not measurable because no Rust coverage tool is installed.

## Coder validation

- `pnpm exec vitest run src/windows/data-sync/__tests__/DataSyncWindow.test.tsx src/components/migration/__tests__/MigrationRunHistoryDialog.test.tsx --reporter=dot`: 45 passed.
- `pnpm exec tsc --noEmit --pretty false`: passed.
- `cargo test -p datazen --lib data_sync::execute::tests -- --test-threads=1`: 26 passed.
- `cargo test -p datazen --lib commands::history::tests -- --test-threads=1`: 5 passed.
- `cargo test -p datazen --lib commands::sync::tests -- --test-threads=1`: 27 passed.
- Full Host `cargo test -p datazen --lib -- --test-threads=1`: 1784 passed, 87 failed, 3 ignored. Failures were environment-bound local listener permission errors and existing AI HTTP fixtures; all three focused migration modules passed.
- `pnpm tauri:build:webdriver`: frontend build, TypeScript check, and webdriver Rust binary compilation passed; macOS bundling failed only at `bundle_dmg.sh` (DMG packaging is explicitly out of scope).
- `rustfmt --edition 2021 --check` on changed Rust files and `git diff --check`: passed.
- WDIO was not started; the independent Tester owns the WDIO lane. The webdriver binary exists at `/Users/flyxl/code/datazen/.worktrees/datazen-migration-navicat/target/cargo-wt/debug/datazen`. Port 4445 has no listener; process enumeration is restricted in this environment, and this Coder did not launch the app.
- The new PG/MySQL spec has four cases (commit acknowledgement lost before/after server commit), pages comparison rows via `firstCursor`, captures original settings and restores them on success/failure, attempts old-plan replay before UI recovery and checks `not_started` plus target readback, asserts the unknown fence and disabled execute action before the new comparison, then verifies the fresh compare/readback. It uses unique table names and direct `DROP TABLE` cleanup; it does not call shared PG reset/bootstrap scripts.
- A focused TypeScript compile of the new spec emitted only pre-existing errors in `e2e/helpers.ts` and `e2e/lib/screenshotTrace.ts`.
- No per-row old-run commit inference was added. Recovery is a new inspect/compare only.

## Boundaries

- Do not infer whether individual rows from the old run committed; ordinary migration history does not retain row images or operation manifests.
- Do not automatically retry, resume, or mutate data from an unknown run.
- Do not change Data Transfer checkpoint/resume semantics or Schema Diff DDL rollback semantics.
- Preserve the shared migration-history API's existing meaning for Transfer and Schema Diff, or introduce a backward-compatible Sync-specific field rather than redefining shared outcomes.
- Do not persist ad-hoc filter literals merely to reconstruct a run. Require user reselection when those values are unavailable.

## Tester

Pending a fresh independent Tester after Coder handoff. The Tester must inspect the full state transition, independently rerun focused checks and PG/MySQL WDIO journeys, and file any defect before reporting `TEST_DONE`.
