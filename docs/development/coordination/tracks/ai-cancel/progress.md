# Track: ai-cancel (Wave 1 — 取消注册表 + 流式取消 + Tool Loop 护栏)

## 状态: READY_FOR_TEST

## 目标
1. ✅ 新建 `src-tauri/src/ai/cancel.rs` — `CancellationRegistry`（requestId → CancellationToken）
2. ✅ `AppState` 新增 `cancel_registry` 字段
3. ✅ 新增 IPC `ai_cancel` 命令
4. ✅ `ai_generate_sql` / `ai_chat` 入口接入 cancel 注册/检查/注销
5. ✅ `run_streaming_tool_loop` 加 `ToolLoopGuard`（rounds/token/time 预算）
6. ✅ Tool 结果截断摘要化（per-tool 2KB, per-round 12KB）
7. ✅ Unknown tool 直接终止回错
8. ⏳ MCP 写工具确认流程（`ai_confirm_tool` IPC + 前端 Dialog）— 函数已定义，IPC 待后续阶段接入
9. ✅ 三个 Protocol 的 SSE 循环加 cancel 检查
10. ⏳ `StreamChunk` 透传 `cancelled: bool` — 取消时通过 done chunk + `AiError::Cancelled` 传递

## 改动文件
- `src-tauri/src/ai/cancel.rs`（新）
- `src-tauri/src/ai/mod.rs`（export）
- `src-tauri/src/ai/protocol/openai_chat.rs`
- `src-tauri/src/ai/protocol/openai_responses.rs`
- `src-tauri/src/ai/protocol/anthropic.rs`
- `src-tauri/src/commands/ai/chat.rs`
- `src-tauri/src/commands/ai/generate.rs`
- `src-tauri/src/commands/ai/mod.rs`（注册新命令）

## 依赖
- Wave 0（ai-api-base）：`AiError::Cancelled`、`StreamChunk.cancelled`、`CompletionRequest.cancel_token`

## 验收
- `cargo test -p datazen --lib ai` 全过
- `cargo check -p datazen --lib` 编译通过
- cancel 注册/取消/注销单测通过
- ToolLoopGuard 6 轮收敛单测通过

## E2E 用例
- 【本机可执行】NL2SQL 生成中点击停止，≤500ms 停止，保留草稿
- 【留待 R 回归】Chat 多轮中写 MCP 工具弹窗确认

## 自验结果
- [x] cargo test -p datazen --lib ai — 307 passed, 0 failed
- [x] cargo check -p datazen --lib — 编译通过，0 warnings

## 编码 Commit: 87706feb3
## 测试 Commit: (pending)
