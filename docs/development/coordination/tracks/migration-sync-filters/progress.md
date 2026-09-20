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

- Rust focused suites passed: `commands::sync::` 142/142 and `data_sync::` 114/114.
- Frontend Sync window and sync-plan tests passed: 32/32; `pnpm typecheck` passed.
- Formal minimal-driver WebDriver build passed with `pnpm tauri:build:webdriver:minimal`.
- Live WebDriver journey passed against PostgreSQL source `datazen_e2e` and target
  `postgres`: a filter `id >= 2` produced only the in-scope UPDATE/INSERT rows,
  excluded id=1 from delete candidates, executed two selected changes, and left
  the out-of-scope target row unchanged. A second comparison with a changed
  filter produced a distinct plan; the original one-shot plan remained protected
  by the server plan state.
- The E2E runner warned that `E2E_PG_RO_PASSWORD` is unset, so the standard
  read-only fixture setup was skipped. This did not affect the writable PG
  journey above. SQLite is intentionally rejected by the current V1 Data Sync
  family gate and was not used for the live journey.
