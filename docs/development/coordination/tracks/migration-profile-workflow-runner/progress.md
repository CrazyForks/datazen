# Migration Profile Workflow Runner

- Phase: READY_FOR_TEST
- Branch: `feature/migration-profile-workflow-runner`
- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-profile-workflow-runner`
- Scope: host-owned Workflow migration steps for Data Transfer, Data Sync and Schema Diff
- Scheduler: reuses the existing interval scheduler; SQL-file profiles require a per-run token variable
- Verification: focused migration Rust 2/2, workflow frontend 48/48, `cargo check -p datazen --lib`, TypeScript, rustfmt and diff checks passed

## Safety contract

- Profile IDs and revisions are resolved from persisted connection IDs; runtime session IDs are never persisted.
- Destructive unattended execution defaults to reject and requires an explicit workflow step policy.
- SQL-file destination tokens are supplied per run and redacted from workflow history; profile records never store them.
- Migration steps use the existing immutable plan and migration run history services rather than Driver Commands.

## Known limits

- Live scheduled runs against external PostgreSQL/MySQL fixtures and packaged desktop scheduler journeys remain R-stage work.
- SQL-file scheduled runs need an external per-run token provider; a missing token fails closed.
