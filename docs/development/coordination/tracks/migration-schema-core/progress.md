# migration-schema-core

Phase: PASSED

Branch: codex/migration-schema-core
Worktree: /Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-core
Coding commit: `f6a1b473` (`feat(schema-diff): bind reviewed plans and enforce dependency-safe deployment`).

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

## Independent tester 1 — 2026-09-11

Phase: FAILED

A. Reviewed all 15 changed files against F06/F07/F09. Frozen plan exact equality, one-shot mutex consume, pool/session/config binding and snapshot comparison are present. Added concurrent consumption and changed-pool tests: pass. Physical aliases/DDL lock/full object metadata remain explicitly deferred. Found concrete PK-nullability ordering and selection-closure defect (BUG-001).

B. Independently reran coder suites: Rust 63/63; frontend 37/37 in 6 files; `tsc --noEmit` passed. No reliance on coder results. Driver injection restored after each cargo run. No dependency install or main-checkout modifications.

C. Added two PK-nullability regressions, concurrent-plan and pool-change regressions, and a continuous deployment-panel edit/transaction/confirmation/result journey. Frontend now 38/38. V8 line coverage before → after: panel 66.66 → 100%; window 33.73 → 33.73%; command wrapper 75.86 → 75.86%; all three 39.08 → 40.14%. Gate remains failed; no fabricated Rust coverage percentage. Rust logic review plus tests covers registry acceptance/rejection/replay/concurrent consumption, but IPC persisted-readonly/require-rollback branches and real production transaction errors remain insufficiently exercised for ≥80% claim.

Real database confirmation: isolated PostgreSQL transaction reproduces exact generated SQL ordering failure (`column "id" is in a primary key`); reversed operation control succeeds. Both rollback/connection close remove temporary tables. This is SQL/database validation, not desktop E2E.

### E2E registration

- `packages/drivers/postgres/e2e/schema-primary-key-nullability.ts`: 【留待 R 回归】 after BUG-001 fix; exact track WebDriver build, isolated app data, loopback PG and `dz_mig_0910_schema_src/tgt`. Covers create desired/current snapshots → prepare → deployment → replay refusal → empty post-deploy diff. Uses unique tables and cleans only owned fixtures.
- Desktop E2E not executed in this failed round: the newly reproduced backend defect prevents the desired successful journey. Do not count the registered spec or SQL probe as a desktop pass.

D. TEST_FAILED; BUG-001 and BUG-002 require correction and fresh tester. No business code changed by tester; reviewed.rs edits are test-only.

Final Rust rerun with all new regressions: 65 passed, 2 failed (both BUG-001 reproductions), 0 ignored. Final frontend typecheck passed; `git diff --check` passed.


## Repair round 1 — 2026-09-14

Phase: READY_FOR_TEST

- Rescuer startup: assigned worktree and codex/migration-schema-core confirmed; clean at 731a2adb. No prior uncommitted edits overwritten.
- BUG-001 corrected via DropPrimaryKey → SetNullable(true) edge restricted to the old primary-key columns. Existing two failing tester regressions pass; additional old/new key replacement test protects acyclicity, tightening and unrelated columns.
- BUG-002 corrected with nine full production-window journeys plus command requirement/cancellation branches. Wizard stays real, including objects, comparison, plan, deployment panel and footer; only endpoint and external I/O boundaries mocked.
- Final self-validation: injected basic-driver Host Rust schema_diff 68/68; Vitest 49/49 in 7 files; tsc --noEmit pass; git diff --check pass.
- Exact V8 command remains tester command: three included production files, no exclusions or reduced gates. Lines 93.30%, statements 89.80%, branches 84.95%, functions 85.36%; Window lines 92.27%, DeployPanel 100%, commands 100%.
- No main checkout, shared driver API, locale or generated source committed. No dependency installation. Driver injection restored.
- Fresh tester must rerun all phases and execute registered exact-binary PG desktop E2E. This self-validation is not TEST_DONE; no Rust percentage or desktop pass claimed.

## Independent tester 2 — 2026-09-14

Phase: PASSED

- A. Independently reviewed the complete `2c0270ec..b0458072` production diff against F06/F07/F09. The old-PK-column-only edge orders `DropPrimaryKey` before nullable relaxation without creating the replacement cycle; dependency closure removes the affected relaxation when destructive PK removal is excluded and preserves unrelated operations. Reviewed-plan equality, one-shot atomic consumption, session/pool/effective-config binding, persisted/runtime readonly checks, target snapshot revalidation, backend rollback requirements, and matching production/test deploy status classification are present. Physical server identity, DDL locking and full-object metadata remain the documented later shared contracts rather than claims in this wave.
- B. Independently reran the injected basic-driver Host Rust schema-diff suite: 68 passed, 0 failed, 0 ignored. Independently reran the seven selected frontend files: 49 passed, 0 failed. `npx --no-install tsc --noEmit` and `git diff --check 2c0270ec..HEAD` passed. Driver injection restored cleanly.
- C. Independently measured the exact three-file V8 scope with unchanged thresholds: lines 93.30% (265/284), statements 89.80% (282/314), branches 84.95% (209/246), functions 85.36% (70/82). Per file: `SchemaDiffWindow.tsx` lines 92.27%, branches 83.25%, functions 80.64%; `SchemaDiffDeployPanel.tsx` lines 100%, branches 96.15%, functions 100%; `schemaDiff.ts` lines 100%, branches 88.23%, functions 100%. Existing tester journeys meaningfully cover the identified branches, so no redundant test was added in this round. Rust percentages are not fabricated; branch/path review and the 68-test suite were used for Rust verification.
- D. Built the exact track application through `pnpm tauri:build:webdriver` with basic drivers and this track's isolated Cargo target. Ran `packages/drivers/postgres/e2e/schema-primary-key-nullability.ts` against that exact `.app`, port 4477 and `e2e/.app-data-schema-retest2`, using only loopback PostgreSQL and `dz_mig_0910_schema_src/tgt`: 1 passed. The journey created the desired/current PK-nullability mismatch, prepared and deployed the reviewed plan, confirmed committed status, rejected replay, and confirmed an empty post-deploy diff. Both unique tables were removed; post-run checks found zero matching fixtures in both databases and the WebDriver port was closed.
- Final result: TEST_DONE. BUG-001 and BUG-002 are independently verified fixed; this track is ready to merge.
