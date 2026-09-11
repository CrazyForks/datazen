# migration-schema-core

Phase: READY_FOR_TEST

Branch: codex/migration-schema-core
Worktree: /Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-core
Coding commit: recorded in the follow-up progress commit after implementation commit creation.

## Implemented wave 1

- F06: directed operation prerequisites for table/column creation, key/index replacement and referenced-column changes. Selection closes over prerequisites and both halves of a replacement; excluded prerequisite never leaves an executable dependent. Cycles fail closed with an unsupported requirement.
- F07: type mapper now receives the current table; overrides match the resolved target table and exact column. Regression covers identical column/type in multiple tables with different overrides and reversed table order.
- F09: backend stores short-lived bounded one-shot reviewed plans (30 minutes / 128 retained plans). Exact submitted plan, target session, pool and effective identity must match. Re-reads current persisted readonly and target schema snapshots before execution, rejects requirements, enforces requested rollback with driver DDL atomicity and enabled transaction. Replay requires a fresh compare/prepare.
- Transaction failures: failed COMMIT or ROLLBACK reports unknown; confirmed rollback counts zero persisted statements; cancellation after autocommit changes reports mixed.
- UI forwards requireRollback and planId, disables invalid confirmation/rollback/requirements and completed-plan execution in both the actual wizard footer and the deploy panel.
- Split oversized plan module into 657-line implementation and separate tests.

## Self validation

2026-09-11:

- `CARGO_TARGET_DIR=/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-core/target/cargo-wt CARGO_BUILD_JOBS=3 node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib schema_diff --features driver-mysql,driver-postgres,driver-sqlite`: 63 passed, 0 failed. Initial build required the ignored empty Community resource directory `src-tauri/resources/builtin-ep`; created it, reran successfully. Wrapper restored Cargo injections.
- `npx --no-install vitest run src/windows/schema-diff src/lib/__tests__/schemaDiffConfirm.test.ts src/commands/__tests__/schemaDiff.test.ts`: 37 passed in 6 files.
- `npx --no-install tsc --noEmit`: passed.
- `git diff --check`: passed.
- No pnpm install, driver implementation change, real-database migration, desktop E2E or performance claim in this coder wave.

## Independent tester journeys

1. Replace PK and rebuild same-name index; verify drop precedes add/create and target normalized schema matches source.
2. Disable destructive changes and verify no replacement half remains; disable index operations before removing an indexed column and verify the dependent column drop is removed.
3. Prepare with two same-named columns and distinct target type overrides; reverse selected table order and verify stable table-local types.
4. Prepare, change target database/session/pool, then execute: reject without DDL. Prepare, flip saved readonly preference, then execute: reject.
5. Prepare, externally change a target column/index, then execute: reject and require a fresh plan. Mutate returned SQL or risk labels: reject. Replay consumed plan: reject.
6. Require rollback on nontransactional DDL, disabled transaction, or incomplete rollback plan: reject before writing.
7. Fault-inject COMMIT and ROLLBACK response failures; status must be unknown. Confirmed cancellation rollback counts zero; autocommit cancellation after writes reports mixed.
8. UI journey: rollback requirement + transaction toggle + unsupported target + result arrival keeps footer and panel execution gates consistent.

## Later shared contracts / limits

- Physical database identity from the driver is still required for aliases, alternate DNS and separate SSH tunnels. This wave binds the reviewed pool/config and rejects identical endpoint configuration independently of username/config id.
- Snapshot revalidation occurs immediately before deploy but does not lock external DDL between validation and execution. Atomic schema-version/lock support belongs in the shared driver contract.
- Existing TableSchema covers columns/PK/index/FK only, and current MigrationOperation still does not express FK/CHECK/table options/views/routines/triggers/sequences/drop table. Full-object snapshot, dependency and renderer capability contracts remain required for parity.
- Complete rollback enforcement is deliberately conservative; rollback SQL alone is not a data recovery guarantee.
- READY_FOR_TEST is coder completion only; independent tester must confirm before PASSED.
