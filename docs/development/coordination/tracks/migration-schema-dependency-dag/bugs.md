# migration-schema-dependency-dag Bugfix Handoff

## BUG-003 — PostgreSQL target-only dependent tables were not ordered before parents

- Status: `READY_FOR_RETEST`
- Severity: P1
- Root cause: PostgreSQL FK introspection returned only the referenced table name and constrained the referenced relation schema to the child table schema. A reference such as `public.parent` therefore could not be matched safely to the selected target identity, and cross-schema references were omitted.
- Rescuer change: introspection now joins catalog rows by constraint schema and returns the referenced schema together with the table. The planner uses exact identities and orders selected dependent-child drops before selected parent drops. It never uses basename-only identity to invent an edge; unqualified same-basename PostgreSQL references fail closed.
- Regression coverage: Rust tests `target_only_table_drops_order_selected_children_before_parents_for_pg_and_mysql`, `postgres_target_drop_uses_exact_schema_identity_instead_of_basename`, and `postgres_target_drop_fails_closed_on_unqualified_same_basename_fk`; driver test `postgres_foreign_key_identity_preserves_referenced_schema`.
- WDIO to retest: `SD-DAG-postgresql-003` and `SD-DAG-mysql-003`. The parent-only safety journeys must remain plan-only.

## BUG-004 — Parent-only target drop ignored an unselected inbound FK child

- Status: `READY_FOR_RETEST`
- Severity: P1
- Root cause: plan preparation loaded schemas only for explicitly selected target-only tables, so a child table omitted from selection was invisible to dependency planning.
- Rescuer change: target-only planning now reads physical table schemas from the complete target database snapshot. PostgreSQL enumeration spans user schemas so cross-schema inbound FKs are included. If a known child is outside the selected target-only drop set, the plan contains a blocking requirement and omits the parent `DROP TABLE` statement. Snapshot failures or missing selected identities fail closed.
- Regression coverage: Rust test `target_only_parent_drop_is_blocked_by_unselected_fk_child_for_pg_and_mysql`; command identity tests cover schema-qualified, scoped bare-name, and ambiguous PostgreSQL selection.
- WDIO plan-only retests: `SD-DAG-postgresql-004`, `SD-DAG-mysql-004`, and `SD-DAG-postgresql-005` (child in another schema references selected `public` parent). Do not deploy these parent-only plans.

## Earlier findings

- BUG-001 — PostgreSQL source FK introspection: `TEST_PASS` in the prior independent handoff.
- BUG-002 — PostgreSQL existing-table FK difference: `TEST_PASS` in the prior independent handoff.

## Verification boundary

Coder Rust and TypeScript checks are recorded in `progress.md`. WDIO, app launch, live database journeys, and instrumented changed-core coverage remain for the independent Tester. No parent-only plan was deployed by the Coder.
