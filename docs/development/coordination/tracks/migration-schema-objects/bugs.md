# migration-schema-objects bugs

## migration-schema-objects-BUG-001 — P1: SQLite multiline view definitions are extracted with a corrupt prefix

- Status: 待修复
- Location: `packages/driver-api/src/schema_objects.rs`, SQLite `object_ddl_sql` for `ObjectKind::View`.
- Reproduction: create a SQLite view with valid formatting where `AS` is followed by a newline, then call the `get_object_ddl` schema-object command:

  ```sql
  CREATE TABLE source_rows (id INTEGER PRIMARY KEY);
  CREATE VIEW active_rows AS
  SELECT id
  FROM source_rows;
  ```

  Run:

  ```bash
  CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-sqlite --test schema_object_commands test_tester_view_ddl_preserves_query_body_when_as_is_multiline -- --exact --nocapture
  ```

- Actual: the command returns `ATE VIEW active_rows AS\nSELECT id\nFROM source_rows`; the extraction query searches only for the literal `' as '` sequence and falls back to `substr(sql, 4)` when `AS` is followed by a newline.
- Expected: return exactly `SELECT id\nFROM source_rows`, preserving the query body for reviewed view migration.
- Impact: a valid SQLite view can produce malformed source/target metadata. A source-only migration can render invalid `CREATE VIEW ... AS ATE VIEW ...` SQL; target snapshot validation and rollback metadata can also be based on the corrupted body.
- New regression: `packages/drivers/sqlite/tests/schema_object_commands.rs::test_tester_view_ddl_preserves_query_body_when_as_is_multiline`.

## migration-schema-objects-BUG-002 — P2: SQLite CRLF view definitions retain a leading newline

- Status: 待修复
- Location: `packages/driver-api/src/schema_objects.rs`, SQLite `object_ddl_sql` for `ObjectKind::View`.
- Reproduction: create a SQLite view whose `AS` separator uses CRLF, then call the `get_object_ddl` schema-object command:

  ```sql
  CREATE TABLE source_rows (id INTEGER PRIMARY KEY);
  CREATE VIEW crlf_view AS\r\nSELECT id\r\nFROM source_rows;
  ```

  Run:

  ```bash
  CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-sqlite --test schema_object_commands test_tester_round2_view_ddl_preserves_single_line_and_spacing_variants -- --exact --nocapture
  ```

- Actual: returned DDL is `\nSELECT id\r\nFROM source_rows`; the leading newline remains after `AS` because the normalized CRLF separator is two characters while the extraction offset advances by four bytes for the single-space ` as ` token.
- Expected: return exactly `SELECT id\r\nFROM source_rows`, preserving the query body without a leading separator newline.
- Impact: CRLF-formatted views produce inconsistent source metadata and can add an unintended leading newline to rendered reviewed migration SQL. The result is still executable SQL, so this is lower severity than BUG-001.
- New regression: `packages/drivers/sqlite/tests/schema_object_commands.rs::test_tester_round2_view_ddl_preserves_single_line_and_spacing_variants`.
