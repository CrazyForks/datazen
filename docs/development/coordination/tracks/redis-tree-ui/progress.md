- 任务: 键树列头三行 + 行规格 + sticky 分组头 + 选择/键盘（PRD §3.2 R1~R3、§4 I-4、I-8、I-9、I-11）
- 状态: **TEST_IN_PROGRESS（第 3 轮 Tester 复测中，2026-09-23）**
- 编码 commit: 01f6396cd（D-0 拆分）、d591a9891（D-1/D-2 列头+搜索行）、a26ef97fc（D-3..D-8）、95040148f（批量错误分类 + 树状态机测试）、da04fd11b（14 条 DOM 旅程 + 注释修正）、ef0d62d94（台账 READY_FOR_TEST）；**修复轮 R1**：34ec2828d（BUG-002）、03f3790f5 + 307ce40df + 975e23e6b + eab9559bc + 406253a2f + eb733a757 + 87b5e4620 + 42c16bbee + d1581baf2（BUG-001 纯函数/接线/旅程/断言修正/死代码/别名/折叠子树 probe/楔形用例/gaps 头注释）
- 测试 commit: 9dc9ad2a2（门禁+范围审查）、8c39e2743（Bug 草稿）、bd22678e4（BUG-001/002 红测证实）、a68418d41（代码审查+旅程强度）、f8a191b66（覆盖率补测 + 判定收口）；**round-2**：本 commit（第 2 轮复测判定 + BUG-003/004 登记）
- 合并 commit: —
- 代理: w3d-tree-ui-rescuer（编码，接管原编码代理收尾）；Tester 第 1 轮 = 全新实例（前任 Tester 死于服务错误，无半成品）；原编码代理父会话 session-61319db9-6e5c-4f32-a35e-cad750b647dd
- Worktree: .worktrees/datazen-redis-tree-ui
- 分支: feature/redis-tree-ui
- 心跳: 2026-09-23 11:57（Coder 修复轮第 1 回合，HEAD = eb733a757 + 本台账 commit；四件套实测见「修复轮第 1 回合」§4）

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

---

## 修复轮第 1 回合（Coder 全新实例，HEAD 起点 f8a191b66）

> 任务：第 1 轮 Tester 的 BUG-001（Major）+ BUG-002（Minor）+ 协调者裁定的死代码收口。
> 取证与裁定全部来自协调者交接（已内联任务书），本回合未重新取证。
> 纪律：一步一 commit（7 个）、重型命令严格串行、写面按任务书锁定。

### 1. BUG-002（Minor）— 刷新失败的层级永久「扫描中」

`34ec2828d`。`treeLevels.ts` `markFetchFailed` 非 reset 分支由
`{ ...level, loading:false, done: level.pass===null ? true : level.done, error:true }`
改为 `{ ...level, loading:false, done:true, error:true, pass:null }`，并把语义写进注释：
失败的权威 pass 被**放弃**（`pass:null`）且层级关闭（`done:true`）——`children` 保留
最后良好子集（正是 I-4 的回退），下一次成功 `rescan` 重开 pass 并清 `error`（自愈）。
核对无回归：`:90` reset 分支（`EMPTY_LEVEL` 重写，无 pass 概念）与 `:109` continue 分支
（`pass===null` 时 `done` 语义不变）行为保持。

测试：`keyTreeState.test.ts` 新增 `describe('[redis-tree-ui-BUG-002] …')` 3 例——
状态机三要素完整（进入：开 pass 且 `anyLevelScanning` true；状态内/放弃：children 保留 +
`pass===null` + `done:true` + `anyLevelScanning` false；退出：下一次成功 `applyFetch`
清 `error`；外加 mid-pass 已有部分结果时的失败）；`keyTreeTesterGaps.test.tsx` 配对
`it.skip` **解 skip 转绿**（未删）。

### 2. BUG-001（Major）— 树视图 R2 pattern 是装饰件

协调者裁定 = **纯客户端过滤路线**，不改 `list_children` 契约（已核实：Rust 侧 opts
只有 `sep`/`noTtlOnly`/`keyType`，`commands_exec_dispatch.rs:26-41` 无 pattern 形参；
基线 `useRedisKeyScan` 的 pattern 是全局 flat 语义，树视图过滤属 D-2 新行为）。
**pattern→prefix 映射作为「取代之」的路线取消**（无基线先例）；本实现里 prefix 只做
**服务端收窄**（不改变可见性判定），可见性一律由客户端过滤决定——见 §2.b。

#### a) 纯函数（`03f3790f5`）
新文件 `ui/key-browser/keyTreeFilter.ts`：
- `globToRegExp` / `globMatchesName`：Redis `MATCH` 语义（`*`→`.*`、`?`→`.`、其余字符
  逐字转义、锚定、大小写敏感）；空串/编译失败 → `null`，调用方按「过滤开着但什么都不
  匹配」处理，**绝不**回退成「全匹配」。
- `filterTreeRowsByPattern(rows, pattern)`：表驱动状态机。空/`*` pattern 原样返回（identity）；
  **可见性按 `row.kind` 分叉**（`rowMatchTarget` 是唯一允许取 `path` / `entry.key` 的地方，
  杜绝「按字段存在性分叉」——子级叶子 `entry.key` 是服务端回的**绝对键名**，folder `path`
  带尾分隔符，两者对同一 pattern 含义一致）；文件夹匹配 ⇒ 只保自身，展开子行按自身匹配；
  **不匹配的祖先补渲染为面包屑**（`KeyTreeRow.folder.breadcrumb?: boolean`）；
  空文件夹（`count===0`）不显示；无匹配 ⇒ `[]`（这正是 `no-match` 在默认视图可达的前提）。
- `countSelectableRows` / `isBreadcrumbRow`：面包屑不可点、不计 `data-row-count`、不进选择集。
- `filterKeysByPattern`：可见键集的**单一事实源**（与行过滤在同一 pattern 上互相校验，
  测试里做了交叉断言）。

#### b) 接线（`307ce40df`）
- `useKeyTree`：新增 `appliedPattern` 选项，进 **reset 触发项**（`[..., sep, appliedPattern]`），
  并导出纯函数 `patternToTreePrefix(pattern, sep)` 做**根请求前缀路由**：
  `*`/空 或前导 `*` ⇒ `''`（全键空间，行为不变）；`app:*`/`app:user:*` ⇒ 保留到分隔符边界的
  字面头；头切在段内（`app:us*`）⇒ 回退到最后一个分隔符；无分隔符（`zzz`）⇒ 该字面本身
  （扫 `zzz*`）。层级 **state key 仍是 `''`**（行折叠/展开簿记地址不变），只有请求被收窄；
  子级请求继续用文件夹自身 prefix，故展开子树完全不受路由影响。
  裁定细节：客户端过滤仍是唯一裁决者，路由只减少服务端扫描量——过宽的前缀不可能让
  pattern 拒绝的键漏到屏上。
- `useKeyTreeView`：`treeRows` = 折叠后套 `filterTreeRowsByPattern`（**tree 视图 only**；
  `list` 视图是服务端已按同一 pattern 过滤的 `scan_keys` 输出，不再二次过滤）；
  新增 `visibleKeys` / `filterPattern` / `filterActive` 三个派生出口。
- `RedisWorkbench`：传 `scan.appliedPattern`（当前扫描所属的 pattern），不再是未应用的
  `searchPattern`。
- `KeyTreePane`：R1 计数 `data-loaded`、「全选已加载」、`KeyTreeColumn.allKeys`（文件夹
  级联）与 I-11 的 `{loaded}` **全部改读 `visibleKeys`** ⇒ 「屏上 2 行 vs 计数 0 vs 全选空集」
  这一矛盾对在结构上不可复现。`pattern` 展示源改 `view.filterPattern`。
- `KeyTreeList`：面包屑渲染成 `data-breadcrumb='true'` 的独立分支（无 checkbox/无删除/
  不可点折叠，sticky 头部同规则）；`data-row-count` 用 `countSelectableRows`（可导航行），
  与 `paintedRows`（布局网格）分离；I-9 键盘经 `stepActiveIndex` **跨过**面包屑且
  `→` 进子树时也跨；新增 `data-filter-active` / `data-filter-pattern` 便于按 data 断言。
- **未加载余量提示**：仅 `row.partial`（⇒ `level.done===false`）且有 filter 时，在
  `(n+)` 之后追加 `redis.tree.filterUnloaded`；`en.ts` 只追加这 **1 个** `redis.tree.*` key。
- `KeyTreeSearchRow`：`Esc` 从「只清文本」升级为「清文本 **且** 重放空 pattern」
  （`onClearFilter`）。理由：pattern 现在拥有行，只清输入会让树被一个屏幕上没有任何
  痕迹的 pattern 过滤着（I-11 旅程 `:620` 钉的正是「Esc 把过滤器退回全键空间」）。

#### c′) 折叠子树的 probe 臂（`87b5e4620`，接线轮之后由变异探针逼出）
接线轮留下的隐含洞：协调者清单第 3 条只说了「文件夹匹配 glob 时展开/收起可见性判定正确」，
但**折叠态**文件夹的子级从未被加载 ⇒ 行集无法回答「这底下有没有键匹配」，于是
`*user*` 会把确实含有 `app:user:1` 的 `app:` 文件夹整格清空，而 R1 计数（读同一份过滤后
键集）仍在数那个键 —— BUG-001 的矛盾换了个角落复活。
`filterTreeRowsByPattern` 因此接受第三个参数 `hasVisibleDescendant(folderPath)`：自身不匹配
但子树内存在可见键的文件夹以**普通可行**（可点可展开，展开是用户唯一的入口）留下；
probe 默认 `false`（无调用方 ⇒ 无凭据的幸存不给）；空文件夹永不被救；
发射优先级 **自身匹配 > 面包屑 > probe**（已画出存活行的祖先仍是不活泼面包屑）。
`useKeyTreeView` 把 probe 接到与「全选已加载」/复选框级联**同一份** `visibleKeys` 上，
三者结构上无法再分叉。旅程 fixture 同时改为**忠实的服务端模拟器**
（`scan_keys` 真按 glob 收窄、`list_children` 真按 sep 折一层），此后任何一致都是真一致
而非两个 mock 互相对暗号。

#### c″) 变异探针（本回合自测，全部已还原；编号 C 系列以免与 Tester 的 M1~M14 混淆）
- C1 filter 退化为 no-op ⇒ 3 红；C2 `countSelectableRows` 把面包屑计入 ⇒ 1 红；
  C3 prefix 路由改回 `''` ⇒ 4 红；C4 回退 BUG-002 的 `markFetchFailed` ⇒ 3 红；
  C5 把 R1 计数 `loadedCount` 接回 `scan.keys.length` ⇒ 1 红
  C6 probe 硬编码 `false` ⇒ 1 红。**6 注入 6 杀，存活 0。**
- C5 第一次是**存活**的，暴露真实测试强度洞：所有既有 fixture 里 flat 集合与树过滤集合
  天然相同（`zzz` 把两边同时清 0），「单一事实源」这条主张没有反例证人。因此补
  `42c16bbee`：强制 `scan_keys` **对 pattern 失明**（给什么 glob 都回五键），此时屏上唯一
  能收窄的东西只剩客户端过滤 ⇒ `*nope` 后 `data-loaded='0'` 与 `data-row-count='0'` 必须
  并肩成立，且「全选已加载」`disabled`（其判据正是 `loadedCount === 0`）。接回 flat list 的
  实现会显示「5 个已加载 / 0 行 / 按钮可点但选出空集」= BUG-001 的谎言只剩一个数字。
  复注 C5 后转红 ⇒ 该主张现在可杀。
### 3. 死代码收口（协调者裁定：删）— `406253a2f`、`eb733a757`

`keyTree.ts` 删 `buildKeyTreeRows` / `splitKeyNamespace` / `separatorsFor`（+私有
`countLeaves`），Grep 确认生产与测试调用方清零。`keyTree.test.ts` 的
「R3 state machine」用例**改写**（非删除）为测 live path
`buildServerTreeRows(levels, expanded, sep)`，状态机三要素齐（enter：两分隔符 ⇒ 两文件夹集；
in-state：label 按折叠所用分隔符切 + 外来分隔符 fallback；exit：旧分隔符下仍展开的 prefix 在新
回包到达前渲染为空，且 `(n+)` partial 旗标两臂）；另补「子级叶子保留绝对 `entry.key`、label
只留末段」用例，正是 §2.a「按 kind 分叉、不按字段存在性分叉」的依据。
`KeyTreeGroupRow.tsx` 与 `keyUnderFolder` 的文档注释同步去掉「客户端折叠 fallback 列表」
的旧说法（改为：分组在**服务端**、sep 同时进请求与 reset 触发项）。别名 `visibleTreeRows`
（无调用方）一并删除——本轮既然在清死代码，就不该顺手留下新的。

### 4. 门禁实测（严格串行，均在 f8a191b66 + 本回合 7 commit 之上）

| 门禁 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.drivers.config.ts` | **55 files / 613 tests passed，0 skipped**，exit 0（基线 53/551+2 skip：解 skip +2 转绿、新增 keyTreeFilter 38 + keyTreePatternFilter 20 + keyTreeState +3，只增不红）|
| `npx tsc --noEmit` | **0 error**，exit 0 |
| `node scripts/check-driver-import-boundaries.mjs` | **1486 files · 0 blocking · 4 advisory**，exit 0（advisory 为宿主既有引用，非本轨）|
| `npx vite build` | **built in 4.66s**，exit 0（chunk>500kB 为既有告警）|

覆盖率（v8，include=`packages/drivers/redis/ui/key-browser/**`，Tester 同口径
= git diff 新增行 ∩ v8 statementMap 行命中）：
- **本回合 diff 加权（`f8a191b66..HEAD`）**：Stmts **99.11%**（111/112）· Branch **100%**（61/61）。
  唯一未命中语句是 `globToRegExp` 的 `catch → null` 分支体（`new RegExp` 在前置逐字转义后
  不可抛，属不可达防御臂）。
- **全轨 diff 加权（`8981d3078..HEAD`）**：Stmts **87.77%**（646/736）· Branch **97.49%**（272/279）
  ——Tester 终值 86.14/88.72，两轴均上升，未掉穿 80。

### 5. 已知局限（登记，不阻断）

1. **懒加载树下 pattern 只作用「已加载行集」**：`level.done===false` 的文件夹里仍有过滤器
   从未见过的键，故其 `(n)`/`(n+)` 保持服务端计数并追加 `redis.tree.filterUnloaded`；
   按 pattern 收窄 `list_children` 的**服务端**语义（`list_children` 加 pattern 形参）
   属契约改动，留给 **R / Wave 4**（本轨 §2 亦已声明不调用 W3-B 新参数）。
2. prefix 路由只做收窄、不做判定：`zzz*` 这类前缀扫描会让根层少取数据，但「哪些行可见」
   仍由 `keyTreeFilter` 单独决定——两者不一致时以过滤为准（不会漏放、可能少放，方向安全）。
3. Tester 追加的留待 R 第 4 条（真库 `list_children` 折叠语义）**依旧保留**：本实现选了
   「客户端 glob 过滤为唯一裁决者」，真机复核只需确认 prefix 收窄不改变用户预期。
4. folder 复选框级联改读 `visibleKeys` ⇒ 折叠态匹配文件夹勾选的是「匹配 pattern 的子键」，
   未加载余量不在勾选内（与 1. 同源，Wave 4 服务端过滤后自然收敛）。

### 6. 范围自查（红线）

`git diff f8a191b66..HEAD --name-only` = 12 文件，全部落在
`packages/drivers/redis/ui/key-browser/**`、`ui/__tests__/**`、
`packages/drivers/redis/locales/en.ts`（+1 个 `redis.tree.*` key）、本轨 `bugs.md`/`progress.md`。
**零越界**：未碰 `BatchBar.tsx`/`ImportExport.tsx`/`redisInvoke.ts`（count_matching 消费端归 W3-B）、
`value-editors/**`、`console/**`、宿主 `src/**`、`driver-sdk/**`、`meta.ts`、`resolve-drivers.mjs`、
Rust `src/**`、他轨台账、`hub.md`。
未偷接 Wave 4：`KvSlotState` 仍只用既有 `selectKey`/`setDirty`；无新 getter/setter；
无页脚三态/预算 UI/`key_probe`。单文件最大 `KeyTreeList.tsx` **635** 行 ≤800
（`RedisWorkbench.tsx` 369 行，本回合只加了 1 处传参）。
E 轨接线面（`requestDraftLeave` 守卫 / `reloadDetail` 不清选中 / `handleSelectDb` 同库早退）
**未触碰**：本回合对 `RedisWorkbench.tsx` 的改动只在 `useKeyTreeView({...})` 的入参块。

### 7. 结论

两条 Bug 均修完并转绿（复测入口 `keyTreeTesterGaps.test.tsx` 6 例 0 skip、characterization
按交接要求改写为一致性断言而未删、2 条 precondition 绿测保持绿），四件套全绿，
覆盖率两口径均不降反升 ⇒ 状态置 **READY_FOR_TEST**，交第 2 轮 Tester。

---

## 第 2 轮复测记录（第 2 轮 Tester，全新实例，2026-09-23）

> 判定：**TEST_FAILED（第 2 轮，2 个 bug，Bug 循环 2/5）**
> —— briefed 的 BUG-001 / BUG-002 复测**通过**（已翻 `已修复` 并各附复测记录）；
> 边界推导与断言纪律扫描**新登记 2 条**：`redis-tree-ui-BUG-003`、`redis-tree-ui-BUG-004`（均 Minor，`待修复`）。
> 本轮只测不修：生产代码零改动；8 发反向突变逐一 `git checkout HEAD --` 复原，
> 每发后 `git status --porcelain` 验空（CLEAN_OK 8/8）。

### 1. 文件面审计 —— PASS

`git diff --name-only f8a191b66..HEAD` = **19 文件**，逐文件核对全在申报写入面内：
台账 2（`bugs.md` / `progress.md`）+ `packages/drivers/redis/locales/en.ts` +
测试 5（`keyTree.test.ts`、`keyTreeFilter.test.ts`、`keyTreePatternFilter.test.tsx`、
`keyTreeState.test.ts`、`keyTreeTesterGaps.test.tsx`）+ 源码 11（`key-browser/` 下
`KeyTreeColumn.tsx`、`KeyTreeGroupRow.tsx`、`KeyTreeList.tsx`、`KeyTreePane.tsx`、
`KeyTreeSearchRow.tsx`、`RedisWorkbench.tsx`、`keyTree.ts`、`keyTreeFilter.ts`、
`treeLevels.ts`、`useKeyTree.ts`、`useKeyTreeView.ts`）。
红线：`KeyTreeList.tsx` **635** 行 ≤800；`RedisWorkbench.tsx` **369** 行且 diff 仅
`appliedPattern: scan.appliedPattern` 传参与注释；**零越界**（未碰他轨台账、`hub.md`、
`redisInvoke.ts`、`value-editors/**`、`console/**`、宿主 `src/**`、`driver-sdk/**`、
`meta.ts`、`resolve-drivers.mjs`、tsconfig、scripts、Cargo.*、其他语言 locales）。
en.ts 只读核审：+4 行 = 3 行注释 + 1 个新 key `redis.tree.filterUnloaded` ✓。

### 2. BUG-001 glob 边界推导表（`/tmp/glob_boundary.mjs`，用后按约销毁）

Redis 7.2 `stringmatchlen_impl`（nocase=0）字节级忠实移植 × 产品 `globToRegExp`
（`keyTreeFilter.ts:43-56`）忠实移植；脚本自检 **15/15 PASS**（自检期望修正 1 处：
`h*o` 确实匹配 `hello`）。64 行矩阵结果：

| 方言面 | 样例（pattern / key） | Redis MATCH | 客户端 glob | 一致 |
|---|---|---|---|---|
| 核心：字面量/锚定/大小写/`*` 折叠/`?`/元字符字面（`( ) $ ^ + { } \|` 等） | `hello/hello` T、`user/User` F、`h*o/hello` T、`a**b/axb` T | 同左 | 同左 | ✅ **25/25** |
| 类 `[...]` | `h[ae]llo/hello`、`*[0-9]/user1`、`user[0-9]/user5`、`h[^e]llo/hallo`、`h[a-b]llo/hbllo` | 全 T | 全 F（`[` `]` `-` 被转义为字面量） | ❌ |
| 转义 `\` | `a\b/ab`、`\*lit/*lit` | T / T | F / F | ❌ |
| 转义反向 | `a\b/a\b` | F | T | ❌ |
| 换行字节 | `a?c/a\nc`、`*x/a\nx`、`a*b/a\nb` | 全 T | 全 F（`.` 不跨 `\n`） | ❌ |
| 多字节 `?` | `?/é`、`?/用` | F / F | T / T | ❌ |
| 多字节 `?` 反向 | `??/é`、`???/用` | T / T | F / F | ❌ |

合计 **16 处分歧**（类 5 + 转义 3 + 换行字节 3 + 多字节 `?` 5，以脚本矩阵输出为准）。
**跨视图场景（脚本实跑）**：pattern `*[0-9]`、键集 `['user1','user2','cache:9']` ⇒
扁平列表（服务端 `SCAN MATCH`）**3 行命中**；树（客户端 `globToRegExp`）**0 行 + `no-match`**
（`data-row-count='0'`）。产品 `patternHasGlob = /[*?[\]\\]/` 把 `[`/`\` 认作 glob 字符原样
下发服务端 ⇒ 邀请用户写类表达式，树却无法求值 ⇒ **登记 BUG-003**。

### 3. 反向突变矩阵（8 发 8 中，逐发复原 CLEAN_OK 8/8）

| # | 突变（生产代码） | 变红的测试 → 观测 |
|---|---|---|
| i | `globToRegExp` 去锚定（`new RegExp(source)`） | `keyTreeFilter.test.ts` → **3 failed \| 35 passed**（含「folder-only match 不走私子行」），exit=1 |
| ii | `globToRegExp` 加 `'i'` 标志 | `keyTreeFilter.test.ts` → **1 failed**（`glob user vs User ⇒ false`），exit=1 |
| iii-a | `countSelectableRows` 改数全部行 | `keyTreeFilter.test.ts` → **2 failed**（child-only 回填面包屑 / 深匹配保留祖先链），exit=1 |
| iii-b | `KeyTreeList.tsx:400` 面包屑分支改可点（`const breadcrumb = false`） | `keyTreePatternFilter.test.tsx` → **1 failed \| 19 passed**（「non-interactive breadcrumb」），exit=1 |
| iv | probe 臂 `hasVisibleDescendant(target)` → `false` | 纯测+旅程 → **2 failed \| 56 passed**（probe describe +「a folder with an open scan」），exit=1 |
| v | `useKeyTree.ts:111` `rootPrefix = ''`（去前缀路由） | → **4 failed \| 22 passed**（prefix 路由旅程×3 + gaps `FIXME(redis-tree-ui-BUG-001)`），exit=1 |
| vi | `treeLevels.ts` `markFetchFailed` 还原旧行为（`pass` 保留、`done` 不恒 true） | `keyTreeState`+gaps → **3 failed \| 42 passed**（BUG-002 进入/放弃、mid-pass、`FIXME(redis-tree-ui-BUG-002)`），exit=1 |
| C5 | `useKeyTreeView.ts` 树模式 `visibleKeys` → `loaded`（计数读未过滤集） | → **1 failed \| 25 passed**（「R1 counts the pattern-visible set even when the flat scan ignored the glob」`data-loaded='0'` 楔子），exit=1 |

日志 `/tmp/mut_i.log`、`mut_ii.log`、`mut_iii.log`、`mut_iiib.log`、`mut_iv.log`、
`mut_v.log`、`mut_vi.log`、`mut_c5.log`（证据摘录已进 `bugs.md` 复测记录，文件按约销毁）。

### 4. R1 计数一致性证据

- **单一源**：`KeyTreePane:86 loadedCount={visibleKeys.length}` → `KeyTreeHeader:87 全选
  disabled={!isKeyMode \|\| loadedCount===0}`；`useKeyTreeView:160-168` 行过滤与 `:186-189`
  `visibleKeys` 共用 `filterKeysByPattern`；`data-row-count` 走 `countSelectableRows`。
  全选 / `data-loaded` / I-11 空态 / 级联计数无第二事实源。
- **C5 楔子**（不靠读码，靠断言）：patternFilter L415 与 gaps L266 型断言
  （`scanKeys` 故意忽略 pattern、`scan_keys` 收窄到 0）要求 `data-loaded='0'` ——
  突变 C5（树行去过滤）直接打红 ⇒ 计数读的是 pattern-visible 集，钉死。
- 配合突变 iii-a（计数与行脱钩即红）、v（前缀路由丢即红），三方一致性闭环。

### 5. 两项 coder 自发决策独立裁定

**(a) Esc 同时清文本并重放空 filter —— 维持（不立案）。**
`KeyTreeSearchRow:68` Escape → `onClearFilter`；`KeyTreePane:102-108` = `setSearchPattern('')`
+ `search.applySearch('')` ⇒ `toScanPattern('')='*'` ⇒ 扫描与树在同一次跃迁回到全键空间。
若只清文本：applied pattern 仍在裁行而输入框已空 —— 正是 BUG-001「屏幕上无痕迹的过滤态」
同类谎言；且空态引用源 `KeyTreePane:148 pattern={view.filterPattern}` 要求二者同进退，
否则空态会引用一个已不存在的 pattern。旅程钉住：`keyTreePatternFilter` Esc 用例
（childPrefixes 含 `''`、行恢复、`data-filter-active` 归位）。

**(b) 折叠文件夹 probe 臂（`87b5e4620`）—— 维持（不立案）。**
probe 与计数**同读同一已加载键集**（`hasVisibleDescendant` ← `filterKeysByPattern(loadedKeys)`
= 计数源），无第二事实源；若删 probe 走严格 glob：`*user*` 下 `app:user:1` 保留在
`visibleKeys`（计数 ≥1）而 `app:` 文件夹行被抹 ⇒「计数说有、屏幕不可达」——
**重新制造 BUG-001 矛盾对**，恰是修复要消灭的东西。约束已钉：空文件夹永不被救
（`row.count>0` 前置）、优先级 self-match > breadcrumb > probe；突变 iv 在纯测+旅程双层
打红 **2 failed** 证明该臂被锁定而非装饰。懒加载余量（probe 只看已加载集）已记修复轮 §5 已知限制。

### 6. un-skip 门 —— PASS

`npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/keyTreeTesterGaps.test.tsx`
⇒ `Test Files 1 passed (1)` / **`Tests 6 passed (6)`，0 skipped，EXIT=0**。
6 例均为具体断言（`data-loaded` / `data-row-count` / childPrefixes / invoke 参数），
无降级占位；两例标题保留 `FIXME(id)` 前缀仅为来历标记（文件头注释已说明），非 skip 残留；
全仓 `.skip(` / `it.todo` **0 命中**。

### 7. 断言纪律 —— PASS

- 几何反查：`getBoundingClientRect|offsetTop|clientHeight|getBoundingClientRect` 等在
  `__tests__` **0 命中**（数据属性解耦 ✓，AGENTS「禁止视口几何坐标反查」）。
- 空断言：改动 5 文件内 0 处裸存在性目标断言当结论（仅 patternFilter 两处 `findBy*`
  前置，后随具体 `data-*` 断言）；无 `xLength` 型空数组断言当强断言的情形。
- 文案：断言全走恒等 `t` 的 i18n key / `data-*` 状态值，**零英文 copy 字面量**断言
  （改动文件内）。
- `.skip(` / `it.todo`：0。

### 8. 四门（串行执行，原文尾）

1. **vitest drivers**：`Test Files  55 passed (55)` / `Tests  613 passed (613)` /
   `Duration 10.50s (transform 5.10s, setup 21.36s, import 5.06s, tests 8.74s, environment 28.68s)` / **EXIT=0**
   （自报 55/613/0 skipped 逐字吻合；skipped grep = 0）。
2. **tsc**：`npx tsc --noEmit` → **EXIT=0**，输出 **0 行**。
3. **build**：`npm run build` → **EXIT=0**，`✓ built in 4.76s`
   （>500kB chunk 警告为存量基线，与自报 4.52s 同量级）。
4. **boundaries**：`ok (1486 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))` / **EXIT=0**
   —— 1486/0/4 与自报**逐字吻合**。

**覆盖率复算**（v8 `--coverage.provider=v8` → `/tmp/cov_round2/coverage-final.json`，
本 Tester 方法 = `git diff -U0` 新增行 ∩ `statementMap`/`branchMap`；文件用后销毁）：

| 轴 | 语句（本 Tester 严口径=范围交叠） | 自报语句 | 分支 ALL-sides | 分支 ANY-side | 自报分支 |
|---|---|---|---|---|---|
| `f8a191b66..HEAD`（本轮修复） | **96.49%** (165/171) | 99.11% | 83.61% (51/61) | **100.00%** (61/61) | 100% |
| `8981d3078..HEAD`（全轨） | **87.68%** (790/901) | 87.77% | 81.36% (227/279) | **97.49%** (272/279) | 97.49% |

- 分支 ANY-side（≥1 侧命中）两轴与自报**逐数吻合**（100.00 / 97.49）⇒ 自报口径复原成功；
- 语句：track 轴 87.68 vs 87.77（Δ0.09pp，单语句交叠口径边缘差）；round 轴 96.49 vs 99.11 ——
  差异全部可归因：自报按「根因 1 处不可达 catch」计，本 Tester 按语句点计
  `globToRegExp` throw 不可达路径 3 点（L54/L107/L196 同一根因）
  + 键盘跨面包屑循环 3 点（`KeyTreeList:174/176/274`，即 BUG-004 证据）；
- **四数全 ≥80% 地板 ✓**（最紧：track ALL-sides 分支 81.36%）。
- 全轨 miss 尾巴另有 `useWorkbenchSearch.ts:61`、`workbenchDatabases.ts:29`、
  `useWorkbenchSplit.ts:31-42`（round-1 期存量，不属本轮义务）。

### 9. 死代码零残留 —— PASS

`git diff f8a191b66..HEAD` 无 revert/半成品残留；round-1 清理 commit
（`406253a2f` 退役 fold helpers、`eb733a757` 删 `visibleTreeRows` 别名）之后**无新增孤儿**：
`keyTreeFilter` 导出面（`globToRegExp`/`filterTreeRowsByPattern`/`filterKeysByPattern`/
`isBreadcrumbRow`/`countSelectableRows`）全部被 `useKeyTreeView`/`KeyTreeList`/测试消费；
`treeLevels` 导出被 `useKeyTree` 消费；`tsc --noEmit` 0 错。
全仓 redis ui `FIXME|@ts-ignore|@ts-expect-error|eslint-disable|\.skip\(|it\.todo` 逐条核过：
均为存量既有项（带理由的 `exhaustive-deps`/`no-unnecessary-condition`、他轨 kvBar 注释、
gaps 文件头注释 + 两例绿标题来历标记）+ `stringKeyValue.test.ts` 存量 `@ts-expect-error`，
**本轮零新增死代码/抑制**。

### 10. 台账写入（本 commit 的唯一变更）

- `bugs.md`：BUG-001/BUG-002 状态 `待复测` → **`已修复`** + 各附 `## 复测记录（round-2）`；
  新增 `redis-tree-ui-BUG-003`（跨视图 glob 方言矛盾）、`redis-tree-ui-BUG-004`
  （键盘跨面包屑零旅程锁定）各一节、均 `待修复`；头部新增第 2 轮判定块。
- `progress.md`：状态行翻 **TEST_FAILED（第 2 轮，2 个 bug，Bug 循环 2/5）** + 本记录。

### 11. 结论

两条 briefed bug 复测**通过**（突变 8/8、C5 楔子、un-skip 6/0、四门 55/613 全绿、
覆盖率两口径两轴 ≥80% 且 ANY-side 与自报逐数吻合）；两项自发决策均**维持**（§5 证据）；
但 glob 边界推导暴露修复自选「纯客户端过滤」路线与服务端 MATCH 的 16 处方言分歧
⇒ **BUG-003**；断言纪律/覆盖执行计数暴露「键盘跨面包屑」声称行为 0 执行、0 旅程
⇒ **BUG-004**。新 bug 有据即立案 ⇒ 判定 **TEST_FAILED（第 2 轮，2 个 bug，Bug 循环 2/5）**，
交协调者排修复轮第 2 回合。本轮生产代码零改动，commit = `test(coordination): ...`（仅台账两文件）。

## 修复轮第 2 回合（round-2）

修复 commit：`698b18174`（BUG-003：`keyTreeFilter.ts` glob 方言按 Redis `stringmatchlen` 字节级移植）、
`492f5503d`（BUG-004 + BUG-003 尾部：面包屑键盘旅程锁定 + 仅字面头做前缀路由）。
基线：vitest 55 files/613 passed/0 skipped；tsc 0；build exit 0；boundaries 1486 files·0 blocking·4 advisory。
新增测试文件令计数上涨，实际数字如下（逐字尾部，串行执行）。

### 1. vitest drivers

`npx vitest run --config vitest.drivers.config.ts` → 尾部：

```
 Test Files  56 passed (56)
      Tests  697 passed (697)
   Start at  14:55:19
   Duration  18.73s (transform 11.33s, setup 36.52s, import 9.71s, tests 15.38s, environment 53.79s)
```

（55→56 files、613→697 tests，全部 passed，**0 skipped**；`Duration` 为环境相关量。）

### 2. tsc

`npx tsc --noEmit; echo "tsc exit=$?"` → 尾部：

```
tsc exit=0
```

（输出 0 行，退出码 0。）

### 3. build

`npx vite build` → 尾部：

```
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 6.10s
build exit=0
```

（两条 >500kB chunk 警告为存量基线，非本轨引入；退出码 0。）

### 4. boundaries

`node scripts/check-driver-import-boundaries.mjs` → 尾部：

```
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:26: reaches into driver internals (packages/drivers/mongodb/ui/meta)
[check-driver-import-boundaries] R3 (advisory) src/windows/connection/DocumentConnectionView.tsx:25: reaches into driver internals (packages/drivers/mongodb/ui/mongodbFind)
[check-driver-import-boundaries] ok (1487 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
```

（1486→1487 files 为新增测试文件所致；**0 blocking**、4 advisory 与基线一致。）

### 5. 结论

四门全部 PASS，无失败项；产物零改动（本轮仅台账两文件变更）。BUG-003/BUG-004 已翻 `待复测`，交第 3 轮 Tester。

## 第 3 轮复测记录（第 3 轮 Tester，全新实例，2026-09-23）

> 复测对象：修复轮第 2 回合 —— `698b18174`（BUG-003 glob 方言字节级移植）、
> `492f5503d`（BUG-004 面包屑键盘旅程 + 仅字面头前缀路由）。Bug 循环 3/5。只测不修。

### 1. 文件面审计 —— PASS

`git diff f3a3eea19..HEAD --name-status` = **10 文件**（f3a3eea19 = 第 2 轮 Tester 判定 commit）：

```
M  docs/development/coordination/tracks/redis-tree-ui/bugs.md
M  docs/development/coordination/tracks/redis-tree-ui/progress.md
A  packages/drivers/redis/ui/__tests__/keyTreeBreadcrumbKeyboardJourney.test.tsx
M  packages/drivers/redis/ui/__tests__/keyTreeFilter.test.ts
M  packages/drivers/redis/ui/__tests__/keyTreePatternFilter.test.tsx
M  packages/drivers/redis/ui/__tests__/keyTreeState.test.ts
M  packages/drivers/redis/ui/key-browser/KeyTreeList.tsx
M  packages/drivers/redis/ui/key-browser/keyTreeFilter.ts
M  packages/drivers/redis/ui/key-browser/treeRowSpec.ts
M  packages/drivers/redis/ui/key-browser/useKeyTree.ts
```

- 逐文件核对：全部落在 `ui/key-browser/**`（源码 4）+ `ui/__tests__/**`（测试 4）+ 本轨台账 2。
- **禁改面零命中**：`BatchBar` / `ImportExport` / `redisInvoke` / `value-editors` / `console` /
  宿主 `src/` / `driver-sdk` / `ui/shared/meta.ts` / `resolve-drivers.mjs` / `*.rs` / `scripts/` /
  `hub.md` / `tsconfig` / `Cargo.*` / `locales/`（含 `locales/en.ts`）—— 反向 grep 判 `NONE-TOUCHED`；
  越界白名单反向过滤判 `NONE-OUT-OF-SCOPE`。**本轮未改 `locales/en.ts`**（自报「如有」= 无）。
- 规模红线：`KeyTreeList.tsx` **652 行** ≤800 ✓；`keyTreeFilter.ts` 350、`treeRowSpec.ts` 169、
  `useKeyTree.ts` 253，均 ≤800 ✓。
- diff 量级：1186 insertions / 101 deletions（测试 889 行占大头，符合「修复＝补测 + 方言重写」形态）。

结论：**PASS**，无越界、无禁改面命中。

### 2. BUG-003 十六分歧面逐条复验 —— PASS

**方法（比第 2 轮更强）**：不再用「第二份手写 JS 移植」当预言机，而是取
**Redis 7.2.0 `src/util.c` 的 `stringmatchlen_impl` 原文**（`curl` 自 redis/redis@7.2.0，
`sed -n '44,195p'` 逐行核对）编译成**真正的 C 预言机** `/tmp/r3/oracle.c`（`cc -O1`，
未改一个字节，仅补 `pbuf[pn]='\0'` 以匹配 Redis sds 的 NUL 终止语义——C 的尾随
`while(*pattern=='*')` 会读越界一个字节）。TS 侧经临时 vitest 探针
（`__tests__/keyTreeFilterRound3Probe.test.ts`，**用后删除**）以 hex 编码驱动，
避免 NUL/换行字节在 `execFile` 字符串里失真。

**规模**：模式 101 × 键 91（含空键、换行、`é`/`用`、类/转义残片、病态 `a*a*a…b`）
= **9216 例逐例对拍** ⇒ **mismatches=0**。

| # | 分歧面（第 2 轮实测） | 样例 pattern / key | Redis 期望 | TS 实测 | 判 |
|---|---|---|---|---|---|
| 1 | 类-集合 | `h[ae]llo` / `hello` | 1 | 1 | ✅ |
| 2 | 类-范围 | `*[0-9]` / `user1` | 1 | 1 | ✅ |
| 3 | 类-范围 | `user[0-9]` / `user5` | 1 | 1 | ✅ |
| 4 | 类-取反 | `h[^e]llo` / `hallo` | 1 | 1 | ✅ |
| 5 | 类-范围 | `h[a-b]llo` / `hbllo` | 1 | 1 | ✅ |
| 6 | 转义 | `a\b` / `ab` | 1 | 1 | ✅ |
| 7 | 转义 | `\*lit` / `*lit` | 1 | 1 | ✅ |
| 8 | 转义反向 | `a\b` / `a\b` | 0 | 0 | ✅ |
| 9 | 换行字节 | `a?c` / `a\nc` | 1 | 1 | ✅ |
| 10 | 换行字节 | `*x` / `a\nx` | 1 | 1 | ✅ |
| 11 | 换行字节 | `a*b` / `a\nb` | 1 | 1 | ✅ |
| 12 | 多字节 `?` | `?` / `é` | 0 | 0 | ✅ |
| 13 | 多字节 `?` | `?` / `用` | 0 | 0 | ✅ |
| 14 | 多字节 `?` | `??` / `é` | 1 | 1 | ✅ |
| 15 | 多字节 `?` | `???` / `用` | 1 | 1 | ✅ |
| 16 | 多字节 `?` | `??` / `用`（需 3 字节） | 0 | 0 | ✅ |

**16/16 一致**（面 8 为「反向」面，即 `\` 不再被当字面量；面 16 补全第 2 轮
「多字节 `?` 5 面」计数：12/13 为反向、14/15/16 为正向，与 BUG-003 登记
「类 5 + 转义 3 + 换行 3 + 多字节 5」逐数吻合）。

**附加面（同批实测，均一致）**：`[b-a]` 交换操作数、`[!e]` **不是**取反符、
类内 `\]` 转义、未终止类 `[abc` 回退、`[^]` 空取反、`[]]`、`[a-]`、`[-a]`、
`**` 折叠、`*` 不匹配空键、病态模式 `a*a*a*a*a*b` + `skipLongerMatches` 早退。

**语义复核（源码对读，非仅跑测）**：`keyTreeFilter.ts:88-194` 的 `matchSeq` 与
C 逐臂同构 —— `*` 折叠 + `pLen===1` 短路 + 先试余式后吞字节 + `state.skip` 早退；
`?` 走**字节**游标（`s++/sLen--`，`sLen` 是 UTF-8 字节长，故 `?` 对 `é` 只吞 1/2 字节 ⇒ 不匹配）；
`[` 的 `\`-臂 / `]`-臂 / `pLen===0` **回退一格** / `pLen>=3 && [1]=='-'` 范围（`start>end` 交换）；
`\` 臂**无 break 直落**到字面比较；末尾 `pLen===0 && sLen===0` 锚定。`compileGlob`
先 `trim()` —— 与 `toScanPattern`（`useWorkbenchSearch.ts:97`）**同样 trim** 后再下发，
两侧 trim 口径一致，无新增分歧（此为审查中主动核对项，非假设）。

**变异矩阵（4 发 4 中，逐发 `git checkout HEAD --` 复原 + `git status --porcelain` 验净）**

| # | 突变（`keyTreeFilter.ts`） | 探针 | 仓库自带套件 | 判定 |
|---|---|---|---|---|
| i | 键侧按**字符**编码（`encodeChars`，等价「`?` 用 `.`」的字符语义） | **40 mismatches**，多字节面全红 | `keyTreeFilter.test.ts` **6 failed \| 86 passed** | 命中 |
| ii | 禁用 `[` 类臂（退化为字面 `[` 的正则式回退） | **142 mismatches** | **16 failed \| 76 passed** | 命中 |
| iii | 去锚定（`return true`） | **1223 mismatches** | **14 failed \| 78 passed** | 命中 |
| iv | 删 `\` 转义的直落臂 | **22 mismatches** | **4 failed \| 88 passed** | 命中 |

四发合计 vitest 侧失败（探针+自带套件同跑，EXIT=1）：i **9 failed \| 88 passed**、
ii **19 failed**、iii **17 failed**、iv **4 failed**（后者为自带套件单独计数）。
**四发复原后逐发复跑探针 = `mismatches=0 / faces_ok=16/16 / 5 passed`，CLEAN_OK 4/4。**

结论：**PASS**，无新 bug。第 2 轮登记的 16 分歧面**全部闭合**，且闭合方式经真实 C 实现
9216 例对拍 + 4 向突变双向验证，而非仅「自报新增用例」。

### 3. BUG-004 键盘旅程复验 —— PASS（附「行号已漂移」的独立裁定）

**运行**（提交态、串行）：`npx vitest run --config vitest.drivers.config.ts
--coverage.enabled=true --coverage.provider=v8 --coverage.all=false
--coverage.include='packages/drivers/redis/ui/key-browser/**' --coverage.reporter=json`
⇒ `Test Files 56 passed (56)` / `Tests 697 passed (697)` / EXIT=0
（**注意**：`vitest.drivers.config.ts` **无 `coverage` 块**，第 2 轮沿用的
`--coverage.reporter=json` 单独并不会开启采集 —— 首次尝试只落到 9 月 22 日的
**陈旧** `coverage/coverage-final.json`（其 `KeyTreeList.tsx` 唯一语句行止于 520，
与当前 652 行不符，据此读到的「行号对不上」是陈旧产物而非代码问题）。
本轮改用 `--coverage.enabled=true` 重新采集到 `/tmp/r3/cov3/` 后取数。）

**hits 实测（`/tmp/r3/cov3/coverage-final.json`）**

| 第 2 轮判据 | 第 2 轮实测 | 本轮实测 | 结论 |
|---|---|---|---|
| `KeyTreeList.tsx:174` | **0** | **13**（语句 `s18 L174`） | ✅ >0 |
| `KeyTreeList.tsx:176` | **0** | **13**（该行现为**注释**；对应语义语句为 `s19 L182`=13） | ✅ |
| `KeyTreeList.tsx:274` | **0** | **7**（语句 `s78 L274-299`，`→` 臂） | ✅ |

**关键裁定：行号已漂移，`hits>0` 不可按原文照抄。** 修复 `492f5503d` 把
`KeyTreeList.tsx` 里**两处内联的跨面包屑 while 循环抽成** `treeRowSpec.ts` 的
`nextNavigableIndex()`，因此：
- `:174` 已从「循环体」变为 **委托调用** `const walked = nextNavigableIndex(...)`（hits=13）；
- `:176` 现为**注释行**（无语句），第 2 轮所指的「跨过体」语义已迁走；
- 真正的跨过循环现在是 **`treeRowSpec.ts:167`** —— 语句 `s46/s47` 计数
  **33 / 32**（`s47` 即循环体自增，第 2 轮该语义等价物为 0），分支
  `b22 L167 [33,58,51]`、`b23 L168 [19,14]`、`b24 L168 [33,26]` **两侧全非零**；
- `:274` 的 `→` 臂现走同一 helper（hits=7），不再是第二份内联拷贝。

⇒ 判据「174/176/274 必须 >0」**在字面上：174=13>0、274=7>0 成立；176 因重构成为注释**。
**结论：BUG-004 的实质判据（跨过守卫被真实执行、且不再有零证据的内联拷贝）成立**，
且强度高于第 2 轮的「补一条旅程」——重构后**两臂共用同一被测 helper**。

**旅程源码核验（非 vacuous）**：`keyTreeBreadcrumbKeyboardJourney.test.tsx`
（339 行，5 例）确为**真键盘旅程**：
- 驱动方式：`fireEvent.keyDown(tree(), { key: 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Enter' })`
  （`:182-184 press()`），非直接调内部函数；
- 断言面：`data-active-index`、`data-active`、`data-breadcrumb`、`data-row-index`、`data-row-count`
  —— 全 `data-*`，**零几何反查、零英文文案字面量**；
- 前置事实先自证（`:208` setup 例断言面包屑确实在 index 0、键行在 index 1），
  避免「拿一个没有面包屑的树证明不落在面包屑上」的空转；
- 中间态齐全：`-1 → ↓ → 1`、`↑` 夹紧留在 1、连按三次不得爬上面包屑（`:249-257`）、
  全面包屑树五种键均留 `-1`（`:268-271`）。

**变异矩阵（2 发 2 中，逐发 `git checkout HEAD --` 复原 + `git status --porcelain` 验净）**

| # | 突变 | 结果 | 观测 |
|---|---|---|---|
| A | `treeRowSpec.ts:167` **删除跨过循环**（删 `!isNavigable` 守卫） | **2 failed \| 3 passed**，EXIT=1 | `:232` 与 `:247` 均 `expected '0' to be '1'` —— `↓`/`↑` 落在面包屑（index 0）而非键行（index 1），**正是 BUG-004 复现** |
| B | `KeyTreeList.tsx:182` **还原 round-1 行为**（`return target`） | **1 failed \| 4 passed**，EXIT=1 | `:250` `expected '0' to be '1'` —— 夹紧臂回到会落上面包屑的旧缺陷 |

复原后复跑 journey + `keyTreeState` + `keyTreeInteractionsJourney` =
**64 passed / 3 files / EXIT=0**，`git status --porcelain` 空（**CLEAN_OK 2/2**）。

结论：**PASS**，无新 bug。第 2 轮「全部 613 条测试里执行 0 次、删守卫不会变红」的
回归裸奔状态**已闭环**：现在删守卫（突变 A）或还原旧行为（突变 B）均立刻打红。

### 4. 四门复跑（提交态、严格串行、逐字留尾）—— 4/4 PASS

**1/4 vitest drivers** `npx vitest run --config vitest.drivers.config.ts` → EXIT=0，尾部：

```
 Test Files  56 passed (56)
      Tests  697 passed (697)
   Start at  15:05:55
   Duration  10.45s (transform 4.44s, setup 21.51s, import 4.29s, tests 10.28s, environment 28.09s)
```

（56 files / 697 passed / **0 skipped**（`skipped` 词频 = 0），与自报**逐数吻合**；本轮探针已删除，
故不掺入探针计数。）

**2/4 tsc** `npx tsc --noEmit` → **tsc exit=0**，输出 **0 行**。

**3/4 build** `npx vite build` → **build exit=0**，尾部：

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 4.66s
```

（>500kB chunk 警告为**存量基线**，与自报 6.10s 同量级，非本轨引入。）

**4/4 boundaries** `node scripts/check-driver-import-boundaries.mjs` → **boundaries exit=0**，尾部：

```
[check-driver-import-boundaries] R3 (advisory) src/locales/locales.test.ts:107: reaches into driver internals (packages/drivers/redis/locales)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:25: reaches into driver internals (packages/drivers/redis/ui/shared/meta)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:26: reaches into driver internals (packages/drivers/mongodb/ui/meta)
[check-driver-import-boundaries] R3 (advisory) src/windows/connection/DocumentConnectionView.tsx:25: reaches into driver internals (packages/drivers/mongodb/ui/mongodbFind)
[check-driver-import-boundaries] ok (1487 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
```

（1487 files / **0 blocking** / 4 advisory，与自报**逐字吻合**；advisory 均为存量宿主引用。）

### 5. 覆盖率回归（v8，`--coverage.include='packages/drivers/redis/ui/key-browser/**'`）—— PASS

方法沿用第 2 轮的**严口径**：`git diff -U0` 的**新增行** ∩ `statementMap` / `branchMap`
（`/tmp/r3/covaxis.mjs`，用后销毁）；`coverage-final.json` 取自 §3 的同一次采集
`/tmp/r3/cov3/`（提交态、探针已删，**56 files / 697 tests**），非陈旧产物。

| 轴 | 语句（本轮） | 第 2 轮语句 | 分支 ALL-sides（本轮） | 第 2 轮 ALL | 分支 ANY-side（本轮） | 第 2 轮 ANY |
|---|---|---|---|---|---|---|
| `f3a3eea19..HEAD`（**本回合**修复 diff） | **99.19%** (123/124) | 96.49%（其轴为 `f8a191b66..HEAD`） | **96.39%** (80/83) | 83.61% | **100.00%** (41/41) | 100.00% |
| `8981d3078..HEAD`（**全轨**） | **88.79%** (840/946) | 87.68% (790/901) | **90.49%** (552/610) | 81.36% | **97.70%** (297/304) | 97.49% |

- **六数全 ≥80% 地板 ✓**（最紧：全轨语句 **88.79%**），无一项下降：
  本回合语句 96.49→**99.19**（+2.70pp）、ALL-sides 83.61→**96.39**（+12.78pp）；
  全轨语句 87.68→**88.79**（+1.11pp）、ALL-sides 81.36→**90.49**（+9.13pp）、
  ANY-side 97.49→**97.70**（+0.21pp）。
- 本回合 diff 上**唯一语句缺口 1 点**（`keyTreeFilter.ts` 111 中 110 命中）与
  **唯一 ALL-sides 分支缺口**（`KeyTreeList.tsx` 6 中 4）均为**防御性/不可达边界**，
  非行为缺口：分别为 `matchSeq` 的 `nesting > MAX_NESTING` 保护（Redis 源码同款
  「abusive pattern protection」）与 `stepActiveIndex` 的 `isNavigable(from)` 兜底；
  该两者在各自轴上的 **ANY-side 均为 100%**（41/41），即条件两侧均被真实执行过。
- 口径说明：第 2 轮自报本回合 99.11% 系按「根因 1 处不可达 catch」计 3 点，
  与严口径的点计数差异已在第 2 轮 §8 记录；本轮**同一轴同一口径**下
  自报（无独立数字，仅声明「新增测试文件使计数上涨」）与本 Tester 实测不冲突。
- 逐文件（本回合轴）：`keyTreeFilter.ts` 110/111、`treeRowSpec.ts` 4/4、
  `useKeyTree.ts` 3/3、`KeyTreeList.tsx` 6/6。
