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
