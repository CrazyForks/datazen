# migration-schema-unified-planner

Phase: PLANNED

- Task: One reviewed Schema Diff deployment plan across selected object kinds
- Branch: `feature/migration-schema-unified-planner`
- Worktree: pending after the dependency-DAG track passes independent review

## Scope

The current Host exposes independent reviewed plans for table operations, views, routines/triggers, sequences, and custom types. Implement a single host-owned planning boundary that accepts one immutable source/target snapshot plus selected operations across the supported kinds, builds one typed dependency graph, and returns one deterministic reviewed execution plan. It must reuse each driver's verified renderers and the dependency validation established by `migration-schema-dependency-dag`; it must not infer dependencies from opaque SQL or promise cross-dialect translation without a renderer contract.

An unselected dependency may be accepted only when the target snapshot proves it already exists with the required identity. Missing, ambiguous, cyclic, unsupported, or stale dependencies must block execution before writes. Apply order and reverse rollback must respect cross-kind edges. The UI must show one reviewable cross-kind order and the existing stale-plan, target-snapshot, approval, and unknown-outcome rules must continue to apply.

## Acceptance criteria

- [ ] One immutable reviewed plan can contain supported table/FK, custom type, view, sequence, routine, and trigger operations without split independent execution plans.
- [ ] Cross-kind dependency edges are validated from exact structured identities; unselected dependencies require proof in the target snapshot, and opaque dependencies fail closed.
- [ ] The plan reports actionable unresolved, ambiguous, unsupported, and cyclic dependency diagnostics and cannot be executed when any blocking requirement remains.
- [ ] Apply order is deterministic and topological across kinds; rollback is a safe reverse order only when the renderer supplies verified rollback SQL.
- [ ] Existing review confirmation, destructive approval, plan fingerprinting, source/target schema revalidation, and unknown transaction outcome behavior cover the unified plan.
- [ ] Unit tests cover type→table→FK→view/routine→trigger chains, existing-target dependencies, cross-kind replacements/drops, cycles, missing/ambiguous nodes, stale snapshots, and partial rollback availability.
- [ ] PostgreSQL and MySQL WDIO journeys create and drop a mixed object chain through one reviewed plan, read back the deployed objects, and prove invalid graphs write nothing.
- [ ] Changed-core coverage reaches at least 80%; Host/driver/UI checks and formatting pass.

## Independent Tester

Pending. This track must start only after the dependency-DAG track is integrated so the Tester can exercise the final shared graph implementation.
