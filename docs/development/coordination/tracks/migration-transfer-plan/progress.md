# migration-transfer-plan

- Phase: FAILED
- Branch: codex/migration-transfer-plan
- Worktree: `.worktrees/datazen-migration-transfer-plan`
- Base: `codex/migration-navicat` @ `8da0403c`
- Implementation commit: 15b54573
- Tester commit: 0fdff186

## Tester result

- Phase B/C/D completed independently.
- Host Transfer filter: 47 passed, 1 failed. The failure is recorded as `migration-transfer-plan-BUG-001`.
- Plan contract AppState tests passed for opaque plan issuance, normal execution, one-shot consumption, changed driver/schema fail-closed, changed read-only fail-closed, execution failure consumption, invalid selection, and unknown plan.
- Frontend Transfer tests: 25 passed; targeted changed-file coverage is `src/windows/data-transfer/DataTransferWindow.tsx` 85.75% statements / 80.00% branches / 91.89% functions / 88.12% lines and `src/commands/transfer.ts` 100% statements / 66.66% branches / 100% functions / 100% lines.
- TypeScript check passed.
- Driver unit tests passed: PostgreSQL 101, MySQL 86, SQLite 46.
- No WebDriver run: this contract was independently covered through the real Host AppState command path and existing UI journey tests; no separate desktop-only path was needed to reproduce the reported failure.

## Implemented

- Preview now captures a server-owned opaque `planId`; the private plan binds the complete TransferJob, resolved source/target relation identities, source/target schema fingerprints, driver types and protocol versions, target read-only state, and the preview execution gate.
- Execution accepts only `TransferRunRequest` (`planId`, a validated subset of planned source tables, destructive confirmation, and an optional cancellation token). It no longer accepts a client replacement job, mapping, DDL, SQL, or row payload.
- Execution revalidates live sessions, driver identity/protocol, target read-only policy, and both endpoint schema fingerprints before atomically consuming the plan.
- Plans expire after 15 minutes, are one-shot once claimed, and remain unavailable after any execution result including unknown commit/rollback outcomes. Expired, stale, blocked, or reused plans return a concrete re-preview error.
- Run request payloads deny unknown fields so legacy/job-shaped replacement payloads fail closed during deserialization.

## Self-validation

- `CARGO_TARGET_DIR=target/cargo-wt pnpm_config_verify_deps_before_run=warn cargo test -p datazen --lib data_transfer`: 42 passed.
- `npx vitest run src/commands/__tests__/transfer.test.ts src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx`: 22 passed.
- `npx tsc --noEmit`: passed.
- `git diff --check`: passed.
- No formal WebDriver run; this contract changes the execute IPC payload and requires independent Tester coverage before integration.

## BUG-001 repair

- 修复提交：见本分支最新 `fix(data-transfer): align immutable plan fingerprint scope` 提交。
- Preview 与 execution 现在通过同一 `participating_tables` helper 仅纳入 preview 时 enabled 的 mapping；disabled existing/unmapped relation 不进入任一阶段的 schema fingerprint。
- 新增业务单测覆盖 disabled relation schema 变化不会改变计划指纹；原失败的 disabled existing target AppState journey 现已通过。
- 修复后自验：Host Transfer 49 passed；前端 Transfer 25 passed；`npx tsc --noEmit` passed；`git diff --check` passed。

## Independent Tester Round 2 (2026-09-17)

### A. Code review

- Reviewed `plans.rs` and `exec.rs` repair delta. Preview and execution now use the same server-side `participating_tables` enabled mapping scope; disabled existing/unmapped relations cannot change the plan fingerprint. Enabled source/target schema changes still invalidate before target writes.
- Confirmed `TransferRunRequest`, `TransferRunSelection`, and `TransferRunOptions` deny unknown fields. Client replacement fields (`job`, `sql`, `ddl`, `mapping`, `rows`) are rejected during deserialization. No Host database-family branch was introduced.
- Intentional contract boundary remains: dotted schema names fail closed because the current string relation contract cannot represent them unambiguously.

### B. Independent rerun

- Host `data_transfer`: 50/50 passed, including the original disabled-existing-target BUG-001 journey, enabled schema/driver stale rejection, read-only rejection, unknown/expired/one-shot plan behavior, invalid selection and failed execution consumption.
- Frontend Transfer tests: 25/25 passed; `npx tsc --noEmit` passed.
- Targeted changed-file coverage: `DataTransferWindow.tsx` 85.75% statements / 80.00% branches / 91.89% functions / 88.12% lines; `transfer.ts` 100% / 66.66% / 100% / 100%. The added payload rejection test passed 1/1.
- Driver tests: PostgreSQL 101/101, MySQL 86/86, SQLite 46/46; SQLite transfer journey 1/1.
- Real driver probes on temporary `dz_mig_transfer_plan_retest_20260917`: PostgreSQL bound writes 1/1, PostgreSQL schema qualification 1/1, MySQL bound writes 1/1. Temporary databases were dropped after the run.
- Formal `CI=true pnpm_config_verify_deps_before_run=warn pnpm tauri:build:webdriver` passed and produced the tested bundle. The initial no-TTY dependency check was avoided by the repository-approved `CI=true` + `verify_deps_before_run=warn` environment; no `pnpm install` was run explicitly.

### C. Desktop suite

- `pnpm e2e:data-transfer` completed 8 spec files: 6 passed, 2 failed. Passing specs: data-transfer-window 8/8, data-transfer-type-mapping 1/1, data-transfer-mode-paths 10/10, data-transfer-journey 5/5, data-transfer-pg-mysql-journey 6/6, data-transfer-mysql-pg-journey 6/6.
- Reproduced the MySQL→PG type mapping failure independently with a grep-isolated rerun: DT-TYPE-MYSQL-PG-001 failed again after 15 seconds waiting for `data-transfer-target-type-active`.
- Reproduced the PG→MySQL 25,000-row failure in the full suite: DT-COMP-001 failed after 120 seconds waiting for `data-transfer-result`; the MySQL→PG 25,000-row case passed. Both failures are recorded in `bugs.md` as scope-adjacent Transfer core defects because the relevant UI/bulk execution code predates this immutable plan delta.

### D. Verdict

- `migration-transfer-plan-BUG-001` is independently verified and should be closed by the coordinator after this commit.
- This plan contract is correct across all required Host, API, driver and real database checks, but the optional formal Transfer suite exposed two existing Transfer core failures. Per Tester protocol the track remains `FAILED` until the coordinator transfers or resolves BUG-002/003; they are not caused by the latest immutable-plan repair.

## Boundaries for Tester

- Verify preview command plan issuance with source/target metadata and execution of a plan through the real AppState path.
- Verify stale schema, changed read-only policy, changed driver contract, unknown/expired/reused plan and invalid selection all fail before target writes.
- Verify the second execute attempt is rejected even after cancellation, rollback failure, commit failure, or a normal successful result.
- Confirm existing UI journey uses the returned `planId` and never sends a replacement job on execute.
- This wave does not add persistent profiles/run history, bounded snapshot scans, object dependency graphs, SQL-file targets, or parameterized filters.
