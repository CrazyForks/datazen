# migration-transfer-tuple-recordset

Phase: READY_FOR_TEST

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

- Pending fresh Tester review; review every changed file and assess changed-core coverage.
