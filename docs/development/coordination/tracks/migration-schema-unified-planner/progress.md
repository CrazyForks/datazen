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
- PostgreSQL's live view dependency catalog previously reported the selected view itself as a dependency. Host preserves the exact-identity self-cycle blocker; it does not normalize the row. Driver commit `371a04ebf5780ef81612992f2bea9b773fd1788f` fixes the catalog query and passed independent driver/API plus PostgreSQL/MySQL live checks; this commit is still pending integration into this worktree and must be revalidated here before WDIO acceptance.
- Opaque or incomplete driver catalogs remain blockers. MySQL routines/triggers and any unproven dependency kind must stay fail-closed until the driver supplies complete structured metadata.

## Host self-check before independent testing

- `CARGO_TARGET_DIR=target/cargo-unified-planner CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo check -p datazen --lib` — passed after sequence-phase wiring.
- `CARGO_TARGET_DIR=target/cargo-unified-planner CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p datazen --lib schema_diff::` — passed, 192/192.
- `CARGO_TARGET_DIR=target/cargo-unified-planner CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p datazen-driver-api --lib schema_migration::` — passed, 16/16.
- `cargo fmt --all -- --check` and `git diff --check` — passed.
- `cargo llvm-cov` is not installed in this environment, so changed-core coverage has not been measured here.

## Independent Tester

The Host implementation is ready for independent testing, but the feature is not yet release-ready: the driver view self-reference fix is pending integration and verification in this worktree, and WDIO plus changed-core coverage remain unchecked. The Tester must exercise the real WDIO UI/IPC path and report database fixture cleanup evidence; this progress status does not claim those journeys have passed. `SERIAL`/`BIGSERIAL` creation is supported only when exact driver ownership/default usage metadata and a selected owner table operation prove the staged plan; unsupported/malformed attribution blocks before writes.
