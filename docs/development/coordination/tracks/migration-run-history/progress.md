# Migration Run History Track

- Phase: READY_FOR_TEST
- Branch: `feature/migration-run-history`
- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-run-history`
- Scope: shared, sanitized migration run history for Schema Diff, Data Sync, and Data Transfer
- Scheduler: explicitly out of scope
- Commit: pending (set by this track's final commit)
- Verification:
  - `cargo test -p datazen --lib`: 1613 passed, 3 ignored
  - migration history storage recovery/security test: 1 passed
  - history/profile fail-closed command tests: 3 passed
  - migration command Vitest suites: 30 passed
  - `npx tsc --noEmit`: passed
  - `cargo fmt --all -- --check`: passed
  - `git diff --check`: passed

## Notes

- History records must never contain SQL, row payloads, credentials, runtime `dbSessionId` values, or file tokens.
- A persisted `running` record is recovered as `interrupted` with an `unknown` outcome on startup.
- Profile-backed execution must bind and validate the profile id and `updatedAt` revision at the server boundary.
- Schema Diff, Data Sync, and Data Transfer execution now share the same history model and UI; scheduler integration remains the explicitly separate next track.
