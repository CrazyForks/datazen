# Track: ai-timeout (Phase 3.2 超时重试 FR-15)

## 状态: IN_PROGRESS

## 目标
1. 超时常量可配 — AI settings 中 max_timeout_secs
2. 429 退避重试 — 指数退避 + jitter，最多 3 次
3. 400 错误脱敏透出 — 给用户看友好错误消息
4. 协议层统一重试逻辑

## 文件清单
- 后端：`src-tauri/src/ai/protocol/mod.rs`（重试逻辑）、`src-tauri/src/ai/protocol/openai_chat.rs`、`src-tauri/src/ai/protocol/anthropic.rs`
- 配置：`src-tauri/src/ai/` settings 相关
- 测试：mock provider 429/400 重试单测
