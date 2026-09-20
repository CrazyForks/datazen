# migration-sync-key-contract Bugs

## migration-sync-key-contract-BUG-001 — SQLite binary text keyset binds the seek value with the wrong storage class

- **严重等级**：P1（SQLite keyset pagination would repeat rows or fail to advance）
- **状态**：已修复，待独立复测
- **发现方式**：独立代码审查 + SQLite expression reproduction on 2026-09-20
- **范围**：`packages/drivers/sqlite/src/sync_adapter.rs`, `src-tauri/src/commands/sync/keyset_source.rs`, `packages/drivers/sqlite/src/sqlite.rs`

The SQLite adapter advertises the binary text contract and emits `CAST("key" AS BLOB)` for both `ORDER BY` and the seek predicate. `DriverKeysetSource` forwards the raw `Value::String` cursor unchanged, and the SQLite driver binds it as TEXT. SQLite does not compare `CAST(key AS BLOB)` to a TEXT parameter by byte content: the BLOB operand sorts after TEXT, so `CAST(name AS BLOB) > ?` with `? = 'a'` returns `a`, `b`, and `c` instead of only `b`, `c`. A later page therefore repeats the cursor row and the strict normalized-page check eventually fails (or a consumer can loop if that check is bypassed).

**Reproduction:**

```sql
CREATE TABLE t(name TEXT PRIMARY KEY);
INSERT INTO t VALUES ('a'), ('b'), ('c');
SELECT name FROM t
 WHERE CAST(name AS BLOB) > ?
 ORDER BY CAST(name AS BLOB);
-- bind the cursor as TEXT 'a'; actual result: a, b, c
```

Binding the cursor as `Value::Bytes` (or casting the parameter with `CAST(? AS BLOB)`) returns the correct `b, c` page. The current Data Sync V1 gate rejects SQLite↔SQLite before this path, so the defect is not covered by the PG/MySQL desktop journeys; it remains a correctness blocker for the advertised SQLite key contract and must be fixed before enabling SQLite Sync.

**Coder fix (Round 1):** `SyncSourceAdapter::sync_key_seek_value` now gives a driver control over the bound cursor representation. SQLite validates the binary text contract and converts text cursors to `Value::Bytes`; `DriverKeysetSource` applies this conversion only to seek parameters, preserving raw row values for comparison and writes. The SQLite regression covers the `a → b,c` page transition and a composite `(tenant,name)` transition to `(b,a)`. The fix is committed separately after the recorded failing baseline and awaits an independent rerun.
