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
- Cross-scope object DDL remains fail-closed except for the verified MySQL view mapping contract added for BUG-006. That path maps only exact source-scope identities and catalog-proven relation tokens, preserves external qualified dependencies, and requires complete dependency evidence. Cross-dialect table-only plans continue through the existing type mapper; cross-scope routines, triggers, custom types, and sequences remain blocked.
- PostgreSQL sequence ownership plus a table default can form a cycle. Unified creation now splits validated renderer DDL into `CREATE SEQUENCE` (unowned), the selected owner-table/default operation, and a distinct exact `OWNED BY` phase. Splitting requires matching structured `owned_by` and `column_default` records, complete dependency snapshots, and a selected table/column operation; an unselected table identity alone is not accepted. Rollback is `OWNED BY NONE`, the table inverse, then the renderer's `DROP SEQUENCE`.
- Unified `DropSequence` and `ReplaceSequence` remain fail-closed. Owned sequences are blocked because table drops can implicitly remove them and the current renderer cannot stage safe detach/reattach; sequence mutations without ownership are also blocked because the target catalog does not yet prove the complete reverse set of column defaults. This explicit limitation must remain visible until catalog coverage and safe mutation phases are implemented.
- PostgreSQL's live view dependency catalog previously reported the selected view itself as a dependency. Host preserves the exact-identity self-cycle blocker; it does not normalize the row. Driver commit `371a04ebf5780ef81612992f2bea9b773fd1788f` is integrated by merge commit `61f38936`; its driver/API and PostgreSQL/MySQL live checks passed independently, and the Host driver suites pass after integration.
- BUG-003 status: fix committed, awaiting independent live re-test. View validation now accepts one trailing SQL terminator and semicolons inside quoted literals while rejecting multiple statements. PostgreSQL migration table snapshots retain user-defined column type identity via `udt_schema`/`udt_name`. Function dependency catalogs include exact `pg_depend` edges and prove an empty body-dependency set only for the exact PL/pgSQL `BEGIN RETURN NEW; END[;]` passthrough form; every other body, including one with a hidden table reference, remains incomplete and blocked.
- BUG-004 status: closed by Fresh Tester round-3. MySQL function, procedure, trigger, and view listing queries retain the shared `schema` output column while quoting the reserved alias with backticks; driver tests cover all four queries and the parser's schema-field contract. The new Host app returned exact schema/name identities through IPC for all four kinds.
- BUG-005 status: fix committed, awaiting fresh independent re-test. MySQL catalog DDL can arrive through the driver result as bytes; `extract_object_ddl` now decodes DDL bytes only when the complete value is valid UTF-8. Invalid bytes stay unavailable and fail closed. Added a long multibyte definition regression and invalid UTF-8 rejection.
- BUG-007 status: fix committed, awaiting Fresh Tester re-test. `SHOW CREATE VIEW` is authoritative for creation metadata; the information-schema body and every overlapping semantic field must match it, otherwise `get_object_ddl` returns an error before a view snapshot or reviewed plan can be produced.
- Opaque or incomplete driver catalogs remain blockers. MySQL routines/triggers and any unproven dependency kind must stay fail-closed until the driver supplies complete structured metadata.

## Host self-check before independent testing

- `CARGO_TARGET_DIR=target/cargo-unified-planner CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo check -p datazen --lib` — passed after sequence-phase wiring.
- `CARGO_TARGET_DIR=target/cargo-unified-planner CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p datazen --lib schema_diff::` — passed, 192/192.
- `CARGO_TARGET_DIR=target/cargo-unified-planner CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p datazen-driver-api --lib schema_migration::` — passed, 16/16.
- BUG-003 follow-up: full driver API suite passed (172/172), PostgreSQL driver suite passed (133/133), PostgreSQL dependency-catalog integration test compiled with `--no-run`, Host `cargo check -p datazen --lib` passed, and Host `schema_diff::` passed (195/195). The opt-in PostgreSQL live catalog test has not run from this worktree because it has no `MIGRATION_TEST_*`/`E2E_PG_*` settings and the tester's isolated database configuration is intentionally not copied; the independent Tester will run it after integration.
- BUG-004 follow-up: `CARGO_TARGET_DIR=target/cargo-unified-planner CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p datazen-driver-mysql` — passed (116 library tests, 15 integration tests across the non-ignored suites, 2 isolated-database tests ignored); `cargo test -p datazen-driver-api --lib` — passed, 172/172. Fresh Tester round-3 verified all four kinds through rebuilt-app IPC with exact schema/name metadata and confirmed exact fixture cleanup.
- BUG-005 follow-up: full `cargo test -p datazen-driver-api --lib` passed (173/173), full `cargo test -p datazen-driver-mysql` passed (116 library tests, 15 non-ignored integration tests; 2 isolated-database tests ignored), and `cargo test -p datazen --lib schema_diff::` passed (195/195). The new API regression exercises valid long UTF-8 bytes and confirms invalid UTF-8 remains rejected. No isolated MySQL fixture configuration is available in this worktree; Fresh Tester will verify the live UI/IPC journey.
- BUG-006 follow-up: `cargo test -p datazen --lib schema_diff::` passed (204/204), `cargo test -p datazen-driver-api --lib` passed (174/174), `cargo test -p datazen-driver-mysql --lib` passed (123/123), and `cargo test -p datazen-driver-mysql --test schema_objects_sql` passed (8/8). `cargo fmt --all -- --check` and `git diff --check` passed. The real mixed MySQL WDIO path and exact fixture cleanup remain for Fresh Tester; changed-core coverage has not been measured in this worktree.
- BUG-007 follow-up: `cargo test -p datazen --lib schema_diff::` passed (204/204), `cargo test -p datazen-driver-api --lib` passed (177/177), `cargo test -p datazen-driver-mysql --lib` passed (123/123), and `cargo test -p datazen-driver-mysql --test schema_objects_sql` passed (8/8). `cargo fmt --all -- --check` and `git diff --check` passed. Fresh WDIO verification remains pending.
- `cargo fmt --all -- --check` and `git diff --check` — passed.
- `cargo llvm-cov` is not installed in this environment, so changed-core coverage has not been measured here.

## Independent Tester

The Host implementation is ready for independent testing, but the feature is not yet release-ready: BUG-003 and BUG-005 await independent live re-test, and WDIO plus changed-core coverage remain unchecked. The Tester must exercise the real WDIO UI/IPC path and report database fixture cleanup evidence; this progress status does not claim those journeys have passed. `SERIAL`/`BIGSERIAL` creation is supported only when exact driver ownership/default usage metadata and a selected owner table operation prove the staged plan; unsupported/malformed attribution blocks before writes.
