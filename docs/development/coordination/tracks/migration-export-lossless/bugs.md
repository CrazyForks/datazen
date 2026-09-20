# Lossless export consumer bugs

## Closed

### EXPORT-LOSSLESS-001 — SQL INSERT export used a lossy host formatter

The batch export path formatted every SQL value through `data_sync::sql::format_literal`, which converted arbitrary bytes through lossy UTF-8. It now delegates each value to the live driver-owned `DatabaseDriver::format_sql_literal` implementation.

### EXPORT-LOSSLESS-002 — PostgreSQL/MySQL/SQLite driver SQL literals were lossy for bytes

The affected drivers now emit binary-safe hexadecimal literals. The shared default is also lossless hexadecimal for conservative fallback drivers.

### EXPORT-LOSSLESS-003 — CSV/JSON streaming converted bytes through replacement UTF-8

CSV now has an explicit hex marker and JSON has a structured marker object. Focused tests assert that `00 ff fe` survives without U+FFFD and that the JSON output remains parseable.

## Remaining contract limits

CSV is a text interchange format, so consumers must implement the documented `datazen:bytes:hex:` and `datazen:text:` marker rules to reconstruct typed bytes and reserved text. JSON consumers must recognize the `$datazenType=bytes` object. This track does not add an import decoder.
