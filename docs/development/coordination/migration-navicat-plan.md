# Data migration trio release-gap plan

Scope: Data Sync, Data Transfer, and Schema Diff only. The integration baseline is `c7ff06d9` on `codex/migration-navicat`; new work must branch from the current integration head and merge only after an independent Tester closes its track.

## Wave 1 — disjoint data paths

### `migration-sync-stream-execution`

Stream selected comparison pages into one execution transaction. Remove the full-comparison materialization and 64 MiB full-load ceiling from execution while preserving the current immutable plan, selection revision, conflict policy, cancellation, rollback, and unknown-outcome rules. SQL preview remains explicitly bounded until its IPC/UI contract is changed in a separate track.

### `migration-transfer-tuple-recordset`

Extend Data Transfer's deterministic recordset selection from one scalar key to a composite primary-key tuple. Preserve old scalar profiles/wire payloads; bind all tuple values as parameters; use source-driver ordering and fail closed when key identity or type/order semantics cannot be proven.

## Wave 2 — schema planner graph

### `migration-schema-dependency-dag`

Replace category-based migration ordering with a validated dependency DAG over the supported selected objects and table operations. Report cycles and unresolved identities before execution; emit deterministic topological apply order and safe reverse rollback order. Do not claim cross-dialect semantic translation for an object whose renderer cannot prove equivalence.

## Later waves / release gates

- Data Sync: comparison-store crash cleanup and disk pressure, tuple-range selection, additional registered-driver snapshot/order contracts, SQL preview paging/export, and operator reconciliation of genuinely unknown outcomes.
- Data Transfer: chunk-level resumability with a demonstrated idempotency/commit protocol, richer per-table outcome reporting, and heterogeneous structure mapping completeness.
- Schema Diff: cross-dialect view/routine/trigger/type translation, SQLite table rebuild, broader table options, and per-driver catalog/capability validation.
- Release: supported-driver capability matrix, PostgreSQL/MySQL failure journeys, Windows file picker/atomic replacement and migration WDIO journeys, performance/fault injection, and full installation validation. DMG-only packaging failure is excluded by user instruction and `AGENTS.md`.

No track may mark the feature release-ready on unit tests alone. Final release status requires the integrated R phase and no unresolved correctness bugs.
