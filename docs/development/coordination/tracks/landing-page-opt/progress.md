# Track: landing-page-opt — Database Landing Page 优化（未打开任何连接时）

- **Worktree**: `.worktrees/datazen-landing-page-opt`（分支 `feature/landing-page-opt`，基于 `main@0fef9fdd`）
- **方案文档**: `docs/reviews/database-land-page-optimization.md`（本轨随 feature 提交）
- **协调者**: 主会话 Agent

## Phase 状态机

```text
CODING → READY_FOR_TEST → (TESTING ⇄ BUG_FIX)* → PASSED → MERGED
```

**当前 Phase: FAILED**（Tester 第 1 轮：登记 2 条低严重级 Bug，见 `bugs.md`；功能测试全绿，Bug 均不阻断）

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

## 轮次记录

| 轮 | 角色 | 结果 | Commit |
| --- | --- | --- | --- |
| 1 | Coder | READY_FOR_TEST（自验 16/16 + 8/8 + 3/3 + tsc 干净；基线预存 4 失败与本轨无关） | `959ab7bc95df82ab513bbd50c883f81265f04c3e` |
| 2 | Tester | FAILED（Bug ×2 均低严重级：BUG-001 相对时间未接 i18n、BUG-002 卡片行嵌套 button。功能复验全绿：24/24 + 42/42 + 3/3 + tsc 干净 + 基线 4 失败逐一吻合；覆盖率 home/ 100% 行 / relativeTime 96.7% 行；新增 15 条 [tester] 用例） | 见 Tester 提交 |

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
