# Data Sync table-level select-all across pages — bugs

## migration-sync-select-all-BUG-001 — P1 — clearing a table scope drops default-selected rows on unloaded pages

- **Status:** 待修复
- **Description:** Clearing an operation scope after paging through a comparison restores explicit selection only from the currently loaded page. The server then receives explicit keys for that page and silently omits default-selected rows on pages that were never loaded.
- **Reproduction:**
  1. Compare a matched table with at least two INSERT changes and a page size smaller than the row count.
  2. On page 1 choose `All inserts`.
  3. Navigate to page 2 and choose `Clear inserts`.
  4. Navigate back to page 1, then continue to SQL preview.
- **Expected:** Clearing the scope restores the normal default selection across the complete server-owned comparison. Both INSERT keys remain selected when INSERT is enabled.
- **Observed:** The preview request contains only the key from the currently loaded page (`[{ sourceTable: "users", targetTable: "users", operation: "INSERT", key: [2] }]`); key `[1]` from the unloaded page is omitted.
- **Evidence:** Tester journey `[tester] restores default selection across every page after clearing a table scope` in `src/windows/data-sync/__tests__/DataSyncWindow.test.tsx` fails at line 588. Independent focused run: `1 failed, 31 skipped`; full related run: `8 files passed, 1 failed; 52 passed, 1 failed`.
- **Impact:** A user can execute an incomplete synchronization without an error after clearing a cross-page scope. The loss is silent because the UI does not materialize or revalidate the unloaded default-selected rows.
- **Recommendation:** Keep the clear operation server-owned by representing the resulting default selection as a validated scope/exclusion contract (or add an explicit server-side default-selection scope). Do not reconstruct it from `table.rows`, which is only the current page.
