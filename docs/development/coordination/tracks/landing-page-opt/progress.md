# Track: landing-page-opt — Database Landing Page 优化（未打开任何连接时）

- **任务**: Database 落地页（State 3）重构：home/ 五组件拆分、动态 Hero、连接卡过滤与显式 Connect/Open、相对时间 i18n、MCP promo bar、keymap 快捷键 footer
- 状态: MERGED（编码 79cb6e68 / 修复 ae40645b / 测试 580262bf+e4c1d48f / 合并 795daa43）
- phase: MERGED
- Worktree: `.worktrees/datazen-landing-page-opt`（分支 `feature/landing-page-opt`，基于 `main@0fef9fdd`）
- 方案文档: `docs/reviews/database-land-page-optimization.md`（本轨随 feature 提交）
- 协调者: 主会话 Agent

## Phase 状态机

```text
CODING → READY_FOR_TEST → (TESTING ⇄ BUG_FIX)* → PASSED → MERGED
```

**当前 Phase: PASSED**（复测 Tester 第 2 轮：BUG-001/BUG-002 修复复验通过，判定两条 Bug 均 `已修复`；完整套件复跑无新回归，见轮次记录与 `bugs.md` 复测结论）

## 任务分解（对应方案 §9 实施顺序）

- [x] 1. 组件拆分：`src/windows/connection/home/`（HomeHero / ConnectionCardList / RecentQueriesList / McpPromoBar / ShortcutFooter；主文件保留原路径 `src/windows/connection/ConnectionWorkspaceHome.tsx`，887 行 → 475 行，全部文件 < 800 行）
- [x] 2. Hero 动态摘要 + 删除 3 张指标卡（摘要拆为 subtitleConnections/subtitleGroups/subtitleTypes 三个 key，数字加粗；DbTypeBadge 图标簇保留在 hero 右侧）
- [x] 3. ConnectionCardList：行内过滤（name/host/database/group/dbType 标签，带清空 + 空态）/ Show all (N)·Show less（默认 6 条）/ 显式 Connect·Open·Connecting-spinner 三态按钮 / `host:port · {group}` mono 元信息；排序逻辑原样保留（pinned → lastConnectedAt → name）
- [x] 4. RecentQueriesList（3→5 条）+ `src/lib/relativeTime.ts`（Intl.RelativeTimeFormat，just now/分钟/小时/天，>7d 短日期回退；8 项单测）
- [x] 5. McpPromoBar（单行 promo bar，复用 useAppExecutablePath/formatMcpCliCommand/copied 态）+ ShortcutFooter（keymap 驱动：仅渲染已注册 action newQuery/saveQuery/formatSql，formatShortcutForDisplay 处理 Mod→⌘/Ctrl 平台差异，未注册不渲染）
- [x] 6. i18n：仅 `src/locales/en/connection.ts` + `src/locales/zh-CN/connection.ts`；已重新生成 `src/locales/builtinLocales.ts`（gitignored，未提交）
- [x] 7. E2E spec 修正 + 单测更新（见下）

## 自验结果（Coder）

| 项 | 结果 |
| --- | --- |
| `npx vitest run src/windows/connection/__tests__/ConnectionWorkspaceHome.test.tsx` | 16/16 通过 |
| `npx vitest run src/lib/__tests__/relativeTime.test.ts` | 8/8 通过 |
| `npx vitest run src/windows/welcome`（防误伤） | 3/3 通过 |
| `npx vitest run src/windows/connection/__tests__/ConnectionWorkspaceHome.test.tsx src/lib` | 1246/1250（4 失败为基线预存，见下） |
| `npx tsc --noEmit` | 干净（exit 0） |
| 文件行数 | 主文件 475；home/ 五组件最大 255；全部 < 800 |

**基线预存失败说明**：`src/lib/__tests__/fetchRelationDdl.test.ts`（3）与 `schemaCache.test.ts`（1）中 `getCachedDDL` 参数断言失败，已用 `git stash` 在干净 HEAD（main@0fef9fdd）复跑确认与本轨改动无关（失败集完全一致）。

**Commit**: `959ab7bc95df82ab513bbd50c883f81265f04c3e`

## E2E 修正情况（任务分解步骤 7）

- `e2e/specs/connection-empty-state.ts`：
  - EMPTY-001 删除对 `selectConnectionHint` / `selectConnectionTip` 文案的断言（两 key 已删），改为断言动态摘要 `connWin.home.hero.subtitleConnections`；
  - 新增断言 `empty-backup-button` / `empty-restore-button` **不存在**（随 Common Ops 移除）；
  - EMPTY-002/003 使用的 `empty-new-connection-button` / `empty-import-connections-button` testid **保留**（挂到 Your connections section head 的同名动作上），EMPTY-004 不变。
- 其余 spec（unified-tab-bar.ts / homepage-features.ts / journeys/* / contract/open-fixture.ts）引用的 `connection-workspace-home`、`view-all-history-button` 等全部保留原 testid，未改这些文件。
- 已 grep 确认：`empty-backup-button` / `empty-restore-button` / `empty-new-query-button` 在 src 与 e2e 中均无残留引用（src 侧代码与测试同步移除）。

## 与方案文档的偏离决策

1. **`ConnectionWorkspaceHome.tsx` 不迁移**（任务简报明确，优先于方案 §6 的「迁移到 home/ 下」）：保留原路径作为状态路由 + 组装组件，`ContentView.tsx` 与既有测试 import 零改动。
2. **hero 副标题 key 拆分**：方案 §7 用单 key `hero.subtitle`（"{count} connections saved · …"），实现拆为 `hero.subtitleConnections` / `hero.subtitleGroups` / `hero.subtitleTypes` 三个 key——中文语序为「N 个已保存连接 · N 个分组」，单句式 key 无法本地化词序；数字以 `<b>` 加粗，语义与方案一致。
3. **footer 无 `footer.*` 新 key**：方案 §7 列的 `footer.newQuery/history/newConnection` 中 history/newConnection 在 keymap.ts 未注册（注册表仅 execute/executeAll/newQuery/closeTab/saveQuery/formatSql），按「未注册不渲染」原则 footer 只含 newQuery/saveQuery/formatSql，标签直接复用 eager `settings` 域现成 key `keymap.action.*`，避免重复翻译。
4. **`empty-new-query-button` testid 取消**：原属 Common Ops「新建查询」入口，方案未安排迁移目标（§3.2 仅列 New/Import 入 section head）。已 grep 确认全部 e2e/spec 无引用，安全移除。
5. **State 4 逻辑未动**：quickActions / recentPanels / 连接内历史列表逐字保留（含 copied 态），仅随文件瘦身合并。
6. **【BUG-001 补记·已修复】relativeTime 未接 i18n**（Tester 第 1 轮发现，偏离方案 §7 未记录）：首版 `RecentQueriesList` 直接渲染 lib 英文文案（硬编码 'just now' / `Intl.RelativeTimeFormat('en')`），方案 §7 的 `queries.justNow/minutesAgo/hoursAgo/daysAgo` 四 key 未创建。第 1 轮修复采用**组件层组装**：`relativeTime.ts` 保持既有 API（`formatRelativeTime`/`getRelativeTimeParts`，Tester 12 条用例零调整），仅新增导出 `RELATIVE_WINDOW_MS`（7 天窗口常量单一来源）；组件内 `useRelativeTimeLabel()` 按 parts 以 `t()` 拼装本地化文案（justNow / {count} 分钟·小时·天前），>7d 回退短日期；en/zh-CN 已补 4 key，zh-CN 元信息全中文。

## E2E 用例登记

| 用例 | 前置条件 | 状态 |
| --- | --- | --- |
| State 3 落地页渲染：hero 摘要 / 连接卡过滤 / Show all / Connect·Open 三态 | 本机可执行（`pnpm e2e:skip-build` 或手工 tauri:dev） | 【本机可执行·留待 R 回归】Tester 已审阅 `connection-empty-state.ts` EMPTY-001 断言逻辑与实现一致（hero 副标题 testid/文案、CTA testid、backup/restore 负断言），未实跑 GUI |
| Recent queries 相对时间 + 来源连接名 + hover Rerun/Copy | 同上 | 【本机可执行·留待 R 回归】单测已覆盖（含 BUG-001 所述英文文案问题） |
| `empty-backup-button` / `empty-restore-button` 移除后无死引用 | 同上 | 【本机可执行·留待 R 回归】Grep 全仓核实：src/e2e 仅存负断言，无正向渲染引用 |

## 覆盖率报告（Tester，v8，含 [tester] 补齐用例后）

`npx vitest run --coverage --coverage.include='src/windows/connection/home/**' --coverage.include='src/lib/relativeTime.ts' --coverage.include='src/windows/connection/ConnectionWorkspaceHome.tsx' …`

| 文件 | Stmts | Branch | Funcs | Lines | 硬性标准 ≥80% |
| --- | --- | --- | --- | --- | --- |
| home/ 五组件聚合 | 95.18% | 91.01% | 93.75% | **100%** | ✅ |
| ConnectionCardList.tsx | 94.44% | 89.06% | 100% | 100% | ✅ |
| HomeHero.tsx | 100% | 100% | 100% | 100% | ✅ |
| RecentQueriesList.tsx | 95% | 94.11% | 87.5% | 100% | ✅（补齐前仅 55% 行） |
| McpPromoBar.tsx | 90.9% | 100% | 75% | 100% | ✅（未覆盖函数为 2s 定时器复位回调） |
| ShortcutFooter.tsx | 100% | 100% | 100% | 100% | ✅ |
| relativeTime.ts | 96.66% | 95.83% | 100% | 96.66% | ✅（line 68 为公开 API 不可达的防御分支） |
| ConnectionWorkspaceHome.tsx（主文件） | 74.57% | 66.12% | 74.07% | 75.47% | 参考值：未覆盖行为逐字保留的 State 4 历史区（L412-467 等）与 dialog onClose，非本次改动核心模块 |

### 复测覆盖率（Tester 第 2 轮，ae40645b 修复后）

修复引入的新代码路径（`ConnectionCardList` onKeyDown、`RecentQueriesList` useRelativeTimeLabel 各分支）初测存在覆盖缺口（home/ 聚合 Lines 一度跌至 91.57%），复测 Tester 以 12 条新 [tester] 用例补齐（`home/__tests__/retest-round1-fixes.tester.test.tsx`）：

| 文件 | Lines（复测后） | 对比第 1 轮 | 说明 |
| --- | --- | --- | --- |
| home/ 五组件聚合 | **100%** | 100% → 恢复持平 | 缺口已全部补齐 |
| ConnectionCardList.tsx | 100% | 100% | onKeyDown 键盘分支已覆盖 |
| RecentQueriesList.tsx | 100% | 100% | justNow/hour/day/>7d/invalid/null-parts 全分支覆盖 |
| relativeTime.ts | 96.77% | 96.66% | 持平略升（line 75 同为不可达防御分支，第 1 轮已豁免） |

## 轮次记录

| 轮 | 角色 | 结果 | Commit |
| --- | --- | --- | --- |
| 1 | Coder | READY_FOR_TEST（自验 16/16 + 8/8 + 3/3 + tsc 干净；基线预存 4 失败与本轨无关） | `959ab7bc95df82ab513bbd50c883f81265f04c3e` |
| 2 | Tester | FAILED（Bug ×2 均低严重级：BUG-001 相对时间未接 i18n、BUG-002 卡片行嵌套 button。功能复验全绿：24/24 + 42/42 + 3/3 + tsc 干净 + 基线 4 失败逐一吻合；覆盖率 home/ 100% 行 / relativeTime 96.7% 行；新增 15 条 [tester] 用例） | 见 Tester 提交 |
| 3 | Coder | BUG-001/BUG-002 修复，READY_FOR_TEST 待复测（指定套件 42/42 + welcome 3/3 + relativeTime 12/12 + tsc 干净；stderr 无 validateDOMNesting；Tester 用例零调整全数通过） | `ae40645b81638327d2be22b127aea8c22dc0e7e9`（复测更正：原记录 `f3b1ae76…` 为 amend 前的悬空对象，两者仅 progress.md 占位符一行之差） |
| 4 | Tester 复测 | PASSED（全新实例完整复测：修复审查 + 指定套件 42/42 + welcome 3/3 + relativeTime 12/12 + tsc 干净 + 宽域 src/lib 1234/1238 失败集与基线逐一相同 + validateDOMNesting=0；BUG-001 zh-CN 实质验收以真实 i18n 链通过；覆盖率缺口已用 12 条新 [tester] 用例补齐，home/ 聚合 Lines 恢复 100%；Tester 资产未被 Coder 改动已核实） | 见复测提交 |

## Bug 修复记录（第 1 轮修复循环，Coder）

| Bug | 状态 | 修复方式 |
| --- | --- | --- |
| BUG-001 relativeTime 未接 i18n | **已修复**（复测通过，ae40645b） | 组件层组装：`RecentQueriesList` 内 `useRelativeTimeLabel()` 用 `getRelativeTimeParts` 的 `{value, unit}` 结构 + `t()` 拼装；`relativeTime.ts` API 不变、新增导出 `RELATIVE_WINDOW_MS`；en/zh-CN 补 `queries.justNow/minutesAgo/hoursAgo/daysAgo` 4 key；zh-CN 元信息全中文（「刚刚 / N 分钟前 / N 小时前 / N 天前」）。复测证据：真实 i18n 链 zh-CN/en 渲染断言 + getTranslation key parity 全过（`retest-round1-fixes.tester.test.tsx`） |
| BUG-002 `<button>` 嵌套 `<button>` | **已修复**（复测通过，ae40645b） | `ConnectionCardList` 卡片行容器 `<button>` → `div[role="button"]` + `tabIndex=0` + Enter/Space `onKeyDown`（参照 State 4 历史行既有模式）；整行点击语义、`home-conn-card-*`/`home-conn-connect-*` testid、内部按钮 `stopPropagation` 均不变。复测证据：stderr validateDOMNesting=0；行 Enter/Space/内层按钮单次触发 canary 全过；ConnectionCardList 行覆盖 100% |

## 自验结果（Tester 独立复验，79cb6e6）

| 项 | Coder 自报 | Tester 实测 | 结论 |
| --- | --- | --- | --- |
| `ConnectionWorkspaceHome.test.tsx` | 16/16 | 16/16 | ✅ 一致 |
| `relativeTime.test.ts` | 8/8 | 13/13（含 [tester] 补 5 条） | ✅ 原有用例一致 |
| `src/windows/welcome` | 3/3 | 3/3 | ✅ 一致 |
| 宽域 `src/lib` 套件 | 1246/1250（基线 4 失败） | 1246/1250，失败集逐一相同（fetchRelationDdl×3 + schemaCache×1） | ✅ 与 main@0fef9fdd 基线吻合 |
| `npx tsc --noEmit` | 干净 | exit 0 | ✅ 一致 |
| `generate-builtin-locales.mjs` | 已重生成 | 重跑 exit 0，无 diff（gitignored 产物一致） | ✅ 一致 |
| State 1/2/4 逐字保留 | 声明不变 | 新旧文件分段 diff：State 1/2 与 State 4 逐字节一致（仅段落边界 1 空行） | ✅ 证实 |
| i18n 删键残留 | 无残留 | Grep 全仓：src/e2e 无残留（其余 8 语言包 stale key 属开发期约定，运行时回退 en） | ✅ 证实 |
| `empty-new-query-button` 取消零引用 | 无引用 | Grep 全仓 0 处引用（仅文档提及） | ✅ 证实 |

## 自验结果（复测 Tester 第 2 轮，ae40645b）

| 项 | Coder 自报（第 3 轮） | 复测实测 | 结论 |
| --- | --- | --- | --- |
| 指定套件（ConnectionWorkspaceHome + home/ + relativeTime） | 42/42 | 42/42（16+14+12） | ✅ 一致 |
| `src/windows/welcome` | 3/3 | 3/3 | ✅ 一致 |
| `npx tsc --noEmit` | 干净 | exit 0（含新增 [tester] 用例复跑） | ✅ 一致 |
| 宽域 `src/lib` | —（第 1 轮基线 4 失败） | 1234/1238，失败集 fetchRelationDdl×3 + schemaCache×1 与基线逐一相同 | ✅ 无新回归 |
| stderr validateDOMNesting | 无 | 计数 0（stderr 全量捕获 grep） | ✅ 一致 |
| Tester 资产零改动 | 声称未动 | `git log 79cb6e68..HEAD -- <tester 资产路径>` 仅 580262bf（Tester 本人提交），ae40645b 未触碰 | ✅ 证实 |
| zh-CN 渲染（BUG-001 实质） | key 断言（key 式 t mock） | 真实 i18n 链（useI18n→settingsStore→getTranslation 无 mock）渲染「刚刚/2 分钟前/3 小时前/2 天前」+ en 对照 + 两包 key parity 全过 | ✅ 实质验收通过 |
| BUG-002 双触发核查 | 未专项声明 | 行 onKeyDown preventDefault 先取消内层按钮原生激活，Enter/Space 收敛为单次 onConnect；新增 canary 用例锁定 | ✅ 无双触发 |
| 覆盖率 home/ 聚合 Lines | — | 修复初测 91.57%（缺口）→ 补 12 条 [tester] 用例后 100% | ✅ 恢复第 1 轮水平 |
| 范围外改动 | — | 8 文件 +94/−9 全部落在 2 Bug 修复面 + 轨道协调文档；无范围外改动 | ✅ 合规 |

**记录勘误**：第 2 轮记录「relativeTime 13/13（含 [tester] 补 5 条）」与第 3 轮记录「12/12」不符，实测为 **12/12（8 条原有 + 4 条 [tester]，`git diff 79cb6e68 580262bf` 为纯追加）**；第 2 轮「新增 15 条 [tester] 用例」实为 14（home-components）+ 4（relativeTime）= 18。均不影响测试有效性，仅文档计数勘误。
