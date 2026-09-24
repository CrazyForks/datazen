# BUG-005 — PostgreSQL deploy rejects unchanged reviewed FK plans as stale

- Status: `READY_FOR_TEST` (confirmed R3 defect is repaired; fresh independent retest pending)
- Severity: P1 — blocks ordinary PostgreSQL schema migration deploys for the affected FK journeys.
- Candidate: `14e8ca1a72b7be4e740696cd15b6cbcc0123f40e`
- Evidence: fresh independent serial WDIO run against local PostgreSQL.

## Reproduction and observed behavior

Two no-change journeys prepared and reviewed valid PostgreSQL target plans, then attempted deployment without any intervening target mutation:

1. Create missing parent/child tables and their FK. Deploy returned `Target schema changed for public.sd_dag_postgresql_missing_target_a_parent_muflxkej; compare again`.
2. Add an FK to an existing table. Deploy returned `Target schema changed for public.sd_dag_postgresql_missing_fk_a_parent_muflzszs; compare again`.

The plans were rejected as stale on their unchanged target. Neither plan deployed DDL. The corresponding MySQL create/FK and add-FK journeys passed in the same serial suite, which narrows the observed regression to the PostgreSQL reviewed-snapshot validation path.

## Expected behavior

An unchanged target must pass the reviewed-catalog guard and execute the reviewed migration. The deploy guard should still reject actual relation, schema, or FK changes made after review.

## Evidence boundary

This report confirms the false-stale behavior in the two PostgreSQL FK journeys. The PostgreSQL selected child-and-parent drop journey timed out on stale WebDriver element reads before its deploy assertions; the two late-dependent-after-review journeys also timed out. Those three cases are inconclusive and are not additional confirmed bugs. No stale or blocked plan was deployed.

Details and overall independent test results are in [TEST_FAILED.md](../TEST_FAILED.md).

## Coder repair handoff

- Reviewed snapshot validation now treats `public.table` at prepare and `table` plus separately supplied `public` schema at deploy as the same relation presentation, while checking the frozen full identity and comparing every other structural snapshot field.
- Differing qualified schemas, a different relation name, and a qualified reported identity for an unqualified reviewed relation still fail closed. Regression tests cover these cases and confirm that real FK/schema changes after review remain rejected before writes.
- Both unchanged PostgreSQL journeys are covered by focused command regressions: create missing parent/child tables plus FK, and add an FK to an existing table. Both are expected to reach deployment successfully without a false stale rejection.
- Serial instrumented suites passed: Host Schema Diff 173/173, Driver API 156/156, MySQL 116/116, PostgreSQL 132/132. Changed executable coverage is 588/688 (85.5%), including 70/85 lines in `reviewed.rs`. The 688-line denominator is the R3 658-line baseline plus 30 mapped executable lines added by this fix, using the same source exclusions. PostgreSQL `schema.rs` query-mapping lines remain 0/8 in this instrumented unit profile because live PG integration credentials were not configured in the repair worktree; the R3 Tester separately reported the opt-in live FK-introspection integration test passing 1/1 without instrumentation.
- Coder did not run WDIO. The new snapshot regression, actual post-review mutation rejection, and WDIO stale-element selector fixes require fresh independent retest before this bug can be marked passed.
