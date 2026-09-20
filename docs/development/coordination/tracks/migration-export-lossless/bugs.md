# Lossless export consumer bugs

## Closed

### EXPORT-LOSSLESS-001 — SQL INSERT export used a lossy host formatter

The batch export path formatted every SQL value through `data_sync::sql::format_literal`, which converted arbitrary bytes through lossy UTF-8. It now delegates each value to the live driver-owned `DatabaseDriver::format_sql_literal` implementation.

### EXPORT-LOSSLESS-002 — PostgreSQL/MySQL/SQLite driver SQL literals were lossy for bytes

The affected drivers now emit binary-safe hexadecimal literals. The shared default is also lossless hexadecimal for conservative fallback drivers.

### EXPORT-LOSSLESS-003 — CSV/JSON streaming converted bytes through replacement UTF-8

CSV now has an explicit hex marker and JSON has a structured marker object. Focused tests assert that `00 ff fe` survives without U+FFFD and that the JSON output remains parseable.

## Closed

### EXPORT-LOSSLESS-004 — CSV fields containing a bare carriage return were not quoted

`escape_csv_field` now quotes both `\n` and `\r`, preserving CSV record boundaries for text and timestamp values with either line-break character.

### EXPORT-LOSSLESS-005 — JSON byte marker collided with a native JSON object

`Value::Bytes` remains encoded as the documented bytes object. A native `Value::Json` object whose `$datazenType` is `bytes` is now wrapped as `{ "$datazenType": "json", "value": <original> }`, while ordinary JSON values remain unchanged. This removes the marker collision without changing normal JSON output.

### EXPORT-LOSSLESS-006 — SQL Server did not participate in the driver-owned binary literal contract

SQL Server now decodes `ColumnData::Binary` as `Value::Bytes` and emits the T-SQL `0xHEX` literal through its driver override. Driver-local tests cover both conversion and quoting.

## Remaining contract limits

CSV is a text interchange format, so consumers must implement the documented `datazen:bytes:hex:` and `datazen:text:` marker rules to reconstruct typed bytes and reserved text. JSON consumers must recognize the `$datazenType=bytes` object. This track does not add an import decoder.
