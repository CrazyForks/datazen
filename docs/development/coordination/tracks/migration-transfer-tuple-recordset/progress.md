# migration-transfer-tuple-recordset

Phase: PASSED

## Scope

Extend deterministic Data Transfer recordset selection to complete composite primary-key tuples. Preserve the legacy scalar profile/IPC shape. Tuple bounds must match the source primary key exactly, in declared order, and bind typed values as parameters. Predicates and scan ordering use the same source-driver comparison semantics; unknown or unsupported ordering contracts fail closed.

## Acceptance criteria

- [x] Legacy scalar records deserialize and serialize in the existing shape; tuple ranges have a distinct `tupleRange` representation.
- [x] Tuple ranges require the complete ordered source primary key, non-nullable known key types, matching bound arity, non-NULL values, and valid non-empty boundary order.
- [x] Generated predicates bind every component; deterministic `ORDER BY` uses the same ordered key columns. Tuple ranges reject drivers without a verified row-comparison contract.
- [x] Preview shows tuple bounds/order/limit and counts rows using the same bound predicate. Plan fingerprints change when tuple values or columns change.
- [x] Rust tests cover legacy serialization, two- and three-column keys, typed components, inclusive/exclusive endpoints, arity/order/nullability/type errors, parameter order, invalid ranges, unsupported drivers, and fingerprint invalidation.
- [x] PostgreSQL→MySQL and MySQL→PostgreSQL WDIO journeys verify the six source keys and their UTF-8 hex, then read back the exact three in-range PK tuples from each target.
- [x] Fresh WDIO execution passed in both directions; the PostgreSQL target also asserts `pg_typeof(tenant) = text` and the exact stored Unicode value.

## P1 finding and resolution

- **Resolved in `8d1642a5`:** MySQL `VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL` returned the Unicode key `a-雪` as driver bytes `[97, 45, 233, 155, 170]`, while `HEX(tenant)` was `612DE99BAA`. Data Transfer bound those bytes into PostgreSQL `tenant TEXT NOT NULL`; `pg_typeof(tenant)` was `text`, but the stored value became the literal `\\x612de99baa` (`encode(convert_to(tenant, 'UTF8'), 'hex') = 5c7836313264653939626161`). This silently changed a key during cross-database transfer.
- Data Transfer now decodes valid UTF-8 bytes only when the source schema confirms a textual type. Invalid UTF-8 fails closed, and BLOB/binary columns retain their bytes.

## Self-validation

- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib data_transfer::recordset`: 17 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib data_transfer:: -- --quiet`: 110 passed, including UTF-8 text conversion, invalid UTF-8 rejection, and BLOB preservation.
- `pnpm exec vitest run src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx`: 31 passed.
- `pnpm exec tsc --noEmit`: passed.
- Changed Rust files passed rustfmt checks; changed frontend/E2E files passed Prettier; `git diff --check` passed.
- `node e2e/run.mjs --spec ./e2e/specs/journeys/data-transfer-tuple-recordset-journey.ts`: 2 WDIO routes passed after rebuilding the webdriver app. A final `--skip-build` rerun with exact source-fixture assertions also passed 2/2.
- Full Host `cargo test -p datazen --lib` ran 1,803 tests: 1,712 passed, 88 failed, and 3 ignored. Two failing Data Transfer assertions/fixtures were corrected; the Data Transfer subset then passed 110/110. The other 86 reported failures are SSH/tunnel/network tests and were not rerun.
- Full `e2e/tsconfig.json` typecheck reports existing WDIO API/type mismatches and generated-driver alias errors across the workspace; the new tuple journey has no diagnostics in that check.

## Commit

- Implementation commit hash: `c55fd04f` (`feat(data-transfer): support composite tuple recordset ranges`).
- UTF-8 preservation fix and regression tests: `8d1642a5` (`fix(data-transfer): preserve UTF-8 text values`).

## Independent Tester

- Fresh Tester reviewed the tuple-range model, resolution and SQL generation, bound normalization, preview/count path, transfer projection, UI editor, and both-direction WDIO journey. Ordered primary-key columns are validated as a complete tuple; predicates and `ORDER BY` share that order; all tuple values remain bound parameters. Legacy scalar JSON remains unchanged. Incomplete, reordered, nullable, unsupported, mixed, or invalid ranges fail closed.
- The text/binary regression is covered in both unit and E2E tests: valid UTF-8 from a textual MySQL `utf8mb4_bin` column remains `a-雪` (`612DE99BAA`) in PostgreSQL `TEXT`, and byte-valued binary columns stay bytes. Invalid UTF-8 in a textual source is rejected.
- Independent verification: `CARGO_TARGET_DIR=/Users/flyxl/code/datazen/.worktrees/datazen-migration-navicat/target CARGO_BUILD_JOBS=1 node scripts/with-driver-inject.mjs --drivers=basic -- cargo test -p datazen --lib data_transfer:: -- --quiet` passed 110/110; the integration Host suite passed 1811/1811 (3 ignored). Vitest passed 32/32, `pnpm exec tsc --noEmit` passed, and Prettier plus `git diff --check` passed. Cargo injection changes were removed. `cargo-llvm-cov` is unavailable, so Rust coverage was assessed from the changed paths and their focused tests rather than line instrumentation.
- Targeted V8 coverage for `DataTransferWindow.tsx` and `ColumnMappingEditor.tsx`: 84.97% lines, 82.98% statements, 83.88% functions, and 71.81% branches. The lower combined branch number includes existing, unrelated wizard and column-mapping interactions; the changed tuple editor lines are covered, including complete ordered two-component bounds, inclusive toggles, UTF-8 values, and clearing the last component while retaining the opposite endpoint. Rust tests also cover three-component tuples.
- WDIO against authorized local MySQL/PostgreSQL passed both transfer directions (2/2). After strengthening the test hook, a fresh isolated PostgreSQL→MySQL rerun also passed (1/1). Earlier teardown reused expired sessions and swallowed cleanup errors; the hook now obtains fresh sessions, attempts both drops and catalog assertions independently, disconnects each session independently, and fails after all cleanup attempts if any error remains. The final run emitted no stale-session error, and post-run catalogs contained no `dt_tuple_%` fixtures in either database. The E2E runner exited and port 4445 is closed.
- Tester added one focused UI regression test for clearing a tuple endpoint and hardened only the WDIO fixture teardown. No product implementation defect remains open for this track; no `bugs.md` was needed.
- Tester commit: `c0d5c9ce` (`test(data-transfer): verify tuple recordset track`).
