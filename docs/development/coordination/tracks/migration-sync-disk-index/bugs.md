# Bugs

## migration-sync-disk-index-BUG-001

- **Severity:** P1 (data-integrity / review-gate)
- **Status:** 已修复，CLOSED（待独立复测）
- **Description:** `ComparisonStore::summaries()` accepts a corrupt row frame prefix. It validates the manifest index and row file total length, but does not read and validate each indexed frame's length prefix. A corrupted row file can therefore produce a successful table summary while the page/load paths fail later (or, for some same-length payload edits, continue with unverified content).
- **Reproduction:**
  1. Create a large comparison so `ComparisonStore::from_comparison` spills to the indexed format.
  2. Open `table-0.rows` and increment byte 0 of the first 8-byte little-endian frame length, keeping the file length unchanged.
  3. Call `store.summaries()`.
  4. Observe that it returns `Ok` even though the first frame prefix no longer matches the manifest's `RowOffset.length`.
  5. Call `store.load()` or `store.load_table_page("users", "users", 0, 1)`; these paths reject the same file with `row frame length does not match its index`.
- **Evidence:** An independent temporary `[tester]` reproducer added only for the test run failed at `assert!(store.summaries().is_err())` with `summary accepted corrupt frame prefix`. The temporary source change was reverted immediately and is not part of the tester commit.
- **Impact:** The review summary path can expose metadata for a damaged comparison and allow the UI to proceed until a selected page is fetched. This violates the track's fail-closed corruption contract and leaves error behavior inconsistent between summary, page and full-load APIs.
- **Suggested fix boundary:** During indexed manifest validation or an equivalent summary validation step, verify every row file's indexed frame prefix and bounds without deserializing row payloads. Preserve the summary path's no-row-payload guarantee.
- **Fix:** `validate_manifest` now opens each indexed row file and verifies every 8-byte little-endian frame length prefix against its manifest offset/length entry. It reads no row payload, so summary/page memory semantics remain bounded. Summary, page and full-load paths now reject the same prefix corruption before exposing metadata or rows.
