# BUG-005 — PostgreSQL deploy rejects unchanged reviewed FK plans as stale

- Status: `PASSED` (R4 independently confirmed the repair; see [R4 report](../progress.md#fresh-independent-tester-r4))
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
- The original Coder handoff did not include WDIO; the independent R4 run below subsequently validated the unchanged-FK and stale-catalog paths.

## Independent retest (R4)

- Fix candidate: `e71d0a550b9e3f9eb99a507f415bd228065305d`.
- The final full serial WDIO run passed all 10 journeys. `SD-DAG-postgresql-001` deployed missing parent/child tables plus their FK, and `SD-DAG-postgresql-002` added an FK to existing tables; both read back one FK without any target mutation between review and deploy. MySQL equivalents also passed.
- Two earlier fresh runs initially reported test-side problems: WebKit plan-text element reads timed out, then the stale-catalog test's same-ID mutation connection invalidated the reviewed session. The test now reads the exact plan nodes through `browser.execute` and performs post-review DDL using a distinct alias to the same database. With these test setup corrections, the no-change PostgreSQL plans and both dialects' late-dependent guards pass. No production-code change was needed in the Tester worktree.
- Instrumented changed executable coverage: 588/688 (85.5%), including `reviewed.rs` 70/85. The R4 progress section records the full subset arithmetic, source exclusions, focused suite counts, catalog metrics, and cleanup evidence.
- BUG-005 is resolved for the observed unchanged-FK cases. The separate combined-plan/unified-planner release blocker remains open.
