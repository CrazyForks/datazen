# Track: migration-transfer-recordsets

- Phase: PASSED
- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-transfer-recordsets`
- Branch: `codex/migration-transfer-recordsets`
- Scope: validated per-table stable recordset/range selection for Transfer, shared preview/execute scope construction, immutable-plan binding, and UI editing.
- Constraints: single-column order/range in this wave; no OFFSET checkpoint or resume semantics; old mappings without recordset remain valid.
- Bootstrap: verified worktree, branch, and clean status before changes.

## Plan

1. Add strict serde model and source-scope builder with PK default, typed bounds, quoted identifiers, parameterized predicates, and limit validation.
2. Thread scope through inspect, preview, plan fingerprint, execution, and returned preview summaries.
3. Add mapping UI/editor, stale-preview invalidation, tests, and translations.
4. Run focused Rust/Vitest/type checks, restore generated noise, commit and report READY_FOR_TEST.

## Implementation

- Added strict `TransferRecordset`/`TransferRecordsetBound` serde models with backward-compatible omitted recordsets.
- Added a single `recordset::build_source_scope` path used by preview and execution. It validates source columns, defaults to one effective primary key, rejects missing/composite automatic keys, binds filter values before range bounds and limit, quotes the selected identifier, and rejects NULL/zero/overflow/non-finite bounds.
- Added canonical source-column typed bound conversion and interval validation. Integer text is checked against signed/unsigned source ranges without lossy number conversion; decimal, float, boolean, and text-like bounds are validated before SQL generation. Reversed intervals and equal intervals with an exclusive endpoint fail closed.
- Added source primary-key metadata and recordset editing to the mapping UI. The editor supports one ordered column, typed text bounds, inclusive flags, and a positive row limit without raw SQL. Mapping changes clear the opaque preview before another review.
- Bound recordset configuration into the immutable plan scope fingerprint and exposed parameterized recordset SQL in preview. Unscoped row counts are not shown as exact estimates when a recordset is active.
- Added Rust model/builder/preview/fingerprint/execution tests and a continuous frontend mapping→preview→edit→re-preview journey.

## Self-validation

- `CARGO_TARGET_DIR=target/cargo-recordsets node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib data_transfer`: **71 passed, 0 failed**.
- `npx vitest run src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx src/windows/data-transfer/__tests__/transferMappingView.test.ts`: **23 passed, 0 failed**.
- `npx tsc --noEmit`: passed.
- `cargo fmt --all -- --check`: passed.
- `git diff --check`: passed; generated driver/Cargo noise restored.
- Formal `CI=true pnpm tauri:build:webdriver` and a live PostgreSQL recordset journey were not run in this coder pass; an independent tester should cover them.

## Independent tester pass (round 2)

- Reviewed the typed bound resolver, shared preview/execute scope builder, filter/range placeholder ordering, SQL identifier quoting, immutable-plan fingerprint, old mapping compatibility, and UI state transitions.
- Added tester coverage for boolean/non-finite/NULL bounds, legacy mappings without recordsets, empty bound removal, endpoint inclusivity toggles, disabling a recordset, and the no-primary-key explicit-order journey.
- Focused Rust `data_transfer`: **73 passed, 0 failed**; focused frontend: **25 passed, 0 failed**; `npx tsc --noEmit`: passed.
- Scoped frontend coverage for `ColumnMappingEditor`, `DataTransferWindow`, and `transferMappingView`: **84.93% statements, 75.38% branches, 85.71% functions, 87.25% lines**.
- `cargo fmt --all`, `git diff --check`, and the formal `CI=true pnpm tauri:build:webdriver` passed. Generated driver/Cargo files were restored and the worktree was clean apart from the tester commit before handoff.
- Live PostgreSQL recordset smoke remains skipped because this environment has no `E2E_PG_RO_PASSWORD` or database fixture.

## Independent tester pass

- Focused Rust suite before tester additions: **65 passed, 0 failed**.
- Focused frontend Vitest: **23 passed, 0 failed**.
- `npx tsc --noEmit`: passed.
- Scoped frontend coverage (`DataTransferWindow`, `ColumnMappingEditor`, `transferMappingView`): **84.27% statements, 73.57% branches, 85.09% functions, 86.51% lines**. Branch threshold missed by 1.43 percentage points; `ColumnMappingEditor` lines were 76.56% because the new validation/error branches are not fully exercised.
- Formal `CI=true pnpm tauri:build:webdriver`: passed; generated driver/Cargo files restored afterward.
- Tester-added focused boundary tests initially reported **4 passed, 2 failed**, exposing BUG-001 and BUG-002. The fixes and additional typed-bound tests now pass in the full **71-test** Transfer Rust suite.
- Live PostgreSQL smoke was not run because no E2E database password/fixture was available in this tester environment.

## Fix pass

- Fixed BUG-001 by comparing canonical start/end values before SQL generation, including inclusive/exclusive equality semantics.
- Fixed BUG-002 by validating frontend text against the inspected source column type, preserving exact unsigned integer text when it cannot fit `i64`.
- Added focused coverage for equality, signed/unsigned integer range and malformed text, decimal/float validation, and lexical text bounds.
- Frontend Vitest remains **23 passed, 0 failed**; `npx tsc --noEmit` passed; generated driver/Cargo files were restored after the Rust run.
- Formal webdriver results remain inherited from the independent tester; live PostgreSQL smoke remains unavailable without a fixture.

## E2E registration

| Journey | Status |
| --- | --- |
| Mapping → enable recordset → select PK → enter inclusive bounds → preview → edit bound → old preview invalidated → re-preview | 【本机可执行】 covered by `DataTransferWindow.test.tsx` (25/25) |
| Start bound greater than end bound is rejected before preview/execute | 【本机可执行】 covered by `test_tester_rejects_reversed_bounds_before_query` |
| Integer/decimal/float/boolean/text bounds are type checked and overflow/non-finite values fail closed | 【本机可执行】 covered by recordset and frontend suites; live driver smoke still requires a fixture |

## Findings / bugs

- This wave intentionally supports one ordering column. Composite tuple bounds and driver-specific recordset syntax remain later parity work.
- Recordsets select the rows for one execution; the existing single-statement spool remains the execution path and no OFFSET checkpoint is persisted.
