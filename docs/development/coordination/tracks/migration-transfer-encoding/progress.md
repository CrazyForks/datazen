# Track: migration-transfer-encoding

- Phase: READY_FOR_TEST
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
