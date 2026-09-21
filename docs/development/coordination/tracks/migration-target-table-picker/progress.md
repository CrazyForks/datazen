# migration-target-table-picker

## Phase

READY_FOR_TEST

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

## Commit

The final commit SHA is reported in the coder handoff.
