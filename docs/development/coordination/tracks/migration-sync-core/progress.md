# migration-sync-core

Phase: FAILED

Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-sync-core`
Branch: `codex/migration-sync-core`
Coding commit: `a0919eeb` (`feat(data-sync): preserve reviewed selection and canonical comparison values`).
Rescue coding commit: `1ce25cbe` (`fix(data-sync): fence unknown outcomes and render binary previews`).

## Wave 1 implementation

- F01: removed UI execution fallback; retired backend legacy apply that re-compared without reviewed selection. Generation errors and empty generated output cannot write. Execution errors enter conservative Unknown state, require new comparison, preserve row choices. Cancellation waits for an in-flight transaction outcome before permitting another execution. SQL preview now exposes backend generation errors instead of fabricating fallback SQL; stale preview requests are ignored.
- F03: comparisons carry canonical columns, source types and ordered primary keys. Generation resolves target types by column name, never target physical ordinal; rejects missing metadata and changed target column set/type/PK. Unselected rows stay excluded across option changes.
- F05: every page is validated for exact row width, non-null key and strict ordering including page boundaries. Repeated/non-monotone pages error rather than silently terminate. Live scans temporarily accept only exact decoded integer keys and recognized integer key types; unsupported key types get an actionable error.
- F10: unchanged rows are counted without retaining source/target row values. Temporary review safety limits: 1,000 rows and 8 MiB per returned page; 10,000 differences and 32 MiB retained per table; 64 MiB total result. Exceeding limits returns an error and no partial comparison.
- F12: result merge retains projection metadata; headers and highlights use real column names. Changed source value is styled as new; old target value is struck through. Cross-page deselection retained.

Only sync.* en/zh-CN locale keys added; no shared Driver API/driver changes.

## Self-validation

- `CARGO_TARGET_DIR=<this-worktree>/target/cargo-wt node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib data_sync --features driver-mysql,driver-postgres,driver-sqlite`: **98 passed**.
- Same injected command with `commands::sync` filter: **21 passed**, including canonical reordered target generation/type and PK drift, retired apply and repeated mock page rejection. Filters overlap; do not sum as unique test count.
- `npx --no-install vitest run src/windows/data-sync/__tests__`: **5 files, 29 tests passed**.
- `npx --no-install tsc --noEmit`: passed, no diagnostics.
- `git diff --check`: passed.
- Initial Rust attempt failed only because ignored `src-tauri/resources/builtin-ep` was absent; prepared empty Community directory and reran successfully.
- Logs: `/tmp/migration-sync-cargo.log`, `/tmp/migration-sync-commands.log`, `/tmp/migration-sync-vitest.log`, `/tmp/migration-sync-tsc.log`.

## Independent Tester journeys

1. Generation failure after deselecting one of two mapped rows: no execute/apply; mapping and selection preserved.
2. Execute/commit response failure: no legacy apply/recompare; Unknown blocks further execution until fresh comparison.
3. Source physical columns id,a,b; target id,b,a: selected update and insert preserve all values; recompare zero selected-scope residual differences.
4. 501+ differences: deselect on page 1 and 2, navigate both directions and preview; only selected rows written.
5. Exact integer composite keys and page sizes 1/2/1000; repeated/out-of-order/duplicate/null key page returns error, no silent partial result.
6. Text/collation/decimal keys fail explicitly pending normalized Driver key contract.
7. Many unchanged rows: counts correct and no retained unchanged rows; 10,001 differences and oversized page/result reject without usable partial approval.
8. Cancellation during generation never executes; cancellation during write does not enable a second execution while transaction response is pending.

Coordinator-provisioned isolated DBs available: `dz_mig_0910_sync_src` / `dz_mig_0910_sync_tgt` on PG and MySQL; credentials in ignored e2e/.env. **Coder did not perform actual DB migration or WebDriver E2E.** Tester must use final track/integrated binary via required build script.

## Remaining wave dependencies — not parity complete

- Integer-only live-key gate is temporary, not accepted as final Navicat parity. Need Driver normalized key ordering/collation capability and stable snapshot/cursor scanning.
- Limits are temporary safety boundaries, not a scalable ComparisonStore. Returned page byte size is checked after Driver allocation; hard wire/driver memory limits require streaming API.
- Frontend still submits rows/statements. Shared immutable backend plan/selection revision/endpoint identity, full schema fingerprints, optimistic target original-value conflict detection and accurate affected rows remain next-wave requirements.
- Target name/type/PK validation is not a full stale snapshot check. Source/schema-qualified metadata identity and physical self-target protection require shared RelationRef work.
- Field/key mappings, full persistent profile/run lifecycle, object dependency sequencing and broad driver support remain planned work. Current frontend compare API still uses existing same-name mapping flow; preserve arbitrary mappings in shared prepared plans next wave.
- Existing DataSyncWindow remains above 800 lines (reduced by fallback removal); full controller decomposition remains subsequent product work.


## Independent Tester — 2026-09-14 (rescue completion)

A. Reviewed committed canonical projection, page monotonicity/width/limits, unchanged count, retired apply, preview lifetime, row highlight, and execution/cancel state transitions. No business fixes made. Findings: BUG-001 and BUG-002 in bugs.md.

B. Independent reruns at HEAD4ae9bb32 with retained/new Tester tests:
- Rust data_sync:100 passed,1 failed (binary preview regression); Coder baseline98 passed. Added3 tests.
- Rust commands::sync:21 passed (overlap with data_sync filter; do not sum).
- Vitest:34 passed,1 failed,7 files; Coder baseline29 passed/5 files. Added6 tests.
- TypeScript noEmit passed with no diagnostics.
- PostgreSQL/MySQL isolated DB real IPC journey: initial2/2 passed. Canonical id,a,b versus target id,b,a, batch1, two selected changes, excluded id3, exact final values and unchanged count verified.

C. V8 measured changed frontend core modules including DiffDetail/utils: lines82.92%, statements80.95%, branches77.60%, functions85.10%. Per-file lines: DataSyncWindow80.65, DiffDetail81.48, SqlPreview100, mappingView89.15, utils100. Before-Tester percentage unavailable (attempted name filtering did not exclude suite tests; rejected as baseline). Rust percentage not instrumented; no fabricated estimate. Tests cover oversized/null/composite pages, stale preview error/success, option/disabled metadata retention, cancelled unknown execution and binary preview.

D. TEST_FAILED; do not merge. Two reproducible correctness defects remain. Reports /tmp/sync-rescue-{rust,commands,fe,coverage-full,tsc,e2e}.log. Database credentials not printed; only isolated dz_mig_0910_sync_src/tgt and tester_sync_projection used. WebDriver tests use track binary built via required pipeline on Sep11 after Coder commit; no business code changes after that build. Port4476 and e2e/.app-data-sync-rescue isolate application state. No default environment reset scripts run.

Final real DB rerun:2/2 passed including newly added legacy apply rejection and exact unchanged target assertion before selected execution. One intermediate rerun failed to connect because app had exited; restarted the same exact binary and both passed. Final log:/tmp/sync-rescue-e2e-final.log.

## Coder rescue — 2026-09-15

- BUG-001 repaired with an independent uncertain-write fence. Once a write may have committed, stale mappings cannot become executable through back navigation, a new comparison followed by cancellation, failed inspection/comparison, or preview navigation. Only a successful fresh comparison clears the fence. Cancellation during an in-flight write continues to wait for the transaction outcome.
- BUG-002 repaired without a Host database-family SQL switch. Generic byte preview now fails closed with an explicit driver-literal-required marker. The normal command path asks the registered target `SyncTargetAdapter` to render the literal, giving PostgreSQL `bytea` and MySQL binary syntax while preserving exact typed parameters.
- Added meaningful frontend journeys for uncertain execution transitions, cancellation while writing, failed inspection/comparison, no-change comparison, malformed operation data, target-only keys, selection counts and serialization fallback.

### Rescue validation

- Injected Rust `data_sync` suite: **101 passed, 0 failed**.
- Injected Rust `commands::sync` suite: **22 passed, 0 failed**. Filters overlap; do not sum as unique tests.
- Frontend sync suites: **7 files, 39 tests passed**.
- TypeScript `noEmit`: passed with no diagnostics.
- V8 coverage for the five changed frontend business modules: statements **82.84%** (652/787), branches **80.33%** (429/534), functions **85.63%** (161/188), lines **84.84%** (599/706).
- Required WebDriver build pipeline completed successfully with basic driver injection.
- Isolated real-database canonical projection/selection journeys: PostgreSQL **1/1**, MySQL **1/1**, total **2/2 passed**. They verify reordered physical columns, selected-only execution, exact final values and post-write comparison.

### Preserved integration dependency

An exploratory binary real-database extension exposed two shared driver issues outside this track: PostgreSQL binds `Value::Bytes` as text (`column "payload" is of type bytea but expression is of type text`), while MySQL currently decodes the source BLOB as `NULL` and generates `... payload) VALUES (2, 30, 40, NULL)`. The extension was removed from this track's runnable E2E to avoid changing shared driver files owned by the pending Transfer work. After that work merges, integration testing must restore PostgreSQL/MySQL binary round-trip coverage. The target-driver preview test remains in this track and passes.

## Independent Tester round 2 — 2026-09-15

A. Reviewed the complete rescue diff at `1ce25cbe`, including the independent unknown-write fence, inspection/compare/cancel transitions, execute handler and button gates, generic binary fail-closed preview, target adapter dispatch and exact typed parameters. BUG-001 and BUG-002 are independently fixed. A new cancellation race is recorded as BUG-003; no business code was changed.

B. Independent reruns at `c64466cc` before adding the new failing regression:
- Injected Rust `data_sync`: **101 passed, 0 failed**.
- Injected Rust `commands::sync`: **22 passed, 0 failed**; filters overlap with the preceding run and are not summed.
- Frontend sync suites: **7 files, 39 passed**. After adding the delayed-cancel Tester journey: **7 files, 39 passed, 1 failed**.
- TypeScript `noEmit` and `git diff --check`: passed.
- The required `pnpm tauri:build:webdriver` pipeline completed successfully with basic driver injection and an isolated track `CARGO_TARGET_DIR`.
- The exact newly built track app ran the isolated PostgreSQL and MySQL canonical projection/selection journeys: **2/2 passed**. Each checked reordered physical columns, selected-only execution, exact target values, legacy-apply rejection and post-write comparison. Port 4476 and a dedicated app-data directory were used; default database reset scripts were not run.

C. V8 coverage for the five changed frontend business modules remains above the gate: statements **82.84%** (652/787), branches **80.33%** (429/534), functions **85.63%** (161/188), lines **84.84%** (599/706). Rust percentage was not instrumented; the exact passing path counts above are reported instead. The new `[tester] invalidates a comparison before awaiting the cancel response` journey deterministically covers the previously untested race where compare completes while cancel IPC is still pending.

D. **TEST_FAILED**. BUG-003 is a reproducible P1 duplicate-write risk. The comparison generation is invalidated only after awaiting the cancel command, so an in-flight comparison can clear `writeOutcomeUncertain` before cancellation completes. The UI then reports `unknown` while the independent fence is false; both the Execute button and execution handler can accept the stale mapping. Do not merge this track until a fresh Tester completes another full pass.
