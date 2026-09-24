# Track: e2e-ops-menu — E2E 运维菜单用例修复

- **状态**: READY_FOR_TEST（已通过 `npx tsc --noEmit -p e2e/tsconfig.json` 增量校验；受环境限制未在本 worktree 跑全量 E2E）
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

**spec 内修复**：`closeAnyMenu()` 改为
`window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`
并 `waitUntil` 菜单真正消失（3s，容忍失败）。

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
- **`dismissMenu`**：RC-3 修复（window 冒泡 mousedown）。
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
2. **菜单等待/关闭工具**：把 `closeAnyMenu()`（window 冒泡 mousedown）与
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
