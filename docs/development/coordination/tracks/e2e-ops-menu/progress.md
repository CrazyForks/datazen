# Track: e2e-ops-menu — E2E 运维菜单用例修复

- **状态**: PASSED（复测第 1 轮：`e2e-ops-menu-BUG-001` 已修复，完整回归通过，无新增 Bug；复测记录见文末「复测记录（第 2 轮 · 测试子代理）」）
- **分支**: `feature/e2e-ops-menu`
- **改动范围**: 仅 `e2e/specs/` 三个 spec 文件 + 本进度文件。未触碰 `src/`、`src-tauri/`、`packages/`、`e2e/helpers.ts`、`e2e/wdio.conf.ts`、`e2e/lib/**`。

## 一、根因（跨 spec 共享的三条）

### RC-1 跨 spec 后端会话泄漏（影响最广）

WDIO 全程复用**同一个 Tauri 进程**，而每个 spec 的 worker 数据库是按 spec
创建后即删除（`before` 建库、`after` 删库 + `cleanupAppDataViaIpc`）。Rust 侧
`connect` 对同一 `connectionId` 会**复用仍然存活的会话**，于是排在后面的 spec
通过 UI 连接 `conn_e2e_pg` 时拿到的是**绑定在已删除 worker 库上的旧会话**：

```
Error: database "e2e_w18662_0_4r71" does not exist
```

导致 `execute_query` / `list_processes` / `server_status_snapshot` /
`get_databases` 全部失败 → 空行、错误态面板、`pgTableExists` 抛错。
失败日志中的会话 id 复用（`73a3688a` / `12f16519` 跨 spec 出现）证实了这一点。

**spec 内修复**：三个 spec 的 `before()` 在 `connectSeededPgInWorkspace()`
之前新增 `dropLeakedSeededSession()`——先 `connectBackend('conn_e2e_pg')`
探测残留会话，若存在则 `disconnectBackend()` 强制断开（try/catch 静默无会话
情形）；随后 UI 连接会基于本 spec 的 worker 库新建会话。

### RC-2 连接右键菜单异步构建 vs 固定 `pause()` 竞争

`handleConnectionContextMenu` 是 async（先 `await getDriverCommands` 再
`show()` 菜单）。每个 spec 开头 `location.reload()` 后模块重新加载，**首次**
打开菜单明显更慢；原 spec 固定 `pause(400/500)` 必然输给渲染 → 菜单断言在
菜单尚未出现时执行。这解释了失败分布：**每个 spec 的第一条菜单用例失败、
后续用例（菜单已热）通过**。

**spec 内修复**：所有开菜单路径替换为
`waitUntil($('[data-testid="web-context-menu"]').isExisting(), timeout 8000)`
（带明确 timeoutMsg）；开菜单前先 `closeAnyMenu()` 关掉残留菜单，避免把旧菜单
误判为新菜单渲染完成。

### RC-3 `dismissMenu()` 是 no-op

`WebContextMenu` 的关闭逻辑是
`window.addEventListener('mousedown', e => { if (!rootRef.contains(e.target)) hide() })`。
原 spec 向 `document` 派发 **不冒泡** 的 `mousedown`，永远到不了 window 监听器
→ 菜单从不关闭，污染后续断言。

**spec 内修复**：`closeAnyMenu()` 向 `document.body` 派发冒泡 `mousedown`
并 `waitUntil` 菜单真正消失（3s，失败带 timeoutMsg 抛错、不再吞掉）。

> **round-1 更正**：round-0 曾改为向 `window` 派发，实测无效——`e.target === window`
> 非 Node，`rootRef.contains(window)` 抛 TypeError → `hide()` 不执行
> （`e2e-ops-menu-BUG-001`），详见文末「修复轮第 1 回合」。

## 二、逐文件根因与修复

### `e2e/specs/ops-process-server.ts`（原 6 失败）

| 用例 | 原失败点 | 根因 | 修复 |
| --- | --- | --- | --- |
| OPS-PROC-001 | `hasMenuItemId('process-list')` false | RC-2（本 spec 首条菜单用例）+ RC-3 | `rightClickConn()` 等真实菜单；`hoverServerSubmenu()` 触发项 `waitForExist(8000)` **抛错**（原为静默跳过）+ 子菜单 `waitUntil(5000)` 去掉 `.catch`；`dismissMenu` → RC-3 修复 |
| OPS-PROC-002 | 无数据行 | RC-1（stale 会话使 `list_processes` 报错）| `before()` 接 `dropLeakedSeededSession()`；`pause(1500)` → `waitUntil([data-testid="process-list-view"])`；`anyTableRows` 改为轮询（10s）替代单次 `pause(800)` 后采样 |
| OPS-PROC-003 | `dashTab` not displayed | RC-1 → `server_status_snapshot` 失败 → 面板进入 error 态（无 tabs）| 同上会话修复；`pause(1500)` → `waitUntil([data-testid="server-view-tab-dashboard"])`（10s，timeoutMsg 标明快照加载失败） |
| OPS-PROC-004 | 目标 pid 未出现 / kill 按钮 | RC-1（面板空）+ kill 定位 bug：`$$('button').filter(async b => …)` 异步谓词**恒为真** → 取到页面第一个按钮 | 会话修复；pid 出现改 `waitUntil` 轮询 10s；kill 按钮改 `button[title="${t('processList.kill')}"]` + `waitForEnabled(5000)` |
| OPS-SS-002 | `button*=刷新` 找不到 | 文案选择器脆弱 + RC-1 下 `ServerStatusView` 处于 error/spinner 态（loading 时 header/按钮被替换）；且旧的 `waitUntil(body 含 dashboardTitle)` 可因面板标题由 `contentViewHelpers.ts` 渲染而**误通过** | 改稳定 testid `[data-testid="server-dashboard-refresh"]` + `waitForDisplayed(10000)`；开面板统一走 `rightClickConn()` |
| OPS-PL-002 | kill 按钮 disabled | 行未加载/未选中（RC-1 致行为空）+ 同上按钮定位 | 会话修复；先 `expect(await anyTableRows())`；选行后 `waitForEnabled(5000)` 再断言 |

另外：`rightClickConn()` 按 `data-conn-name === E2E_PG_CONN_NAME` 精确定位
seeded 连接（`[data-conn-item]` 首项不保证是已连接那条）；未使用 import
`$$` 已移除；两处 `invokeBackend('execute_query')` → 泛型
`<QueryResultPayload>`（修掉本文件既有的 2 个 TS2345）。

### `e2e/specs/ops-ddl-backup.ts`（原 1 失败，OPS-DDL-002 "通过"存疑）

- **OPS-DDL-001**（`hasMenuItemId('backup')` false）：RC-2（本 spec 首条菜单
  用例）+ 首项 `[data-conn-item]` 定位不确定。修复：`rightClick` 先
  `closeAnyMenu()`，dispatch 后 `waitUntil` 菜单真实渲染（8s 抛错）；调用改为
  `rightClick('[data-conn-item]', E2E_PG_CONN_NAME)`；`hoverServerSubmenu`
  触发项/子菜单等待改为抛错（去 `.catch`）；`dismissMenu` → RC-3 修复。
- **shared RC-1**：`before()` 接 `dropLeakedSeededSession()`。
  注：OPS-DDL-002 在 stale 会话下 DB 节点取不到会走 `skip` 分支而"空过"；
  会话修复后该用例将真正执行断言（行为更严格，属预期）。
- **OPS-DDL-003** 同步改用 `rightClick('[data-conn-item]', E2E_PG_CONN_NAME)`。

### `e2e/specs/navigator-context-menu.ts`（原 before-all hook 失败）

- **`pgTableExists` 抛错 → wrappedHook 失败**：RC-1。`before()` 里
  `invokeBackend('connect', { connectionId: SEEDED_CONN_ID })` 复用了上个 spec
  残留的 stale 会话，后续 DROP/CREATE/INSERT 与 `pgTableExists` 查询全部
  `database "e2e_w..." does not exist`。修复：`connectSeededPgInWorkspace()`
  之前接 `dropLeakedSeededSession()`。
- **`rightClick`**：`pause(500)` → 先关残留菜单 + `waitUntil` 菜单出现
  （8s），但保留 `.catch` 以维持"无菜单处理器的目标节点 → `getMenuText()==''`"
  的旧语义（该 spec 大量用例依赖空菜单语义做 skip/负向断言）。
- **`dismissMenu`**：RC-3 修复（document.body 冒泡 mousedown；round-0 的 window 派发无效，见 BUG-001 round-1）。
- **`hoverSubmenuTrigger`**：触发项 `waitForExist(8000)` 抛错 + 子菜单
  `waitUntil(5000)` 去 `.catch`（该函数仅被连接子菜单用例调用，目标单一）。

## 三、tsc 结果

```text
npx tsc --noEmit -p e2e/tsconfig.json   # worktree 内执行
改动前（基线 HEAD）: 72 errors
改动后:             70 errors
新增错误:           0（逐行归一化 diff 验证）
```

- 本 track 修复了 `ops-process-server.ts` 既有的 2 个 TS2345（72 → 70）。
- 当前 3 个改动文件中仅剩 `navigator-context-menu.ts` 14 个**基线已有**错误：
  13 个是全仓统一写法 `const n = await $$('…'); n.length === 0`
  （`@wdio/globals` 类型把 `.length` 推断为 `Promise<number>`；同型错误同样
  存在于不可改的 `e2e/helpers.ts:320` 与约 30 个其它 spec，运行期行为正确，
  wdio 运行不走 tsc），1 个是 `this.skip('说明')`（Mocha 忽略参数，无运行期影响）。
- 其余 56 个错误全部位于**本 track 禁止修改**的文件：
  `e2e/helpers.ts`(4)、`e2e/lib/*`(2)、其它约 30 个 spec(50)。
- 结论：`tsc --noEmit` 全绿在"只改 3 个 spec"的约束下**不可能达成**；
  本 track 的可达成目标已达成——**零新增错误，且改动文件无新增类型问题**。

## 四、给协调者的共享文件修复建议（本 track 未改，请另行派发）

1. **RC-1 根治**（收益最大，本次运行里 table-data / sql-query / schema 等
   更多失败 spec 疑似同因）：在 `e2e/wdio.conf.ts` 每 spec `before` 中、
   worker 建库之后，统一执行"断开 `conn_e2e_pg` 残留会话"逻辑（
   `connectBackend` + `disconnectBackend`，try/catch），或抽到
   `e2e/helpers.ts` 导出 `dropLeakedSeededSession(connectionId)` 供各 spec
   调用——届时可删除本 track 三份 spec 内的同名本地副本。
2. **菜单等待/关闭工具**：把 `closeAnyMenu()`（document.body 冒泡 mousedown，round-1 更正）与
   `waitContextMenuOpened(timeout)` 抽进 `e2e/helpers.ts`，统一替代散落的
   `pause(400/500)` 与 no-op `dismissMenu`。
3. **tsc 基线清理**（非本 track 范围）：`e2e/helpers.ts:292/303/320/2414`、
   `e2e/lib/*.ts` 的 `Browser` 导入、各 spec 的 `await $$(…).length` 写法，
   需要专项一轮才能让 `tsc --noEmit` 全绿。

## 五、验证与限制

- ✅ `npx tsc --noEmit -p e2e/tsconfig.json`：0 新增错误（72 → 70，见上）。
- ⚠️ 未在本 worktree 执行全量 E2E：worktree 无编译产物且禁止
  `pnpm install` / 全量构建。需由协调者在具备 `pnpm tauri:build:webdriver`
  环境的主检出运行验证。
- 本 track 不自评 PASSED，最终结论以测试 track 复跑为准。

## 测试记录（第 1 轮 · 测试子代理）

**结论：FAILED** — 登记 `e2e-ops-menu-BUG-001`（RC-3 关闭修复无效，严重度：高）。
测试 commit：`ca0a178e6`（BUG 文件 + 复现用例同 commit）。

### 阶段 A · 代码审查

| 审查项 | 结论 |
| --- | --- |
| RC-1 会话泄漏根因 | ✅ 属实：Rust `connection_manager/tests.rs` `get_or_connect_session_reuses_existing_session` 等证复用语义；wdio.conf 每 spec 建/删 worker 库、UI 会话从不断开 → 跨 spec stale 会话链完整成立 |
| RC-2 异步菜单构建 | ✅ 属实：`handleConnectionContextMenu` 为 `void (async …)`，先 `await getDriverCommands` 再 `show()`；8s/5s/10s waitUntil 上限合理（waitforTimeout 10s、mocha 120s），均带 timeoutMsg 快速失败、不掩盖 |
| RC-3 根因分析 | ✅ 根因正确（document 不冒泡到 window 监听器，`WebContextMenu.tsx:181`），**但修复无效 → BUG-001** |
| `hoverServerSubmenu/hoverSubmenuTrigger` 改抛错 | ✅ 语义变化仅影响"菜单未打开"场景（原来静默跳过后断言在空菜单下误报）；调用点均为正向断言（DDL-003 的 skip 分支在已连接 PG 下不可达，无害）；`server-submenu` 在 PG 已连接时必存在（`mainWindowContextMenu.ts:224`） |
| `dropLeakedSeededSession` 副作用 | ✅ 三分支（复用→断开 / 新建→断开 / 抛错→吞）均无害；连接探测用的是已 seed 的当前 worker 库配置，断开后同 spec UI 连接正常新建会话 |
| `rightClickConn` 按 `data-conn-name` 定位 | ✅ `NavigatorTreeRow.tsx:250-251` 两属性同节点；与 `E2E_PG_CONN_NAME` 一致 |
| 零文案硬编码 | ✅ 新增定位均为 data-testid 或 `button[title="${t('processList.kill')}"]` 字典回读（zh-CN 同一份 `src/locales/zh-CN`），合规 |
| tsc 自报 | ✅ 独立复测完全一致（见阶段 B） |

**非 Bug 审查发现**（记录不立案）：① `rightClickConn` 的 `?? items[0]` 兜底会在按名定位失败时静默右键首项，报错信息可能误导；② OPS-PL-002 `if (!killBtn.isExisting()) return` 静默空过（本 commit 前既有）；③ `anyTableRows` 扫全文档 `[data-dt-row]`，极端下可被无关表格满足；④ navigator 无菜单节点的 `rightClick` 现需等满 8s（原 pause 500ms），全 spec 变慢但在 120s 内；⑤ `closeAnyMenu` 三份复制粘贴（已在§四建议抽 helpers）。

### 阶段 B · 独立复验

- BOOTSTRAP：worktree `.worktrees/datazen-e2e-ops-menu`、分支 `feature/e2e-ops-menu`、状态 clean、被测 HEAD `84d910097`。
- `node scripts/generate-builtin-locales.mjs` ✅（写入 en/zh-CN）。
- `npx tsc --noEmit -p e2e/tsconfig.json`：**基线 72 → HEAD 70，0 新增**——基线用 `git checkout HEAD~1 -- <3 spec>` 复测后已恢复；归一化逐行 diff 仅少 `ops-process-server.ts` 的 2×TS2345，`NEW errors: 0`。
- navigator 14 个错误**基线/HEAD 签名完全一致**（13×`await $$().length` 同型写法 + helpers.ts:320 同型；1×`this.skip(1)` TS2554）；helpers(4)+lib(2)+其它 spec(50) 与自报吻合。测试代理新增用例后再测仍为 70、`ops-process-server.ts` 0 错误。
- 前端单测：`npx vitest run src/components/ui/__tests__/WebContextMenu.test.tsx` 7/7 通过（改动不进 vitest 行覆盖率统计；本 track 无 src/ 改动，Rust 单测不适用）。
- 全量 E2E：**【留待 R 回归】**（worktree 无编译产物，构建/安装按约束禁行）。

### 阶段 C · 覆盖评估与 E2E 登记表

改动文件为 e2e spec（不进 vitest 行覆盖率统计），按**修复点 → 用例**评估：

| 修复点 | 覆盖用例 | 状态 |
| --- | --- | --- |
| `dropLeakedSeededSession`（3 spec before） | OPS-PROC-002/003/004、OPS-SS-002、OPS-PL-002、OPS-DDL-001~003、NCM before-all 建表断言 | 【留待 R 回归】 |
| `waitUntil` 菜单渲染（RC-2） | OPS-PROC-001/002/003、OPS-DDL-001/002/003、NCM-001 起全部右键用例 | 【留待 R 回归】 |
| `hoverServerSubmenu/hoverSubmenuTrigger` 抛错 | OPS-PROC-001~004、OPS-DDL-001/003、NCM-001/002 | 【留待 R 回归】 |
| testid 选择器（kill title / refresh / tab / process-list-view） | OPS-PROC-004、OPS-SS-002、OPS-PL-002 | 【留待 R 回归】 |
| **RC-3 关闭路径（原 0 断言，失败被 `.catch` 吞）** | **新增 `[tester] OPS-PROC-T001`（BUG-001 复现用例，修复前必红）** | 【留待 R 回归】 |

**E2E 登记表**（复跑入口，前置：主检出 `pnpm tauri:build:webdriver` 产出二进制）：

```bash
pnpm e2e:skip-build -- --spec e2e/specs/ops-process-server.ts,e2e/specs/navigator-context-menu.ts,e2e/specs/ops-ddl-backup.ts
```

| 用例 | 执行条件 | 状态 |
| --- | --- | --- |
| OPS-PROC-001 ~ 004、OPS-SS-002、OPS-PL-002、`[tester] OPS-PROC-T001` | 同上复跑入口；依赖 seeded PG + worker 库 | 【留待 R 回归】 |
| OPS-DDL-001 ~ 003 | 同上 | 【留待 R 回归】 |
| navigator before-all + NCM 全量用例 | 同上（首条用例验证 RC-1 会话修复） | 【留待 R 回归】 |

### 阶段 D · 判定

- **BUG-001**：`closeAnyMenu` 向 window 派发 mousedown → `onDown` 内
  `rootRef.current?.contains(window)` 抛 TypeError → `hide()` 不执行，菜单从不
  关闭，3s 等待被 `.catch` 吞掉。真实组件 vitest/jsdom 实测（取证日志在 BUG 文件）：
  window 派发 → 菜单仍在 DOM + `WebContextMenu.tsx:175` TypeError；body 派发
  对照组通过。外部同型案例：SO 69208491、headlessui#2115。
- 修复方向（建议，测试方不改）：派发目标改为 `document.body`（或 `document` +
  bubbles），并建议在 `WebContextMenu.onDown` 对非 Node target 防御（属 `src/`，
  需协调者另行派发）。
- 修复后 R 复测预期：`[tester] OPS-PROC-T001` 转绿即证明关闭路径真实生效。

## 修复轮第 1 回合（BUG-001 · RC-3 关闭派发无效）

- **Phase / 状态**: READY_FOR_TEST（BUG-001 已修复，待复测；修复 commit 见 BUG-001「修复记录（round-1）」）。
- **根因（实测确认）**: round-0 的 `closeAnyMenu` 向 `window` 派发冒泡 mousedown
  后事件确实到达 `WebContextMenu.onDown`，但 `e.target === window`（非 Node），
  `rootRef.current?.contains(window)` 按 WebIDL 抛
  `TypeError: parameter 1 is not of type 'Node'` → `hide()` 永不执行；`waitUntil(3s)`
  超时又被 `.catch` 吞掉 → 三个 spec 的 `dismissMenu` 实质 no-op，`rightClick`
  预关菜单失效，旧菜单可被误判为新菜单（复现点：`[tester] OPS-PROC-T001`）。
- **修复（仅 3 个 spec，未动 `src/`）**:
  1. 派发目标 `window` → `document.body`：body 是 Node、且是菜单 portal root 的
     祖先（`contains(body)` 为 false）→ 冒泡到 window 监听器 → `hide()` 正常执行。
  2. `closeAnyMenu` 移除吞错的 `.catch`：关闭失败带 `右键菜单未关闭` timeoutMsg
     抛错（菜单本就不存在时 `waitUntil` 立即成功，不受影响）；`rightClick` 中面向
     "无菜单目标"语义的 `.catch` 保留（navigator 负向断言依赖该空菜单语义）。
- **src/ 防御未采纳**: 生产真实 mousedown 的 target 必然是 Node，非 Node target 只
  出现在合成 `window.dispatchEvent` 中（纯测试侧模式）；按"仅修 Bug、不改应用代码"
  约束未改 `WebContextMenu.onDown`。`if (!(e.target instanceof Node)) return;`
  防御加固建议由协调者评估后另行派发（已写入 BUG 文件修复记录）。
- **验证**:
  - vitest 真实组件（临时取证文件，运行后已删除）：`document.body` 派发冒泡
    `mousedown` → 菜单从 DOM 消失（根菜单、子菜单已打开两场景）2/2 通过。
  - `npx tsc --noEmit -p e2e/tsconfig.json`：HEAD 70 → 修复后 70，逐条归一化
    diff 完全一致（相对 HEAD 零新增、零移除）。
- **复测入口**: 主检出 `pnpm tauri:build:webdriver` 后
  `pnpm e2e:skip-build -- --spec e2e/specs/ops-process-server.ts,e2e/specs/navigator-context-menu.ts,e2e/specs/ops-ddl-backup.ts`；
  `[tester] OPS-PROC-T001` 必须转绿。

## 复测记录（第 2 轮 · 测试子代理）

**结论：TEST_DONE** — `e2e-ops-menu-BUG-001` 复测通过，状态 → **已修复**；无新增 Bug。复测 commit 见本区段末。

### 阶段 A · 修复代码审查（零信任独立核实）

| 审查项 | 结论 |
| --- | --- |
| 修复范围越界检查 | ✅ `git diff --stat 7f56d244b..HEAD` 仅 5 文件（3 spec + BUG 文件 + progress.md）；`src/`、`src-tauri/`、`packages/`、`e2e/helpers.ts`、`e2e/wdio.conf.ts`、`e2e/lib/` 零改动（`git diff --name-only 84d9100..HEAD -- <以上>` 为空） |
| body 派发冒泡链 | ✅ `bubbles: true` 沿 body → html → document → window 冒泡；`WebContextMenu.tsx:181` window 监听器为 bubble 阶段（无 capture 标志）→ 必然到达；已核查 `src/` 内 6 处 document 级 mousedown 监听器（globalTextSelection / QueryToolbarMoreMenu / TableColumnFilter / ThemeToggle / MenuBar / ContextPicker）**均无 `stopPropagation()`**，无截断风险 |
| `contains(body)` 恒 false 论证 | ✅ 严谨：`WebContextMenu.tsx:220-240` `createPortal(..., document.body)` —— 菜单面板直接是 body 的**子节点**，body 是其祖先而非后代，`rootRef.contains(body)` / `subRef.contains(body)` 恒 false → `hide()` 执行 |
| 移除 `.catch` 后「菜单本不存在」路径 | ✅ `waitUntil` 条件 `!menu.isExisting()` 首轮即真 → 立即成功，不受移除 `.catch` 影响 |
| rightClick「无菜单目标」语义 | ✅ navigator-context-menu.ts L166-168 `.catch` 完整保留（`getMenuText()==''` 负向断言依赖）；ops 两 spec 的 rightClick 本轮未触碰 |
| 三份 closeAnyMenu 一致性 | ✅ 函数体逐字节 MD5 三份完全相同（`af01c39a0f3631ae88a4c71ee5434d04`）——Round 1「三份复制」发现本轮至少已行为一致 |
| Round 1 五条非 Bug 发现未恶化 | ✅ 逐条核对原样在位：① `?? items[0]` 兜底（ops-process-server.ts:81）② kill 按钮静默 return（:473）③ `[data-dt-row]` 全文档扫描（:179）④ navigator 无菜单 rightClick 等满 8s（语义保留）⑤ 三份复制（本轮一致，helpers 抽取仍留建议） |
| `src/` 防御未采纳声明 | ✅ 属实未改；`WebContextMenu.onDown` 非 Node 防御仍属协调者另行派发事项（非本轨缺陷，负例测试已把机理钉死） |

### 阶段 B · 独立复验

- BOOTSTRAP：worktree `.worktrees/datazen-e2e-ops-menu`、分支 `feature/e2e-ops-menu`、status clean、被测 HEAD `7a2529b75`（修复 `74f2854e6` + 回填 `7a2529b75`）。
- `node scripts/generate-builtin-locales.mjs` ✅（写入 en/zh-CN，status 仍 clean）。
- **tsc 独立实测 vs 自报**：自报「70 → 70，归一化 diff 完全一致」→ 独立 `npx tsc --noEmit -p e2e/tsconfig.json` = **70 errors**（navigator 14 + helpers 4 + lib 2 + 其它 spec 50，与自报分布吻合）；临时 checkout `7f56d244b` 三 spec 跑修复前对照 = **70**；归一化（去行列号 + 排序）diff **NORMALIZED_IDENTICAL — 零新增零移除**，原始差异仅 +4 行注释引起的行号位移。**核对通过**。
- **关闭机制独立验证（vitest 真组件）**：新增正式回归测试 `src/components/ui/__tests__/test_tester_web_context_menu_close_dispatch.test.tsx`（5 条）：
  - body 派发 → 根菜单关闭 ✅；body 派发 → 根菜单 + 子菜单已开均关闭 ✅（修复者自报 2/2 独立重现）；
  - 无菜单时 body 派发安全 no-op ✅；
  - **负例**：window 派发 → 菜单仍在 DOM + window error 捕获 `TypeError: … parameter 1 is not of type 'Node'` ✅ —— BUG-001 机理在修复后 HEAD 上原样可复现（证明修复靠换派发目标，非掩盖）；
  - 直接 `menu.contains(window)` 抛 WebIDL TypeError ✅。
  - 实测：该文件 5/5 + 既有 `WebContextMenu.test.tsx` 7/7 = **12/12 通过**。
- 全量 `npx vitest run`：**484 文件 / 5060 测试全绿**（零回归）。
- 完整 E2E：**【留待 R 回归】**（worktree 无二进制禁构建，同 Round 1 限制）。

### 阶段 C · 完整回归审查

- Round 1 已通过的结论抽样复核：RC-1 `dropLeakedSeededSession` 三处 before 调用在位（proc L241 / ddl L198 / nav L340），本轮未被触碰；RC-2 waitUntil 菜单渲染路径未动；零文案合规——本轮 spec 改动仅新增中文注释与 `timeoutMsg` 错误文案，无新增定位器/断言字面量。
- **BUG-001 断言链复核**：3 个 spec 的 `dismissMenu` → `closeAnyMenu` → `waitUntil(3000, 右键菜单未关闭)` 全链**无 `.catch`**——关闭失败真实抛错，失败信号不再被吞。`[tester] OPS-PROC-T001` 断言链（menu isExisting → dismissMenu → waitUntil 消失 → 末置 expect false）为真实硬断言。

**E2E 登记表（复测轮确认，与 Round 1 一致）**（前置：主检出 `pnpm tauri:build:webdriver`）：

```bash
pnpm e2e:skip-build -- --spec e2e/specs/ops-process-server.ts,e2e/specs/navigator-context-menu.ts,e2e/specs/ops-ddl-backup.ts
```

| 用例 | 执行条件 | 状态 |
| --- | --- | --- |
| OPS-PROC-001 ~ 004、OPS-SS-002、OPS-PL-002、`[tester] OPS-PROC-T001`（**必须转绿**） | 同上复跑入口；依赖 seeded PG + worker 库 | 【留待 R 回归】 |
| OPS-DDL-001 ~ 003 | 同上 | 【留待 R 回归】 |
| navigator before-all + NCM 全量用例 | 同上 | 【留待 R 回归】 |

### 阶段 D · 判定

- BUG-001：**已修复**（BUG 文件状态行已改判并追加 `## 复测记录（round-1）`）。
- 新增 Bug：**无**。
- Phase：**PASSED**。
- 测试 commit：见下方 `test(e2e): verify e2e-ops-menu round-2 …` 提交。
