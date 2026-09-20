# Source filter track bugs

## SFLT-001: UI numeric filters bind as PostgreSQL text parameters

| Field | Value |
| --- | --- |
| Severity | S2 for the filtered-transfer feature |
| Status | 已验证 |
| Found | 2026-09-20 |
| Scope | Data Transfer source filter, PostgreSQL source |
| Repro | 100% |

### Reproduction

1. Create a PostgreSQL source table with an integer column, for example `id INT`, and rows with `id` values `1`, `2`, `3`, and `4`.
2. Open Data Transfer and add a source filter on `id` with operator `>` and value `2` in the source-filter editor.
3. Preview a data transfer to an empty compatible target table.
4. Execute the reviewed plan.

The UI editor stores every typed value as a string (`SourceFilterEditor.tsx` uses `String(event.target.value)`). The preview is accepted and displays the parameterized shape `WHERE ("id" > ?)`, but execution binds the value as PostgreSQL `text`.

Observed result from the original real PostgreSQL transfer:

```text
FILTER_RESULT {"cancelled":false,"partial":true,"rowsInserted":0,"tables":[{"error":"Query failed: error returned from database: operator does not exist: integer > text","rowsInserted":0,"sourceTable":"tmp_sf_mu9ff12y","success":false,"targetTable":"tmp_sf_mu9ff12y"}]}
```

### Expected

A numeric value entered for an integer or numeric source column is converted or typed so PostgreSQL executes the predicate and copies the matching rows. Preview should validate the same typed binding that execution will use.

### Related code

- `src/windows/data-transfer/SourceFilterEditor.tsx`: input change always writes a string.
- `src-tauri/src/data_transfer/filter.rs`: JSON strings become `Value::String` and the filter placeholder is generated without source-column type information.
- `src-tauri/src/commands/data_transfer/preview.rs`: capability validation previously called `parameter_placeholder(1, None)`, so the reviewed plan did not catch this typed PostgreSQL failure.

### Fix

`build_where_typed` now passes the inspected source column type to the driver's placeholder formatter in both preview validation and execution. PostgreSQL therefore emits casts such as `$1::integer` while retaining the exact user-entered value as a bound parameter. The browser remains string-based so large values do not lose precision in JavaScript.

### Verification

| Date | Tester | Method | Result |
| --- | --- | --- | --- |
| 2026-09-20 | independent tester | Fresh WebDriver UI journey with PostgreSQL source, editor value `id > 2`, immutable preview, execution, and target IPC query | Verified: execution completed with 2 inserted rows and the target contained exactly ids 3 and 4 |

## SFLT-002: PostgreSQL source-filter preview hides the typed placeholder cast

| Field | Value |
| --- | --- |
| Severity | S3 (preview and execution contract mismatch) |
| Status | 待修复 |
| Found | 2026-09-20 |
| Scope | Data Transfer source-filter preview, PostgreSQL source |
| Repro | 100% |

### Reproduction

1. Create a PostgreSQL source table with `id INT` and rows with ids 1 through 4, plus an empty compatible target table.
2. Open Data Transfer, select the PostgreSQL source and target, inspect the table, and add a source filter with column `id`, operator `>`, and value `2`.
3. Advance to the preview step.

Observed preview text from the real WebDriver journey:

```text
源过滤条件: WHERE ("id" > ?)
SOURCE_FILTER_PREVIEW_HAS_INTEGER_CAST false
SOURCE_FILTER_PREVIEW_HAS_ANON_PLACEHOLDER true
```

### Expected

The reviewed preview should show the typed placeholder shape used by PostgreSQL execution, such as `WHERE ("id" > $1::integer)`, or the product contract should explicitly state that the displayed anonymous placeholder is only a redacted representation of a typed bound parameter.

### Actual

The preview is always built through `preview_where`, which emits an anonymous `?` placeholder and does not receive the source column type. Preview validation does call the typed placeholder formatter, but its typed SQL is discarded; therefore the visible preview cannot confirm the binding that execution will use.

The same journey confirmed that execution itself is correct: result text was `成功已插入行数: 2`, and the target query returned `[[3,"three"],[4,"four"]]`.

### Related code

- `src-tauri/src/data_transfer/filter.rs`: `SourceFilter::preview_where` calls `build_where` with `?` and no source type callback.
- `src-tauri/src/commands/data_transfer/preview.rs`: typed validation is performed, but only for capability checking; the resulting typed SQL is not returned in `source_filter_preview`.
