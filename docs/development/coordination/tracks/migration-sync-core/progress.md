# migration-sync-core

Phase: READY_FOR_TEST

Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-sync-core`
Branch: `codex/migration-sync-core`
Coding commit: `a0919eeb` (`feat(data-sync): preserve reviewed selection and canonical comparison values`).

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
