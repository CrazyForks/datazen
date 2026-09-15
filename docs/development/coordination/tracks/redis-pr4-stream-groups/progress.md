# PR-4: Stream Consumer Groups — Progress

> **Track**: redis-pr4-stream-groups  
> **Base branch**: feat/redis-pr1-keepttl-expireat-decompress  
> **Status**: READY_FOR_TEST  
> **Coder**: subagent-coder  

## Summary

Enhanced Stream editor with Consumer Groups table, Pending message viewing, Lag monitoring, and Ack support.

## Changes

### Backend (packages/drivers/redis/src/)

1. **ops_stream.rs**:
   - Added `ConsumerInfo` struct (name, pending, idle_ms, delivery_count)
   - Added `StreamLagResult` struct (lag: Option<u64>)
   - Added `xinfo_consumers(conn, key, group)` → `Vec<ConsumerInfo>`
   - Added `stream_lag(conn, key, group)` → `StreamLagResult`
   - Added `parse_xinfo_consumers()` and `parse_stream_id()` helpers
   - Added 4 unit tests (parse_xinfo_consumers, parse_stream_id, empty consumers)

2. **redis_driver.rs**:
   - Added `plugin_xinfo_consumers(connection_id, db_index, key, group)`
   - Added `plugin_stream_lag(connection_id, db_index, key, group)`

3. **commands.rs**:
   - Registered `xinfo_consumers` command (XINFO CONSUMERS)
   - Registered `stream_lag` command (Stream lag)
   - Updated category match to include new commands

4. **commands_exec_all_arms.rs / commands_exec_ops.rs / commands_exec_dispatch.rs**:
   - Added dispatch arms for `xinfo_consumers` and `stream_lag`

### UI (packages/drivers/redis/ui/)

1. **StreamEditor.tsx**:
   - Added `ConsumerInfo` interface
   - Added `invokeXinfoConsumers()` and `invokeStreamLag()` invoke functions
   - Added `expandedGroup` and `consumers` state
   - Groups table now includes Lag column
   - Groups table has expand/collapse chevron per row
   - Clicking expand shows consumers sub-table (name, pending, idleMs, deliveryCount)
   - `loadGroups()` fetches lag for each group in parallel
   - `loadConsumers()` callback fetches consumers for expanded group

### i18n (packages/drivers/redis/locales/)

1. **en.ts**: Added `redis.streamLag`, `redis.streamConsumerName`, `redis.streamConsumersEmpty`
2. **zh-CN.ts**: Added `redis.streamLag` (延迟), `redis.streamConsumerName` (消费者名称), `redis.streamConsumersEmpty` (该组中没有消费者)

## Self-Verification

| Check | Status |
|-------|--------|
| `cargo test -p datazen-driver-redis --lib` | ✅ 66 passed, 0 failed, 1 ignored |
| `npx tsc --noEmit` | ✅ No new errors (pre-existing codegen errors only) |

## Commit

- Hash: TBD (will be filled after commit)
