# Source filter track

## Scope

Add a validated source-row filter to Data Transfer. The filter is part of the table mapping and immutable Transfer plan, is shown in preview, and is applied through bound parameters during the source scan.

## Implemented

- `SourceFilter` supports bounded `AND`/`OR` conditions for equality, comparison, `LIKE`, `IN`, `IS NULL` and `IS NOT NULL`.
- Filter columns are checked against the inspected source schema; empty values, empty `IN` lists, unknown columns and more than 32 conditions fail before writes.
- SQL fragments contain only quoted identifiers and driver placeholders. Values never enter SQL text.
- PostgreSQL-style numbered placeholders and positional placeholders are selected from the source driver family.
- Transfer plan fingerprints include enabled-table filters and execution rejects a changed filter context.
- Mapping UI lets users add, edit and remove filters, choose condition logic, and review the parameterized `WHERE` shape in preview.
- A parameter-aware streaming entry point preserves the existing streaming path for unfiltered transfers and uses typed query parameters for filtered scans.

## Validation

- Host Transfer/data-transfer tests: 55 passed.
- Source-filter unit tests cover parameterization, frontend JSON arrays, binary marker round-trip, unknown columns and empty values.
- Transfer frontend tests: 22 passed.
- Driver API tests: 131 passed.
- TypeScript check passed.

## Remaining boundary

This track covers Transfer source filters. Data Sync still needs its own filter/range contract, and stable snapshots, disk-backed comparison storage, profiles/run history and object dependency graphs remain separate parity work.
