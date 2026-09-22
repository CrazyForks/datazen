# Track: migration-transfer-encoding

- Phase: READY_TO_MERGE
- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-transfer-encoding`
- Branch: `feature/migration-transfer-encoding`
- Scope: SQL-file target encoding and gzip output, preserving opaque file tokens, immutable plan fingerprints, and atomic publication.

## Implementation

- Added strict SQL-file encoding values `utf8`, `utf8Bom`, `utf16Le`, and `utf16Be`; UTF-16 output includes the corresponding BOM and uses lossless Rust UTF-16 encoding.
- Added strict `none`/`gzip` compression. Uncompressed targets require `.sql`; gzip targets require `.sql.gz`. Registration, preview, and execution reject unsupported suffixes and mismatched format combinations.
- Reworked the SQL-file staging writer to support plain and gzip streams while preserving sibling staging, flush/sync, atomic replacement, and old-destination preservation on failure/cancel.
- Bound normalized encoding and compression into the immutable SQL-file target fingerprint. Legacy payloads omit both fields and continue as UTF-8 without compression.
- Added profile persistence/validation, workflow profile resolution, TypeScript IPC models, English UI controls, preview invalidation on selection changes, and profile load/save wiring.
- Added Rust and UI journeys for UTF-16/gzip selection, unknown enum rejection, suffix safety, profile roundtrip, fingerprint drift, atomic gzip output, and roundtrip text containing SQL literals, Chinese/emoji, binary/hex/base64, decimal, date, and JSON values.

## Self-validation

- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib data_transfer`: **99 passed, 0 failed**.
- Focused SQL-file writer subset: **17 passed, 0 failed**.
- `npx vitest run src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx src/commands/__tests__/transfer.test.ts`: **38 passed, 0 failed**.
- `npx tsc --noEmit`: passed.
- `rustfmt --edition 2021 --check` on all changed Rust files: passed.
- `git diff --check`: passed.
- No Cargo.lock or generated source files changed. Formal WebDriver build/E2E remains for the independent Tester.

## Tester boundaries

- Verify actual native picker paths for `.sql` and `.sql.gz`, UTF-16 BOM/readback in the produced artifact, gzip decompression/readback, cancellation/failure preservation of an existing destination, and preview/execute rejection after format/path drift.
- Verify persisted legacy profiles without the new fields load as UTF-8/uncompressed and unknown profile values are dropped/rejected fail closed.

## Commit

- Implementation commit: `efaad36c`.

## Independent Tester verification (2026-09-22)

### A. Code review

- Reviewed every changed file in `efaad36c` and the coordination update `6934553d`: strict UTF-8/UTF-8 BOM/UTF-16LE/UTF-16BE and none/gzip enums, profile/workflow/IPC/UI propagation, extension matching, target-format fingerprinting, sibling staging, flush/sync, POSIX rename, and the Windows `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` branch.
- Confirmed legacy `SqlFileTarget` and `TransferProfile` JSON with omitted format fields normalize to UTF-8 and uncompressed output; unknown IPC/profile/workflow values fail closed. Confirmed SQL literals, Chinese, emoji, hex/base64 bytes, decimal, date, and JSON values remain intact in the exercised writer round trips.
- No business defect was found in the reviewed implementation. Existing compiler warnings are unrelated unused exports/dead code in the Host crate.

### B/C. Independent tests and coverage

| Suite | Coder report | Tester result |
| --- | ---: | ---: |
| Host Rust `data_transfer` | 99 passed | **101 passed, 0 failed** (includes 2 Tester compatibility/UTF-16+gzip tests) |
| Host Rust `commands::data_transfer` | 24 passed | **25 passed, 0 failed** (included in the 101-test run) |
| Host Rust `workflow::migration` | not reported | **3 passed, 0 failed** |
| Frontend Transfer Vitest | 38 passed | **38 passed, 0 failed** |
| TypeScript `tsc --noEmit` | passed | **passed** |
| Changed Rust `rustfmt --check` | passed | **passed** |
| Changed diff whitespace | passed | **passed** |

- Targeted V8 coverage with global thresholds disabled for the exact changed files: `DataTransferWindow.tsx` **82.32% statements / 70.97% branches / 87.05% functions / 84.59% lines**; `src/commands/transfer.ts` **100% / 56.25% / 100% / 100%**. The changed-file line/statement/function coverage is above 80%; uncovered branches are existing non-format error and alternate UI paths, while the new UTF-16/gzip selection, profile load, preview payload, and stale-preview invalidation paths are exercised.
- Added `test_tester_atomic_writer_round_trips_utf16_bom_inside_gzip`, `test_tester_legacy_transfer_profile_without_format_fields_is_compatible`, and `test_tester_workflow_accepts_extended_sql_file_formats`.

### D. E2E registration and environment limits

| ID | Journey | Status |
| --- | --- | --- |
| TE-UTF16-GZIP-001 | Native SQL-file picker selects `*.sql.gz`; choose UTF-16LE and gzip; execute a real source transfer; decompress and assert UTF-16LE BOM plus SQL literal/中文/emoji/hex/base64/decimal/date/JSON readback. Repeat UTF-16BE and assert `FE FF`. | **留待 R 回归**: requires the packaged desktop app, native picker, and a live source fixture. |
| TE-ATOMIC-002 | Existing `.sql`/`.sql.gz` destination survives cancellation and rendering failure; no sibling `.tmp` remains; successful run atomically replaces the old payload. | **留待 R 回归** for exact desktop cancellation/failure timing; Rust writer success/drop preservation paths pass. |
| TE-WINDOWS-003 | Windows native picker accepts `.sql` and `.sql.gz`; validate `MoveFileExW` replacement and failure preservation on NTFS. | **留待 R 回归**: this macOS environment cannot execute the Windows branch. |

- Formal WebDriver/native picker E2E was not run in this tester environment per the track boundary; no desktop pass is claimed. Creating an empty ignored `src-tauri/resources/builtin-ep` directory was required for the local Community Rust test build. `cargo fmt --all -- --check` remains blocked by pre-existing generated `src-tauri/src/driver_init.rs` ordering; changed Rust files pass direct `rustfmt --edition 2021 --check`.

## Tester verdict

- **TEST_DONE / PASSED / READY_TO_MERGE**. No `bugs.md` was needed. Tester changes and this progress record are committed separately from the implementation.
