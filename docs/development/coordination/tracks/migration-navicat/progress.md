# migration-navicat integration

- Phase: ACTIVE — release gaps remain

Integration branch: `codex/migration-navicat`
Last update: 2026-09-25, after Schema dependency DAG merge `6210b2ec`.

## Current release closure order

1. Implement the unified cross-category Schema Diff planner and review/deploy path. The standalone table/FK dependency DAG is now independently verified and merged; it does not solve mixed table/type/view/sequence/routine/trigger plans.
2. Close the remaining Data Sync boundaries: decide whether to add streamed/exportable SQL preview beyond the explicit 16 MiB IPC cap, stress large migrations and record memory results, and prove tuple/snapshot plus unknown-outcome behavior for every driver the product claims to support. Paged comparison storage, crash recovery, composite tuple selection, and paged transactional execution are already implemented.
3. Close the remaining Data Transfer boundaries: extend the existing table-boundary resume token to safe bounded in-table chunks, and complete explicit cross-dialect structural mapping for database/schema, generated/identity columns, types, expressions, indexes, and foreign keys. Composite tuple recordsets and unknown-outcome fencing are already implemented for the tested paths.
4. Complete SQLite table rebuild safety and rollback, then finish the declared-driver capability matrix and any table options not safely represented today.
5. Run release validation for Windows file picker/atomic replacement and migration journeys, then record representative large-migration memory/performance results and remaining driver failure injection.

The release checklist is complete only after these gaps are either implemented and verified or deliberately excluded from the supported product claim. DMG packaging is excluded from this feature gate per the explicit user instruction recorded in `AGENTS.md`.

PASSED / READY_TO_MERGE

## Completed in this wave

- Data Sync reusable profiles: strict versioned persistence, per-record invalid filtering, encrypted-safe store lifecycle, connection validation, profile save/load/delete, and fresh-inspect restoration of mappings, disabled tables, filters, recordsets, and options.
- Schema Diff reusable profiles: strict versioned encrypted persistence, connection validation, save/load/delete, fresh source inspection, table/options/type override restoration, cross-endpoint type override preservation, and isolated encrypted Store tests.
- Shared migration run history: durable running/committed/failed/unknown lifecycle, connection/profile revision updates, and Schema Diff preflight failure finalization.
- Host-owned migration workflow steps: scheduled Data Transfer, Data Sync, and Schema Diff profile execution with revision checks, explicit unattended destructive policy, and per-run SQL-file token redaction.
- Schema Diff foreign keys: dialect-neutral add/drop/replace operations, dependency-safe multi-table ordering, PostgreSQL/MySQL rendering, and fail-closed SQLite behavior.
- Schema object migration slice: reviewed same-dialect View create/replace/drop plans with target snapshot revalidation, destructive approval, rollback metadata, PostgreSQL/MySQL renderers, SQLite create/drop support, and fail-closed SQLite replacement.
- Object metadata commands: dialect-aware object listing/DDL/privilege SQL with identifier quoting and SQLite view-body extraction that preserves spaces, LF, CRLF, tabs, and case variants.
- Live scheduled workflow journey: opt-in PostgreSQL/MySQL WebDriver coverage for fresh sessions, profile revision failures, unattended destructive policy, run history, SQL-file token redaction, and real scheduler execution.
- Safe table-drop migration: explicit target-only `DropTable` planning with destructive approval, dependency ordering, no `CASCADE`, no synthetic rollback, transaction/unknown-outcome gates, and fail-closed empty/control/invalid identifier validation.
- Object identity parity: routine overload signatures and trigger target relations now flow through driver metadata, Host IPC, ObjectBrowser, navigator keys, and panel actions without collisions; missing/ambiguous DDL fails closed.
- Schema dependency DAG: typed identities and deterministic ordering now cover supported standalone planner boundaries; cycles and guessed references fail closed; PostgreSQL/MySQL catalog revalidation protects reviewed table drops. Fresh independent R4 passed 10/10 serial WDIO journeys, independently reproduced 588/688 changed executable lines (85.5%), and verified MySQL complete-catalog access. Merge: `6210b2ec`.

## Independent verification

- 2026-09-23 integration checkpoint includes cross-dialect schema type planning/rendering, driver-owned migration defaults and literals, PostgreSQL/MySQL metadata resolution, Data Sync confirmed-rollback outcomes, and Data Transfer default-schema inspection. The changes remain in the integration worktree pending the independent review wave.
- Fresh integration rerun: Host Rust 1,795 passed / 3 ignored; Driver API, PostgreSQL, MySQL, and SQLite crate unit suites passed; Vitest 482 files / 4,986 tests passed; `pnpm exec tsc --noEmit` passed.
- Formatting and whitespace: `rustfmt --edition 2021 --check` passed for every changed tracked Rust file and `git diff --check` passed. Workspace-wide `cargo fmt --all -- --check` only reports ordering in ignored generated `src-tauri/src/driver_init.rs`.

- Data Sync second-round Tester: Rust 1520 passed / 3 ignored, Vitest 43 passed, TypeScript and formatting checks passed; mixed valid/invalid profile CRUD regression closed.
- Schema Diff third-round Tester: Rust 1520 passed / 3 ignored in serial and parallel runs, focused Rust 71 passed, Vitest 16 passed, TypeScript and formatting checks passed.
- Integration Rust regression: 1525 passed / 3 ignored.
- Integration frontend regression: 59 passed; `npx tsc --noEmit` passed.
- Integration Schema Diff foreign-key regression: 78 focused Host tests; PostgreSQL 10, MySQL 10, SQLite 5, and Driver API 5 migration tests passed.
- Latest integration Host Rust regression after all current tracks: 1641 passed / 3 ignored.
- Formal `CI=true pnpm tauri:build:webdriver`: App and DMG built successfully with Postgres/MySQL/SQLite/Redis injection; generated files restored afterwards.
- View migration integration regression: Host Schema Diff 84 passed; SQLite object-command journey 5, SQLite object SQL 4, Driver API object/type tests 11, PostgreSQL object/migration tests 18, MySQL object/migration tests 16, SQLite migration 6, Vitest 15, TypeScript, rustfmt, and diff checks passed.
- Live workflow Tester: gate-off journey 10 skipped with explicit opt-in messaging; provisioned PostgreSQL/MySQL journey 10 passed, including real scheduler trigger after a clean WebDriver build.
- Schema Safety Tester: Host Schema Diff 92, Driver API 134, PostgreSQL/MySQL/SQLite 116/94/54, migration focused 15/14/9, and Schema Diff Vitest 63 passed; invalid identifiers fail closed.
- Object Catalog Tester: Driver API 140, PostgreSQL/MySQL/SQLite object suites 10/6/6+5, Host schema 14, and ObjectBrowser/navigator/panel Vitest 99 passed; overload and trigger identity collisions are covered.
- Schema dependency DAG R4 Tester: Host Schema Diff 173, Driver API 156, PostgreSQL 132 plus live FK-introspection 1, MySQL 116 plus four cross-database tests passed; fresh PG/MySQL WDIO 10/10, with post-review FK mutation rejection and database read-back. MySQL complete-catalog scans covered 176 relations in about 1.19 seconds; PostgreSQL late-dependent revalidation covered two relations in 34 ms. Host TypeScript passed. Integration sanity after merge: `npx tsc --noEmit` passed and `cargo test -p datazen --lib` passed 1,925 / 3 ignored when local loopback access was permitted for existing mock-network tests.

## Independent baseline Tester (2026-09-23; reviewed `c7ff06d9`)

- Phase A reviewed the full `13f40925..c7ff06d9` diff file by file. The referenced `post-review-hardening-plan.md` is absent in this worktree; acceptance boundaries were taken from this track's progress record and the coordinator-provided hub context. `hub.md` remained read-only. One cross-cutting default-expression finding is tracked separately in `migration-default-expression-review`.
- Phase B: Before adding the focused regression, Host Rust passed 1,795 / ignored 3; Driver API 154 passed / doc tests 2 ignored; PostgreSQL 151 passed / 2 live-database tests ignored; MySQL 126 passed / 1 live-database test ignored; SQLite 67 passed; Vitest 482 files / 4,986 tests passed; `pnpm exec tsc --noEmit` passed. The added Host regression then failed as expected and records the defect. Four MySQL cross-database test functions return early without `TEST_MYSQL_*` credentials, so live DB proof comes from WDIO, not those counted passes. An extra `e2e/tsconfig.json` check reports broad WDIO typing errors in unmodified helpers/specs; it reported no error in the changed spec.
- Formatting and whitespace: rustfmt passed for changed Rust files and `git diff --check` passed. `cargo llvm-cov` is unavailable, so Rust coverage was assessed by the suite plus branch/path review rather than numeric instrumentation.
- Focused frontend coverage: 16 files / 105 tests passed. DataSyncWindow line coverage 80.37% (statements 77.70%, branches 68.84%, functions 74.79%); DiffDetail 82.85%; SchemaDiffWindow 88.46%; `useSchemaDiffEndpoints` 86.69%. The aggregate thresholds miss statement/branch/function targets because the selected DataSyncWindow includes unrelated wizard paths; new migration-specific UI suites passed.
- Webdriver build produced a runnable `DataZen.app`; packaging stopped only at DMG creation, the documented non-blocking case. Data Sync completed 4 spec files / 56 tests; Schema Diff completed 7 / 38, including live PostgreSQL↔MySQL paths. Data Transfer's first eight-spec run was contaminated by a second WDIO process resetting shared `e2e/.app-data` and competing for port 4445 (7/8 spec files passed). The isolated rerun of `data-transfer-mode-paths.ts` passed 1 / 1 spec and 10 / 10 tests; explicit direct fixture queries proved each PG/MySQL source table had 2 rows and each target table was created empty. Across the full and isolated runs, all 8 Data Transfer specs / 40 unique tests passed; real PG→MySQL and MySQL→PG journeys each passed 6 / 6 steps, with no database journey skipped.
- Coverage-driven test additions: a Host Rust regression in `plan_tests.rs` asserts MySQL numeric expression defaults must fail closed; it fails against this commit and captures the generated invalid PostgreSQL DDL. The Data Transfer mode-matrix E2E now verifies its source and target fixtures directly before UI steps, separating fixture setup failures from picker/UI regressions.
- Tester test commit: `e31bc710`. The tester regression remains in `src-tauri/src/schema_diff/plan_tests.rs`; defect details and focused failure output are recorded in `migration-default-expression-review`.

## Remaining release gaps

- Schema Diff: implement one reviewed mixed-kind planner across selected tables/FKs, custom types, views, sequences, routines, and triggers; resolve dependencies using exact structured identities or fail closed. Add safe SQLite table rebuilds and rollback. Expand declared driver capability evidence for table options, collation, partitioning, compression, and object catalogs. Cross-dialect view/routine/trigger/type semantic translation remains unsupported where equivalence cannot be proven.
- Data Sync: the production comparison sink/store and plan executor are paged and passed a 10,001-row storage path and a roughly 68 MiB ten-page WDIO execution. SQL preview remains a bounded full IPC response with a 16 MiB limit; a streaming preview/export path is a product decision and outstanding large-table memory/stress evidence should be recorded. Composite tuple ranges and comparison-store crash recovery are implemented; verify ordering/snapshot semantics and unknown-outcome recovery across every driver claimed as supported.
- Data Transfer: resume is currently at completed table boundaries; extend it to large-table chunks with safe recovery evidence. Composite tuple recordsets and tested unknown-outcome fencing are implemented. Complete explicit heterogeneous structural mappings and precise blockers for unsupported types, expressions, generated columns, indexes, and FKs.
- Release validation: publish a driver-by-driver Sync/Transfer/Schema capability matrix backed by executable tests; validate Windows SQL-file picker/atomic replacement and migration WDIO journeys; record large-migration memory/performance benchmarks and driver failure injection. DMG packaging remains excluded by user instruction.
- Existing WDIO live-database suites require provisioned local PostgreSQL/MySQL fixtures. The release run must report their execution and any environment-gated skips explicitly.
