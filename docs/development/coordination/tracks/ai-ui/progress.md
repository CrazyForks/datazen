# Track: ai-ui (Wave 2 — Markdown 渲染 + 代码块动作 + ContextPicker + Egress)

## 状态: PENDING (等 Wave 1 完成)

## 目标
1. `AiMessageContent` 支持 GFM 子集（marked + DOMPurify sanitize）
2. `AiCodeBlock` 加 toolbar（运行/插入/新建/复制/全屏/方言）
3. `useAutoScroll` hook + 回到底部 pill
4. ChatBubble key 改 id，tool role 浅色可折叠
5. QuestionBlock 提交后折叠保留 + answers 存 id
6. ContextPicker 服务端搜索 + 防抖 200ms + 虚拟化 + keydown 下沉
7. `.ctx.yaml` 校验表存在性 + `schema.*` 通配
8. `AiEgressNotice` 常驻单行 + 展开详情
9. `WorkflowChatPanel` 复用 `SchemaContextPipeline`
10. 连接清单文案 i18n

## 改动文件
- `src/components/ai/AiMessageContent.tsx`
- `src/components/ai/AiCodeBlock.tsx`
- `src/components/ai/AiChatPanel.tsx`（auto scroll hook）
- `src/components/ai/ContextPicker.tsx`
- `src/components/ai/AiEgressNotice.tsx`
- `src/components/ai/WorkflowChatPanel.tsx`
- `src/components/ai/AiInput.tsx`
- `src/lib/extractQuestions.ts`
- i18n `src/locales/en.ts` + `zh-CN.ts`

## 依赖
- Wave 1 完成后

## 验收
- `npx vitest run src/components/ai/__tests__/`
- `npx tsc --noEmit`
- XSS 过滤单测（script 标签、javascript: 链接）

## 自验结果
- [ ] npx vitest run src/components/ai/__tests__/
- [ ] npx tsc --noEmit

## 编码 Commit: (pending)
## 测试 Commit: (pending)
