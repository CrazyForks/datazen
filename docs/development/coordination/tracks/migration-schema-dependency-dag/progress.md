# migration-schema-dependency-dag

Phase: PLANNED

## Scope

Replace fixed category ordering in Schema Diff execution plans with an explicit dependency graph for supported table operations, foreign keys, custom types, views, sequences, routines, and triggers. Respect exact object identity (including overload signature and trigger target relation) and dialect renderer capability.

Produce deterministic topological order for apply operations and a safe reverse order for rollback. Detect self/cross cycles, missing dependencies, ambiguous identities, and unsupported cross-dialect references before exposing an executable reviewed plan. Never invent a dependency edge or renderer result to make a plan appear complete.

## Acceptance criteria

- [ ] Supported object and table-operation dependencies are represented as typed identities and validated against selected source/target snapshots.
- [ ] Create/replace/drop ordering is derived from graph edges, not a single category rank; foreign-key and trigger/table ordering is correct in both directions.
- [ ] Cycles and unresolved/ambiguous references return actionable diagnostics before execution and do not produce a runnable plan.
- [ ] Ordering is deterministic for independent nodes; rollback order is the safe inverse only where the renderer supplies verified rollback SQL.
- [ ] Unit tests cover representative type→table→FK→view/routine→trigger chains, target-only drops, independent node stability, cycles, missing nodes, overloads, and unsupported renderers.
- [ ] PG/MySQL WDIO structure deployments validate dependency order and read back objects; SQLite remains blocked for operations lacking a renderer.

## E2E registration

- [ ] Dependency-chain deploy and reverse drop: 【本机可执行】 with real PostgreSQL and MySQL structures; include a view/routine/trigger chain where supported.
- [ ] Cycle and unresolved-object rejection: host plan tests, with UI error display journey registered if IPC fixtures permit.

## Self-validation

- Pending Coder.

## Independent Tester

- Pending fresh Tester; review every changed file, assess changed-core coverage (target at least 80%), rerun all checks and WDIO cases, and register all bugs before reporting.
