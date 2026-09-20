# Data Sync source filter track

Status: implemented.

This track adds one structured filter per matched Data Sync table. The filter is
applied symmetrically to the source and target relation, so rows outside the
selected scope are excluded from both comparison and delete candidates.

The filter supports `and`/`or` groups with equality, inequality, range, `LIKE`,
`IN`, `IS NULL`, and `IS NOT NULL` conditions. Column names are validated against
both inspected schemas and values are bound through the driver parameter API.
The reviewed comparison response retains the filter, and the immutable plan
fingerprint includes it. Execution recomputes schema plus filter fingerprints,
so a plan cannot be reused for a different filter scope.

The UI exposes the filter editor from the Sync object mapping step. Changing a
filter clears the previous comparison and requires a fresh compare.

## Independent verification (2026-09-20)

- `cargo test -p datazen --lib` passed **1446 passed, 3 ignored**.
- Focused Rust suites passed: `commands::sync::` **28 passed** and
  `data_sync::` **114 passed**. The filter unit tests cover parameter binding,
  typed placeholders, `IN`, null predicates, binary markers, and the keyset
  SQL parameter order. The plan tests cover filter values in the relation
  fingerprint.
- Frontend Sync tests passed **45/45**; the broader component run passed
  **749/749**. `pnpm exec tsc --noEmit` passed.
- Formal `pnpm tauri:build:webdriver` passed, including frontend production
  build, injected basic drivers, Rust compilation, and macOS bundle creation.
- A live database journey was not rerun in this final pass because
  `E2E_PG_RO_PASSWORD` is unset and this environment has no dedicated
  source-filter WebDriver spec. The existing track record contains the prior
  PostgreSQL journey; it remains a required release gate for any change to
  the filter execution path. SQLite is intentionally rejected by the current
  V1 Data Sync family gate.
