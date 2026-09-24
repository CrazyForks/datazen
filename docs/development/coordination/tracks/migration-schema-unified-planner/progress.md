# migration-schema-unified-planner

- Phase: READY_FOR_TEST

- Task: One reviewed Schema Diff deployment plan across selected object kinds
- Branch: `feature/migration-schema-unified-planner`
- Worktree: `.worktrees/datazen-migration-schema-unified-planner`
- Dependencies: `codex/migration-navicat` at `6210b2ec`; Schema dependency DAG is merged and independently verified
- Workspace install: `pnpm install --offline --frozen-lockfile` completed in this worktree; `node_modules` is a physical directory with its real path inside this worktree

## Scope

The current Host exposes independent reviewed plans for table operations, views, routines/triggers, sequences, and custom types. Implement a single host-owned planning boundary that accepts one immutable source/target snapshot plus selected operations across the supported kinds, builds one typed dependency graph, and returns one deterministic reviewed execution plan. It must reuse each driver's verified renderers and the dependency validation established by `migration-schema-dependency-dag`; it must not infer dependencies from opaque SQL or promise cross-dialect translation without a renderer contract.

An unselected dependency may be accepted only when the target snapshot proves it already exists with the required identity. Missing, ambiguous, cyclic, unsupported, or stale dependencies must block execution before writes. Apply order and reverse rollback must respect cross-kind edges. The UI must show one reviewable cross-kind order and the existing stale-plan, target-snapshot, approval, and unknown-outcome rules must continue to apply.

## Acceptance criteria

- [x] One immutable reviewed plan can contain supported table/FK, custom type, view, sequence, routine, and trigger operations without split independent execution plans.
- [x] Cross-kind dependency edges are validated from exact structured identities; unselected dependencies require proof in the target snapshot, and opaque dependencies fail closed.
- [x] The plan reports actionable unresolved, ambiguous, unsupported, and cyclic dependency diagnostics and cannot be executed when any blocking requirement remains.
- [x] Apply order is deterministic and topological across kinds; rollback is a safe reverse order only when the renderer supplies verified rollback SQL.
- [x] Existing review confirmation, destructive approval, plan fingerprinting, source/target schema revalidation, and unknown transaction outcome behavior cover the unified plan.
- [x] Unit tests cover type→table→FK→view/routine→trigger chains, existing-target dependencies, cross-kind replacements/drops, cycles, missing/ambiguous nodes, stale snapshots, and partial rollback availability.
- [ ] PostgreSQL and MySQL WDIO journeys create and drop a mixed object chain through one reviewed plan, read back the deployed objects, and prove invalid graphs write nothing.
- [ ] Changed-core coverage reaches at least 80%; independent Tester to measure after integration.

## Implementation notes

- Unified table/object plan preparation and one-shot reviewed deploy revalidation are implemented in Host Rust. Source and target table/object definitions and exact dependency catalogs are re-read before writes.
- Driver `get_object_dependencies` results include optional `typeDependencyUsages`. A column type edge is ignored only when every recorded use belongs to a column whose final reviewed operation replaces that type; expression/check dependencies remain graph edges. A changed attribution invalidates the reviewed source snapshot.
- Object DDL is blocked when source and target schema scopes differ because the renderers do not provide a verified schema rewrite contract. Cross-dialect table-only plans continue through the existing type mapper; mixed object plans remain blocked.
- PostgreSQL sequence ownership plus a table default can form a cycle. Unified creation now splits validated renderer DDL into `CREATE SEQUENCE` (unowned), the selected owner-table/default operation, and a distinct exact `OWNED BY` phase. Splitting requires matching structured `owned_by` and `column_default` records, complete dependency snapshots, and a selected table/column operation; an unselected table identity alone is not accepted. Rollback is `OWNED BY NONE`, the table inverse, then the renderer's `DROP SEQUENCE`.
- Unified `DropSequence` and `ReplaceSequence` remain fail-closed. Owned sequences are blocked because table drops can implicitly remove them and the current renderer cannot stage safe detach/reattach; sequence mutations without ownership are also blocked because the target catalog does not yet prove the complete reverse set of column defaults. This explicit limitation must remain visible until catalog coverage and safe mutation phases are implemented.
- PostgreSQL's live view dependency catalog previously reported the selected view itself as a dependency. Host preserves the exact-identity self-cycle blocker; it does not normalize the row. Driver commit `371a04ebf5780ef81612992f2bea9b773fd1788f` is integrated in the current feature head; its catalog behavior still needs independent retesting here before WDIO acceptance.
- Opaque or incomplete driver catalogs remain blockers. MySQL routines/triggers and any unproven dependency kind must stay fail-closed until the driver supplies complete structured metadata.

## Host self-check before independent testing

- `CARGO_TARGET_DIR=target/cargo-unified-planner CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo check -p datazen --lib` — passed after sequence-phase wiring.
- `CARGO_TARGET_DIR=target/cargo-unified-planner CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p datazen --lib schema_diff::` — passed, 192/192.
- `CARGO_TARGET_DIR=target/cargo-unified-planner CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p datazen-driver-api --lib schema_migration::` — passed, 16/16.
- `cargo fmt --all -- --check` and `git diff --check` — passed.
- `cargo llvm-cov` is not installed in this environment, so changed-core coverage has not been measured here.

## Independent Tester

The Host implementation is not yet release-ready: the integrated driver view self-reference fix still needs live retesting here, and WDIO plus changed-core coverage remain unchecked. The Tester must exercise the real WDIO UI/IPC path and report database fixture cleanup evidence; this progress status does not claim those journeys have passed. `SERIAL`/`BIGSERIAL` creation is supported only when exact driver ownership/default usage metadata and a selected owner table operation prove the staged plan; unsupported/malformed attribution blocks before writes.

### Tester checkpoint · 2026-09-25

- Mandatory install completed with `pnpm install --offline --frozen-lockfile`; `node_modules` is a real directory whose canonical path is inside the verification worktree. `node scripts/generate-builtin-locales.mjs` completed.
- Full Host Rust suite, serial: 1949 passed, 0 failed, 3 ignored. Initial sandboxed runs produced 87 loopback `PermissionDenied` failures in unrelated mock-server tests; rerunning with approved local-loopback access resolved them. The remaining one failure was the IPC registration-contract test parsing a nested command path as `schema_diff`; `prepare_schema_unified_plan` is registered in `bootstrap/run.rs`. Corrected only the test parser to compare the final `::` path segment, then the full serial suite passed.
- No product bug confirmed in this checkpoint. API/driver/UI/type, coverage, live database, and WDIO verification remain in progress.

### Frontend verification checkpoint · 2026-09-25

- Corrected the TypeScript IPC registration test parser to recognize nested Tauri command paths; the registered `prepare_schema_unified_plan` leaf is present in `bootstrap/run.rs`. The isolated parser suite passes 9/9.
- Full Host Vitest passes 5210/5210 across 496 files after the test-only parser correction. The unrelated Data Sync profile-reconfirmation test fails when filtered as the only test twice, but its complete unchanged spec file passes 42/42 and the full Host suite passes; these Data Sync files predate this track (`d523eb3b`) and are unchanged here. Treat this as order/test-selection-sensitive baseline behavior, not a planner bug.
- Focused Host `schema_diff::` independently passes 195/195, three above the coder-reported 192/192. The extra tests cover object-only profiles, backwards-compatible empty object selections, and routine/trigger identity round-tripping added in the integrated UI branch. Driver API `schema_migration::` independently passes 16/16, matching the coder report; the full Driver API suite passes 171/171.
- PostgreSQL driver suite passes 153 tests with 4 opt-in live tests ignored; MySQL driver suite passes 130 tests with 2 opt-in live tests ignored. The integrated live dependency-catalog cases still need to be run explicitly against PostgreSQL and MySQL below.
- Driver UI, TypeScript typecheck, changed-core coverage, live catalog fixtures, and WDIO remain in progress.

### Rust coverage checkpoint · 2026-09-25

- Manual LLVM coverage used `RUSTFLAGS=-Cinstrument-coverage` with Rust 1.90.0 (LLVM 20.1.8) and `/Library/Developer/CommandLineTools/usr/bin/llvm-profdata` plus `/Library/Developer/CommandLineTools/usr/bin/llvm-cov` (Apple LLVM 17.0.0). The profile merge/export completed with one `functions have mismatched data` warning; the line report is usable, with that version mismatch retained as a limitation.
- Final unit-profile scope, all serial: Host `schema_diff::` passes 204/204 (coder reported 192/192; the earlier independent run before tester cases was 195/195); Host `commands::schema_diff::` passes 14/14; Driver API full library passes 173/173; Driver API `schema_migration::` passes 18/18 (coder reported 16/16). The production-only report was exported from only the latest successful absolute-pattern profiles; failed attempts were excluded.
- Rust coverage used `RUSTFLAGS=-Cinstrument-coverage`, Rust 1.90.0 / LLVM 20.1.8, and `/Library/Developer/CommandLineTools/usr/bin/llvm-profdata` plus `/Library/Developer/CommandLineTools/usr/bin/llvm-cov` (Apple LLVM 17.0.0). The export reported one function with mismatched data across the Rust/system LLVM versions; line results are usable, with that version mismatch retained as a limitation. The allowlist excludes direct test source files and every `#[cfg(test)]` suffix.
- Changed Host planner core is 3,245/3,817 executable lines (85.0%) across 13 production files. Per-file: `dependencies.rs` 27/30 (90.0%); `object_identity.rs` 31/31 (100%); `objects.rs` 876/1,057 (82.9%); `operation_dependencies.rs` 328/385 (85.2%); `operations.rs` 65/68 (95.6%); `reviewed.rs` 291/364 (79.9%); `reviewed_catalog.rs` 70/70 (100%); `unified.rs` 274/329 (83.3%); `unified_objects.rs` 168/198 (84.8%); `unified_sequence.rs` 258/321 (80.4%); `unified_type_validation.rs` 202/212 (95.3%); `unified_validation.rs` 409/491 (83.3%); `unified_validation/table_catalog.rs` 246/261 (94.3%).
- `packages/driver-api/src/schema_migration.rs` is 736/850 (86.6%). Changed Driver API catalog sources are 1,311/1,534 (85.5%): `schema_dependencies/mod.rs` 29/30 (96.7%), `mysql.rs` 64/66 (97.0%), `postgres.rs` 665/665 (100%), `schema_object_commands.rs` 315/489 (64.4%), and `schema_object_commands/dependencies.rs` 238/284 (83.8%).
- The unified command layer is reported separately at 7/830 executable lines (0.8%): `unified_plan.rs` 0/540, `catalog.rs` 0/191, and `revalidation.rs` 7/99 (7.1%) from unit scope. WDIO app-runtime profiles should cover the IPC path if the instrumented build permits it.
- Added focused test-only `test_tester_...` cases in `objects.rs`, operation dependency tests, unified-object tests, table-catalog tests, and the Driver API migration parser. Corrections after the first instrumented compile keep duplicate-object requirements as the safety assertion even when review SQL remains present; the MySQL DEFINER fixture exercises header parsing without PostgreSQL-only signature metadata, with a separate PostgreSQL identity-argument check. No product bug was proven by these fixture corrections.
- The 80% aggregate Host-core and migration-helper gates now pass. Webdriver build/run, PostgreSQL/MySQL journeys and fixture cleanup, integrated live catalog fixtures, and WDIO runtime coverage remain outstanding.
