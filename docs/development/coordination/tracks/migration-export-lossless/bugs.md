# Lossless export consumer bugs

## Closed

### EXPORT-LOSSLESS-001 — SQL INSERT export used a lossy host formatter

The batch export path formatted every SQL value through `data_sync::sql::format_literal`, which converted arbitrary bytes through lossy UTF-8. It now delegates each value to the live driver-owned `DatabaseDriver::format_sql_literal` implementation.

### EXPORT-LOSSLESS-002 — PostgreSQL/MySQL/SQLite driver SQL literals were lossy for bytes

The affected drivers now emit binary-safe hexadecimal literals. The shared default is also lossless hexadecimal for conservative fallback drivers.

### EXPORT-LOSSLESS-003 — CSV/JSON streaming converted bytes through replacement UTF-8

CSV now has an explicit hex marker and JSON has a structured marker object. Focused tests assert that `00 ff fe` survives without U+FFFD and that the JSON output remains parseable.

## Open

### EXPORT-LOSSLESS-004 — CSV fields containing a bare carriage return are not quoted

`escape_csv_field` quotes commas, quotes, and `\n`, but not `\r`. A text or timestamp value containing a bare carriage return is therefore emitted as an unquoted record separator by the lossless export path. The field must be quoted whenever it contains either CSV line-break character.

### EXPORT-LOSSLESS-005 — JSON byte marker collides with a native JSON object

`Value::Bytes` is encoded as an object with `$datazenType`, `encoding`, and `value`, while `Value::Json` is emitted unchanged. A JSON column containing that same object shape is indistinguishable from exported bytes to a marker-based consumer. The format needs a typed envelope or an escaping rule for native JSON values before claiming the marker is unambiguous.

### EXPORT-LOSSLESS-006 — SQL Server does not participate in the driver-owned binary literal contract

The shared fallback emits `X'...'`, which is not SQL Server's binary literal syntax. In addition, the SQL Server row decoder currently converts `ColumnData::Binary` to a `Value::String("0x...")`, so SQL INSERT export wraps it as text. SQL Server needs a driver override and a binary-preserving decoder before SQL export is correct for that driver.

## Remaining contract limits

CSV is a text interchange format, so consumers must implement the documented `datazen:bytes:hex:` and `datazen:text:` marker rules to reconstruct typed bytes and reserved text. JSON consumers must recognize the `$datazenType=bytes` object. This track does not add an import decoder.
