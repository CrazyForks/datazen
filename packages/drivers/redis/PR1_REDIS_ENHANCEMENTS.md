# PR-1 Redis enhancements

Branch: `feat/redis-enhancements-v2`

## Scope

1. **Absolute expire (`EXPIREAT`)** — `set_ttl` accepts optional `expireAt` (unix seconds).
2. **Keep TTL on string save (`SET … KEEPTTL`)** — `set_string` accepts optional `keepTtl`.
3. **Decompress view** — gzip/zlib detection + read-only decompressed text in String editor.

## Files

| Area | Files |
|------|-------|
| Backend | `src/ops.rs`, `src/commands.rs`, `src/redis_driver.rs` |
| Frontend | `ui/KeyEditors.tsx`, `ui/stringKeyValue.ts` |
| i18n | `locales/en.ts`, `locales/zh-CN.ts` |
| Tests | `ui/__tests__/stringKeyValue.test.ts` |

## Status

- [x] `stringKeyValue.ts` decompress helpers
- [ ] Backend EXPIREAT / KEEPTTL (in progress)
- [ ] KeyEditors UI wiring
- [ ] Locales for all UI strings

## Compatibility

- `KEEPTTL` requires Redis ≥ 6.0
- `EXPIREAT` is widely available
- Decompress uses browser `DecompressionStream` (Chromium / modern WebView)
