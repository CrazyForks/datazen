# Bugs

## migration-sync-bounded-BUG-001

- **Severity:** P1 (data-integrity / review-gate)
- **Status:** 已修复，复测通过
- **Description:** `ComparisonStore::validate_manifest` validates row/index/frame structure but does not validate the operation and unchanged counters stored in the manifest against the indexed row payloads. A damaged manifest can therefore make `summaries()` return inconsistent counts while `load_table_page()` and `load()` still expose the intact rows.
- **Reproduction:**
  1. Create a streaming comparison containing one `Insert` row for `counts -> counts` and finish the store.
  2. Edit `manifest.json`, changing the table's `"insertCount": 1` to `"insertCount": 0`, leaving the row and index files unchanged.
  3. Call `ComparisonStore::summaries()`.
  4. Observe that it returns `Ok` with `insert_count == 0`; the same store's page/full-load paths still return the inserted row.
- **Measured evidence:** The initial independent tester reproduced the failure.
  Repair commit `0e14e73c` recomputes operation counters from each indexed row
  payload while streaming. Durable regression commit `70c6e826` adds
  `manifest_operation_count_tampering_fails_closed`, which mutates only
  `manifest.json` and asserts that summaries, page reads, and full loads all
  reject the store. The fresh independent re-test passed ComparisonStore 14/14.
- **Impact:** The review preview can under-report or over-report inserts, updates, deletes, or unchanged rows after manifest corruption. The UI may present an incorrect review summary and selection affordance, violating the track's fail-closed manifest-corruption contract.
- **Suggested fix boundary:** During manifest validation, derive operation counts from indexed row payloads only when needed, or add a trusted per-table count/checksum record that can be verified without loading all row payloads. Summary, page and full-load paths should reject counter mismatches consistently.

- **Resolution:** `validate_operation_counts` streams one indexed frame at a
  time, verifies its framing and JSON operation, compares the derived counters
  with the manifest, and fails closed before any consumer path can return data.
