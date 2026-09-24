# migration-sync-unknown-outcome-reconciliation

Phase: READY_FOR_TEST

- Coder follow-up commit: `d523eb3b` (`fix(sync): clarify unknown result and history outcomes`)

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
- [ ] PostgreSQL and MySQL WDIO journeys pass through fault injection, history, fresh comparison, and readback. Tester previously ran all four real-database cases: each reached injected unknown, then the generic retrying IPC helper stopped the journey. The spec now uses a one-shot JSON-envelope observer for both the first execution and old-plan replay. A fresh Tester must distinguish the resolved response payload from a native IPC rejection; BUG-002 remains unresolved until this real observation and full journey pass.
- [x] Unknown Data Sync results remain fenced and now show an explicit amber warning in the result step, never the green completion label (BUG-001 fix candidate; Vitest regression passes).
- [x] Shared history labels Transfer `partiallyApplied` explicitly with warning styling while keeping legacy `unknown` localized; Sync and Schema history values remain raw and unchanged.
- [x] Focused Host/UI tests, Host TypeScript, focused Sync Rust tests, and changed-line coverage for this patch pass. Whole-file V8 coverage for the two touched components still falls below global thresholds; see Coder validation for exact numbers. Independent prior changed-executable-line aggregate was 390/412 (94.66%) for the implementation before this patch; Rust line instrumentation was unavailable.

## Coder validation

- `pnpm exec vitest run src/windows/data-sync/__tests__/DataSyncWindow.test.tsx src/components/migration/__tests__/MigrationRunHistoryDialog.test.tsx --reporter=dot`: 48 passed, 0 failed.
- `pnpm exec tsc --noEmit --pretty false`: passed. `pnpm exec tsc --noEmit --project e2e/tsconfig.json --pretty false` still reports existing E2E type errors in unrelated helpers/specs and generated driver imports; filtering its output for `data-sync-unknown-outcome.ts`, `MigrationRunHistoryDialog`, and `DataSyncWindow.test.tsx` found no diagnostic in the changed files.
- `CARGO_TARGET_DIR=.worktrees/datazen-migration-navicat/target/cargo-wt cargo test -p datazen --lib commands::sync::tests -- --test-threads=1`: 28 passed. `data_sync::execute::tests`: 26 passed. `commands::history::tests`: 5 passed.
- Focused V8 coverage for `DataSyncWindow.tsx` and `MigrationRunHistoryDialog.tsx`: 10/10 changed executable TS lines covered (100%). Whole-file scoped metrics: 81.10% lines, 78.58% statements, 70.79% branches, 75.78% functions; the changed UI branches are covered, while the full files remain below configured statements/branches/functions thresholds.
- `pnpm exec prettier --check` on changed TS/TSX files, scoped `rustfmt --edition 2021 --check src-tauri/src/commands/sync/tests.rs`, and `git diff --check`: pass (rerun after final edit before commit).
- The E2E spec's initial execution and deliberate old-plan replay now use `invokeBackendOnce`, which performs one browser IPC call and serializes either the resolved value or rejection into a JSON string. A resolved `outcome: unknown` must pass the existing history/fence/recompare/readback assertions; an IPC rejection fails immediately. This prevents a retry from consuming or obscuring the original result; it does not change production execution semantics.
- Earlier pre-Tester baseline: the two focused UI suites passed 45 tests. This is superseded by the current Coder run above (48/48, including the Tester regression and new Transfer history cases).
- `pnpm exec tsc --noEmit --pretty false`: passed.
- `cargo test -p datazen --lib data_sync::execute::tests -- --test-threads=1`: 26 passed.
- `cargo test -p datazen --lib commands::history::tests -- --test-threads=1`: 5 passed.
- `cargo test -p datazen --lib commands::sync::tests -- --test-threads=1`: 27 passed.
- Full Host `cargo test -p datazen --lib -- --test-threads=1`: 1784 passed, 87 failed, 3 ignored. Failures were environment-bound local listener permission errors and existing AI HTTP fixtures; all three focused migration modules passed.
- `pnpm tauri:build:webdriver`: frontend build, TypeScript check, and webdriver Rust binary compilation passed; macOS bundling failed only at `bundle_dmg.sh` (DMG packaging is explicitly out of scope).
- `rustfmt --edition 2021 --check` on changed Rust files and `git diff --check`: passed.
- WDIO was not started; the independent Tester owns the WDIO lane. The webdriver binary exists at `/Users/flyxl/code/datazen/.worktrees/datazen-migration-navicat/target/cargo-wt/debug/datazen`. Port 4445 has no listener; process enumeration is restricted in this environment, and this Coder did not launch the app.
- The new PG/MySQL spec has four cases (commit acknowledgement lost before/after server commit), pages comparison rows via `firstCursor`, captures original settings and restores them on success/failure, attempts old-plan replay before UI recovery and checks `not_started` plus target readback, asserts the unknown fence and disabled execute action before the new comparison, then verifies the fresh compare/readback. It uses unique table names and direct `DROP TABLE` cleanup; it does not call shared PG reset/bootstrap scripts.
- The E2E project TypeScript check still has unrelated legacy diagnostics in shared helpers/specs and generated driver imports; no diagnostics were reported for the changed unknown-outcome spec after filtering.
- No per-row old-run commit inference was added. Recovery is a new inspect/compare only.

## Boundaries

- Do not infer whether individual rows from the old run committed; ordinary migration history does not retain row images or operation manifests.
- Do not automatically retry, resume, or mutate data from an unknown run.
- Do not change Data Transfer checkpoint/resume semantics or Schema Diff DDL rollback semantics.
- Preserve the shared migration-history API's existing meaning for Transfer and Schema Diff, or introduce a backward-compatible Sync-specific field rather than redefining shared outcomes.
- Do not persist ad-hoc filter literals merely to reconstruct a run. Require user reselection when those values are unavailable.

## Independent Tester — historical Phase A–D checkpoint before Coder follow-up


- **BOOTSTRAP:** Confirmed the assigned worktree, branch feature/migration-sync-unknown-outcome-retest, HEAD 1ded6911, local non-symlink node_modules, and no unrelated tracked changes before running tests. Read AGENTS.md, docs/development/subagent/tester.md, and this track's progress/acceptance criteria. The referenced post-review-hardening-plan.md is absent, so acceptance was checked against this track's progress.md; this is a process observation, not a product bug.
- **Review:** Independently reviewed all 18 files in 7b6d584926ba5996b9cf319ba5912abe0f0292b6..1ded6911, including outcome mapping, run-history persistence, stale-profile validation, write fencing, fresh compare recovery, webdriver-only fault injection, and the four-case PG/MySQL spec. No production code was modified.
- **Focused Rust:** data_sync::execute::tests 26/26 passed; commands::sync::tests 28/28 passed (including the Tester conversion regression); commands::history::tests 5/5 passed.
- **Vitest and typecheck:** The two relevant UI suites reported 45 passed and 1 failed out of 46. The new [tester] assertion reproduces BUG-001. tsc --noEmit --pretty false, rustfmt --edition 2021 --check src-tauri/src/commands/sync/tests.rs, and git diff --check passed.
- **Coverage:** The coverage material handed off reports 390/412 changed executable lines (94.66%), above the 80% target; this fresh run did not recompute that changed-line aggregate. I independently ran V8 coverage for DataSyncWindow.tsx with only the intentionally failing label assertion excluded: 41 passed, 1 skipped; 79.91% lines, 77.44% statements, 69.83% branches, 75.20% functions. That coverage command exited 1 because whole-file thresholds were unmet; these percentages are distinct from changed-line coverage. Rust line coverage instrumentation was unavailable.
- **Build:** CI=true pnpm tauri:build:webdriver produced a runnable .app; TypeScript and webdriver Rust compilation passed. Only bundle_dmg.sh failed, which is explicitly nonblocking under AGENTS.md. Build-generated Cargo.lock noise was restored.
- **WDIO:** Manually launched that .app with a unique private DATAZEN_DATA_DIR and ran only e2e/specs/data-sync-unknown-outcome.ts through one direct WDIO process. Result: 0 passed / 4 failed, no skipped DB cases and no timeout/auth/bootstrap failures. Each case reached the test fault boundary. The raw WDIO execute/async call at e2e/specs/data-sync-unknown-outcome.ts:197 ended with the generic "Execution did not start. Check the plan and endpoint context, then compare again."; the trace also recorded "Commit or rollback could not be confirmed. Compare current data before continuing." followed by repeated not_started errors for the same plan. The observed failure is at the command/helper boundary; available evidence does not distinguish a production IPC-contract issue from WDIO/helper retry behavior, so BUG-002 records that attribution as unresolved.
- **Real DB evidence and cleanup:** Readback verified PostgreSQL target values 20 after lost_after_commit and 10 after lost_before_commit; MySQL had the same results. Dropped only this run's six uniquely named dz_sync_uncertain_* tables; follow-up catalog checks returned zero fixtures in both PG databases and both MySQL databases. The WDIO per-process worker DB was dropped by teardown and verified absent. Test-created profile/connection IDs were absent from the private app data. Stopped the app, verified port 4445 had no listener, and removed the private app-data directory. Sanitized WDIO log remains at /private/tmp/datazen-sync-unknown-outcome-tester-20260924-wdio.log.
- **Tester additions:** test_tester_data_sync_error_conversion_keeps_not_started_and_unknown_distinct covers command-error outcome distinction. The UI regression test verifies that an unknown result cannot render a green successful-completion label; it fails on the current implementation as BUG-001.
- **Result at that checkpoint:** TEST_FAILED; this is the historical evidence that triggered the current Coder follow-up. It is superseded for BUG-001 and focused UI checks by the Coder validation above. BUG-002 remains open until the fresh one-shot WDIO retest below.

- **Coder follow-up checklist:** Rebuild the current Coder commit in a fresh Tester worktree and run only `e2e/specs/data-sync-unknown-outcome.ts` against PG/MySQL. For each of the four cases, verify the one-shot first execution yields a structured `unknown` response (or report a native rejection without retry), exactly one initial unknown run is present, explicit old-plan replay is `not_started`, target values remain 20/10, history action preserves the fence and opens a new compare, and fresh comparison shows the expected current difference. Never infer a per-row commit result or replay the old request. Independently rerun both focused Vitest suites and confirm the amber unknown result plus `partiallyApplied`/legacy `unknown` history labels.

## Fresh independent Tester — candidate efc2866b / code d523eb3b

- **BOOTSTRAP:** Fresh checkout at `/Users/flyxl/code/datazen/.worktrees/datazen-migration-sync-unknown-outcome-fresh-tester`, branch `feature/migration-sync-unknown-outcome-fresh-tester`, HEAD `efc2866b873cb0cc4591ffe7ef2a7f44a1d65d22`; initial tracked status was clean. `node_modules` was absent and installed as a local directory with `pnpm install --offline --frozen-lockfile` (726 reused packages, 0 downloaded, no symlink). The install hook emitted a Husky `.git/config` lock-permission line; generated drivers and built-in locales completed and pnpm exited successfully. Ran `node scripts/generate-builtin-locales.mjs` explicitly before tests.
- **Phase A source review:** Reviewed all six files in `66190e43..d523eb3b`, the Data Sync transaction outcome mapping and history persistence, one-shot execution guard, and the unknown-history fresh-profile/recompare path. No product defect found in static review. `docs/development/post-review-hardening-plan.md` is absent; acceptance is checked against this track's `progress.md`. No production files changed.
- **Tester-only coverage additions:** The WDIO journey now asserts exactly one persisted `unknown` history item for its unique profile after the one-shot old-plan replay. Added shared history assertions for raw Data Sync/Schema Diff labels and neutral Transfer `notRequired`, alongside the existing Transfer unknown/`partiallyApplied` warning checks. Phase B/C execution and changed-line coverage remain pending.
