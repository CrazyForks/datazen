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
