# migration-transfer-chunk-resume

- Phase: PLANNED
- Task: bounded, resumable Data Transfer chunks within a table
- Branch: `feature/migration-transfer-chunk-resume`
- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-transfer-chunk-resume`
- Base: `codex/migration-navicat` after Schema Unified Planner R11 merge

## Scope

Extend Data Transfer's existing table-boundary checkpoint to bounded checkpoints inside a table. A resumed plan must carry a deterministic source ordering/key contract and preserve its reviewed mapping and target identity. A checkpoint becomes durable only after the corresponding target chunk is confirmed committed. If commit or rollback acknowledgement is unknown, fail closed, fence later writes, and reject replay of the uncertain chunk until the user performs a fresh review/reconciliation path.

The initial supported live journey is PostgreSQL↔MySQL, in both directions. A driver may advertise in-table resume only when it can provide the stable ordered read contract; unsupported tables and drivers keep the existing table-boundary path with an actionable explanation.

## Acceptance

- Keyset pagination uses an exact stable unique key (including composite primary keys); no OFFSET checkpoint is used.
- The immutable plan/fingerprint binds the key order, source/target table identities, mappings, chunk size, and resume state. Changed plans or endpoints cannot consume an old checkpoint.
- Chunk commit acknowledgement precedes checkpoint persistence. Failure before commit leaves the previous checkpoint reusable; confirmed commit advances it exactly once; unknown commit/rollback outcome fences all later writes and prevents uncertain replay.
- Interruption at multiple chunk boundaries resumes without duplicate or skipped source keys, proven by exact source/target readback in isolated PostgreSQL↔MySQL WDIO journeys.
- Fault-injected commit acknowledgement loss, rollback failure, stale checkpoint, changed source key/order, and exhausted source are covered. Fixture cleanup is exact and no shared-database reset runs.
- Added bounds and failure reasons are visible in the review UI; memory remains bounded by the configured chunk and documented metadata overhead.
- Changed executable production-line coverage is at least 80%; relevant Rust, driver, Vitest, TypeScript, formatting, and WDIO checks pass.

## Constraints

- Work only in the dedicated worktree and branch above. Run `pnpm install` there and keep `node_modules` physical and local to that worktree.
- Do not use `black-box-tester`; verify UI journeys with WDIO.
- Do not repair another product track in parallel. SQL-file packaging/DMG work is excluded from this feature gate.
- Keep heterogeneous schema mapping as a later Data Transfer track. Do not claim resumability for a driver/table until its ordered-read and transaction behavior is proven.
