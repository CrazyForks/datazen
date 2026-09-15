# PR-3: Collection Editors Depth (Hash / List / Set / ZSet)

> **Status**: FAILED (1 bug — BUG-001)
> **Branch**: feat/redis-pr3-collection-editors
> **Coder**: coding subagent (auto)
> **Tester**: test subagent (auto)

## Deliverables

### Backend (Rust)
- `ops.rs`: Added `hash_scan`, `list_range`, `set_scan`, `zset_scan` pure helpers with cursor-based pagination support
- `redis_driver.rs`: Added `plugin_hash_scan`, `plugin_list_range`, `plugin_set_scan`, `plugin_zset_scan` plugin methods
- `commands_exec_dispatch.rs` + `commands_exec_mutate.rs`: Added `hash_scan`, `list_range`, `set_scan`, `zset_scan` command dispatch arms

### UI (TypeScript)
- `HashEditor.tsx`: Cursor-based HSCAN pagination, search box (match pattern), inline edit field/value, delete field, refresh
- `ListEditor.tsx`: LRANGE offset pagination (prev/next), inline edit elements, delete element, refresh
- `SetEditor.tsx`: Cursor-based SSCAN pagination, search box (match pattern), inline edit member, delete member, refresh
- `ZsetEditor.tsx`: Cursor-based ZSCAN pagination, search box (match pattern), sort by score (asc/desc/none), inline edit score, delete member, refresh

### i18n
- `en.ts`: Added `redis.search`, `redis.loadPrev`, `redis.loadNext`, `redis.pageInfo`, `redis.totalItems`, `redis.sortAsc`, `redis.sortDesc`
- `zh-CN.ts`: Added corresponding Chinese translations

## Self-Verification (Coder)

| Check | Result |
|-------|--------|
| `cargo test -p datazen-driver-redis --lib` | 63 passed, 0 failed |
| `npx tsc --noEmit` | No errors in modified files (pre-existing codegen errors only) |

## Independent Verification (Tester)

| Check | Result |
|-------|--------|
| `cargo test -p datazen-driver-redis --lib` | **96 passed**, 0 failed, 1 ignored |
| `npx tsc --noEmit` | No errors in modified files (pre-existing codegen errors only) |
| `npx vitest run --config vitest.drivers.config.ts` | keyEditorsInvokes: **21 passed**; 4 pre-existing failures unrelated to PR-3 |

### Coverage (Tester)

| Module | Tests Added | Coverage |
|--------|-------------|----------|
| `ops.rs` parse helpers | +33 (value_to_string, parse_cursor_from_value, parse_flat_string_pairs, parse_flat_string_array, parse_hash_scan_result, parse_scan_result_generic, parse_zscan_result, parse_string_array) | ≥95% of parse helper branches |
| `keyEditorsInvokes.ts` invoke fns | +10 (invokeHashScan, invokeListRange, invokeSetScan, invokeZsetScan with/without matchPattern) | 100% of new invoke functions |
| `ops.rs` async fns | 0 (requires live Redis) | N/A — async wrappers are thin delegations |

### i18n Audit
- en.ts: 7 new keys ✓
- zh-CN.ts: 7 new keys (matching) ✓

## Known Bugs

| Bug ID | Severity | Description |
|--------|----------|-------------|
| BUG-001 | Medium | ListEditor delete button always pops from left (LPOP) instead of removing the clicked element at its specific index. See `bugs.md`. |

## E2E Test Cases

| Case | Scope | Status |
|------|-------|--------|
| HashEditor: HSCAN load/search/inline-edit/delete | Backend + UI | 【留待 R 回归】— requires live Redis with hash key |
| ListEditor: LRANGE pagination/inline-edit/delete | Backend + UI | 【留待 R 回归】— BUG-001 (delete broken) |
| SetEditor: SSCAN load/search/inline-edit/delete | Backend + UI | 【留待 R 回归】— requires live Redis with set key |
| ZsetEditor: ZSCAN load/search/sort/inline-edit/delete | Backend + UI | 【留待 R 回归】— requires live Redis with zset key |

## Files Changed

```
packages/drivers/redis/src/ops.rs                    (+33 tests)
packages/drivers/redis/src/redis_driver.rs
packages/drivers/redis/src/commands_exec_dispatch.rs
packages/drivers/redis/src/commands_exec_mutate.rs
packages/drivers/redis/ui/HashEditor.tsx
packages/drivers/redis/ui/ListEditor.tsx
packages/drivers/redis/ui/SetEditor.tsx
packages/drivers/redis/ui/ZsetEditor.tsx
packages/drivers/redis/ui/keyEditorsInvokes.ts
packages/drivers/redis/ui/__tests__/keyEditorsInvokes.test.ts (+10 tests)
packages/drivers/redis/locales/en.ts
packages/drivers/redis/locales/zh-CN.ts
docs/development/coordination/tracks/redis-pr3-collection-editors/progress.md
docs/development/coordination/tracks/redis-pr3-collection-editors/bugs.md (new)
```
