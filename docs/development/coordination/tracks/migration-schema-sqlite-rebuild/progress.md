# migration-schema-sqlite-rebuild

## Phase

READY_FOR_INTEGRATION

## Scope delivered

- Added a SQLite-specific transactional table rebuild path for supported same-dialect Schema Diff structural changes: drop column, type/nullability/default changes, primary-key changes, foreign-key changes, and CHECK changes.
- Rebuilds use the reviewed source/target schema snapshots, preserve shared-column values, implicit rowids where provable, `AUTOINCREMENT` high-water state, represented primary/default/CHECK/UNIQUE/foreign-key constraints, and ordinary ascending BINARY indexes.
- SQLite catalog metadata that Schema Diff cannot faithfully render is attached to the target snapshot. The planner fails closed before execution for triggers, dependent views, inbound foreign keys, generated/hidden columns, STRICT or WITHOUT ROWID tables, deferrable foreign keys, partial/expression/descending/non-BINARY indexes, `ON CONFLICT` policies, and other unrepresented semantics.
- SQLite rebuild statements are marked transaction-required. Deploy refuses to run them without a transaction, checks the reviewed target schema snapshots inside the transaction before the first rebuild write, performs a foreign-key readback check before commit, and rolls back on either validation failure.
- The UI keeps the transaction option enabled for these plans. Non-SQLite planner behavior is unchanged.

## Review and recovery contract

- `SchemaDiffPlan.expectedTargetSchemas` carries the target snapshots used by any transactional rebuild and participates in the existing reviewed-plan freeze/consume contract.
- Deploy re-reads those tables through the target SQLite connection after `BEGIN`; any structural or blocker metadata drift rejects the plan before DDL and rolls the transaction back. Users must refresh the comparison and review the regenerated plan.
- Successful deployment is committed only after `PRAGMA <target>.foreign_key_check` returns no violations.

## Acceptance boundaries

- Supported rebuilds are same-dialect, fully approved table snapshots with no pending backfill, type mapper, or excluded index changes.
- Triggers, dependent views, and inbound foreign keys are deliberately blocked because the current schema snapshot does not carry enough DDL to round-trip them safely.
- Expression/default/type/CHECK inputs are parser-validated before rendering; rowid alias changes and unsafe temporary-name cases fail closed.
- UI WDIO coverage is limited to Schema Diff plan/deploy controls. The fresh-session, file-backed SQLite journey now covers both successful reviewed rebuild and stale-review rejection before any migration write.

## Validation

- `node scripts/with-driver-inject.mjs -- cargo test -p datazen --lib schema_diff` — passed: 218 tests after the SQLite catalog-scope fixes.
- SQLite driver file-backed rebuild journey — passed: 9/9, including supported rebuild readback and `ON CONFLICT` fail-closed zero-write checks (fresh R5 tester).
- `pnpm typecheck` — passed with the WDIO spec included.
- Fresh R8 app build: `pnpm tauri:build:webdriver` — passed.
- Fresh R8 file-backed WDIO: `E2E_SKIP_WORKER_DATABASE=1 pnpm e2e:skip-build -- --spec e2e/specs/schema-diff-sqlite-rebuild.ts` — passed 2/2. It verified a reviewed rebuild preserves `(id=7, value='kept')` and the new `BLOB` type, and that a target altered after review is rejected with `Target schema changed for <table>; compare again` while its row and externally added column remain unchanged.
- `rustfmt --check` and `git diff --check` passed for the implementation changes. Dependencies were physically installed in each tester worktree; no black-box-tester was used.

## Remaining work

- Integrate this track into `codex/migration-navicat` and run the migration release gate against the merged application. The standalone SQLite fixes and fresh independent file-backed WDIO journeys are complete.
- Existing fail-closed boundaries remain intentional: unsupported SQLite catalog features must be resolved by the user before migration rather than silently lost.

## Implementation commits

- Implementation commit: `6148cfef39110084d0845442f370e761ecad96ae` (`feat(schema-diff): add safe SQLite table rebuilds`).

## R4 conflict-policy gap follow-up (BUG-001)

- **Phase:** `READY_FOR_INTEGRATION` (fresh independent R5 file-backed driver journey passed 9/9).
- Added a fail-closed SQLite catalog guard for unquoted `ON CONFLICT` token pairs. It covers column and table constraints, tolerates comments between keywords, avoids string/quoted-identifier false positives, and reports the recognized conflict action. The existing renderer preflight rejects the snapshot before emitting rebuild DDL.
- Added a file-backed journey for column `UNIQUE IGNORE`, `NOT NULL FAIL`, inline `PRIMARY KEY REPLACE`, table `UNIQUE ABORT`, table `PRIMARY KEY ROLLBACK`, and table `CHECK IGNORE`. It checks catalog DDL and rows remain unchanged after blocked planning/rendering, verifies duplicate UNIQUE IGNORE still leaves one row, and confirms the phrase inside a default string literal does not block an ordinary rebuild.
- **Validation:** `cargo test --locked -p datazen-driver-sqlite --test schema_rebuild_journey` — 9 passed, including the existing successful ordinary-table rebuild journey. `cargo test --locked -p datazen-driver-sqlite -- --skip command_definitions_include_schema_object_commands` — 78 passed, 1 filtered. `cargo test --locked -p datazen --lib schema_diff::plan::tests::` — 74 passed. `cargo test --locked -p datazen --lib schema_diff::deploy::tests::` — 7 passed. `rustfmt --edition 2021 --check` for the changed Rust files and `git diff --check` passed.
- The filtered `command_definitions_include_schema_object_commands` assertion is an unchanged baseline failure documented by the independent R4 report (it expects 3 definitions; current API exposes 4). Host compilation emitted existing unused/dead-code warnings outside changed files.
- No WebdriverIO build was run for this targeted backend repair. The worktree retains its physical `node_modules`; no `.app` or `.profraw` files were removed or modified. Disk availability was 38 GiB after focused driver and Host tests, above the 15-GiB floor.
- **Repair commit:** `c20e837ea1887f94678b85f226ec02f80c4b9d16` (`fix(sqlite): fail closed on ON CONFLICT policies`). The fresh R5 driver journey independently verified the zero-write acceptance in `bugs/migration-schema-sqlite-rebuild-BUG-001.md`.
