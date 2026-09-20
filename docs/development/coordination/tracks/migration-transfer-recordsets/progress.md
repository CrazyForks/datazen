# Track: migration-transfer-recordsets

- Phase: READY_FOR_TEST
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
- Added source primary-key metadata and recordset editing to the mapping UI. The editor supports one ordered column, typed text bounds, inclusive flags, and a positive row limit without raw SQL. Mapping changes clear the opaque preview before another review.
- Bound recordset configuration into the immutable plan scope fingerprint and exposed parameterized recordset SQL in preview. Unscoped row counts are not shown as exact estimates when a recordset is active.
- Added Rust model/builder/preview/fingerprint/execution tests and a continuous frontend mapping→preview→edit→re-preview journey.

## Self-validation

- `CARGO_TARGET_DIR=target/cargo-recordsets node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib data_transfer`: **65 passed, 0 failed**.
- `npx vitest run src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx src/windows/data-transfer/__tests__/transferMappingView.test.ts`: **23 passed, 0 failed**.
- `npx tsc --noEmit`: passed.
- `cargo fmt --all -- --check`: passed.
- `git diff --check`: passed; generated driver/Cargo noise restored.
- Formal `CI=true pnpm tauri:build:webdriver` and a live PostgreSQL recordset journey were not run in this coder pass; an independent tester should cover them.

## Findings / bugs

- This wave intentionally supports one ordering column. Composite tuple bounds and driver-specific recordset syntax remain later parity work.
- Recordsets select the rows for one execution; the existing single-statement spool remains the execution path and no OFFSET checkpoint is persisted.
