# PR-8: Pub/Sub Enhance — Progress

> **Track**: redis-pr8-pubsub-enhance  
> **Base branch**: v0.2.2  
> **Status**: READY_FOR_TEST  
> **Coder**: subagent-coder  

## Summary

Enhanced Redis Pub/Sub panel with active subscription listing, message statistics, message search/filter, and subscription type badges.

## Changes

### Backend (packages/drivers/redis/src/)

1. **ops_pubsub.rs** (290 → 372 lines):
   - Added `SubscriptionInfo` struct (subscription_id, channels, patterns) with serde Serialize
   - Added `PubSubStats` struct (total_messages, by_channel) with serde Serialize
   - Enhanced `SubscriptionEntry` with `channels` and `patterns` fields
   - Added `stats` HashMap to `SubscriptionRegistry` tracking per-connection message counts
   - Added `list_active_subscriptions(connection_id)` → `Vec<SubscriptionInfo>`
   - Added `pubsub_stats(connection_id)` → `PubSubStats`
   - Stats are incremented in the subscribe loop via spawned tasks
   - Added 2 unit tests for new functions

2. **commands.rs**:
   - Registered `pubsub_list_subscriptions` command (Category: PubSub)
   - Registered `pubsub_stats` command (Category: PubSub)
   - Both use `redis:allow-pubsub-subscribe` permission

3. **commands_exec_dispatch.rs**:
   - Added dispatch arm for `pubsub_list_subscriptions` → returns `{ subscriptions: SubscriptionInfo[] }`
   - Added dispatch arm for `pubsub_stats` → returns `{ totalMessages, byChannel }`

### UI (packages/drivers/redis/ui/)

1. **PubSubPanel.tsx** (370 → 420 lines):
   - Added `Search` icon import and `searchText` state
   - Added `filteredMessages` useMemo with channel/payload text matching
   - Added `channelStats` useMemo computing top 5 channels by message count
   - Added search input in message header bar with Search icon
   - Replaced static message count with `pubsubMessageCount` i18n
   - Added "no filter results" empty state when search matches nothing
   - Table now renders `filteredMessages` instead of `messages`
   - Added stats bar at bottom showing top channels with counts
   - Enhanced subscription list with Channel/Pattern type badges (colored pills)

### i18n (packages/drivers/redis/locales/)

1. **en.ts**: Added 8 keys: `pubsubSearchPlaceholder`, `pubsubMessageCount`, `pubsubMessagesPerSec`, `pubsubTopChannels`, `pubsubSubscriptionType`, `pubsubTypeChannel`, `pubsubTypePattern`
2. **zh-CN.ts**: Added matching 8 keys in Chinese

### Tests (packages/drivers/redis/ui/__tests__/)

1. **PubSubPanel.test.tsx** (new, 9 tests):
   - Renders subscribe and publish sections
   - Clear messages button empties message list
   - Shows empty state when no messages
   - Search input is present for filtering messages
   - Subscribe button calls invoke with channels and patterns
   - Unsubscribe button calls invoke and removes subscription
   - Shows channel type badge for channel subscriptions
   - Shows pattern type badge for pattern subscriptions
   - Publish calls invoke with channel and message

## Notes

- Backend already correctly uses `psubscribe` for pattern subscriptions (line 238-241 of ops_pubsub.rs) — no fix needed
- Clear messages button already existed — enhanced with i18n `pubsubMessageCount`
- File sizes: ops_pubsub.rs 372 lines, PubSubPanel.tsx 420 lines — both under 500 limit

## Self-Verification (Coder)

| Check | Status |
|-------|--------|
| `cargo test -p datazen-driver-redis --lib` | ✅ 110 passed, 0 failed, 1 ignored |
| `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/` | ✅ PubSubPanel 9/9 passed (other failures pre-existing) |
| `npx tsc --noEmit` | ✅ No new Redis-related errors (pre-existing codegen errors only) |
