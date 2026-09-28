# migration-schema-sqlite-rebuild

## Phase

READY_FOR_TEST

## Scope delivered

- Added a SQLite-specific transactional table rebuild path for supported same-dialect Schema Diff structural changes: drop column, type/nullability/default changes, primary-key changes, foreign-key changes, and CHECK changes.
- Rebuilds use the reviewed source/target schema snapshots, preserve shared-column values, implicit rowids where provable, `AUTOINCREMENT` high-water state, represented primary/default/CHECK/UNIQUE/foreign-key constraints, and ordinary ascending BINARY indexes.
- SQLite catalog metadata that Schema Diff cannot faithfully render is attached to the target snapshot. The planner fails closed before execution for triggers, dependent views, inbound foreign keys, generated/hidden columns, STRICT or WITHOUT ROWID tables, deferrable foreign keys, partial/expression/descending/non-BINARY indexes, and other unrepresented semantics.
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
- UI WDIO coverage is limited to Schema Diff plan/deploy controls. A fresh-session SQLite database journey should confirm stale-review rejection and a successful reviewed rebuild before release sign-off.

## Validation

- `cargo test --locked -p datazen-driver-sqlite -- --skip command_definitions_include_schema_object_commands` — passed: 58 library tests and 19 integration tests, including 8 rebuild journeys. The skipped unrelated baseline test expects exactly three schema-object command definitions while the current API exposes four.
- `cargo test --locked -p datazen --lib` — passed: 2,000 passed, 3 ignored.
- `pnpm exec tsc --noEmit` — passed.
- Schema Diff Vitest — 20 passed; Schema Diff UI-only WDIO against the latest built app — 4 passed (SD-001, SD-002, SD-004, SD-LIM-001).
- `pnpm tauri:build:webdriver:minimal` completed. DB-backed WDIO could not bootstrap in this worktree: no `e2e/.env` or read-only PostgreSQL credentials are configured, and the local PostgreSQL role `wuxiaolong` used for per-worker databases is absent. The explicitly selected UI-only cases still passed; do not interpret that run as database journey coverage.
- `rustfmt` and `git diff --check` passed after the module split.
- This worktree has a physical `node_modules` directory, retains its `.app` bundle, and had about 40 GiB free after verification. No `.app` or `.profraw` artifacts were deleted; no black-box-tester was used.

## Remaining tester work

- In a fresh app session, create/review a SQLite structural comparison, mutate the target schema from another session, and confirm deploy rejects it before applying writes and prompts the user to refresh/review.
- In a fresh app session without target drift, deploy a supported SQLite rebuild and verify readback, transaction rollback behavior, and the required transaction UI state.
- Run DB-backed WDIO once a disposable SQLite fixture route or the required E2E credentials are available; the driver-level file-backed journeys already cover success, readback, drift, FK failure, and injected rollback.

## Implementation commits

- Implementation commit: `6148cfef39110084d0845442f370e761ecad96ae` (`feat(schema-diff): add safe SQLite table rebuilds`).
