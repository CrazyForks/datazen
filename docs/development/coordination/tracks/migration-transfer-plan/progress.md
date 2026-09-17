# migration-transfer-plan

- Phase: FAILED
- Branch: codex/migration-transfer-plan
- Worktree: `.worktrees/datazen-migration-transfer-plan`
- Base: `codex/migration-navicat` @ `8da0403c`
- Implementation commit: 15b54573
- Tester commit: pending final commit

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

## Boundaries for Tester

- Verify preview command plan issuance with source/target metadata and execution of a plan through the real AppState path.
- Verify stale schema, changed read-only policy, changed driver contract, unknown/expired/reused plan and invalid selection all fail before target writes.
- Verify the second execute attempt is rejected even after cancellation, rollback failure, commit failure, or a normal successful result.
- Confirm existing UI journey uses the returned `planId` and never sends a replacement job on execute.
- This wave does not add persistent profiles/run history, bounded snapshot scans, object dependency graphs, SQL-file targets, or parameterized filters.
