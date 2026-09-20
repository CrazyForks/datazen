# migration-sync-key-contract

Phase: CODER_READY_FOR_TEST
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
