# migration-transfer-plan

- Phase: READY_FOR_TEST
- Branch: codex/migration-transfer-plan
- Worktree: `.worktrees/datazen-migration-transfer-plan`
- Base: `codex/migration-navicat` @ `8da0403c`
- Implementation commit: pending final commit

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
