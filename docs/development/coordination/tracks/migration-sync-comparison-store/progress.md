# Data Sync comparison storage track

Status: implemented.

The reviewed Data Sync plan now owns a `ComparisonStore`. Comparisons up to the
8 MiB serialized threshold remain inline; larger comparisons are written to a
uniquely-created private temporary JSON file and reloaded only when plan
validation, SQL generation, or execution needs the server-owned comparison.
The old 64 MiB aggregate rejection in `compare_data_sync` is removed, while the
existing per-page and per-table comparison safety limits remain in force.

The IPC preview keeps the existing `tables: TableResult[]` contract so the
current review UI can continue to render and select rows. That preview is still
serialized and held by the client for the current run; this track bounds the
server plan registry and temporary file ownership, but does not add paginated
preview rows.

Plan cleanup is owner based: expired plans are removed during lookup/issue
retention, claimed plans are removed before writes, and the last
`ComparisonStore` reference deletes the temporary file after success or error.
The plan remains server owned; client selections contain only keys and cannot
replace the stored comparison, SQL, or mapping.

## Focused verification

- `cargo test -p datazen --lib commands::sync::comparison_store::tests`: **5 passed**.
- `cargo test -p datazen --lib commands::sync::plans::tests`: **6 passed**.
- Existing `cargo test -p datazen --lib commands::sync::tests`: **21 passed**.
- Coverage includes inline and spilled round trips, malformed files, cloned
  owner cleanup, expiry cleanup, and claim cleanup.
