- 任务: 键详情常驻编辑重排 + I-1 dirty 拦截 + 8-1 五枚页签（PRD §3.3、§4 I-1/I-5、§8-1、§8-4）
- 状态: **READY_FOR_TEST（修复轮第 2 回合完成：BUG-007 已修复待复测，Bug 循环 2/5 → 待第 3 轮复测）**（第 2 轮复测判定 TEST_FAILED 历史：文件面审计 + 四门禁全绿、6/6 已声明修复翻「已修复」、偏差①-⑤ 成立；偏差⑥ 立案 **BUG-007**（I-1 静默毁草稿残留旁路，高）⇒ coder round-2 修复 `9714509b1` + P1b 转正，四门禁提交态复跑全绿（G1 `59 files/560 passed/0 skipped` · tsc 0 · build 0 · boundaries `1473/0/4`）。第 1 轮历史状态：门禁全绿 + 登记 6 条 Bug、Bug 循环 1/5）
- 第 1 轮 Tester: **w3e-tester-r1**（全新实例，只测不修）· 复验记录见本文件末尾「第 1 轮 Tester 复验记录」· Bug 见 `bugs/`（一 Bug 一文件，索引 `bugs/README.md`）
- Tester commit 链（12 笔，边测边 commit，无 >15min 无落盘区间）:
  `dbd9218e0` 阶段 A/B 台账（BOOTSTRAP + 门禁 + E-1/E-2）→ `da4bc9531` 补测 I-1 支路 8 例（+3 skip 占位）
  → `e0901a717` **BUG-001** → `a3315e84e` **BUG-002** → `6e4a89bf9` **BUG-003** → `449db8059` **BUG-004 + BUG-005**
  → `9c02aefbe` **BUG-006 + bugs/README 索引** → `515eeb35e` 补测 StringEditor 支路 6 例 → `307d60a0a` 补测 invoke/ValueViewer 7 例
  → `444d970b0` 补测截断徽标 2 例 → `c46c3a831` 复验记录 T-4..T-12 → `ca43d72d6` E2E 登记表 T-13
- Tester 终态：`58 files / 546 passed / 3 skipped`（+21 例）· tsc 0 · vite build 0 · boundaries 1472 files / 0 blocking · **生产码零改动**
- 心跳: 2026-09-23 12:26（Tester 收口；本节以下为复验记录）
- 编码 commit: `b4d5df64d`(E-1 五枚页签) · `63c5ce0b3`(E-2 常驻编辑) · `96170add2`(E-3 I-5 收敛) · `116de7495`(E-4 键头行) · `f5a273cd2`(E-5 I-1 拦截)
- 测试 commit: `fa469154c`(E-5 dirty-leave 旅程电池 +54 行：Esc 关闭 / 卸载悬起 / 非法 JSON 三条边角出口)
- 门禁 commit: 见本文件所在 commit（`docs(coordination): W3-E detail-ui gates + self-verification record`）
- 合并 commit: —
- 代理: **w3e-rescuer-finish**（收尾代理，全新实例；链：w3e-detail-ui-coder → Rescuer(实现落盘于 `f5a273cd2`) → 本代理）。本代理只执行门禁四件套 + 覆盖率 + 台账收口，**未新增功能、未改生产码**。
- Worktree: .worktrees/datazen-redis-detail-ui
- 分支: feature/redis-detail-ui
- 心跳: 2026-09-22 23:42

# W3-E `redis-detail-ui` 简报（协调者下发）

## 0. 必读（按序）
1. `AGENTS.md`、`docs/development/subagent/coder.md`、本文件
2. `docs/todo/redis-workbench-ux/PRD.md` §3.3（屏 B 右列键详情全段：键头行 / 徽标行 / Codec 行 / View 行 /
   编辑区常驻 / 底栏 dirty 驱动）、§4 I-1 / I-5 / I-11、§8 裁定 8-1 与 8-4
3. 现状代码：`packages/drivers/redis/ui/value-editors/`（`KeyEditors.tsx` 458 行、`TtlControls.tsx`、
   `keyEditorsInvokes.ts`、`stringKeyValue.ts`、`ValueViewer.tsx`、`valueView/`、各类型 Editor）、
   `ui/connection/RedisConnectionView.tsx`（`ActiveTab` 与 `TABS` 在 :12-24，当前 **4 枚**）、
   `ui/observe/`（现有面板形态参考）
4. `ui/__tests__/keyEditorsInvokes.test.ts`、`ttlControlsJourney.test.tsx`、`stringKeyValue.test.ts`、`valueView.test.ts`
   （本轨会把它们改红再改绿，**按新形状改写断言**，不许整条删掉）

## 1. 交付单元（**按此顺序，每个单元立即 commit**）
150 轮上限是本项目头号死法：做完一个 commit 一个；接近上限提交现场并返回 `PARTIAL` + 精确剩余清单。

1. **E-1 五枚页签（裁定 8-1）**：`TABS` 现为 `items | console | monitor | pubsub`（4 枚），
   裁定要求 **5 枚：键详情 / 命令行 / 发布订阅 / 监控 / 慢日志** ⇒ 慢日志升为一级页签。
   新建 `ui/observe/SlowlogPanel.tsx`，数据走既有 `slowlog_get` 命令（屏 A 已在用，零新增后端）。
   权限缺失 / Redis 不支持 ⇒ 具名空态（不是 0 条、不是留白）。
2. **E-2 删掉「查看 / 编辑」切换（§3.3 的核心冗余）**：`redis-string-mode-toggle` 两枚按钮与 `mode` state
   整体删除（现落在 `KeyEditors.tsx` 的 toggle 段，PRD 原文引用 :315-342，代码已位移，**按符号名找不要按行号**）。
   编辑区改为**常驻可编辑**。同步改写 `keyEditorsInvokes.test.ts` 等受影响断言。
3. **E-3 I-5 只读态收敛为「只剩两种」**：① Hex / Binary 视图（二进制不可原样回写）② `frame.truncated`
   或大 value 判定。两种都必须**给出原因文案**。除此之外任何"只读"分支删掉。
   大 value 哨兵：`GETRANGE 0 65537`，返回长度 > 65536 即判定截断（不必先传整包）。
4. **E-4 键头行 + 徽标行重排**：键头 = key 名（等宽、可截断带 title）+ 动作图标组
   （刷新**分裂按钮**：下拉选自动刷新间隔 1s/5s/10s/30s/关 · 复制键名 · 复制插入语句 · 重命名内联 · 删除危险色）。
   徽标行 = 类型 | `大小: N B`（复用现有 `ValueFrame.memBytes`/`formatSize`）| TTL pill。
   **TTL pill 点击即变内联三态编辑器**（`永不过期 / 相对 TTL / 绝对时间(EXPIREAT)`），
   用它替代现在整行挂载的 `TtlControls`（在 `KeyEditors.tsx` 里作为独立一行的挂点）—— 省一行高度。
   裁定 8-4 = **照抄**参照文案：`永不过期`、`自动换行`、`大小: N B`、`放弃`（中文文案由 i18n-sync 在发布前补，
   开发期只写 `en.ts` key，但 key 语义要能承载这些文案）。
   自动刷新与手动刷新在 dirty 时必须被拦截（见 E-5）。
5. **E-5 dirty 底栏 + I-1 拦截（本轨最重的一条，放在最后做）**：
   - 底栏：`放弃` / `保存` **仅在 dirty 时出现并高亮**（现状 dirty 只发布事件，没有底栏语义）。
   - I-1：有未保存草稿时，**刷新 / 自动刷新 / 切键 / 切页签 / 切 db** 一律先弹「放弃更改 / 继续编辑」
     （用 `@datazen/ui` 的 Dialog，不新造弹层）。
   - 现状缺陷必须一并消掉：**切 db / 刷新 / 搜索会静默清 dirty**（绕过 I-1，用户草稿无痕消失）。
   - 保存语义走 `SET ... KEEPTTL`：`keepTtl` 复选删除（后端默认化在 W3-C，
     若你合流时 C 尚未落地，**不传该参数**即可，不要自己造第二个默认值开关）。
   - 编辑器按 key 重挂载（`key={detail.key}`）这条 W2 结论沿用，别改回去。

## 2. 明确不做（防范围漂移）
- 集合类（hash/list/set/zset）**虚拟表格 + `loaded/total` + 服务端字段搜索 + 可排序列** 本轨不做（Wave 4/5 单开轨）。
  现状 zset 客户端排序保持不动。
- Stream 面包屑（`stream › group › consumer`）本轨不做。
- hash field TTL（`HEXPIRE`，P2）、`protobuf` codec（P2）不做。
- 不接 `KvSlotState` 新增 getter/setter（Wave 4 与 W3-A 有先后关系）；本轨只沿用既有 `getDirty/setDirty`。
- 不碰 `ui/key-browser/**`（W3-D 拥有）、`ui/console/redisConsoleDanger.ts`（W3-F 拥有）、
  `ui/kv-bar/**`（已合入，只读参考）、宿主 `src/**` 与 `packages/driver-sdk/**`（W3-A 拥有）、
  `packages/drivers/redis/src/**`（W3-B/C 拥有）。
- 不碰 `ui/shared/meta.ts` 与 `scripts/resolve-drivers.mjs`（本轨不新增槽位）。

## 3. 冲突面声明
`packages/drivers/redis/locales/en.ts` 与 W3-D / W3-F 同时加文案。规则：**只追加自己的命名空间
`redis.detail.*`（页签文案沿用既有 `redis.*` key，不重命名）**，不改他人 key、不重排。
`RedisConnectionView.tsx` 本轨独占（W3-D 不碰）。

## 4. 门禁与交付
1. `npx vitest run --config vitest.drivers.config.ts`（基线 47 files / 456 tests，只许增不许红）。
2. `npx tsc --noEmit` = 0；`npx vite build` 通过（禁裸 `pnpm build`）。
3. `node scripts/check-driver-import-boundaries.mjs` = 0 blocking。
4. 每条交互写**连续旅程测试**（击键/切换/dirty 全过程 + 中间态 + 退出跃迁），选择与点击用 `data-*` 绑定，
   禁视口几何反查；禁止只测静态合法态。
5. 本轨改动代码覆盖率 ≥80%，缺口在 `## 自验记录` 点名。
6. **禁止英文字面量断言**：`ui/__tests__/ttlControlsJourney.test.tsx` 的 `getByText('No expiry')`
   （PRD §7 点名 :21/:79/:378）本轨顺手改写为 key / `data-*` 断言 —— **改写不是删除**。
7. 本文件追加 `## 自验记录`（命令 + 数字 + 五个交付单元各自落点文件 + E-5 的状态机三要素表）。
8. 返回 `READY_FOR_TEST`。

## 5. 环境纪律（违反即返工）
- 工作目录固定 `.worktrees/datazen-redis-detail-ui`；禁写其他检出（主检出与 integrate worktree 只读）。
- Grep 工具搜索（禁 bash `grep -r`）；禁 `pnpm install`（node_modules 已软链）。
- 禁 live `pnpm e2e` / `pnpm tauri:build:webdriver`；需真实 Redis 的场景登记进 `## 留待 R 回归`。
- 禁提交 gitignored codegen / `Cargo.lock` / 注入过的 `src-tauri/Cargo.toml`；禁改 `hub.md` 与他轨文档。
- i18n 开发期只改 `en.ts`；单文件 ≤800 行（`KeyEditors.tsx` 458 行，重排时按类型/职责拆，别就地堆大 if）。

## 自验记录（w3e-rescuer-finish · 2026-09-22 23:42）

工作目录 `.worktrees/datazen-redis-detail-ui`，HEAD 起点 `f5a273cd2`（E-1..E-5 实现均已由前任 Rescuer 落盘）。
本代理**未改任何生产码、未加任何功能**，只跑门禁、补测试提交、收台账。

### 1. 门禁四件套（严格串行，一次一条）

| # | 命令 | 结果 |
| - | ---- | ---- |
| 1 | `npx vitest run --config vitest.drivers.config.ts` | **55 files / 525 tests 全绿**（0 failed / 0 skipped）· 9.79s |
| 2 | `npx tsc --noEmit` | **exit 0**，0 error |
| 3 | `npx vite build` | **exit 0** · `✓ built in 4.76s`（仅 chunk >500 kB 的既有 advisory 警告，非本轨引入） |
| 4 | `node scripts/check-driver-import-boundaries.mjs` | **exit 0** · `1469 files scanned · 0 blocking violation(s) · 4 advisory finding(s)`（4 条 R3 advisory 均为既有 host→driver 引用，非本轨新增） |

第 1 步单独实跑本轨最重的旅程电池：
`npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/dirtyLeaveJourney.test.tsx`
→ **11 tests 全绿**（460ms）。前任遗留的 +54 行（3 条边角出口用例：Esc 关闭 / 卸载时悬起落地 / 非法 JSON 保存）**一次通过，无需降级 `it.skip`，无需改实现**，故按步骤 1 的绿路直接以 `fa469154c` 提交。

### 2. 交接现场核对（三处与下发简报不符，均已实测澄清）

| 简报说法 | 实测 | 处置 |
| -------- | ---- | ---- |
| 基线 ≈54 files / 583 passed + 2 skipped | **55 files / 525 passed / 0 skipped** | 只许增不许红 ⇒ 满足（无红）；差值来自本 worktree 的 drivers 套件实际用例集，台账以实测为准 |
| `RedisWorkbench.tsx` 行数 531→537（D 轨验收基线 531） | 实际 **705 →(HEAD) 760**；全仓 redis UI 内**不存在**任何 531 或 537 行的文件 | 见 §3 行数条 |
| 旅程覆盖「换键⌘Y / 切db⌥⌘Y / ⌘R / 批量对话框 / 批量TTL / 列设置」 | **这些键位在本仓根本不存在**：全仓仅 `app_menu.rs` 有 `CmdOrCtrl+,` / `CmdOrCtrl+N` 两枚 accelerator，redis UI 内唯一的组合键是 `RedisConsole.tsx:210` 的 Mod+Enter；宿主亦无任何 `refreshKeys` 快捷键接线。`dirtyLeaveJourney.test.tsx` 的 11 条用例实际为：状态机 / 脏底栏 / 切键 / 切db / 工具栏刷新 / 头行刷新 / 保存先发布干净 / 切页签 / Esc / 卸载 / 非法 JSON | 八拦截点与「自动刷新 tick 被拦 ⇒ 落关」均有实测断言（见 §5）；批量对话框与批量 TTL / 列设置**经 `KeyWorkbenchDialogs` 的 `onRefreshKeys=refreshKeys` 间接吃到 §5-#3 守卫**（代码面已拦截），但**无专属断言**，且简报所列「⌘R / ⌘Y / ⌥⌘Y 旅程」在本仓无对应实现 ⇒ 记为遗留（§8），未擅自补功能 |
| `progress.md` 有 `## 修复轮交接（协调者）` 节 | 该节在本 worktree 的 progress.md 中**不存在**（全文 87 行，仅协调者简报 §0–§5；`git log --all -S"修复轮交接"` 零命中） | 交接手册给出的**锚点本身逐条实测通过**（下表），故按锚点接手，不依赖其文档 |

拦截文案「五类」核对：`redis.detail.leave.title` / `.description` / `.discard` / `.keepEditing` 四枚在
`packages/drivers/redis/locales/en.ts:508-511`，加 I-5 两枚只读原因 `.readonly.binaryView`(488) / `.readonly.bigValue`(490)
与底栏 `redis.detail.discard`(507)——文案齐备，且 `DraftLeaveDialog.tsx:17` 已裁定「断言口径 = `data-testid` 定位、
文案只断 `data-i18n-key`」，全仓无英文字面量断言（简报 §4-6 达成）。

### 3. 步骤 2 核对：`git diff 8981d3078..HEAD -- ui/key-browser/`

**结论：不是「仅 `requestDraftLeave` 接线」，但属 E-5 必需的语义改动，无顺手重构。** 与 D 轨合流面如实登记：

- 唯一被改文件 = `ui/key-browser/RedisWorkbench.tsx`（简报 §2 声明 D 轨拥有该目录）。改法为
  7 处 `if (!(await requestDraftLeave())) return;` 前置守卫，并把 5 个回调改为 `async` + 6 处 `void` 调用点适配。
- **一处行为改动（非纯接线）**：`reloadDetail`（:378 段）原先 `refreshKeys()` 会清 selection（E-5 守卫后等于「保存即关面板」），
  改为只重取 detail + `scanRefresh()/tree.refresh()`。这是修 E-5 自引入回归的必要补丁。
- 一处同类守卫下的等价改动：`handleSelectDb` 增加同库重点击早退（避免初始自动选中误弹 I-1 对话框）。
- 行数 705 → 760（+55），**远低于 ≤800 上限**；「不回升」这一实质要求满足（无回升迹象、HEAD 即终值 760），
  但**简报的 531 基线与 D 轨无关本文件、且本仓不存在该数值**——请协调者在合流时以 **760** 为准与 D 轨重新对齐，
  本代理未改行数、未改 `RedisWorkbenchHandle` 契约（`refreshKeys: () => void` / `selectDatabase` 签名与 base 一致，
  实现内部转 async 但对外形状未变，故 D 轨调用侧无需跟改）。

### 4. E-1..E-5 落点文件

| 单元 | commit | 落点 |
| ---- | ------ | ---- |
| E-1 五枚页签（裁定 8-1） | `b4d5df64d` | `ui/observe/SlowlogPanel.tsx`(新 263 行) · `ui/connection/RedisConnectionView.tsx`（`TABS` 4→5） · `ui/__tests__/redisTabBarJourney.test.tsx`(新) · `slowlogPanelJourney.test.tsx`(新) |
| E-2 常驻编辑（删查看/编辑切换） | `63c5ce0b3` | `ui/value-editors/KeyEditors.tsx`（-toggle/mode state）· `ui/value-editors/StringEditor.tsx`(新 303 行) · `keyEditorsInvokes.test.ts` 改断言 · `stringValueReadOnlyJourney.test.tsx`(新) |
| E-3 I-5 只读收敛为两种 | `96170add2` | `ui/value-editors/keyReadOnlyPolicy.ts`(新) · `redisBigValue.ts`(新，`GETRANGE 0 65537` 哨兵) · `ValueViewer.tsx` · `redisBigValue.test.ts`(新) · `keyReadOnlyPolicy.test.ts`(新) |
| E-4 键头行 + 徽标行 + TTL pill | `116de7495` | `ui/value-editors/KeyHeaderRow.tsx`(新 320 行) · `TtlControls.tsx`（整行→内联三态 pill）· `redisInsertStatement.ts`(新) · `keyHeaderRowJourney.test.tsx`(新 422 行) · `ttlControlsJourney.test.tsx`（+177，含 pill 三要素旅程） |
| E-5 底栏 + I-1 拦截 | `f5a273cd2` + `fa469154c` | `ui/shared/draftGuard.ts`(新 87 行) · `ui/value-editors/DraftLeaveDialog.tsx`(新 78 行) · `KeyEditors.tsx` · `ui/key-browser/RedisWorkbench.tsx` · `RedisConnectionView.tsx` · `dirtyLeaveJourney.test.tsx`(新 446 行) · `kvSlotRelay.test.tsx`(+63) |

### 5. E-5 状态机三要素表（I-1 dirty 拦截）

进入条件 — **`publishDraftDirty(true)`**：
- `ui/shared/draftGuard.ts:19` `let dirty = false`（模块单例）· `:30-34` `publishDraftDirty(next)`（唯一写入口，`:31` 幂等短路）
- 击键侧：`StringEditor.tsx` 的 `onEdit`/`onChange` ⇒ `onDirtyChange(true)` ⇒ `RedisWorkbench.tsx` `setEditorDirty`
  与 `KeyEditors.tsx:59/69/208` 的 `onDirtyChange` 透传（写入口注释见 `draftGuard.ts:29`「保存/放弃/卸载都会落 false」）。
- `:56-57` `requestDraftLeave()`：`if (!dirty) return Promise.resolve(true)` ⇒ **干净态导航零开销**，无误弹。

状态内行为 — **8 个拦截点**（`await requestDraftLeave()` 生产码实测恰 8 处，另有 `draftGuard.ts:6` 一处文档提及）：

| # | 拦截点 | 锚点 | 拒绝后果（已测） |
| - | ------ | ---- | ---------------- |
| 1 | 切键（树行点击） | `RedisWorkbench.tsx:370`（`handleSelectKeyGuarded`；同键重点击 `:366` 早退不拦截） | 不换键、草稿存活 |
| 2 | 切 db | `RedisWorkbench.tsx:257`（同库重点击 `:255` 早退，含初始自动选中） | 不切库、不清 selection |
| 3 | 列头/工具栏刷新 | `RedisWorkbench.tsx:298`（`refreshKeys`） | 不 reload 列表 |
| 4 | 工具栏整体刷新 | `RedisWorkbench.tsx:309`（`handleRefresh`） | 不重载面板 |
| 5 | 搜索（替换 selection） | `RedisWorkbench.tsx:322`（`handleSearch`） | 不清 selection |
| 6 | 关闭详情面板 | `RedisWorkbench.tsx:697`（`onClose`） | 面板不关 |
| 7 | 清空选中键（对话框侧出口） | `RedisWorkbench.tsx:739`（`onClearSelectedKey`） | 选中与草稿均存活 |
| 8 | 切页签 | `RedisConnectionView.tsx:93`（`activeTab` 切换；keep-alive 下对话框仍可见） | 不切页签 |

状态内附加行为（编辑面内部动作，同走一个守卫）：`KeyEditors.tsx:114` 列头刷新 / `:121` 重命名 / `:134` 删除；
**自动刷新 tick** 复用 `:114` 的 `refreshNow`（`KeyHeaderRow.tsx:76-80`：tick 拿 `false` ⇒ `setIntervalMs(0)` 自动落「关」，
不追问、不 nag，`keyHeaderRowJourney.test.tsx:385` 断言）。
并发合并：`:58` `if (leavePending && leavePromise) return leavePromise` ⇒ 悬起期重复请求合到同一 Promise（无对话框堆叠）。

退出跃迁 — **保存 / 放弃 / 取消 / 卸载 四条，全部通向 `dirty=false` 或动作取消，无单向死锁**：
- `draftGuard.ts:68-76` `settleDraftLeave(proceed)`（`:74` `if (proceed) dirty = false` ⇒ 只有「放弃」清 dirty，取消保留）；
  `:80-87` `__resetDraftGuard()`（测试专用跨用例复位，生产路径不经它）。
- **放弃**：对话框 `redis-draft-discard` ⇒ `settleDraftLeave(true)` ⇒ `dirty` 落 false、原动作继续。
- **继续编辑（取消）**：`redis-draft-keep` ⇒ `settleDraftLeave(false)` ⇒ 守卫返回 false，动作整体取消，草稿原样保留。
- **Esc 关闭对话框**：等价「继续编辑」（`dirtyLeaveJourney.test.tsx:395` 新用例；selection 与草稿均存活）。
- **保存**：`StringEditor.tsx:158-162` 顺序为 `setJsonDirty(false)` → 若悬起则 `settleDraftLeave(true)` → `publishDraftDirty(false)`
  → `onDirtyChange?.(false)` → `onSaved()`（**先发布干净再重取**，故保存自身不误弹 I-1；`dirtyLeaveJourney.test.tsx:342` 断言）。
- **卸载**：编辑面 unmount 时悬起的 leave 落 `false`，不留下悬挂 await（`dirtyLeaveJourney.test.tsx:415` 断言）。
- **非法载荷不出网**：非法 JSON 保存不打后端且保持 dirty（`dirtyLeaveJourney.test.tsx:428` 断言）。

### 6. 覆盖率（v8，`--coverage.all=false`）

| 口径 | Stmts | Branch | Funcs | Lines |
| ---- | ----- | ------ | ----- | ----- |
| **A. 本轨实际改动 14 个生产文件**（`git diff --name-only` 全量，含 D 轨目录下的 workbench） | **81.22%** | 75.35% | 78.42% | **83.71%** |
| **B. 本轨自有代码**（A 剔除 `RedisWorkbench.tsx`，再剔除 §2「明确不做」的 5 个集合编辑器与未改动的 `JsonEditor.tsx`） | **86.25%** | 79.07% | 85.43% | **88.74%** |
| C. 字面圈定（`value-editors/**` glob + `RedisConnectionView.tsx` + `draftGuard.ts`，会把未触及的集合编辑器扫进来） | 55.43% | 56.43% | 47.31% | 56% |

判定：口径 A 与 B 均 **≥80%** ⇒ 交付项 §4-5 达成。口径 C 偏低**不是缺口**，而是 glob 把本轨按 §2 明确不做的
`HashEditor/ListEditor/SetEditor/ZsetEditor/StreamEditor/StreamOverview`（0.67–1.66%）与未触及的 `JsonEditor.tsx`(55%) 一并计入。
覆盖率**只用测试达成，未改生产码，未新增测试文件**（口径 B 已达标，无需补测）。

点名缺口（口径 B 内仍 <80% 的文件，均为**非 I-1 主干路径**）：
- `StringEditor.tsx` 70.65% stmts / 74.69% lines — 未覆盖集中在**解压按钮支路**（`runDecompress` 的失败/异常分支，
  需真连返回压缩载荷）与 gateWrite 拒绝分支；dirty/保存主链已全覆。
- `ValueViewer.tsx` 75.36% / 76.56% — 未覆盖为 `:124-138` 渲染兜底支路（未知 view kind），主 I-5 两态已覆。
- `KeyEditors.tsx` 76.08% stmts（lines 82.92%）— 未覆盖 `:217-244` 为**非 string 类型编辑器的分发段**（hash/list/set/zset 分派，属 Wave 4/5）。
- `keyEditorsInvokes.ts` 82% / funcs 57.14% — `:306-321` 为集合类批量 invoke 辅助（本轨未动其语义）。
- `RedisConnectionView.tsx:73`（`handleSelectDatabase` 转发，经 host 侧调用）与 `draftGuard.ts:69`（`settleDraftLeave` 在无悬起请求时的早退，防御分支）各 1 行。
- `SlowlogPanel.tsx` 90.9% — `:113-114`（权限缺失具名空态需真连 403）、`:233` 为兜底。
- `RedisWorkbench.tsx`（D 轨目录，口径 A 内）70.16% — 未覆盖主要是 `:688-691/:738-741` 之外的右键菜单/批量/导入导出**既有**支路，非本轨引入。

### 7. 留待 R 回归（需真连 Redis / GUI，禁 live e2e）

1. **真 Redis 保存往返**：`SET ... KEEPTTL` 语义端到端——TTL 在保存后是否保持不变（后端默认化在 W3-C；本轨按简报未传 `keepTtl` 参数，若 C 已合流需复验其默认值生效）。
2. **keepTtl 后端默认化效果**：与 W3-C 合流后跑一次「无 TTL / 有 TTL 两键各保存一次」的真连往返。
3. **自动刷新 GUI 真值**：1s/5s/10s/30s 实际 tick 与「dirty 时 tick 被拦 ⇒ 自动落关」在真实渲染下的观感（jsdom 只验了状态机，未验计时器手感与菜单定位）。
4. **大 value 哨兵真连**：`GETRANGE 0 65537` 在真实 >64 KiB 载荷上的截断判定与只读原因文案可见性（含 `MEMORY USAGE` 徽标 `大小: N B` 的真实数值格式）。
5. **慢日志页签真连**：`slowlog_get` 在有/无 `SLOWLOG` 权限、以及 Redis < 2.2.1 不支持时的**具名空态**（单测只能验 mock 返回）。
6. **对话框视觉/焦点**：`DraftLeaveDialog`（`@datazen/ui` Dialog）在暗色主题下的焦点陷阱、Esc 可达性与 z 序（与 keep-alive 隐藏页签叠层）。

### 8. 遗留事项（本代理未处理，交协调者判定）

1. **简报与现场不符的三处**（详见 §2 表）：门禁基线数字、`RedisWorkbench.tsx` 531/537 行数说法、
   `progress.md` 缺失的 `## 修复轮交接（协调者）` 节。实现与门禁本身不受影响（锚点逐条实测通过），
   但**合流前需以实测值 760 与 D 轨重新对齐行数基线**。
2. **简报所称「⌘Y / ⌥⌘Y / ⌘R 快捷键旅程」在本仓无对应实现**：既无 accelerator，宿主也不接 `refreshKeys`。
   若 PRD 确实要求这三枚键位，属**未开工能**，本轨已 READY_FOR_TEST 的范围不含它，需另立单元。
3. **批量对话框 / 批量 TTL / 列设置无专属 I-1 断言**：代码面经 `onRefreshKeys → refreshKeys`（§5-#3）已受守卫，
   但没有一条测试验证「脏时批量操作会先弹放弃对话框」。补测属测试面工作（不需改生产码），
   本轮按「不加功能」纪律未做。
4. **步骤 2 的「仅接线」预期不成立**（§3）：`ui/key-browser/` 有 1 处必要行为改动（`reloadDetail` 不再清 selection）
   与 1 处等价早退（同库重点击）。D 轨并行修复若也改 `RedisWorkbench.tsx`，**合流冲突面在此**，
   但改动均为局部 hunk、无重写，按符号名合并即可。

---

## 第 1 轮 Tester 复验记录（w3e-tester-r1 · 全新实例 · 只测不修）

工作目录 `.worktrees/datazen-redis-detail-ui`，起点 HEAD `3919307ce`，工作树干净，分支 `feature/redis-detail-ui`。
心跳：见本节各小节时间戳。**边测边 commit**。

### T-0 BOOTSTRAP

- `git status --porcelain` 空；`git log --oneline -1` = `3919307ce`。
- 本轨 diff 范围：`git diff --name-status 8981d3078..HEAD` = **28 个文件**（1 台账 + 1 locale + 9 测试(5 新 4 改) + 生产码 17 个文件/新建 8 个）。
- **禁改面零 diff 实测通过**：`git diff 8981d3078..HEAD -- ui/key-browser/BatchBar* ui/key-browser/ImportExport* ui/shared/redisInvoke.ts ui/console/** src/** packages/driver-sdk/** packages/drivers/redis/src/**` → **空输出**（exit 0）。`KeyWorkbenchDialogs.tsx` / `DetailColumn.tsx` / `KeyTreeColumn.tsx` 等 key-browser 其余 13 个文件同样零 diff（改动集中在 `RedisWorkbench.tsx` 一枚）。

### T-1 阶段 B · 门禁独立重跑（严格串行，一次一条）

| # | 命令 | 自报 | **Tester 实测** | 判定 |
| - | ---- | ---- | --------------- | ---- |
| 1 | `npx vitest run --config vitest.drivers.config.ts` | 55 files / 525 passed / 0 skipped · 9.79s | **55 files / 525 passed / 0 skipped** · 10.35s（`Test Files 55 passed (55)` / `Tests 525 passed (525)`） | ✅ 数字一致 |
| 2 | `npx tsc --noEmit` | exit 0 | **exit 0**，无输出 | ✅ |
| 3 | `npx vite build` | exit 0 · 4.76s | **exit 0** · `✓ built in 4.75s`；仅既有 chunk >500 kB advisory（`main` 1.64 MB / `MainPage` 2.26 MB），非本轨引入 | ✅ |
| 4 | `node scripts/check-driver-import-boundaries.mjs` | 1469 files · 0 blocking · 4 advisory | **1469 files · 0 blocking · 4 advisory**（exit 0） | ✅ 逐字一致 |

复现注记（非缺陷）：简报 §5「Grep 工具搜索」与门禁无冲突；首轮我误用 `--reporter=basic`（vitest 4 已移除该 reporter）导致 startup error，改回默认 reporter 后一次全绿 —— 属测试代理命令姿势问题，与被测代码无关。

### T-2 阶段 A · E-1 五枚页签（裁定 8-1）

- `RedisConnectionView.tsx:16` `ActiveTab = 'items' | 'console' | 'pubsub' | 'monitor' | 'slowlog'`；`:19` `TABS` 恰 5 枚，顺序 = 键详情/命令行/发布订阅/监控/慢日志 ✅
- 页签条暴露 `data-testid="redis-tab-bar"` + `data-tab-count`，每枚 `redis-tab-${tab}` + `data-active` ⇒ 断言口径为 data-*，无英文字面量 ✅
- `visitedTabs` keep-alive：`slowlog` 首次访问才挂载，之后 `hidden` 保活（与既有 4 枚一致，无泄漏）✅
- `SlowlogPanel.tsx`（新 263 行）取数**只走既有** `redisCommandInvoke('redis','slowlog_get',{dbSessionId,count:100})`，零新增后端 ✅（`grep slowlog_get` 无新命令名）
- I-11 具名空态：状态机 5 值 `loading|ready|empty|unauthorized|failed`，经 `data-slowlog-state` 暴露；`unauthorized` 分支复用 `redis.overview.slowlog.unauthorized` + `.unauthorizedHint`（两枚 key 实测存在于 `en.ts`），**不是**渲染 0 条、**不是**留白 ✅
- `resolveSlowlogState` 是导出的纯函数（error ⇒ classifyOverviewError；entries 空 ⇒ empty），可直接单测 ✅
- 附带核对：`SLOWLOG RESET` 走 `gateWrite('write-op', …)` 门闸（I-6）+ 二次确认 Dialog，未绕过既有安全约定 ✅
- 文案面：本轨未新增 slowlog 文案 key（全复用既有），符合 §3 冲突面「只追加 `redis.detail.*`」的约束（见 T-7 locale 审查）。

**E-1 判定：通过，无 Bug。**

### T-3 阶段 A · E-2 常驻编辑（删查看/编辑切换）

- 生产码残骸 grep（`redis-string-mode-toggle` / `stringModeView` / `stringModeEdit`）：**零命中**，仅 `en.ts:218` 注释里提到 key 已删（属交付说明，不是死代码）✅
- `en.ts` 中 `'redis.stringModeView'` / `'redis.stringModeEdit'` 两枚 key **已随删除移除**（diff 显示 `-` 两行），非仅隐藏 ⇒ 无孤儿 key ✅
- `KeyEditors.tsx` `useState<` 实测仅剩 `error` / `frame` 两枚；`StringEditor.tsx` 内 `useState<` 为 `jsonError/jsonDisplay/decomp/decompError/view/codec` —— **无任何 `mode: 'view'|'edit'` state 残留** ✅
- 反向断言存在且不是摆设：`kvSlotRelay.test.tsx:215` 与 `stringValueReadOnlyJourney.test.tsx:165` 均 `expect(queryByTestId('redis-string-mode-toggle')).toBeNull()` —— 即旧形状回归会被测红 ✅
- `getByText('No expiry')` 全仓 `__tests__/` **零命中** ⇒ PRD §7-6 + 简报 §4-6 的「改写不是删除」达成（改写后的断言见 `ttlControlsJourney.test.tsx`，用 data-* 定位）✅

**E-2 判定：通过，无 Bug。**

### T-4 阶段 A · E-3 I-5 只读态收敛为两种

- `keyReadOnlyPolicy.ts` 是穷举式判定：`BYTE_ONLY_VIEWS = ['hex','binary']` 恰好两枚，且实测 `VIEWS` 含这两枚（`keyReadOnlyPolicy.test.ts:39-45` 反向钉「只允许这两种命中」）；其余分支一律 `readOnly:false` ⇒ **无第三种只读态** ✅
- 两种各带原因：`READ_ONLY_REASONS['binary-view'|'big-value']` ⇒ `redis.detail.readonly.binaryView` / `.bigValue`，两枚 key 实测在 `en.ts:488/490` 且文案含"为什么"（投影不可原样回写 / 载荷不完整防截断写覆盖）✅；`StringEditor.tsx:214-224` 渲染原因条并带 `data-readonly-reason` + `data-i18n-key`
- 「只读 ⇒ 必有原因、可编辑 ⇒ 必无原因」被 `keyReadOnlyPolicy.test.ts:68-74` 用 `readOnly === (reason !== null)` 双向钉住 ✅
- codec 不是只读轴：`resolveReadOnlyPolicy` 无 codec 入参 + 9 codec × 9 view 全枚举断言（`keyReadOnlyPolicy.test.ts:120-131`），`stringValueReadOnlyJourney.test.tsx:221-234` 另证预检档点满 9 个 codec 零次 `decode_value` ⇒ 旧「已解码 ⇒ 只能看」第三态确实消失 ✅
- `get_key_raw` 失败（frame 缺席）⇒ 可编辑，不误判为"未知即巨大"（`redisBigValue.ts:53` + `:289-299` 用例）✅
- 逻辑层双保险：`onEdit` 在 readOnly 时直接 return（`StringEditor.tsx:188-191`），DOM `readOnly` 之外再挡 jsdom 直派 change；保存按钮 `data-save-blocked-by="readonly"`（`:279`）✅
- **`GETRANGE 0 65537` 哨兵：以等价实现落地，判定成立但台账表述需精确**
  - `redisBigValue.ts` 用 `logicalLen > 65_536`（`BIG_VALUE_SENTINEL_BYTES = 65_536`，严格大于）代替真发 `GETRANGE`；`logicalLen` 对 string 键**确为字节数**——Tester 核 Rust 侧 `value_len_on` 的 string 臂走 `STRLEN`（`redis_driver_on.rs:196-197`），且 `BYTE_LENGTH_KEY_TYPES=['string']` 先按类型短路，避免拿十万成员 hash 的 HLEN 误判（`redisBigValue.test.ts` + `keyReadOnlyPolicy.test.ts:108-112` 双侧钉住）⇒ **语义等价成立，零额外往返**，符合 PRD §3.3「该探针的目的从来不是多一次往返，而是先量长度再决定要不要传整包」。
  - 但两阈值不同源：后端 `RAW_VALUE_MAX_BYTES = 5 MiB`（`redis_driver_on.rs:300`）决定 `truncated`，前端 64 KiB 决定 `overSentinel` ⇒ 64 KiB~5 MiB 区间是"超哨兵但载荷完整"。当前两成因**共用同一枚"载荷不完整"文案** ⇒ 登记 **BUG-006（低）**。
  - `## 留待 R 回归` 第 4 条仍要真连复验（本轨无 `GETRANGE` 通道，真实大值的可见性/性能只能真连）。

### T-5 阶段 A · E-4 键头行 + 徽标行 + TTL pill

| 验收点 | 实测 | 判定 |
| ------ | ---- | ---- |
| 键名等宽可截断带 `title` | `KeyHeaderRow.tsx:158-165` `font-mono truncate title={keyName}` + `data-testid="redis-header-key-name"`；`keyHeaderRowJourney.test.tsx:146-152` 断 `title` | ✅ |
| 刷新**分裂按钮** 1s/5s/10s/30s/关 | `REFRESH_INTERVALS=[1000,5000,10000,30000,0]`（`:29`，恰 5 档 + `0` 表关）；菜单 `data-testid="redis-refresh-interval-{ms}"`；旅程 `getAllByRole('menuitem')===5` 逐档断 `data-i18n-key`/`data-selected` | ✅ |
| 自动刷新 tick / 停拍 / **被拒即落关** | `:74-84` 定时器 + `:78-81` `ok===false ⇒ setIntervalMs(0)`；`keyHeaderRowJourney.test.tsx` Journey 4 用假定时器数拍（5000ms×3 拍 = 3 次）+ 拒 ⇒ 停 | ✅ |
| 复制键名 / 复制插入语句 | `:222-247` 两枚按钮 + `data-copied`；旅程断 `writeText('user:1')` 与 `writeText('SET user:1 hello')`（服务器数据可钉） | ✅ |
| 重命名**内联** | `:140-165` 输入框替换键名 + Enter/✕/✓ 三出口；三条用例（确认成功关 / 确认失败保持打开不吃输入 / 取消不出网） | ✅ |
| 删除**危险色** + 确认框先行 | `:293-316` `text-danger` + `useBoundConfirmDialog`；取消 ⇒ `deleteKey` 零调用 | ✅ |
| 插入语句"宁缺勿错" | `redisInsertStatement.ts` stream/JSON/module ⇒ `null` ⇒ 按钮隐藏（`:234` 条件渲染 + 旅程用例断 queryByTestId 为 null） | ✅ |
| 徽标行 = 类型 \| 大小 \| TTL pill（**省一行高度**） | `KeyEditors.tsx:157-192` 单容器 `redis-key-badges`，TTL pill 在同一行；`keyHeaderRowJourney.test.tsx:156-172` 断三者同容器 + `data-key-type` + `data-i18n-key="redis.detail.badge.size"` | ✅ 旧独立 `TtlControls` 整行挂点已消失 |
| 8-4 文案 key 语义可承载 | `永不过期`⇒`redis.noExpiry:131`；`自动换行`⇒`redis.view.wrap:211`；`大小: N B`⇒`redis.detail.badge.size:493 'Size: {n} B'`（`{n}` 承载数字）；`放弃`⇒`redis.detail.discard:507` + `.leave.discard:510` | ✅ 四枚均可承载 |
| TTL pill **三态内联**状态机三要素 | 进入：`data-ttl-open=false→true`，确定性从 `relative` 起步（`TtlControls.tsx:110-114`）；态内：三枚 `data-ttl-mode` 互斥 + 各走 `gateWrite`；退出：**仅** `redis-ttl-close` 与切键卸载 | ⚠️ **缺 Esc / 失焦** ⇒ **BUG-004（中）** |
| pill 非法输入 | 相对 TTL NaN/负 ⇒ `redis-ttl-error`；绝对时间非法 ⇒ 按钮 disabled（`ttlControlsJourney.test.tsx:303-334` 已把 jsdom 归一化行为写成显式契约） | ✅ |

- 注（不是缺陷）：pill 展开态仍是**整行宽**（`w-full` + 容器 `flex-wrap`）⇒ 视觉上比"胶囊"占位大；简报诉求是"省一行高度"，实测确实少了原来独立的一行，判达成。
- 变异自证：撤掉头行改名/删除守卫（M13/M14）**当时全绿** ⇒ 该两条 I-1 拦截无专属断言 ⇒ Tester 已在 `dirtyLeaveCoverage.test.tsx` B 组补齐，补齐后复跑 M13/M14 **各自变红**（见 T-11）。

### T-6 阶段 A · E-5 底栏 + I-1 八拦截点

**接线面实测与自报一致**：生产码 `await requestDraftLeave()` 恰 **12 处** = `KeyEditors ×3`(:114/121/134) + `RedisWorkbench ×7`(:257/298/309/322/370/697/739) + `RedisConnectionView:93` + `draftGuard.ts:6` 文档提及 1 处。**注意**：台账 §5 写的「8 个拦截点」是**语义计数**（8 类导航），与**守卫落点 11 处**不冲突；但台账表格只列了 8 行 + 编辑面内部 3 行，读者按 `grep -c` 对不上 ⇒ 台账需补一句「11 个调用点 / 8 类动作」（并入 BUG-005 的台账如实性）。

**底栏**：`StringEditor.tsx:261-285` 仅 `jsonDirty` 时挂载，含放弃(`redis-string-discard`)/保存(`redis-string-save`)；`dirtyLeaveJourney.test.tsx:233-257` 断「干净⇒两枚都不存在 ⇒ 第一击出现 ⇒ 放弃回滚到服务器值且 `setString` 零调用」⇒ 是**行为**断言不是快照 ✅

**八拦截点逐条独立核（不采信台账）**：全部经 jsdom 实测确认「① 弹层出现 ② 原动作未执行 ③ 继续编辑不丢草稿」，证据列：

| # | 拦截点 | 守卫落点 | Tester 实测的「真的拦」证据 |
| - | ------ | -------- | -------------------------- |
| 1 | 切键 | `RedisWorkbench.tsx:370` | 点 `other:2` ⇒ 弹层 + `data-selected-key` 仍 `user:1` + textarea 仍 `draft`；继续编辑后三者不变；放弃后换键成功且新键从自己值起步 |
| 2 | 切 db | `:257` | 点 `redis-db-db1` ⇒ 弹层 + 选中/脏不变；继续编辑 ⇒ `data-detail-state` 不变；放弃 ⇒ 落 `no-key`（编辑面随旧键卸载） |
| 3 | 工具栏刷新 `refreshKeys` | `:298` | 经 handle 与 UI 两路都弹；`kvSlotRelay` 中继 dirty 在拦截期仍 `true` |
| 4 | 工具栏整体刷新 `handleRefresh` | `:309` | `redis-refresh` 点击 ⇒ 弹层，`getKey` 调用数**不增**（拦截发生在重取前） |
| 5 | 搜索 | `:322` | Enter ⇒ 弹层，`getDirty()`/选中键均不变；放弃后才清（M2 变异已证：撤守卫后该例变红） |
| 6 | 关闭详情面板 | `:697` | `redis-detail-close` ⇒ 弹层，选中与草稿存活 |
| 7 | 清空选中键（对话框出口） | `:739` | M9 变异当时全绿 ⇒ **原无专属断言**；Tester 补 G 组（右键删选中键）后复跑 M9 ⇒ **变红** |
| 8 | 切页签 | `RedisConnectionView.tsx:93` | `redis-tab-console` ⇒ 弹层 + `data-active` 仍 `items=true/console=false`；keep-alive 下对话框经 portal 可见 |

**编辑面内部三动作**（同走一个守卫，属附加拦截）：列头刷新 `KeyEditors.tsx:114`、重命名 `:121`、删除 `:134`。刷新已由 `dirtyLeaveJourney:323` 覆盖（M12 变异复跑变红）；改名/删除**当时无人钉**（M13/M14 存活）⇒ 本轮补齐。

**「消掉静默清 dirty」的反事实核（本项是 E-5 的实质）**：
- 旧写法 = `refreshKeys()` 里直接 `setEditorDirty(false)` 且无任何询问。Tester 撤掉守卫（M1）后跑套件：**`kvSlotRelay` 的 I-1 用例立刻变红**（断 `relay.getDirty()` 仍 `true` + 选中仍在），证明新断言测的是"被拦时不清"，不是"点了以后清"这种旧写法也能过的假守卫。
- 同理 M2（撤搜索守卫）⇒ `kvSlotRelay` 搜索出口用例变红；M3（撤切 db 守卫）⇒ `guards 切db` 变红；M4（撤切页签守卫）/M5（撤切键守卫）⇒ 各自用例变红；M6（`reloadDetail` 退回 `refreshKeys()`）⇒ **两条**变红（头行刷新 + 保存后不关面板）。⇒ 六项反事实全部成立。
- **但同一条反事实法暴露出守卫并不穷尽**：三处未覆盖出口（同键重点击、`onClearSelectedKey` 之外的 `onSelectKey` 四条对话框出口、以及 `refreshKeys` 被拒后仍继续的 `onSelectKey`）⇒ **BUG-001 / BUG-002**。这是本轮判 TEST_FAILED 的直接依据。

**编辑器 `key={detail.key}` 重挂载**：`DetailColumn.tsx:96-97` 保留（W2 结论未回退），`kvSlotRelay.test.tsx` 有「不把上一把键的草稿漏进下一把」用例 ✅ —— 同一机制也是 BUG-001/002 的放大器（重挂 ⇒ cleanup 发 `dirty=false`）。

**保存语义**：`invokeSetString` 只发 4 字段、payload **不含** `keepTtl`（`keyEditorsInvokes.test.ts` 双侧正向 + `not.toHaveProperty` 反向钉；`redisWorkbench.test.tsx` diff 显示断言按新形状改写而非删除）✅。后端 `set_string` 的 `keep_ttl` 默认 `unwrap_or(false)`（`commands_exec_mutate.rs:30-34` + `ops.rs:169-189` 只有 `keep_ttl=true` 才发 `SET ... KEEPTTL`）⇒ **本 worktree 现状是"保存即清 TTL"**，与简报"合流时若 C 未落地不传该参数即可"一致 ⇒ 不判 E 轨缺陷，但 **R 回归第 1/2 条必须在 C 合流后跑**（已在遗留事项内，Tester 补一条：`留待 R` 第 1 条需显式验「保存前设 TTL、保存后 TTL 仍在」）。

### T-7 阶段 A · 越界审查（本轨关键）

**`en.ts`**：diff 仅两类改动 = ① 删 `redis.stringModeView` / `.stringModeEdit` 两枚（E-2 删切换的必然结果）② 追加 17 枚 `redis.detail.*` + 一段说明注释。**无改他人 key、无重排** ✅（逐行核 diff）。台账 §en 注释称「其余 9 语言保留孤儿副本直到 i18n-sync 补」⇒ Tester 实测 9 个非 en 文件对 `stringMode` 命中数**均为 0**，即**根本不存在孤儿**（这些 key 从未进过非 en 语言；且 `i18n-sync-check` 的 driver pack 维度报 **0 issue**）⇒ 该注释是**不实陈述**，并入 **BUG-005（台账如实性）**。

**禁改面零 diff（实测空输出，exit 0）**：`ui/key-browser/BatchBar.tsx` · `ui/key-browser/ImportExport.tsx` · `ui/shared/redisInvoke.ts` · `ui/console/**`（含 `redisConsoleDanger.ts`）· `ui/kv-bar/**` · `ui/shared/meta.ts` · `src/**` 宿主 · `packages/driver-sdk/**` · `packages/drivers/redis/src/**`（Rust）· `scripts/resolve-drivers.mjs`。`ui/key-browser/` 内其余 13 个文件亦零 diff。⇒ 简报 §2/§3 的禁改面全部遵守 ✅

**`ui/key-browser/RedisWorkbench.tsx` 逐 hunk 判定（11 hunks，+109/-27，705→760 行，≤800 ✅）**：

| # | hunk | 内容 | 判定 |
| - | ---- | ---- | ---- |
| 1 | `:36` | `import { requestDraftLeave }` | **必要**（E-5 接线） |
| 2 | `:248-261` | `handleSelectDb` 转 async + **同库早退** + 守卫前置 | 守卫**必要**；早退**必要且正当**（初始自动选中会误弹 I-1），属行为改动如实登记。deps 补齐 `selectedDb/dbIndex` 是 async 化的正确性要求，非顺手重构 ✅ |
| 3 | `:267-277` | 同上 deps 数组重排 | 与 #2 同一因果 ✅ |
| 4 | `:287-292` | 调用点 `handleSelectDb(initial)` → `void handleSelectDb(initial)` | **必要**（void 适配，无语义变化） |
| 5 | `:294-309` | `refreshKeys` 转 async + 守卫前置，body 逐行不变（仅提干 `if (!selectedDb) return`） | **必要**（E-5 核心）。⚠️ 语义扩注见下 |
| 6 | `:309-313` | `handleRefresh` 转 async + 自身守卫 + `void refreshKeys()/loadDbSizes()` | **必要**；但**双重守卫**（自身 + `refreshKeys` 内）实测等价（干净态立即 true），撤自身守卫 M7 **不红** ⇒ 冗余但无害，见下方注 |
| 7 | `:317` | `useImperativeHandle` 行未变（`refreshKeys, selectDatabase`） | ✅ 对外契约形状不变（`RedisWorkbenchHandle` 两枚签名 diff 为空）⇒ D 轨调用侧无需跟改 |
| 8 | `:319-326` | `handleSearch` 转 async + 守卫前置 | **必要**（I-1 点名"搜索静默清 dirty"） |
| 9 | `:353-378` | 新增 `handleSelectKeyGuarded`（同键早退 + 守卫）+ `reloadDetail` 由 `refreshKeys()` 改为「重取 detail + `scanRefresh()` + `tree.refresh()`」 | 守卫**必要**；`reloadDetail` 是**行为改动**（非纯接线），修的是 E-5 自引入回归（保存即关面板），M6 证明该改动被两条用例守住 ⇒ **判定：必要补丁，非顺手重构** ⚠️ 但同键早退引入 **BUG-001** |
| 10 | `:482` / `:504` | 两处 `void refreshKeys()` / `void handleSearch()` | **必要** void 适配 |
| 11 | `:654`, `:686-700`, `:734-742` | 树列 `onSelectKey` 换守卫版；`onRenamed` 加 `void`；`onClose`/`onClearSelectedKey` 包 IIFE 加守卫 | 守卫**必要**。⚠️ **`KeyWorkbenchDialogs` 的 `onSelectKey` 仍是裸 `handleSelectKey`（`:735`）⇒ 漏网，登记 BUG-002** |

**结论**：**没有发现任何"顺手重构"**（无格式化重排、无命名改写、无无关组件抽取、无 deps 数组美化）；5 个回调转 async + 8 处 `void` 适配（自报 6，实测 8：`:290,:311,:312,:485,:504,:691` + IIFE 两枚内联）+ 1 处必要行为改动 + 1 处等价早退，**逐条可归因到 E-5**。`void` 计数差属台账口径（其把两枚 IIFE 记为"内联"），不影响判定。

**越界的真正问题不是"改多了"而是"改漏了"**：守卫覆盖了树列与两个清空出口，但 `KeyWorkbenchDialogs` 的四条 `onSelectKey` 出口未接 ⇒ 简报「不碰 key-browser」的纪律被以"必要接线"名义突破是**可接受的**（协调者已裁 D 轨冲突面按符号合并），但接线不完备是**缺陷**（BUG-002）。

**MonitorPanel 的重复慢日志子页（裁定 8-1 的残留，非本轨 diff）**：`ui/observe/MonitorPanel.tsx:87,127,338-` 仍在 `监控` 页签内渲染第二个慢日志表（自带 `slowlog_get`/`slowlog_reset` + **无具名未授权空态**，走通用 error 条），与新一级页签**并存两份实现**。MonitorPanel 本轨零 diff（在 D/E 之间的 observe/ 目录，简报未声明所有权）⇒ 不判越界，但 8-1 的意图（"升为一级"）留了个二极副本，且副本的 I-11 达标度低于新面板。⇒ 记为**协调者裁定项**（见 T-12），不单开 Bug（不属本轨交付面缺陷）。

### T-8 阶段 B · 门禁独立重跑（数字核对表）

| 门禁 | 自报 | Tester 实测（HEAD `3919307ce`，串行） | 差 |
| ---- | ---- | ------------------------------------ | -- |
| vitest drivers | 55 files / 525 passed / 0 skipped · 9.79s | **55 files / 525 passed / 0 skipped** · 10.35s | 0 ✅ |
| `tsc --noEmit` | exit 0 | **exit 0** | 0 ✅ |
| `vite build` | exit 0 · 4.76s | **exit 0** · `✓ built in 4.75s`（同一 chunk advisory） | 0 ✅ |
| boundaries | 1469 files · 0 blocking · 4 advisory | **1469 files · 0 blocking · 4 advisory** | 0 ✅ |

**Tester 补测后（HEAD `444d970b0`）复跑**：`58 files / 546 passed / 3 skipped`（3 枚 skip = BUG-001/002 的正确期望占位）· tsc **exit 0** · vite build **exit 0**（5.06s）· boundaries **1472 files · 0 blocking · 4 advisory**。「只许增不许红」满足（525→546，零红）。

### T-9 阶段 C · 覆盖率独立复算

**方法**：`npx vitest run --config vitest.drivers.config.ts --coverage --coverage.provider=v8 --coverage.all=false --coverage.reporter=json-summary`（不采信自报聚合，按 `git diff --name-only` 的两套集合自行求 Σcovered/Σtotal）。

| 口径 | 自报 | **Tester 复算** | 判定 |
| ---- | ---- | -------------- | ---- |
| A（15 生产文件，含 `en.ts`） | 81.22 / 83.71 | **81.25 stmts / 83.74 lines**（bran 75.36 · funcs 78.42） | 吻合 ✅ |
| **B**（A 剔 `RedisWorkbench` + 5 集合编辑器 + `JsonEditor`） | **86.25 / 88.74** | **85.57 / 88.64**（含 en.ts）；85.55 / 88.62（不含） | 差 0.68pp ⇒ **同判 ≥80%**，但自报值不可复现 ⇒ BUG-005 |
| C（字面 glob `value-editors/**` + `RedisConnectionView` + `draftGuard`） | 55.43 / 56 | **56.32 / 57.00**（bran 57.52 · funcs 48.05） | 量级一致 |

**口径 C 的「glob 放大」论证成立性核验（逐条）**：`git diff 8981d3078..HEAD --name-only` 对 `HashEditor|ListEditor|SetEditor|ZsetEditor|StreamEditor|StreamOverview|JsonEditor` 命中数 = **0**（base/HEAD 行数一致：`HashEditor` 264→264、`JsonEditor` 593→593）⇒ 这些低覆盖文件本轨**真没碰**；且 `git grep HashEditor|…` 在 base 与 HEAD 的 `ui/__tests__/` 均**零命中** ⇒ 其 0.67~1.66% 是 **Wave 3 之前的存量缺口**（集合编辑器从未有过单测），非 E 轨回归。**结论：C 非本轨缺口，判定与自报一致** ✅（但见 BUG-005 #1：同段把 `keyEditorsInvokes:306-321` 混入"非缺口"清单是错的）。

**自报点名缺口逐条裁定（属验收面⇒补测；属 §2 明确不做⇒记非缺口）**：

| 点名 | 实测未覆盖内容 | 裁定 | 处置 |
| ---- | -------------- | ---- | ---- |
| `StringEditor` 70.65%（解压支路 + gateWrite 拒绝） | 未覆盖含 `:148-150`(gateWrite 拒绝) / `:129-132`(JSON 三态) / `:169-184`(runDecompress) | **属验收面**（E-2/E-5 新建文件；且"需真连"说法经实测不成立） | ✅ **已补 6 例**：Safe Mode 拒保存（零出网 + 草稿保留）、JSON raw/pretty/minify（含"重排不置 dirty""编辑后切模式不覆盖草稿""保存只 4 字段"）、残缺 JSON 不出网+可修好续存、解压 进入/成功/判不出/抛错（真实 gzip 字节驱动本轨判定，仅桩掉 `tryDecompressString`）⇒ **95.65% stmts / 98.79% lines** |
| `ValueViewer` 75.36%（`:124-138` 未知 view 兜底） | 实测未覆盖是 `copyText`/`downloadBytes`/`wrap` 三枚动作 + 1 处 seq 竞态；**不是**"未知 view 兜底"（台账行号失准） | **属验收面**（E-3 把 `showOutput` 改 `readOnly` 驱动，这三枚动作是新可达性形状） | ✅ **已补 5 例**：文本档复制渲染文本、字节档回退原始载荷、wrap 纯显示零命令、下载按键名出 blob、`showOutput=false` 只留两行控件 ⇒ **95.65% / 98.43%** |
| `KeyEditors.tsx:217-244`（集合分派段） | 实测 = `:181/217/226/235/244` 五处 `onChanged={() => void onRefresh()}` 内联箭头（hash/list/set/zset 的回调），`:217-244` 区间其余为**存量 JSX** | **属 §2 明确不做**（集合编辑器本轮不接守卫、不验刷新回调） | 记非缺口。本轨自有行（`:95`/`:102-103`/`:114`）已由 A/B/C 组用例连带覆盖 ⇒ **80.43% stmts**（原 76.08） |
| `keyEditorsInvokes.ts:306-321`（"集合类批量 invoke 辅助"） | **实为 `invokeRename`(:296-311) + `invokeDeleteKey`(:314-325)**，后者本轨 E-4 新建 ⇒ 归属写错 | **属验收面** | ✅ **已补 2 例**钉命令与载荷形状；并纠台账 ⇒ BUG-005 |
| `RedisConnectionView.tsx:73` | `handleSelectDatabase` 转发（宿主 `selectTableRef` 通道） | 属 host 侧接线，非本轨改动行（diff 零命中 `:73`） | 记非缺口（不改） |
| `draftGuard.ts:69` | `settleDraftLeave` 无悬起时早退（防御） | 防御分支，生产路径不可达 | 记非缺口 ✅ |
| `SlowlogPanel.tsx:113-114` | `handleReset` 的 catch + `setState('failed')` | **属验收面**（E-1 新建面板的失败态） | ⏳ 未补：其 invoke 为可注入桩，补测可在下一轮以 3 行完成；本轮以 R 回归第 5 条兜底，记为**遗留补测项**（非 Bug） |
| `RedisWorkbench.tsx` 70.16%（口径 A 内） | 右键菜单/批量/导入导出既有支路 | D 轨目录 + 存量 | 记非缺口（本轨 diff 行已由 A~G 组覆盖 ⇒ 升至 **77.73%**） |

**口径 B 补测后复算**：**92.30% stmts / 95.34% lines**（bran 85.13 · funcs 90.12）；口径 A：**88.21 / 90.46** ⇒ 交付项 §4-5 的 ≥80% **达成且余量扩大**。

### T-10 阶段 C · 旅程强度审查（`dirtyLeaveJourney.test.tsx` 11 例是否真断中间态）

逐例判定（**无一条是摆设**）：

1. `walks enter → in-state → exit for both leave answers` —— 断 `isLeavePending()` 的三次跃迁、`second === first`（并发合并同一 Promise）、以及**只有** `proceed=true` 才清 dirty（取消后 `isDraftDirty()` 仍 `true`）⇒ 状态机内核，强 ✅
2. 脏底栏 —— 干净⇒两枚不存在 / 第一击⇒出现 / 放弃⇒值回滚 + `setString` 零调用 ⇒ 行为断言 ✅
3. 切键 —— **三步**（弹层⇒未换键⇒继续编辑后草稿原样⇒放弃后换键成功且新键从自身值起步）⇒ 真中间态 ✅
4. 切 db —— 同上 + 放弃后落 `no-key` ✅
5. 工具栏刷新 —— 断 `getKey.mock.calls.length` 不变 ⇒ 「拦截发生在重取**之前**」，正是"动作未执行"的硬证据 ✅
6. 头行刷新 —— 同上 + 放弃后 `getKey` 次数**增加** 且选中仍在（一条用例同时覆盖拦截与 `reloadDetail` 行为补丁）✅
7. 保存先发布干净 —— 断 `setString` 调用长度为 4（无 keepTtl）+ 全程无弹层 + 保存后面板不关 + 再刷新自由通过 ✅
8. 切页签 —— 断 `data-active` 双枚 + keep-alive 下 `stub-console` 出现 + 回滚后 textarea 值 ✅
9. Esc —— 断 `document.querySelector('[role="dialog"]')` 存在再派 Escape ⇒ 动作取消 + 重取未发生 + 底栏仍在 ✅
10. 卸载悬起 —— `isLeavePending()` 由 `true` 落 `false`（防悬死 await）✅
11. 非法 JSON —— 先断**残缺中间态**（`{"a":` 已置 dirty）再断保存不出网 + 守卫未被触碰 ✅

**但强度审查同时暴露覆盖面而非实现面的两处空洞**：① 台账 §5 表格里的 #7「清空选中键」等支路当时无人钉（M9 存活）；② 三处 §8-2 遗留项无专属断言 ⇒ 全部由 T-11 补齐。

### T-11 阶段 C · 补测清单与变异自证（Tester 新增）

**新增测试文件 / 用例（Tester 共 +21 例：18 断言 + 3 skip 占位）**：

| 文件 | 用例 | 钉住的对象 |
| ---- | ---- | ---------- |
| `__tests__/dirtyLeaveCoverage.test.tsx`（新） | A 同库重点击不弹+异库仍弹 | M11 |
| | B1 头行改名先问（未出网/继续编辑保草稿/放弃后 RENAME 出网且落 dirty=false） | M13 |
| | B2 头行删除先问（`deleteKey` 零调用 ⇒ 放弃后恰一次） | M14 |
| | C 批量删除：命令先落库 ⇒ 刷新撞守卫 ⇒ 选中/草稿存活 ⇒ 继续编辑不丢 | §8-2 批量对话框 |
| | D 批量 TTL：`batch_set_ttl` 出网 ⇒ 弹层 ⇒ 放弃后才清 | §8-2 批量 TTL |
| | E 列设置（仅无 TTL 过滤）：重扫**但不毁草稿 ⇒ 不该吃守卫** | §8-2 列设置（语义澄清） |
| | G 右键删选中键：连续出口逐次拒绝不死锁 | M9 |
| | F / H2（skip）创建键 · 右键 TTL 的 `onSelectKey` 旁路 ⇒ **正确期望** | BUG-002 |
| | H（skip）同键重点击 ⇒ **正确期望** | BUG-001 |
| `__tests__/stringEditorTesterGaps.test.tsx`（新） | Safe Mode 拒保存 / JSON 三态 / 非法中间态可修好续存 | 口径 B 缺口 |
| `__tests__/stringEditorDecompressGaps.test.tsx`（新） | 解压 进入·成功·判不出·抛错必落 busy | 口径 B 缺口 |
| `__tests__/keyEditorsInvokes.test.ts`（+2） | `invokeRename` / `invokeDeleteKey` 命令与载荷 | 台账误归属项 |
| `__tests__/ValueViewer.test.tsx`（+5） | 复制/下载/wrap 可达性 + `showOutput=false` 形状 | 口径 B 缺口 |
| `__tests__/stringValueReadOnlyJourney.test.tsx`（+1，改 1） | 截断徽标具名文案（`data-i18n-key`）+ 超哨兵但完整载荷**不亮**截断徽标 | I-11 / BUG-006 |

**变异自证表（14 次，每次立即 `git checkout HEAD --` 还原并复跑；结束时 `git status` 干净，生产码零残留）**：

| # | 变异 | 补测**前** | 补测**后** |
| - | ---- | ---------- | ---------- |
| M1 | `refreshKeys` 去守卫 | 红(1) `kvSlotRelay` I-1 | 红(1) |
| M2 | `handleSearch` 去守卫 | 红(1) | 红(1) |
| M3 | `handleSelectDb` 去守卫 | 红(1) | 红(1) |
| M4 | 切页签去守卫 | 红(1) | 红(1) |
| M5 | 切键去守卫（整体） | 红(1) | 红(1) |
| M6 | `reloadDetail` 退回 `refreshKeys()` | **红(2)** | 红(2) |
| M7 | `handleRefresh` 去**自身**守卫（仍留 `refreshKeys` 内守卫） | **全绿** | 全绿（等价冗余，判定无害，不登记） |
| M8 | `onClose` 去守卫 | 红(1) | 红(1) |
| **M9** | `onClearSelectedKey` 去守卫 | **全绿 ⇒ 当时无覆盖** | **红(1)** ✅ 已闭环 |
| **M10** | 去掉同键重点击早退（一律走守卫） | 全绿 | 全绿*（正确期望用例 skip；见 BUG-001） |
| **M11** | 去掉同库早退 | **全绿 ⇒ 当时无覆盖** | **红(1)** ✅ |
| M12 | `refreshNow` 去守卫 | 红(1) | 红(1) |
| **M13** | 头行改名去守卫 | **全绿 ⇒ 当时无覆盖** | **红(1)** ✅ |
| **M14** | 头行删除去守卫 | **全绿 ⇒ 当时无覆盖** | **红(1)** ✅ |

⇒ 四条"存活变异"全部转为"变红"，本轮补测具有真实证伪能力。**M10 的特殊性**：撤掉早退后无人变红，是因为**当前实现本身在这一点上错**（早退 ⇒ 不询问 ⇒ 静默丢草稿）；Tester 不把它钉成"必须询问"的断言（那会把一种错误固化），而是留 skip 用例表达正确期望 ⇒ **BUG-001**。

### T-12 阶段 D · 判定与交接

**结论：`TEST_FAILED`**（Bug 循环 1/5）。门禁四件套与三口径覆盖率全部独立复验通过（且补测后余量扩大），E-1/E-2/E-3 三条**无 Bug**；但 I-1（本轨最重的 E-5）存在两条静默丢草稿旁路 ⇒ 交付项 §1-5「现状缺陷必须一并消掉」未完整达成。

**交协调者裁定的三项（非 Bug）**：

1. **组合键归属**（按协调者裁定执行）：E 轨的拦截语义**不依赖任何键位** —— 八个拦截点全部挂在鼠标/焦点路径（行点击、db 按钮、工具栏按钮、页签按钮、面板关闭按钮、搜索 Enter），M1~M5/M8/M11~M14 变异皆以 `fireEvent.click/change/keyDown` 驱动并变红 ⇒ **无键位也照拦**。⇒ 确认：`⌘Y/⌥⌘Y/⌘R` 属 **W3-D D-7 验收面**，非 E 轨缺口（E 轨 diff 对 `app_menu.rs` 与宿主快捷键接线零改动，实测全仓仅 `CmdOrCtrl+,` / `CmdOrCtrl+N` 两枚 accelerator，redis UI 内唯一组合键是 `RedisConsole.tsx:210` 的 Mod+Enter）。
2. **`MonitorPanel` 内重复的二极慢日志子页**：8-1 已把慢日志升为一级，但 `监控` 页签内的第二份实现（自带 `slowlog_get`/`slowlog_reset`，且其空态走通用 error 条、**缺 I-11 具名未授权文案**）仍在 ⇒ 本轨对 `observe/MonitorPanel.tsx` **零 diff**，不判越界；请裁定「移除二极子页」归 E 轨下一轮还是随 D/observe 轨收口。
3. **「列设置」措辞对齐**：本仓 `ui/key-browser/` 内**不存在**列设置面板（无 `visibleColumns` / 列头设置 UI）；简报 §8-2 所称「列设置三处已吃到守卫」实为 `KeyBrowserControls` 的三枚**过滤**开关（类型 / 含内存 / 仅无 TTL），它们经 `useRedisKeyScan.ts:83` 的 effect 只重扫列表、**不碰 selection** ⇒ 因此**不需要**守卫也不毁草稿。Tester 已按此语义补 E 组用例（重扫发生 + 选中/草稿存活 + 不弹层）。若 Wave 4 真要加列设置面板，届时再纳入 I-1 面。

**`## 留待 R 回归` 核对结论：6 条已列全，无缺项**；Tester 补两处判据细化（不新增条数）：
- 第 1/2 条：本 worktree 后端 `keep_ttl` 默认 `false` ⇒ **当前真连必然丢 TTL**；R 跑时须显式验「保存前设 TTL ⇒ 保存后 `PTTL` 仍 >0」，若仍为 `-1` 则 W3-C 默认化未生效（这是 C 轨的账，不是 E 轨）。
- 第 4 条：须同时看**两分支**文案（`truncated` ⇒ 不完整；超哨兵但完整 ⇒ 现在也说"不完整" = BUG-006）。
- 建议追加第 7 条：**保存失败可见性**（真连只读副本 / 断链 ⇒ 现在零反馈，BUG-003），R 回归时可顺带验修复。

**只测不修自证**：全程生产码零改动。探针期对 `StringEditor.tsx` / `ValueViewer.tsx` 的临时 testid 改动**已 `git checkout HEAD --` 还原**，并在还原后重写测试改用仓库既有口径（identity `t` ⇒ 文本即 key）；变异自证每次复跑后 `git status --porcelain` 均确认为空（仅新测试文件为 `??`）。

### T-13 阶段 C/D · E2E 登记表（Tester 补登，`tester.md` §2-阶段C-3）

> 禁 live e2e（简报 §5）⇒ 本轮**不跑** `pnpm e2e` / `tauri:build:webdriver`。下表按「本机可执行（jsdom 单测已覆盖，R 阶段仅需回归）」与「留待 R 回归（需真连 Redis / GUI 手感）」两档标注；驱动特定路径按 AGENTS.md 落 `packages/drivers/redis/e2e/`（本轨**未**新增 e2e 文件，理由：E-1..E-5 全为前端交互，命令面零改动，`slowlog_get`/`set_string` 契约未变）。

| # | 场景 | 档位 | 前置条件 / 判据 |
| - | ---- | ---- | -------------- |
| 1 | 五枚一级页签顺序与激活态（8-1） | 本机可执行 ⇒ R 回归 | `redisTabBarJourney.test.tsx` 已钉 `data-tab-count=5` + `data-active`；R 只需目视确认页签条宽度不溢出 |
| 2 | 慢日志一级页签真连：有 / 无 `SLOWLOG` 权限、Redis < 2.2.1 | **留待 R** | 对应原 §7-5；判据 = `data-slowlog-state` 在 `unauthorized` 且 `.unauthorizedHint` 可见（**不得**显示 0 条） |
| 3 | 常驻编辑：无查看/编辑切换、编辑区始终可写 | 本机可执行 ⇒ R 回归 | `stringValueReadOnlyJourney.test.tsx:161-175` 反向钉 `redis-string-mode-toggle` 不存在 |
| 4 | I-5 只读态①（Hex/Binary + 原因文案） | 本机可执行 ⇒ R 回归 | 断 `data-readonly-reason="binary-view"`；R 目视文案是否可读 |
| 5 | I-5 只读态②（真连大 value 两分支） | **留待 R**（= 原 §7-4） | 64 KiB~5 MiB「完整但超大」与 >5 MiB「截断」两键各看一次；连带验 **BUG-006** 文案是否分化 |
| 6 | 徽标行 `大小: N B` 真实数值格式 | **留待 R** | `MEMORY USAGE` 真值 + `formatSize` 千分位；jsdom 只验 key 与存在性 |
| 7 | TTL pill 三态内联真连（EXPIRE / PERSIST / EXPIREAT） | **留待 R** | 真键上看 `TTL` 回读；**修复 BUG-004 后**加验 Esc 收起 |
| 8 | 自动刷新 1s/5s/10s/30s tick 手感 + dirty 时被拦即落关 | **留待 R**（= 原 §7-3） | jsdom 已验状态机（假定时器），未验计时器真实节奏与菜单定位 |
| 9 | I-1 八拦截点 + 编辑面三动作（切键/切 db/刷新/搜索/关面板/切页签/改名/删除） | 本机可执行 ⇒ R 回归 | `dirtyLeaveJourney` 11 + `dirtyLeaveCoverage` 8（+3 skip）+ M1~M14 变异自证 |
| 10 | **同键重点击 / 创建键 / 右键 TTL 后草稿去向**（BUG-001/002 修复复验） | **留待 R**（新增） | 真连手测：改值不保存 ⇒ 再点同一行 ⇒ 期望「弹放弃询问」或「草稿仍在」，二者其一；修复后取消对应 skip 用例 |
| 11 | **保存失败可见性**（BUG-003） | **留待 R**（建议补入 §7 作第 7 条） | replica-only 会话或保存瞬间断链 ⇒ 期望出现错误提示且草稿不被吞 |
| 12 | `SET ... KEEPTTL` 真连往返（含 W3-C 默认化） | **留待 R**（= 原 §7-1/2） | 本 worktree 后端默认 `false` ⇒ **当前必然丢 TTL**；C 合流后必验「保存前设 TTL ⇒ 保存后 `PTTL>0`」 |
| 13 | `DraftLeaveDialog` 焦点陷阱 / Esc 可达 / z 序（与 keep-alive 隐藏页签叠层） | **留待 R**（= 原 §7-6） | 暗色主题目视；jsdom 已验 `@datazen/ui` Dialog 的 Tab 环与 Escape→`settleDraftLeave(false)` 语义 |
| 14 | 无键位环境下 I-1 仍成立（鼠标路径） | 本机可执行 | Tester 全部变异用例皆以 `fireEvent.*` 驱动 ⇒ 证明拦截不依赖 ⌘Y/⌘R（键位属 W3-D D-7） |

## 修复轮 round-1（fixer · 2026-09-23）

> 对应 `bugs/README.md` 第 1 轮 Tester 登记的 6 条 bug。本节为**修复轮新增记录区**：历史章节（上方自验记录 / Tester 复验记录）一律保留原文不删，口径更正以本节为准（BUG-005 的「台账如实性」缺陷就地在此更正）。

### BUG-005 更正 1 · 口径 B 自报值不可复现，以 Tester 复算为准（≥80% 结论不变）

- 原文（自验记录 §6 覆盖率表口径 B 行）：**86.25% stmts / 88.74% lines**（自报）。
- 复算（Tester T-9，同一 v8 配置、`--coverage.all=false`；B = 剔除 `RedisWorkbench.tsx` + 5 个集合编辑器 + `JsonEditor.tsx`）：
  - **85.57% stmts / 88.64% lines（含 `en.ts`）** ← 引用口径 B 以此为准；
  - 85.55% stmts / 88.62% lines（不含 `en.ts`）。
- 差 0.68pp / 0.10pp ⇒ **两值同判 ≥80%**，原结论不变；自报值不可复现，本节起作废。
- 口径 A 自报 81.22/83.71 → 复算 **81.25/83.74**（吻合，无需更正）。口径 C「偏低非缺口」判定**成立**（复算 56.32/57.00，与自报 55.43/56 同量级；低分 100% 来自 base 即 0.67~1.66% 且本轨零 diff 的 5 个集合编辑器 + 未触及的 `JsonEditor.tsx` 55.05%），但其清单里混入的一条按更正 2 移出。
- 复算命令：见 `bugs/redis-detail-ui-BUG-005.md`「重现步骤」§2。

### BUG-005 更正 2 · `keyEditorsInvokes.ts:306-325` 的缺口属本轨验收面，不是「存量集合辅助」

- 实测归属：`:296-311` = `invokeRename`、`:314-325` = `invokeDeleteKey`；后者是本轨 E-4 **新建**的单键删除入口（`git diff 8981d3078..HEAD` 明确含该函数）。
- 原文把 `:306-321` 记作「集合类批量 invoke 辅助（本轨未动其语义）」是**归属错误** ⇒ 该缺口属本轨验收面，**应补测而非记为非缺口**（Tester 已在 T-11 补测覆盖 `invokeRename` / `invokeDeleteKey`，引用时一并注明）。
- 真正属 §2「明确不做」的集合辅助（base 即零覆盖、本轨零 diff）仅：`:63-68` `invokeHashDel` · `:96-102` `invokeListSet` · `:112-117` `invokeListPop` · `:127-132` `invokeListIndex` · `:143-149` `invokeListRem` · `:174-179` `invokeSetRemove` · `:204-209` `invokeZsetRemove`。

### BUG-005 更正 3 · 「其余 9 语言保留孤儿副本」系不实陈述，作废

- 原文（自验记录 §en 注释核对处）称删除 `redis.stringModeView` / `.stringModeEdit` 后「其余 9 语言保留孤儿副本直到 i18n-sync 补」。
- 实测（Tester T-7）：9 个非 `en.ts` 语言文件对 `stringMode` 的命中数**均为 0**（这两枚 key 从未进过非 en 语言）；`node scripts/i18n-sync-check.mjs` 的 driver pack 维度报 **0 issue** ⇒ **不存在孤儿副本**，该注释为不实陈述，本节起作废。

### BUG-005 更正 4 · 「8 个拦截点」是语义计数，调用点实测 11 处（按 T-6 注并入本缺陷）

- §5 状态机表「**8 个拦截点**」按**动作类别**计数（8 类导航/操作）：表格本身成立，保留；
- 但 `await requestDraftLeave()` 的**生产码调用点实测 11 处** = `KeyEditors.tsx ×3`（:114/:121/:134）+ `RedisWorkbench.tsx ×7`（:257/:298/:309/:322/:370/:697/:739）+ `RedisConnectionView.tsx ×1`（:93）；另有 `draftGuard.ts:6` **文档提及 1 处**（不计调用点，连同它对上 T-6 的「12 处」口径）。
- 此后引用一律写「**11 个调用点 / 8 类动作**」；§5 表 8 行 + 编辑面内部 3 行 = 11，与 `grep -c` 对齐（原 T-6 注「台账需补一句」由本节兑现）。

### 修复轮 round-1 · 完成核对（fixer · 2026-09-23）

- **6 条 bug 全部** `待复测（round-1 修复后）`：各自 bug 文件已追加 `## 修复记录（round-1）`，`bugs/README.md` 汇总表 6 行状态列同步 `待复测`（6/6）。
- **修复 commit 链**（`feature/redis-detail-ui`，base `09a2c9ccf` 之上，按序）：

  | commit | 内容 |
  | ------ | ---- |
  | `d987ddb2d` | 起手：6 个 bug 状态行置 `修复中` + README 对应行 |
  | `a82dce41d` | BUG-001 同键重取非毁式 + BUG-002 对话框四出口接守卫；取消 3 条 `describe.skip` 并新增双弹排除自测 |
  | `d68b98f40` | BUG-001/002 台账 → 待复测 + 修复记录；README 行 12-13 |
  | `449dba5fd` | BUG-003 `StringEditor.save()` `.catch` + `redis.detail.saveFailed` + 验收用例 |
  | `a26aee76c` | BUG-004 TTL 内联编辑 Esc/失焦退出跃迁（`busy` 忽略）+ 3 条旅程用例 |
  | `18a4d0c48` | BUG-006 只读文案按 `truncated`/超哨兵分支，新增 `redis.detail.readonly.bigValueComplete` |
  | `c9e647f2e` | BUG-005 台账四条就地更正（本记录区上半部分） |
  | `a06889d9e` | BUG-003/004/005/006 台账流转 + README 行 14-17 同步 |

- **门禁四件套**（严格串行、逐条跑在已提交状态 `a06889d9e` 上，输出为原样尾部）：

  ```text
  G1  npx vitest run --config vitest.drivers.config.ts
   Test Files  58 passed (58)
        Tests  556 passed (556)

  G2  npx tsc --noEmit
  tsc exit=0

  G3  npx vite build
  ✓ built in 4.89s
  vite exit=0

  G4  node scripts/check-driver-import-boundaries.mjs
  [check-driver-import-boundaries] ok (1472 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
  boundaries exit=0
  ```

- **基线对照**：G1 从「58 files / 546 passed / 3 skipped」→「**58 / 556 / 0 skipped**」（3 条原 skip 全部转正 + 7 条新增用例；skipped=0、passed ≥549 达标）。原 skip 所在文件复跑：`dirtyLeaveCoverage.test.tsx` → **12 passed (12)**。G4 与基线 1472 / 0 / 4 完全一致。G3 因 `pnpm build` 的 pre-run deps 检查要执行 `pnpm install`（本轨禁令 + 模块目录为 symlink）而改用简报许可的等价备选 `npx vite build`（chunk 体积告警为既有现象）。
- **覆盖率**：不属四门禁，本轮未复跑；口径 B 仍以更正 1 的复算值 **85.57 / 88.64** 为准，本轮新增用例只增不减、生产码仅改 3 处编辑器分支，≥80% 结论无回归风险。
- **偏差记录**：① BUG-001 采用「同键非毁式重取」而非 Tester 偏好的「同键也守卫」——H2 验收要求同键重取**零询问**（守卫化会自相矛盾），改后同键路径不销毁任何状态；② 未引入 draftGuard 一次性票据——每条对话框流程按构造 ≤1 次询问（create/rename→守卫化 `onSelectKey`，delete→守卫化 `onClearSelectedKey`，TTL/PERSIST→原位重取 0 询问）+ 同 tick 合并兜底，双弹已由 `[fix-selftest]` 用例排除；③ BUG-005 按修复纪律**追加更正**而非 bug 原建议的「就地改写」；④ `redisBigValue.ts` 判定逻辑未改（`big = truncated || overSentinel` 负责「是否只读」，正确），分支落在 `keyReadOnlyPolicy.ts` 的 reason 选取处。
- **交接**：6 条 bug 交回**新一棒 Tester 复测**；本轮 fixer 自测（各文件绿）不替代复测判定。

## 第 2 轮复测（round-2 Tester · 全新实例 · 只测不修）

> 心跳 2026-09-23 13:19。复测基线 HEAD `b555270fb`（修复轮 base `09a2c9ccf`，9 commit）。
> 阶段 A/B 结论（先落盘再继续）：

### R2-A 文件面审计（`git diff 09a2c9ccf..HEAD --stat` + `git status`）

- 树干净（`无文件要提交`）；diff 涉 18 文件，全部落在许可面：本轨台账 8（README + 6 bug + progress）、
  `locales/en.ts`、`ui/__tests__/**` 5 文件、`key-browser/RedisWorkbench.tsx`、`value-editors/{StringEditor,TtlControls,keyReadOnlyPolicy}.tsx|ts`。
- **禁改面零命中**：BatchBar / ImportExport / shared / redisInvoke / console / kv-bar / meta / 宿主 src / driver-sdk / Rust / scripts / hub / 他轨台账 均无 diff。
- **`redisBigValue.ts` diff 为空**（自报一致，无需追矛盾）；`KeyWorkbenchDialogs.tsx` 亦无 diff（守卫经 Workbench 侧 props 落地，自报「如动」未动，符合）。
- `en.ts` 仅新增 2 key：`redis.detail.saveFailed`、`redis.detail.readonly.bigValueComplete`（+8 行含注释），无他人 key 变动。
- `RedisWorkbench.tsx` = **787 行 ≤ 800**。

### R2-B 回归四门禁（提交态 `b555270fb`，串行实跑，逐字留尾）

```text
G1 vitest:  Test Files 58 passed (58) · Tests 556 passed (556) · skipped=0 · Duration 11.10s · exit=0
G2 tsc:     tsc exit=0（0 error）
G3 build:   ✓ built in 5.07s · vite exit=0（chunk 体积告警为既有现象；npx vite build 等价口径，见偏差⑤）
G4 bound:   ok (1472 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s)) · exit=0
            R3 advisory 4 行逐字：locales.test.ts:107 / driverUiSetup.ts:25 / driverUiSetup.ts:26 / DocumentConnectionView.tsx:25
```

⇒ 四门禁与 fixer 自报（58/556/0、0、0、1472/0/4）**逐项吻合**。

### R2-C 六条声明偏差独立裁定（只测不修；⑥ 探针见 R2-F）

| # | 声明 | 裁定 | 关键论据 |
| - | ---- | ---- | -------- |
| ① | BUG-001 修复（同键重取原位化）会把「已保存后的自动重取」误判成脏弹问 | **成立** | H 的字面断言就是「零询问 + 草稿完好」且现已绿（12/12）——守卫恒开与它直接矛盾；原位路径 `inPlace=true` 时 loading/detail/clear 三条件均不触发（`DetailColumn` 卸载仅由它们引起），编辑器保持挂载，草稿本地 + dirty 同步跳过；M-A（inPlace 恒 false）⇒ H 红，证明原位化正是该用例的测钉 |
| ② | 「四出口全部接守卫」仍满足「一次动作至多一问」 | **成立** | 逐出口走查 + 双问占位探针 + 实测：创建 F 绿（1 问、继续编辑同链不二弹）；右键删除 `[fix-selftest]` 绿（恰好一次）；右键 TTL/PERSIST H2 绿且 **零询问**（静默链）；右键改名 P1a 绿（≤1 问，flush 60ms 后无第二弹层）。`handleRefresh→refreshKeys` 的链式双问被 `draftGuard` 合并回压（`if (leavePending && leavePromise) return leavePromise`，dirty=false 时第二问即时通过）⇒ 结构上不可能出现第二弹层；探针 P2a（keep）/P2b（discard）均绿。变异：M-G（撤静默包装）⇒ H2 红（包装有钉）；create 链 M-G 下由合并兜底保持绿=预期 |
| ③ | BUG-005 用「追加式更正」而非简报要求的「就地改写」 | **成立** | 台账如实性 bug 的要害是引用错值；追加节内更正 1 明确写「引用口径 B 以此为准……本节起作废」（权威声明在位），四条更正 L513-538 齐全、历史原文全保留、更正前后可对照、README 索引同步 ⇒ 引用面已如值，且符合 round-1「不删历史」的修复纪律 |
| ④ | BUG-006 只改 reason 选取处，不产生「同一 id 两种文案」的第二消费者 | **成立** | `resolveReadOnlyPolicy` 全仓唯一生产消费者是 `StringEditor`（:92 调用、:212 `data-readonly-reason`、:227-233 banner `data-i18n-key` 两分支如实）；两支状态 id 同为 `big-value` ⇒ 定位口径不变；grep 全仓无第二消费者；`redisBigValue.ts` 零 diff |
| ⑤ | `pnpm build`（禁装依赖）以 `npx vite build` 等价替代 | **成立** | 等价口径实跑 `✓ built in 5.07s · exit=0`（与自报 4.89s 同量级、同一 chunk 告警），驱动 UI 产物构成一致；node_modules 为 symlink、禁 pnpm install 合规 |
| ⑥ | 重命名选中键后标签/detail 短暂不一致但草稿完好 ⇒ 不立案 | **不成立 ⇒ 立案 BUG-007** | 探针 P1a 证组合**刚结束**时草稿三断言确实完好（绿）；但不一致**不是短暂态**——无任何机制收敛 `selectedKey≠keyDetail.key`（`onUpdateSelectedKey(next)` 在守卫前执行且答 keep 不回滚，`KeyWorkbenchDialogs.tsx:199-210`）。P1b：随后点新名行 ⇒ 守卫同键旁路（`RedisWorkbench.tsx:375-378`）⇒ `inPlace=false`（:347，`keyDetail.key` 仍是旧键）⇒ 未守卫破坏性重取（:349）⇒ 编辑器卸载，**草稿三断言静默蒸发、全程零询问**。按简报「短暂不一致但草稿完好 vs 草稿丢失 —— 只有后者立案」：实测为后者 |

### R2-D 变异矩阵（7 项；每项定向改 → 定向跑 → 记红 → `git checkout HEAD --` → `git status` 干净；生产码净改动 0）

| 变异 | 目标 | 变异内容 | 结果（红用例） |
| ---- | ---- | -------- | -------------- |
| M-A | `RedisWorkbench.tsx:347` | `inPlace` 恒 `false` | `2 failed \| 10 passed`：**H2 + H**（BUG-001/002 原位钉） |
| M-B | `RedisWorkbench.tsx:762` | 对话框 `onSelectKey` 撤回裸 `handleSelectKey` | `2 failed \| 10 passed`：**F + [fix-selftest] 创建 exactly-once**；H2 **未红**（inPlace 吸收，诚实记录，由 M-A/M-G 另钉） |
| M-G | `RedisWorkbench.tsx:761` | `onRefreshKeys` 撤掉 `refreshKeysForDialogs` 静默包装 | `1 failed \| 11 passed`：**H2**（TTL 零询问钉）；create 链合并兜底保持绿=预期 |
| M-C | `StringEditor.tsx:167-172` | 删除保存链 `.catch` | `1 failed \| 3 passed`：**BUG-003 用例 + vitest `Unhandled Rejection`** |
| M-D | `TtlControls.tsx:130-132` | 删 `onKeyDown` Escape 臂 | `1 failed \| 11 passed`：**540 Esc 用例** |
| M-E | `TtlControls.tsx:133-137` | 删 `onBlur` 臂 | `1 failed \| 11 passed`：**552 失焦用例** |
| M-F | `keyReadOnlyPolicy.ts:74` | 折叠 reason 拆分为单一常量 | `3 failed \| 18 passed`：**policy 拆分用例 + journey 截断/完整两例** |

⇒ 7/7 变异全部有红，两条修复（inPlace、守卫接线）与四条小修（catch/两臂/拆分）**逐一被测钉**；全部还原后 `git status --porcelain` 仅剩探针未跟踪文件，终态干净。

### R2-E 门禁（终态复跑）· 覆盖率复算 · skip 转正 · 断言纪律

- **终态四门禁**（含探针新文件后）：G1 `59 passed (59)` 文件 / `559 passed | 1 skipped (560)`（1 skip = BUG-007 占位探针，见 R2-F）· G2 `tsc exit=0` · G3（提交态已验 `✓ built in 5.07s · exit=0`；终态 diff 不进 build 入口图）· G4 `ok (1473 file(s) scanned · 0 blocking · 4 advisory)`（+1 = 探针文件，4 条 advisory 逐字同 R2-B）。
- **覆盖率复算**（同 v8 配置、`--coverage.all=false`，按 `git diff 8981d3078..HEAD` 生产文件集对 `coverage-summary.json` 求 Σcovered/Σtotal）：口径 A(15 文件，含 `en.ts`) **88.84% stmts / 91.20% lines**；口径 B（A 剔 `RedisWorkbench`；5 集合编辑器与 `JsonEditor` 经 diff 核验本就不在 A 内，零命中与 BUG-005 更正 2 口径一致）**92.43% / 95.43%**（bran 85.36 · funcs 90.29）。对 round-1 补测后 92.30/95.34：+0.13/+0.09pp（本轮新测增量），**≥80% 硬线余量充足，BUG-005 更正 1 结论无回归**。
- **3 枚 skip 转正**：`dirtyLeaveCoverage` 原 BUG-001 ×1、BUG-002 ×2 全部取消 skip，**断言逐字未改**（diff 仅去 `.skip`），12/12 绿；另有 2 枚 `[fix-selftest]` 双问用例绿。
- **断言纪律**：新测全部 `useI18n` 恒等 `t` 桩，断言落在 `data-testid` / `data-*` / `data-i18n-key`（如 `redis.invalidJson`、`data-string-dirty`、`data-readonly-reason`）；英文文案字面量仅出现在 `data-i18n-key` 值与键名（数据）中；`toBeTruthy()` 仅作 DOM 定位守卫（`getBy*` 缺席即抛），无空断言、无几何坐标依赖。

### R2-F 新缺陷 BUG-007 与最终判定

- **新缺陷**：`bugs/redis-detail-ui-BUG-007.md`（**高**，I-1 数据丢失，状态 `待修复`）。一句话：右键重命名**选中键** + 脏草稿答「继续编辑」⇒ `selectedKey='user:renamed'` 而 `keyDetail.key='user:1'` 恒不收敛 ⇒ 下次点新名行走守卫同键旁路（`RedisWorkbench.tsx:375-378`）⇒ `inPlace=false`（:347）⇒ **未守卫破坏性重取，编辑器卸载，草稿三断言（input 值 / `data-string-dirty` / `isDraftDirty`）静默蒸发，全程零询问** —— BUG-001 类残留旁路，生产可达。
- **证据**：探针 `ui/__tests__/round2Probe.test.tsx`——P1a 绿（组合即刻 ≤1 问 + 草稿完好，即偏差⑥ 所述"短暂不一致"确实存在且无害）、**P1b 红三断言**（`expected 'renamed-value' to be 'draft'` 等）、P2a/P2b 绿（偏差②）。P1b 断的是**正确**不变式，按第 1 轮先例暂 `describe.skip` 占位（文件头注明），修复者取消跳过即复验。
- **6 条已声明修复**：`BUG-001`~`BUG-006` 全部复验通过 ⇒ 状态翻 **`已修复`**，各 bug 文件已追加 `## 复测记录（round-2）`，`bugs/README.md` 6 行同步 + 新增 BUG-007 行。
- **最终判定：`TEST_FAILED`（第 2 轮，1 个 bug，Bug 循环 2/5）**。理由：四门禁与文件面审计全绿、6/6 修复真实有效、偏差①-⑤ 成立，但偏差⑥ 的裁定结果是**存在生产可达的 I-1 静默数据丢失旁路** ⇒ 交付项 §1-5「现状缺陷必须一并消掉」未完整达成。
- **本轮 commit 链**：`412caecb0`（R2-A/R2-B 门禁绿证）→ 探针用例 commit → 本判定 commit（6 bug 翻译 + BUG-007 + README + 本节）；全程生产码零改动（变异均即刻还原，终态 `git status` 干净）。

## 修复轮第 2 回合（BUG-007 · coder round-2 · 2026-09-23）

- **缺陷与根因**：偏差⑥ 执行序（`onUpdateSelectedKey(next)` 先于守卫）⇒ 答 keep 后 `selectedKey='user:renamed'` / `keyDetail.key='user:1'` 恒不收敛（P1a 钉住该态、要求保持绿）⇒ 下次同键树行点击走守卫同键旁路（`handleSelectKeyGuarded` :375-378）⇒ `inPlace=false`（:347）⇒ loading 翻转重挂载 ⇒ 草稿零询问蒸发（BUG-007，高 · I-1）。
- **修法（Tester 建议 (b) 的等价手段，单点收口）**：`handleSelectKey` 顶部新增 `if (key === selectedKey && keyDetail?.key !== key) { if (!(await requestDraftLeave())) return; }` —— 同键但 detail 落后即先问 I-1：keep 原样返回（草稿与状态不动，每次同键点击重问 ⇒ **有界，永不静默**）；放弃/干净态放行（破坏性重取知情执行，取回 detail 携带新名 ⇒ 不一致**当场愈合**）。一处覆盖**全部**同键入口（树行 guarded handle、头行 `reloadDetail`、对话框回读），比仅改 `handleSelectKeyGuarded` 同键分支更宽。
- **为何不选 (a)（保持一致，Tester 首选项被验收断言否决）**：P1a 同时钉死 `redis-header-key-name='user:1'`（detail 不跟名）与 `data-selected-key='user:renamed'`（选择=新名），(a) 两写法任一都会当场翻红 P1a；且 `key={detail.key}` 随 detail.key 变化重挂载 ⇒ 编辑器卸载清理按契约**立刻**毁草稿（守卫来不及问）——(a) 只是把「重取时毁草稿」提前为「改名时毁草稿」。故 (b) 为唯一同时满足 P1a+P1b 的路径，正合验收句「不一致消解或有界」。
- **行为不回归核对（三维自查）**：① 彻底 —— 同键跨不一致三入口（树行 / 头行刷新 / 对话框回读）全收口于此；保存后 `reloadDetail` 草稿已 clean ⇒ 守卫无弹层直通，post-write 语义不变。② 无误伤 —— 一致态同键（BUG-001/H2 头行刷新、TTL/PERSIST 回读、保存回读）条件不成立，零询问原样；不同键切键 `key===selectedKey` 为 false ⇒ 新守卫不触发、`:379` 一问即止，一次动作至多一问保持。③ 下一步顺畅 —— keep 后继续编辑原草稿；放弃/保存后首次同键点击即重取并愈合不一致。
- **验收（靶向 44/44 绿）**：`round2Probe.test.tsx` P1b `describe.skip` → `describe`（skip 实际在该文件，`dirtyLeaveCoverage` 全文无 skip —— 简报笔误；断言逐字未改，diff 仅去 `.skip`）⇒ 4 断言全绿、P1a 保持绿；`round2Probe 4/4 · dirtyLeaveCoverage 12/12 · dirtyLeaveJourney 11/11 · keyHeaderRowJourney 11/11 · redisWorkbench 6/6`。
- **commit 链**：`4cc510998`（BUG-007 状态→修复中）→ `9714509b1`（修复 + P1b 取消 skip）→ 本台账 commit → 门禁收口 commit。
- **门禁（提交态复跑，逐字尾部随收口 commit 补录）**：G1 `npx vitest run --config vitest.drivers.config.ts`（round-2 基线 `59 files / 559 passed / 1 skipped`，P1b 转正 ⇒ 预期 `59 / 560 passed / 0 skipped`）· G2 `npx tsc --noEmit` → 0 · G3 `npx vite build` → 0（禁 `pnpm build`，pre-run deps check 会触 `pnpm install`）· G4 `node scripts/check-driver-import-boundaries.mjs`（round-2 基线 `1473 files / 0 blocking / 4 advisory`，本轮无新增文件）。
- **门禁收口（提交态复跑，四门全绿 · 逐字尾部）**：G1 `Test Files  59 passed (59)` / `Tests  560 passed (560)` / `G1_EXIT=0`（= 基线 559 + P1b 转正，0 skipped）· G2 `npx tsc --noEmit` → `G2_EXIT=0`（0 错误）· G3 `✓ built in 10.91s` / `G3_EXIT=0`（chunk-size 提示为既有非阻断警告）· G4 `ok (1473 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))` / `G4_EXIT=0`（2 allow-listed skipped；4 条 advisory 逐字同 round-2 基线）。收口 commit 即本节所在 commit。
