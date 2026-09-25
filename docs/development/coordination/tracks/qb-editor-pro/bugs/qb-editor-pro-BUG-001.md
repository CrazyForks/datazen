# qb-editor-pro-BUG-001 · Builder context changes do not invalidate the open draft

- **严重度**：P1
- **状态**：已修复，待 Tester 复测
- **涉及文件**：`src/windows/connection/query/QueryEditorSection.tsx`、`src/windows/connection/query/QueryBuilderHostAdapter.tsx`、`packages/pro-extensions/sql-editor-pro/src/query-builder/contribution.tsx`
- **描述**：Query tab 的 database/schema selector 在 Builder 打开时仍可操作；切换后 React 将新的 database/schema/catalog props 传给已打开的 Pro panel，但 Host 没有用新的 context key 再调用 `queryBuilder.openFor(panelId, contextKey)`。`openFor` 是清理该 panel 旧会话的唯一入口，因此画布仍保留旧 database/schema 下的 tables、joins、conditions 和 selections，却按新 context 加载元数据并生成 SQL。相同表名在新库存在时，用户可能把旧画布内容写进针对新库的编辑器语句。
- **重现步骤**：
  1. 在 PostgreSQL Query tab 的 `app.public` context 打开 Visual Builder，并在画布选入一张表。
  2. 不关闭 Builder，使用顶部 Query context selector 切换到 `analytics.private`。
  3. 观察 Builder 仍保留旧画布选择；新的 database/schema 已进入面板 props，但 controller 未收到新的 context key，也没有清理旧 draft。
- **实测错误日志与影响范围**：新增 Host 集成回归测试 `QueryEditorSection.qbContext.test.tsx` 打开 Builder 后将 props 从 `app.public` 改为 `analytics.private`。期望 controller 再次收到 `openFor('query-panel-1', '["connection-1","session-1","analytics","private"]')`，实测仅收到原始 key `'["connection-1","session-1","app","public"]'`；断言失败：`expected last "vi.fn()" call to have been called with ...`。复现影响所有 Builder 开启期间发生的 database/schema context 变化；未打开 Builder 时和显式关闭后重新打开会正确使用新 context。

## 修复与自验

- `QueryEditorSection` 现在用 panel id、Pro contribution 身份和序列化后的 connection/session/database/schema key 记录已绑定 context。
- Builder 保持打开时，`useLayoutEffect` 会在新 props 绘制前调用 `openFor` 绑定新 context；Pro contribution 的既有生命周期逻辑会在 context key 变化时同步清理旧 draft。
- Host 回归测试 `QueryEditorSection.qbContext.test.tsx` 通过（1/1）；Query 目录单测通过（7 files / 125 tests）；Pro contribution lifecycle 测试在 Pro 全量套件内通过。
- Pro WebDriver QB suite 以当前 Host 源码重建后通过（4 specs / 22 tests）。
- 当前状态等待独立 Tester Round 2 复核。
