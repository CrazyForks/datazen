# migration-sync-unknown-outcome-reconciliation

Phase: TEST_FAILED / fix required

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
- [ ] PostgreSQL and MySQL WDIO journeys use controlled test-only fault injection to produce an unknown commit result, verify that the original operation is not replayed, and confirm the fresh compare/readback path. Independent Tester ran all four cases against real databases; all reached the injected unknown commit, but the WDIO IPC call failed before the UI recovery steps (BUG-002).
- [ ] Host/UI focused checks pass. One explicit unknown-result UI assertion fails (BUG-001), and the independent whole-file V8 metrics are below configured thresholds. Changed executable-line coverage material reports 390/412 (94.66%); formatting and `git diff --check` passed. DataSyncWindow.tsx whole-file V8 coverage was 79.91% lines, 77.44% statements, 69.83% branches, and 75.20% functions; Rust line instrumentation was unavailable.

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


- **BOOTSTRAP:** Confirmed the assigned worktree, branch feature/migration-sync-unknown-outcome-retest, HEAD 1ded6911, local non-symlink node_modules, and no unrelated tracked changes before running tests. Read AGENTS.md, docs/development/subagent/tester.md, and this track's progress/acceptance criteria. The referenced post-review-hardening-plan.md is absent, so acceptance was checked against this track's progress.md; this is a process observation, not a product bug.
- **Review:** Independently reviewed all 18 files in 7b6d584926ba5996b9cf319ba5912abe0f0292b6..1ded6911, including outcome mapping, run-history persistence, stale-profile validation, write fencing, fresh compare recovery, webdriver-only fault injection, and the four-case PG/MySQL spec. No production code was modified.
- **Focused Rust:** data_sync::execute::tests 26/26 passed; commands::sync::tests 28/28 passed (including the Tester conversion regression); commands::history::tests 5/5 passed.
- **Vitest and typecheck:** The two relevant UI suites reported 45 passed and 1 failed out of 46. The new [tester] assertion reproduces BUG-001. tsc --noEmit --pretty false, rustfmt --edition 2021 --check src-tauri/src/commands/sync/tests.rs, and git diff --check passed.
- **Coverage:** The coverage material handed off reports 390/412 changed executable lines (94.66%), above the 80% target; this fresh run did not recompute that changed-line aggregate. I independently ran V8 coverage for DataSyncWindow.tsx with only the intentionally failing label assertion excluded: 41 passed, 1 skipped; 79.91% lines, 77.44% statements, 69.83% branches, 75.20% functions. That coverage command exited 1 because whole-file thresholds were unmet; these percentages are distinct from changed-line coverage. Rust line coverage instrumentation was unavailable.
- **Build:** CI=true pnpm tauri:build:webdriver produced a runnable .app; TypeScript and webdriver Rust compilation passed. Only bundle_dmg.sh failed, which is explicitly nonblocking under AGENTS.md. Build-generated Cargo.lock noise was restored.
- **WDIO:** Manually launched that .app with a unique private DATAZEN_DATA_DIR and ran only e2e/specs/data-sync-unknown-outcome.ts through one direct WDIO process. Result: 0 passed / 4 failed, no skipped DB cases and no timeout/auth/bootstrap failures. Each case reached the test fault boundary. The raw WDIO execute/async call at e2e/specs/data-sync-unknown-outcome.ts:197 ended with the generic "Execution did not start. Check the plan and endpoint context, then compare again."; the trace also recorded "Commit or rollback could not be confirmed. Compare current data before continuing." followed by repeated not_started errors for the same plan. The observed failure is at the command/helper boundary; available evidence does not distinguish a production IPC-contract issue from WDIO/helper retry behavior, so BUG-002 records that attribution as unresolved.
- **Real DB evidence and cleanup:** Readback verified PostgreSQL target values 20 after lost_after_commit and 10 after lost_before_commit; MySQL had the same results. Dropped only this run's six uniquely named dz_sync_uncertain_* tables; follow-up catalog checks returned zero fixtures in both PG databases and both MySQL databases. The WDIO per-process worker DB was dropped by teardown and verified absent. Test-created profile/connection IDs were absent from the private app data. Stopped the app, verified port 4445 had no listener, and removed the private app-data directory. Sanitized WDIO log remains at /private/tmp/datazen-sync-unknown-outcome-tester-20260924-wdio.log.
- **Tester additions:** test_tester_data_sync_error_conversion_keeps_not_started_and_unknown_distinct covers command-error outcome distinction. The UI regression test verifies that an unknown result cannot render a green successful-completion label; it fails on the current implementation as BUG-001.
- **Result:** TEST_FAILED; BUG-001 and BUG-002 require follow-up. Tester-only test additions and this report are ready to commit.
