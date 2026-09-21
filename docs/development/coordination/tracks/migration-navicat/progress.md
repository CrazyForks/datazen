# migration-navicat integration

## Phase

PASSED / READY_TO_MERGE

## Completed in this wave

- Data Sync reusable profiles: strict versioned persistence, per-record invalid filtering, encrypted-safe store lifecycle, connection validation, profile save/load/delete, and fresh-inspect restoration of mappings, disabled tables, filters, recordsets, and options.
- Schema Diff reusable profiles: strict versioned encrypted persistence, connection validation, save/load/delete, fresh source inspection, table/options/type override restoration, cross-endpoint type override preservation, and isolated encrypted Store tests.
- Shared migration run history: durable running/committed/failed/unknown lifecycle, connection/profile revision updates, and Schema Diff preflight failure finalization.
- Host-owned migration workflow steps: scheduled Data Transfer, Data Sync, and Schema Diff profile execution with revision checks, explicit unattended destructive policy, and per-run SQL-file token redaction.
- Schema Diff foreign keys: dialect-neutral add/drop/replace operations, dependency-safe multi-table ordering, PostgreSQL/MySQL rendering, and fail-closed SQLite behavior.

## Independent verification

- Data Sync second-round Tester: Rust 1520 passed / 3 ignored, Vitest 43 passed, TypeScript and formatting checks passed; mixed valid/invalid profile CRUD regression closed.
- Schema Diff third-round Tester: Rust 1520 passed / 3 ignored in serial and parallel runs, focused Rust 71 passed, Vitest 16 passed, TypeScript and formatting checks passed.
- Integration Rust regression: 1525 passed / 3 ignored.
- Integration frontend regression: 59 passed; `npx tsc --noEmit` passed.
- Integration Schema Diff foreign-key regression: 78 focused Host tests; PostgreSQL 10, MySQL 10, SQLite 5, and Driver API 5 migration tests passed.
- Latest integration Host Rust regression: 1624 passed / 3 ignored.
- Formal `CI=true pnpm tauri:build:webdriver`: App and DMG built successfully with Postgres/MySQL/SQLite/Redis injection; generated files restored afterwards.

## Known limits

- Profile, run-history, and scheduled-workflow paths are complete for this wave; full Navicat parity still requires views, routines, triggers, sequences, CHECK constraints, table options, drop-table operations, and production E2E against live databases.
- Scheduled migration workflows have unit coverage, but live unattended PostgreSQL/MySQL journeys and Windows packaging remain to be verified.
- Targeted profile coverage is strong, but whole-file coverage for the large DataSyncWindow remains below the repository-wide 80% metric because unrelated wizard paths are outside this wave.
