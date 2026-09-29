# SQLite Schema Diff R8 WDIO

- Date: 2026-09-29
- Tester branch: `codex/test-migration-schema-sqlite-r8`
- Product commit under test: `d3d53307` (`fix(schema-diff): freeze SQLite catalog scope for deploy`)
- App build: `pnpm tauri:build:webdriver` — passed.
- Test: `E2E_SKIP_WORKER_DATABASE=1 pnpm e2e:skip-build -- --spec e2e/specs/schema-diff-sqlite-rebuild.ts` — 2 passed.

The success journey created two disposable file-backed SQLite databases, compared and reviewed a table rebuild, deployed it, and verified the target kept row `(id=7, value='kept')` with the new `BLOB` column definition. The stale-review journey changed the target schema through another SQLite connection after review, confirmed deploy returned `Target schema changed for <table>; compare again`, and read back the unchanged row plus the external `drift` column. This proves the reviewed rebuild performed no write after the target changed. Both tests' `after` hook removed their files and saved connections. The standard PostgreSQL/MySQL setup warning about missing `E2E_PG_RO_PASSWORD` did not affect this SQLite-only spec; E2E teardown completed.

Dependencies were installed physically in this worktree; `node_modules` is not a symlink to main. No black-box-tester was used.
