# Bugs — landing-page-opt

> 登记规范见 `docs/development/subagent/tester.md` §3。ID 格式：`landing-page-opt-BUG-nnn`。
> 本轮 Tester：全新实例，四阶段（A/B/C/D）完整执行后一次性登记（commit 79cb6e6816f670dccc81920d10fb5fe79085e6e9）。
> 复测 Tester（第 1 轮修复后）：又一个全新实例，完整复测（A/B/C/D）后判定两条 Bug 均已修复，状态置 `已修复`（commit ae40645b81638327d2be22b127aea8c22dc0e7e9）。

---

## landing-page-opt-BUG-001

- **描述**：相对时间文案未接 i18n，zh-CN 用户在 State 3 落地页 Recent queries 区看到英文。`src/lib/relativeTime.ts` 硬编码 `'just now'` 且 `Intl.RelativeTimeFormat('en', …)` 固定英文 locale；方案 §7 明确列出的 `connWin.home.queries.justNow / minutesAgo / hoursAgo / daysAgo` 四个 key 均未创建（仅创建了 `queries.rerun`），且该偏离未记录进 progress.md「偏离决策」节（该节第 3 条只覆盖了 footer key）。>7d 回退路径用 `toLocaleDateString(undefined,…)` 反而是 locale 感知的，行为不一致。
- **严重级**：低-中（功能可用、不阻断；但 zh-CN 为一等语言，用户可见英文文案 + 未记录的方案偏离）
- **状态**：已修复（复测 Tester 判定：commit `ae40645b` 修复有效，复测通过）
- **复测结论（第 1 轮修复，2026-09-11）**：修复采用组件层组装——`RecentQueriesList` 新增 `useRelativeTimeLabel()`，以 `getRelativeTimeParts` 结构化 parts + `t()` 拼装，`relativeTime.ts` 既有 API 零变更、仅新增导出 `RELATIVE_WINDOW_MS`（与实现共用 `MAX_RELATIVE_DAYS * DAY_MS`，边界取值一致无漂移）；en/zh-CN 四 key 齐备（en 缩写式 `1/5 min·hr·d ago` 对单位缩写而言数字无关，符合项目现有 `{count}` 非复数惯例）。复测实测：真实 i18n 链（useI18n → settingsStore → getTranslation，无 mock）渲染 zh-CN 「刚刚 / 2 分钟前 / 3 小时前 / 2 天前」与 en `just now / 2 min ago / 3 hr ago / 2 d ago` 全部通过（新增 12 条 [tester] 用例，见 `retest-round1-fixes.tester.test.tsx`）；>7d 回退取 `toLocaleDateString` 短日期、无 i18n key 泄漏；invalid 时间戳段落省略不崩溃。
- **重现步骤**：
  1. `pnpm tauri:dev`，界面语言设为简体中文；
  2. 已保存连接且无活动连接（State 3），产生一条 >60s 前的查询历史；
  3. 观察「历史查询」行元信息：显示 `· just now / 5 minutes ago`（英文），其余 UI 均为中文。
- **实测证据**：`src/lib/relativeTime.ts:63`（`return 'just now'`）、`:70`（`new Intl.RelativeTimeFormat('en', …)`）；`src/locales/zh-CN/connection.ts` 无 `queries.justNow*` key；`src/windows/connection/home/RecentQueriesList.tsx:60` 直调无 locale 参数。
- **影响范围**：仅 State 3 RecentQueriesList 相对时间片段；修复建议：`formatRelativeTime` 增加 locale 参数（默认 en），调用处传 `language`，或按方案 §7 增加 i18n key 并在组件内用 `t()` 组装；同步补 zh-CN 文案与单测。

## landing-page-opt-BUG-002

- **描述**：`ConnectionCardList` 连接卡片行是原生 `<button>`，其内部又嵌套显式 Connect/Open `<Button>`（最终 DOM 为 `<button>` 嵌 `<button>`），违反 HTML 内容模型（button 仅允许 phrasing content，禁止嵌套交互元素）。React 开发期持续输出 `validateDOMNesting: <button> cannot appear as a descendant of <button>` 警告；屏幕阅读器对嵌套交互控件的可达性语义不佳。旧实现无此问题（Quick Start 行内无按钮；历史行用 `div[role=button]` 模式）。
- **严重级**：低（功能不受阻：`stopPropagation` 防止双触发、键盘 Tab/Enter 行为正常；属 HTML 合法性 + a11y 缺陷）
- **状态**：已修复（复测 Tester 判定：commit `ae40645b` 修复有效，复测通过）
- **复测结论（第 1 轮修复，2026-09-11）**：行容器 `<button>` → `div[role="button"] + tabIndex=0 + onKeyDown`（Enter/Space + preventDefault），与 State 4 历史行既有模式一致；`home-conn-card-*` / `home-conn-connect-*` testid 与内层按钮 `stopPropagation` 语义不变。双触发核查：Enter/Space 在内层 Connect 按钮上 keydown 冒泡至行 handler，`preventDefault` 先取消按钮原生激活（click 不再触发），两条路径均收敛为**一次** `onConnect`，且动作同一（`onConnect(conn.id)`），无双触发、无误劫持（行内仅 Connect 一个真按钮，无 Open 等异动作按钮）。复测实测：指定套件 stderr `validateDOMNesting` 计数为 **0**；新增 [tester] 键盘用例（行 Enter/Space/非激活键、内层按钮 Enter 单次触发 canary、内层 click stopPropagation 单次）全过；`ConnectionCardList.tsx` 行覆盖率 100%。
- **重现步骤**：
  1. 运行 `npx vitest run src/windows/connection/__tests__/ConnectionWorkspaceHome.test.tsx`（任一渲染 State 3 卡片列表的用例）；
  2. stderr 出现 `Warning: validateDOMNesting(...): <button> cannot appear as a descendant of <button>.`，调用栈指向 `ConnectionCardList.tsx` 行按钮 → `packages/ui/src/Button.tsx`。
- **实测证据**：上述警告在本轮 Tester 独立复跑（16/16 通过）的 stderr 中稳定复现；`src/windows/connection/home/ConnectionCardList.tsx:134`（行 `<button>`）与 `:192-209`（内层 `<Button … data-testid="home-conn-connect-…">`）。
- **影响范围**：仅 State 3 连接卡片行。修复建议：行元素改为与 State 4 历史行一致的 `div role="button" tabIndex={0}` + onKeyDown（Enter/Space），或内层动作改为非 button 元素；同步回归 `home-conn-card-*` / `home-conn-connect-*` 断言。
