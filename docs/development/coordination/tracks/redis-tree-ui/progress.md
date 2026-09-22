- 任务: 键树列头三行 + 行规格 + sticky 分组头 + 选择/键盘（PRD §3.2 R1~R3、§4 I-4、I-8、I-9、I-11）
- 状态: READY_FOR_TEST
- 编码 commit: 01f6396cd（D-0 拆分）、d591a9891（D-1/D-2 列头+搜索行）、a26ef97fc（D-3..D-8）、95040148f（批量错误分类 + 树状态机测试）
- 测试 commit: 95040148f、da04fd11b（D-3..D-8 连续旅程 + 分隔符测试引用修正）
- 合并 commit: —
- 代理: w3d-tree-ui-rescuer（接管原编码代理收尾；原代理未及登记 agentId，其父会话 session-61319db9-6e5c-4f32-a35e-cad750b647dd）
- Worktree: .worktrees/datazen-redis-tree-ui
- 分支: feature/redis-tree-ui
- 心跳: 2026-09-22 21:11

# W3-D `redis-tree-ui` 简报（协调者下发）

## 0. 必读（按序）
1. `AGENTS.md`、`docs/development/subagent/coder.md`、本文件
2. `docs/todo/redis-workbench-ux/PRD.md` §3.2（屏 B 左列键树全段：R1 列头 / R2 搜索行 / R3 分组行 / 行规格）、§4 I-4/I-8/I-9/I-10/I-11
3. 现状代码：`packages/drivers/redis/ui/key-browser/`（`RedisWorkbench.tsx` 705 行、`KeyTreeList.tsx` 271、
   `useKeyTree.ts` 144、`useRedisKeyScan.ts` 105、`KeyBrowserControls.tsx`、`SearchModeTabs.tsx`、`BatchBar.tsx`、
   `keyTree.ts`、`KeyTreeColumn.tsx`、`DetailColumn.tsx`）
4. `docs/development/coordination/tracks/redis-kvbar-ui/progress.md`（W2 已合入的中继接线与
   `ui/kv-bar/**`，别把它挪走；BUG-005 的「状态归属」裁定适用）

## 1. 交付单元（**按此顺序做，每个单元立即 commit**）
本轨范围大，150 轮上限是本项目头号死法。顺序即优先级：做完一个 commit 一个；
接近上限就提交现场并返回 `PARTIAL` + 精确剩余清单（下一棒是接管者，不是你的续命）。

1. **D-0 拆分 `RedisWorkbench.tsx`（705 行）**：先把列头 / 树列 / 详情列 / 对话框编排拆成子模块，
   保持行为零变化（现有 `redisWorkbench.test.tsx`、`keyTree.test.ts` 全绿即通过）。
   后续单元都落在拆出的文件里。**这一步不做完就不许开始 D-1。**
2. **D-1 R1 列头**：`键 | 值 | 全部` 段控件迁到列头常驻（现状 `SearchModeTabs` 被藏在
   `RedisWorkbench.tsx:454` 的 `{!hideSidebar && <aside>}` 内，`hideSidebar` 时用户根本看不到）；
   `已加载 N / 共 M 个 key`（扫描中显示 `N+`）；右侧图标组：全选 / 取消选择 / 批量 TTL / 批量删除(带计数) / 刷新 / `+`。
   计数文案不得硬编码英文，走 `redis.tree.*` key。
3. **D-2 R2 搜索行**：pattern 输入 + chips：`* 模糊`、`🕐 仅无过期`、`类型 ▾`
   （**保留** 现有 `KeyBrowserControls` 的类型 Select —— 参照产品没有类型过滤，这是我们的优势项）。
   历史 pattern 下拉与键模板属 P2，本轨**不做**。
4. **D-3 R3 分组行 + 分隔符**：`树 / 列表` 切换 + 分隔符设置（默认 `:`，可 `.` / `/`，**per-connection 持久化**）。
   现状 `ui/key-browser/keyTree.ts:9` 的 `DEFAULT_SEPARATORS = [':', '.']` 是硬编码（:14/:31 两处默认参数）、
   且 `useKeyTree.ts:55` 调用时不传 sep；
   改成显式参数 + 每连接设置，并把「换分隔符后树形立即重算」写成状态机测试。
   `规则分组` 开关属 P2，不做。
5. **D-4 行规格对齐**：固定 30px 行高；缩进 `4 + depth×10`（现状 `8 + depth*16`）；
   folder = checkbox + chevron + 图标 + label + `(n)`；leaf = 键图标（**hover 时替换为 checkbox**，现状常驻）
   + label + 类型 Badge + TTL pill + hover 删除；**sticky 多级分组头**（滚动时常驻）。
6. **D-5 I-4 分组游标**：`useKeyTree.ts` 的 `refresh()` 现在 `setLevels({})` 清空全部已加载层级 ⇒ 直接违反 I-4。
   改为：折叠不清空、刷新保留已加载子集与各 folder 游标；补 `n+` 部分计数的展示位（数据来自
   `count_matching`，其预算改造在 W3-B，**本轨不调用它的新参数**，见 §2）。
7. **D-6 I-8 批量失败保持选中**：`BatchBar.tsx:166/211/239` 三处**无条件** `onClearSelection()`。
   改为：只清成功的键，**失败键保持选中**，摘要显示 `成功 N / 失败 M` 且可展开每条原因（原因按稳定 code 分类）。
8. **D-7 I-9 键盘导航**：`↑/↓` 树内导航、`→/←` 展开折叠、`⌘/Ctrl+A` 全选已加载、`Enter` 应用搜索、
   `Esc` 清空/取消内联编辑、`⌘/Ctrl+R` 刷新（现状只有 `Enter`）。
9. **D-8 I-11 树侧具名空态**：无键 / 无匹配 / 扫描被中断 / 无权限，各自具名文案，禁止共用 `redis.noKeys` 留白。

## 2. 明确不做（防止范围漂移到别的轨）
- **不接 `KvSlotState` 新增 setter**：树侧 `loaded/cursor/scanning/budget/selectionCount/recordWrite`
  写入中继由 **Wave 4** 的 contextBar/statusBar 轨做（它们与 W3-A 契约轨有先后关系）。本轨状态留在树自己手里。
- **不做页脚三态 `Load more / Fetch all / Stop fetching`、不做扫描预算 UI、不做 25k 分片 + rAF + 视口锚点、
  不做精确键短路 `key_probe` 接线** —— 全部依赖 W3-B 的 `## 契约冻结`，排到 Wave 4。
- 不做 I-10 容器查询断点（740/340/240）——与列头动作组一起放 Wave 4，避免和 sticky/行规格同时改一处 DOM。
- 不碰 `ui/value-editors/**`、`ui/connection/RedisConnectionView.tsx`（W3-E 拥有）、`ui/console/**`（W3-F 拥有）、
  `ui/kv-bar/**`（已合入，只读参考）、宿主 `src/**` 与 `packages/driver-sdk/**`（W3-A 拥有）。

## 3. 冲突面声明
`packages/drivers/redis/locales/en.ts` 与 W3-E / W3-F 同时新增文案。规则：**只在文件尾部追加自己的命名空间
`redis.tree.*`**，不改动、不重排他人 key；协调者合流时按并集解（W2 已验证该流程）。
其余文件面本轨独占 = `ui/key-browser/**`（含 `keyTree.ts` / `useKeyTree.ts` / `BatchBar.tsx` / `SearchModeTabs.tsx`）。
**不碰** `ui/shared/meta.ts` 与 `scripts/resolve-drivers.mjs`：本轨不新增槽位，两处注册面留给 Wave 4 的 contextBar 轨。

## 4. 门禁与交付
1. `npx vitest run --config vitest.drivers.config.ts`（基线 47 files / 456 tests，只许增不许红）。
2. `npx tsc --noEmit` = 0。
3. `node scripts/check-driver-import-boundaries.mjs` = 0 blocking（宿主类型只能从 `@datazen/driver-sdk` 取）。
4. `npx vite build`（禁裸 `pnpm build`）。
5. 交互逻辑必须写**连续旅程测试**（AGENTS.md「交互与补全开发原则」）：击键/展开/折叠/选择全过程的
   中间态断言，不测静态合法态；点击与选择用 `data-*` 属性绑定，禁视口几何反查。
6. 覆盖率：本轨新增/改动代码 ≥80%，缺口在 `## 自验记录` 里点名。
7. 本文件追加 `## 自验记录`（命令 + 数字 + 每个交付单元的落点文件）。
8. 返回 `READY_FOR_TEST`。

## 5. 环境纪律（违反即返工）
- 工作目录固定 `.worktrees/datazen-redis-tree-ui`；禁写其他检出（主检出与 integrate worktree 只读）。
- Grep 工具搜索（禁 bash `grep -r`）；禁 `pnpm install`（node_modules 已软链）。
- 禁 live `pnpm e2e` / `pnpm tauri:build:webdriver`；需真实 Redis 的旅程写进 `## 留待 R 回归` 而不是跑。
- Cargo 不需要（本轨不改 Rust）；若要跑宿主类型检查用 `npx tsc --noEmit`。
- 禁提交 gitignored codegen / `Cargo.lock` / 注入过的 `src-tauri/Cargo.toml`；禁改 `hub.md` 与他轨文档。
- 测试**禁断言英文字面量文案**（按 key / `data-*` / 结构断言；既有字面量断言要**改写**而非删除）。
- 单文件 ≤800 行；D-0 的产出必须让 `RedisWorkbench.tsx` 显著变小，而不是换个地方堆。

## 自验记录

> 2026-09-22 21:11 · 接管代理（rescuer）实测。命令均在 `.worktrees/datazen-redis-tree-ui` 执行。

### 现场盘点结论
接管时 D-0..D-8 的实现与单测已按单元提交到 `95040148f`，工作树只剩本文件未落盘；简报 §4 门禁已跑通但未登记。
接管补齐两处：(1) 新增 `keyTreeInteractionsJourney.test.tsx`（14 条连续旅程，补上原缺的 R3 分组行 DOM 旅程、
sticky 滚动钉住/释放、I-4 重展开不重取、I-8 批量失败 DOM、I-11 具名空态 DOM 覆盖）；
(2) `KeyTreeGroupRow.tsx` 文档注释的分隔符状态机测试引用错档（实际在 `keyTree.test.ts:94`），已改为
「keyTree.test.ts 状态机 + keyTreeInteractionsJourney.test.tsx DOM 旅程」。

### D-0..D-8 逐项验收（全部已齐）
| 单元 | 结论 | 落点 / 实测证据 |
| --- | --- | --- |
| D-0 拆分 | 已齐 | `RedisWorkbench.tsx` 705 → 362 行；拆出 `KeyTreePane/KeyTreeColumn/DetailColumn/KeyWorkbenchDialogs/BatchBar` + `use*` 编排 hook；`keyBrowserModuleSplit.test.ts`、`redisWorkbench.test.tsx` 全绿，行为零变化 |
| D-1 R1 列头 | 已齐（上轮完成） | `KeyTreeHeader.tsx`：`hideSidebar` 下常驻；计数 `data-loaded/data-total/data-partial`（扫描中 `N+`）；全选/取消/批量TTL/批量删除(计数)/刷新/+；文案全走 `redis.tree.*`，旅程 keyTreeJourney R1 段 |
| D-2 R2 搜索行 | 已齐（上轮完成） | `KeyTreeSearchRow.tsx`：pattern + `模糊/仅无过期/类型` chips，类型 Select 保留；`Enter 应用 / Esc 清空` 语义（`searchPattern`/`appliedPattern` 分离）；keyTreeJourney R2 段 |
| D-3 R3 分组行 | 已齐（接管补齐 DOM 旅程） | `KeyTreeGroupRow.tsx` + `treePreferences.ts`（`datazen:redis:treePrefs:v1` 按 connectionId/dbSessionId 分桶）+ `keyTree.ts` 显式 sep；状态机 `keyTree.test.ts:94`；DOM 旅程（换 `.` 后 `list_children` 带 `sep:'.'` 重折、`app:` 消失、localStorage 落 `{view:'tree',sep:'.'}`；树/列表互切） |
| D-4 行规格/sticky | 已齐（接管补齐 DOM 旅程） | `treeRowSpec.ts`：ROW_HEIGHT 30、indent `4+depth×10`（data-indent '4'/'14' 实测）、sticky 祖先链（scrollTop 30 → `data-sticky-depth='1'` + `redis-tree-folder-app:` 钉住，回 0 释放）；文件夹级联勾选/取消（badge `data-count='2'` ↔ disabled）旅程 |
| D-5 I-4 分组游标 | 已齐（接管补齐 DOM 旅程） | `treeLevels.ts`（100% 覆盖）：refresh 不再 `setLevels({})`；DOM 旅程实测刷新在途旧行不消失（`data-count` 保持 2）、完成后落 5、rescan 调用 `prefix='' cursor=0 sep=':'`；折叠保留层级、重展开零重取（`app:` 子树调用数恒 1） |
| D-6 I-8 批量失败保持选中 | 已齐（接管补齐 DOM 旅程） | `batchErrors.ts` 稳定 code（`NOPERM→noAcl`，`slot→network`）+ `useBatchActions` 只释放成功键；旅程：partial TTL → banner `data-kind='batch' data-action='ttl' data-ok='1' data-failed='1'`，失败键仍 `data-checked='true'`（含写后刷新不吞选中）、成功键释放；展开按 code 分组 `redis-batch-failure-group-noAcl`（`data-reason-key` 按 key 不断言文案）；invoke 整体抛错 → `ok=0 failed=2` 全选中保留、对话框不关（`redis-batch-error`）、取消后选中仍在 |
| D-7 I-9 键盘 | 已齐（接管补齐 DOM 旅程） | `treeRowSpec.ts` `treeNavAction`；旅程：`-1→0→1→↑`（clamp）、`→` 展开(一次取数)+再 `→` 进首子、`←` 回父、`←` 折叠、再 `→` 重展开零重取、`Enter` 激活出详情（`data-selected='true'` + `invokeGetKey`）、`⌘A` 全选、`Esc` 清选+`data-active-index='-1'`、`⌘R` 扫描与树根同时刷新 |
| D-8 I-11 具名空态 | 已齐（接管补齐 DOM 旅程） | `treeEmptyState.ts`（100%）优先级 `rootError > scanning > filter > none`，`data-empty-state` 只按 key 断言；旅程覆盖 `none ↔ no-match`（输入/Enter 真扫/Esc/类型chip）、`interrupted`（cursor 7 开着 → load-more 到 0 → `none`）、`no-permission`（根拒绝压过 open cursor） |

### 四件套门禁实测（2026-09-22 21:10 终跑，全部通过）
1. `npx vitest run --config vitest.drivers.config.ts` → **51 files / 523 tests passed**（基线 47/456，只增不红），exit 0。
2. `npx tsc --noEmit` → **0 error**，exit 0。
3. `node scripts/check-driver-import-boundaries.mjs` → 1481 files scanned · **0 blocking**（4 条 R3 advisory 为既有宿主引用，非本轨引入），exit 0。
4. `npx vite build` → **built in 4.61s**，exit 0（chunk>500kB 提示为既有告警，非阻断）。
5. 连续旅程测试：新增 `keyTreeInteractionsJourney.test.tsx` 14 tests（单文件 717 行 ≤800），中间态逐步断言、只用 `data-*`/i18n key 定位、无英文字面量文案断言；既有 `keyTreeJourney.test.tsx` 保留并入基线增长。

### 覆盖率（v8，`--coverage.include='packages/drivers/redis/ui/key-browser/**'`）
本轨**新增/改动代码**（`git diff 8981d3078...HEAD` 非删除条目，KeyBrowserControls.tsx 为删除不计）加权：
**Stmts 84.04%（795/946）· Branches 82.63%（452/547）≥80 达标**。
核心状态机 `treeLevels/treeEmptyState/treeRowSpec/treePreferences/keyTree/useKeyTreeView` = 91.6~100%。
**缺口点名（<80%，全部为 D-0 抽出的接线/对话框层）**：`useWorkbenchSplit.ts` 45%（分栏拖拽回调）、
`useBatchActions.tsx` 48.73%（rename/pattern 对话框分支；I-8 TTL 路径已覆盖）、`useKeyRowActions.tsx` 56.52%
（原生右键菜单打开路径，菜单项构建另有 `redisKeyWebContextMenu.test.tsx`；行/文件夹删除旅程已覆盖）、
`BatchBar.tsx` 60%（pattern/rename 按钮接线）、`batchInvokes.ts` 60%（rename/count_matching 未被本轨调用面覆盖）、
`KeyTreeColumn.tsx` 66.66%（值搜索分支未在本轨断言）、`useKeySelection.ts` 72.22%、`useWorkbenchSearch.ts` 79.16%。

### 留待 R 回归
- 真实 Redis 的 live e2e 按纪律未跑（禁 `pnpm e2e`）；需真机复核点：sticky 在真实滚动容器中的视觉贴合、
  `count_matching n+` 部分计数（W3-B 契约后）与原生右键菜单弹出（jsdom 无法弹 OS 菜单）。

---

## 第 1 轮 Tester 复验记录

> 2026-09-22 · Tester 全新实例（前任死于服务错误，无半成品）。工作目录固定
> `.worktrees/datazen-redis-tree-ui`，HEAD `ef0d62d94`，起点工作树干净。
> 重型命令一律串行执行（vitest → tsc → boundaries → build），零并行重负载。

### 验收项 0：现场自检
- `git status --porcelain` 空；分支 `feature/redis-tree-ui`；HEAD `ef0d62d94`。
- commit 链核对：`01f6396cd` → `d591a9891` → `a26ef97fc` → `95040148f` → `da04fd11b` → `ef0d62d94`（+ 基线 `8981d3078`）。与上报一致。
- 生成物准备：`node scripts/generate-builtin-locales.mjs` → exit 0。

### 验收项 1：四件套门禁独立重跑（全部实测，非引用自报）
| 门禁 | 自报 | Tester 实测 | 判定 |
| --- | --- | --- | --- |
| `npx vitest run --config vitest.drivers.config.ts` | 51 files / 523 tests | **51 files / 523 tests passed**，exit 0（18.56s） | ✅ 一致 |
| `npx tsc --noEmit` | 0 error | **0 error**，exit 0 | ✅ 一致 |
| `node scripts/check-driver-import-boundaries.mjs` | 1481 files · 0 blocking | **1481 files scanned · 0 blocking · 4 advisory**，exit 0 | ✅ 一致 |
| `npx vite build` | built 4.61s | **built in 8.57s**，exit 0（chunk>500kB 为既有告警） | ✅ 通过（耗时差异为本机负载，非结果差异） |

4 条 R3 advisory 均为宿主既有文件（`src/locales/locales.test.ts`、`src/test/driverUiSetup.ts`×2、
`src/windows/connection/DocumentConnectionView.tsx`），非本轨引入 —— 已核对本轨 diff 不含这些路径。

### 验收项 6：范围审查（实测）
- `git diff 8981d3078..HEAD --name-only` = 41 个文件，**全部**落在
  `packages/drivers/redis/ui/key-browser/**`、`packages/drivers/redis/ui/__tests__/**`、
  `packages/drivers/redis/locales/en.ts`、本轨 `progress.md` 四面内。
  **零越界**：无 `ui/value-editors/**`、无 `ui/console/**`、无 `ui/connection/RedisConnectionView.tsx`、
  无 `ui/kv-bar/**`、无宿主 `src/**`、无 `packages/driver-sdk/**`、无 `ui/shared/meta.ts`、无 `scripts/resolve-drivers.mjs`。
- `en.ts` 实测：26 行全部为 `redis.tree.*` 追加（`+` 块位于 `redis.keyProps.*` 之后、`as const` 之前），
  零改/零重排他人 key；未新增其他命名空间。
- 单文件规模：全轨最大文件 `KeyTreeList.tsx` **531 行** ≤800；`RedisWorkbench.tsx` 705 → **362 行**；
  新测试最大 `keyTreeInteractionsJourney.test.tsx` **717 行** ≤800。全部达标。
