# migration-transfer-core

- Phase: FAILED
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
