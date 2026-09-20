# Data Sync optimistic conflicts

## Scope

This track makes Data Synchronization writes optimistic and observable. UPDATE and DELETE statements carry the target row captured during comparison as null safe, bound predicates. Execution uses the driver's affected row count and aborts the transaction when an UPDATE or DELETE affects zero rows.

## Implemented

- UPDATE/DELETE SQL requires a target row with the exact canonical projection width.
- Every non primary key target column participates in a null safe expected value predicate.
- Expected values are always bound twice for portable `value = ? OR (value IS NULL AND ? IS NULL)` semantics.
- Live sync execution uses `execute_with_params`, preserving transaction scoped affected row counts.
- `ExecutionResult.affectedRows` reports the aggregate database count and defaults during deserialization for older responses.
- Zero affected UPDATE/DELETE is returned as an optimistic conflict after rollback.

## Verification

- `cargo test -p datazen --lib data_sync::sql::tests --no-default-features`
- `cargo test -p datazen --lib data_sync::execute::tests --no-default-features`
- Frontend type checking is run before handoff.
