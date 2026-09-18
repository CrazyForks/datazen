# Track: ai-frontend (Wave 1 — 前端会话隔离 + NL2SQL 流式预览 + 显示修正)

## 状态: READY_FOR_TEST

## 目标
1. ✅ 新建 `src/stores/ai/sessions.ts` — SessionKey 计算 + 持久化 + LRU
2. ✅ `aiStore` 重构：`requestId → SessionKey` 映射路由（stream chunk 按 key 分发）
3. ✅ NL2SQL 新增 `streamingSql`（原始累积）+ `streamingPreview` + `extractSqlStreaming`（fence 容错）
4. ✅ `Nl2SqlPanel` 增加 SQL 预览区 + 停止态
5. ✅ `AiChatPanel` 修复：思考条件 `!streamContent && !streamReasoning`
6. ✅ `onAiStreamError` / `clearChat` / `clearWorkflowChat` 补清 `streamReasoning`
7. ✅ Chat 历史持久化到 localStorage（50 轮/会话上限）
8. ✅ ChatBubble key 改为 `msg.id ?? i`（非 index）
9. ✅ `AiChatMessage` 新增可选 `id` 字段

## 未完成（后续轨道）
- 8. NL Filter 按 `tableKey` 缓存 `parsedFilters`
- 9. Explain 按 `hash(sql+plan)` LRU 缓存

## 改动文件
- `src/stores/ai/sessions.ts`（新）
- `src/stores/ai/types.ts` — `Nl2SqlState` 新增 `streamingSql` + `streamingPreview`
- `src/stores/aiStore.ts` — `requestIdToKey` 路由 + `streamingSql` 拼接 + `streamReasoning` 清理
- `src/types/index.ts` — `AiChatMessage` 新增可选 `id` 字段
- `src/components/ai/AiChatPanel.tsx` — 思考条件修复 + ChatBubble key
- `src/components/ai/Nl2SqlPanel.tsx` — SQL 预览区 + 停止按钮 + 复制按钮
- `src/commands/ai.ts` — `cancel(requestId)` IPC 封装
- `src/lib/extractSql.ts` — 新增 `extractSqlStreaming`
- `src/lib/__tests__/extractSql.test.ts` — 新增 extractSqlStreaming 测试
- `src/stores/__tests__/aiStore.test.ts` — 更新 nl2sql streaming 断言
- `src/stores/ai/__tests__/sessions.test.ts`（新）— session isolation 单测

## 依赖
- Wave 0（ai-api-base）：`StreamChunk.cancelled` 类型可用（cancel IPC 后端待实现）

## 验收
- ✅ `npx vitest run src/stores/__tests__/aiStore.test.ts` — 41/41 pass
- ✅ `npx vitest run src/stores/ai/__tests__/sessions.test.ts` — 10/10 pass
- ✅ `npx vitest run src/lib/__tests__/extractSql.test.ts` — 19/19 pass
- ✅ `npx tsc --noEmit` — clean
- ✅ extractSqlStreaming 单测覆盖：fence 未闭合 / 无 fence / 混合文本 / 闭合 fence / 空行

## E2E 用例
- 【本机可执行】双连接各聊 3 轮互不串
- 【本机可执行】NL2SQL 10s 生成全程可见预览
- 【留待 R 回归】切 Tab 回来 NL2SQL/Explain 结果仍在

## 自验结果
- [x] npx vitest run src/stores/__tests__/aiStore.test.ts — 41 pass
- [x] npx vitest run src/stores/ai/__tests__/sessions.test.ts — 10 pass
- [x] npx vitest run src/lib/__tests__/extractSql.test.ts — 19 pass
- [x] npx tsc --noEmit — clean

## 编码 Commit: (pending)
## 测试 Commit: (pending)
