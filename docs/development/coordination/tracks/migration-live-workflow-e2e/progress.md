# Migration live workflow E2E track

- Phase: READY_TO_MERGE
- Worktree: `/Users/flyxl/code/datazen/.worktrees/datazen-migration-live-workflow-e2e`
- Branch: `feature/migration-live-workflow-e2e`
- Base: `codex/migration-navicat` (`aac8ff5c`)
- Scope: real PostgreSQL/MySQL scheduled and unattended migration workflow journeys

## Bootstrap

- Existing WebDriver harness invokes Tauri commands through `window.__TAURI_INTERNALS__.invoke`.
- Existing database fixtures use `E2E_PG_*` and `E2E_MYSQL_*` and provision `datazen_sync_src`, `datazen_sync_tgt`, `datazen_sync_mysql_src`, and `datazen_sync_mysql_tgt`.
- Live runs will be explicitly gated by `E2E_MIGRATION_LIVE=1`; missing or unreachable databases will be reported as skipped rather than treated as passing.

## Plan

- Add a dedicated migration workflow WebDriver spec and suite/config entry.
- Exercise profile revision checks, fresh sessions, destructive unattended policy, migration run history, failure convergence, and SQL-file token fail-closed behavior for PostgreSQL and MySQL.
- Keep production changes out of this track unless the executable contract exposes a test-only gap.

## Implementation

- Added `e2e/specs/migration-live-workflow.ts` with five cases per dialect:
  - database transfer through workflow-owned fresh sessions and profile revision history;
  - stale revision failure convergence;
  - unattended destructive reject/explicit allow;
  - SQL-file missing-token rejection plus native dialog token export and workflow-history redaction;
  - real interval scheduler trigger and target row verification.
- Registered the `migration-live-workflow` WebDriver suite and `pnpm e2e:migration-live` entry point.
- Live execution is opt-in with `E2E_MIGRATION_LIVE=1`; `E2E_MIGRATION_LIVE_DIALECTS` can select either dialect, and `E2E_MIGRATION_SCHEDULED=0` disables the 30-second scheduler wait for focused runs.

## Verification

- `CI=true E2E_MIGRATION_LIVE=1 E2E_MIGRATION_SCHEDULED=1 pnpm e2e --skip-build -- --suite migration-live-workflow`: **10 passing** (PostgreSQL 5, MySQL 5), including real scheduler trigger; local run completed in about 86 seconds.
- `CI=true E2E_MIGRATION_LIVE=0 E2E_MIGRATION_SCHEDULED=0 pnpm e2e --skip-build -- --suite migration-live-workflow`: **10 skipped**, with explicit `set E2E_MIGRATION_LIVE=1` messages.
- The webdriver build path also completed the repository frontend typecheck/build before running the live suite. The first clean build required creating the already-gitignored empty `src-tauri/resources/builtin-ep` staging directory because the baseline Tauri config declares that resource path; no source/config change was made for it.
- `CI=true pnpm exec prettier --check e2e/specs/migration-live-workflow.ts e2e/wdio.conf.ts package.json docs/development/coordination/tracks/migration-live-workflow-e2e/progress.md`: passed.

## Environment limits

- CI without provisioned PostgreSQL/MySQL runs the suite as skipped unless `E2E_MIGRATION_LIVE=1` is set and the fixtures are reachable. The live command is available locally/CI after `e2e/setup-e2e-env.sh` provisions the databases.
- Existing demo-data setup emits unrelated idempotent schema warnings/errors on this checkout; the migration fixture and all 10 live assertions still passed.

## Independent tester verification

- Tester bootstrap: worktree `feature/migration-live-workflow-e2e` at coder commit `624c6fd5`; no coder changes were present in the worktree.
- `node scripts/generate-builtin-locales.mjs`: passed.
- `CI=true pnpm exec prettier --check e2e/specs/migration-live-workflow.ts e2e/wdio.conf.ts package.json docs/development/coordination/tracks/migration-live-workflow-e2e/progress.md`: passed.
- `CI=true pnpm exec tsc --noEmit`: passed.
- `CI=true pnpm tauri:build:webdriver`: passed; frontend build and webdriver bundle completed.
- `CI=true E2E_MIGRATION_LIVE=0 E2E_MIGRATION_SCHEDULED=0 pnpm e2e --skip-build -- --suite migration-live-workflow`: passed with exactly 10 skipped (5 PostgreSQL, 5 MySQL), each gated by the explicit live flag.
- `CI=true E2E_MIGRATION_LIVE=1 E2E_MIGRATION_SCHEDULED=1 pnpm e2e --skip-build -- --suite migration-live-workflow`: passed with exactly 10 passing (5 PostgreSQL, 5 MySQL) in 1m 23.2s, including real scheduler trigger and target row verification.
- Journey coverage: 10/10 declared cases exercised live (100% behavioral case coverage); no additional test case was needed after the live run. Source line coverage is not instrumented for WebdriverIO specs by this repository's Vitest coverage configuration.
- No BUG-* entries: no defects reproduced. Build-generated `Cargo.lock` noise was restored before handoff.
