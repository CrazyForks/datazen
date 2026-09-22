- 任务: KV 上下文条/状态条/键属性侧栏（驱动侧槽位实现，PRD §3.4 / 裁定 8-2、8-3）
- 状态: READY_FOR_TEST（Rescuer-A 范围 1~7 全绿；上下文条按拆分交 Rescuer-B）
- 编码 commit: `cc054de7d` + `6e3624c7f` + `f86ad9973` + `5b9c02e90`（中继接线 `952979543`）
- 测试 commit: `952979543`（继承 `kvSlotRelay.test.tsx` 377 行 / 11 例）+ `cc054de7d`、`6e3624c7f`（新增 `kvBarSlots.test.tsx` 368 行 / 17 例）
- 合并 commit: —
- 代理: w2a-kvbar-rescuer-a
- Worktree: .worktrees/datazen-redis-kvbar-ui
- 分支: feature/redis-kvbar-ui
- 心跳: 2026-09-22 10:52

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
