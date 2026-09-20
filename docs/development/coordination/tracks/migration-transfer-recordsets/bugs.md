# Bugs: migration-transfer-recordsets

## migration-transfer-recordsets-BUG-001 — P1 — reversed bounds are accepted

- **Status:** 待复测
- **Description:** `TransferRecordset` accepts a `start` value greater than `end`, builds a valid `WHERE` clause, and allows the transfer to proceed with an empty result. The preview does not fail closed, so a user can mistake a zero-row transfer for a successful bounded migration.
- **Reproduction:** Use a source table with an integer primary key and submit the UI-shaped payload `start: { value: "20" }`, `end: { value: "10" }`. Call `data_transfer::recordset::build_source_scope`.
- **Expected:** Validate the typed bounds before SQL generation and return a validation error when the lower bound is greater than the upper bound. Equality should remain valid only when both bounds are inclusive.
- **Actual:** `resolve_bound` only rejects NULL and non-finite numeric values; `build_source_scope` emits both predicates and returns `Ok`.
- **Evidence:** Tester test `test_tester_rejects_reversed_bounds_before_query` fails at `src-tauri/src/data_transfer/recordset.rs:377`; independent command: `CARGO_TARGET_DIR=target/cargo-recordsets-tester node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib data_transfer::recordset::tests` (4 passed, 2 failed).
- **Impact:** Wrong range selection can silently copy no rows. This violates fail-closed migration correctness.
- **Suggested fix:** Convert both bounds using the inspected source column type, compare the converted values with inclusive/exclusive semantics, and reject an inverted interval before issuing a source query.
- **Fix note:** The shared recordset resolver now compares canonical typed bounds before rendering SQL. Equal bounds are accepted only when both endpoints are inclusive.

## migration-transfer-recordsets-BUG-002 — P1 — frontend text overflow is not type validated

- **Status:** 待复测
- **Description:** The UI deliberately sends bound text to preserve precision, but the server keeps it as `Value::String` without validating it against the inspected source column type. An out-of-range integer text value is accepted into the preview and only fails later in a driver or can be coerced differently by a dialect.
- **Reproduction:** Use a source `INTEGER` column and submit `start: { value: "2147483648" }` from the recordset editor. Call `data_transfer::recordset::build_source_scope` with the inspected schema.
- **Expected:** Parse the text with the source type contract and reject values outside the source type range before preview/execute. The same validation must be used by preview and execution.
- **Actual:** `json_to_value` returns `Value::String("2147483648")`; `resolve_bound` accepts it and `build_source_scope` returns `Ok`, merely passing the source type to the placeholder formatter.
- **Evidence:** Tester test `test_tester_rejects_integer_bound_overflow_from_frontend_text` fails at `src-tauri/src/data_transfer/recordset.rs:407` under the same focused command (4 passed, 2 failed).
- **Impact:** Cross-driver range selection is not deterministic. PostgreSQL may cast and reject, while MySQL/SQLite may coerce text according to dialect rules; preview can claim an executable plan that is not valid for the selected source type.
- **Suggested fix:** Add one canonical typed-bound conversion/validation path keyed by `TableSchema` data type, preserving exact decimal/integer text until conversion, and use it in `build_source_scope` for both preview and execution.
- **Fix note:** Bounds now use one source-column keyed conversion path for signed/unsigned integers, decimal, float, boolean, and text-like types. Integer text is parsed without an intermediate JavaScript number and rejected before preview/execute when malformed or outside the source type range.
