# Migration Navicat implementation

Base: cf91bc7618ad1815004fe529d28f8f6149c7b232. Integration: codex/migration-navicat.

User scope: complete migration trio with product capabilities matching Navicat 17 and verified correctness. Do not equate a first wave of fixes with scope completion. Main checkout changes must remain untouched.

## Waves

1. Correctness in three disjoint modules: sync-core (F01/F03/F05/F10/F12), transfer-core (F02/F04/F07/F08/F11), schema-core (F06/F07/F09).
2. Shared driver capabilities, relation/column identity and immutable backend plan/run contracts; source/target identity, atomicity and actual affected rows.
3. Object ecosystem, dependencies, same-family preservation; transfer filtering, chunking, file targets, transactional writes; Sync key/field mapping, cursor results and optimistic conflict handling.
4. Profiles, run history, Workflow integration, unified migration context and complete review/execute UX.
5. Driver breadth and full acceptance matrix. Current registry has SQL Server/MongoDB but no Oracle/Snowflake: these require explicit driver implementation, not pretending they are supported.
6. Independent testers and actual database journeys, fault injection, scaling benchmarks and regression, then final acceptance audit.

## Non-negotiable acceptance

No unapproved rows written, no lossy bytes/numerics or ordinal guesses; preview matches applied immutable plan. Primary key/index replacement dependency closure. Objects/constraints preserved or explicitly blocked. Readonly and physical self-target checks enforced backend. Compare/apply detects stale plans and changed target rows. Bounded compare memory, stable scanning, precise partial/unknown status and meaningful cancellation. Resumability advertised only where commit/checkpoint or idempotence proven. Persistent configs use connectionId; dbSessionId never persisted.

Navicat parity features: supported database scope declared explicitly; table/field/key mapping; object-level compare/select; side-by-side review; data filters/recordsets; transaction/error/batch controls; SQL-file target; profile/batch workflow/history; full object coverage within driver capability. CDC and arbitrary cross-category conversion are not Navicat parity requirements.

## Testing

Independent fresh Tester after each coder READY_FOR_TEST. Driver-specific tests stay in drivers; Host tests for general orchestration/UI. Fault, cancel, stale, selection and mapping journeys required. Build E2E through pnpm tauri:build:webdriver only. No pnpm install on shared node_modules. No fabricated coverage or DB test claims.

## Progress

The integration branch now contains the immutable plan, stable key/recordset, source-filter, lossless export, SQL-file target, object catalog, view, safety, live workflow and profile waves for the migration trio. The latest target-only Schema Diff picker wave is independently verified and integrated. The post-merge full Host Rust suite passed 1645 tests with 3 ignored; the focused Schema Diff suite passed 96/96 and the related frontend/type checks passed.

Remaining parity work is concrete rather than a claim of full Navicat equivalence: table options, routine/trigger migration renderers, sequence translation, cross-dialect view translation, stable snapshot and bounded comparison storage, conflict force/skip/recompare policy, broader object dependency preservation, Windows packaging/publication validation, live database journeys unavailable in this environment, and drivers outside the currently registered set. CHECK constraints are now covered for PostgreSQL/MySQL rendering and SQLite fail-closed behavior. Profiles, shared run history and host-owned workflow execution are already integrated. Main checkout changes remain untouched; the preserved transfer-plan and FK-prediction worktrees are not part of this integration branch.

Detailed continuation contracts and isolated testing instructions are in [migration-navicat-next-waves.md](migration-navicat-next-waves.md).
