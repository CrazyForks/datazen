# migration-target-table-picker

## Phase

READY_TO_MERGE

## Implemented slice

- Schema Diff now merges source and target table inventories by relation identity and marks target-only tables as unchecked by default.
- Target-only selections carry an endpoint-specific selector through the picker, compare UI, plan preparation, config export, and profile persistence.
- The target-only plan path reads the real target schema and emits an explicit `DropTable` operation. It does not fabricate an empty source schema.
- Destructive approval remains required; rejected target-only drops remain visible as skipped destructive warnings.
- Reviewed plans retain target snapshots for target-only tables, so review and deploy revalidate the live target before execution.
- Existing source-only and mixed source/target table flows remain available with their endpoint-specific selectors.

## Validation

- Focused Schema Diff Vitest: 5 files, 43 tests passed.
- TypeScript check: `npx --no-install tsc --noEmit` passed.
- Focused Rust Schema Diff tests: 93 passed.
- Changed-file `rustfmt --check` and `git diff --check` passed.
- Full Host Rust suite: 1591 passed, 3 ignored, 52 pre-existing AI wiremock tests failed because the sandbox cannot bind local mock-server ports.

## Known limits

- Live database/WebDriver coverage was not run in this coding worktree.
- CHECK constraints and table options remain outside this track.

## Tester verification

- Independent code review covered the merged source/target picker, target-only default-off state, endpoint-qualified selectors, target-only plan preparation and explicit `DropTable` rendering, destructive rejection/approval, reviewed target snapshots, profile persistence, and workflow forwarding. No business-code defect was found.
- Added tester coverage for ordinary and target-only panel summaries, target-only profile save/load round-trips, source/target selector separation, target-only-only profile validation, and encrypted profile persistence.
- Focused Vitest: 6 files, 49 tests passed. Coverage for the changed schema-diff selection/command/panel set: 87.73% statements, 80.90% branches, 85.03% functions, 90.56% lines. `SchemaDiffWindow.tsx` was 84.88% statements and 88.36% lines; its remaining uncovered paths are dialog cancellation and unrelated existing branches.
- Focused Rust Schema Diff tests: 96 passed, 0 failed.
- `npx --no-install tsc --noEmit` passed.
- Changed-file `rustfmt --edition 2021 --check` and `git diff --check` passed. Full `cargo fmt --all -- --check` still reports ordering in generated `src-tauri/src/driver_init.rs`; this generated file is not part of the commit.
- Live database/WebDriver E2E remains unavailable in this worktree and was not fabricated.

## Commit

Tester verification commit: `ac0a124c`.
