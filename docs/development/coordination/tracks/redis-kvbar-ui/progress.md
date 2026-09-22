- 任务: KV 上下文条/状态条/键属性侧栏（驱动侧槽位实现，PRD §3.4 / 裁定 8-2、8-3）
- 状态: TEST_FAILED（第 1 轮 Tester 独立复跑：四项门禁全绿 + kv-bar 覆盖率 100%，但登记 4 条 `待修复`，其中 BUG-001 为 Major）
- 编码 commit: `cc054de7d` + `6e3624c7f` + `f86ad9973` + `5b9c02e90`（中继接线 `952979543`）
- 测试 commit: `952979543`（继承 `kvSlotRelay.test.tsx`）+ `cc054de7d`、`6e3624c7f`（`kvBarSlots.test.tsx` 368 行 / 17 例）+ **第 1 轮 Tester：`bb9946a56`（补测）、`e0e0a19bb`（护栏去脆化 + BUG-004 证据）**
- 判定 commit: 本次提交（`docs(coordination): redis-kvbar-ui 第 1 轮 Tester 判定`）
- 代理: w2a-kvbar-rescuer-a（编码）→ 第 1 轮 Tester 第 1 任（死于 150 轮，未交判定）→ **第 1 轮 Tester 第 2 任（接管收尾，本次关账）**
- Worktree: .worktrees/datazen-redis-kvbar-ui
- 分支: feature/redis-kvbar-ui
- 心跳: 2026-09-22 12:40

# redis-kvbar-ui 轨道台账

> 本文件由协调者在第 1 任编码代理死亡后补建（前任两棒均未写台账）。hub 只读上方短键行。
> 下方正文由 Rescuer-A 在交付时续写并覆盖"进行中"章节。

## 已入库

| commit | 内容 |
|---|---|
| `590b36bd0` | PRD §7-5"先拆再改"：`RedisWorkbench.tsx` 拆出 `KeyTreeColumn.tsx` / `DetailColumn.tsx`（拆后 651 / 92 / 98 行） |
| `952979543` | 契约 F-2 中继接线：`kvSlotState` 由 `RedisConnectionView` 透传 → `RedisWorkbench` 作为唯一写者按字段粒度发布 `selectKey`/`setDirty`；`DetailColumn` 加 `key={detail.key}` 防草稿跨键残留；三处 drop-selection 与 `dbSessionId` 变更/unmount 均复位 dirty；附 `kvSlotRelay.test.tsx`（377 行 / 11 例） |
| `cc054de7d` | **步骤 2** 键属性侧栏：新目录 `ui/kv-bar/`（`keyObjectInfo.ts` 156 行 + `useKeyObjectInfo.ts` 69 行 + `useKvSelection.ts` 24 行 + `KeyPropsSidebar.tsx` 224 行 + `index.ts`），props 逐字消费冻结的 `KeyPropsSidebarProps{open,onClose}`；`open === false` 时**组件自身**返回 `null`（BUG-003 口径）；`missing`（键已过期/被删）走**命名空态而非报错**；7 个属性行（type/memory/ttl/encoding/idle/freq/maxmemory-policy），逐字段 `null` 各自退化；`maxmemory_policy` 从 `info_filtered{memory}` 取，四层失败降级为 `—` |
| `6e3624c7f` | **步骤 3** 底部状态条 `KvStatusBar.tsx`（101 行）：选中键与 dirty 只从 `KvSlotState` 的 getter 读（`subscribe` + `getSelectedKey`/`getDirty`，`useSyncExternalStore`），**零回调、零自建 module singleton**；类型/TTL/大小来自同一条 `key_object_info`；无选中键时**不发任何命令**（用例以 `expect(commandInvoke).not.toHaveBeenCalled()` 钉住）；TTL 段仅在存在真实截止时渲染 |
| `f86ad9973` | **步骤 4** 双闸门各补一半：`ui/shared/meta.ts` 声明 `kvWorkspace{statusBar:true,keyPropsSidebar:true}`（F-1 能力位，宿主不再按 driver id 分支）；`scripts/resolve-drivers.mjs` 新建 redis `kvSlots` 块并**只加本轨两行**（F-3 codegen → `DRIVER_KV_SLOTS`） |
| `5b9c02e90` | **步骤 5** 文案：仅 `packages/drivers/redis/locales/en.ts` 追加 22 键，命名空间 `redis.contextBar.status.*` / `redis.keyProps.*`；TTL 行复用既有 `redis.ttl` / `redis.noExpiry`；不写 `redis.overview.*`（属 `redis-overview` 轨），其余 9 语言不动（裁定 8-4） |

## 继承现场的处置（第一动作，先固化后写码）

第 1 棒遗留的 4 个脏文件 + 1 个未跟踪测试**逐行复核后原样提交**为 `952979543`（5 文件 +493/−6），**未重写任何语义**：`selectKey`/`setDirty` 的发布时机、`dbSessionId` 变更与 unmount 的复位、三处 drop-selection 重置、`key={detail.key}` 防串键草稿、`StringEditor` 的脏态上报全部按原设计保留。唯一"修改"是**任务书给的测试命令本身跑不到文件**：根 `vitest.config.ts` 排除 `packages/drivers/**`，`npx vitest run packages/.../kvSlotRelay.test.tsx` 返回 `No test files found`；改用 `npx vitest run --config vitest.drivers.config.ts <path>`（即 `test:unit:drivers` 的口径）后 **11/11 通过**，未弱化也未删除任何断言。此差异已作为流程项登记到下方 R 清单。

## 门禁实跑数字（2026-09-22，本机 worktree 根目录）

> ⚠️ 本节为**编码代理自述**，按 Tester 规程零信任处理；独立复跑数字见文末
> 「第 1 轮 Tester 判定 → 门禁实跑数字」，两者差异已在该节归因。

| 门禁 | 命令 | 实际结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | **exit 0，0 条诊断**（含 codegen 产物 `src/extensions/generated.ts`，即 F-3 生成的两行注册参与类型检查） |
| 驱动 UI 全量 | `pnpm test:unit:drivers` | **35 files / 269 tests 全绿，0 failed**；基线 33/241 → **+2 files / +28 tests**（继承 11 + 本轨 17），基线无用例变红 |
| 前端构建 | `npx vite build` | **exit 0**，`✓ built in 5.11s`（仅既有 chunk >500 kB 体积告警，非本轨引入） |
| 槽位注册 | `node scripts/resolve-drivers.mjs --codegen-only --drivers=basic` | `generated.ts:15` 生成合并 import；`DRIVER_KV_SLOTS` 得 **2 行**：`{dbType:'redis',slot:'statusBar',component:RedisKvStatusBar}` / `{...slot:'keyPropsSidebar',component:RedisKeyPropsSidebar}`；未声明的 `contextBar`/`connectionHome` **零 import 零行**（宿主走默认渲染） |
| Rust | — | 无改动，按任务书未跑 cargo |

> codegen 与 `dist/` 均为 gitignore 产物：门禁跑完 `git status --short` 只剩本台账目录，**无任何 codegen 文件被改动或被提交**（`src/extensions/generated*.ts`、`src-tauri/src/driver_init.rs`、`src-tauri/capabilities/default.json` 全程未入暂存区）。未执行 `pnpm install`（node_modules 与新 lockfile 的既存差异按 `--config.verify-deps-before-run=false` 绕开，不装不改）。

## 断言口径（PRD §7-6）

新增 2 个测试文件合计 **0 条可见英文字面量断言**：组件状态一律走 `data-props-state` / `data-status-state` / `data-value` / `data-fallback-key` / `data-i18n-key` / `data-part` / `data-testid`，i18n 只按 **key** 断言（`t` 被 mock 成 identity，故任何测试都无能力钉死译文）；从 Redis 回显的值（类型名、字节数、策略名）属服务端数据，直接断言。`formatSize` 的 `'640 B'` / `'1.5 KB'` 两条是对共享工具真实输出的实测（首稿按直觉写 `'1234 B'` 被打回，改为尊重实现）。

## 明确未做

1. **`contextBar` 全量版未做，留给 Rescuer-B。** 理由：第 1 任 165 次工具调用 / 109 分钟全部消耗在前置接线，到死未触碰任何 P0 交付物；把三槽塞给同一代理极可能重演。上下文条（类型分布 chips / `used/max` / 扫描进度 / 导入导出 / ⋯ 溢出）由 Rescuer-B 在本 worktree 单写者串行接手。本轨因此**故意不声明** `kvWorkspace.contextBar` 能力位、也**不写** `contextBar` 注册行，`redis-host-slots` 的双闸门保证宿主在缺位时保持默认渲染（不留死按钮）。
2. 9 个非英语 locale 未追加词条（裁定 8-4 只改 `en.ts`）。
3. 未动 `connectionHome` / `redis.overview.*`（属 `redis-overview` 轨），未动其它轨道目录文档，未动 `hub.md`。

## 契约缺口（本轨未擅自扩面，需宿主轨道裁定）

PRD §3.4 状态条样例含 **keys 总数 / loaded / 扫描游标 / 多选计数 / 上次写入时间** 五项，但冻结的 `KvSlotState`（F-2）只暴露 `subscribe`/`getSelectedKey`/`selectKey`/`getDirty`/`setDirty`。本轨按"不得改签名"实现，状态条只渲染 props 与 `key_object_info` 能证实的部分（database / 选中键 / 类型 / 大小 / TTL / dirty），缺口已在 `KvStatusBar.tsx` 顶部 docblock 就地登记。**这是 Rescuer-B 的前置**：上下文条若要做全量，须先由 `redis-host-slots` 侧扩 `KvSlotState`（或走 `driver-sdk` 的 `bind*`），不得由驱动侧自建 singleton 兜底。

## R 回归项（留待真连 / E2E）

| # | 待验 | 为什么单测覆盖不到 |
|---|---|---|
| R1 | 键树选中 → 状态条出现选中键/类型/大小/TTL；编辑器改值 → dirty 徽标出现；切库/关面板 → 复位 | 中继真实写者在宿主侧，驱动测试只能用本地 `makeRelay()` 替身（import 边界护栏禁止驱动侧 import 宿主 `src/**`） |
| R2 | **BUG-003 口径**：E2E 判抽屉/侧栏开关**禁止**用宿主 wrapper `conn-kv-key-props-sidebar` / `data-slot="kv-key-props-sidebar"` 的存在性（它在 `open === false` 时仍挂载），必须查驱动自己的 `redis-kv-key-props-sidebar` | 已由单测钉住"collapsed ⇒ `container.firstChild` 为 null 且零请求"，但真机 DOM 层级需 E2E 复证 |
| R3 | 真实过期键（PTTL `-2` / `missing:true`）走空态而非报错，且状态条不残留上一个键的 type/size | 需要会过期的 TTL 场景与真连时序 | 需要会过期的 TTL 场景与真连时序 |
| R4 | 非 LFU 服务器（`maxmemory-policy` 不含 `lfu`）⇒ freq 行显示 `redis.keyProps.freqUnavailable` 而**绝不是 0** | `OBJECT FREQ` 的报错文本只在真连时出现 |
| R5 | 托管 Redis / ACL 禁 `INFO` ⇒ 驱逐策略退化 `—` 且不影响其余 6 行 | 替身只能伪造 4 层降级形状 |
| R6 | Cluster / Sentinel 下 `key_object_info` 的按槽位寻址（`redis-cmds-p0` BUG-007 修复面）在两个新槽位上成立 | 需真集群，进程内不可证伪 |
| R7 | 非 redis 驱动（pg/mysql/sqlite/mongo）KV 面板**不出现**两个槽位，宿主默认渲染不变 | 单测只覆盖 redis 注册；双闸门行为属宿主集成面 |
| R8 | 任务书/流程口径：驱动 UI 测试必须带 `--config vitest.drivers.config.ts`，根配置会静默排除 `packages/drivers/**`（本次继承测试"跑不到文件"即此因），后续派单建议直接写全命令 | 命令口径问题，非产品缺陷 |

## 合并期协调者待办（文件面相交预告）

- `scripts/resolve-drivers.mjs`：redis `kvSlots` 块由本轨**新建**（仅 statusBar / keyPropsSidebar 两行，按 `KV_SLOT_NAMES` 顺序）。`redis-overview` 轨的 `connectionHome` 行须插入本块内部 ⇒ 预计 1 处纯插入冲突，本轨未为其预留空行。
- `packages/drivers/redis/ui/shared/meta.ts`：`kvWorkspace` 块同理，`overview`/`contextBar`/`home` 属他轨，届时只加自己那行。
- `packages/drivers/redis/locales/en.ts`：本轨只在**文件尾** `} as const;` 前追加一段，与 `redis.overview.*` 不相交（若他轨同样尾部追加则为尾行冲突，可机械解）。
- 门禁基线提醒：drivers vitest 本轨起点 33 files / 241 tests，合入本轨两笔测试后实跑 **35 files / 269 tests**（后续派单请以 269 为新基线，Wave-1 前的旧数字不可用）。

## 代理史

- 第 1 棒 `w2a-kvbar-coder`：165 次工具调用 / 109 分钟，**撞 150-turn 上限死亡**，遗留 4 文件 +116/−6 与 377 行未跟踪测试（协调者逐行盘点后确认质量可用，语义未重写）。
- 第 2 棒 `w2a-kvbar-rescuer-a`：第一动作固化继承现场（→ `952979543`），随后按序交付键属性侧栏（`cc054de7d`）、状态条（`6e3624c7f`）、槽位注册（`f86ad9973`）、文案（`5b9c02e90`）、门禁与本台账；**未做上下文条**（范围外，交 Rescuer-B）。
- 第 3 棒 `w2a-kvbar-tester`（第 1 轮 Tester，全新实例）：**撞 150 轮上限死亡**，死前最后一句为
  “Let me prove my new stale-drop tests aren't vacuous”。已完成阶段 A 与大部分阶段 C，
  留下 3 份**未提交**测试产物、未写判定与 bugs.md。死时 `ui/shared/meta.ts` 残留
  `statusBar: false` 能力位探针，由协调者 `git checkout HEAD --` 还原。
- 第 4 棒 `w2a-kvbar-tester`（第 1 轮 Tester 接管收尾，全新实例，本次）：复核继承现场后
  提交补测（`bb9946a56`）、去跨轨脆化并补 BUG-004 证据（`e0e0a19bb`）、独立复跑四项门禁、
  做完 15 项变异 + 4 项追加探针、登记 4 条 Bug 并关账为 `TEST_FAILED`。**只测不修**，
  生产代码零改动（每轮变异后 `git status` 均已确认干净）。

---

# 第 1 轮 Tester 判定（接管收尾，独立复跑）

> 判定：**TEST_FAILED** —— 门禁四项全绿、`ui/kv-bar/**` 覆盖率 100%，但存在 4 条 `待修复`
> （BUG-001 Major / BUG-002 Minor / BUG-003 Minor / BUG-004 Low），详见同目录 `bugs.md`。
> 本任代理为全新实例，未复用任何编码代理上下文；下表数字**全部本机实跑**，未沿用前任自述。

## 门禁实跑数字（2026-09-22，worktree 根目录）

| 门禁 | 命令 | 实际结果 |
|---|---|---|
| 类型 | `npx --config.verify-deps-before-run=false tsc --noEmit` | **exit 0，0 条诊断**（补测提交后复跑仍为 0） |
| 驱动 UI 全量 | `npx vitest run --config vitest.drivers.config.ts` | **37 files / 293 passed + 3 skipped（296 例），0 failed** |
| 前端构建 | `npx vite build` | **exit 0**，`✓ built in 5.06s`（仅既有 chunk >500 kB 告警，非本轨引入） |
| 变更文件覆盖率 | `npx vitest run --config vitest.drivers.config.ts --coverage --coverage.provider=v8 --coverage.include='packages/drivers/redis/ui/kv-bar/**'` | **TOTAL lines 100 / stmts 100 / branch 100 / funcs 100**，逐文件亦 100%（`index.ts` 为纯 re-export 桶，6/6 文件无一低于阈值）。阈值 ≥80% **达成** |
| 边界护栏 | `node scripts/check-driver-import-boundaries.mjs` | **exit 0**，`1430 files scanned · 0 blocking · 4 advisory`（4 条 advisory 均为存量，非本轨） |
| Rust | `cargo test -p datazen --lib` | **本轮判定为不适用并跳过**：`git diff --stat 3288af501~6..HEAD -- '*.rs' 'Cargo.toml' 'Cargo.lock'` 输出为空，本轨 19 个变更文件全为 TS/MJS/MD（见上方文件面），宿主 Rust 侧无一行改动。合并期若宿主槽位面被触及，需在新轨补跑 |

### 基线对照（口径澄清）

| 时点 | files / tests | 来源 |
|---|---|---|
| 本轨起点 | 33 / 241 | 台账「合并期协调者待办」 |
| Rescuer-A 交付后（其自述） | 35 / 269 | 台账「门禁实跑数字」 |
| **Tester 接手（含 3 份未提交补测）** | **37 / 295 passed + 2 skipped（297）** | 本机实跑 |
| **Tester 收尾（去脆化 + BUG-004 成对用例）** | **37 / 293 passed + 3 skipped（296）** | 本机实跑 |

净变化 `-1 例` 的归因（**不是断言被弱化，也无任何存量用例变红**）：
`kvSlotRegistration.test.ts` 10 → 7（把“恰好两槽”这一轨内事实的三条重复表达收敛为
`SHIPPED_SLOTS` 单常量 + 一次 `KV_SLOT_NAMES` 遍历，见下节取舍），
`kvBarSlotTesterGaps.test.tsx` 14 → 16（+1 条 BUG-004 红测 skip、+1 条记录当前错误标签的绿测）。
四条检测力已在改写后**逐条变异复验**（下表 M9/M9b/M10/M11 + L1/L2），未失去任何捕获能力。

## 继承现场的处置（Tester 对前任产物的取舍）

| 产物 | 处置 | 理由 |
|---|---|---|
| `kvSlotRegistration.test.ts`（10 例） | **保留并改写**（→ `e0e0a19bb`，7 例） | 双闸门护栏本身是高质量补测，但有三处**跨轨脆化**：(a) `toEqual({statusBar:true,keyPropsSidebar:true})` 写死对象形状；(b) `byName` 组件名硬编码表；(c) 文案扫描的 `SOURCES` 只列两个文件。三处都会在 Rescuer-B 合法落 `contextBar` 时**误报**（尤其 (c) 会把新槽位的正常文案判成“孤儿键”）。改为单一 `SHIPPED_SLOTS` 常量 + 对 `ui/kv-bar` 命名空间导出做解析 + 遍历目录扫描，轨内事实只剩一行。**未删除任何断言语义**，改写后重跑变异全部仍有红。 |
| `kvBarSlotTesterGaps.test.tsx`（14 例，前任未盘点） | **全部保留**（内容经逐条核对），追加 BUG-004 成对用例 → 16 例 | 盘点结论：与存量 `kvBarSlots.test.tsx`（17 例，happy path）**无重复**——新增的是陈旧响应丢弃（resolve/reject 两侧）、状态条逐字段 `null` 退化、`dbIndex` 派生与 `unavailable`、侧栏 memory/idle/encoding `null` 行与正数 TTL、真实 freq、policy 三层形状与会话切换后到回复。全部为存量未覆盖分支，且遵守零文案断言。 |
| `kvSlotRelay.test.tsx`（+101 行纯插入，4 例） | **原样提交** | 纯插入零删除，未弱化任何断言；四条 dirty 退出路径 + 两条清空选中代码路径。其价值由 **M8** 直接证实（见下表：前任发现“删 `dbSessionId` 依赖整套仍绿”，现已由新用例捕获）。 |
| 前任残留的 `meta.ts` 能力位探针 | 开工前 `git status` 复核 → **确认已被协调者还原** | 接手时工作区仅 3 份测试产物脏，生产代码干净；本轮全部 15 项变异结束后再次 `git status --short` 为空。 |

## 变异复验表（阶段 C，全部注入后 `git checkout HEAD --` 还原；表尾附还原核验）

| # | 注入（生产代码） | 结果 | 变红的用例 |
|---|---|---|---|
| M0 | 空匹配正则（阴性对照，验证电池本身可信） | 正确报 `NOT-APPLIED`，未误跑 | — |
| M1 | 删 reset effect 的 `kvSlotState.selectKey(null)` | **3 red** / 292 passed | `kvSlotRelay › publishes a clean slate when the workbench unmounts`；`[tester] … when only the database session swaps`；`[tester] … when only the relay object is swapped` |
| M2 | 删 reset effect 的 `kvSlotState.setDirty(false)` | **2 red** / 293 | `[tester] … database session swaps`；`[tester] … relay object is swapped` |
| M3 | 删 `DetailColumn.tsx:97` 的 `key={detail.key}` | **1 red** / 294 | `DetailColumn → dirty signal (I-1 source) › does not leak one key draft into another key (per-key editor remount)` |
| M4 | `useKeyObjectInfo.ts` 的 `stale = true` 置空（迟到回复不再丢弃） | **2 red** / 293 | `[tester] … drops a late success reply after the selection moved on`；`… drops a late failure after the selection moved on` —— **前任“证明新 stale-drop 用例非空跑”的未竟事项，本轮完成** |
| M5 | 删 `attributeViewState` 的 `missing` 分支 | **3 red** / 292 | `key_object_info client (pure) › names every render branch`；状态条与侧栏各一条 expired-key 用例 |
| M6 | 删 `attributeViewState` 的 `failed` 分支 | **2 red** / 293 | 同上 pure 用例 + `RedisKeyPropsSidebar › names a command failure as its own state` |
| M7 | `useKvSelection` 读侧绕过 `useSyncExternalStore`，只裸调 getter | **12 red** / 283 | 两槽位共 12 条（选择驱动读取、TTL、expired、refresh、全部 `[tester]` 陈旧/退化用例）—— 契约 F-2“订阅而非轮询”的读侧被证明是**真依赖**，绕过后不可能静默通过 |
| M8 | `dbSessionId` 从 reset effect 依赖数组移除 | **1 red** / 294 | `[tester] … publishes a clean slate when only the database session swaps` —— **前任记录的“原本零覆盖”缺口已闭合**（此前整套为绿） |
| M9 | 两个能力位同时 `statusBar:false` + `keyPropsSidebar:false` | **2 red** / 5（单文件） | `declares a capability for exactly the slots this build ships`；`keeps capability and registration in lockstep` |
| M9b | 仅 `statusBar: false`（前任探针口径） | **2 red** / 5 | 同 M9 |
| M10 | codegen `component: 'RedisKvStatusBar'` → typo | **1 red** / 6 | `names components that really are exports of the declared module`（改写后归因更精确：只打这一条，不再连带行数断言） |
| M11 | codegen `keyPropsSidebar:` 块改名使其未声明 | **2 red** / 5 | `registers exactly one row per shipped slot`；`keeps capability and registration in lockstep` —— 即“能力位在、注册行没了”这一半静默死代码已被捕获 |
| M12 | 侧栏 `if (!open) return null` 失效 | **1 red** / 294 | `RedisKeyPropsSidebar › renders nothing while collapsed, and fetches nothing` |
| M13 | 侧栏 `open ? selectedKey : null` → `selectedKey` | **0 red / 295 passed —— 存活** | **判定为等价变异，非覆盖缺口**：`useKeyObjectInfo` 的第 4 参 `enabled` 仍为 `open`，effect 首行 `if (!enabled …) return` 已足以抑制流量，两道闸门互为冗余 |
| M14 | 只拆 `enabled` 实参（保留三元） | **1 red** / 294 | 同 M12 —— 与 M15 共同证明 M13 的存活源于冗余而非缺测 |
| M15 | 两道请求闸门全拆 | **1 red** / 294 | 同 M12 —— “抽屉收起零往返”这一保证确被现有用例钉住 |
| L1 | `en.ts` 注入一条无人使用的 `redis.keyProps.*` 孤儿键 | **1 red** / 6 | `leaves no unused copy behind in the namespaces these slots own` |
| L2 | 删除一条正在被使用的 `redis.keyProps.freqUnavailable` | **1 red** / 6 | `every driver-owned key the slots render is present in en.ts` |

**还原核验**：电池脚本每次注入后无条件 `git checkout HEAD -- <file>`；全批结束时的
`git status --short` 与 `git diff --stat -- packages src scripts` 均为**空**，
`git diff` 里只剩当时正在改的测试文件。两处临时探针
（`zzTesterProbe.temp.test.tsx`、`zzTesterProbe2.temp.test.tsx`）**已删除、未提交**。

## 逐条核查项答复

1. **F-2 中继接线是否为唯一写者？** 是。`RedisWorkbench.tsx:353-369` 三个 effect 是面板内唯一发布点，
   `selectKey`/`setDirty` 按字段粒度分写（M1/M2/M7/M8 均为红 ⇒ 该结构被真实依赖）。
2. **四条 dirty 退出路径是否都有护栏？** 是（切键 / 关面板 / 切 `dbSessionId` / unmount + 搜索框清空、
   详情列关闭）。其中“切 `dbSessionId`”此前**零覆盖**，本轮由 `kvSlotRelay.test.tsx` 的 `[tester]` 用例补上（M8 转红为证）。
3. **防草稿跨键串台是否成立？** 成立且有用例（M3 红）。
4. **`missing` / `failed` 分支是否各走命名空态？** 是（M5/M6 红）。唯一漏网的是 `PTTL -2` 与 `missing:false`
   并存这一形状 → **BUG-004**。
5. **状态条是否伪造取不到的事实？** **否**：`KvStatusBar.tsx` 只渲染 props 与 `key_object_info` 可证实字段，
   `dbIndex` 未解析时不发任何命令并显式标 `unavailable`（专项核查，见 bugs.md 附录）。W2-C 契约加宽前不构成缺陷。
6. **双闸门（F-1 + F-3）Redis 侧两半是否有护栏？** 现在有了（M9/M9b/M10/M11 全红），
   且改写后不再阻塞 Rescuer-B 合法扩面。
7. **零文案断言口径（PRD §7-6）？** 本轨 4 个测试文件复核为 0 条可见英文字面量断言；
   服务端回显值（类型名、`640 B` / `2.0 KB`、`noeviction`）与 `data-*` / `data-i18n-key` 断言合规。
8. **单文件规模？** `kv-bar/*` 最大 224 行、`RedisWorkbench.tsx` 664 行，均在 800 行红线内。
9. **是否存在跨轨越界改动？** 未越界：`ui/overview/**`、宿主 `src/**`、`hub.md`、他轨目录零改动；
   `en.ts` 仅追加本轨命名空间。

## 【留待 R 回归】清单（真连 Redis / E2E 才能证；本轮**未跑任何 e2e**）

沿用上表 R1~R8，并按本轮结论调整：

| # | 待验 | 本轮变化 |
|---|---|---|
| R1 | 真机切键 → 状态条/侧栏跟随；编辑器改值 → dirty 徽标；切库/关面板 → 复位 | 进程内四条退出路径已由 `[tester]` 用例钉住（M1/M2/M8 为红），**真机中继写者与面板复用仍须 e2e** |
| R2 | 抽屉开关判据必须查驱动自身 `redis-kv-key-props-sidebar` | 单测已钉（M12/M15 红），真机 DOM 层级待复证 |
| R3 | 真实过期键走空态且不残留上一个键的 type/size | **升级为 BUG-001**（进程内已证伪，不再只是“待真连”）；真连场景仍建议复证一次 |
| R4 | 非 LFU 服务器 ⇒ freq 行为具名空态而非 0 | 单测双向覆盖（真实 freq 与 null 各一条），报错文本待真连 |
| R5 | 托管/ACL 禁 `INFO` ⇒ 策略行退化 `—` 且不影响其余 6 行 | 替身已覆盖四层降级形状；**刷新不重读策略 = BUG-003** |
| R6 | Cluster / Sentinel 下 `key_object_info` 按槽位寻址（`redis-cmds-p0` BUG-007 面） | 本轮未触 Rust，待真集群 |
| R7 | 非 redis 驱动 KV 面板不出现两槽位 | 注册侧已加“只允许 `dbType:'redis'`”护栏（M11 红）；宿主渲染行为属集成面 |
| R8 | 驱动 UI 测试必须带 `--config vitest.drivers.config.ts` | 本轮全部命令按此口径执行并写入本台账，建议后续任务书直接给全命令 |
| **R9（新增）** | BUG-002 的重复往返在真链路（远程 / 高 RTT / 托管）上的实测延迟与 QPS 影响 | 进程内已量化为 `reads-per-selection=2`；是否值得引入 in-flight 去重需真机数据支撑裁定 |

---

# 第 1 轮修复回合（Coder，BUG-001~004 全部修完）

> 输入：同目录 `bugs.md` 4 条 `待修复` + 协调者逐条裁定。产出：4 个 fix commit + 本节。
> 现场：`feature/redis-kvbar-ui`（未 rebase、未合流），工作区干净。
> **`.rs` 一行未改**（本轨纯 TS；bugs.md 对 BUG-004 的 `ops_workbench.rs:425/:439` 引用只作为
> “该形状后端可达”的证据，修的是渲染侧消费，故未跑 `cargo test -p datazen-driver-redis`，
> 也不存在文件面越界需要解释）。未跑任何 e2e / `pnpm build` / `pnpm install`。

## 四条 commit

| Bug | sha | 一句话 |
|---|---|---|
| BUG-001 (Major) | `eea7e0d0a` | 读数带**归属**（owner = 会话+库+键），发布前按归属过滤 ⇒ 切键即失效 |
| BUG-002 | `2dec2f402` | 同一面板内同一键的两次读**合并为一次往返**（in-flight join，零值缓存） |
| BUG-003 | `90d0fb9f2` | 刷新按钮同时重读 `maxmemory_policy`（`attempt` 进 policy effect 依赖） |
| BUG-004 | `5e145f566` | `PTTL -2` 与 `-1` 在渲染侧分词；配对用例改断言另一臂 |

## 逐条修法与裁定符合性

### BUG-001 — 状态所有权（裁定：“让 in-flight 状态与被选中的键绑定，不是加一层记得清一下的补丁”）

`packages/drivers/redis/ui/kv-bar/useKeyObjectInfo.ts` 重写：

- 状态从 `{info, loading, failed}` 变为 `{owner, info, loading, failed}`，
  `owner = {dbSessionId, dbIndex, key}`（`keyObjectInfo.ts` 层不动）。
- 新增**导出的纯函数** `publishRead(read, current)`：owner 令牌不等 ⇒ 发布
  `{info:null, loading:false, failed:false}`。它在 **render 期间**被调用，
  因此“选中新键 → effect 启动下一次读”之间那一帧也不再打印旧键属性；
  不依赖 `useEffect` 顺序，也不依赖 `stale` 闭包旗标（旧旗标已删，被 owner 校验吸收）。
- 回复落地时二次校验：`setRead(prev => readToken(prev.owner) === readToken(owner) ? … : prev)`
  （成功/失败两侧都校验），乱序回包不能改写新键的状态。
- 同步删除了原 docblock 里“迟到回复会被 effect identity 丢弃”这一**与实测相反**的声明，
  以及 `Last successful reply for the current key` 注释（bugs.md 处置项 3）。
- 新测试文件 `__tests__/kvBarRound1Fixes.test.tsx`：归属规则在纯函数层逐字段单独钉
  （会话 / 库号 / 键名 各一条，删任一字段只红对应那条），飞行窗口与乱序回包在 statusBar 槽位层钉。
  原 `kvBarSlotTesterGaps.test.tsx` 两条 `it.skip`（BUG-001 侧栏半 + 状态条半）**已解开**并转绿。

### BUG-002 — 选 **(a) in-flight 去重**（裁定二选一，明确不选 (b)）

理由：本轨能自己闭环，不需要新契约、不需要把缺口推给 W2-C。实现
（`useKeyObjectInfo.ts::sharedKeyObjectInfo`）：

- `const openReads = new WeakMap<KvSlotState, Map<string, Promise<KeyObjectInfo>>>()`，
  内层键是 owner 令牌（会话+库+键）。
- **缓存的键空间就是中继对象本身**：宿主 `useKvWorkspaceSlots` 把同一个 `panelState`
  展开给 `statusBar` / `keyPropsSidebar`（同一 relay 对象身份），所以合并只发生在
  “同一面板内的两个槽位”之间；面板卸载 ⇒ relay 被 `pruneKvSlotStates` 丢弃 ⇒ WeakMap
  条目随之可回收。**没有 module-level 值缓存**：表里存的是**进行中的 Promise**，
  `.finally()` 里立刻 `delete`， settled 之后任何一次刷新/再选都会真发新命令
  （`kvBarRound1Fixes` 里“换键与刷新各自再读一次”“失败也被遗忘，不跨重试粘住”两条为证）。
- 失败也只共享**这一次**往返的结果：两个槽位对同一个键的同一份真相应当一致（侧栏重试成功后
  状态条仍停在 `failed`，因为 `reload` 是**每槽位**的 attempt —— 该行为已由一条显式断言钉住，
  将来若改成共享 attempt 必须故意翻转它）。
- 跨面板**不**共享（不同 relay ⇒ 不同 scope，有用例）；这是刻意的，符合“不得跨面板缓存值”的裁定。
- 未改动 `KvSlotState`、`driver-sdk` 类型、宿主任何文件，故**不移交 W2-C**。

### BUG-003 — 刷新覆盖策略行

`KeyPropsSidebar.tsx` 的 policy effect 依赖从 `[open, dbSessionId]` 改为
`[open, dbSessionId, attempt]`，`attempt` 由 hook 返回（`reload()` 即 `setAttempt(n=>n+1)`）。
保留“迟到策略回复不得覆盖新会话”的既有不变量（`stale` 旗标未动，P2 变异为红为证）。
策略旧值在重读期间**可见**是刻意的：它是服务器级事实，不是另一个键的属性，不构成误归属
（与 BUG-001 的口径区分写进了注释）。实测：点击刷新 `key_object_info 1→2` 且 `info_filtered 1→2`。

### BUG-004 — 两个 PTTL 哨兵分词

- `KeyPropsSidebar.tsx` ttl 行：`fallbackKey={ttl?.kind === 'missing' ? 'redis.keyProps.missing' : 'redis.noExpiry'}`
  （词条复用，未新增 i18n key）。`describeTtl` 的三态分离至此**三个分支全部有消费者**。
- `KvStatusBar.tsx`：`-2` 仍不渲染 TTL 段（bugs.md 建议口径），注释改为写明“侧栏用词、状态条沉默、
  两侧都不得把它说成永不过期”。
- 测试：解开了登记的 `it.skip('labels a gone-by-PTTL key as gone…')`；其**常驻绿测**
  `pins today behaviour…` 按裁定从“断言旧的错词”改写为断言**另一臂**
  （`-1` ⇒ `redis.noExpiry`），两条成对，任一臂回退都红；`kvBarRound1Fixes` 追加跨槽位一致性
  一条 + 一条控制用例（`ttlMs>0` 时状态条**必须**出 TTL 段，防“沉默”断言空跑）。
  **没有删除任何断言**，全部按 `data-*` / i18n key / 服务端回显值定位。

## 门禁实跑数字（Coder 本机 worktree 根目录，逐条修复后各跑一次）

| 时点 | `tsc --noEmit` | `vitest run --config vitest.drivers.config.ts` | `ui/kv-bar/**` v8 覆盖率 | `npx vite build` |
|---|---|---|---|---|
| 基线（Tester 判定后） | 0 错误 | 37 files / 293 passed \| 3 skipped (296) | — | — |
| BUG-001 后 | 0 错误 | 38 files / 303 passed \| 1 skipped (304) | 100/100/100/100 | ok 5.37s |
| BUG-002 后 | 0 错误 | 38 files / 307 passed \| 1 skipped (308) | 100/100/100/100 | ok 4.88s |
| BUG-003 后 | 0 错误 | 38 files / 309 passed \| 1 skipped (310) | 100/100/100/100 | ok 5.08s |
| BUG-004 后（**新基线**） | 0 错误 | 38 files / **312 passed \| 0 skipped (312)** | 100/100/100/100 | ok 4.94s |

> BUG-004 一行是对**已提交的 `5e145f566`** 重跑的数值（该提交内含 BUG-004 全部码面改动）。

- 覆盖率命令：`npx vitest run --config vitest.drivers.config.ts --coverage.enabled --coverage.include='packages/drivers/redis/ui/kv-bar/**'`；
  列为 Stmts / Branch / Funcs / Lines 四值。`index.ts` 那行显示 0 是**再导出桶文件无可计语句**，
  “All files”总计仍为 100×4。
- 覆盖率未低于第 1 轮实测的 100%（四指标全 100），且 `it.skip` 由 3 条降到 **0 条**。
- 附带 `node scripts/check-driver-import-boundaries.mjs`：`ok (1431 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))`
  —— 4 条 advisory 均为**既有**宿主侧发现，本回合未新增。
- 单文件规模：`KeyPropsSidebar.tsx` 235 行、`useKeyObjectInfo.ts` 216 行、`KvStatusBar.tsx` 105 行，
  均在 800 行红线内；新增测试文件 `kvBarRound1Fixes.test.tsx` 502 行。

## 变异复证表（阶段 C 口径；注入后由 `/tmp/mutrun.py` 快照还原，**未使用 `git checkout`**）

跑的是三个 kv-bar 测试文件（16 + 17 + 16 = **49** 条）；“红数”即 `Tests N failed`。

| # | 注入 | 期望 | 实测 |
|---|---|---|---|
| M1 | effect 进入 loading 时保留 `prev.info`（即修复前代码） | 至少一条红 | **20 红** |
| M2 | 成功回包去掉 owner 校验 | 红 | 3 红 |
| M3 | 失败回包去掉 owner 校验 | 红 | 1 红 |
| M4 | owner 令牌不含 `dbSessionId` | 对应那条红 | 2 红 |
| M5 | owner 令牌不含 `dbIndex` | 对应那条红 | 2 红 |
| M6 | `publishRead` 的过滤整个删掉 | 红 | 3 红 |
| M7 | `ownerOf` 忽略 `dbIndex` | 红 | 1 红 |
| M8 | hook 忽略 `enabled` 参数（第 4 参当常量） | — | **存活（等价变异）**，见下注 |
| N1 | 去掉 in-flight join（各槽位各发一次） | 红 | 3 红 |
| N2 | 合并表按全局键名而非 relay 建键（跨面板共享） | 红 | 2 红 |
| N3 | settled 后不 `delete`（变成值缓存） | 红 | 3 红 |
| N4 | 合并令牌忽略键名 | 红 | 2 红 |
| N5 | 合并令牌忽略会话 | 红 | 1 红 |
| P1 | policy effect 依赖退回 `[open, dbSessionId]` | 红 | 2 红 |
| P2 | 去掉“会话已切换则丢弃策略回复”守卫 | 红 | 1 红 |
| P3 | 刷新按钮不再接 `reload` | 红 | 5 红 |
| Q1 | ttl 行退回固定 `redis.noExpiry`（修复前） | 红 | 2 红 |
| Q2 | ttl 行两臂互换 | 红 | 4 红 |
| Q3 | `describeTtl` 把 `-2` 并入 no-expiry 臂 | 红 | 3 红（含纯函数层 `separates the three PTTL meanings`） |
| Q4 | 状态条对 `-2` 也渲染 TTL 段 | 红 | 1 红 |

**M8 存活注（等价变异，非覆盖缺口）**：注入的是“hook 无视第 4 参 `enabled`”，
而侧栏在抽屉收起时**除** `enabled=false` **外**还额外把键换成 `null`
（`KeyPropsSidebar.tsx:51-57` 的 `open ? selectedKey : null`），owner 因此仍为 `null` ⇒
仍零请求，故该注入在语义上与“不拆”等价。它与第 1 轮 Tester 表的 **M13 互为镜像**
（M13 拆三元、保 `enabled`，同样存活），两条合起来说明这是**同一保证的两道冗余闸门**，
而不是没人守的行为：“抽屉收起零往返”这一保证本身由 Tester 的 M14（只拆 `enabled`）/
M15（两道全拆）钉住。本回合**不再为单拆任一闸门追加用例**，在此登记以免下一轮重复注入。

## 本轮结论与遗留

- **明确未做（不是漏做）**：
  1. `contextBar` 全量版 —— 按裁定归 Rescuer-B；
  2. `KvSlotState` 加宽（`keys` / `loaded` / 扫描游标 / 多选数 / 最后写操作）—— 归 W2-C，本回合零改动；
  3. 跨面板 / 跨会话的**值**缓存 —— 裁定明令禁止，未做；BUG-002 只做到 in-flight 往返合并；
  4. Rust 侧 `missing`/`ttl_ms` 的口径统一（让后端在 `-2` 时直接置 `missing:true`）—— 属 `redis-cmds-p0` 文件面，
     本轨只在渲染侧消费，未越界；
  5. 真连 / e2e 复证（下表 R 系列）—— 未跑。
- **R9 口径更新**：`reads-per-selection` 已由 2 降到 **1**（进程内实测断言），
  “是否值得引入 in-flight 去重”不再待裁定；仍待真机的是**去重后单次往返的延迟分布**，
  以及是否需要值级缓存（本轮按裁定明确不做）。
- **下一步入口**：全新 Tester 实例按 `bugs.md` 四条的“重现步骤 + 建议修法”逐条复测，
  门禁以本表“BUG-004 后（新基线）”一行为对照（312 passed / 0 skipped / 覆盖率 100×4）。

