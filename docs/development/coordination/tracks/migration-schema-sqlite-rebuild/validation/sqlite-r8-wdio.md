# SQLite Schema Diff R8 WDIO

- Date: 2026-09-29
- Tester branch: `codex/test-migration-schema-sqlite-r8`
- Product commit under test: `d3d53307` (`fix(schema-diff): freeze SQLite catalog scope for deploy`)
- App build: `pnpm tauri:build:webdriver` — passed.
- Test: `E2E_SKIP_WORKER_DATABASE=1 pnpm e2e:skip-build -- --spec e2e/specs/schema-diff-sqlite-rebuild.ts` — 1 passed.

The journey created two disposable file-backed SQLite databases, connected to both, compared and reviewed a table rebuild, deployed it, and verified the target kept row `(id=7, value='kept')` with the new `BLOB` column definition. The test's `after` hook removed its files and saved connections. The standard PostgreSQL/MySQL setup warning about missing `E2E_PG_RO_PASSWORD` did not affect this SQLite-only spec; E2E teardown completed.

Dependencies were installed physically in this worktree; `node_modules` is not a symlink to main. No black-box-tester was used.
