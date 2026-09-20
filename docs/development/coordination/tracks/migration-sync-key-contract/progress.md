# migration-sync-key-contract

Phase: FAILED
Branch: codex/migration-sync-key-contract
Worktree: `.worktrees/datazen-migration-sync-key-contract`
Base: `codex/migration-navicat` @ `268ce616`

## Scope

Replace the current integer-only Data Sync key gate with a driver-owned normalized key contract. The contract must define equality and total ordering for supported integer, text/collation, decimal and timestamp key values, including NULL and composite-key behavior. Stable keyset scans must use the same canonical key representation on source and target and reject ambiguous/duplicate keys before any plan can be executed.

Do not implement disk-backed ComparisonStore, object graphs, profiles, scheduler integration or broad driver features in this track. Unsupported driver/key combinations must fail with an explicit reason before writes.

## Acceptance gates

- Driver API contract and PostgreSQL/MySQL/SQLite implementations have focused unit tests in their driver crates.
- Host Sync comparison tests cover text, decimal, timestamp and composite keys, duplicate/non-monotone pages, NULL policy and cross-endpoint ordering.
- Existing immutable Sync plan and real selected-only journeys remain green.
- Formal WebDriver build and TypeScript pass.

## Coder implementation

- Added `SyncKeyContract` to the public driver API.  The contract makes the
  key domain, binary text collation, decimal scale semantics and timestamp
  timezone/precision explicit, and rejects NULL keys.
- PostgreSQL, MySQL/MariaDB and SQLite adapters now advertise the conservative
  binary text contract and driver-owned order expressions (`COLLATE "C"`,
  `BINARY`, and `CAST(... AS BLOB)`).  Integer, exact decimal and timestamp
  normalization is lossless; unsupported types return an explicit reason.
- Data Sync compares canonical key tuples while retaining raw tuples for seek
  parameters and writes.  Duplicate, non-monotone and cross-page ambiguous
  keys fail before changes are exposed.  Source and target contracts are
  compared before a live table scan starts.
- Focused coverage includes API normalization, driver contracts, SQL seek
  expressions, text/decimal/timestamp composite comparison, duplicate keys,
  NULL policy and existing immutable-plan journeys.

Coder self-test: `cargo test -p datazen-driver-api -p datazen-driver-postgres -p datazen-driver-mysql -p datazen-driver-sqlite` passed (127 + 87 + 102 + 47 tests, with the existing explicitly ignored live tests); the focused Host comparison suite passed 17/17; the full Host library suite passed 1423 tests with 3 explicitly ignored; and TypeScript passed. The full Vitest run reached 3571 passing tests out of 3573, with the two existing unrelated Wapp SDK interop failures concerning the `--c-accent-deep` theme token. Formal WebDriver build and live selected-only journeys remain for the independent Tester.

## Remaining boundaries

Stable snapshot lifetime, bounded streaming/ComparisonStore and optimistic target conflict detection remain later waves.

## Independent Tester — 2026-09-20

- **Code review**: reviewed the public `SyncKeyContract`, PostgreSQL/MySQL/SQLite adapters, keyset SQL, live `DriverKeysetSource`, comparison merge and immutable-plan revalidation. PG/MySQL contracts are conservative and fail closed for unsupported key types, NULLs, duplicate/non-monotone normalized pages and incompatible source/target domains. Added focused API boundary tests for negative zero/exponents, timezone/precision normalization, binary bytes, unsigned negatives, multiword text and float rejection.
- **Rust**: Host `cargo test -p datazen --lib` passed **1423/1423** with 3 ignored; focused `data_sync` passed **108/108**; focused `commands::sync` passed **27/27**; Driver API/PG/MySQL/SQLite passed **127/127**, **102/102**, **87/87**, **47/47**. Added API tests passed **7/7**.
- **Frontend**: Sync suites passed **7 files, 45/45**; `tsc --noEmit` passed.
- **Formal build**: `CI=true CARGO_TARGET_DIR=/tmp/datazen-target-sync-key-contract pnpm tauri:build:webdriver` passed with basic driver injection.
- **Real database journeys**: existing Sync real suite passed **25/25** on the exact packaged binary; immutable server-plan journeys passed **2/2** for PostgreSQL and **2/2** for MySQL, including selected-only writes and stale-schema rejection before writes. The setup script emitted two pre-existing demo-fixture warnings (`test_orders.order_id` and `demo_products` join) unrelated to this track.
- **Finding**: `migration-sync-key-contract-BUG-001` is reproducible in SQLite: the advertised `CAST(key AS BLOB)` seek expression receives a TEXT cursor parameter, so the cursor row is returned again (`a,b,c` after cursor `a`) instead of advancing to `b,c`. SQLite Sync is currently rejected by the V1 pairing gate, so this did not fail the PG/MySQL desktop journeys, but the SQLite contract is not correct until the binding or parameter cast is repaired.
- **TEST_FAILED**. Do not merge this track until BUG-001 is fixed and a fresh independent Tester reruns the full suite and real journeys.
