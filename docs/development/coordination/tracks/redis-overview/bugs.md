# redis-overview — 第 1 轮 Tester Bug 清单

> 登记人：`w2b-overview-tester-1`（全新实例，未复用任何编码代理）· 2026-09-22 11:17
> 被测范围：`f34beed2b..7f54bf982`（5 个 commit，工作树入口 `ba75be9d9`）· 分支 `feature/redis-overview`
> 判定：**TEST_FAILED**（3 条 `待修复` + 1 条本 Tester 已闭环）——四项门禁本身全绿，Bug 全部来自代码审查与变异复验，不是红测。
>
> 四项门禁实测（详见 `progress.md`「第 1 轮 Tester 门禁实测」）：
> `npx tsc --noEmit` **0 错**｜驱动单测 **39 files / 359 tests 全绿**（基线 33/241，本轨存量 38/346，本 Tester +1 file/+13 例）｜`npx vite build` **exit 0**｜`ui/overview/**` + `ui/lib/redisBrowseHistory.ts` 覆盖率 **最低单文件分支 88.23%**（`OverviewCard.tsx` 的 3 条防御性 fallback 分支；全部门槛 ≥80% 通过）。

---

## redis-overview-BUG-001 · 最近浏览键的「类型」在真实使用路径上永远是 `unknown`（写入端与契约端各缺一次）

- **严重度**：中（PRD §3.1 卡「最近浏览键」要求「键名 + 类型 + 相对时间」，当前仅 2/3 可满足；非崩溃、非阻塞门禁）
- **状态**：`待修复`
- **涉及文件**：
  - `packages/drivers/redis/ui/overview/RedisOverviewHome.tsx:91`（`pushBrowseEntry` 调用不传 `keyType`）
  - `packages/drivers/redis/ui/overview/overviewNavigation.ts:27-34`（`OverviewJumpTarget` 的 `key` 变体无 `keyType` 字段）
  - `packages/drivers/redis/ui/overview/RecentKeysCard.tsx:53`（`data-overview-key-type={entry.keyType ?? 'unknown'}` 只挂属性，**没有渲染任何可见类型标记**）
  - `packages/drivers/redis/ui/lib/redisBrowseHistory.ts:27,42,80,152`（存储层**已完整支持** `keyType`，即缺口不在 store）
- **描述（含量级）**：三处各差一步，串起来是整条链路断：
  1. 落地跳转时只写 `{ key, dbIndex }`，`keyType` 缺省 ⇒ store 归一化为 `null`（`redisBrowseHistory.ts:80`）；
  2. 跳转契约 `OverviewJumpTarget` 根本没有类型字段，所以第 1 步**在当前契约下无法修复**——不是漏传一个参数，是上游没有信息可传；
  3. 即使有值，`RecentKeysCard` 也只把它塞进 `data-*` 属性，用户看不到「类型」。
  旁证：`overviewNavigation.ts:96` 的 `typeTone()`（TYPE 令牌 → 徽标 tone）在**整个生产目录里零调用方**，只有 spec 直调——它显然是为这张卡的类型徽标准备的，徽标本身没落地（见 BUG-002）。
  量级：屏 A 是连接默认落地屏（裁定 8-5），最近浏览键是它唯一的**写路径**功能；写进去的历史缺类型 ⇒ 该区块在真连环境下只能显示「键名 + db + 相对时间」，PRD §3.1 该行注定不完整。
- **重现步骤**：
  1. 真连一个 Redis，屏 A 任一 key 入口接线（`onOpenTarget` 注入后）点击某个键；
  2. 回到屏 A 看「最近浏览键」区块（或 `localStorage` 里 `datazen.redis.browseHistory.v1` 的该连接桶）；
  3. 观察：条目 `keyType === null`，DOM 上 `data-overview-key-type="unknown"`，界面无类型标记。
  离线复现（本 Tester 已在变异复验中走过）：`npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/redisOverviewHome.test.tsx` 中 `writes history only for a jump that actually landed` 一例，`pushBrowseEntry` 落库对象仅 2 个键。
- **实测日志摘录**：
  - `packages/drivers/redis/ui/overview/RedisOverviewHome.tsx:89-91`
    `// PRD 最近浏览键 = 真正到过的键；只有桥接成功的 key 跳转才入历史。`
    `if (target.kind === 'key') { setRecent(pushBrowseEntry(connectionId, { key: target.key, dbIndex: target.dbIndex })); }`
  - 全仓 `keyType` 引用扫描：store 与树/编辑器侧均有，`ui/overview/**` 生产侧仅 `RecentKeysCard.tsx:53` 一处读、零处写。
- **影响范围**：仅屏 A 最近浏览键区块（属性值 + 缺失的可见标记）；历史去重/桶上限/跨连接隔离不受影响（BUG 修不动也不影响这些既有断言）。
- **建议修法（本 Tester 不改生产代码）**：`OverviewJumpTarget.key` 增 `keyType?: string | null`，`RedisOverviewHome.tsx:91` 透传，`RecentKeysCard` 按 `typeTone()` 渲染类型徽标；大 key 行的类型来源受 BUG-003 约束，可先只覆盖快捷入口与最近键自增。

---

## redis-overview-BUG-002 · 两处死导出（`memoryBarPercent` / `typeTone`），前者是全轨唯一未覆盖行

- **严重度**：低（无功能影响；但编码代理未跑门禁就宣称完成，死代码是唯一未覆盖来源，属审查必项）
- **状态**：`待修复`
- **涉及文件**：
  - `packages/drivers/redis/ui/overview/overviewModel.ts:259-262` `memoryBarPercent()`
  - `packages/drivers/redis/ui/overview/overviewNavigation.ts:96-112` `typeTone()`
- **描述（含量级）**：`memoryBarPercent` 导出后生产零调用（`MemoryCard` 自己算进度条），是覆盖率表里 `overviewModel.ts` **唯一未覆盖行 260** 的直接原因；`typeTone` 同样零生产调用，只因 spec 直调而在报告里显示 100%。二者合计 ~20 行不可达代码。
- **重现步骤**：
  1. `grep -rn "memoryBarPercent\|typeTone" packages/drivers/redis/ui --include=*.ts --include=*.tsx`；
  2. 结果：各自仅 1 处定义 + spec 引用，无任何生产调用点；
  3. 覆盖率佐证：`npx vitest run --config vitest.drivers.config.ts --coverage --coverage.include='packages/drivers/redis/ui/overview/**' --coverage.include='packages/drivers/redis/ui/lib/redisBrowseHistory.ts'` → `overviewModel.ts | 99.01 | 94.3 | 95.65 | 98.83 | 260`。
- **实测日志摘录**：见上表（全库唯一未覆盖行号即 `memoryBarPercent` 的 return 行）。
- **影响范围**：无运行时影响；`typeTone` 若按 BUG-001 落地则转为活代码，`memoryBarPercent` 建议直接删除或让 `MemoryCard` 改用它（二者取一，别留两套算法）。
- **建议修法**：BUG-001 修时顺带处置；或单开 5 分钟 commit 删除 `memoryBarPercent`。

---

## redis-overview-BUG-003 · 屏 A 大 key 行缺「类型 / TTL」两列：PRD §3.1 卡 2 只落地 2/4 列，需裁定（修复面在本轨文件范围外）

- **严重度**：中（PRD 口径与实现的偏差；不崩、不红，但验收表逐格核对时对不上）
- **状态**：`待修复`（需协调者裁定走 (A) 还是 (B)；**修复文件不在本轨 `ui/overview/**` 范围内**，故本 Tester 只登记不判越界）
- **涉及文件**：
  - `packages/drivers/redis/ui/overview/MemoryCard.tsx`（Top5 大 key 行只渲染 键名 + 字节 + `truncated` 标注）
  - `packages/drivers/redis/src/ops_observe.rs:49-60`（后端 payload：`struct MemorySample { key, bytes }` + `MemorySampleResult { samples, truncated }`，**无 type / 无 ttl**）
  - PRD 要求：`docs/todo/redis-workbench-ux/PRD.md:98` 「`memory_sample` Top5 大 key（**键名/类型/字节/TTL**）」
- **描述（含量级）**：编码代理的前端取舍**有技术依据**——屏 A 的零额外轮询不变量要求整屏只发 `info` / `db_sizes` / `memory_sample` / `slowlog_get` 四条命令，而 `memory_sample` 的返回体里确实没有类型和 TTL；补这两列要么扩 `memory_sample` 内部 pipeline（后端仍在一次 round-trip 内，不破零轮询不变量），要么改 PRD 口径。属「需要一次裁定」而非「需要一次返工」。
- **重现步骤**：
  1. `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/redisOverviewHome.test.tsx -t "big key"`（大 key 行断言只存在 `data-overview-bigkey` 键名属性，无 type/ttl 属性）；
  2. `grep -n "pub struct MemorySample" -A6 packages/drivers/redis/src/ops_observe.rs` → 两字段；
  3. 对照 `PRD.md:98` 四列。
- **实测日志摘录**：`ops_observe.rs:50-53` `pub struct MemorySample { pub key: String, pub bytes: u64 }`；屏 A 不变量断言实测会红（本 Tester 注入第 5 条 `scan_keys` 调用后 4+2 例红，见 `progress.md` 变异复验 M1）。
- **影响范围**：屏 A 内存卡 Top5 大 key 信息密度；大 key 行跳屏 B 的选中语义不受影响（其测试缺口见 BUG-004）。
- **建议修法**：(A) 扩 `memory_sample`：对已选出的 ≤N 个 key 在同一 pipeline 内追加 `TYPE` + `TTL`，前端补两列（与 BUG-001 的类型链路共用）；(B) 若裁定屏 A 不做大 key 类型，就把 PRD §3.1 该行改为「键名/字节 + 采样口径标注」并记进 §8 裁定表。

---

## redis-overview-BUG-004 · 「只有真正落地的键跳转才写历史」这条守卫在编码代理套件里两种变异都存活 → 本 Tester 已补测闭环

- **严重度**：中（守卫是双条件，缺任一半的回归都测不出来：给 db 格子/快捷动作写历史、或未到达屏 B 也写历史）
- **状态**：`已闭环（Tester 补测，待第 2 轮复测确认）`——不需要原 Coder 动作，修复内容就是本 Tester 新增的 spec（`test(redis-overview): …` commit）
- **涉及文件**：
  - 缺口原在 `packages/drivers/redis/ui/__tests__/redisOverviewHome.test.tsx:462-508`（`writes history only for a jump that actually landed` 只点 `db-cell` 与 `bigkey`，且**全程不注入 `onOpenTarget`** ⇒ 既不触发「落地 + 非键」组合，也从不触发 `kind === 'key'` 分支）
  - 补齐：`packages/drivers/redis/ui/__tests__/overviewTesterGaps.test.tsx`（13 例，`[tester]` 前缀）中的 4 例历史守卫用例
- **描述（含量级）**：`RedisOverviewHome.tsx:87-92` 的历史写入是 `outcome.handled ∧ target.kind === 'key'` 双条件。两种拆法都能整条套件存活，即**这条守卫原本等于没测**：
  - **M4a**：改成「只要 handled 就写历史」（非键目标写进 `key: 'database'` 这种垃圾条目）；
  - **M4b**：把 `if (target.kind === 'key')` 挪到 `handled` 判定之外（未接线、只弹引导提示的点击也写历史，直接违反 PRD「真正到过的键」口径）。
  本 Tester 以 4 例封口：未接线大 key 行点击后 `localStorage` 仍 `null`；未接线最近键点击后该连接桶与点击前**逐字节相同**；已接线键跳转写入 `{ kind:'key', dbIndex, key }` 且条目重新置顶+时间戳刷新；已接线 db 格子跳转**不**产生任何条目。
- **重现步骤**（本 Tester 实测，事后 `git diff` 空）：
  1. **M4a**：把 `RedisOverviewHome.tsx:90-92` 的守卫换成无条件 `pushBrowseEntry(..., { key: target.kind === 'key' ? target.key : String(target.kind), dbIndex: 'dbIndex' in target ? target.dbIndex : 0 })` → `npx vitest run --config vitest.drivers.config.ts <5 份 overview spec>` → `Tests 105 passed (105)`（**存活**）；再跑 `overviewTesterGaps.test.tsx` → `Tests 1 failed | 12 passed (13)`。
  2. **M4b**：在 `const outcome = requestOverviewJump(...)` 之后、`if (outcome.handled)` 之前插入同样的 `if (target.kind === 'key') setRecent(pushBrowseEntry(...))` → 5 份存量 spec 仍 `Tests 105 passed (105)`（**存活**）；`overviewTesterGaps.test.tsx` → `Tests 2 failed | 11 passed (13)`。
  3. 两次注入均已还原，`git status` 干净、全量套件 359 例复绿。
- **实测日志摘录**：
  - M4a：`× writing history through the bridge stays limited to key targets (db cell)` → `AssertionError: expected [ { key: 'database', …(3) } ] to have a length of +0 but got 1`
  - M4b：`× clicking a big-key row without a bridge records nothing and shows the named hint`、`× clicking a recent-key row without a bridge leaves the stored bucket untouched`
- **影响范围**：测试质量，不涉及生产行为。
- **建议修法**：无需 Coder 动作；第 2 轮复测把 `overviewTesterGaps.test.tsx` 纳入套件即可（它同时在跑覆盖率时把 `useOverviewData` 的 stale 守卫 4 条分支钉满）。

---

## 非缺陷澄清（审查已核实，避免下一轮重复调查）

| # | 项 | 核实结论 |
|---|---|---|
| N-1 | `overviewData.test.tsx` 在 `7f54bf982` 删的 2 行 | **确为死代码**：局部变量 `infoCalls` 在 `0b78374aa` 声明 + push，全文件从无读取（`grep` 独立复核），删除不丢任何断言。协调者判断正确。 |
| N-2 | `7f54bf982` 的生产 diff | 只有 `RedisOverviewHome.tsx:136` 的 `data-overview-grid` 属性一行，无逻辑改动。 |
| N-3 | 75 个 `redis.overview.*` key 只落 `en.ts`、其余 9 语言为空 | **符合约定**，非缺陷：PRD §7-3 + §8.2 明确开发期只改 `en.ts`、`i18n-sync-check` 开发期不构成门禁；运行时 `packages/ui/src/i18n.ts:87` 链为 `registry[locale] ?? registry['en'] ?? key`，中文界面回落英文而非露 key。留待发布前 i18n 回合。 |
| N-4 | 零可见英文文案断言（PRD §7-6） | 5 份存量 overview spec + 本 Tester 新增 spec **全部合规**：定位只用 `data-*` / role，`t` 被 mock 成 `(key) => key`，断言对象是 key / 属性 / 服务端 token（`7.2.4`、`blob:a`、`HGETALL h`、`—`）。 |
| N-5 | R1（驱动不 import 宿主 `src/**`）+ 宿主能力走桥 | 干净：`ui/overview/**` 与 `ui/lib/redisBrowseHistory.ts` 的外部依赖只有 `react` / `react-dom` / `lucide-react` / `@datazen/ui` / `@datazen/driver-sdk`（type-only）。屏 A 不需要 confirm/menu/settings 能力，故无 `bind*` 调用属正常。 |
| N-6 | 轨道边界 | 未越界：新增 i18n key 全在 `redis.overview.*`，未触 `redis.contextBar.*` / `redis.keyProps.*`，未进 `ui/kv-bar/**`；宿主侧仅 `meta.ts` 能力位 + `resolve-drivers.mjs` 的 `kvSlots.connectionHome` 一行贡献，未改宿主组件。 |
| N-7 | 「屏 A 全程零 `SCAN`」 | **成立且断言真的会红**（变异 M1 实测）：`useOverviewData` 的命令白名单 4 条，注入第 5 条 `scan_keys` 后 4+2 例红。 |
| N-8 | `redisOverviewHome.test.tsx` 656 行是否需拆 | **不要求拆**：未越 800 行红线、38 例职责是「同一渲染根的跨区块协同」，按区块拆只会重复 mount 成本。裁定记录在 `progress.md` 核查项 3。 |
