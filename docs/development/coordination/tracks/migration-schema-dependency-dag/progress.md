# migration-schema-dependency-dag

Phase: READY_FOR_TEST

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

- Coder implementation commit: `d0545a3d`.
- `CARGO_TARGET_DIR=target/cargo-wt RUST_TEST_THREADS=1 cargo test -p datazen --lib schema_diff::`: 148 passed, 0 failed after the final basename-only fail-closed regression.
- `npx vitest run src/windows/schema-diff/__tests__`: 47 passed.
- `npx tsc --noEmit`: passed.
- `cargo fmt --all -- --check` and `git diff --check`: passed after the module split.
- PostgreSQL/MySQL WDIO: not run by Coder; reserved for independent Tester.

## Independent Tester

- Pending fresh Tester. Review changed implementation and confirm coverage before attempting database WDIO. Current code only claims safety within payloads whose typed identities and explicit dependencies are available; do not sign off the combined-plan acceptance items above.
