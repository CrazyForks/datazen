# Data migration trio release-gap plan

Scope: Data Sync, Data Transfer, and Schema Diff. Integration branch: `codex/migration-navicat` (`main` is an ancestor). Last reviewed: 2026-09-25. Only one product track is actively being implemented at a time, following the user's instruction. DMG packaging is excluded from the feature gate by the explicit user instruction recorded in `AGENTS.md`.

## Delivered and verified

### Data Sync

- Same-family comparison, paged review and cross-page selection, filters, conflict policies, profiles, run history, and server-owned plans.
- Private indexed comparison storage with orphan recovery and disk-pressure failure handling; live comparison accepts large row sets without retaining all rows in host memory.
- Composite primary-key tuple selection, validated for PostgreSQL and MySQL. Selection is distinct from resume checkpoints.
- Execution generates selected SQL pages incrementally inside one target transaction. A roughly 68 MiB ten-page PostgreSQL journey and late-page conflict rollback passed WDIO. The SQL preview remains a full IPC response capped at 16 MiB.
- Unknown execution outcomes block plan replay and require fresh inspection/reconciliation for the tested PostgreSQL/MySQL paths.

### Data Transfer

- Cross-dialect parameterized value transfer, filters/mapping, SQL file publication, schema dependency ordering, profiles, recordsets, encoding/compression, and table-boundary resume.
- Composite tuple recordsets and UTF-8/binary correctness passed independent PostgreSQL↔MySQL WDIO journeys.
- Per-table unknown transaction outcomes are fenced: uncertain outcomes stop later writes, consume the old plan/resume token, and require review before another run. Independent PostgreSQL/MySQL fault-injection journeys passed.

### Schema Diff

- Reviewed table operations, CHECK constraints, supported table options, same-dialect views, supported PostgreSQL/MySQL routines/triggers, PostgreSQL sequences and custom types, target-only table selection, and fail-closed renderer/identity checks.
- A typed deterministic dependency DAG now guards supported standalone planner boundaries. PostgreSQL/MySQL create/FK/drop ordering and post-review catalog changes passed 10/10 fresh WDIO journeys; changed executable production-line coverage is 588/688 (85.5%). The fix is merged as `6210b2ec`.
- One Host-owned reviewed deployment plan now covers selected tables/FKs, custom types, views, sequences, routines, and triggers. R11 independently passed all six PostgreSQL/MySQL WDIO journeys, including mixed deploy/readback, exact dependency blockers, and a CHECK OPTION zero-write blocker; changed Driver API core files exceed 80% line coverage. See `tracks/migration-schema-unified-planner/progress.md` and `test-results/unified-planner-retest-r11.md`.

## Remaining work — execute serially

### Active: `migration-transfer-chunk-resume`

Extend Transfer's committed table-boundary resume to safe, bounded in-table checkpoints. Freeze the row-order/key contract in the reviewed plan, persist a checkpoint only after an acknowledged target commit, and define retry behavior for lost commit acknowledgements so unknown writes cannot be replayed. Prove the behavior on PostgreSQL and MySQL with large fixtures, interruption at chunk boundaries, exact target readback, plan/checkpoint replay rejection, and cleanup. Keep unsupported ordering or drivers without a stable key fail-closed. Track-specific scope and acceptance will be recorded in its own worktree before implementation.

### Later tracks, one at a time

1. **Data Transfer:** complete explicit heterogeneous structure mapping for database/schema paths, generated/identity columns, types/expressions, indexes, and foreign keys. Preserve tuple recordsets and the new checkpoint semantics.
2. **Data Sync:** decide and implement a paged/exportable SQL preview path if the 16 MiB full-response ceiling is insufficient for the product claim. Verify tuple ordering, snapshot/type semantics, and unknown-outcome recovery for every driver advertised as supported. Record large-migration memory and stress results. Comparison-store recovery, composite tuple selection, and paged transactional execution are complete.
3. **Schema Diff:** implement SQLite table rebuild and safe rollback; add only cross-dialect view/routine/trigger/type translations that have a driver-owned equivalence contract. Finish schema object/catalog and supported table-option capability evidence per declared driver.
4. **Release evidence:** publish a driver-by-driver Sync/Transfer/Schema capability matrix backed by executable tests; validate Windows SQL-file picker/atomic replacement and migration journeys; record large-migration performance and driver failure-injection results.

## Track exit and final release criteria

- Each track stays in its own worktree and branch. The worktree must run its own `pnpm install`; `node_modules` must be a physical directory, never a symlink to the main checkout.
- A fresh Tester reviews each candidate, measures changed executable production-line coverage (target ≥80%), runs relevant Rust/TypeScript/Vitest/driver checks, and uses WDIO for live UI journeys. Do not use `black-box-tester`.
- Local PostgreSQL/MySQL use is authorized. WDIO fixtures must be uniquely named and precisely cleaned. Do not run broad E2E setup/teardown or reset scripts against shared databases.
- The final R phase runs after the remaining tracks are merged: full host and driver regressions, all registered migration WDIO journeys, platform checks, performance/fault evidence, and zero unresolved correctness bugs. Report environment-gated skips accurately.
- The feature is release-ready only when the capability matrix matches the implementation and every unsupported operation fails closed with an actionable reason. DMG packaging remains excluded; Windows migration validation does not.
