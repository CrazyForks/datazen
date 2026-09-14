# migration-transfer-core

- Phase: READY_FOR_TEST
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
