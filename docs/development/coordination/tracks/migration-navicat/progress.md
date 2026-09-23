# migration-navicat integration

## Phase

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

## Known limits

- Profile, run-history, scheduled-workflow, View migration, safe table-drop, and object identity/catalog paths are complete for this wave; full Navicat parity still requires CHECK constraints, table options, routine/trigger migration renderers, sequence translation, cross-dialect view translation, target-only picker wiring, and Windows packaging.
- The live PostgreSQL/MySQL journey is opt-in and depends on provisioned fixtures; CI without those fixtures must keep the suite gated and report skips.
- Targeted profile coverage is strong, but whole-file coverage for the large DataSyncWindow remains below the repository-wide 80% metric because unrelated wizard paths are outside this wave.
