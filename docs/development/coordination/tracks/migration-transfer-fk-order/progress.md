# migration-transfer-fk-order

Phase: CODER_TESTED_WAITING_FOR_REVIEW

## Scope

For Data-only Data Transfer into existing tables, preserve selected-table subset semantics while writing selected rows parent-before-child according to target foreign keys. Reject selected unresolved dependencies, cycles, and destructive write modes with selected FK edges before any target write.

## Worktree and branch

- Worktree: `/Users/flyxl/.codex/worktrees/migration-transfer-fk-order/datazen`
- Branch: `feature/migration-transfer-fk-order`
- Base: `4c065e50e4bbbdee4931f2719c208aa0af94f45e`
- Installed dependencies physically in this worktree; `node_modules` is a directory, not a symlink.
- No `hub.md` changes.

## Implementation

- Captures target-side FK edges from the inspected target schema and relation catalog into the immutable transfer plan.
- Stable topological order is surfaced in preview and applied to the actual inspected execution list after resolving the run selection.
- Edges apply only when both endpoints are selected. A child-only selection can run when its referenced parent already exists.
- Unknown/ambiguous selected references fail closed. Selected cycles fail before claim/write because the executor commits one table at a time; deferrable constraints cannot span those commits.
- Selected FK edges with `Truncate + Insert` or `Drop + Create + Insert` are rejected before writes because destructive phases cannot be safely interleaved by the current per-table executor.
- PostgreSQL WDIO journey registered in the Data Transfer and cross-feature `journeys` suites. It covers reversed child/parent input order, child-only selection, parent/child readback, and a deferrable cycle that must leave both target tables empty.

## Validation

- `pnpm install`: passed in the worktree; no symlink to the main checkout's `node_modules`.
- `cargo test -p datazen --lib data_transfer::table_order::tests -- --nocapture`: 4 passed.
- `pnpm typecheck`: passed after the implementation and WDIO cleanup changes.
- Targeted rustfmt check on changed Rust files: passed.
- `pnpm exec prettier --check e2e/specs/journeys/data-transfer-fk-order-journey.ts e2e/wdio.conf.ts`: passed.
- `git diff --check`: passed.
- Fresh focused WDIO via `E2E_SKIP_TEARDOWN=1 E2E_SKIP_WORKER_DATABASE=1 pnpm e2e -- --spec ./e2e/specs/journeys/data-transfer-fk-order-journey.ts`: 2/2 passed after building through the supported webdriver Tauri path.
- Cleanup-hardening rerun via `E2E_SKIP_TEARDOWN=1 E2E_SKIP_WORKER_DATABASE=1 pnpm e2e:skip-build -- --spec ./e2e/specs/journeys/data-transfer-fk-order-journey.ts`: 2/2 passed. The `after` hook independently dropped and verified fixtures in both databases.
- Follow-up catalog checks returned zero `dt_fk_%` tables in both `datazen_sync_src` and `datazen_sync_tgt`.
- The standard E2E setup warned that `E2E_PG_RO_PASSWORD` is unset, so it could not provision the optional read-only test user. The journey uses the configured read/write PostgreSQL user and passed.
- E2E build preserved `target/debug/bundle/macos/DataZen.app`; 52 GiB remained free after the run (required minimum: 15 GiB). No `.profraw` files were found. No DMG-specific validation or changes were made.

## Limitations

- Cross-table cycles are intentionally unsupported even for deferred PostgreSQL constraints: transfer commits each target table separately.
- Full atomic rollback across multiple ordinary insert tables remains outside this fix; the regression requires the cycle failure to occur before any table writes.
- No DMG packaging work is in scope.

## Commit

- Implementation commit: `798c3151` (`fix(data-transfer): order FK-dependent table writes`).
