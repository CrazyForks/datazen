# migration-transfer-capability-gate

- Phase: READY_FOR_TEST
- Branch: feature/migration-transfer-capability-gate
- Worktree: /Users/flyxl/.codex/worktrees/migration-transfer-capability-gate/datazen
- Implementation commit: commit containing this progress record; hash supplied in coordinator handoff.

## Scope

Data Transfer classified Redis→Redis as supported by reusing the Data Sync family policy. Data Transfer has no Redis row source/target adapters, so that selection would fail later during adapter resolution. The pairing gate now rejects Redis consistently in the frontend and backend before inspection, preview, or execution. SQL Direct, SQL IR, and MongoDB direct pair policy remain unchanged. MongoDB registers both row adapters; optional MongoDB UI metadata may be absent in a basic build, so its known category is resolved explicitly there.

## Validation

- Physical local `pnpm install`; `node_modules` is a directory, not a symlink.
- Focused Vitest: 2 files, 40 tests passed, including the disabled Redis target UI journey.
- `pnpm typecheck`: passed.
- Edited-file rustfmt and Prettier checks: passed.
- Rust pairing test: 5/5 passed in isolated Cargo target.
- Edited-file `git diff --check`: passed.

## Residual scope

This gate covers the confirmed Redis missing-adapter pair. A dynamic adapter availability check for arbitrary external drivers remains for the release support matrix; other drivers were not disabled without evidence.
