# migration-schema-dependency-dag

Phase: READY_FOR_RETEST

## Scope

Add a validated, deterministic dependency DAG to the Schema Diff planners where current operation payloads provide structured identities and dependency evidence. Keep operation identity typed by schema object kind and its defining attributes, order known dependencies before rendering, and reject cycles, duplicate/ambiguous identities, and references that can only be guessed from an unqualified basename. Provide a guarded inverse-order primitive that accepts rollback only when the apply order is valid and every node has renderer-provided rollback SQL; existing plan payloads continue to report per-statement rollback completeness.

This track covers the existing independent planner boundaries. It does **not** implement a combined reviewed plan across all selected object kinds; see the release blocker below.

## Implemented boundaries

- Table-operation planning uses typed object identities and a deterministic topological sort. Known edges include create-table before same-table changes/FKs/triggers, create custom type before a table/column that uses that exact type, FK/key/index tightening and removal order, and trigger removal before its target table is dropped.
- View, routine/trigger, sequence, and type standalone plans pass their operations through the same deterministic DAG identity/validation layer instead of relying on the previous category-priority sort.
- Ambiguous or basename-only table/type/trigger references fail closed. Planner errors become unsupported requirements before renderer output is exposed.
- Rollback helper validates the supplied apply order and rollback availability before returning a reverse sequence.
- Unit coverage includes a typed custom-type → table → FK/trigger chain, overload and trigger-target identity distinctions, qualified versus unqualified reference behavior, deterministic independent nodes, graph error cases, rollback gating, and planner rejection.
- Implementation is split into a small compatibility facade, DAG/order logic, and relation/type reference validation modules; no source module in this track exceeds 600 lines.

## Acceptance criteria

- [ ] A combined reviewed plan represents supported dependencies across all selected table, view, routine, trigger, sequence, and type operations and validates them against source/target snapshots.
- [ ] Dependencies inside opaque view/routine SQL bodies are extracted or supplied as driver metadata; unresolved references block execution instead of being silently omitted.
- [ ] End-to-end mixed-kind apply and reverse drop are verified on PostgreSQL and MySQL using WDIO, with rendered SQL and read-back assertions.
- [ ] Independent Tester review confirms changed-core coverage ≥80%, re-runs focused checks, executes the supported WDIO cases, and files any bugs.

The targeted graph and planner unit tests below pass, but they do not satisfy these cross-category and live-database acceptance items. Do not mark this track PASSED until its supported boundary is independently reviewed; do not treat that result as closing the unified-plan release blocker.

## Release blocker: no unified cross-category reviewed plan

The current IPC exposes separate prepare paths: `prepare_schema_diff_plan` for table operations and independent `prepare_schema_view_plan`, `prepare_schema_routine_trigger_plan`, `prepare_schema_sequence_plan`, and `prepare_schema_type_plan` paths. The Schema Diff UI does not collect these selected kinds into one plan/deploy request or one reviewed snapshot. Consequently, each standalone plan can order only operations in its own payload; table ↔ view/routine ↔ sequence/type dependencies are not globally ordered or validated, and SQL-body references cannot be proven from these payloads. A deterministic order inside these API boundaries is not evidence that a mixed migration is safe.

The follow-on work is tracked at [migration-schema-unified-planner](../migration-schema-unified-planner/progress.md). It must add a host-owned combined plan/deployment boundary, carry typed selections and source/target snapshots through review and execution, and reject dependencies that cannot be resolved. This is a release blocker even if the current DAG track passes independent review.

## E2E registration

- [ ] Tester: WDIO PostgreSQL and MySQL case for supported table-structure dependency order (create/drop table, FK, custom type, trigger) with database read-back.
- [ ] Tester: WDIO rejection path for an unsafe / unsupported renderer and visible actionable plan error.
- [ ] Follow-on unified-planner track: mixed table/object selection and deploy journey across supported kinds; register its cross-category cases there.

## Self-validation

- Original Coder implementation commit: `d0545a3d`; this bugfix changeset is being prepared for independent retest.
- BUG-001: PostgreSQL foreign-key introspection now pairs `pg_constraint` column arrays by ordinal and constraint OID; query failures return an error rather than silently presenting an empty FK set.
- BUG-002: source FK metadata now reaches the existing FK diff planner, which produces the reviewed `ADD FOREIGN KEY` operation for a missing target constraint.
- BUG-003: selected target-only table snapshots add explicit dependent-child-before-referenced-parent edges before rendering `DROP TABLE`; ambiguous basename-only identities fail closed.
- Regression tests cover source FK retention for absent tables, FK addition for existing tables, PG/MySQL child-first target drops, ambiguous-reference rejection, and graph-cycle rejection.
- `CARGO_TARGET_DIR=target/cargo-wt RUST_TEST_THREADS=1 cargo test -p datazen --lib schema_diff:: -- --test-threads=1`: 154 passed, 0 failed.
- `cargo test -p datazen-driver-api --lib schema_migration -- --test-threads=1`: 15 passed.
- `cargo test -p datazen-driver-postgres -- --test-threads=1`: 132 library tests passed; integration/doc tests passed, with two existing isolation-gated tests ignored.
- `cargo test -p datazen-driver-mysql -- --test-threads=1`: 113 library tests passed; integration/doc tests passed.
- Opt-in PostgreSQL FK-introspection integration test: 1 passed using the authorized local `datazen_sync_src` database and unique `dz_mig_fk_*` fixtures; test teardown removed the fixtures.
- `npx tsc --noEmit`: passed. WDIO was not run by Coder and remains reserved for a fresh independent Tester.
- Coverage attempt used `RUSTFLAGS=-Cinstrument-coverage`, `CARGO_INCREMENTAL=0`, and CommandLineTools `xcrun llvm-profdata` / `xcrun llvm-cov`. On newly added executable production lines, 90/107 were covered (84.1%): `plan.rs` 70/82, `operation_dependencies.rs` 14/15, `dependencies.rs` 5/5, `schema.rs` 1/1, and `commands/schema_diff.rs` 0/4. The changed command wrapper lines require the independent WDIO run; the driver query itself was exercised by the opt-in integration test. Whole-file rates include pre-existing code and are lower in `operation_dependencies.rs` (71.1%) and PostgreSQL `schema.rs` (49.7%).
- `rustfmt --edition 2021 --config skip_children=true --check` on changed Rust sources, `git diff --check`, and `npx tsc --noEmit`: passed.

## Independent Tester

- The prior independent run reported BUG-001..003 as `TEST_FAILED`; the fixes below are now `READY_FOR_RETEST`. A fresh Tester must re-run the focused checks and the registered PG/MySQL WDIO journeys with plan SQL and read-back assertions before closing this track.
- This changeset does not close the separate combined-plan/unified-planner release blocker above.
