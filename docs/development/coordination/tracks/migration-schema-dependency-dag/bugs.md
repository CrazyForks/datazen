# migration-schema-dependency-dag Bugfix Handoff

The Coder changeset addresses the three earlier findings; independent retest results and newly discovered boundaries are recorded below. No unsafe or failed plan was deployed.

## migration-schema-dependency-dag-BUG-001 — PostgreSQL create-table plan omits source FK (P1)

- Status: `TEST_PASS`
- Fix: PostgreSQL FK introspection now reads `pg_constraint` and pairs source/referenced columns by ordinal under the constraint OID. This avoids the previous `information_schema` many-to-many join and same-name constraint collision. Catalog query failures are surfaced rather than converted into an empty FK list.
- Regression coverage: `missing_tables_keep_source_foreign_keys_in_the_reviewed_plan`; opt-in `schema_foreign_key_introspection` driver integration test verifies the real PostgreSQL metadata path.
- Independent retest: `SD-DAG-postgresql-001` passed in WDIO; reviewed SQL included the FK after its referenced table, deployment completed, and target introspection read back exactly one FK.

## migration-schema-dependency-dag-BUG-002 — PostgreSQL existing-table FK difference gives empty plan (P1)

- Status: `TEST_PASS`
- Fix: the corrected PostgreSQL metadata now preserves source FK information for the existing table comparison, allowing the current planner to emit `ADD FOREIGN KEY`.
- Regression coverage: `existing_table_foreign_key_difference_creates_an_add_operation` and the PostgreSQL FK introspection integration test.
- Independent retest: `SD-DAG-postgresql-002` passed in WDIO; reviewed SQL included the missing FK, deployment completed, and target introspection read back exactly one FK.

## migration-schema-dependency-dag-BUG-003 — target-only dependent tables drop parent-first (P1)

- Status: `READY_FOR_TEST` (previous independent retest failed PostgreSQL; fresh retest pending)
- Fix: production plan preparation now passes the selected target-only table snapshots into planning. Known FK references form child-before-parent edges in the DropTable DAG before SQL rendering; ambiguous basename-only references and cycles produce an unsupported requirement rather than a guessed destructive plan.
- Regression coverage: `target_only_tables_drop_child_before_selected_parent_on_both_dialects`, `target_only_drop_refuses_basename_only_foreign_key_identity`, `explicit_table_drop_dependencies_place_dependent_before_referenced_table`, and `cyclic_table_drop_dependencies_fail_closed`.
- Independent retest: MySQL `SD-DAG-mysql-003` passed; reviewed SQL dropped child before parent, deployment completed, and read-back found no fixture tables/FK. PostgreSQL `SD-DAG-postgresql-003` failed closed before deployment: the plan displayed no statements and an `Unsupported` requirement for `target-only-table-drop-order`. The FK's referenced-table identity was a bare table name while the selected target identity was `public.<name>`, so the exact identity check could not match them. Preserve schema identity from introspection (or resolve the reference unambiguously) before forming the DAG edge; do not weaken this to a basename-only match. The failed plan was not deployed.
- Coder repair: PostgreSQL FK introspection now returns `ref_schema.ref_table`; MySQL `SHOW CREATE TABLE` parsing retains the full `REFERENCES database.table` path. Dependency analysis compares schema/database-qualified identity while DROP rendering keeps the target database's normal relation name. Same-basename relations in different MySQL databases never create a guessed edge.
- Coder regression coverage: Host tests assert PostgreSQL/MySQL selected child-before-parent order, strict basename rejection, and MySQL same-basename relations across databases. The corrected PostgreSQL live metadata fixture passed 1/1 previously; fresh WDIO plan/deploy/read-back remains required.

## migration-schema-dependency-dag-BUG-004 — dropping only a referenced parent ignores an unselected FK child (P1)

- Status: `READY_FOR_TEST` (previously reproduced on PostgreSQL and MySQL; fresh retest pending)
- Evidence: plan-only WDIO journeys selected a target-only parent while leaving its FK child unselected. On both dialects, the plan had no blocking requirement and exposed an executable `DROP TABLE <parent>` statement. Neither plan was deployed. Each spec's `finally` removed its unique-prefix fixtures; PostgreSQL cleanup was additionally verified with a read-only `information_schema` count of zero. A first PostgreSQL retry used an invalid relative spec path and failed before fixture setup; it was later rerun successfully using the absolute spec path.
- Expected behavior: use the target schema snapshot's dependency boundary to block parent-only drops with an actionable requirement, or otherwise produce a plan that cannot issue a known-invalid drop. Do not deploy a parent-only plan while a known FK dependent remains outside the selected operation set.
- This is independent of BUG-003: ordering selected child and parent operations does not validate dependents omitted from the selection.
- Coder repair: plan preparation reads the complete target dependency catalog before exposing destructive table-drop SQL. PostgreSQL scans all target schemas; bare PostgreSQL selections use the proven target schema context (`default_schema()` is `public`). MySQL scans every database only after the active identity proves a direct global `SELECT ON *.*` or `ALL PRIVILEGES ON *.*` grant and `SHOW GRANTS` contains no `REVOKE`. Role-only grants and partial revokes fail closed. The catalog includes exact schema/database identities for unselected child tables.
- Before any reviewed table DROP, deploy re-enumerates the complete catalog under the same visibility gate and 30-second timeout, compares the exact relation identity set, and validates every frozen schema/FK snapshot before issuing DDL. A newly created inbound-FK child after review is rejected as a catalog change; no table is dropped.
- If dependency scope is not provably complete, any catalog read errors, or its bounded 30-second read times out, the planner exposes an actionable unsupported requirement with no statements; the UI cannot deploy it. No automatic cascade is used.
- WDIO boundary specs now wait for the blocker, assert no statements and disabled deploy, and read back that fixture tables/FK remain. New PostgreSQL/MySQL stale-catalog journeys prepare an executable parent-only drop, add a dependent child after review, attempt deployment, and assert rejection plus parent/late-child/FK read-back. MySQL journeys explicitly skip when the visibility gate blocks planning; Tester must record the skip separately from pass and rerun with direct global SELECT/ALL and no partial revokes to verify the positive drop path.

## Coder verification

- Host Schema Diff tests: 154 passed.
- Driver API migration tests: 15 passed.
- PostgreSQL driver tests: 132 library tests passed; integration/doc tests passed, two existing isolation-gated cases ignored.
- MySQL driver tests: 113 library tests passed; integration/doc tests passed.
- Opt-in real PostgreSQL FK introspection: 1 passed; unique fixtures cleaned up by the test.
- TypeScript typecheck passed. Coder did not run WDIO; that window is reserved for the fresh independent Tester.
- Changed-added-executable production lines: 90/107 covered (84.1%) by Rust source instrumentation and the focused unit/driver tests. PostgreSQL FK query execution was additionally exercised by the opt-in integration test. See `progress.md` for tool paths and per-file rates.

## BUG-003/004 repair verification

- `CARGO_TARGET_DIR=target/cargo-wt ... cargo test -p datazen --lib schema_diff:: -- --test-threads=1`: 162 passed, 0 failed. Coverage includes PG/MySQL child-first drops, bare PostgreSQL selection with schema-qualified catalog identity, unselected-dependent blocking with zero statements, paired child retained/removed FK boundaries, strict MySQL cross-database identity with same-basename relations, and stale relation/schema catalog rejection.
- `cargo test -p datazen-driver-api --lib schema_migration -- --test-threads=1`: 15 passed. The new full-catalog visibility capability has a compatibility-safe default and is forwarded by `ReuseDriver`.
- `cargo test -p datazen-driver-postgres -- --test-threads=1`: 132 library tests passed; driver integration/doc tests passed, with existing isolated-fixture tests ignored. Opt-in live PostgreSQL FK introspection previously passed 1/1 after the schema-qualified query change.
- `cargo test -p datazen-driver-mysql -- --test-threads=1`: 115 library tests passed, including qualified FK parsing and grant-gate tests; 4 cross-database integration tests and package integration/doc checks passed.
- Host `pnpm exec tsc --noEmit` passed. E2E project typecheck still reports unrelated pre-existing shared-helper/spec/generated-alias diagnostics; no diagnostics reference `schema-diff-dependency-order.ts`. Prettier and `git diff --check` passed. Coder did not run WDIO.
- Full-catalog scan latency was not measured on a representative large database by Coder; the scanner logs `table_count` and `elapsed_ms`, and aborts after 30 seconds. Fresh Tester must record realistic catalog scan duration and independently verify deployment disable/read-back.

## Independent Tester verification

- Focused Host Schema Diff Rust tests: 154 passed, 0 failed. Driver API migration tests: 15 passed. PostgreSQL driver tests: 132 library tests passed; live FK-introspection integration: 1 passed. MySQL driver tests: 113 library tests and 4 cross-database integration tests passed; one existing DB-gated integration was skipped.
- TypeScript typecheck passed. Changed Rust files passed rustfmt; `git diff --check` passed. `cargo fmt --all -- --check` only reported ordering in generated, ignored `src-tauri/src/driver_init.rs`.
- Independent instrumented Host Schema Diff suite passed 154/154. Whole-file line rates: `plan.rs` 89.21%, `operation_dependencies.rs` 71.09%, `operation_dependency_references.rs` 81.12%, `dependencies.rs` 86.36%, and `commands/schema_diff.rs` 15.52% (includes substantial pre-existing code). PostgreSQL FK catalog query lines were observed executing twice and normalization once in the live integration binary. These are file-level measurements; they do not certify ≥80% coverage for every changed executable line.
- Six original WDIO journeys: 5 passed, 1 failed. Both PostgreSQL create/FK journeys and both MySQL create/FK journeys passed. MySQL target-only child/parent drop passed. PostgreSQL target-only drop failed closed as described under BUG-003. No unsafe/failed plan was deployed.
- The app used an isolated temporary app-data directory and port 4445; the global worker-database bootstrap was disabled. No fixture reset script or shared-database teardown was run. Unique-prefix schema fixtures were cleaned up, the temporary app-data directory was removed, and port 4445 was verified free at completion.
- DMG packaging is excluded from this feature's test gate.
