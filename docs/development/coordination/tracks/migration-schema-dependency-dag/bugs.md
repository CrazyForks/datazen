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

- Status: `TEST_FAILED`
- Fix: production plan preparation now passes the selected target-only table snapshots into planning. Known FK references form child-before-parent edges in the DropTable DAG before SQL rendering; ambiguous basename-only references and cycles produce an unsupported requirement rather than a guessed destructive plan.
- Regression coverage: `target_only_tables_drop_child_before_selected_parent_on_both_dialects`, `target_only_drop_refuses_basename_only_foreign_key_identity`, `explicit_table_drop_dependencies_place_dependent_before_referenced_table`, and `cyclic_table_drop_dependencies_fail_closed`.
- Independent retest: MySQL `SD-DAG-mysql-003` passed; reviewed SQL dropped child before parent, deployment completed, and read-back found no fixture tables/FK. PostgreSQL `SD-DAG-postgresql-003` failed closed before deployment: the plan displayed no statements and an `Unsupported` requirement for `target-only-table-drop-order`. The FK's referenced-table identity was a bare table name while the selected target identity was `public.<name>`, so the exact identity check could not match them. Preserve schema identity from introspection (or resolve the reference unambiguously) before forming the DAG edge; do not weaken this to a basename-only match. The failed plan was not deployed.

## migration-schema-dependency-dag-BUG-004 — dropping only a referenced parent ignores an unselected FK child (P1)

- Status: `TEST_FAILED` (independently reproduced on PostgreSQL and MySQL)
- Evidence: plan-only WDIO journeys selected a target-only parent while leaving its FK child unselected. On both dialects, the plan had no blocking requirement and exposed an executable `DROP TABLE <parent>` statement. Neither plan was deployed. Each spec's `finally` removed its unique-prefix fixtures; PostgreSQL cleanup was additionally verified with a read-only `information_schema` count of zero. A first PostgreSQL retry used an invalid relative spec path and failed before fixture setup; it was later rerun successfully using the absolute spec path.
- Expected behavior: use the target schema snapshot's dependency boundary to block parent-only drops with an actionable requirement, or otherwise produce a plan that cannot issue a known-invalid drop. Do not deploy a parent-only plan while a known FK dependent remains outside the selected operation set.
- This is independent of BUG-003: ordering selected child and parent operations does not validate dependents omitted from the selection.

## Coder verification

- Host Schema Diff tests: 154 passed.
- Driver API migration tests: 15 passed.
- PostgreSQL driver tests: 132 library tests passed; integration/doc tests passed, two existing isolation-gated cases ignored.
- MySQL driver tests: 113 library tests passed; integration/doc tests passed.
- Opt-in real PostgreSQL FK introspection: 1 passed; unique fixtures cleaned up by the test.
- TypeScript typecheck passed. Coder did not run WDIO; that window is reserved for the fresh independent Tester.
- Changed-added-executable production lines: 90/107 covered (84.1%) by Rust source instrumentation and the focused unit/driver tests. PostgreSQL FK query execution was additionally exercised by the opt-in integration test. See `progress.md` for tool paths and per-file rates.

## Independent Tester verification

- Focused Host Schema Diff Rust tests: 154 passed, 0 failed. Driver API migration tests: 15 passed. PostgreSQL driver tests: 132 library tests passed; live FK-introspection integration: 1 passed. MySQL driver tests: 113 library tests and 4 cross-database integration tests passed; one existing DB-gated integration was skipped.
- TypeScript typecheck passed. Changed Rust files passed rustfmt; `git diff --check` passed. `cargo fmt --all -- --check` only reported ordering in generated, ignored `src-tauri/src/driver_init.rs`.
- Independent instrumented Host Schema Diff suite passed 154/154. Whole-file line rates: `plan.rs` 89.21%, `operation_dependencies.rs` 71.09%, `operation_dependency_references.rs` 81.12%, `dependencies.rs` 86.36%, and `commands/schema_diff.rs` 15.52% (includes substantial pre-existing code). PostgreSQL FK catalog query lines were observed executing twice and normalization once in the live integration binary. These are file-level measurements; they do not certify ≥80% coverage for every changed executable line.
- Six original WDIO journeys: 5 passed, 1 failed. Both PostgreSQL create/FK journeys and both MySQL create/FK journeys passed. MySQL target-only child/parent drop passed. PostgreSQL target-only drop failed closed as described under BUG-003. No unsafe/failed plan was deployed.
- The app used an isolated temporary app-data directory and port 4445; the global worker-database bootstrap was disabled. No fixture reset script or shared-database teardown was run. Unique-prefix schema fixtures were cleaned up, the temporary app-data directory was removed, and port 4445 was verified free at completion.
- DMG packaging is excluded from this feature's test gate.
