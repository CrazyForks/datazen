# migration-sync-plan

Phase: READY_FOR_TEST
Branch: codex/migration-sync-plan
Worktree: `.worktrees/datazen-migration-sync-plan`
Base: `codex/migration-navicat` @ `4e461391`
Coding commit: `44b025bc` (`feat(data-sync): add immutable comparison execution plans`)

## Scope for this serial wave

Implement the next Sync correctness boundary only: a server-owned immutable comparison/execution plan that binds source and target sessions, qualified relation identity, schema/key fingerprints, reviewed selection revision and driver contract. Execution must fail closed on stale sessions, schema/key changes, changed read-only policy, invalid selections and unknown outcomes. Keep the existing integer-key comparison limitations explicit; do not expand to unrelated object graphs, profiles or scheduler work in this wave.

## Acceptance gates

- Host Sync Rust tests and command-path tests pass, including stale/one-shot/unknown-outcome cases.
- Sync frontend journey tests and TypeScript pass; execute sends an opaque plan ID and validated selection revision only.
- PostgreSQL/MySQL/SQLite driver tests pass.
- Formal WebDriver build passes.
- Isolated PostgreSQL and MySQL Sync binary journeys prove selected-only writes and stale-plan rejection before target writes.

## Remaining boundaries

Normalized text/collation/composite-key ordering, bounded stable snapshots, disk-backed ComparisonStore, conflict detection and persistent profiles remain later waves.

## Implementation

- `compare_data_sync` now returns a review payload containing an opaque `planId`, a selection revision and display-only tables. The full comparison stays in a process-local server registry with a 15 minute TTL and one-shot consumed state.
- Each plan binds the exact source/target `dbSessionId`, qualified database/schema/relation identity, serialized source and target `TableSchema` fingerprints (including primary keys), driver ids and protocol versions, comparison options and target read-only policy.
- `generate_data_sync_sql` and `execute_data_sync` resolve the server-owned comparison by `planId`. Requests carry only a revision, selected operation/key tuples, validated options and an optional cancellation job id. Unknown fields such as replacement SQL, rows, statements or mappings are rejected during deserialization.
- Execution revalidates sessions, drivers, read-only state and live schema/key fingerprints before atomically consuming the plan. A consumed plan remains unavailable after rollback, cancellation or an unknown transaction result.
- The frontend keeps its existing reviewed-table UI while translating its local selection to operation/key tuples. The actual IPC payload never forwards generated SQL, source rows or replacement mappings. SQL preview also resolves from the same server plan.

## Self-validation

- Injected Host `data_sync` tests: **102 passed**.
- Injected Host `commands::sync` tests: **20 passed**, including opaque plan issuance; the command filter overlaps the data_sync module tests and is not summed as a unique total.
- Immutable-plan unit tests: **3 passed**, covering selection membership, payload rejection and key-only selections.
- Frontend Data Sync suites plus immutable IPC contract test: **8 files, 46 passed**.
- TypeScript `noEmit`: passed with no diagnostics; `git diff --check`: passed.
- Formal `pnpm tauri:build:webdriver` completed with basic driver injection and an isolated `CARGO_TARGET_DIR`.
- PostgreSQL/MySQL binary journeys were not run by the Coder; they remain required for the independent Tester, including stale-schema rejection before writes. Driver-specific suites remain required at the Tester gate.

## Known limits for independent testing

- This wave intentionally retains the existing integer-key comparison gate and in-memory comparison result limits.
- Selection revision is an immutable review epoch for one comparison. Later waves can add a server-side review mutation protocol if selection history needs durable audit semantics.
- The legacy SQL-taking helper exists only under `cfg(test)` for existing unit coverage; it is not compiled into or registered as an IPC command.
