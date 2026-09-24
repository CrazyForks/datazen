# Track: e2e-schema-tree — 9 个失败 E2E 用例修复

- **Phase**: READY_FOR_TEST
- **范围**: 仅 `e2e/helpers.ts`（本轨独占）与 9 个失败 spec；未改动 `src/`、`src-tauri/`、`packages/`、`e2e/wdio.conf.ts`
- **验证方式**: `npx tsc --noEmit -p e2e/tsconfig.json` + 逻辑评审（worktree 无 webdriver 编译产物，未实际跑 E2E；由协调者合并后复跑）

## 统一根因（跨用例）

1. **陈旧后端会话（分裂脑）** — 整个 E2E 运行复用同一个 Tauri 进程与后端 ConnectionManager，而 `wdio.conf.ts` 在每个 spec 文件前替换 `conn_e2e_pg` 背后的 worker 库（新 `e2e_w<pid>_<seq>_<rand>`）。后端 `connect` 具有复用语义（`connection.rs` 单测 "reuse must hand back the same db session id"）：早先 spec 创建、仍存活的会话被原样交回，仍绑定已被 drop/替换的旧库。于是原始 SQL DDL 落在陈旧 home 库上，而 schema 元数据（`get_tables database=...`）打到新 worker 库 —— navigator 永远看不到新建的表：`waitForTableInSidebar` / `waitForSchemaTreeLoaded` 20s 超时；object-filter 的 CREATE 被 `executeSQL` 吞错后 `visibleTableNames()` 返回 `[]`。
   日志证据：共享会话 `b9b84866…` 09:42:20 创建、10:03:30 仍被复用服务 #0-38→#0-43；`get_table_schema` 报 `Table 'e2e_batch_ops_test' does not exist in the current database 'e2e_w25224_0_t1ql'`；object-filter 会话 home 为已死库 `e2e_w22915_0_h9pi`。
2. **一次性读取 / 固定 pause 断言** — 虚拟化 + 异步加载的 schema 树在固定 pause 后单次读取偶发空集（`received []`），DDL 与刷新之间无条件轮询。
3. **app-settings 级过滤器跨文件污染** — object-filter 保存的 include 过滤 `e2e_*` 持久化（`cleanupAppDataViaIpc` 不重置 settings）；模式 `e2e_*` 不匹配兄弟 spec 的 `_e2e_*` 表（前导下划线），失败残留会把后续 table-* spec 的表全部隐藏出树。

## 逐 spec 根因与修复手法

| Spec | 缺陷类型 | 修复手法 |
| --- | --- | --- |
| table-structure | 前置 DROP/CREATE 经 `executeSQL` 静默失败（陈旧会话），失败在 20s 树等待才暴露 | before-hook DDL 改 `executeSQLChecked` 快速失败、透传后端真实报错；after-hook 清理保持容错 `executeSQL` |
| table-filter | 同上（DROP+CREATE+INSERT 三段静默失败） | before-hook 三段全部 `executeSQLChecked`；TS2362：`valueInputs.length` 改 `await valueInputs.length` 先取数 |
| table-indexes | 同上（DROP+CREATE 静默失败） | before-hook `executeSQLChecked` |
| table-data | 同上（含 `generate_series` INSERT 静默失败） | before-hook 三段 `executeSQLChecked`；用例内逻辑不动 |
| table-edit | 同上（DROP+CREATE+INSERT）；另有预存 TS2362 | before-hook `executeSQLChecked`；`previewButtons.length` 改先 `await` 取 count |
| table-batch-ops | 同上：before-hook 声称"闭环门"但 `executeSQL` 吞错，DDL 实际可能未落地 | DROP/CREATE/INSERT 全部 `executeSQLChecked`，闭环断言变真；树等待由强化后的 helper 覆盖 |
| schema-tree-completeness | TC-TREE-006：CREATE 吞错 + 固定 pause 后一次性 body 扫描；TC-TREE-003：wdio `expect` 字符串 matcher 折叠为 `never` | CREATE 改 `executeSQLChecked`；标题扫描改 `clickNavigatorRefresh` + 重展开连接/Tables + `browser.waitUntil` 条件轮询 20s；TC-TREE-003 改纯 `if (!tableName) throw` 守卫；TC-TREE-001 受益于强化的 `waitForSchemaTreeLoaded` |
| sqlite | 首个用例在连接后一次性读 aside 文本，与 navigator 首次异步取表竞态 | 改单个 `browser.waitUntil`（20s/1s），每轮 try/catch 内重新取 aside 再断言 schema 分区 + users/posts/tags；其余用例未动 |
| object-filter | ① before-hook DDL 吞错 → 003 断言 `[]`；② OPS-FILTER-003/005 固定 pause 后一次性 `visibleTableNames()`（虚拟化树异步）；③ include 过滤残留污染兄弟 spec | ① before DDL 改 `executeSQLChecked` + 关环门：刷新后 `waitForTableInSidebar` ×3 确认建表可见再进用例；② 新增 `waitVisibleTableNames(predicate)` 条件轮询（超时附带最后一次可见节点便于诊断）；③ after-hook 拆两个独立 try：先无条件清空 include 过滤，再独立执行 DROP 清理 |

## helper 影响面评估（本轨独占 `e2e/helpers.ts`）

1. **`connectSeededPgInWorkspace` / `openSeededPgConnectionWindow` → 新增内部 `ensureSeededPgSessionFresh()`**
   - 机制：`get_connections` 读 `conn_e2e_pg` 最新配置 → `connect` 复用现有会话 → 探测 `SELECT current_database()` 与配置 `database` 比对。一致（健康）→ 直接返回，代价 ≈2 次 IPC，**零 UI 改动**；不一致/会话已死 → `disconnectBackend` + `browser.url('tauri://localhost')` 重载 + pause，令随后的 UI 连接发起真正绑定当前配置的新 `connect`；整体 try/catch，探针失败只 warn 不阻塞。
   - 调用方：`connectSeededPgInWorkspace` 约 34 处 spec 调用（object-filter/hotkeys/ui-window-ops/client-parity/unified-tab-bar 等）+ 内部 `openConnectionWindow`/`openSeededPgConnectionWindow`；`openSeededPgConnectionWindow` 原先"工具栏已存在即跳过 connect"正是陈旧漏洞，现统一先跑探针。所有调用方的契约都是"确保种子 PG 已连接且指向当前 worker 库"——健康路径行为逐字节不变，陈旧路径的重连正是契约所求，故全部调用方兼容。
2. **`waitForSchemaTreeLoaded(timeout = 20000)`** — 签名不变；waitUntil 每轮 try/catch（瞬时异常 → false 不再炸整轮）；仅当连续失败到第 3 个轮询周期（即树中一个表节点都没有、恰为今日失败态）才补一次 navigator 刷新 + 重展开。健康首查路径不变。外部调用 7 处（schema-tree-completeness、navigator-context-menu、unified-tab-bar、connection-window、export-import、journeys/connection-browse、ai-context-tables）+ 内部链（waitForTableInSidebar、clickTableInSidebar、clickFirstTable）——各调用方都处于"树尚未就绪"的等待中，注入刷新只可能缩短等待。
3. **`waitForTableInSidebar(tableName, timeout = 20000, schemaName?)`** — 签名不变；同样 try/catch + 每第 3 个失败轮补一次刷新（表确实缺席时才触发）。外部 6 处 table-* spec + 内部链，同上兼容。
4. **类型卫生（运行时零行为变化，共清 13 个预存 tsc 错误）**：`connectionNavigatorAside` 返回类型归一为 `Promise<ChainablePromiseElement>`（消除 `CPE | Element` 联合类型，运行时返回值不变，仅 3 处 `as unknown as` 类型断言；顺带清掉 mysql.ts 的 3 个 TS2684）；`expandConnectedConnectionInNavigator` 回调参数放宽为 `string | undefined`；`connectSeededPgInWorkspace` 长度判断改 `await $$().length`（仓库既有可编译写法）；`deploySchemaDiffPlan` 错误元素探测改 try/catch（语义等价）。

## tsc 结果

命令：`npx tsc --noEmit -p e2e/tsconfig.json`（tsc 5.9.3）

| | 错误数 | 本轨文件（helpers + 9 spec） |
| --- | --- | --- |
| 基线（stash 全部改动后，分支 HEAD 6fb1571f7） | **72**（32 个文件） | 13 |
| 修复后 | **59** | **0** |

- **新增错误：0**（逐文件逐错误码 diff 仅含删除项）；清除 13 个：helpers×4、schema-tree-completeness×1、sqlite×2、table-edit/table-filter/table-structure 各 1，以及顺带修复的 mysql.ts×3（同一联合类型根因）。
- **剩余 59 个为分支基线预存错误**，全部位于本轨修改权限之外的文件：`e2e/lib/screenshotTrace.ts`、`e2e/lib/testDataLifecycle.ts`（各 1）与其他轨道的 27 个 spec（navigator-context-menu×14、ai-context-tables×6、connection-window×3、drag-drop-groups×3、homepage-features×4、main-window×3、multi-database×3、workflow-window×2、i18n-10-locales×2、ops-process-server×2、data-dashboard-*×6、system-locale/ui-window-ops/chart-views 等各 1-2），均为同一 wdio 类型漂移（`Promise<number>` 长度比较、`Browser` 类型导入等）。修复它们需改动 29 个非本轨文件，存在跨轨冲突风险，**超出本轨授权范围**，已上报协调者另行调度类型清理轨。
