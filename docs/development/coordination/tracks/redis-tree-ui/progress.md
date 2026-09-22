- 任务: 键树列头三行 + 行规格 + sticky 分组头 + 选择/键盘（PRD §3.2 R1~R3、§4 I-4、I-8、I-9、I-11）
- 状态: TEST_FAILED（第 1 轮 Tester：2 条 `待修复` = BUG-001 Major + BUG-002 Minor；四件套门禁全绿、D-0/D-1/D-3/D-4/D-6/D-7 与 D-5/D-8 判定顺序均通过）
- 编码 commit: 01f6396cd（D-0 拆分）、d591a9891（D-1/D-2 列头+搜索行）、a26ef97fc（D-3..D-8）、95040148f（批量错误分类 + 树状态机测试）、da04fd11b（14 条 DOM 旅程 + 注释修正）、ef0d62d94（台账 READY_FOR_TEST）
- 测试 commit: 9dc9ad2a2（门禁+范围审查）、8c39e2743（Bug 草稿）、bd22678e4（BUG-001/002 红测证实）、a68418d41（代码审查+旅程强度）、本 commit（覆盖率补测 + 判定收口）
- 合并 commit: —
- 代理: w3d-tree-ui-rescuer（编码，接管原编码代理收尾）；Tester 第 1 轮 = 全新实例（前任 Tester 死于服务错误，无半成品）；原编码代理父会话 session-61319db9-6e5c-4f32-a35e-cad750b647dd
- Worktree: .worktrees/datazen-redis-tree-ui
- 分支: feature/redis-tree-ui
- 心跳: 2026-09-22 22:57（Tester 第 1 轮）

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
- **（第 1 轮 Tester 追加）BUG-001 修复后**：pattern → `list_children` 的真实语义需真库回归 ——
  `app:*` 究竟该折叠成 `app:` 子树（prefix 路由）还是客户端 glob 过滤整层，mock 无法裁定，
  只有真 Redis 的 `list_children` 折叠结果能确认修复方向与用户预期一致。

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

**Tester 补测后终跑**（含本 Tester 新增 2 个测试文件，串行）：
`vitest` → **53 files / 551 passed | 2 skipped（553）**，exit 0（2 skipped = BUG-001/002 复现用例）；
`tsc --noEmit` → 0；`boundaries` → **1483 files · 0 blocking · 4 advisory**（+2 为新增测试文件，扫描面自然增长）；
`vite build` → **built in 4.63s**，exit 0。⇒ 门禁仍"只增不红"，`## 4 门禁` 四条全绿成立。

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

### 验收项 2：D-0..D-8 逐项代码审查（阶段 A）
逐文件 Read 了 `key-browser/**` 全部 38 个文件（含新建 17 个）与 4 个测试文件。

| 单元 | 结论 | Tester 独立依据（非引用自报） |
| --- | --- | --- |
| D-0 拆分 | ✅ 通过 | 362 行编排根 + `KeyTreePane/KeyTreeColumn/DetailColumn/KeyWorkbenchDialogs/BatchBar/WorkbenchToolbar/DbSidebar` + 9 个 `use*`；`KeyTreePane` 自称且确实是 presentation only（零 state 零 I/O，只做接线）。**未见"换个地方堆"**。 |
| D-1 R1 列头 | ✅ 通过 | `KeyTreeHeader.tsx:66-79` 计数三属性 `data-loaded/data-total/data-partial` 齐；扫描中 `${loaded}+`；图标组 6 枚齐（全选/取消/批量TTL/批量删除带 `data-count`/刷新/`+`）；`hideSidebar` 常驻由旅程 `keyTreeJourney.test.tsx:153-160` 实测。计数文案零硬编码。 |
| D-2 R2 搜索行 | ⚠️ **登记 BUG-001（Major）** | pattern/applied 分离**做对了**（`useRedisKeyScan.ts:19-29`，`loadMore`/`refresh` 只用 `appliedPattern`；旅程 `:246` 有专测）；Enter 应用 / Esc 清空齐；类型 Select 保留（优势项未丢）。**但 pattern 不作用于树视图** ⇒ 见 bugs.md。 |
| D-3 R3 分组行 | ✅ 通过 | `treePreferences.ts` 按 connectionId（回退 dbSessionId）分桶、三选、损坏 payload / 抛错 storage / 越界值全降级（6 条边界实测）；`useKeyTree.ts:62+119` 把 sep 作为**显式参数**送进 `list_children` **且**列入 reset 触发项 —— 简报点名的"硬编码 + 调用不传 sep"两处均已消除。 |
| D-4 行规格 / sticky | ✅ 通过 | `ROW_HEIGHT=30`、`rowIndent = 4 + depth×10`（`rowIndent(-2)` 夹紧为 4，有断言）；`stickyFolderChain` 用 running stack 精确取**严格祖先链**，覆盖进入/替换/离开/clamp 四跃迁；leaf 图标↔checkbox 交换且**已勾选时常驻 checkbox**（`KeyTreeList.tsx:448-465`，避免选中集自我隐藏）—— 这个细节是对的。 |
| D-5 I-4 分组游标 | ⚠️ **登记 BUG-002（Minor）** | 对比基线 `8981d3078:useKeyTree.ts` 的 `refresh` 里确有 `setLevels({})` ⇒ 简报指出的违反 I-4 行为**确实被改掉**；`pass` 机制实现"旧行在途不消失、wrap 才替换"，`mergeChildren` 对 folder count 只增不减防 `(9)` 回退 `(4)`；`reqSeq` 丢陈旧回包 + `levelsRef` 单一同步源（基线读闭包 `levels[prefix]?.cursor` 是真 bug，已修）。**残留**：失败路径不关 pass。 |
| D-6 I-8 批量失败 | ✅ 通过 | 基线三处无条件 `onClearSelection()` 已换成 `releaseSucceeded(requested, failedKeyNames)`；整批抛错走 `failuresForAllKeys`（安全侧：全保留）；`delete_keys` 只回裸计数 ⇒ 注释显式说明"部分失败不可表达"，不假装能分类；`refreshAfterWrite`（`RedisWorkbench.tsx:190-193`）刻意不复用 `refreshKeys`，正是为了不让写后刷新吃掉选中 —— 判定正确。 |
| D-7 I-9 键盘 | ✅ 通过 | 三要素完整：进入（`tabIndex=0` + `treeNavAction`）；状态内（单一 `activeIndex`，两端**夹紧而非回绕**）；退出（`←` 在 root 行返回自身、`Esc` → `-1` + 清选）。`treeNavAction` 对未知组合键返回 `null`（⌘←/⌘⇧A/IME commit 交回浏览器）—— 防吃掉宿主快捷键的正确写法。 |
| D-8 I-11 具名空态 | ✅ 判定顺序通过（可达性受 BUG-001 影响） | `resolveTreeEmptyState` 顺序 `rowCount/loading → rootError → scanning → filter?no-match:none`，与简报一致；`keyTreeState.test.ts:409-417` 用"三条件同时为真"逐层剥离验证优先级（真断言）；只暴露 key + `data-empty-state` 双出口。 |

**六个重点面独立判定**：
(a) **分隔符切换是否零重取重折 —— 实测：会重取，且这是正确行为**。`sep` 是 `list_children` 的服务端形参
（Rust `ops_tree.rs::list_children_on` 按 sep 折叠），换 sep 意味 prefix 归属改变，客户端无法凭 `:` 的回包
"零重取"重折成 `.` 树；`useKeyTree` 走 `loadRoot()`（reset 语义）对根 + 每个仍展开的 prefix 各取一次。
与简报验收标准不冲突（只要求"立即重算 + 显式参数 + per-connection 持久化"，未要求零网络往返）。
旅程 `keyTreeInteractionsJourney.test.tsx:185-224` 实测换 `.` 后 `app:` 消失、`app.` 出现、落 `{view:'tree',sep:'.'}`。
(b) 刷新在途旧行不消失 —— ✅（旅程 `:328-363` 用扣住回包的方式断言中间态 `data-count` 仍为 2）。
(c) 折叠保留层级/游标、重展开零重取 —— ✅（`toggleFolder` 折叠分支只删 `expanded`；`:365-385` + `:423-426` 双路测 `childCalls()` 恒 1）。
(d) I-8 失败键保持选中 —— ✅（`:476-545` 断言"后刷新落地后"失败键仍 checked、成功键释放，并测 dismiss 后仍在）。
(e) I-9 三要素 —— ✅ 完整。
(f) I-11 判定顺序 —— ✅ 一致。

**非 Bug 级审查记录**（tester.md §2 要求记录）：
- `tree.loadMore`（`useKeyTree.ts:138-144`）**当前无消费方**：`KeyTreePane.tsx:117` 把 `onLoadMore` 接到
  `scan.loadMore`（扁平列表游标）。已核对基线 `8981d3078` 同样接法 ⇒ **非本轨引入**；folder 级"分页续扫"
  属简报 §2 明确不做的"页脚三态"，留 Wave 4 合理。风险备注给 Wave 4：函数已备好，但展开 folder 的 `n+`
  目前无法被用户推进。
- 折叠态 folder 的 `(n)` 用服务端 `child.count`，非 `allKeys` 过滤数 ⇒ 以服务端为准，符合 PRD §5 裁定。
- 基线 `fetchLevel` 读闭包 `levels[prefix]?.cursor` 的**陈旧游标 bug** 已被 `levelsRef` 消除（改进项）。

### 验收项 3：旅程测试强度审查
- `keyTreeInteractionsJourney.test.tsx` **14 条全为真旅程**，逐条抽查：每条含"进入 → 中间态 → 退出"，
  且至少断言一次在途/残缺中间态。最硬三条：`:328-363`（`mockImplementationOnce` 扣住回包才能断言
  "刷新在途旧行仍在" —— 真实强度，非 `waitFor` 终态）；`:476-545`（partial TTL 的 5 个跃迁点）；
  `:389-472`（键盘单条走完 `-1→0→1→↑clamp→→展开→→进子→←回父→←折叠→→零重取重展开→Enter→⌘A→Esc→⌘R`
  共 12 跃迁）。**无摆设用例。**
- **零英文字面量文案断言**：`useI18n` stub 为恒等 `t`，断言只出现在 `data-*` / `.disabled` / mock 调用参数 /
  testid 上（`data-reason-key` 断的是 key 本身）。选择器全 `data-testid`/`data-*`，**无一处视口几何反查**。合规。
- **发现强度缺口并补测**（新增 `keyTreeTesterGaps.test.tsx`，6 例）：
  1. `markFetchFailed` 的 `rescan + pass!==null` 分支既有测试零覆盖 ⇒ 补状态机复现（证实 BUG-002）。
  2. 既有旅程的 `no-match` 是把 `listChildren` mock 成返回**空 children** 达成的，绕过了
     "树行是否随 pattern 收窄"这条真实链路 ⇒ pattern→tree 通路**既无实现也无测试** ⇒ 补
     characterization（绿，钉当前矛盾）+ 复现（红 → `it.skip`）各一条（证实 BUG-001），
     另补 2 条 precondition 绿测（`keyType`/`sep` 确实进 `list_children`），
     防止修复时靠删掉整排过滤器来"通过"红测。
- D-1..D-8 覆盖对照：每面均有「纯函数状态机 + DOM 旅程」双路（D-1 ✅；D-2 ✅；D-3 ✅；D-4 ✅；
  D-5 ✅；D-6 ✅；D-7 ✅ 全链；D-8 ✅ 判定顺序）—— 无"只剩静态测试无旅程"的验收面
  （BUG-001 属链路缺失，非测试缺失，不记在本项下）。

### 验收项 4：覆盖率实测（v8，include=`packages/drivers/redis/ui/key-browser/**`）
Tester 自带 diff 加权脚本（`git diff 8981d3078..HEAD` 新增行 × coverage-final.json）独立复算，**不复用自报口径**：

| 口径 | Rescuer 自报 | Tester 实测（补测前） | Tester 实测（补测后） |
| --- | --- | --- | --- |
| 本目录全量 Stmts | — | 69.36% (899/1296) | **72.68% (942/1296)** |
| 本目录全量 Branch | — | 69.16% (507/733) | **73.66% (540/733)** |
| **diff 加权 Stmts** | 84.04% (795/946) | **81.78% (525/642)** | **86.14% (553/642)** |
| **diff 加权 Branch** | 82.63% (452/547) | **81.86% (370/452)** | **88.72% (401/452)** |

- 判定：**补测前 81.78% ≥ 80 已达标**，与自报 84.04% 有 ~2.3pt 差（口径差异：自报按"非删除条目"计数，
  Tester 按 git diff 新增行 ∩ v8 statementMap 行命中）。两者均 ≥80，**判定成立**。
- **8 个 sub-80 缺口逐个裁定**（Rescuer 均称"非本轨面 / D-0 抽出的接线层"）：
  | 文件 | 自报 | Tester 判定 |
  | --- | --- | --- |
  | `useWorkbenchSplit.ts` | 45% | **部分成立**：分栏拖拽回调确非本轨面（I-10/持久化属 Wave 4）；但纯函数 `clampTreeWidth` 属 D-0 拆分自证范围且是零 UI 依赖 → **已补测**（Stmts 44.4%，branch 0→100%）。拖拽 DOM 路径维持"非本轨面"。 |
  | `useBatchActions.tsx` | 48.73% | **成立**：残余缺口是 rename/pattern 两个对话框的 invoke 分支（简报 P2 未做面）；**I-8 主路径（TTL partial/整批抛错）已被旅程覆盖**，与自报一致。补 `BatchPatternBar` 触发面后 diff 50.0→**51.8%**、whole-file 48.73→**51.26%**（仍 <80，缺口即上述 P2 对话框分支）。 |
  | `useKeyRowActions.tsx` | 56.52% | **成立**：缺口是 `showNativeContextMenu` 打开路径（OS 菜单，jsdom 不可弹，已登记留待 R）；菜单项构建另有 `redisKeyWebContextMenu.test.tsx`，行/文件夹删除有旅程。补右键绑定断言后 whole-file Stmts 56.52→**69.56%** / Lines 61.9→**76.19%**（残余 54-58 行即原生菜单打开体）。 |
  | `BatchBar.tsx` | 60% | **成立**：该文件已瘦身为 `export * from './batchInvokes'` + `BatchPatternBar`；pattern/rename 按钮接线属 D-0 抽出层 → **已补测触发面**（本轨计数下 33.3%，真实增量在 `useBatchActions`）。 |
  | `batchInvokes.ts` | 60% | **不成立（Tester 补测）**：`rename/count_matching` 是本轨 D-6 写路径的**直接依赖**，payload camelCase 契约与 `keys:null` 语义都在本轨验收面内，不该"未被本轨调用面覆盖"。→ 补 3 条纯函数契约测后 **whole-file 与 diff 双口径均 100% Stmts / 100% Branch**（原 85-100 行缺口全覆盖）。 |
  | `KeyTreeColumn.tsx` | 66.66% | **不成立（Tester 补测）**：`searchMode !== 'key'` 的值搜索切换就在 D-1 交付的 R1 段控件下游 → 补切换+回切旅程后 **whole-file 100%**（diff 口径 0/0：D-0 起该文件无新增行可加权）。 |
  | `useKeySelection.ts` | 72.22% | **不成立（Tester 补测）**：`toggleKey` 是 30px 行 leaf checkbox 的唯一 mutator，就在 D-4 行规格内 → 补点勾选/取消（whole-file 72.22→**88.88%**；diff 78.6→**96.4%**）。 |
  | `useWorkbenchSearch.ts` | 79.16% | **成立**：残余缺口是 value/all 模式的 `startValueSearch` 分支（65-70 行，属 value-search，非本轨）；补测后 whole-file Stmts 维持 79.16、Branch 66.7→75（模式切换测跑过 key 分支），未跨面不动。 |
- **结论**：8 条缺口里 **4 条"非本轨面"成立**（useBatchActions 的 P2 对话框分支 / useKeyRowActions 原生菜单体 /
  BatchBar 接线 / useWorkbenchSearch value 分支）、**1 条部分成立**（useWorkbenchSplit：拖拽体不测，纯函数 `clampTreeWidth` 已补，branch 0→100%）、
  **3 条不成立且已由 Tester 补测闭环**（batchInvokes → 双口径 100%、KeyTreeColumn → whole-file 100%、useKeySelection → 跨 80 线）。
  补测后本轨核心面（`treeLevels/treeEmptyState/treeRowSpec/treePreferences/keyTree/useKeyTreeView/useKeyTree/KeyTreeList`）Stmts 全部 100%、Branch 91~100%。
- **新增测试文件**（Tester 写，禁改生产码）：
  - `keyTreeTesterCoverage.test.tsx` — **24 例全绿**，11 组缺口：`keyUnderFolder` 边界（`app`≠`apple`/配置分隔符/跨分隔符 prefix）、
    I-4 `(n+)` 渲染与 wrap 后回落、leaf 复选框（`toggleKey` 唯一入口）、行点击≠勾选、Enter-on-folder、
    sticky 钉住行点击折叠、右键绑定、`useKeyTree` 调度 4 路（陈旧回包丢弃 / re-root 重取展开前缀 /
    `loadMore` 三守卫 / `clearTree`）、I-9 边缘臂（空树 guard、无 active 行进入、`parentIndexOf` 孤儿夹紧）、
    `KeyTreeColumn` 模式切换、`BatchPatternBar` 触发面、`batchInvokes` payload 契约、`clampTreeWidth`。
  - `keyTreeTesterGaps.test.tsx` — 6 例（4 绿 + 2 `it.skip` 对应 BUG-001/002）。
- **反摆设证明（变异注入，全部已 `git checkout` 还原，工作树干净）**：M1 `keyUnderFolder` 退化为裸 startsWith
  → 红；M2 `partial` 恒 false → 2 红；M3 删陈旧回包 guard → 红；M4 `loadRoot` 不重取展开前缀 → 红；
  M5 leaf checkbox 接空函数 → 红；M6 `loadMore` 去掉 done/loading 守卫 → 红；M7 Enter-on-folder 不折叠 → 红；
  M8 sticky 行点击失效 → 红；M9 `clearTree` 不清 expanded → 红；M10 右键未绑到行 → 红；
  M11 `rowCount===0` 改为 setActiveIndex(0) → 红；M12 无 active 行进入返回 -1 → 红；
  M14 `KeyTreeColumn` 值模式渲染死 div → 红。**M1~M12 + M14 共 13 项，存活 0**。
  （另有 M13 `parentIndexOf` 放宽 depth 判定**存活**：该变异在合法 pre-order 行集上与原版等价，属**等价变异**，
  非用例空洞 —— 该函数的"找到父行"正臂已被既有旅程覆盖，Tester 只补了"找不到夹紧"臂。故总计 14 项注入、
  13 杀 1 等价存活。）
- **口径说明**：上表"自报"列为 v8 **whole-file** 数字；Tester 判定列同时给 diff 加权与 whole-file，
  二者对同一文件可差数点（如 `useKeySelection` diff 78.6→96.4 / whole-file 72.22→88.88），
  凡本 Tester 声称"补测后 X%"处，两口径均已实测、方向一致（显著提升、跨 80 线者跨线）。

### 验收项 5：范围与契约（补记）
- 变异实验后 `git diff --stat -- packages/drivers/redis/ui/key-browser` **为空**，生产码零改动；
  工作树仅剩 Tester 新增的两个 `__tests__` 文件（未跟踪→已 commit）。
- `git grep DEFAULT_SEPARATORS` 无残留；`buildKeyTreeRows/splitKeyNamespace/separatorsFor` 三函数
  **在生产路径已无调用方**（仅 `keyTree.test.ts` 引用）—— 见下"审查记录"补充。

### 验收项 6：契约消费检查（简报 §2「明确不做」）
逐项实测，**全部合规，无提前偷接**：
- `KvSlotState` 契约（`packages/driver-sdk/src/types/kv-slots.ts:42-54`）当前只有
  `subscribe/getSelectedKey/selectKey/getDirty/setDirty` 五成员；本轨 `useKvSlotRelay.ts` 只调
  `selectKey` + `setDirty`（均为既有 F-2 契约），**未新增/未消费** `loaded/cursor/scanning/budget/selectionCount/recordWrite`
  任何 setter，状态确实"留在树自己手里"（`useKeyTree`/`useRedisKeyScan` 私有）。✅
- `git grep "key_probe|fetch_all|budget|Stop fetching|scan_abort" -- ui/key-browser` → 仅命中两处文档注释
  （"size budget"、"budget 上限"），**无实现**：页脚三态 / 扫描预算 UI / 25k 分片 rAF / 精确键短路均未接线。✅
- `count_matching`：`batchInvokes.invokeCountMatching` 只传 `{dbSessionId,dbIndex,pattern}` 三参
  （**未使用 W3-B 才引入的预算参数**），且只被 `useBatchActions.loadPatternCount`（pattern 对话框预览）调用，
  未接进 `n+` 计数 —— 与简报"本轨不调用它的新参数"一致。✅
- `I-10 容器查询断点（740/340/240）`：未做，`clampTreeWidth` 仍为固定 min/max；列头动作组未改。✅
- 未硬编码 W3-B 未合入形状：`partial` 计数走的是既有 `ChildEntry.count` + 层级 `done` 位，
  不依赖 W3-B 的预算返回。✅
- `ui/shared/meta.ts`、`scripts/resolve-drivers.mjs` 零改动（不在 41 文件 diff 内）。✅

### 验收项 7：E2E 留待 R 回归核对
自验记录的 `## 留待 R 回归` 三条**全部在册**且判定正确（本机确不可测）：
1. **sticky 视觉贴合**（真实滚动容器 + `position:sticky` 的亚像素对齐）—— jsdom 无布局引擎，
   Tester 补的旅程只能测到 `data-sticky-depth` 逻辑链与"钉住行可点击折叠"，测不到视觉贴合 → **保留 R**。✅
2. **`count_matching n+` 真库**（需 W3-B 契约 + 真 Redis 的预算返回）—— 本机 mock 只能造 cursor，
   造不出真实部分计数语义 → **保留 R**。✅
3. **OS 右键菜单弹出**（`showNativeContextMenu` 是宿主 IPC 弹原生菜单）—— jsdom 无 OS 菜单，
   Tester 只能断言"菜单被构建 + 绑到行的 key + 传了 client 坐标"（已补 M10 变异证明）→ **保留 R**。✅
- **Tester 追加第 4 条留待 R**（补测暴露、本机不可判）：BUG-001 修复后，pattern→`list_children` 的
  **真实服务端 prefix/分隔符语义**（`app:*` 到底该折叠成 `app:` 子树还是客户端 glob 过滤）需真库回归确认；
  单测与 mock 无法裁定哪种折叠与真 Redis 一致。

### 验收项 8：缺陷登记结果
见同目录 `bugs.md`：**2 条 `待修复`（BUG-001 Major / BUG-002 Minor）**，均经红测证实后登记，
各带 vitest 实测日志摘录 + 复现步骤 + 建议修法 + 是否阻断合并裁定。
两条均为**代码审查阶段产出、经新增测试证实**，不在 Rescuer 自报范围内（自报四件套全绿是事实，
但既有测试对该两条路径**零或伪覆盖**）。

### 审查记录补充（非 Bug，移交协调者裁定）
- `keyTree.ts` 的 `buildKeyTreeRows` / `splitKeyNamespace` / `separatorsFor` 三函数
  **生产码已无调用方**（`git grep` 仅命中 `keyTree.test.ts`）。简报 §1 D-3 点名的
  "换分隔符树形立即重算"的**状态机测试（`keyTree.test.ts:94` "R3 state machine"）实际测的是这段死代码**，
  真实链路 `buildServerTreeRows` 的重算靠旅程测（DOM 层，见 `keyTreeInteractionsJourney:185`）。
  ⇒ 判定：**不登记为 Bug**（真实路径有测试且行为正确，DOM 旅程已证实换 sep 后 `app:`→`app.`），
  但**自验记录"状态机 keyTree.test.ts:94"的引用具有误导性** —— 它给的"纯函数状态机覆盖"信心落在
  一段无人调用的旧客户端折叠上。建议 Coder 在修复回合顺手：删除死函数或将该状态机测试改测
  `buildServerTreeRows`（live path）。属"死代码 + 冗余测试"类（tester.md §2 审查项）。
- `Rescuer 声称"基线 47/456" → 实测 51/523" 的差值构成核对：本轨新增测试文件 4 个
  （`keyBrowserModuleSplit` / `keyTreeState` / `keyTreeJourney` / `keyTreeInteractionsJourney`），
  净增 4 files + 67 tests，与 6 个 commit 的测试面吻合。
  `git diff 8981d3078..HEAD -- __tests__ | grep "^-\s+(it|describe)\("` 全文只命中 **1 行**
  （`redisKeyWebContextMenu.test.tsx` 那条 `showNativeContextMenu` 用例改名，
  diff 显示断言体未动、只把读取路径从 `RedisWorkbench.tsx` 换成 D-0 拆出的 `useKeyRowActions.tsx`）
  ⇒ **无"删基线测试凑数"迹象**。
