# migration-schema-dependency-dag

Phase: READY_FOR_TEST

## Current Rescuer scope

This handoff is limited to BUG-003 and BUG-004 in the integrated table-drop path. It does not replace the current implementation with the older DAG branch.

- [x] PostgreSQL FK metadata preserves both referenced schema and table identity, including cross-schema references.
- [x] Selected target-only drops are ordered dependent-child before referenced-parent using exact relation identities.
- [x] A drop is withheld from the executable plan when a known inbound FK child is not included in the selected target-only drops, or dependency identity cannot be verified.
- [x] PostgreSQL and MySQL planner unit coverage includes ordered drops and blocked parent-only drops; PostgreSQL also covers exact schema identity and unqualified-reference rejection.
- [x] WDIO plan-only journeys added for parent-only drops on PostgreSQL/MySQL and for a PostgreSQL child in another schema. The dangerous parent-only plans are never deployed.
- [x] E2E fixtures use unique names and direct `finally` cleanup; no reset or shared teardown helper is used.

## Remaining track scope

The broader dependency-DAG track is not complete. Cross-category planning for views, routines, triggers, sequences, custom types, and opaque SQL-body references remains separate follow-up work. The current patch closes the two reported target-only table-drop defects only.

- [ ] Represent all supported object and table-operation dependencies in a unified typed graph.
- [ ] Validate cross-category ordering, cycles, missing references, and renderer support before exposing a complete plan.
- [ ] Add broader dependency-chain coverage for views/routines/triggers and other supported objects.

## Coder validation

- `cargo test -p datazen --lib target_only -- --nocapture`: 16 passed, 0 failed. Cargo used the shared integration target at `.worktrees/datazen-migration-navicat/target/cargo-wt`.
- `cargo test -p datazen-driver-postgres --lib postgres_foreign_key_identity_preserves_referenced_schema -- --nocapture`: 1 passed, 0 failed.
- `pnpm exec tsc --noEmit`: passed.
- Changed Rust files passed scoped `rustfmt`; the WDIO spec passed Prettier; `git diff --check` passed.
- Coder did not run WDIO or launch the app. Instrumented changed-core coverage was not measured; independent Tester owns coverage assessment and WDIO verification.

## Independent Tester

- Pending. Retest BUG-003/004 on PostgreSQL and MySQL, including PostgreSQL cross-schema inbound-FK coverage. Never deploy parent-only blocked plans. Reassess changed-core coverage (target ≥80%) and report any remaining limitation.
