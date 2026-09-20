# Source filter track bugs

## SFLT-001: UI numeric filters bind as PostgreSQL text parameters

| Field | Value |
| --- | --- |
| Severity | S2 for the filtered-transfer feature |
| Status | Fixed in pending retest |
| Found | 2026-09-20 |
| Scope | Data Transfer source filter, PostgreSQL source |
| Repro | 100% |

### Reproduction

1. Create a PostgreSQL source table with an integer column, for example `id INT`, and rows with `id` values `1`, `2`, `3`, and `4`.
2. Open Data Transfer and add a source filter on `id` with operator `>` and value `2` in the source-filter editor.
3. Preview a data transfer to an empty compatible target table.
4. Execute the reviewed plan.

The UI editor stores every typed value as a string (`SourceFilterEditor.tsx` uses `String(event.target.value)`). The preview is accepted and displays the parameterized shape `WHERE ("id" > ?)`, but execution binds the value as PostgreSQL `text`.

Observed result from a real PostgreSQL transfer:

```text
FILTER_RESULT {"cancelled":false,"partial":true,"rowsInserted":0,"tables":[{"error":"Query failed: error returned from database: operator does not exist: integer > text","rowsInserted":0,"sourceTable":"tmp_sf_mu9ff12y","success":false,"targetTable":"tmp_sf_mu9ff12y"}]}
```

No rows are copied. The same temporary journey with a JSON numeric value (`value: 2`, bypassing the UI string editor) reported `rowsInserted: 2` and `partial: false`, which isolates the defect to frontend value typing / server-side type inference rather than the filter predicate or target writer.

### Expected

A numeric value entered for an integer or numeric source column is converted or typed so PostgreSQL executes the predicate and copies the matching rows. Preview should validate the same typed binding that execution will use.

### Related code

- `src/windows/data-transfer/SourceFilterEditor.tsx`: input change always writes a string.
- `src-tauri/src/data_transfer/filter.rs`: JSON strings become `Value::String` and the filter placeholder is generated without source-column type information.
- `src-tauri/src/commands/data_transfer/preview.rs`: capability validation calls `parameter_placeholder(1, None)`, so the reviewed plan does not catch this typed PostgreSQL failure.

### Fix

`build_where_typed` now passes the inspected source column type to the driver's placeholder formatter in both preview validation and execution. PostgreSQL therefore emits casts such as `$1::integer` while retaining the exact user-entered value as a bound parameter. The browser remains string-based so large numeric values do not lose precision in JavaScript.
