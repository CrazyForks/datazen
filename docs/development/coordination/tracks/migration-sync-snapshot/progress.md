# Data Sync stable snapshot track

Status: implemented.

Data Sync comparisons now begin a driver-owned read-only snapshot before the
comparison path and use that transaction for every keyset page, schema read,
and plan fingerprint read on each endpoint. PostgreSQL uses `REPEATABLE READ
READ ONLY`; MySQL/MariaDB uses `WITH CONSISTENT SNAPSHOT, READ ONLY`. The
comparison always rolls both snapshots back after success or an error, so a
failed or cancelled comparison cannot leave a session transaction open.

The driver API fails closed for families without an explicit stable-snapshot
capability. This track does not add disk-backed comparison storage, row-range
selection, or additional Data Sync families.

## Focused verification

- Host Sync command tests passed, including snapshot cleanup assertions.
- PostgreSQL and MySQL driver suites passed, including missing-pool snapshot
  guards.
- The formal WebDriver build is required before integration; live mutation
  coverage should verify that a multi-page compare cannot observe a committed
  mid-scan change.

## Independent final verification (2026-09-20)

- `cargo test -p datazen --lib commands::sync::tests`: **21 passed**.
- `cargo test -p datazen-driver-api --lib`: **132 passed**.
- `cargo test -p datazen-driver-postgres --lib`: **104 passed**.
- `cargo test -p datazen-driver-mysql --lib`: **89 passed**.
- Source review confirmed the comparison wrapper rolls both read snapshots back
  after a successful inner comparison and after an inner error; the host error
  path asserts that no mock transaction remains open.
- No formal WebDriver build log was available in this worktree, and this final
  tester did not start a new long build. The formal build remains a required
  pre-integration gate.
