# SQL-file structure dependency track

## Scope

- Carry source indexes and foreign-key constraints through the existing sync IR adapter boundary.
- Render target-dialect structure objects with deterministic parent-before-child table ordering.
- Emit tables before data, then indexes and foreign keys, and bind the complete ordered structure sequence to the immutable transfer plan.
- Keep database-target transfer behavior and SQL-file data-only behavior unchanged.

## Validation

- `cargo test -p datazen --lib data_transfer::sql_file`: 8 passed.
- `cargo test -p datazen --lib commands::data_transfer`: 20 passed.
- `cargo check -p datazen --lib` with basic driver injection: passed.
- Added PG-to-MySQL identifier/mapping/order coverage and fail-closed unsupported index coverage.
- Windows atomic publish remains covered by the existing platform-gated implementation and static review.

## Known limits

- The default adapter renderer accepts portable B-tree indexes and common referential actions. Driver-specific index expressions, prefix lengths, and unsupported actions fail closed.
- Cross-database foreign keys whose referenced table is outside the selected SQL-file scope fail closed rather than emitting a dangling constraint.
