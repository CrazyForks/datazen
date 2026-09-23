# migration-sync-unknown-outcome-reconciliation

Phase: PLANNED

- Task: classify Data Sync execution outcomes accurately and let users start a fresh, reviewable comparison from an unknown run
- Branch: `feature/migration-sync-unknown-outcome-reconciliation`
- Worktree: `.worktrees/datazen-migration-sync-unknown-outcome-reconciliation`
- Baseline: `codex/migration-navicat` at the latest integrated migration commit

## Scope

Current Data Sync keeps a conservative in-window write fence after an execution error and allows the user to inspect both endpoints again before creating a new plan. That is safe against blind replay, but it is not tied to run history. The history path also records broad execution failures as failed/unknown even when validation proves that no write started. This track makes those states accurate and gives an unknown history item a safe way to reopen the ordinary compare/review journey.

The recovery action must never retry the old plan, SQL, row payload, or transaction. It reconnects using stable connection identities, verifies the current endpoint context, starts a new inspection/comparison, and requires normal review and explicit execution confirmation. History stores references and status only; it must not store SQL, row values, credentials, or filter literals. If an original profile/revision is available, it may be referenced and must be revalidated. If ad-hoc scope cannot be reconstructed without persisting sensitive filter values, the UI must ask the user to reselect that scope before comparison.

## Acceptance criteria

- [ ] Data Sync distinguishes at least `not_started`, `committed`, `rolled_back`, and `unknown`; preflight/plan/context rejection is never recorded as an unknown write.
- [ ] An unknown result is emitted only after the executor enters a phase where writes may have reached the target and commit/rollback cannot be proven.
- [ ] Backward-compatible migration/history decoding preserves older records and presents interrupted in-flight runs as unknown without asserting that data was applied.
- [ ] History records contain enough stable endpoint/profile references to reopen the ordinary Sync flow, while excluding SQL, row values, secrets, and unreviewed execution payloads.
- [ ] The unknown-run action performs fresh connection/schema validation and comparison; changed or missing profile revisions require re-selection/review. It never reuses or executes the old plan.
- [ ] A failed or cancelled reconciliation leaves the run fenced. A successful reconciliation displays current differences and still requires the normal new-plan review/confirmation path.
- [ ] Rust tests inject preflight rejection, confirmed rollback, commit response loss after commit, commit response loss before commit, and rollback failure; history state must match only the evidence actually available.
- [ ] Frontend journey tests cover disabled execution while unknown, failed recompare, successful fresh compare, changed profile revision, and late/stale compare or cancel responses.
- [ ] PostgreSQL and MySQL WDIO journeys use controlled test-only fault injection to produce an unknown commit result, verify that the original operation is not replayed, and confirm the fresh compare/readback path.
- [ ] Host/driver/UI focused checks, changed-core coverage ≥80%, formatting, and `git diff --check` pass.

## Boundaries

- Do not infer whether individual rows from the old run committed; ordinary migration history does not retain row images or operation manifests.
- Do not automatically retry, resume, or mutate data from an unknown run.
- Do not change Data Transfer checkpoint/resume semantics or Schema Diff DDL rollback semantics.
- Preserve the shared migration-history API's existing meaning for Transfer and Schema Diff, or introduce a backward-compatible Sync-specific field rather than redefining shared outcomes.
- Do not persist ad-hoc filter literals merely to reconstruct a run. Require user reselection when those values are unavailable.

## Tester

Pending a fresh independent Tester after Coder handoff. The Tester must inspect the full state transition, independently rerun focused checks and PG/MySQL WDIO journeys, and file any defect before reporting `TEST_DONE`.

