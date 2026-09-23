# Bugs — Data Sync tuple selection

## migration-sync-tuple-selection-BUG-001 — P2

- **Status:** Fixed by Coder; ready for independent retest.
- **Description:** The tuple-range refactor moved `SyncRecordset` and `SyncRecordsetBound` out of `data_sync::filter`, breaking existing imports through that public module path. The root `data_sync` exports remained available, but downstream code importing `datazen::data_sync::filter::{SyncRecordset, SyncRecordsetBound}` no longer compiled.
- **Fix:** `data_sync::filter` now publicly re-exports both recordset types from the internal recordset module. Root exports and tuple types remain intact. A regression test compiles the old import path and verifies type identity through assignments to the root exports.
- **Verification:** `cargo test -p datazen --test data_sync_public_api` (1 passed from an external integration-test crate), `cargo test -p datazen --lib data_sync::filter::tests` (14 passed), and `cargo test -p datazen --lib commands::sync::` (66 passed). Fresh Tester retest pending.
