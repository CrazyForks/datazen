# Data Transfer resumability

Phase: `READY_FOR_TEST`

## Scope

Implemented the bounded, server-owned checkpoint slice for database Data Transfer:

- A cancelled or partial run can return an opaque `resumeToken`.
- The token binds the immutable plan's source boundary (schema plus filter/recordset fingerprint), target boundary, and effective table selection.
- Progress is a sorted set of fully committed source tables. No row offset, cursor, or client payload is persisted.
- Each resume token is single-flight. A token in an unknown commit/rollback path is invalidated and requires a fresh preview.
- Resuming skips only previously committed tables and starts the next table from the reviewed source scope in its own transaction.
- Successful completion consumes the token. Frontend IPC types and the result retry action pass the token through.

## Deliberate release boundary

This release slice supports database targets in `Data` mode, `Insert` write mode, and existing target tables. SQL-file output, structure phases, `create_new` mappings, and destructive write modes remain non-resumable; they continue to use the existing fail-closed behavior. SQL-file output remains atomic and must be regenerated after cancellation or failure.

## Validation

- `CARGO_TARGET_DIR=target/cargo-transfer-resume cargo test -p datazen --lib data_transfer`: 104 passed.
- `CARGO_TARGET_DIR=target/cargo-transfer-resume cargo test -p datazen --lib commands::data_transfer`: 28 passed.
- `CARGO_TARGET_DIR=target/cargo-transfer-resume cargo test -p datazen --lib workflow::migration`: 3 passed.
- Direct `rustfmt --edition 2021 --check` on changed Rust files: passed.
- `git diff --check`: passed.
- `npx tsc --noEmit`: unavailable in this checkout because `node_modules/.bin/tsc` is absent and the network is unavailable for `npx` package resolution.

Implementation commit will be recorded in the READY_FOR_TEST handoff.
