# migration-transfer-core

- Phase: PASSED
- Branch: codex/migration-transfer-core
- Worktree: .worktrees/datazen-migration-transfer-core
- Implementation commit: see commit containing this progress record; final hash supplied in coordinator handoff.

## Implemented (wave 1 correctness)
- F02 explicit projected column order; skipped/reordered/subset mappings cannot guess original ordinals.
- F04 bound INSERT values via default-unsupported Driver API and MySQL/PostgreSQL/SQLite implementations, accurate affected rows and transaction routing.
- F07 table-scoped IR type maps; F08 shared mapped CREATE projection for renames/skips/types/PK and preview/execution.
- F11 single source SELECT spooled before target writes, per-table transaction, rollback/error/cancel results. Stream metadata, width, completion and truncation checks precede writes.
- Private tagged spool encoding preserves JSON variants, binary, timestamp, decimal strings and IEEE float bits. File reader closes before cleanup.
- Driver decoders retain binary and exact decimals; PostgreSQL base-10000 numeric decoding avoids f64 and rust_decimal limits.

## Self-validation (2026-09-14)
- Host: injected basic driver wrapper, cargo test -p datazen --lib data_transfer: 33 passed.
- Driver lib: MySQL 86, PostgreSQL 100, SQLite 46 passed.
- Real isolated PostgreSQL and MySQL migration_bound_writes: 1 each passed. Full byte range, 65-digit decimal, escaped Unicode text, rollback/commit, affected row counts.
- Vitest: DataTransferWindow, transfer commands, transferLimitationsPrefs: 3 files / 16 passed.
- tsc --noEmit: passed. git diff --check: passed.
- No desktop E2E claim: independent tester required.

## Acceptance journeys
Projection skip/reorder/subset; same-name columns across tables with different IR; DDL rename/skip/PK projection; binary/decimal bound writes; second-batch failure rollback and next-table continuation; cancellation current-table rollback; malformed/truncated/missing/duplicate-end stream rejects before target writes; spool exact variant roundtrip.

## Remaining scope / handoff
This is wave 1, not Navicat parity. Materializing query_stream fallback is not bounded-memory; cancellation does not yet interrupt the driver's active source query. Physical target identity across aliases, immutable plan contracts, object coverage and persistent jobs remain later waves. Host export.rs and data_sync/sql.rs still have lossy Bytes consumers; coordinator owns cross-track follow-up before release. DDL transactional limits remain driver dependent.

## Independent tester round 1 (2026-09-16)

### A. Code review
- Reviewed all 29 implementation files, including Driver API forwarding/defaults, MySQL/PostgreSQL/SQLite decode and bound DML, source spool validation/cleanup, per-table IR mapping, mapped CREATE parity, transaction/cancel results, and the result UI.
- Confirmed the main wave1 paths use bound values and scan the source to completion before destructive target actions.
- Found `migration-transfer-core-BUG-001`: PostgreSQL schema-scoped endpoints read bare table metadata and merge same-named tables from other schemas.

### B. Independent rerun
- Host injected basic drivers: `data_transfer` 33/33 passed.
- Driver libraries: MySQL 86/86, PostgreSQL 100/100, SQLite 46/46 passed (plus their integration suites).
- Real isolated bound DML: PostgreSQL 1/1 and MySQL 1/1 passed against `dz_mig_0910_transfer_src`.
- Frontend: 3 files / 18 tests passed; `tsc --noEmit` passed.
- Regular `pnpm tauri:build:webdriver` completed and produced the exact tested app bundle under this track's `target/cargo-wt`.

### C. Tests added and coverage
- PostgreSQL exact-binary WebDriver journey: 1/1 passed against isolated source/target DBs; verified skipped source column, reordered physical target columns, bytea and 65-digit numeric values.
- MySQL exact-binary WebDriver journey: 1/1 passed with the same projection/reordering and LONGBLOB/DECIMAL checks.
- SQLite driver journey: 1/1 passed; verified projected bound copy, all byte values, exact decimal string, second-write failure rollback preserving existing target data, then successful commit.
- Added result UI tests for partial and cancelled terminal states; changed result-rendering lines are all exercised. Targeted `DataTransferWindow.tsx` coverage: lines 80.83%; whole-file statements 77.49%, branches 70.34%, functions 71.55%. The repository threshold command therefore exits 1 for historical untested code outside this patch; no higher or Rust instrumented percentage is claimed.
- Rust core changed paths were evaluated by branch-oriented unit/integration/E2E evidence; Rust coverage is not instrumented, so no fabricated percentage is reported.

### D. Verdict
- `TEST_FAILED` due to `migration-transfer-core-BUG-001`.
- Test additions are committed with the bug/progress record. A fresh tester must rerun the full suite after the coder fixes schema-qualified metadata resolution.

## BUG001 repair handoff (2026-09-16)
- Scope limited to schema-qualified Transfer metadata resolution and its PostgreSQL full-type query.
- All production Transfer table-schema reads now use one generic logical relation helper; source/target connection schema is propagated to metadata, source counts, preview, and execution.
- Latest self-checks: injected Host data_transfer 36 passed; driver libs MySQL 86 / PostgreSQL 101 / SQLite 46 passed; real PG schema regression 1 passed (mixed case + literal table dot); real PG/MySQL bound write journeys 1 each passed; SQLite journey 1 passed; Vitest 3 files / 18 passed; tsc and diff whitespace checks passed.
- BUG001 moved 修复中 → 待复测. No fresh desktop binary/E2E claim; independent Tester must rebuild and rerun.
- Intentional limit: dotted schema names fail closed pending structured relation IDs. Bare get_table_schema does not newly inherit a PG connection schema; Transfer now always supplies its explicit logical schema.table reference.

## Independent tester round 2 (2026-09-16)

### A. Code review
- Re-reviewed the full Wave 1 implementation plus BUG001 repair, including generic endpoint schema normalization, table-list filtering, inspect/count/preview/execute propagation, target writer metadata, PostgreSQL regclass quoting, driver bound writes, exact value decoders and spool/transaction paths.
- Confirmed no Host database-family branch was added. Explicit dotted schema fails closed because the current string relation contract cannot represent it; catalog/database remains independent.
- Found `migration-transfer-core-BUG-002`: the execution self-overwrite guard ignores schema and rejects a legitimate same-session/same-catalog transfer between different schemas when the table names match.

### B. Independent rerun
- Host implementation baseline: `data_transfer` 36/36 passed before the new regression test; the new dotted-schema no-write test passed 1/1, while the deliberate BUG002 repro failed 1/1 with the recorded validation error.
- Driver crates: MySQL library 86/86 (94 total non-ignored), PostgreSQL library 101/101 (114 total non-ignored), SQLite library 46/46 (52 total including the transfer journey and schema-object integration tests).
- Real driver probes: PostgreSQL schema qualification 1/1, PostgreSQL bound writes 1/1, MySQL bound writes 1/1, SQLite projected transfer/rollback journey 1/1.
- Frontend: 3 files / 24 tests passed; `tsc --noEmit` passed.
- Formal `pnpm tauri:build:webdriver` passed and produced the tested application bundle in this track's isolated Cargo target.

### C. Coverage and E2E
- Added meaningful UI journeys for unsupported pair explanation, endpoint-close events, setup inputs, object selection, inspect recovery, editable/copyable DDL, block warnings, cancellable execution and successful terminal status.
- `DataTransferWindow.tsx`: statements 86.32% (303/351), branches 80.22% (211/263), functions 91.74% (100/109), lines 88.81% (278/313); all thresholds passed.
- PostgreSQL exact-binary WebDriver journey 1/1 and MySQL journey 1/1 passed using the formal build; both verified skipped/reordered projection, physical target column reordering, binary bytes and exact 65-digit numeric/decimal values.
- Real PostgreSQL metadata regression passed with mixed-case schema, same-name tables in two schemas and a literal dot in the table name; full native type lookup returned only the selected schema column.

### D. Verdict
- `migration-transfer-core-BUG-001` is independently verified and closed.
- `TEST_FAILED` due to `migration-transfer-core-BUG-002`; the failing test is committed as the repair acceptance criterion. No business implementation was changed by the Tester.
- Temporary app data, WebDriver process, isolated PostgreSQL fixture databases, transient MySQL tables and Cargo/codegen side effects were cleaned.

## BUG002 repair handoff (2026-09-16)
- Phase: READY_FOR_TEST. BUG002 state: 待复测.
- Fixed only Transfer self-overwrite logical relation identity to include normalized schema, keeping catalog/database separate. Tester failing journey retained unchanged.
- Validation: Host transfer 39 passed; MySQL/PostgreSQL/SQLite libraries 86/101/46 passed; SQLite transfer journey 1 passed; frontend 3 files / 24 passed; tsc and whitespace checks passed.
- Fresh independent tester must rebuild and verify the cross-schema execution journey. No shared Driver API, Schema/Sync/export code changed.

## Independent tester round 3 (2026-09-16)

### A. Code review and BUG002 acceptance
- Reviewed the BUG002 production delta and its execution ordering. Self-overwrite compares dbSessionId, database/catalog, normalized schema and table before source schema lookup, target metadata or writes.
- The original Round 2 failing test now transfers one row across different schemas on the same session/catalog. The same normalized relation test rejects before target metadata and bound writes, and helper branches cover whitespace/empty schema, different catalog, different session and renamed table.
- Command entry points resolve explicit schema or connection-config fallback before inspection/execution; both identities therefore reach the same normalized comparison. Database/catalog remains an independent dimension and no Host driver-family branch was added.

### B. Independent rerun
- Host `data_transfer`: 39/39 passed, including the unchanged Round 2 repro and the pre-write fail-closed regression.
- Driver libraries: PostgreSQL 101/101, MySQL 86/86, SQLite 46/46. SQLite projected transfer/rollback journey: 1/1.
- Real isolated probes: PostgreSQL schema qualification 1/1, PostgreSQL bound writes 1/1, MySQL bound writes 1/1. Temporary databases were dropped after the run.
- Frontend: 3 files / 24 tests passed; `tsc --noEmit` passed.

### C. Coverage and desktop evidence
- `DataTransferWindow.tsx`: statements 86.32% (303/351), branches 80.22% (211/263), functions 91.74% (100/109), lines 88.81% (278/313). Existing tests already exceeded all thresholds, so this round added no redundant tests.
- Rust coverage is assessed by changed-branch evidence: all four identity dimensions, normalized equal/different schemas, legal cross-schema execution and fail-closed timing are exercised; no instrumented Rust percentage is claimed.
- Round 2's formal `pnpm tauri:build:webdriver` and exact PostgreSQL/MySQL desktop journeys remain the binary evidence. This round did not rebuild because the repair changes only the pure Host relation-identity guard; it independently reran the affected Host path plus real driver probes.

### D. Verdict
- `migration-transfer-core-BUG-001` remains closed; `migration-transfer-core-BUG-002` is independently verified and closed.
- `TEST_DONE`; track phase is `PASSED`. Wave 1 limitations listed above remain later-wave scope and are not represented as Navicat parity.
