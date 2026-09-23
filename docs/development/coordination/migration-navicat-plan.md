# Data migration trio release-gap plan

Scope: Data Sync, Data Transfer, and Schema Diff only. The integration baseline is `0fcecc03` on `codex/migration-navicat`; `main` is already merged. New work must branch from the current integration head and merge only after an independent Tester closes its track.

## Wave 1 — completed disjoint data paths

### `migration-sync-stream-execution`

Stream selected comparison pages into one execution transaction. Remove the full-comparison materialization and 64 MiB full-load ceiling from execution while preserving the current immutable plan, selection revision, conflict policy, cancellation, rollback, and unknown-outcome rules. SQL preview remains explicitly bounded until its IPC/UI contract is changed in a separate track.

Status: PASSED and merged. Independent verification covered >64 MiB paged execution, bounded SQL preview, late-page conflict rollback, and Host Rust/WDIO regressions.

### `migration-transfer-tuple-recordset`

Extend Data Transfer's deterministic recordset selection from one scalar key to a composite primary-key tuple. Preserve old scalar profiles/wire payloads; bind all tuple values as parameters; use source-driver ordering and fail closed when key identity or type/order semantics cannot be proven.

Status: PASSED and merged. Independent PostgreSQL↔MySQL WDIO journeys verified exact tuple values and types; final Host Rust suite passed 1,824 tests (3 ignored), Transfer Vitest passed 32/32, and TypeScript passed.

## Wave 2 — schema planner graph

### `migration-schema-dependency-dag`

Replace category-based migration ordering with a validated dependency DAG over the supported selected objects and table operations. Report cycles and unresolved identities before execution; emit deterministic topological apply order and safe reverse rollback order. Do not claim cross-dialect semantic translation for an object whose renderer cannot prove equivalence.

### `migration-sync-tuple-selection`

Extend Data Sync's existing scalar recordset range to complete composite primary-key tuples. Preserve old scalar profile/IPC payloads, bind each component, keep predicate and stable scan order aligned, and refuse drivers or key types without a proven comparison contract. This track runs in parallel with Schema DAG and comparison-store recovery because its owned files are disjoint.

## Wave 1B — comparison-store lifecycle (independent files)

### `migration-sync-store-recovery`

Remove orphaned Data Sync comparison files after an app process exits unexpectedly, while proving that cleanup cannot delete stores owned by another active process. Make disk-pressure and partial-write failures explicit and ensure incomplete stores are removed. Preserve the current private-file permissions, streaming format, immutable-plan lifecycle, and bounded page reads.

## Later waves / release gates

- Data Sync: additional registered-driver snapshot/order contracts, SQL preview paging/export, and operator reconciliation of genuinely unknown outcomes.
- Data Transfer: chunk-level resumability with a demonstrated idempotency/commit protocol, richer per-table outcome reporting, and heterogeneous structure mapping completeness.
- Schema Diff: unified cross-category reviewed deployment plan, cross-dialect view/routine/trigger/type translation, SQLite table rebuild, broader table options, and per-driver catalog/capability validation.
- Release: supported-driver capability matrix, PostgreSQL/MySQL failure journeys, Windows file picker/atomic replacement and migration WDIO journeys, performance/fault injection, and full installation validation. DMG-only packaging failure is excluded by user instruction and `AGENTS.md`.

No track may mark the feature release-ready on unit tests alone. Final release status requires the integrated R phase and no unresolved correctness bugs.
