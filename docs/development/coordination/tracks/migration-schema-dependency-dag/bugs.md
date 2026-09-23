# migration-schema-dependency-dag Bugfix Handoff

All three findings from the prior independent Tester are fixed in this Coder changeset and await a fresh independent WDIO retest. The unsafe plans reported previously were not deployed.

## migration-schema-dependency-dag-BUG-001 — PostgreSQL create-table plan omits source FK (P1)

- Status: `READY_FOR_RETEST`
- Fix: PostgreSQL FK introspection now reads `pg_constraint` and pairs source/referenced columns by ordinal under the constraint OID. This avoids the previous `information_schema` many-to-many join and same-name constraint collision. Catalog query failures are surfaced rather than converted into an empty FK list.
- Regression coverage: `missing_tables_keep_source_foreign_keys_in_the_reviewed_plan`; opt-in `schema_foreign_key_introspection` driver integration test verifies the real PostgreSQL metadata path.
- Retest: run the registered `SD-DAG-postgresql-001` WDIO journey and verify the reviewed plan plus target constraint read-back.

## migration-schema-dependency-dag-BUG-002 — PostgreSQL existing-table FK difference gives empty plan (P1)

- Status: `READY_FOR_RETEST`
- Fix: the corrected PostgreSQL metadata now preserves source FK information for the existing table comparison, allowing the current planner to emit `ADD FOREIGN KEY`.
- Regression coverage: `existing_table_foreign_key_difference_creates_an_add_operation` and the PostgreSQL FK introspection integration test.
- Retest: run the registered `SD-DAG-postgresql-002` WDIO journey and verify reviewed SQL plus exactly one target FK after deployment.

## migration-schema-dependency-dag-BUG-003 — target-only dependent tables drop parent-first (P1)

- Status: `READY_FOR_RETEST`
- Fix: production plan preparation now passes the selected target-only table snapshots into planning. Known FK references form child-before-parent edges in the DropTable DAG before SQL rendering; ambiguous basename-only references and cycles produce an unsupported requirement rather than a guessed destructive plan.
- Regression coverage: `target_only_tables_drop_child_before_selected_parent_on_both_dialects`, `target_only_drop_refuses_basename_only_foreign_key_identity`, `explicit_table_drop_dependencies_place_dependent_before_referenced_table`, and `cyclic_table_drop_dependencies_fail_closed`.
- Retest: run `SD-DAG-postgresql-003` and `SD-DAG-mysql-003`; assert child drop precedes parent drop and both tables/FK are absent after deployment.

## Coder verification

- Host Schema Diff tests: 154 passed.
- Driver API migration tests: 15 passed.
- PostgreSQL driver tests: 132 library tests passed; integration/doc tests passed, two existing isolation-gated cases ignored.
- MySQL driver tests: 113 library tests passed; integration/doc tests passed.
- Opt-in real PostgreSQL FK introspection: 1 passed; unique fixtures cleaned up by the test.
- TypeScript typecheck passed. Coder did not run WDIO; that window is reserved for the fresh independent Tester.
- Changed-added-executable production lines: 90/107 covered (84.1%) by Rust source instrumentation and the focused unit/driver tests. PostgreSQL FK query execution was additionally exercised by the opt-in integration test. See `progress.md` for tool paths and per-file rates.
