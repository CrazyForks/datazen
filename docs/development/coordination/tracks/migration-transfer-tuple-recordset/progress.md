# migration-transfer-tuple-recordset

Phase: PLANNED

## Scope

Extend deterministic Data Transfer recordset selection to composite primary keys. Keep the existing single-column JSON/profile representation backward compatible. New tuple bounds must match the complete source primary-key identity in declared key order; do not accept partial, reordered, nullable, or ambiguous keys.

Build parameterized lexicographic start/end predicates and deterministic `ORDER BY` using source-driver quoting and placeholder/type contracts. Validate tuple arity and each bound component against the corresponding source key type. If a driver cannot guarantee the ordering used by both the range predicate and scan, reject the range with a clear preview error. Never compare opaque text/decimal/temporal keys using an incorrect host-language ordering.

## Acceptance criteria

- [ ] Legacy scalar recordsets deserialize and round-trip unchanged; new tuple payloads are versioned or unambiguously distinguishable.
- [ ] Composite tuple bounds require the complete ordered primary key; arity, nullability, wrong types, reversed/empty ranges, and unsupported driver ordering fail closed.
- [ ] Generated SQL uses bound parameters only and its predicate order matches deterministic source scanning.
- [ ] Preview reports the effective tuple range and count; immutable plan fingerprints bind tuple columns and values so changed ranges invalidate stale previews/checkpoints.
- [ ] Rust tests cover two- and three-column keys, inclusive/exclusive boundaries, each component type, invalid/reordered/partial keys, parameter order, and legacy profile compatibility.
- [ ] PG/MySQL WDIO journeys transfer only rows inside composite-key ranges and verify source/target read-back; SQLite is covered only if its advertised ordering contract supports the same range.

## E2E registration

- [ ] Composite-key range journey: 【本机可执行】 using PG and MySQL fixtures with non-ASCII text, negative/large numeric components, and both inclusive and exclusive endpoints.

## Self-validation

- Pending Coder.

## Independent Tester

- Pending fresh Tester; review every changed file, assess changed-core coverage (target at least 80%), rerun all checks and WDIO cases, and register all bugs before reporting.
