# migration-transfer-structure-mapping

- Phase: READY_FOR_TEST
- Task: preserve mapped table structure during heterogeneous Data Transfer
- Branch: `feature/migration-transfer-structure-mapping`
- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-transfer-structure-mapping`
- Base: `codex/migration-navicat` at `6e9d0d6b`
- Dependencies: `migration-transfer-plan`, `migration-transfer-sql-target`, and `migration-transfer-chunk-resume` are integrated
- Environment: `pnpm install` completed in this worktree; `node_modules` is a physical directory, not a symlink

## Observed gap

- Database-target `CREATE` routes through `data_transfer::structure::mapped_create_ddl`, which builds an `IRTable` from columns and primary keys. It does not plan secondary indexes or foreign keys.
- The SQL-file structure route in `data_transfer::sql_structure` already converts `TableSchema` objects to `IRTableObjects`, applies column mappings, and renders index/foreign-key DDL. The database route must not silently provide less structure than its preview or SQL-file counterpart.
- `ColumnSchema` exposes only `is_auto_increment`; it does not represent generated-column mode/expression. PostgreSQL schema introspection currently reports `is_auto_increment: false`, so identity semantics may be lost when a new target table is created.

## Scope and acceptance

- Inspect the current schema metadata and transfer execution lifecycle before changing it. Keep this track limited to Data Transfer structure mode; do not modify Data Sync or Schema Diff behavior.
- For new-table structure transfers, preserve the full table mapping for source/target names and target database/schema qualification. Preview and execution must use the same immutable, mapped structure plan.
- Preserve primary keys, supported secondary indexes, and foreign keys for PostgreSQL↔MySQL mappings, including renamed columns and renamed referenced tables. Emit all table definitions before dependent objects. Reject selected mappings that omit a required referenced table/column before the first target write.
- Preserve identity/auto-increment only where source metadata and target rendering prove equivalent. Unsupported generated-column expressions or object semantics must be reported before writes with an actionable reason; never silently drop them or emit raw source SQL into another dialect.
- Preserve legacy payload/profile compatibility. SQL-file output and existing table-boundary/in-table resume behavior must remain unchanged.
- Add unit/contract tests for object mapping, identifier qualification, identity/generation capability checks, dependency ordering, unsupported-semantic preflight, and zero writes on rejection. Add live PostgreSQL↔MySQL WDIO journeys that verify created-table DDL and read back primary/secondary indexes, foreign keys, generated/identity behavior, and transferred rows.
- Before handoff: relevant Rust `--lib` tests, focused Vitest if UI code changes, `npx tsc --noEmit`, formatting/diff checks, and direct WDIO (never black-box-tester). Measure production-line coverage for changed Rust code; target at least 80%.

## Constraints

- Do not work on another product track in parallel.
- Preserve every `.profraw` file and existing app bundle. Keep disk usage guarded; use the integration worktree Cargo target sequentially if an isolated target would duplicate the large dependency build.
- Keep `node_modules` physical and local to this worktree. Do not symlink it to the main checkout.
- Unsupported mappings fail closed before target writes. Do not claim cross-dialect generated-expression equivalence without driver-owned evidence.

## Current checkpoint

- Shared database structure planning, deferred foreign-key installation, destructive Drop/Create planning, target qualification, identifier namespace checks, and selected-table unsupported-object preflight are implemented.
- PostgreSQL source preflight rejects generated columns, `GENERATED ALWAYS` identities, unsupported index expressions/predicates/INCLUDE columns, non-default operator classes/collations/sort options, and unrepresented FK MATCH/validation/SET NULL-column semantics. MySQL captures table charset/comment and rejects generated columns, prefix/functional/descending indexes, column-specific collations, and non-default table collations. SQL Server rejects source computed columns, secondary indexes, FKs, CHECK constraints, and non-default identity seed/increment because its current schema reader does not represent them.
- StructureAndData planning rejects identity-bearing tables for targets that cannot insert explicit identity values; MySQL, PostgreSQL, and SQLite declare support, while SQL Server fails before DDL because this writer does not manage `IDENTITY_INSERT`. Structure-only can still preserve the SQL Server identity marker. Data-only transfers into an existing SQL Server identity column remain a capability boundary for the release matrix.
- SQL Server database-only targets use explicit `[database].[dbo].[table]` qualification; explicit endpoint/config schemas take precedence. SQL-file qualification uses SQL Server bracket escaping and follows the same default-schema rule.
- Coder-owned Rust checks passed: Host Data Transfer modules `data_transfer::` 174/174 (including the identity pre-write planning regression); Host command Transfer tests `commands::data_transfer::` 49/49; isolated SQL Server qualification and SQL-file source-type-enrichment regressions 1/1 each; Driver API 198/198; MySQL 126/126; PostgreSQL 134/134; SQLite 55/55; SQL Server 51/51. ClickHouse full driver suite was 30/34; the four failures are Wiremock loopback binds rejected by the sandbox, while all changed ClickHouse sync-adapter tests passed.
- Full Host `datazen --lib` compiled and ran 2,013 tests: 1,922 passed, 88 failed, 3 ignored. Of the 88 failures, 86 were sandbox-denied local socket/network fixtures; the other two Transfer failures were fixed and each now passes in isolation. The broad Host run is not repeated because the focused Transfer suites are green; independent retest owns full integration regression.
- Final Coder static checks pass: `cargo fmt --all -- --check`, `git diff --check`, `npx --no-install tsc --noEmit`, focused Transfer Vitest (2 files, 39 tests), and Prettier on changed UI files.
- Per coordinator workflow, the independent Tester owns ≥80% changed-production-line coverage and the live PostgreSQL↔MySQL WDIO journey. No black-box-tester was used. The Tester's independent result is still required before this track can be marked PASSED.
- Release-phase i18n sync remains a separate gate: this work adds English keys only as required, while the repository-wide sync check currently reports broad baseline drift (6,245 missing and 1,642 stale keys relative to the comparison baseline). Do not bulk-edit unrelated locales in this track.
- The implementation commit hash will be recorded below after the business and progress changes are committed together.
