# AI Timeout Retry (FR-15 / Phase 3.2) — Track: ai-timeout

Status: READY_FOR_TEST
Branch: feature/ai-timeout
Previous commit: 3672d7608 (feat(timeout-retry): retry logic + config (partial))

## Completed (this work)
- `map_http_error` in `protocol/mod.rs` updated with 400 desensitization (`sanitize_400_error`) and 429 retry-after (`parse_retry_after`).
- `RetryConfig`, `retry_with_backoff`, `compute_backoff_delay`, `sanitize_400_error`, `parse_retry_after` verified present in `protocol/mod.rs` (from commit 3672d7608 / restored).
- Protocol retry usage restored/integrated in `openai_chat.rs`, `openai_responses.rs`, `anthropic.rs`.
- `packages/ai-api/src/types.rs`: `AiProviderConfig.max_timeout_secs` and `AiModelProfile.max_timeout_secs` present (default 120).
- `ProtocolConfig.max_request_timeout` present with `DEFAULT_REQUEST_TIMEOUT` = 120s.
- Production `unwrap()` cleaned (replaced with `.map(...).unwrap_or_default()` in `openai_chat.rs`).

## Remaining (for Tester / next subagent round)
- Full retry integration verification in `openai_chat`, `openai_responses`, `anthropic` `complete()` paths (retry wrapper applied to HTTP post + error mapping).
- `CARGO_TARGET_DIR=target/cargo-timeout cargo test -p datazen-ai-api --lib` and `-p datazen --lib ai`.
- Final commit message: `feat(timeout-retry): FR-15 retry + 400/429 desensitization`.
