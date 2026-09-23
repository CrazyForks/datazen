- 任务: KV 上下文条全量版（PRD §3.4 / 裁定 8-2 = 全量，#69）+ **合并承担 statusBar 全量版**（协调者追加裁定）
- 状态: READY_FOR_TEST
- 编码 commit: `fdc46cd74`（① contextBar 全量版 + 裁定 (A) 契约扩展与宿主接线）+ `edc7ee051`（② statusBar 全量版）
- 测试 commit: 随两个编码 commit（同 commit 内交付，无独立测试 commit）
- 合并 commit: —
- 代理: w4-redis-kv-context-bar-coder
- Worktree: .worktrees/datazen-redis-kv-context-bar
- 分支: feature/redis-kv-context-bar
- 基线: `d049ceb4e`
- 心跳: 2026-09-23 16:54（两单元已 commit，四门全绿，返回 `READY_FOR_TEST`）

# W4 `redis-kv-context-bar` 简报理解（逐条回执）

## 1. 交付物与我的理解

| 简报要求 | 我的处置 |
|---|---|
| ① `kv-bar/RedisContextBar.tsx`：左→右六项，每项 `data-testid` | 已交付；六项各有独立 `data-testid` + `data-part`（`RedisContextBar.tsx` 236 行；右侧控件簇抽到 `ContextBarActions.tsx` 255 行以守住「组件 ≤250 行」） |
| `db 选择器 ▾`（列表来自 `db_sizes` 或 `maxDatabaseIndex`） | 已交付，**取并集**（见 §3「数据来源」）；切换走裁定 (A) 的 `request({type:'selectDatabase'})` |
| `52 keys` | 已交付；`db_sizes` 取该 db 行，取不到**不渲染**（不是 0/—） |
| `used 1.2 MB / max 0`，max=0 须显示「无上限」语义 | 已交付；`deriveMemoryReadout` 把 `maxmemory <= 0` 归为 `maxBytes: null`，渲染走独立词条 `redis.contextBar.memoryUnlimited`，`data-max-bytes="unlimited"` |
| 类型分布 chips（`type_distribution`） | 已交付；排序（count 降序、同名升序）在纯模型里 |
| 采样硬约束：`sampled < dbsize` ⇒ 组尾强制标注；`>=` 可不标；失败整组不渲染 | 已交付；**判定由 `sampled`/`dbsize` 重算，不信线上的 `truncated` 布尔**（§3.4 的规则原文就是这条比较） |
| 扫描状态（`getScanBudgetUsed/Total`、`isScanning`）；`Total === 0` ⇒ 只显示已用或不显示 | 已交付；`Total === 0` ⇒ 只显示已用（`redis.contextBar.scanUsed`），**不画进度条**（无分母的分数就是 §3.4 禁止的那类编造）；注释写明 |
| 右侧：SafeMode 徽标 + 刷新 + `+` + 导入导出 + `⋯`（FLUSH/监控/驱动设置/预算档位） | 已交付；`SafeModeBadge` 复用既有组件，预算档位 10k/50k/200k/1M |
| 响应式 I-10：`compact` 先丢文字标签再进溢出菜单 | 已交付，分级见 `contextBarModel.contextBarLayout` / `partInBand` 与 `COMPACT_OVERFLOW_PARTS` |
| 反向动作 F-3：每个可点元素走 `request(action)` | 已交付；8 条原有 action 全部有覆盖，`flushDb` **不自弹确认框**（宿主过门闸） |
| 组件薄逻辑厚 + co-located 单测 | 已交付：`contextBarModel.ts`（315 行纯函数，无 React/i18n 文案）、`useContextBarData.ts`（184 行取数）、`dbKeyCounts.ts`（121 行） |
| ② `kv-bar/index.ts` 导出、`shared/meta.ts` 加进**现有** `kvWorkspace` 对象、`resolve-drivers.mjs` 加 kvSlots 行 | 已交付三处；`meta.ts` 是**往同一对象里加键**，未新建同名键 |
| ③ 测试 `__tests__/redisContextBar.test.tsx` 覆盖清单 | 已交付 47 例；逐条对照见 §6 |

## 2. 简报纪律回执（硬性禁项）

- 未改宿主 `src/**` 的生产逻辑，除**协调者裁定 (A) 明确授权**的三个文件：
  `packages/driver-sdk/src/types/kv-slots.ts`（仅加一个 `KvSlotAction` 变体）、
  `src/windows/connection/useKvSlotActions.ts`、`src/windows/connection/ContentView.tsx`、
  `src/windows/connection/ConnectionPage.tsx`（一线传参）。`src/lib/kvSlotState.ts` **零改动**。
- 未改 `key-browser/**`、未改其他驱动 UI、未改 `kv-bar/**` 之外的驱动代码。
- 未改/未提交 `hub.md`、他轨 `tracks/<other>/**`、codegen、`Cargo.lock`、注入过的 `Cargo.toml`。
- `git add` 全程显式路径，未用 `git add -A`。
- i18n 只改 `packages/drivers/redis/locales/en.ts`；测试零英文字面量断言（`t()` 被 mock 成回显 key + 参数）。
- 生产路径无裸 `unwrap()/expect()`；无无理由 `!` 断言；单文件最大 315 行（≤800）。
- 重型命令（vitest / vite build）串行执行，未并发。

## 3. `type_distribution` 与 `db_sizes` 的数据来源说明（简报点名）

### `type_distribution`（chips 唯一数据源）

- **命令**：`execute_driver_command` → `redis` / `type_distribution`，入参 `{ dbSessionId, dbIndex }`
  （`sampleLimit` 省略 ⇒ 后端默认 `DEFAULT_TYPE_SAMPLE_LIMIT = 1000`；cluster 连接后端自行收紧到 200）。
- **后端实现**：`packages/drivers/redis/src/ops_workbench.rs::type_distribution` ——
  `DBSIZE` 读一次 + `SCAN` 填充采样窗口（`COUNT 500`）+ `TYPE` 分块 pipeline
  （standalone/sentinel 每 500 键一次往返；cluster 每键一次且全部寻址到
  `CLUSTER_SCAN_ANCHOR` 钉住的同一分片）。**从不发 `KEYS`**。
- **返回形状**（`TypeDistribution`，`serde(rename_all="camelCase")`）：
  `{ counts: {string:30, hash:12, …}, sampled: 1000, dbsize: 52, truncated: bool }`。
  不变量：`sampled === sum(counts.values())`（`TypeDistribution::from_sample` 维持）。
- **前端消费**：`useContextBarData` 把整包交给 `contextBarModel.deriveTypeChips`。
  我的判定**重新计算** `sampled < dbsize` 而不读 `truncated`：两者在健康服务器上恒等，
  但 §3.4 的规则原文是那条比较，重算可让 payload 里两个位（§6 要求「必须带 sampled 与 dbsize 两个位」）
  成为唯一真源，`truncated` 位退化为冗余校验。
- **cluster 语义**（后端模块文档明写，前端照实标注）：`sampled` 来自**一个分片**，
  `dbsize` 是 `Aggregate(Sum)` 全集群 ⇒ 集群上 `truncated` 几乎恒为 `true`，
  于是「采样 N/M」标注在集群上**总是显示** —— 这是刻意的诚实，不是缺陷。

### `db_sizes`（键数 + db 选择器列表）

- **命令**：`redis` / `db_sizes`，入参仅 `{ dbSessionId }`（无 `dbIndex`）。
- **返回**：`Array<{ db: number, keys: number }>`，每个逻辑库一行（后端 `SELECT` + `DBSIZE` 逐库）。
- **两个消费点**：
  1. `52 keys`（contextBar 与 statusBar 都要）——取 `db === dbIndex` 那一行；
     不在返回里 / 命令失败 / 形状不对 ⇒ `null` ⇒ **不渲染该段**。
  2. db 选择器列表——`deriveDbOptions(dbSizes, maxDatabaseIndex)` 取
     **声明窗口 `db0…db{maxDatabaseIndex}`（= `redisMeta.maxDatabaseIndex`，15）∪ 服务端回报的 db 行**
     的并集。取并集而非二选一：两个来源独立失败且含义不同（窗口是驱动声明、恒可用；
     `db_sizes` 是服务端真相，ACL 禁 `DBSIZE` 时为空，重配过的服务器可能有窗口外的库），
     丢掉任一方都会静默隐藏用户可达的库。
- **一次读取，两个槽位**（`dbKeyCounts.sharedDbSizes`）：contextBar 与 statusBar 在不同 React 子树、
  无共同父节点，若不合并则各自为 `db_sizes` 付一次费 —— 该命令是**逐库 `SELECT`+`DBSIZE`**，
  16 库即 32 次往返，每次切 db 翻倍。合并表按**面板中继对象弱引用**分组
  （`getKvSlotState(panelId)` 就是这些槽位的面板身份），值只存**未 settle 的 promise**、
  settle 即删 —— 是 in-flight 合并而非缓存（缓存会被 F-2 的「不得起驱动侧缓存层」禁止）。
  这是 `redis-kvbar-ui-BUG-002`（键读取合流）的同一条规则套到第二条命令上。

### `info_filtered`（`used / max`）

- 命令 `redis` / `info_filtered`，入参 `{ dbSessionId, section: 'memory' }`（与
  `keyObjectInfo.invokeMaxmemoryPolicy` 同一个命令、同一种用法）。
- 用 `info_filtered` 而非 `info`：字段集相同（就是该 section 解析后的 INFO），
  payload 小得多，且面板不必多出第二种 INFO 风味。

## 4. 裁定 (A) 的落地：db 选择器为什么走 action 通道而不是 `KvSlotState`

### 证据链（**已用绝对路径在本 worktree 基线 `d049ceb4e` 重核**，协调者提醒后重跑）

> 协调者提醒：`read`/`grep`/`glob` 传相对路径时解析基准是主检出。以下四条均以
> `cd <worktree 绝对路径> && grep -n` 复核，落在本基线而非 `main`：

| # | 事实 | 复核命令与结果 |
|---|---|---|
| 1 | F-3 的 8 个 action 确无 db 切换 | `packages/driver-sdk/src/types/kv-slots.ts` 联合类型 8 个成员，无 `selectDatabase` |
| 2 | 宿主 dispatcher 只接线 2 条 | `useKvSlotActions.ts:42` `WIRED_ACTIONS = ['refresh','openSettings']` |
| 3 | `database` 是槽位**入参**，槽位无法反写 | `useKvWorkspaceSlots.ts` 的 `panelSlotProps.database = database`（来自 `ContentView` 的 `statusDatabase`） |
| 4 | **能力已在、未接线** | `ConnectionPage.tsx:360 const handleSelectKvDb = useCallback(...)` / `:696 onSelectKvDb={handleSelectKvDb}` —— 只传给导航树 |

⇒ 不是「缺能力」，是「能力已在、未接线」。裁定 (A) + 复用同一实现成立。

### 契约扩展逐字（`packages/driver-sdk/src/types/kv-slots.ts`，仅新增一个变体）

```ts
export type KvSlotAction =
  | { type: 'refresh' }
  | { type: 'newKey' }
  | { type: 'import' }
  | { type: 'export' }
  | { type: 'flushDb' }
  | { type: 'openMonitor' }
  | { type: 'openSettings' }
  | { type: 'setScanBudget'; value: number }
  /**
   * Ask the host to make `database` the panel's database — "switch the db
   * selector" in PRD §3.4 terms.
   * …（完整 JSDoc 见源码；说明它请求宿主把该 db 的 KV 面板置为活动面板，
   *   与 setScanBudget 同类：宿主今天可能不处理，但槽位不得因此藏掉控件）
   */
  | { type: 'selectDatabase'; database: string };
```

**既有 8 个成员零改名零删除**；`KvSlotState`（F-1 冻结形状）**一字未动**。

### 宿主接线点

| 落点 | 改动 |
|---|---|
| `useKvSlotActions.ts` | `WIRED_ACTIONS` 加入 `'selectDatabase'`；`UseKvSlotActionsArgs` 新增可选 `onSelectDatabase?: (database: string) => void`；`switch` 新增 `case 'selectDatabase'`（有 sink ⇒ 转发；无 sink ⇒ 走既有 `warnUnwired`）。`latest` ref 扩展为 `{ t, onRefresh, onSelectDatabase }`，`request` 身份**仍然稳定** |
| `ContentView.tsx` | 新增 prop `onSelectKvDb?: (connectionId, dbName) => void`；`useMemo` 把 `(database) => onSelectKvDb(connectionId, database)` 交给 dispatcher 的 `onSelectDatabase`（`connectionId` 由本层 `useConnectionWorkspaceMeta` 解析 —— 只有面板知道连接）；**未传回调时 `undefined`**，使 dispatcher 的 no-op+warn 降级路径保持可达（不是空壳 wrapper） |
| `ConnectionPage.tsx` | 把**已有的** `handleSelectKvDb` 作 `onSelectKvDb` 传给 `ContentView`（原来只给导航树）。零新增实现 |

### 为什么走 action 通道而非加进 `KvSlotState`（分层理由）

1. **可订阅状态 vs 一次性请求**：中继（`KvSlotState`）装的是「面板此刻是什么」这类可被多个槽位
   订阅、且必须稳定快照的标量（F-2.1 为此禁止返回对象）。db 切换是**一次性意图**，没有可观测回值，
   塞进中继等于把一个动作伪装成状态。
2. **F-3 原文已经给出这条分界**：`flushDb` / `openMonitor` / `setScanBudget` 都是动作而非状态，
   `selectDatabase` 与它们同构，天然属于 `request`。
3. **避免「谁来回答」的歧义**：若做成状态，两个槽位同时要求不同 db 时语义不明；
   做成请求则由宿主 dispatcher 单点裁决（F-3 ruling：唯一 dispatcher）。
4. **`request` 身份稳定**：它坐在被 memo 的槽位 props 包里，本轨扩了 `latest` ref 而未破坏该性质
   （新增用例 `reaches the newest sink through the frozen request identity` 钉住）。

### 三条既有裁定的遵守

- **(a) 未接线 = no-op + warn，禁止抛错，禁止藏控件**：`selectDatabase` 现在已接线，但
  `onSelectDatabase` 缺失时仍走 `warnUnwired`；driver 侧 8 个动作的控件**全部照常渲染**
  （用例 `keeps every control rendered even though the host may handle none of them`）。
- **(b) `flushDb` 过宿主写门闸**：driver 侧只发 `request({type:'flushDb'})`，**零确认框**
  （用例 `routes the dangerous flush through request alone — no driver-side confirm`）。
- **(c) `request` 身份稳定**：见上。

## 5. 变异反证（每条硬约束都做了「改坏 ⇒ 变红」）

| # | 变异（把规则改坏） | 期望 | 实测 |
|---|---|---|---|
| 1 | `deriveTypeChips` 恒返回 `sample`（全量库也标注） | 红 | **3 failed / 47** |
| 2 | `deriveMemoryReadout` 把 `maxmemory 0` 回落成 `maxBytes: 0` | 红 | **2 failed / 47** |
| 3 | chips 为空时 `push({type:'string',count:0})`（渲染 0 分布） | 红 | **2 failed / 47** |
| 4 | `stopped` / `done` 去掉 `usedCount > 0` 项 | — | **0 failed（等价变异体）** ⇒ 判为死代码，当场删除冗余项；真实承重项（早退分支）改坏后 **5 failed** |
| 5 | `scanStateOf` 改成「游标单独决定」（W3-A 之前的读法） | 红 | **3 failed / 23** |
| 6 | `sharedDbSizes` 去掉 in-flight 合并 | 红 | **1 failed / 23** |
| 7 | `ConnectionPage` 删掉给 `ContentView` 的 `onSelectKvDb` 绑定 | 红 | **1 failed / 7** |

变异全部用 `cp` 备份 → `perl -0pi -e` 就地改 → 跑测 → `cp` 还原 → 复跑确认绿；
收尾 `git status` 已核对无残留（见 §8）。

## 6. 测试覆盖对照（简报 ③ 清单逐条）

新文件 `packages/drivers/redis/ui/__tests__/redisContextBar.test.tsx`（47 例）
与 `kvStatusBarFull.test.tsx`（23 例）。

| 简报要求 | 落点 |
|---|---|
| 六项字段各自渲染（`data-testid` + 数字，零英文文案） | `renders db, keys, memory, chips and scan as separate identified parts`（逐项断言 `data-*` 与服务器数值） |
| 采样三态：`<` 显示 / `>=` 不显示 / 失败整组不渲染（反断言不出现 0 分布） | `shows the mandatory annotation…` / `omits the annotation for a full census` / `renders no chips at all when the read fails — and no zeros either`（含 `not.toContain('string 0')` 与 `[data-type]` 计数为 0）+ `treats an empty counts map as no chips rather than zero chips` |
| `maxmemory=0` 显示无上限语义（不是 `0`） | `says "no limit" instead of printing max 0`（`data-max-bytes="unlimited"` + `data-i18n-key` + 反断言 `not.toContain('max 0')`） |
| `compact=true` 降级（文字标签消失、图标仍在） | `drops the button labels first while the icons stay`（`data-labelled` true→false，`textContent` 变空，`svg` 仍在）+ `moves the decorations into the overflow menu rather than losing them` + `never drops the scan cluster…` |
| 每个 action 点击后 `request` 收到正确 payload（spy props） | 5 例：四按钮裸标签 / `selectDatabase` / 三条溢出项 / 四档预算值 / flush 只发请求 |
| `request` 未接线不抛错 | `does not throw when the host ignores the action (unwired is a no-op)`（连点 8 个控件 + 一次 `change`，逐个 `not.toThrow()`） |
| 空态：无 db / 无键数 / `scanBudgetTotal=0` 各不崩 | `renders without a resolved db or any server reply` / `renders without a key count when db_sizes does not cover this db` / `shows used only — no bar — when the ceiling is unknown` |
| 扫描预算进度：`used/total` 与 `isScanning` 组合的渲染分支 | 5 例（fresh idle / 未知上限 / scanning 有比例与四格条 / `cursor='0'` 且未扫描 / 活体 relay 跃迁） |
| （追加）statusBar 六段各自渲染 | `renders db, keys, loaded, cursor, selection and last write together` |
| （追加）`cursor==='0'` 与 `loaded===0` 成对判据 | `scanStateOf` 四态 4 例 + 活体跃迁 1 例（`data-scan-state` 断言） |
| （追加）各字段初值不渲染分支 | `renders loaded 0 … but no selection and no write` / `drops the write segment for a fresh panel whose write is null` / `omits the key count when db_sizes fails` 等 7 例 |
| （追加）`lastWriteCommand=null` 时该段消失 | 同上两例 |
| （追加）既有 `KvStatusBar` 测试全绿 | 63 files / 874 tests 全绿（含 `kvBarSlots` / `kvBarRound1/2/3` / `kvBarSlotTesterGaps`） |

**驱动 + 宿主两侧都有跨边界一致性测试**（裁定 ④ 硬要求）：

- 宿主 `src/windows/connection/__tests__/ContentViewKvDbSwitch.test.tsx`（7 例）：
  spy 断言 `ContentView` 把 `(connectionId, db)` 转发给宿主回调；未传回调 ⇒ `undefined`；
  sink 身份跨 rerender 稳定 / 换回调时重绑。
- **「只存在一个开面板入口」的结构断言**（因为重复实现会照样通过一切 spy 测试）：
  `ContentView.tsx` 不含 `addPanel` / `nextPanelId` / `dbName ===`；
  `ConnectionPage.tsx` 含 `handleSelectKvDb` 定义与 `addPanel(panel)`，
  且 `onSelectKvDb={handleSelectKvDb}` **恰好出现 2 次**（导航树 + ContentView）；
  `ContentView.tsx` 不含 `databaseType === 'redis'` 或 `type: 'redis-db'`（PRD §7-4）。
- driver 侧：`sends the db selector choice as selectDatabase with the chosen db`。

## 7. 四门实测（尾部逐字）

> 全部在 worktree 根目录、串行单跑。

### 门 1 `npx tsc --noEmit`

```
（0 行输出）
exit=0
```

### 门 2 `npx vitest run --config vitest.drivers.config.ts`

```
 Test Files  63 passed (63)
      Tests  874 passed (874)
   Start at  16:54:02
   Duration  12.33s (transform 5.58s, setup 24.75s, import 5.04s, tests 12.41s, environment 34.48s)
```

基线实测（`git stash -u` 后同命令）：`Test Files 61 passed (61)` / `Tests 804 passed (804)`
⇒ **只增：+2 files / +70 tests，0 红**。

### 门 3 `npx vite build`

```
✓ built in 4.78s
vite exit=0
```

### 门 4 `node scripts/check-driver-import-boundaries.mjs`

```
[check-driver-import-boundaries] ok (1507 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
```

4 条 advisory 与基线逐条相同（`src/locales/locales.test.ts:107`、`src/test/driverUiSetup.ts:25`、
`src/test/driverUiSetup.ts:26`、`src/windows/connection/DocumentConnectionView.tsx:25`），均为既有 R3，
非本轨引入。files 数 1499 → 1507（本轨新增 6 个源文件 + 2 个测试文件）。

### 门 6（额外自加，因本轨改了宿主 `src/windows/connection/**`）`npx vitest run`

```
 Test Files  454 passed (454)
      Tests  4744 passed (4744)
   Duration  86.02s
```

宿主基线（W3-A 台账 Tester 轮实测）`453 files / 4734 tests` ⇒ 本轨 **+1 file / +10 tests**
（新文件 `ContentViewKvDbSwitch.test.tsx` 7 例 + `useKvSlotActions.test.tsx` +3 例），**0 红**。
本轨改的三个宿主文件所属的 8 个相关套件定向先跑亦为 `8 files / 79 tests` 全绿。

### 门 5 `node scripts/resolve-drivers.mjs --codegen-only --drivers=basic`

```
[resolve-drivers] codegen-only: wrote generated.ts / driver_init.rs
exit=0
```

产物抽查（**未提交**，gitignored）：

```
src/extensions/generated.ts:15  import { RedisContextBar, RedisKvStatusBar, RedisKeyPropsSidebar } from '../../packages/drivers/redis/ui/kv-bar';
src/extensions/generated.ts:195 { dbType: 'redis', slot: 'contextBar', component: RedisContextBar },
```

## 8. 变更面与纪律自查

- 本轨两 commit 的文件清单：

| commit | 文件 |
|---|---|
| `fdc46cd74` | `packages/driver-sdk/src/types/kv-slots.ts`、`packages/drivers/redis/locales/en.ts`、`packages/drivers/redis/ui/shared/meta.ts`、`packages/drivers/redis/ui/kv-bar/{index.ts,useKvSelection.ts,RedisContextBar.tsx,ContextBarActions.tsx,contextBarModel.ts,useContextBarData.ts}`、`packages/drivers/redis/ui/__tests__/{redisContextBar.test.tsx,kvSlotRegistration.test.ts}`、`scripts/resolve-drivers.mjs`、`src/windows/connection/{useKvSlotActions.ts,ContentView.tsx,ConnectionPage.tsx}`、`src/windows/connection/__tests__/{useKvSlotActions.test.tsx,ContentViewKvDbSwitch.test.tsx}` |
| `edc7ee051` | `packages/drivers/redis/locales/en.ts`、`packages/drivers/redis/ui/kv-bar/{KvStatusBar.tsx,dbKeyCounts.ts,useKvSelection.ts,useContextBarData.ts,RedisContextBar.tsx}`、`packages/drivers/redis/ui/__tests__/{kvStatusBarFull.test.tsx,redisContextBar.test.tsx,kvBarSlots.test.tsx,kvBarRound1Fixes.test.tsx,kvBarRound2Fixes.test.tsx,kvBarRound2Tester.test.tsx,kvBarRound3Tester.test.tsx,kvBarSlotTesterGaps.test.tsx}` |

- `git status --porcelain` 收尾：**空**（仅本台账目录 `docs/development/coordination/tracks/redis-kv-context-bar/`
  为未跟踪新目录，随本次台账 commit 一并提交）。门 5 生成的 codegen
  （`src/extensions/generated.ts` / `src-tauri/src/driver_init.rs` / `.driver-features.json` /
  `src-tauri/capabilities/default.json`）**被 gitignore**，因此不出现于 `--porcelain`；
  已另行确认它们**不在任何 commit 的变更面里**（`git log --name-only` 抽查两 commit 的文件清单见上表，
  零 codegen）。**未提交任何 codegen。**
- 未跑任何 e2e / tauri build / cargo（本轨零 Rust 改动）；未改 `Cargo.toml` / `Cargo.lock`。
- 单文件规模（全部 ≤800，最大 315）：`contextBarModel.ts` 315 ·
  `ContextBarActions.tsx` 255 · `KvStatusBar.tsx` 239 · `RedisContextBar.tsx` 236 ·
  `useContextBarData.ts` 184 · `dbKeyCounts.ts` 121 · `useKvSelection.ts` 94。
  组件本体 236 行 ≤ 简报的 250 行目标。
- i18n 只改 `en.ts`；新增 19 个词条（`redis.contextBar.*` 15 个 + `redis.contextBar.status.*` 4 个），
  复用既有 `redis.dbSize` / `redis.loadedCount` / `redis.refresh` / `redis.createKey` /
  `redis.importExportImport` / `redis.importExportExport` / `redis.flushDb` / `redis.monitor`。
  其他 9 语言留待发布前 i18n-sync 统一补（§8.2 已核实开发期不阻塞）。
  `kvSlotRegistration.test.ts` 的「无孤儿文案」扫描遍历 `ui/kv-bar/*.tsx`，本轨新词条全部落在
  两个 `.tsx` 内 ⇒ 该例仍绿。

## 9. 偏离项（逐条说明，无隐瞒）

1. **`KvSlotAction` 加了一个变体**（`selectDatabase`）。简报原文禁止改 `packages/driver-sdk/**`
   （「契约已冻结；若你认为缺字段，停下来汇报，不要自己加」）。
   我按该条**先停下汇报**，协调者裁定 (A) 并**显式授权**动这一处。落地时严格只加一个变体，
   既有 8 条零改名零删除，`KvSlotState` 一字未动。已按裁定要求写进本文件 §4。
2. **动了宿主 `src/windows/connection/**` 三个文件**。同样源于简报禁止，同样经协调者裁定 (A)
   显式授权，且目的正是「不新增第二份开面板逻辑」（复用 `handleSelectKvDb`）。
   除这三个文件外宿主 `src/**` 零改动（`src/lib/kvSlotState.ts` 未触碰）。
3. **改了 6 个既有测试文件的 `makeRelay()` 桩**。这不是风格改动：W3-A 加宽契约后这些桩
   从未同步（测试文件在 `tsconfig.exclude` 里，`tsc` 看不见），本轨 statusBar 一开始读
   加宽 getter 就以 `getSnapshot is not a function` 爆出 30 例红。补齐是**必要修复**，
   且只加成员、不改任何既有 `makeRelay` 语义（沿用同样的 listener + 幂等 notify 风格）。
   已登记 `bugs.md` 第 1 条并给出护栏建议。
4. **改了 `kvBarSlots.test.tsx` 一条断言的等待谓词/内容**（"asks the server for nothing"）。
   简报允许「按新语义更新该断言，但必须在台账写明哪条、为什么、旧断言钉的是什么」，
   已逐条写明于 `bugs.md` 第 2 条与 §6。
5. **`kvSlotRegistration.test.ts` 的 `SHIPPED_ROWS` 加了一行**。该文件自述
   「adding a row here re-checks both gates at once」且 `capability(slot) === SHIPPED_SLOTS.includes(slot)`
   遍历全部四个槽名 ⇒ 本轨一旦声明 `contextBar: true` + codegen 行，不加这行**必然红**。
   这是该文件设计好的维护契约，非绕过护栏；已在汇报里提前告知协调者。
6. **`statusBar` 的 `52 keys` 不是从 `KvSlotState` 取的**。契约里没有键数字段（只有
   `getLoadedCount()`），简报也明确要求用 `db_sizes`。已按简报执行，并额外做了
   **跨槽位合流**（否则两个槽位各付一次 32 往返）。若协调者认为该合流应由宿主中继承担，
   属契约扩展，留给后续轨。
7. ~~`compact` 只给了两级而非 I-10 的三级~~ → **经裁定 1 撤销为「非偏差」**，见 §11.1。
   原文留档（撤销理由不改写历史）：冻结的 `KvContextBarProps` 只交一个 `boolean compact`
   （宿主 `useCompactToolbar` 单断点），driver 侧拿不到另外两级断点；我把降级做成**有序**的
   （先标签、后装饰进溢出），并在 `contextBarModel.contextBarLayout` 注释里写明这是对契约宽度的收敛。
   **结论：交付合格，三级断点属列头（D 轨）遗留，不是本轨缺口；`KvContextBarProps` 不扩。**
8. ~~`data-db-switch` 恒 `wired`、未保留 unwired 第二形态~~ → **经裁定 2 接受**，见 §11.2。
   原文留档：简报提到「保留你已写的 (B) 降级能力」，(B) 的降级路径即「宿主未传
   `onSelectDatabase` ⇒ dispatcher no-op + warn」；driver 侧 `data-db-switch="wired"` 当前恒为 wired。
   我未保留「未接线」的第二渲染形态（宿主已接线的今天那只会是永不出现的死代码），
   F-3 ruling 1 的「不因宿主可能不处理而藏控件」由「控件恒渲染 + dispatcher 降级」满足。
   **结论：属性保留（零成本诊断价值），不再为它造第二个分支，不在 props 上加能力位。**

## 10. 未尽事项（不属本轨范围，登记以免重复推演）

1. **`⋯` 菜单里的 `newKey` / `import` / `export` / `openMonitor` / `setScanBudget` 五条动作
   在宿主侧仍是 no-op + warn**（契约如此，F-3 ruling 1）。contextBar 的控件照常渲染并按契约发请求。
   要真正生效需要后续轨把驱动侧能力接进 dispatcher（宿主不得点名驱动命令，PRD §7-4）。
2. **`selectDatabase` 的宿主执行体是 `handleSelectKvDb`**：语义为「已有该 db 的 KV 面板 ⇒ 置为活动；
   否则新建面板」。注意它创建的是**新面板**而非切换当前面板的 db —— 与 PRD §3.4「切 db 只换页签」
   一致，但它会累积页签；真实观感留待 R 回归确认。
3. **集群上的类型分布标注恒显示**（后端 cluster 语义决定，见 §3），非缺陷但值得在 R 阶段目视确认。
4. **`db_sizes` 合流表按中继对象弱引用 + 未 settle promise**：面板关闭后宿主
   `pruneKvSlotStates` 回收中继，弱引用条目随之可回收。异常路径（promise 永不 settle）
   会让该面板的重复读取共享同一个悬挂 promise —— 与既有 `useKeyObjectInfo` 的合流表同一取舍，
   留待 Tester 判断是否需要超时。

## 11. 协调者裁定登记（2026-09-23 · 编码轮收口后下发，本轨据此**只改台账、不改代码**）

> 本节按协调者指令追加。两条裁定**均不要求改任何代码**，故本节 commit 的变更面仅本文件。
> 变动前后代码零差异（`git diff` 仅 `docs/development/coordination/tracks/redis-kv-context-bar/**`）。

### 11.1 裁定 1：I-10 三级断点 —— 归属**列头**，本轨偏离项 7 撤销

- **协调者核实 PRD 原文**（`docs/todo/redis-workbench-ux/PRD.md:179`）：

  > I-10 | 响应式 | **列头动作**容器查询断点 740/340/240px：文字标签 → 纯图标 → 溢出菜单（dbx `RedisKeyBrowser.vue:3866-3908`）

  即 I-10 约束的是**列头动作**（`KeyTreeHeader`），**不是上下文条**。
  我收到的简报把该要求写成了 contextBar 的要求 —— 属**简报误指派**，不是我的实现缺口。
- **协调者实测**：`KeyTreeHeader.tsx`（176 行，D 轨产出）**目前零响应式处理** ——
  动作区恒为图标+文字，没有 740/340/240 三级降级，也没有对应测试。
  ⇒ **三级断点登记为列头侧的遗留项（D 轨缺口）**，由协调者录入 hub 的 R 清单。
- **对本轨的结论**：我做的「有序两级降级（先丢文字标签 → 再让 memory/chips 进 `⋯`）」，
  在冻结契约给到的单 `boolean compact` 之下**已经超出该表面的契约能力**，属**合格交付**。
- **契约结论**：`KvContextBarProps` 只带一个 `boolean compact` 是**契约的真实形状，不是缺口**
  —— 上下文条就该按「单断点 + 有序降级」实现。**不扩 `KvContextBarProps`。**
- **台账处置**：§9 偏离项 7 由「偏离」改判为「非偏差（简报误指派 + 归属他轨）」，
  原文留档于 §9.7 的删除线块内，不改写历史。

### 11.2 裁定 2：`data-db-switch` 恒 `wired` —— **接受**，不保留不可观测形态

- **裁定**：我对「不保留一个宿主已接线后永不出现的第二渲染形态」的判断**正确**（那是死代码），
  且「控件恒渲染 + dispatcher 降级」已满足 F-3 ruling 1 的**实质**。
  **不在 props 上加能力位。**
- **保留 `data-db-switch="wired"` 属性本身**（诊断价值，成本为零），
  **但不再为它造第二个分支** ⇒ 本轨代码零改动。
- **理由（协调者给出，逐字登记）**：

  > F-3 ruling 1 的原文要求是「槽位不得因为宿主可能不处理而藏掉按钮」——它约束的是**渲染**，
  > 不是要求槽位**感知**宿主接线状态。加能力位等于把宿主实现细节泄漏进契约，
  > 与 F-3「request 只管发问、不问谁处理」的分层相悖。

- **台账处置**：§9 偏离项 8 标注为「经裁定接受」，原文留档。

### 11.3 协调者对其余交付项的逐项确认（无需动作，登记备查）

| 项 | 协调者结论 |
|---|---|
| §9.3 中继桩漂移发现 | **本轮最有价值的产出，已确认为真问题**。实测 9 个测试文件有本地桩、`tsconfig.json:27-33` 把 `packages/**/__tests__/**` 排除 ⇒ `tsc` 结构性看不见 ⇒ W3-A 加宽时六个桩默默过期，直到本轨读 `getLoadedCount()` 才以 30 例红爆出。「只加不改」补齐 10 个 getter 的处理**正确**。我的 `satisfies KvSlotState` 护栏建议**已采纳，将作独立小轨派发** |
| §9.4 `kvBarSlots.test.tsx` 断言改动 | 旧口径（`not.toHaveBeenCalled()` = 状态条零命令）与新口径（`key_object_info` 零调用 + `db_sizes` 唯一命令 = 无选中⇒无键读取）均已写明且原 4 条断言保留 ⇒ **正确的「语义收窄而非删除」** |
| §4 契约扩展 `selectDatabase` | 已核 diff：**恰好加一个成员、既有 8 条零改名零删除、`KvSlotState` 一字未动**、JSDoc 写明「为何是 action 而非 state」⇒ **完全符合授权范围** |
| §6 结构断言（唯一开面板入口） | `ContentView` 不含 `addPanel`/`nextPanelId`、`ConnectionPage` 恰好 2 次、无驱动字面量 ⇒ **spy 测不到的维度的正确补法** |
| §留待 R 回归 8 项 | 随合流登记 |
| 未尽事项 1（`⋯` 内 5 个 action 仍 no-op+warn） | **契约内行为**，已在 R 清单登记目视项，**不算缺陷** |
| 未尽事项 2（`handleSelectKvDb` 累积页签） | 同上，**契约内行为**，R 清单目视项 |

### 11.4 本轮状态

- `READY_FOR_TEST` 不变；**代码零改动**，四门数字（§7）继续有效，无需重跑。
- 变更面：仅 `docs/development/coordination/tracks/redis-kv-context-bar/progress.md`。
- 下一步：由协调者派 Tester 做第 1 轮验收。

## 留待 R 回归

1. **§3.4 上下文条全量目视（GUI + 真 Redis）**：db 选择器切换走 `handleSelectKvDb`
   （已有该 db 面板 ⇒ 置活动；否则**新建页签**）⇒ 六个字段随新面板刷新；
   `used / max` 在 `maxmemory 0` 的服务器上显示「无上限」措辞而非 `0`。
2. **采样标注真机三态（GUI + 真 Redis）**：小库（`dbsize` ≤ 1000）应显示**无**标注；
   大库应显示「采样 1000/N」；ACL 禁 `type_distribution` 的账号应**整组 chips 消失**且仅剩键数。
3. **集群类型分布（GUI + 真集群）**：标注**恒显示**（`sampled` 来自一个钉住的
   `CLUSTER_SCAN_ANCHOR` 分片、`dbsize` 为全集群求和）—— 确认这条诚实降级在 UI 上可读、
   且不出现「看起来像精确分布」的观感。
4. **I-10 响应式（GUI）**：把窗口从宽拖到窄，确认 ①按钮文字先消失、图标与 `title` 仍在；
   ②memory 与 chips 移入 `⋯` 且数字一致；③db / keys / scan 三条**任何宽度都不消失**；
   ④上下文条与工具栏右侧 AI/详情按钮不重叠。已知只两级（偏离项 7）。
5. **statusBar 六段真值正确性（GUI + 真 Redis）**：`52 keys` 与键树实际一致、
   `loaded` 随扫描增长、`cursor 0` 只在扫描真正跑完且 loaded > 0 时才呈「done」态
   （`data-scan-state`，**不是**文案）、`选中 3` 与树内多选一致，多选取消后该段消失、
   最后一次写操作的命令与毫秒数量级合理。
6. **`db_sizes` 一次往返（GUI + 真 Redis，抓包或后端日志）**：同一 Redis 面板同时渲染
   上下文条与状态条时，切 db 只应产生**一次** `db_sizes`（16 库 ⇒ 32 次 `SELECT`+`DBSIZE`）；
   屏 A（`useOverviewData`）另有一次是**不同屏**，不算重复。
7. **SafeMode 徽标与 flush 门闸（GUI）**：打开 Safe Mode ⇒ 上下文条右侧徽标出现；
   此时点 `⋯ → FLUSH` ⇒ 宿主门闸硬拦（`redis.kvSlot.flushBlocked`），
   **不出现驱动侧确认框**（driver 不发确认，符合 F-3 ruling 2）。
8. **宿主 `handleSelectKvDb` 的页签累积（GUI）**：连续切 5 个 db，确认一次创建/复用行为
   符合用户预期（未尽事项 2）。

---

# 第 1 轮验收（Tester `98225808-0d5b-438d-b1a5-c7b6a91a027d`，2026-09-23）

基线 `d049ceb4e` → 终态 `6cde4b3e0`（4 commit）。只测不修；探针一律 `git checkout HEAD -- <file>` 还原并验净。

## 动作 1 — 文件面审计（`git diff --name-only d049ceb4e..HEAD`，28 文件）

| 分类 | 文件 | 结论 |
|---|---|---|
| (a) 本轨 `kv-bar/**` 新增 | `RedisContextBar.tsx` 236 / `ContextBarActions.tsx` 255 / `contextBarModel.ts` 315 / `useContextBarData.ts` 184 / `dbKeyCounts.ts` 121 | ✅ 与自报行数**逐字相符** |
| (a) `kv-bar/**` 修改 | `KvStatusBar.tsx` +156/-22、`useKvSelection.ts` +70、`index.ts` +1 | ✅ 授权（statusBar 全量 + 导出） |
| (a) 注册面 | `shared/meta.ts` +3/-2、`scripts/resolve-drivers.mjs` +4 | ✅ 见下 |
| (b) 授权契约面 | `packages/driver-sdk/src/types/kv-slots.ts` +18/-1 | ✅ 见动作 2 |
| (b) 授权宿主面 | `useKvSlotActions.ts` +48/-5、`ContentView.tsx` +34/-1、`ConnectionPage.tsx` +4 | ✅ 见动作 2 |
| (c) 中继桩测试 | 6 个既有文件 + 2 个新增文件 | ✅ 见动作 3 |
| (d) 台账 | `progress.md` 432、`bugs.md` 48 | ✅ 本轨专属 |

**越界面检查（全部为阴性）**：
- `key-browser/**`、`src/lib/kvSlotState.ts`、`hub.md`、他轨 `tracks/<other>/**`、`Cargo.toml`、`Cargo.lock`、codegen ⇒ **零命中**。
- `scripts/` 下**仅** `resolve-drivers.mjs` 一个文件，内容**仅**为 `BASIC_PATH_FRONTEND.kvSlots` 加 4 行 `contextBar` 行（`component: 'RedisContextBar'` / `path: '../../packages/drivers/redis/ui/kv-bar'`），与既有 `statusBar` / `keyPropsSidebar` / `home` 行同构。**未动其他驱动、未动 BASIC 之外的任何 profile。**
- 其他驱动 UI ⇒ 零命中（唯一 `packages/drivers/**` 改动全在 `drivers/redis/`）。

**注册面三处精度核验（Coder 自报「`meta.ts` 是往同一对象加键、未新建同名键」）**：
- `meta.ts`：diff 为 `kvWorkspace: {` 对象内**插入** `contextBar: true,`，非新增块；删掉的 2 行是「`contextBar` 暂缺」的旧注释。⇒ **属实**。
- `resolve-drivers.mjs`：`kvSlots` 对象内插入，缩进/引号风格与邻居一致。⇒ **属实**。
- `index.ts`：单行 `export { RedisContextBar } from './RedisContextBar';`。⇒ **属实**。

**动作 1 结论：PASS。** 变更面严格落在授权范围内，无一越界。

## 动作 2 — 裁定 (A) 契约核验

### (A-1) `KvSlotAction` 恰好加一个成员

基线 8 条 action 提取后与 HEAD 做 diff：

```
=== DIFF (base vs head) ===
7a8
> { type: 'selectDatabase'
```

⇒ **既有 8 条（`refresh` / `newKey` / `import` / `export` / `flushDb` / `openMonitor` / `openSettings` / `setScanBudget`）零改名、零删除，恰好新增 `| { type: 'selectDatabase'; database: string }` 一条。**

### (A-2) `KvSlotState` 一字未动

抽取 `export interface KvSlotState { … }` 块（**含注释**）逐字比对，两版 md5 相同：

```
KvSlotState IDENTICAL (incl. comments)
b83cf976ec5a3455c417e4c34b5d6e24
b83cf976ec5a3455c417e4c34b5d6e24
```

⇒ **`KvSlotState` 零 diff（连 JSDoc 都未动）**。Coder 新增的 JSDoc 明确论证「为何是 action 而非 state」，与动作 3 的桩加宽事实自洽。

### (A-3) 只有一个开面板入口

| 检查 | 期望 | 实测 |
|---|---|---|
| `grep -n "addPanel\|nextPanelId" src/windows/connection/ContentView.tsx` | 空 | **空**（exit 1） |
| `grep -c "onSelectKvDb={handleSelectKvDb}" src/windows/connection/ConnectionPage.tsx` | 2 | **2**（L696 既有导航树 + L778 本轨新增；定义在 L360） |
| `ContentView.tsx` 含 `databaseType === 'redis'` / `type: 'redis-db'` | 无 | **无**（exit 1） |

**「复用已有回调、非新建第二份」的独立反证**：`git show d049ceb4e:src/windows/connection/ConnectionPage.tsx | grep -n handleSelectKvDb` ⇒ 基线**已存在** `L360`（定义）与 `L696`（调用）。本轨 `ConnectionPage.tsx` 的 diff **仅 4 行**（2 行注释 + 2 行 JSX prop），`handleSelectKvDb` 的**函数体零改动**。⇒ **确为复用，未新建第二份开面板逻辑。**

**宿主接线精度**：`ContentView` 用 `useMemo` 把 `onSelectKvDb` 与活动面板的 `connectionId` 绑定；**未传时显式产出 `undefined`**（而非空壳闭包）⇒ 保持 `useKvSlotActions` 的 no-op + warn 分支**可达**。`useKvSlotActions` 的 `selectDatabase` 分支在无 `onSelectDatabase` 时走 `warnUnwired(action)`（仅 `console.warn`，**不抛**）⇒ F-3 ruling 1 成立。

**动作 2 结论：PASS。** 裁定 (A) 三要素全部逐字落实。

## 动作 3 — 中继桩「只加不改」审计

### (3-1) 逐个文件的删除行统计（最硬的证据）

| 文件 | 新增/删除 | 删除行内容 |
|---|---|---|
| `kvBarRound1Fixes.test.tsx` | `51 / 0` | **无** |
| `kvBarRound2Fixes.test.tsx` | `51 / 0` | **无** |
| `kvBarRound2Tester.test.tsx` | `51 / 0` | **无** |
| `kvBarRound3Tester.test.tsx` | `51 / 0` | **无** |
| `kvBarSlotTesterGaps.test.tsx` | `51 / 0` | **无** |
| `kvBarSlots.test.tsx` | `62 / 2` | 仅动作 3-(3) 所述那 2 行（用例名 + 旧零命令断言） |

⇒ **5 个文件 `-0`（纯新增，连一行都未改）；第 6 个文件的 2 行删除不在 `makeRelay` 块内**（在状态条断言块），与桩无关。

### (3-2) 既有 5 个成员逐字不变（比「无删除行」更强的证明）

对 6 个文件，把基线 `makeRelay` 块（`/^function makeRelay/,/^}/`）**逐行**在 HEAD 的对应块内做 `grep -Fxq` 全文匹配：

```
kvBarRound1Fixes      OK: all base makeRelay lines survive verbatim (28 base lines)
kvBarRound2Fixes      OK: all base makeRelay lines survive verbatim (28 base lines)
kvBarRound2Tester     OK: all base makeRelay lines survive verbatim (28 base lines)
kvBarRound3Tester     OK: all base makeRelay lines survive verbatim (28 base lines)
kvBarSlotTesterGaps   OK: all base makeRelay lines survive verbatim (28 base lines)
kvBarSlots            OK: all base makeRelay lines survive verbatim (28 base lines)
```

⇒ 6 × 28 行基线桩代码**逐字存活**，含 `subscribe` / `getSelectedKey` / `selectKey` / `getDirty` / `setDirty` 全部 5 个原有成员。

**点名核查协调者提出的典型削弱手法**（「例如 `getDirty` 改为返回常量」）：HEAD 上 6 个文件的 `getDirty: () => dirty` / `getSelectedKey: () => selectedKey` **均仍读闭包变量**，无一处退化为常量。`setDirty`/`selectKey` 的幂等 `if (next === dirty) return;` 早退也在基线行集合内。⇒ **未发现任何削弱测试的改动。**

### (3-3) `kvBarSlots.test.tsx` 的 2 行删除 = 已申报的语义收窄

删除行为 `it('renders the no-key state and asks the server for nothing', …)` 与 `expect(commandInvoke).not.toHaveBeenCalled()`，替换为 `key_object_info` 零调用 + `db_sizes` 唯一命令。该文件 diff 的**其余 4 条原断言全部保留**（`data-status-state` / `data-selected-key` / `[data-part="selected-key"]` 非空 + 后接 2 例）。

⇒ 与 `bugs.md` 第 2 条、简报「按新语义更新但必须写明」的要求**逐条吻合**；属**语义收窄而非删除**，且在 action 4 的变异矩阵中被独立验证为**真正承重**（见下）。

### (3-4) 「9 个文件有本地桩 / 6 个过期」口径核验 —— **口径成立，但有一个未申报的遗留**

实测（`git grep -l makeRelay`）：

| 口径 | 实测 |
|---|---|
| **基线**有本地 `makeRelay` 桩的文件 | **7**（6 个已加宽 + `kvSlotRelay.test.tsx`） |
| 本轨**新增**带桩文件 | 2（`redisContextBar.test.tsx`、`kvStatusBarFull.test.tsx`） |
| ⇒ HEAD 有桩文件 | **9** ✅ 与自报一致 |
| 基线**过期的桩**（有 `: KvSlotState` 标注却只有 5 成员、且被测组件**会读**加宽 getter） | **6** ✅ 与自报一致 |

**⚠️ 未申报遗留（记为观察项，非本轨缺陷）**：基线第 7 个带桩文件 `packages/drivers/redis/ui/__tests__/kvSlotRelay.test.tsx:116` 同样写着
`function makeRelay(): KvSlotState & { published: … }` 却只实现 5 个成员，**本轨未加宽**。
它**当前不红**，原因是**结构性安全**而非巧合：该文件注释自述「These tests pin the **publish** side」，
它渲染的 `RedisWorkbench` / `DetailColumn` 对中继**只写不读** —— 实测 `key-browser/**` 对 8 个加宽 getter
的读取命中数为 **0**（`grep` exit 1），唯一的中继调用是 `useKvSlotRelay.ts:37-38` 的
`selectKey(null)` / `setDirty(false)`（写侧）。

⇒ **判定：不是缺陷**（无用例因此丧失保护力），但它是下一轮同型漂移的**头号候选**：
Coder 建议的 `satisfies KvSlotState` 护栏一旦落地，**这个文件会立刻变红**，派发该小轨时须一并修它。
已写入下方 R 回归清单。

## 动作 4 — 三条硬约束的独立变异验证（Tester 自制探针）

每项流程：改生产码 → 跑 `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/redisContextBar.test.tsx` → 记红 → `git checkout HEAD -- <file>` → `git status --porcelain` 验净。
基线：**`47 passed (47)`**；四次探针后复原重跑仍 **`47 passed (47)`**，`git diff HEAD -- packages/ src/` **空**。

| # | 变异（生产码改写） | 结果 | 红在哪条断言 |
|---|---|---|---|
| **1a** | `deriveTypeChips` 哨兵：`sample: sampled < dbsize ? …` → **信任线上 `truncated`** `distribution.truncated ? …` | **BIT** 1 红 | `contextBarModel — sampled chips > recomputes the verdict instead of trusting the wire flag`<br>`AssertionError: expected { sampled: 5, dbsize: 5 } to be null`<br>（即「`sampled:5 / dbsize:5` 但 `truncated:true` 的矛盾载荷」被正确判为 `null`，变异后误标） |
| **1b** | `useContextBarData`：失败/空分布 → `deriveTypeChips(...) ?? { chips: [], sample: null }`（**渲染 0 计数组**而非整组不渲染） | **BIT** 4 红 | ①`renders no chips at all when the read fails — and no zeros either`<br>②`treats an empty counts map as no chips rather than zero chips`<br>③`renders without a resolved db or any server reply`<br>④`survives malformed INFO and distribution replies`<br>（均为 `expected <span …(7)></span> to be null`，即 `[data-part="types"]` 本应缺席） |
| **2** | `deriveMemoryReadout`：`max === null \|\| max <= 0 ? null : max` → `max === null ? 0 : max`（**`0` 回到 DOM**） | **BIT** 2 红 | ①`contextBarModel — memory > reads used / max and treats maxmemory 0 as no ceiling`<br>`AssertionError: expected +0 to be null`<br>②`RedisContextBar — memory with no ceiling > says "no limit" instead of printing max 0`<br>`AssertionError: expected '0' to be 'unlimited'`（**DOM 层 `data-max-bytes`**） |
| **3** | `deriveScanReadout`：`totalCount > 0 ? … : null` → `: 100`（`total === 0` 时**画进度条**） | **BIT** 2 红 | ①`contextBarModel — scan budget > is silent while idle and unused, and reports the unknown-budget case`<br>`AssertionError: expected 100 to be null`<br>②`RedisContextBar — scan budget rendering branches > shows used only — no bar — when the ceiling is unknown`<br>`AssertionError: expected '100' to be 'unknown'`（**DOM 层 `data-budget-percent`**） |
| **4**（加测） | `deriveTypeChips` chip 过滤：`count > 0` 条件去掉 ⇒ 0 计数类型进 chips | **BIT** 1 红 | `yields nothing for a failed / empty / malformed read — never zeros`<br>`AssertionError: expected { chips: [ { …(2) } ], …(1) } to be null` |

### 结论

- **三条硬约束全部被独立证实为「承重」**（4 组探针共 9 条断言红），且**每项都有模型层 + DOM 层两级断言**（1a 除外——它是纯模型判定，DOM 层的对应保护由 1b 与动作 5 的 chips 三态用例承担）。**零「注入后仍绿」。**
- **`string 0` 反断言非空转（独立论证）**：渲染模板为 `{chip.type} {formatCompactCount(chip.count)}`（`RedisContextBar.tsx:171`），`formatCompactCount(0)` ⇒ `String(0)` ⇒ `"0"`。⇒ **`"string 0"` 是被测代码真实可产出的字符串**，`container.textContent).not.toContain('string 0')` 不是恒真式。（注：组件层目前的失败用例走的是 `deriveTypeChips` 返 `null` 的路径，因此该字符串由**生产过滤条件**保证不出现 —— 变异 4 恰是从模型层堵住它，两者互补。）
- **两处 DOM 层断言直接钉在 `data-*` 属性**（`data-max-bytes="unlimited"`、`data-budget-percent="unknown"`），符合 AGENTS.md「数据属性解耦、禁几何反查」与断言纪律。

## 动作 5 — `request` 通道全量实测

### (5-1) 9 个 action 的 spy 断言矩阵（逐条实测，`describe('… every control asks the host (F-3)')` + 预算档位）

| # | action | 触发控件 | 断言（逐字） | 判定 |
|---|---|---|---|---|
| 1 | `refresh` | `redis-context-refresh` | `expect(await clickAndCapture(…)).toEqual([{ type: 'refresh' }])` | ✅ |
| 2 | `newKey` | `redis-context-new-key` | `toEqual([{ type: 'newKey' }])` | ✅ |
| 3 | `import` | `redis-context-import` | `toEqual([{ type: 'import' }])` | ✅ |
| 4 | `export` | `redis-context-export` | `toEqual([{ type: 'export' }])` | ✅ |
| 5 | `selectDatabase` | `redis-context-db`（`fireEvent.change` → `db3`） | `toHaveBeenCalledTimes(1)` + `calls[0][0]` `toEqual({ type:'selectDatabase', database:'db3' })` | ✅ **载荷含选中 db，非空标签** |
| 6 | `flushDb` | `redis-context-menu-flush` | `toEqual([{ type: 'flushDb' }])` | ✅ |
| 7 | `openMonitor` | `redis-context-menu-monitor` | `toEqual([{ type: 'openMonitor' }])` | ✅ |
| 8 | `openSettings` | `redis-context-menu-settings` | `toEqual([{ type: 'openSettings' }])` | ✅ |
| 9 | `setScanBudget` ×4 档 | `redis-context-budget-{10000,50000,200000,1000000}` | 循环点击后 `toEqual([{value:10_000},{50_000},{200_000},{1_000_000}])` | ✅ **4 档逐一比对，且数量恰好 4（无多余档）** |

⇒ **9/9 全部有 spy 断言，无遗漏、无 `toHaveBeenCalled()` 空转式断言**（全部比对**精确载荷**）。

### (5-2) 独立核点 (a)：未接线不抛错（F-3 ruling 1）

**双层证据**：

1. **驱动侧**（`redisContextBar.test.tsx`）：用例 `does not throw when the host ignores the action (unwired is a no-op)` 把 `request` 换成**只收集不处理**的 `vi.fn()`，对 8 个控件 + db `change` 逐个 `expect(() => …).not.toThrow()`，并断言 `request` 被调用**恰好 9 次**、bar 仍在。用例 `keeps every control rendered even though the host may handle none of them` 另钉「控件恒渲染」。
2. **宿主侧**（`useKvSlotActions.test.tsx`）：`degrades to a warning when the host threaded no sink through` —— 不传 `onSelectDatabase` 时 `not.toThrow()` + `warnSpy` 恰 1 次 + 警告文案**含 `"selectDatabase"`**（可诊断「缺 sink」而非「缺能力」）+ `onRefresh` 未被误调。另有用例钉 `request` 身份**冻结**（`expect(request).toBe(initial)`）且能取到**最新** sink（`stale` 零调用 / `fresh` 收 `db9`）。

**Tester 探针（A）**：把该降级分支由 `warnUnwired(action); return;` **改为 `throw new Error('probe: …')`** ⇒
`FAIL … degrades to a warning when the host threaded no sink through`
`AssertionError: expected [Function] to not throw an error but 'Error: probe: unwired selectDatabase …' was thrown`
**1 红 ⇒ 该断言真承重**（`18` 例中 `1 failed | 17 passed`）。还原后 `git status --porcelain` 净。

### (5-3) 独立核点 (b)：`flushDb` 无驱动侧确认框

**静态证据**：`grep -rn "useConfirmDialog|confirm(|Dialog|window.confirm|<dialog|role=\"dialog\"" packages/drivers/redis/ui/kv-bar/` ⇒ **exit 1，零命中**。`ContextBarActions.tsx:171` 为裸 `onClick={() => request({ type: 'flushDb' })}`，无守卫、无对话框。

**宿主门闸仍在**（`useKvSlotActions.ts:168-177`）：`case 'flushDb'` 先 `gateDangerous(FLUSH_DB_COPY)`（`redis.kvSlot.flushTitle/flushMessage/flushBlocked`，SafeMode 下走 `blockedKey` 硬拦），**批准后也仅 warn**（不执行 —— 执行 FLUSHDB 需宿主命名驱动命令，是 §7-4 禁止的硬编码）。⇒ **门闸先于一切，F-3 ruling 2 成立。**

**驱动侧既有断言**：`routes the dangerous flush through request alone — no driver-side confirm` ⇒ `expect(request).toHaveBeenCalledWith({ type: 'flushDb' })` + `expect(screen.queryByRole('dialog')).toBeNull()`。

**Tester 探针（B）**：把 `flushDb` 的点击改为 `if (window.confirm('probe…')) request(...)`（**注入驱动侧确认**）⇒
`FAIL sends the overflow menu items with their exact payloads` — `AssertionError: expected [] to deeply equal [ { type: 'flushDb' } ]`
`FAIL routes the dangerous flush through request alone — no driver-side confirm` — `expected "vi.fn()" to be called with arguments: [ { type: 'flushDb' } ]`
`FAIL does not throw when the host ignores the action (unwired is a no-op)` — `expected "vi.fn()" to be called 9 times, but got 8 times`
**3 红 ⇒ 「零驱动确认」被真实钉住**（`1 failed | 44 passed`）。还原后 `git status --porcelain` 净、`47 passed (47)`。

**动作 5 结论：PASS。** 9/9 action 有精确 spy 断言；两个独立核点均以探针反证承重。

## 动作 6 — 「死代码删除」claim 独立核验

### (6-1) 待核验的 claim 原文（`progress.md` §5 变异 4）

> `stopped` / `done` 去掉 `usedCount > 0` 项 — **0 failed（等价变异体）** ⇒ 判为死代码，当场删除冗余项；真实承重项（早退分支）改坏后 **5 failed**

### (6-2) 现有痕迹

`contextBarModel.ts:266-270` 留有一段注释（**HEAD 上唯一的「不可达」痕迹**）：
> `Past the early return above, usedCount > 0 always holds, so the pair that separates "stopped early" from "wrapped" is cursor !== '0' … Re-testing usedCount here would be an unreachable branch — a branch no test can execute, which is worse than a shorter expression.`

⚠️ **`git log --all -- contextBarModel.ts` 只有 `fdc46cd74` 一个 commit** —— 即**删除发生在文件首次提交之前**，仓库内**没有可 diff 的「删除前」状态**。故不能靠 `git log -p` 复核；改以**形式化 + 穷举**复核。

### (6-3) 形式化论证（早退分支支配）

```
if (!scanning && usedCount === 0) return null;      // ← 早退
…
const stopped = usedCount > 0 && cursor !== '0' && !scanning;   // ← 被删的 `usedCount > 0` 项
```
`usedCount > 0` 为假的两种情形：
- ① `!scanning && usedCount === 0` ⇒ **已在早退处 `return null`**，永远到不了 `stopped`；
- ② `scanning === true` ⇒ 此时 `stopped = … && !scanning` **必为 `false`**，与 `usedCount` 无关。

⇒ 两种情形下该项**都不改变返回值**，是**真不可达/不可观测**（严格说是「不可观测项」，因 `&&` 链短路而非语句块，故无分支覆盖可测）。**保留它会永久拉低分支覆盖且无任何判别力，删除是正确处置，不是删掉可达的保护逻辑。**

### (6-4) 穷举复核（Tester 自制探针，已删除不留残）

临时探针 `__tests__/__tester_probe_deadcode.test.ts` 同时实现两形态（含/不含该冗余项）并**穷举**输入空间：
`scanning ∈ {true,false}` × `used ∈ {0,1,2,499,500,1000,50000,-1,NaN,Infinity,1.5}`（11）× `total` 同 11 档 × `cursor ∈ {'0','1','17','4294967295','','abc'}`（6）= **1452 组**。

实测：`diffs` 恒为 `[]`（两形态**输出完全一致**）；且 `!scanning && used<=0` 的 12 组输入**全部早退返 `null`**（`reached === 0`，即 `stopped` 在这些输入上不可达）。
`✓ 2 passed` ⇒ **claim 成立**。探针随即 `rm`，`git status --porcelain` 净（无 `??` 残留）。

### (6-5) 反向核验：删完之后，剩下的项是否仍承重？（防「删掉了可达的保护逻辑」）

Coder 自报「真实承重项（早退分支）改坏后 5 failed」。我独立重做，并**额外**测了它未报的第三项：

| 探针 | 变异 | 实测 |
|---|---|---|
| **C1** | 删掉**早退** `if (!scanning && usedCount === 0) return null;` | **6 failed / 47**（含 `never claims completion from cursor '0' alone`、`does not claim completion from cursor '0' with nothing scanned`、`renders nothing for a fresh panel`）⇒ 与自报的「5」同量级且**更强**（我这条同时命中了 DOM 层用例） |
| **C2** | `stopped = cursor !== '0' && !scanning` → `stopped = !scanning`（**忽略 cursor**） | **3 failed / 47**（`reports progress while scanning and completion only on a wrapped cursor` 等）⇒ **cursor 项独立承重** |
| 复原 | `git checkout HEAD -- contextBarModel.ts` | `git status --porcelain` **净** |

⇒ 删除**未触及**任何承重逻辑：早退分支（C1）与 cursor 项（C2）**各自都有专属用例钉住**。

### (6-6) 另一处 `-22` 生产面复核（`KvStatusBar.tsx`）

`KvStatusBar.tsx` 是本轨唯一另一处带删除的生产文件。逐行审阅其 22 行删除：**全部为 (i) 已被新功能取代的旧 docblock**（原文自述「PRD 其余状态事实…`not` exposed by `KvSlotState`；渲染它们意味着加宽已冻结的契约，故**登记为缺口而非在此伪造**」—— 该缺口本轨已合法落地，旧注释**反向失真**，删除正确）+ (ii) 结构性重构行（`parts` 数组与 import 改写）。**未删任何保护逻辑**：`useKvDirty` 仍在使用（`KvStatusBar.tsx:70`），`data-part` / `data-testid` / `getDirty` 语义全部保留。

**动作 6 结论：PASS。** 删除项经**形式化 + 1452 组穷举**双证为真不可观测；剩余承重项经 C1/C2 探针反证仍然有效；无保护逻辑被误删。

## 动作 7 — 回归四门 + 宿主门（提交态 `9cddc1cff` 串行实测，逐字留尾）

> 顺序：`tsc` → drivers `vitest` → `vite build` → boundaries，随后宿主全量 `vitest`。全部**串行**，无并发重命令。
> 收尾 `git status --porcelain` **空**（`dist/` 由 `.gitignore:44` 忽略；codegen 未提交）。

### 门 1 — `npx tsc --noEmit`

```
=== GATE 1: tsc --noEmit ===
tsc-exit=0
```
⇒ **0 错**，与自报一致。

### 门 2 — `npx vitest run --config vitest.drivers.config.ts`

```
 Test Files  63 passed (63)
      Tests  874 passed (874)
   Duration  12.65s (transform 5.19s, setup 24.81s, import 5.31s, tests 13.19s, environment 34.69s)

vitest-exit=0
```
⇒ **63 files / 874 tests，0 失败**，与自报**逐字一致**（基线 61/804 ⇒ +2 files / +70 tests）。**Tester 探针已全部还原，未新增用例**，故数字即提交态数字。

### 门 3 — `npx vite build`

```
dist/assets/main-CDsGxhk3.js                   1,672.07 kB │ gzip: 487.35 kB
(!) Some chunks are larger than 500 kB after minification. Consider:
✓ built in 4.81s
vite-exit=0
```
⇒ **exit 0**。`chunk > 500 kB` 为**存量提示**（`main` / `MainPage` 体积警告，与本轨无关，非失败）。

### 门 4 — `node scripts/check-driver-import-boundaries.mjs`

```
[check-driver-import-boundaries] 2 allow-listed reference(s) skipped
[check-driver-import-boundaries] R3 (advisory) src/locales/locales.test.ts:107: reaches into driver internals (packages/drivers/redis/locales)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:25: reaches into driver internals (packages/drivers/redis/ui/shared/meta)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:26: reaches into driver internals (packages/drivers/mongodb/ui/meta)
[check-driver-import-boundaries] R3 (advisory) src/windows/connection/DocumentConnectionView.tsx:25: reaches into driver internals (packages/drivers/mongodb/ui/mongodbFind)
[check-driver-import-boundaries] ok (1507 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
boundaries-exit=0
```
⇒ **0 blocking / 4 advisory / 1507 files**，与自报**逐字一致**。4 条 advisory 的**行位与文件全部未变**（`locales.test.ts:107` / `driverUiSetup.ts:25,26` / `DocumentConnectionView.tsx:25`），无一由本轨新增。1507 = 自报值。

### 门 5（宿主，本轨改了宿主 `src/**` 必跑）— `npx vitest run`

```
 Test Files  454 passed (454)
      Tests  4744 passed (4744)
   Duration  101.15s (transform 29.45s, setup 60.54s, import 139.36s, tests 132.33s, environment 300.67s)

host-exit=0
```
⇒ **454 files / 4744 tests，0 失败**，与自报**逐字一致**（基线 453/4734 ⇒ +1 file / +10 tests，即 `ContentViewKvDbSwitch.test.tsx` 7 例 + `useKvSlotActions` 新增 3 例）。

**动作 7 结论：PASS。五门全绿，五项数字与自报逐字吻合，无一处夸大。**
