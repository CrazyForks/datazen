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
- [x] PostgreSQL→MySQL and MySQL→PostgreSQL WDIO journeys are registered with non-ASCII text plus negative/large BIGINT endpoints, both inclusivity modes, and target read-back assertions.
- [ ] Fresh WDIO execution and database read-back verification; queued behind the coordinator’s active single WDIO lane.

## Self-validation

- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib data_transfer::recordset`: 17 passed.
- `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib data_transfer:: -- --quiet`: 109 passed.
- `pnpm exec vitest run src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx`: 31 passed.
- `pnpm exec tsc --noEmit`: passed.
- Changed Rust files passed rustfmt checks; changed frontend/E2E files passed Prettier; `git diff --check` passed.
- Full Host `cargo test -p datazen --lib` ran 1,803 tests: 1,712 passed, 88 failed, and 3 ignored. Two failing Data Transfer assertions/fixtures were corrected; the Data Transfer subset then passed 109/109. The other 86 reported failures are SSH/tunnel/network tests and were not rerun.
- Full `e2e/tsconfig.json` typecheck reports existing WDIO API/type mismatches and generated-driver alias errors across the workspace; the new tuple journey has no diagnostics in that check.
- WDIO was not started here because the coordinator assigned the single WDIO lane to the fresh Tester.

## Commit

- Implementation commit hash: pending; this field will be filled in the follow-up progress commit.

## Independent Tester

- Pending fresh Tester review and WDIO execution; review every changed file and assess changed-core coverage.
