# migration-transfer-unknown-outcome-fence

Phase: READY_FOR_TEST

- Task: stop Data Transfer after an unknown per-table transaction outcome, regardless of the continue-on-error preference
- Branch: `feature/migration-transfer-unknown-outcome-fence`
- Worktree: `.worktrees/datazen-migration-transfer-unknown-outcome-fence`
- Baseline: latest integrated `codex/migration-navicat` (includes main and Sync history integration)

## Confirmed defect

In database Data and Structure+Data execution, a statement failure followed by a rollback error or a commit error marks a table error string as `outcome UNKNOWN`. The executor then continues to later tables whenever `stop_on_error=false`. Checkpoint/token logic notices the unknown result only after the table loop; that is too late to prevent later writes in the same run. Table rows are also set to `0`, which presents an unknown amount as a confirmed zero, and run history does not distinguish confirmed rollback from an unknown outcome.

## Scope

Make transaction results machine-readable and fail closed at the table boundary. Keep the user preference to continue after a confirmed, successful rollback. An unknown commit or rollback outcome must stop all later writes unconditionally, carry an explicit unknown result with an unknown row count, and never issue or preserve a resume token for that run. The plan remains consumed. Surface the distinction in Data Transfer results and its migration-history summary without changing Sync or Schema Diff history semantics.

Confirmed standalone target DDL is tracked separately from the row transaction: if TRUNCATE or DROP+CREATE succeeds but later inspection, transaction start, or row work fails, report `partiallyApplied` with a known row count of zero (or preserve the unknown state if rollback itself is uncertain). In Structure+Data, a confirmed CREATE has the same partial outcome when the later data phase does not commit.

This track covers database Data and Structure+Data transactions. SQL-file output has no target database transaction and remains outside this change. Review the structure phase for any target DDL response-loss ambiguity; if it has a separate unsafe continue path, record it and either include the smallest compatible guard or create a follow-up blocker rather than silently claiming that path safe.

## Acceptance criteria

- [x] Per-table outcomes explicitly distinguish at least `committed`, `rolled_back`, `not_started`, and `unknown`; an unknown row count is represented as unknown rather than `0`.
- [x] After commit or rollback becomes unknown, the executor stops before touching the next table even when `stop_on_error=false`.
- [x] A statement failure with a confirmed successful rollback can continue when `stop_on_error=false` and stops when it is `true`.
- [x] Unknown outcomes cannot create or preserve a resume checkpoint; a prior checkpoint is invalidated and the old plan cannot be replayed.
- [x] Transfer table UI and Transfer history payload encode confirmed rollback, unknown, not-started, and confirmed destructive-preamble partial application distinctly. Shared history behavior for Data Sync and Schema Diff is unchanged; the merged shared history dialog labels `partiallyApplied` in amber.
- [x] Focused Rust tests simulate commit applied-but-response-lost, commit not applied-but-response-lost, rollback failure, confirmed rollback continuation, preflight failure, confirmed truncate/drop-create preambles followed by reinspection/begin failures, and checkpoint invalidation; assert later table calls and row counts precisely.
- [x] An order-sensitive self-overwrite test places a valid table before a conflicting selected table and proves validation rejects the run before any write/DDL. The history error mapper classifies the observer as `notStarted`, not unknown.
- [x] Destructive preamble modes cannot mint or accept a resumable checkpoint that could replay a known partial application.
- [x] PostgreSQL→MySQL and MySQL→PostgreSQL WDIO journeys use unique fixtures and prove commit acknowledgement loss after a real successful target commit; assert unknown rows, later-table stop, target readback, history, token invalidation, and plan/checkpoint replay rejection. The separate confirmed-rollback/continue journeys remain available for the independent Tester run.
- [x] Focused Transfer Rust tests pass and changed production executable-line coverage is ≥80%; focused UI, formatter, and diff checks pass. Host TypeScript still reports two unrelated Connection/Redis integration diagnostics, recorded below.

## Boundaries

- Do not add chunk-level large-table recovery here. Existing table-level checkpoints and the gap in bounded source reads are tracked separately.
- Do not retry an unknown table, infer which rows were committed, or reuse its old plan.
- Do not alter SQL-file atomic publication, Data Sync reconciliation, or Schema Diff DDL compensation.
- Keep continue-on-error for later tables only when the previous table's transaction outcome is known.

## Remaining gaps outside this track

- Large-table recovery remains separate work: the current transfer reads/spools at table scope, has no bounded row-chunk checkpoint or mid-table resume, and does not promise bounded memory for materializing fallback drivers. This track adds no offset or chunk cursor.
- Cancellation still does not guarantee interruption of a driver's active source query. That behavior and bounded chunk recovery need their own design, tests, and acceptance.
- Confirmed destructive DDL is reported as `partiallyApplied`; this track does not compensate or automatically reconcile it. DDL acknowledgement loss stays `unknown` and stops the run.

## Tester

Independent Tester report for candidate `750f65e2f5cc5772d4d1c0ac90cf41cb246a3aa1`, branch `feature/migration-transfer-unknown-outcome-fence`; tester branch `feature/migration-transfer-unknown-outcome-fresh-tester`, same HEAD. Final status: **TEST_FAILED**.

### Phase A — source review

- Reviewed the candidate diff and relevant Rust transaction/DDL/checkpoint/outcome paths, command/workflow mappings, Transfer result UI, shared migration history, focused tests, and both new direction-specific WDIO specs. No production logic defect was established by static review.
- The two WDIO specs create unique source/target table names and unique connection IDs, and their cleanup targets only those names/IDs. They do not call `setup-data-transfer-e2e.sh`, shared fixture reset helpers, `pnpm e2e`, or `node e2e/run.mjs`.
- Both specs prove a known primary-key conflict followed by confirmed rollback and later-table commit with `stop_on_error=false`. Neither creates commit/rollback acknowledgement loss, asserts unknown history, verifies token invalidation or plan non-replay, or checks an ambiguous target readback. A normal constraint failure is not evidence of an unknown transaction outcome. This missing live journey is registered as BUG-003.
- Independently verified the merged history behavior: `partiallyApplied` is rendered with Transfer’s localized label and amber warning only for Data Transfer. Sync and Schema Diff retain their raw neutral outcome behavior. Added a tester-only Sync history assertion; Transfer’s table result continues to use `transfer.tableOutcome.partiallyApplied`.

### Phase B — independent checks

- Focused Rust suite: `cargo test -p datazen --lib transfer -- --test-threads=1` with a private profile output and the serialized shared Cargo target: **151 passed, 0 failed**.
- Focused UI suites (`DataTransferWindow.test.tsx` and `MigrationRunHistoryDialog.test.tsx`): **44 passed, 0 failed**, including the new tester-only Sync neutrality assertion.
- Host type check exits 2 on two known unrelated integration diagnostics only: `ConnectionPage.tsx:718` (argument count) and `PanelContentRenderer.tsx:100` (`kvSlotState` not in `ConnectionViewProps`). No diagnostics were reported in changed Transfer files or the tester assertion.
- `rustfmt --check`, Prettier on changed TS/TSX/E2E/locales, and `git diff --check` pass. The focused UI whole-file coverage report is 84.97% lines, 71.84% branches, and 86.92% functions; the runner exits nonzero because the repository’s whole-file branch threshold is 75%. Rust changed production executable-line coverage independently measured at **354/409 (86.55%)**, above the 80% gate. Per-file changed-line counts: `commands/data_transfer/exec.rs` 30/41; command `mod.rs` 0/0; `data_transfer/execute.rs` 192/222; data-transfer `mod.rs` 0/0; model 16/16; sql_file 4/10; structure 93/100; workflow/migration 19/20.

### Phase C — coverage-driven test addition

- Added `[tester]` case to `src/components/migration/__tests__/MigrationRunHistoryDialog.test.tsx` to prove a Sync `partiallyApplied` value remains raw and neutral after Transfer’s warning label/style was introduced. Reran both focused UI suites successfully (44/44). No production source changed.
- The Rust changed-line gate is independently met. The whole-file Vitest branch threshold failure is reported separately and does not indicate changed-line Rust coverage shortfall.

### Phase D — live integration and disposition

- Required fresh `pnpm tauri:build:webdriver` was attempted. It stops in the Tauri `beforeBuildCommand` frontend build on the two Host TypeScript errors above, before Rust compilation or a candidate binary is produced. A retry with a Tauri config override hits the same script-level failure.
- Existing candidate-adjacent debug app artifacts are stale and invalid as evidence: the executable/app binary timestamps are 2026-09-24 15:15 UTC, while candidate HEAD was committed 2026-09-24 16:31 UTC; the worktree backing that target remains at baseline `23a7c8a5`. The old app was not launched.
- No WDIO spec ran; no app started; no private `DATAZEN_DATA_DIR` or DB fixture was created. Port 4445 was checked free. Cargo target lease was released after the build exited; WDIO port lease was never acquired. Thus there were no test fixtures or app-data artifacts to remove.
- Release blocker: no candidate-provenance live PostgreSQL→MySQL and MySQL→PostgreSQL commit-ack-loss journeys verifying stop-on-unknown, no old-plan replay, history outcome, resume-token invalidation, and target readback. BUG-003 records the E2E gap. The two safe confirmed-rollback journeys remain unrun because only a stale binary was available and the required candidate build is blocked.

Tester final status: **TEST_FAILED**. See `bugs/migration-transfer-unknown-outcome-fence-BUG-003.md`. Tester-only changes are committed separately from production implementation; no merge performed.

## Coder self-validation

- `CARGO_TARGET_DIR=/Users/flyxl/code/datazen/.worktrees/datazen-migration-navicat/target/cargo-wt RUSTFLAGS='-C instrument-coverage' LLVM_PROFILE_FILE=/private/tmp/datazen-transfer-final-%p-%m.profraw cargo test -p datazen --lib transfer -- --test-threads=1`: 151 passed, 0 failed. This includes commit response loss after/before effect, rollback failure, confirmed rollback continuation/stop, unknown stop, checkpoint invalidation, Structure+Data and destructive-preamble partial outcomes, self-overwrite prevalidation, Transfer history mapping, and workflow partial/unknown mapping.
- Changed production executable-line coverage, measured from the Transfer diff against `codex/migration-navicat` with `xcrun llvm-profdata`/`xcrun llvm-cov`: **354/409 (86.55%)**. Per-file: `commands/data_transfer/exec.rs` 30/41; `commands/data_transfer/mod.rs` 0/0; `data_transfer/execute.rs` 192/222; `data_transfer/mod.rs` 0/0; `data_transfer/model.rs` 16/16; `data_transfer/sql_file.rs` 4/10; `data_transfer/structure.rs` 93/100; `workflow/migration.rs` 19/20.
- Whole-file line coverage for the selected production files is **71.67% aggregate** and is separate from the changed-line gate: `exec.rs` 74.20%, command `mod.rs` 15.64%, `execute.rs` 86.30%, `model.rs` 91.19%, `sql_file.rs` 81.87%, `structure.rs` 92.60%, and `workflow/migration.rs` 23.03%. The low full-file values include unrelated IPC/history/workflow branches; the changed production lines exceed the track gate.
- Focused Host UI suites: `DataTransferWindow.test.tsx` plus `MigrationRunHistoryDialog.test.tsx`, 43 passed, 0 failed. The per-table partial label is backed by `transfer.tableOutcome.partiallyApplied: Partially applied` in the English sync domain and a focused Transfer result assertion; the merged shared-history test checks the partial label and amber warning style.
- `pnpm install --offline --frozen-lockfile` completed with the existing `node_modules` physical directory (not a symlink). Explicit `node scripts/resolve-drivers.mjs --codegen-only --drivers=basic` refreshed ignored driver-generated files without Cargo injection.
- Host `pnpm exec tsc --noEmit` still exits 2 with two unrelated integrated Connection/Redis diagnostics: `src/windows/connection/ConnectionPage.tsx:718` passes two arguments where the signature accepts at most one; `src/windows/connection/PanelContentRenderer.tsx:100` passes `kvSlotState`, absent from `ConnectionViewProps`. The generated `getDriverKvSlot` diagnostic was fixed by codegen. These files are outside the Transfer track and were not edited here.
- Prettier, `rustfmt --edition 2021 --check` on changed Rust files, and `git diff --check` pass. pnpm prints a non-fatal registry error only while checking for an available pnpm update; the invoked checks exit successfully.
- No WDIO, black-box, or live database tests were run by the Coder. The two direction-specific WDIO specs remain Tester-owned. Large-table bounded chunk/recovery and mid-query cancellation remain separate gaps; this track does not add chunk cursors or promise bounded memory.
- Self-overwrite validation is run against the full eligible selection before Structure+Data DDL or any table write, so a later conflicting table cannot turn earlier valid tables into a partially executed run. The data executor keeps the same guard for direct callers.
- SQL-file per-table results retain `outcome: None`; Transfer run-history mapping has an explicit compatibility path that preserves the pre-existing SQL-file partial outcome while this track changes only database-target outcomes.
- Final Coder status: `READY_FOR_TEST`; the Tester owns real PG/MySQL WDIO validation. The mainline TypeScript diagnostics above are not caused by this Transfer patch and remain a repository-level integration blocker to resolve outside this track.

## Ack-loss journey completion (2026-09-24)

This section supersedes the initial Tester `TEST_FAILED` and the earlier Coder notes saying no live database journeys had run. BUG-003 is addressed in this candidate and awaits a fresh independent Tester run.

- Added a debug/test-only, exact-target-table, one-shot fault seam. It is armed explicitly; it runs the real target driver's `commit` and synthesizes a lost acknowledgement only after that call returns success. This is an injected commit-ack boundary, not a real network partition. The production/release build has no arm/reset IPC or fault state.
- The two dedicated WDIO specs ran serially against the candidate app: `data-transfer-commit-ack-loss-pg-mysql.ts` (1 passing) and `data-transfer-commit-ack-loss-mysql-pg.ts` (1 passing). Both prove the request/response through the passive `VITE_E2E` command recorder, unknown outcome with `rowsInserted=null`, later table `notStarted`, committed target readback, Transfer run history `unknown`, absent resume token/UI action, and rejection of both the consumed original plan and old checkpoint request.
- Candidate binary built with `pnpm tauri:build:webdriver`; executable SHA-256: `c31f3f2b2350a6b8cbb92dddaa7c4dba64f350a75f9def69a71497cf536862f8`. The `.app` executable matched. The build produced the app and binary; only the excluded DMG packaging step failed.
- Focused Rust: 152 passed; changed production executable-line coverage: 742/814 (91.15%). Focused Transfer UI/command Vitest: 44/44. Host TypeScript: passed. Changed Rust `rustfmt`, changed TypeScript Prettier, and `git diff --check`: passed.
- Each spec creates unique source/target databases, tables, and connection IDs. MySQL tables explicitly use InnoDB. After both runs, PG and MySQL catalogs contained no `dz_dt_ack_%` databases; only those exact generated database names were dropped. The app was stopped, port 4445 released, and both private `/private/tmp/datazen-transfer-ack-loss-20260924*` app-data directories were removed.
- No Cargo build or WDIO process remains active. The shared Cargo target is released. An independent Tester should rebuild the fresh commit, verify binary provenance, run both acknowledgement-loss journeys and the existing confirmed-rollback/continue journeys serially, and report final status.

## Fresh independent Tester report — 2026-09-24 (candidate `595e34365e5df915ff63e7028269e5af23c8856f`)

Tester branch: `feature/migration-transfer-unknown-outcome-fresh-tester-20260924`.
Final status: **TEST_FAILED**. BUG-004 was registered and committed separately as `967b2162`; no production or candidate E2E code was modified by this Tester.

### Bootstrap and Phase A — review

- Confirmed the assigned worktree and branch, clean initial state, and exact candidate HEAD. Ran `node scripts/generate-builtin-locales.mjs`; `pnpm install --offline --frozen-lockfile` completed successfully. `node_modules` is a physical directory, not a symlink. pnpm's prepare step printed a non-fatal permission error trying to lock the main checkout's `.git/config`; dependency installation and generated-driver preparation nevertheless completed with exit code 0.
- `docs/development/post-review-hardening-plan.md` is absent in this candidate. Checked the implementation against this track's acceptance criteria and recorded that process limit rather than substituting an unrelated plan.
- Reviewed the changed Transfer transaction and structure paths, typed outcomes/row-count serialization, unknown-result checkpoint invalidation, history/workflow mapping, Transfer UI, VITE_E2E capture, WebDriver registration gates, dedicated config, and both directions' new and confirmed-rollback specs. No production logic defect was established by source review. The capture records only the real IPC request and returned response/error; it does not replace or stub `invoke`.
- Confirmed the arm/reset IPC definitions and registration use `cfg(all(debug_assertions, feature = "webdriver"))`; the internal exact-table one-shot seam is compiled under tests or that same debug/WebDriver combination and is consumed only after real target `commit()` returns `Ok`. It does not model a network partition.
- **BUG-004 (P1)**: both new acknowledgement-loss specs set a shared cleanup flag before database creation and unconditionally `DROP DATABASE IF EXISTS` for both timestamp-derived names. There is no pre-create catalog collision check or separate ownership flag set only after each successful `CREATE`. A collision or partial setup error can therefore drop a database the current run did not create. The defect and safe repair requirements are in `bugs/migration-transfer-unknown-outcome-fence-BUG-004.md`; both ack-loss specs were not run.

### Phase B — independent checks

- Focused instrumented Rust suite, serialized on the shared Cargo target: `cargo test -p datazen --lib transfer -- --test-threads=1` — **152 passed, 0 failed**.
- Focused UI/command Vitest (`DataTransferWindow.test.tsx`, `MigrationRunHistoryDialog.test.tsx`) — **44 passed, 0 failed**.
- Host TypeScript `pnpm exec tsc --noEmit` — **passed, exit 0**.
- LLVM coverage was independently merged and intersected with the candidate-vs-`codex/migration-navicat` zero-context diff; `#[cfg(test)]` code was excluded. Changed production executable lines: **387/445 = 87.0%**. Per file: command `exec.rs` 30/41; data-transfer `execute.rs` 225/258; `model.rs` 16/16; `sql_file.rs` 4/10; `structure.rs` 93/100; workflow `migration.rs` 19/20. `commands/data_transfer/mod.rs` adds only code excluded from the unit-test instrumentation build and therefore has 0 executable changed lines in this measurement; the WebDriver build below confirms both gated command names are present. The changed-production-line gate is above 80%.
- `rustfmt --edition 2021 --check` on all changed Rust files, Prettier on all changed TS/TSX/E2E/locale files, and `git diff --check codex/migration-navicat...HEAD` — **passed**. The pnpm registry update check prints a non-fatal fetch warning in this offline environment.

### Phase C — coverage-driven tests

- The candidate already contains focused Rust state-machine tests and the two VITE_E2E recorder tests; the 152 Rust and 44 Vitest cases passed independently. No redundant tester test was added. BUG-004 concerns destructive test-fixture ownership and requires a Coder repair before those live cases can safely execute.

### Phase D — candidate build and live journeys

- Ran `VITE_E2E=1 pnpm tauri:build:webdriver` from this worktree using the serialized shared Cargo target. Vite, Rust, and the debug WebDriver binary built successfully; `.app` was produced. The command's only failure was the subsequent `bundle_dmg.sh` step, which is excluded by project instruction.
- Fresh debug binary and `.app/Contents/MacOS/datazen` have the same SHA-256: `824be4302259b39a727b736be4e79524f16afbc7a0b7e42831388442f9d6edab` (built 2026-09-24 19:06:14 CST). The embedded bundle contains `/assets/DataTransferWindow-CxqT7CrE.js`; the corresponding fresh `dist` chunk contains `__dataTransferRunCalls`. The binary also contains both `arm_data_transfer_test_commit_ack_loss` and `reset_data_transfer_test_commit_ack_loss`, confirming the debug/WebDriver IPC registration is in this candidate artifact.
- **No WDIO journey was run.** The two ack-loss specs are paused by BUG-004 because their cleanup can delete an unowned database. Before considering the existing fixed-name rollback journeys, read-only catalog queries found both `dz_mig_0910_transfer_src` and `dz_mig_0910_transfer_tgt` already exist in MySQL (neither exists in PostgreSQL). Per the no-touch rule those shared MySQL databases were not opened, modified, or dropped, and the two old journeys are blocked. No app was started, no database was created/dropped, no private `DATAZEN_DATA_DIR` was created, `dz_dt_ack_` catalogs are empty, and port 4445 is free.
- Tester conclusion: **`TEST_FAILED` / Phase `FAILED`** pending BUG-004 repair and a fresh full run of both ack-loss and confirmed-rollback journeys with safe fixture ownership. The previously reported Coder WDIO passes are not independent Tester evidence.

## BUG-004 Coder repair complete

The fresh Tester registered BUG-004 after finding that the two ack-loss fixtures could drop same-named databases without proving this run created them. The report-only commits were fast-forwarded into this branch. This repair is limited to the two ack-loss fixtures and BUG-004 tracking: add exact catalog preflight, per-database ownership set only after successful `CREATE DATABASE`, and cleanup gated by that ownership; independently track admin configs/sessions so partial setup cannot widen deletion. No database journey will run in this Coder phase.

Both specs now check both exact catalog names before any create, mark each database owned only after that database's own create call succeeds, and drop only databases owned by this run. Admin and fixture configs/sessions have per-entry save/cleanup state, so partial setup cannot turn an unconfirmed database into a cleanup target. Host TypeScript, Prettier, and diff checks pass; full E2E-project typecheck reports existing harness errors but none in these two specs. No app was started and no database journey was run; ready for a fresh Tester.
