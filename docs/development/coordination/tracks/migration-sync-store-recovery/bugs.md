# migration-sync-store-recovery follow-up findings

## BUG-001 — `add_table` does not preserve non-empty rows

- Status: independent follow-up; not part of the comparison-store recovery change.
- Severity: low priority API-contract gap. Release disposition is tracked separately by the coordinator.
- Baseline: this behavior predates the recovery implementation; `StreamingComparisonStoreWriter::add_table` is unchanged at baseline commit `504dac5c`.
- Current call path: `src-tauri/src/commands/sync/apply.rs:204` calls `.add_table(mapping)`. That mapping comes from `inspect_data_sync_impl` and `classify_tables`, which only performs mapping/schema inspection and constructs `TableResult`s with empty `rows`. Therefore this current call path does not drop business comparison rows.
- Reproduction of the API gap: pass a `TableResult` with one or more `rows` directly to `StreamingComparisonStoreWriter::add_table`, then finish and load the store. `add_table` delegates to `begin_table`, which clears `table.rows`, and does not stream those rows with `push_row`; the persisted table has no supplied rows.
- Impact: a caller that supplies a non-empty `TableResult` to this API would silently lose its row changes. No such non-empty use is present in the current `apply.rs:204` path. This was not introduced by, and is not evidence of a failure in, the recovery track.
- Follow-up: address and test the API contract in a separate repair track. No production code was changed by this Tester.
