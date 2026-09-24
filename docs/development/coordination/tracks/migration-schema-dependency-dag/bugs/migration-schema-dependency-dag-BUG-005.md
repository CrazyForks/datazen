# BUG-005 — PostgreSQL deploy rejects unchanged reviewed FK plans as stale

- Status: `CONFIRMED`, `TEST_FAILED`
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
