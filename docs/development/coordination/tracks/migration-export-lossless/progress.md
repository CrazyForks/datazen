# Lossless export consumer track

## Scope

This track hardens the existing backend batch export formatter and the shared SQL dump literal contract. It keeps the existing bounded callback/file sink design and does not change export UI or transfer/sync planning.

## Implemented

- SQL INSERT batch export receives the live `Arc<dyn DatabaseDriver>` and calls `DatabaseDriver::format_sql_literal` for every value. The generic `data_sync::sql::format_literal` helper is no longer used by this export path.
- The driver API default binary literal is lossless hexadecimal `X'...'`. PostgreSQL overrides it with bytea hex input (`'\\x...'`); MySQL/MariaDB and SQLite emit `X'...'`.
- CSV bytes use the explicit `datazen:bytes:hex:<lowercase-hex>` marker. Text and timestamp values that begin with the reserved marker namespace are escaped with `datazen:text:` so a consumer can distinguish them.
- JSON bytes use a valid structured marker object: `{"$datazenType":"bytes","encoding":"hex","value":"..."}`.
- Existing scalar formatting, quote escaping, SQL transaction batching, callback streaming, and bounded file sinks remain in place.

## Acceptance gates

- [x] Export formatter tests cover bytes `00 ff fe`, quoted text, CSV marker escaping, valid JSON, and driver-owned SQL literals.
- [x] PostgreSQL, MySQL, and SQLite driver unit tests cover lossless binary literals and quoted text.
- [x] Driver API SQL dump tests pass, preserving the existing driver-owned literal call in the dump pipeline.
- [ ] Fresh independent tester confirms host, driver, frontend, formal build, and live export journeys.

## Independent tester round 1 — TEST_FAILED

Passed:

- Host Rust: `cargo test -p datazen --lib` — 1426 passed, 3 ignored.
- Export-focused Host tests: 14 passed.
- Driver API SQL dump tests: 12 passed.
- PostgreSQL/MySQL/SQLite driver suites: 103/88/50 passed.
- Frontend export, batch export, file, and chart export tests: 33 passed.
- TypeScript check passed.
- Formal `pnpm tauri:build:webdriver` passed and produced the webdriver app bundle.
- The export path contains no `from_utf8_lossy`; remaining matches are outside the exported row formatter (metadata/ADB decoding).
- Stream batching remains bounded by the 500-row query-stream batches, 500-row SQL INSERT batches, and 64 KiB sink buffer.

Blocked live evidence:

- The full contract matrix could not seed its read-only sync fixture because `E2E_PG_RO_PASSWORD` is absent in this environment. The PostgreSQL matrix therefore failed before reaching export.
- The SQLite-only contract run reached the app but timed out opening the seeded table after the existing `get_all_columns not supported by this driver` errors; it did not reach the export file assertion.

Open correctness defects found by source review are recorded as `EXPORT-LOSSLESS-004` through `EXPORT-LOSSLESS-006` in `bugs.md`. These prevent `TEST_DONE` for an unambiguous, cross-driver lossless export contract.

## Test evidence

- `cargo test -p datazen-driver-postgres --lib format_sql_literal_keeps_binary_bytes_lossless`
- `cargo test -p datazen-driver-mysql --lib format_sql_literal_keeps_binary_bytes_lossless`
- `cargo test -p datazen-driver-sqlite --lib format_sql_literal_keeps_binary_bytes_lossless`
- `CARGO_TARGET_DIR=/tmp/datazen-target-export-lossless cargo test -p datazen --lib commands::export::tests` (14 passed)
- `cargo test -p datazen-driver-api --lib sql_dump` (12 passed)

Generated driver files and Cargo.lock injection noise are not part of this track.
