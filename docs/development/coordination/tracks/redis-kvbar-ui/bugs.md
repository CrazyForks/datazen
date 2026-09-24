# redis-kvbar-ui — Bug 清单

> 第 1 轮 Tester（全新实例，接管前任现场）登记。判定：**TEST_FAILED**（4 条 `待修复`，其中 1 条 Major）。
> 本轮只测不修：生产代码一行未改，`git status` 全程干净，变异注入均已 `git checkout HEAD --` 还原。
> 命名说明：本文件编号是**本轨私有**的 `redis-kvbar-ui-BUG-nnn`。`progress.md` 里多处引用的
> “BUG-003 口径”（collapsed ⇒ 驱动自身 `redis-kv-key-props-sidebar` 才是开关判据）是**上一波别轨**的
> BUG-003 结论口径，与本文件 `redis-kvbar-ui-BUG-003` 无关，勿混。

| Bug ID | 严重度 | 状态 | 一句话 |
|---|---|---|---|
| redis-kvbar-ui-BUG-001 | **Major** | **已修复**（第 2 轮 Tester 复测通过 @ `257017096`） | 切键后新键读数在飞行期间，两个槽位继续打印**上一个键**的 type/大小/TTL；侧栏同时渲染 loading 提示与旧键属性表 |
| redis-kvbar-ui-BUG-002 | Minor | **已修复**（第 2 轮 Tester 复测通过 @ `257017096`） | 一次键选中发**两次**完全相同的 `key_object_info`（状态条 + 侧栏各一份，实测 2 次读 / 3 条命令） |
| redis-kvbar-ui-BUG-003 | Minor | **已修复**（第 2 轮 Tester 复测通过 @ `257017096`） | 侧栏刷新按钮只重读键属性，**不**重读 `maxmemory_policy` 行（实测 `info_filtered` 1→1） |
| redis-kvbar-ui-BUG-004 | Low | **已修复**（第 2 轮 Tester 复测通过 @ `257017096`） | `PTTL -2` 且 `missing:false` 时 ttl 行标成 `redis.noExpiry`；`describeTtl` 的三态分离在渲染侧无人消费 |
| **redis-kvbar-ui-BUG-005** | Low | **已修复**（第 3 轮 Tester 复测通过 @ `3e382a930`） | `dbSessionId` 跃迁时驱逐策略行**保留上一会话的值**：新会话的键属性已落地、策略行仍写旧服务器答案（BUG-001 同族的“会话维度”残留） |
| **redis-kvbar-ui-BUG-006** | Low | **已修复**（协调者合流轮复验 @ `01d3ad269` 树上 64 次 0 红，免第 4 轮 Tester） | 本轨门禁测试自身有断言竞态：`kvBarSlots.test.tsx:188` 在等完一个**同步**探针后裸断言一个**异步**部件，实测 1/28 次随机红（生产代码无关，属测试侧假红） |

> **修复第 1 轮（Coder @ `eea7e0d0a` / `2dec2f402` / `90d0fb9f2` / `5e145f566`）**：四条全部改到生产码
> 并各带回归用例 ⇒ 全部置 **待复测**，每条下方新增「修复备注（Coder 第 1 轮 · sha）」给出落点与复测入口。
> 原「现象 / 重现步骤 / 建议修法」正文**保留不动**作为裁定依据存档；其中依赖 `it.skip` 的
> 「重现步骤 · 方式一」已随解开而失效，改注为变异清单入口。数字与变异表见同目录 `progress.md`
> 「第 1 轮修复回合」。`.rs` 零改动，未跑 cargo / e2e。
>
> **复测第 2 轮（Tester 全新实例 @ `3242800b4` / `257017096`）**：BUG-001~004 逐条判为
> **真缺陷已消失**（非“有无红测”），四条状态 → 已修复；阶段 A/C 判定、15 项变异复验
> （零存活）与新 Bug 见同目录 `progress.md`「第 2 轮 Tester 复测」。**BUG-005 为本轮新登记**，
> 故本轨判定为 `TEST_FAILED`（1 条 Low `待修复`）。
>
> **修复第 2 轮（Coder @ `010c6b406`，只修 BUG-005 这一条）**：策略值改为**带会话身份**
> （`{ session, value }` + 渲染期按 `dbSessionId` 过滤），登记的 `it.skip` 已解开转绿、
> 同节 evidence 绿测按 BUG-004 成对口径**改写**为断言另一臂（用例一条未删，只把钉住缺陷的
> 那两条 `toBe('noeviction')` 原位改成新行为断言），并新增
> `kvBarRound2Fixes.test.tsx` 3 例钉住“不许过度失效”一侧。BUG-005 状态 → **待复测**，
> 落点、变异表（V1~V8）与门禁原始数字见该节「修复备注」与 `progress.md`「第 2 轮修复回合」。
> 第 1 轮已判 `已修复` 的四条一行未动。
>
> **复测第 3 轮（Tester 全新实例 · 接管棒，@ `3e382a930`）**：BUG-005 判为**真已修掉**
> （独立复现"跃迁前旧值可见 → 跃迁后命名空态 → 新会话上色"整条连续旅程 + 收起抽屉跨跃迁 +
> **回到已回答过的会话**三条新路径；7 项变异零存活），状态 → **已修复**。
> 阶段 A/C 判定、`{ session, value }` 形状裁定与变异表见同目录 `progress.md`「第 3 轮 Tester 判定」。
> **本轮新登记 1 条 `待修复`：`redis-kvbar-ui-BUG-006`（Low，测试侧断言竞态）** ⇒ 轨道判定仍为
> `TEST_FAILED`，但**与 BUG-005 的闭环无关**（BUG-005 已结），修复面是一行测试代码，
> 协调者可自行裁定为"合并前顺手修"或豁免（详见该节「是否阻断合并」）。
>
> **修复第 3 轮（Coder @ `59c062da1`，只修 BUG-006 这一条）**：采建议修法 **1 的加强版** ——
> 一次 `waitFor` 内把三个判据（`data-status-state='ready'` + `selected-key` + `type`）
> 全部读自**同一个渲染根元素**，谓词与被断言的 DOM 事实由此同源，空窗帧在谓词里不再存在。
> 断言只增不减（`expect(` 计数 3 → 4，`toBe('hash')` 未降级），无 sleep / timeout / `--retry`，
> 生产代码零改动。BUG-006 状态 → **待复测**；稳定性证据（20/3/6×6 三组分母全 0 红）、
> 两项变异（M1 永不含 type、M2 永不 ready）与时序放大器的红绿判别见同目录
> `progress.md`「第 3 轮修复回合」。
> **复测方式由协调者按相称性裁定：不再派第 4 轮 Tester，合流时由协调者亲自复跑稳定性证据**
> ⇒ 文件头 `- 状态:` 仍为 `TEST_FAILED`，本回合一行未动。


---

## redis-kvbar-ui-BUG-001 — 陈旧键属性跨键残留（两槽位均受影响）

- **严重度**：Major（向用户展示**错误的事实**，且与实现自己的文档声明相反）
- **状态**：`已修复`（第 2 轮 Tester 全新实例复测通过：缺陷本身消失，非“有红测即算”；
  判据见本节「修复备注」+ `progress.md`「第 2 轮 Tester 复测」阶段 A / 阶段 C 变异复验表）
- **量级**：**每一次**“键 A → 键 B”点击都稳定复现，窗口 = B 的 `key_object_info` 往返时间
  （同一次点击要打两条相同命令，见 BUG-002，窗口因此翻倍）。人工点击快速翻键时几乎连续可见。

### 涉及文件:行号

- `packages/drivers/redis/ui/kv-bar/useKeyObjectInfo.ts:52` —— 根因：
  `setView((prev) => ({ ...prev, loading: true, failed: false }));` 进入 loading 时**保留** `prev.info`
- `packages/drivers/redis/ui/kv-bar/useKeyObjectInfo.ts:12-13` —— docblock 断言
  “Stale replies are dropped by effect identity, which is what keeps a fast key→key click from
  painting the previous key's attributes.”（**该结论只在“迟到回复”这一半成立，在“飞行窗口”这一半不成立**）
- `packages/drivers/redis/ui/kv-bar/useKeyObjectInfo.ts:19` —— `info` 字段注释“Last successful reply
  for **the current** key”，实际语义是“最后一次成功回复，可能属于别的键”
- `packages/drivers/redis/ui/kv-bar/KvStatusBar.tsx:48` —— `if (info && !info.missing)` 只看 info 是否存在，
  不看它属于哪个键；`data-status-state` 已经是 `loading`（`:35`），但 parts 仍是旧键的 type/size/TTL
- `packages/drivers/redis/ui/kv-bar/KeyPropsSidebar.tsx:144` —— 同一形状：`{info && !info.missing && (<dl>…)}`
  与 `:123-127` 的 loading 提示**同时**渲染，侧栏自身状态标记与内容互相矛盾

### 重现步骤

方式一（现成用例，2 条 `it.skip`）：

```bash
cd /Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-kvbar-ui
perl -pi -e 's/it\.skip\(/it(/g' packages/drivers/redis/ui/__tests__/kvBarSlotTesterGaps.test.tsx
npx vitest run --config vitest.drivers.config.ts \
  packages/drivers/redis/ui/__tests__/kvBarSlotTesterGaps.test.tsx
git checkout HEAD -- packages/drivers/redis/ui/__tests__/kvBarSlotTesterGaps.test.tsx
```

方式二（真机）：打开 Redis KV 面板并展开键属性抽屉 → 点一个 string 键（type=`string`/size 出现在状态条）
→ 立刻点一个大 hash 键 → 在新键读数落地前，状态条与抽屉显示的仍是**前一个** string 键的类型与字节数。

### 实测日志摘录（本轮本机执行，方式一）

```text
× PROOF-UNSKIP does not keep painting the previous key while the new read is in flight
AssertionError: expected <span …(2)>…(1)</span> to be null
- Expected: null
+ Received:
<span class="min-w-0 shrink-0" data-part="type">
  <span class="font-mono"

× PROOF-UNSKIP hides the previous key attributes while the next key is being read
AssertionError: expected <div …(2)>…(2)</div> to be null
 Tests  2 failed | 12 passed (14)
```

即：选中键已切到 `second`、`data-status-state="loading"`，`[data-part="type"]` 仍在且内容是 `first` 的类型。

### 影响范围

- 状态条 `statusBar` 与侧栏 `keyPropsSidebar` 两个槽位（PRD §3.4 全部本轨交付面）。
- 误判风险具体化：用户看状态条写着 `string / 640 B` 就去点写命令 / 选错编辑器语义；`ttl` 段更危险——
  旧键的剩余 TTL 会被当成新键的倒计时显示。
- 与台账 R3（“真实过期键不残留上一个键的 type/size”）同源：R3 原本只标为“需真连”，
  实际**进程内即可证伪**，已下沉为本 Bug。
- 不影响数据正确性（只读展示），不影响 dirty 中继（该部分变异复验全绿）。

### 建议修法

`useKeyObjectInfo` 在读发起时就不要留下跨键可复用的 payload。最小改动（保持签名与零回调约束）：

1. `:52` 改为 `setView({ info: null, loading: true, failed: false })`（新键读取期间无已知事实 ⇒ 不渲染，
   符合 §3.4“不渲染，不是渲染 0”），或
2. 把归属键记进 state（`{ info, infoKey }`），渲染侧要求 `infoKey === selectedKey` 才取用；
   `attributeViewState` 无需变更，两个槽位的 `if (info && !info.missing)` 自动收敛。
3. 同步更正 `:12-13` 与 `:19` 的 docblock，否则下一轮仍会按“已防串台”的错误前提复用该 hook（Rescuer-B 的
   contextBar 若也读该 hook，会被同一缺陷波及）。
4. 修好后解开 `kvBarSlotTesterGaps.test.tsx` 里两条 `FIXME(redis-kvbar-ui-BUG-001)` 的 `it.skip`。

**修复备注（Coder 第 1 轮 · `eea7e0d0a`）· 状态 → 待复测**

- 采建议修法 **2 的加强版**（协调者裁定：绑定在状态所有权上，不是“记得清一下”）：state 携带
  `owner = {dbSessionId, dbIndex, key}`，新增**导出的纯函数** `publishRead(read, current)`
  （`useKeyObjectInfo.ts`）在 **render 期间**按 owner 令牌过滤，成功/失败回包落地时再各校验一次。
  修法 1（loading 时清 info）单独采用会漏掉“切键 → effect 启动”之间那一帧，且仍是补丁，故未采。
- 建议修法 **3 已做**：`:12-13` 那条“effect identity 会丢弃迟到回复”的错误 docblock 声明与
  `:19` 的 `Last successful reply for the current key` 注释**均已删除重写**，
  现声明的是不变量本身（“一次读只属于一个键”），Rescuer-B 复用该 hook 的前提已修正。
- 建议修法 **4 已做**：`kvBarSlotTesterGaps.test.tsx` 两条 `it.skip` 解开并转绿。
- 复测入口：新文件 `__tests__/kvBarRound1Fixes.test.tsx` 的 `[fix:BUG-001]` 两个 describe
  （纯函数层逐身份字段各一条 + statusBar 槽位层的飞行窗口/乱序回包）。
  上表「方式一」的 perl 解 skip 步骤**已失效**（用例常驻非 skip），改为对 `publishRead` 与
  owner 令牌做字段删除变异（清单见 `progress.md`「变异复证表」M1~M7，全部为红）。

---

## redis-kvbar-ui-BUG-002 — 一次键选中重复读两遍同一命令

- **严重度**：Minor（性能/服务端负载，非正确性）
- **状态**：`已修复`（第 2 轮 Tester 全新实例复测通过：缺陷本身消失，非“有红测即算”；
  判据见本节「修复备注」+ `progress.md`「第 2 轮 Tester 复测」阶段 A / 阶段 C 变异复验表）
- **量级**：抽屉展开时，每次键点击 **2 次** `key_object_info`；该命令自身是 `SELECT` + pipeline
  （`MEMORY USAGE`/`OBJECT ENCODING`/`OBJECT IDLETIME`/`OBJECT FREQ`/`PTTL`/`TYPE`），
  即 1 击 = 2×(1 SELECT + 1 pipeline) 往返，翻倍于必要量；快速翻键时按倍数放大。

### 涉及文件:行号

- `packages/drivers/redis/ui/kv-bar/KvStatusBar.tsx:31` —— 第 1 个 `useKeyObjectInfo` 实例
- `packages/drivers/redis/ui/kv-bar/KeyPropsSidebar.tsx:51-56` —— 第 2 个实例（同 `dbSessionId`/`dbIndex`/`key`）
- `packages/drivers/redis/ui/kv-bar/useKeyObjectInfo.ts:6-10` —— docblock 解释了“为什么不轮询”，
  但未处理“两个消费方同一时刻要同一份数据”

### 重现步骤

临时探针（**已删除，不入库**；本轮实测数据即来自它）：在同一 `__tests__` 目录放一个用例，
用同一 relay 同时 render `RedisKvStatusBar` 与 `RedisKeyPropsSidebar open`，
`act(() => relay.selectKey('k1'))` 后统计 `redisCommandInvoke` 调用：

```bash
cd /Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-kvbar-ui
# 见本节量级；跑完 rm 该临时文件，勿提交
npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/<临时探针>.test.tsx
```

### 实测日志摘录

```text
PROBE reads-per-selection=2 keys=["k1","k1"] total=3
```

（同一 `k1` 两条 `key_object_info`；`total=3` 里另有一条侧栏的 `info_filtered`。
对照组：只挂侧栏时读数为 1 —— 见 BUG-003 探针输出 `key_object_info 1->2`。）

### 影响范围

- 抽屉展开状态下的每次键切换；托管 Redis / 高延迟链路上状态条与侧栏的落地延迟同步翻倍，
  并把 BUG-001 的错误窗口等比拉长。
- 属驱动侧可自洽解决的问题，不需要扩 `KvSlotState` 契约（不属 W2-C 范围）。

### 建议修法

在 `ui/kv-bar` 内部做 **in-flight / 短 TTL 结果去重**，不改契约也不建跨面板单例：
以一个随组件树生命周期存活的 `Map<string, Promise>`（`dbSessionId:dbIndex:key` 为键，
用 `useRef` 持有或挂在 provider 上）让第二个消费者复用第一个的 Promise；
键切换/会话切换/unmount 必须清表（否则会把 BUG-001 换成“缓存串台”这一更难查的形态）。
若判定为“不值得为本轨引入缓存层”，请在 `useKeyObjectInfo.ts` docblock 就地写明取舍，
并把本条降级为已裁定不修，别让它以隐性方式留在两个槽位身上。

**修复备注（Coder 第 1 轮 · `2dec2f402`）· 状态 → 待复测**

- 走协调者给的 **(a) 选项：in-flight 去重**，未走 (b)（不移交 W2-C，不需要新契约、未改 `KvSlotState`）。
- 实现即建议修法描述的形状，但表载体是 **`WeakMap<KvSlotState, Map<owner令牌, Promise>>`**
  而不是 `useRef`：宿主 `src/windows/connection/useKvWorkspaceSlots.ts` 把**同一个** `panelState`
  对象展开给 `statusBar` 与 `keyPropsSidebar`，所以“relay 对象”天然就是面板身份，
  面板卸载（`pruneKvSlotStates`）后 WeakMap 条目即可回收 —— **表的生命周期就是面板的生命周期**，
  满足裁定里“若缓存，其键空间必须绑定面板/中继生命周期并在卸载或 `dbSessionId` 变更时失效”。
- **不是值缓存**：表里只存在进行中的 Promise，`.finally()` 立即 `delete`；
  settled 之后再点刷新或重选同一键都会真发新命令（`kvBarRound1Fixes` 有专门用例与注释）。
  `dbSessionId` 变更由 owner 令牌进键名，天然分桶。
- 取舍已写进 `useKeyObjectInfo.ts` docblock 的 “Two slots, one round trip” 段。
- 已知行为细节（请复测时按此判，不要当成 BUG-001 复发）：两个槽位各自持有 `attempt`，
  所以**侧栏的刷新按钮只重取侧栏自己那一份**（此时状态条可能仍显示上一次的 `failed`）；
  该形状由 `kvBarRound1Fixes` 里一条显式 `expect(statusState).toBe('failed')` 钉住，
  改成共享 `attempt` 必须故意翻转那条断言。

---

## redis-kvbar-ui-BUG-003 — 刷新动作漏刷 `maxmemory_policy` 行

- **严重度**：Minor（一行数据长期陈旧，且与按钮语义不符）
- **状态**：`已修复`（第 2 轮 Tester 全新实例复测通过：缺陷本身消失，非“有红测即算”；
  判据见本节「修复备注」+ `progress.md`「第 2 轮 Tester 复测」阶段 A / 阶段 C 变异复验表）
- **量级**：策略行只在 `(open, dbSessionId)` 跃迁时取一次；面板存活期内点多少次刷新都不会再取，
  刷新 N 次 ⇒ `info_filtered` 调用 0 次。

### 涉及文件:行号

- `packages/drivers/redis/ui/kv-bar/KeyPropsSidebar.tsx:59-68` —— policy effect 依赖 `[open, dbSessionId]`，
  与 `reload` 无耦合
- `packages/drivers/redis/ui/kv-bar/KeyPropsSidebar.tsx:94` —— `onClick={reload}`
- `packages/drivers/redis/ui/kv-bar/useKeyObjectInfo.ts:67` —— `reload` 只 `setAttempt(n => n + 1)`，
  只驱动键属性读取
- `packages/drivers/redis/ui/kv-bar/KeyPropsSidebar.tsx:178-182` —— 被漏刷的那一行

### 重现步骤

同 BUG-002：临时探针 render 展开的侧栏 → 选中一个键至 `data-props-state="ready"` →
按命令名统计 `key_object_info` / `info_filtered` 次数 → `fireEvent.click([data-testid="redis-kv-props-refresh"])`
→ 再统计。**跑完删除临时文件。**

### 实测日志摘录

```text
PROBE refresh key_object_info 1->2 info_filtered 1->1
```

### 影响范围

- 用户改完 `maxmemory-policy`（例如刚切到 `allkeys-lfu` 想看 `OBJECT FREQ` 是否出值）后点刷新，
  驱逐策略行仍显示旧值，而 freq 行可能已变——两行自相矛盾，易被读成“工具在骗人”。
- 仅侧栏一行，量级小；不影响状态条。

### 建议修法

把 `attempt` 一并纳入 policy effect 的依赖（`useKeyObjectInfo` 已把 `reload` 暴露为 `attempt`，
侧栏可 `const [attempt, setAttempt] = useState(0)` 自建，或让 hook 把 `attempt` 一并返回），
或把刷新按钮改为显式的 `onRefresh={() => { reload(); void refreshPolicy(); }}`。
注意保留“迟到回复不得覆盖新会话”的既有不变量（该不变量已由变异 M4/新会话用例钉住，勿在改动中弱化）。

**修复备注（Coder 第 1 轮 · `90d0fb9f2`）· 状态 → 待复测**

- 采建议第一条：`useKeyObjectInfo` 增返 `attempt`（`reload()` 即 `setAttempt(n=>n+1)`），
  侧栏 policy effect 依赖改为 `[open, dbSessionId, attempt]`（`KeyPropsSidebar.tsx:66-75`）。
  未新增第二个 hook 状态，也未把按钮改成显式双调用（那样会让“刷新”在两处各写一半）。
- 不变量未弱化：`stale` 守卫原样保留，且新文件里 P2 变异（拆掉该守卫）为红。
- 刻意保留的形状：策略**旧值在重读期间仍显示**（它是服务器级事实，不是另一个键的属性，
  与 BUG-001 的误归属不同类），代码注释与 `progress.md` 均有记载；复测请勿按 BUG-001 口径判它。
- 复测入口：`kvBarRound1Fixes.test.tsx` 的 `[fix:BUG-003]`（`info_filtered` 与 `key_object_info`
  同时 `1→2`；以及“服务器改成 `allkeys-lfu` 后刷新，行值必须跟着变”）。
  「实测日志摘录」里的 `info_filtered 1->1` 现已是 `1->2`。

---

## redis-kvbar-ui-BUG-004 — `PTTL -2` 被判成 “No expiry”

- **严重度**：Low（竞态下的一行错标签；三态分离在渲染侧整体失效）
- **状态**：`已修复`（第 2 轮 Tester 全新实例复测通过：缺陷本身消失，非“有红测即算”；
  判据见本节「修复备注」+ `progress.md`「第 2 轮 Tester 复测」阶段 A / 阶段 C 变异复验表）
- **量级**：仅当同一 pipeline 内 `TYPE` 命中、随后 `PTTL` 报键已消失（毫秒级过期竞态 / 主从切换）时出现；
  低频但确定可达，且 `describeTtl` 为此专门定义的 `kind:'missing'` 在**任何**渲染分支里都没被消费。

### 涉及文件:行号

- `packages/drivers/redis/ui/kv-bar/keyObjectInfo.ts:53-57` —— `describeTtl`：`-2 → {kind:'missing'}`
- `packages/drivers/redis/ui/kv-bar/KeyPropsSidebar.tsx:154-159` —— ttl 行
  `value={ttl?.kind === 'remaining' ? … : null} fallbackKey="redis.noExpiry"`：
  `'missing'` 与 `'no-expiry'` 落到同一个 fallback 词
- `packages/drivers/redis/ui/kv-bar/KvStatusBar.tsx:34,60` —— 同样只区分 `'remaining'`，`'missing'` 被静默吞掉
- 后端可达性依据：`packages/drivers/redis/src/ops_workbench.rs:425`（`ttl_ms` 直接取 PTTL 回复）
  与 `:439`（该分支 `missing: false` 写死），因此 `(missing:false, ttlMs:-2)` 是合法回包形状

### 重现步骤

```bash
cd /Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-kvbar-ui
perl -pi -e 's/it\.skip\((\x27labels a gone-by-PTTL key as gone/it(($1/' \
  packages/drivers/redis/ui/__tests__/kvBarSlotTesterGaps.test.tsx
npx vitest run --config vitest.drivers.config.ts \
  packages/drivers/redis/ui/__tests__/kvBarSlotTesterGaps.test.tsx
git checkout HEAD -- packages/drivers/redis/ui/__tests__/kvBarSlotTesterGaps.test.tsx
```

### 实测日志摘录

同目录常驻绿测 `pins today behaviour so the BUG-004 fix is visible from both sides` 断言并通过了当前行为：

```text
document.querySelector('[data-attr="ttl"] dd').getAttribute('data-fallback-key') === 'redis.noExpiry'
 Tests  13 passed | 3 skipped (16)
```

即：服务端刚说这个键 `-2`（已不存在），界面写“无过期时间”。

### 影响范围

- 侧栏 ttl 一行；状态条则表现为“TTL 段直接消失”，两者对同一个键给出不同叙述。
- 属于 `describeTtl` 三态设计未落地，不是翻译问题（`redis.keyProps.missing` 词条已存在且已被 missing 分支复用）。

### 建议修法

ttl 行按状态选词：`fallbackKey={ttl?.kind === 'missing' ? 'redis.keyProps.missing' : 'redis.noExpiry'}`；
状态条同理（`'missing'` 时不渲染 TTL 段即可，但需与侧栏口径一致）。
修好后解开该 `it.skip`，并把常驻绿测改为断言新标签，两条用例成对自证非空跑。

**修复备注（Coder 第 1 轮 · `5e145f566`）· 状态 → 待复测**

- 侧栏按建议原文分词：`fallbackKey={ttl?.kind === 'missing' ? 'redis.keyProps.missing' : 'redis.noExpiry'}`
  （`KeyPropsSidebar.tsx:165-170`，词条复用未新增 key）；状态条按建议保持不渲染 TTL 段，
  注释写明两侧口径（`KvStatusBar.tsx:58-63`）。`describeTtl` 三分支至此全部有消费者。
- 成对自证的落法（**未删除任何断言**）：登记的 `it.skip` 解开转绿；
  原常驻绿测 `pins today behaviour so the BUG-004 fix is visible from both sides`
  **改写**为 `keeps a genuinely never-expires key on the no-expiry word`
  （断言另一臂 `-1 ⇒ redis.noExpiry`）—— 继续断言新标签只会在 Q1 变异下与解开的那条同时红，
  是重复断言；改断言另一臂后 Q2（两臂互换）能同时红两条。
- 追加**跨槽位一致性**用例（`kvBarRound1Fixes` 的 `[fix:BUG-004]`）：同一次选中下
  侧栏行 = `redis.keyProps.missing` 且 `data-value` 为空、状态条无 `[data-part="ttl"]`，
  并配一条 `ttlMs>0` 的控制用例，保证“没有 TTL 段”不是空跑。
- 本条只改渲染侧：`ops_workbench.rs` 的 `missing:false` + `ttl_ms:-2` 形状仍在后端存在
  （属 `redis-cmds-p0` 文件面，本轨未越界），界面现已如实叙述。

---

## redis-kvbar-ui-BUG-005 — 会话切换后驱逐策略行仍显示上一会话的值

- **严重度**：Low（单行、窄窗口的一行错叙述；与 BUG-004 同量级 —— 不伪造数字、不影响写路径，
  但把**另一台服务器**的事实挂在当前会话上）
- **状态**：`已修复`（第 3 轮 Tester 全新实例复测通过 @ `3e382a930`：缺陷本身消失，非“有绿测即算”；
  独立旅程复现 + 7 项变异零存活 + `{ session, value }` 形状裁定为**状态归属正确**而非“把清值挪了个地方”，
  见本节末「复测备注（Tester 第 3 轮）」与 `progress.md` 同名节。原登记 → 修复链：
  第 2 轮 Tester 登记 → 第 2 轮修复回合 Coder @ `010c6b406` 修完，见下「修复备注」）
- **量级**：需要 (1) 面板存活期内 `dbSessionId` 跃迁（重连、切实例、会话重建），
  (2) 新会话的 `key_object_info`（1 条 SELECT + 1 条 pipeline）**先于** `info_filtered` 落地。
  一次跃迁最多一个窗口，时长 = 两条命令的时差；顺序不常但确定可达
  （`info_filtered` 走 `INFO` 文本解析，托管/ACL 受限服务器上更易慢）。
  **键→键切换不受影响**（见「为何范围这么窄」）。

### 涉及文件:行号

- `packages/drivers/redis/ui/kv-bar/KeyPropsSidebar.tsx:58` —— `const [policy, setPolicy] = useState<string | null>(null)`：
  策略值只有 `dbSessionId` 跃迁时的**新回复**能改写，跃迁本身**不清**
- `packages/drivers/redis/ui/kv-bar/KeyPropsSidebar.tsx:66-75` —— policy effect 的 `stale` 守卫只丢弃
  “迟到的旧会话回复”，不撤下“已经挂在屏上的旧会话值”
- `packages/drivers/redis/ui/kv-bar/KeyPropsSidebar.tsx:62-65` —— 本轮修复新增的注释断言
  “it is a server-wide fact, not another key's attribute, so keeping it cannot mis-attribute anything”：
  **论证范围过宽**，只对“键”维度成立
- `packages/drivers/redis/ui/kv-bar/keyObjectInfo.ts:136-156` —— `invokeMaxmemoryPolicy(dbSessionId)`
  以 `dbSessionId` 为作用域 ⇒ 该值恰恰**不是**“与会话无关”的事实，上述注释的前提不成立

### 重现步骤

> **第 2 轮修复后本节的 `it.skip` 演示已失效**：那条红测已解开并成为常驻绿测，同节
> evidence 绿测亦改写为断言新行为的另一臂。复测入口与变异清单见本节末「修复备注」。

常驻用例（绿测记录当前行为，配对红测按 BUG 登记规程 skip）：

```bash
cd /Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-kvbar-ui
F=packages/drivers/redis/ui/__tests__/kvBarRound2Tester.test.tsx
# 1) 当前行为（绿）：策略行仍写上一会话的 noeviction
npx vitest run --config vitest.drivers.config.ts $F
# 2) 期望行为（红，解 skip 演示，跑完还原）
cp $F /tmp/bak.tsx
perl -pi -e "s/it\.skip\('clears the eviction-policy/it('clears the eviction-policy/" $F
npx vitest run --config vitest.drivers.config.ts $F
cp /tmp/bak.tsx $F
```

### 实测日志摘录（本轮本机执行，方式 2）

```text
× clears the eviction-policy row while the next session has not answered (FIXME redis-kvbar-ui-BUG-005)
AssertionError: expected 'noeviction' to be '' // Object.is equality
  Tests  1 failed | 9 passed (10)
```

同文件 `pins the previous session policy on screen while the new session attributes have landed
(redis-kvbar-ui-BUG-005 evidence)` 为**当前行为的常驻绿测**，其内已按顺序断言：
`[data-attr="type"] dd[data-value] === 'hash'`（新会话读数）与
`[data-attr="maxmemory-policy"] dd[data-value] === 'noeviction'`（旧会话读数）**同时成立**。

### 影响范围

- 只影响侧栏 `maxmemory-policy` 一行；状态条无此行，不受影响。
- 用户可见后果：重连到另一台 Redis（或同一部署的只读副本）后，驱逐策略行仍报旧服务器策略，
  而同一屏的 freq / 其它读数已是新服务器的 —— 与 BUG-003 修的是同一类“两行自相矛盾”，
  只是触发条件从“点刷新”换成“换会话”。
- **不是 BUG-001 复发，也不是 BUG-002 的缓存漏出**：本轮变异复验 T3/T4/T13 全部为红，
  合并表确无残留值；键→键切换时整个 `<dl>` 随 `info === null` 一并卸载，旧策略值根本不上屏
  （见 `progress.md` 阶段 A「两处刻意保留形状」裁定 1）。
- 归属判断：**第 1 轮修复前即存在**（原 deps `[open, dbSessionId]` 同样不清值），
  非 `90d0fb9f2` 引入；本轮登记是因为修复回合把该形状**写成了一条不成立的不变量声明**，
  下一轮若照单复用会把它当成“已论证安全”。

### 建议修法

把策略值绑到它自己的作用域（会话），而不是绑到“上次显示的值”：

1. 最小改动 —— policy effect 内在发请求前按会话复位一次：
   `useEffect` 里 `setPolicy(prev => (policySession === dbSessionId ? prev : null))` 之类形状，
   或直接 `const [policy, setPolicy] = useState<{ session: string; value: string | null } | null>(null)`，
   渲染侧取 `policy?.session === dbSessionId ? policy.value : null`；
   **保留 `attempt` 跃迁不清值**的现状（同一会话内旧值仍可见是有意的）。
2. 同步改写 `:62-65` 的注释，把“不会误归属”的论证范围明确收窄到**键维度**，
   并写明会话维度必须清值，否则下一轮还会拿这句话当挡箭牌。
3. 修好后解开 `kvBarRound2Tester.test.tsx` 里那条 `FIXME(redis-kvbar-ui-BUG-005)` 的 `it.skip`，
   并把同节 evidence 绿测改断言新行为（参照 BUG-004 的成对改写口径，**勿删断言**）。

**修复备注（Coder 第 2 轮 · `010c6b406`）· 状态 → 待复测**

- **状态归属（建议修法 1 的第二种形状，即带身份的状态）**：`policy` 从
  `useState<string | null>` 改为 `useState<{ session: string; value: string | null } | null>`，
  回包写入时把当次的 `dbSessionId` 一起存进状态（`KeyPropsSidebar.tsx:67` 声明、`:80` 写入），渲染侧
  `const policyValue = policy?.session === dbSessionId ? policy.value : null`（`:91-93`）
  在 **render 期**按身份过滤 —— 与 BUG-001 的修法同轴（`useKeyObjectInfo` 就是
  `publishRead(read, ownerOf(...))` 的渲染期过滤），因此：会话跃迁当帧即失效，无需"记得清一下"
  的旁路旗标；也**没有新增任何缓存层**（未建 Map、未扩 `KvSlotState`、未动宿主 `src/**`）。
- **`stale` 守卫原样保留**（`:76-85`）：它是同一条规则的**写侧半边**，与读侧过滤互为独立防线，
  本轮两侧各自测过 —— 注入 V8（拆掉 `stale` 守卫、只留 tag）红 **1** 条
  （`kvBarSlotTesterGaps` 的 `drops a policy reply that lands after the session switched`：
  state 只有一个槽位，迟到回包即便带着旧 tag 不上屏，也会把当前会话已给的值**挤掉**），
  而注入 V1/V2/V6（只留守卫、拆掉归属）各红 2 条。两侧缺一侧都留活口，故不合并。
- **注释改正（建议修法 2，未删注释）**：`:62-65` 原来那句"it is a server-wide fact, not another
  key's attribute, so keeping it cannot mis-attribute anything"改为**把论证范围明确收窄到键维度**、
  并写明会话维度必须为空态（现 `:59-66`）；同时把文件头 `:8-10` 与 `keyObjectInfo.ts:129-133` 里的
  "Server-wide" 补上"跨该服务器的键、不跨会话"的口径，免得第三次复测又拿这个词当挡箭牌。
- **成对自证（建议修法 3，用例一条未删、断言按新行为改写）**：
  - 登记的 `it.skip('clears the eviction-policy row … (FIXME redis-kvbar-ui-BUG-005)')` 解开转绿，
    并加断 `data-fallback-key === redis.keyProps.unavailable`（证明是"命名空态"而不是空字符串）；
  - 同节 evidence 绿测 `pins the previous session policy on screen …` **改写**为
    `paints the eviction row only from the session that is on screen`，**改断另一臂**：
    两会话各自未答时为空 → 旧会话的回包先到也不上屏 → 只有被真正问过的那个会话上色。
    于是两类反向变异各有归宿："按旧会话上色"（V1/V2/V6）红在解开的那条，
    "永不上色"（V7）让成对的两条同时红 —— 成对非空跑。
- **新增 Coder 自带电池** `packages/drivers/redis/ui/__tests__/kvBarRound2Fixes.test.tsx`（3 例），
  钉住**过度失效**这一侧（协调者坐标系里"不要修成局部补丁"的反面）：`attempt` 与 `dbIndex`
  都**不是**失效轴 —— 同会话刷新期间本会话已给过的事实必须留在屏上，同会话换库既不清值
  也不该多花一次 `info_filtered` 往返。
- **变异自证（阶段 C 口径）**：基线 = 本轨 5 个 kv-bar 测试文件 **62 例全绿**
  （`kvBarSlots` 17 + `kvBarSlotTesterGaps` 16 + `kvBarRound1Fixes` 16 +
  `kvBarRound2Tester` 10 + 本轮新增 `kvBarRound2Fixes` 3；"去掉新电池后"那一列 = 同一批扣掉
  `kvBarRound2Fixes`，分母 59）。注入点全部在 `KeyPropsSidebar.tsx`，
  脚本 `/tmp/mut_bug005.py`（V1~V6，两种电池各跑一次）+ `/tmp/mut_bug005_v7.py` +
  `/tmp/mut_bug005_v8.py`，一律用 `/tmp` 快照还原（**未用 `git checkout`**，因为写台账时修复
  尚未提交），每次注入前断言 pattern 唯一命中，每次还原后逐字比对快照（`restored clean: True`）。

  | # | 注入 | 红数 / 62 | 去掉 `kvBarRound2Fixes` 后 | 主要变红项 |
  |---|---|---|---|---|
  | V1 | 退回缺陷形态（状态不带会话 + `setPolicy(value)` + 渲染取 `policy`） | **2** | 1 | Tester 解开的那条 + 本轮"asks each session it lands on" |
  | V2 | 保留 tag 但**拆掉渲染期过滤**（`policy?.value ?? null`） | **2** | 1 | 同 V1（证明缺陷不是"忘了写 tag"而是"归属没被消费"） |
  | V3 | 会话比较两臂互换（`!==`） | **29** | 26 | 策略行的所有正向断言 + 侧栏属性表多路 |
  | V4 | 每次触发都清值（旁路旗标式过度修正） | **1** | **0** | 仅"keeps the current session policy … while a refresh re-read is open" |
  | V5 | `dbIndex` 进 policy effect 依赖（在错误的轴上过度失效） | **1** | **0** | 仅"is not invalidated by a database switch inside the same session" |
  | V6 | 换会话时**继承旧值套上新 tag**（"聪明"作弊修法） | **2** | 1 | Tester 解开的那条 + 本轮"asks each session…" |
  | V7 | 策略行永不上色（`policyValue = null`；只跑 2 个 r2 文件，分母 13） | **7** | 4 | 成对两条 + 本轮 3 条 + r2 Tester 的键切换/刷新计数各一条（去掉新电池后只剩 Tester 文件，分母 10 → 4 红） |
  | V8 | 拆掉 `stale` 写侧守卫、只留会话 tag（两侧防线的另一半） | **1** | 1 | `kvBarSlotTesterGaps` 的"drops a policy reply that lands after the session switched"（本轮未新增用例即已守住，见上"守卫原样保留"条） |

  ⇒ **任务书要求的"注入'策略行不按 `dbSessionId` 失效'应至少一条红"由 V1/V2/V3/V6 满足**；
  V4/V5 在去掉本轮新文件后红数为 **0**，即这两条只有新电池抓得到（补测有效性自证）。
- **门禁原始数字**：见同目录 `progress.md`「第 2 轮修复回合（Coder，BUG-005 单条）」。
  新基线 **40 files / 325 passed (325) / 0 skipped**（上一基线 39 / 321 + 1 skipped (322)：
  +3 例来自新文件、+1 来自解开的那条 skip），`ui/kv-bar/**` 覆盖率仍 **100 / 100 / 100 / 100**。
- 本条只改渲染侧状态归属与注释：`.rs` 零改动，未跑 cargo / e2e / `pnpm build`。

**复测备注（Tester 第 3 轮 · `3e382a930`）· 状态 → 已修复**

- **独立复现的是缺陷本身，不是"新用例绿"**（`kvBarRound3Tester.test.tsx` 三条，全部为存量电池
  走不到的路径）：
  1. **一条连续旅程**钉住两个半帧 —— 跃迁**前** `noeviction` 必须真的可见（否则"跃迁后消失"
     可以靠"从未显示"侥幸通过）→ 跃迁后新会话的键属性已 `ready` 且 `type` 已上色，同一帧
     策略行必须为**命名空态**（`data-value=''` + `data-fallback-key=redis.keyProps.unavailable`）
     → 只有 `sess-2` 自己回答后才上色；末尾数往返 `asked === ['sess-1','sess-2']`、
     `info_filtered` 2 次、`key_object_info` 2 次，排除"靠不再发问来假装修好"。
  2. **跃迁期间抽屉处于收起**：契约义务 1 让槽位在折叠时保持挂载，带 tag 的值会跨
     close→swap→reopen **存活在 `useState` 里**，此时唯一挡得住它上屏的就是渲染期身份比对。
     这条量的正是 Coder 声称的"tag 真被消费"，裸字符串与"写了 tag 从不读"两种形态都必然红。
  3. **`sess-1 → sess-2 → sess-1`（回到曾经回答过的会话）**：所有存量电池只朝前跳，
     因此无法把"带会话 tag 的单槽"与"`Map<session, value>` 缓存"区分开（两者对没见过的会话
     都表现为空）。注入 V6（把单槽换成会话字典）实测**只有本条红** ⇒ 该退化方向此前无人守。
- **形状裁定（任务书要求）：`{ session, value }` 是状态归属正确，不是把清值挪了个地方。**
  判据三条，逐条实测：
  1. **数据与其来源同轴** —— 值来自 `invokeMaxmemoryPolicy(dbSessionId)`，作用域就是会话；
     状态里存的 tag 与它**完全同一个轴**，不引入第三个概念。
  2. **与同目录既有方案同形** —— `useKeyObjectInfo` 对键维度用的正是
     `{owner, info}` + 渲染期 `publishRead()` 过滤（`useKeyObjectInfo.ts:115-120` 定义、`:214` 渲染期调用），
     本轮把同一形状搬到会话维度，未发明第二套机制。
  3. **禁止的两项均未出现** —— 无新增缓存层（`useState` 仍是**单槽**，非 `Map`；
     实测跳回旧会话仍需重新发问，见上第 3 条），无旁路清值旗标（`setPolicy` 全文只有
     一个调用点 `:80`，且它在 `.then` 回包分支里 —— effect 触发本身不清任何值）。
     注入 V4（改成"每次触发就清值"）实测红 1 条 ⇒ "不是清值补丁"这一判断有反向证据，
     不只是读代码的结论。
- **`stale` 写侧守卫未被渲染期过滤吸收**（独立复核 Coder"两侧防线各自测过"的说法）：
  注入 V7（拆守卫、只留 tag）红 **1** 条（`kvBarSlotTesterGaps` 的
  `drops a policy reply that lands after the session switched`），且**去掉本轮新电池仍红**
  ⇒ 守卫仍是活依赖，不是冗余，无需裁"等价冗余"，也说明修法不是"用 tag 取代原有防护"。
- **越界自查**：`git diff --stat 7e809bc1c..HEAD` 生产面只有 `KeyPropsSidebar.tsx`(+29/-…)
  与 `keyObjectInfo.ts`(docblock 5 行)；`*.rs` / `Cargo.toml` / `Cargo.lock` **0 行**，
  宿主 `src/**`、`src-tauri/**`、`packages/driver-sdk`、`ui/overview/**`、`locales/en.ts`
  经逐路径 `git diff --stat` 核验**全部为空** ⇒ 未扩 `KvSlotState`、未动契约、未加词条。

---

## redis-kvbar-ui-BUG-006 — 门禁测试自身的断言竞态（`kvBarSlots.test.tsx:188`）

- **严重度**：Low（**测试侧**缺陷，非产品缺陷：生产行为正确且下一帧自愈。
  后果是轨道门禁 `vitest` 可能**无代码变更地随机红**，实测 **1/28 次** ≈ 3.6%）
- **状态**：`已修复`（第 3 轮 Tester 独立复跑门禁时观测到，非沿用任何前棒结论；
  第 3 轮修复回合 `59c062da1` 已按建议修法 1 的加强版关闭；
  **改判由协调者在合流轮作出**——按裁定不派第 4 轮 Tester，改在合流后的集成分支树
  `01d3ad269` 上复跑 A 20 / B 3 / C 36 / D 5 = **64 次 0 红**，证据见 `progress.md`「合流轮」节）
- **量级**：28 次执行中 1 次红 —— 单文件 15 次全绿、全量串行 3 次全绿、
  6 路并发全量 6 次全绿、**与 `tsc --noEmit` 并发** 4 次全绿；
  唯一一次红恰好也发生在"tsc 与 vitest 并发"的那一批（CPU 争用放大微任务延迟）。
  ⇒ 低频、依赖机器负载，**不可按需复现**，因此只能以"机制 + 频次"登记，不能给必现步骤。
- **涉及文件:行号**：`packages/drivers/redis/ui/__tests__/kvBarSlots.test.tsx:179-194`
  （用例 `follows the relay: selection alone drives the read`），失败断言在 **`:188`**。

### 机理（为什么只有这一处不安全）

`:185-187` 的 `waitFor` 等的是 `[data-part="selected-key"]`，该部件在
`KvStatusBar.tsx:40-46` **直接由中继的 `selectedKey` 渲染**（同步，`act()` 内即成立）；
`:188` 随后**裸断言** `[data-part="type"]`，而它只在 `KvStatusBar.tsx:48-51` 的
`if (info && !info.missing)` 分支里出现，`info` 要等回包链
`invokeKeyObjectInfo()` → `.finally()` → `flight.then(setRead)` **≥3 跳微任务**
（`useKeyObjectInfo.ts:151-153` 建链 + `:189-207` 消费）才落到 state。
两个探针**不同源**，于是存在"selected-key 已到位、info 尚未发布"这一帧，
`waitFor` 首 tick 即通过、`:188` 在同一帧取到 `undefined`。

**全轨审计结论（免下轮重复推演）**：这是**唯一**一处"等同步探针 + 裸断异步部件"。
`kvBarSlots.test.tsx:205-210`（等 `size` 后断 `ttl`）、`:226-231`（等 `data-status-state='missing'` 后断
`type`/`size` 为 null）、`:279-292`（等 `data-props-state='ready'` 后断 7 行）、
`kvBarSlotTesterGaps.test.tsx:235-237`、`kvBarRound1Fixes.test.tsx:256-263` 均**安全**，
因为它们等待的判据与后续裸断言**出自同一次渲染的同一个 `info` 对象**
（或直接就是 `data-*-state` 这个总闸），不存在跨帧窗口。

### 重现步骤

```bash
cd /Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-kvbar-ui
# 必现性低（实测 1/28）；提高命中率的口径是让 vitest 与一个满负荷 tsc 抢 CPU：
npx --config.verify-deps-before-run=false tsc --noEmit &
npx vitest run --config vitest.drivers.config.ts   # 循环 5~30 次观测
```

### 实测日志

本轮唯一一次红的**原始输出尾部**（当时用 `tail -12` 抓取，
因此**代码帧之后的 `AssertionError` 消息行未落盘**，此处不转录未捕获的内容；
失败文件与行号由 `:188-190` 三行代码帧 + `expect(commandInvoke).toHaveBeenCalledWith('redis',
'key_object_info'` 在 `__tests__/` 下 grep **唯一命中** `kvBarSlots.test.tsx:189` 反查确定）：

```text
    |                                                                        ^
    189|     expect(commandInvoke).toHaveBeenCalledWith('redis', 'key_object_in…
    190|       dbSessionId: 'sess-1',

 Test Files  1 failed | 40 passed (41)
      Tests  1 failed | 327 passed (328)
```

余下 27 次为 `Test Files 41 passed (41) · Tests 328 passed (328)`。

### 影响范围

- 只影响 `npx vitest run --config vitest.drivers.config.ts` 这一道门禁的可信度：
  红的时候**没有任何生产代码问题**，会让人误判为本轮改动引入回归（本轮即为我的
  新电池使分母从 325 → 328 的第一跑，极易被归因成"新测试把存量测坏了"）。
- **与 BUG-005 的闭环无关**：`010c6b406` 未碰 `KvStatusBar.tsx` 与该测试文件，
  该竞态自本轨首次交付 `6e3624c7f` 即存在，第 1/2 轮 Tester 与两轮 Coder 均未观测到
  （他们的门禁跑法没有与 tsc 并发）。
- **是否阻断合并**：不阻断产品正确性；但门禁不可信本身值得修，**修复面一行测试代码**，
  协调者可裁定"合并前顺手修"或豁免（豁免则应在 R 清单留一行，说明该门禁存在已知低频假红）。

### 建议修法

把 `:188` 并入异步判据的等待，或改等"总闸"后再裸断（两种都是**加强**断言，不弱化）：

1. 首选：`:185-188` 合并为一次等待，等待目标换成**同源**的 `data-status-state`，
   再保留 `:188` 的裸断言 —— 与同文件 `:227` / `:280` 已经采用的写法对齐：
   ```tsx
   await waitFor(() =>
     expect(container.querySelector('[data-status-state]')?.getAttribute('data-status-state')).toBe('ready'),
   );
   expect(container.querySelector('[data-part="type"]')?.textContent).toBe('hash');
   ```
2. 或最小改动：`await waitFor(() => expect(container.querySelector('[data-part="type"]')?.textContent).toBe('hash'));`。
3. **禁止**用 `--retry` / 忽略该用例 / 删除断言来"修"（属弱化）；断言口径保持
   `data-*` + 服务端回显值，不得引入英文字面量文案断言。

**修复备注（Coder 第 3 轮 · `59c062da1`）· 状态 → 待复测**

- **采建议修法 1，并把"同源"做到同一个元素上**：`:185-188` 的"等同步探针 + 裸断异步部件"
  合成**一次** `waitFor`，谓词的三个判据全部读自
  `container.querySelector('[data-status-state]')` 这**一个渲染根**、在同一次同步检查里取：
  `data-status-state === 'ready'` + `[data-part="selected-key"] === 'user:1'` +
  `[data-part="type"] === 'hash'`。`KvStatusBar.tsx` 的标记（`:77` ← `:35` 的
  `attributeViewState`）与 `data-part` 列表（`:37-70`）出自**同一次渲染、同一个 `info` 对象**，
  因此"标记已是 `ready` 的那一帧必然已把 type 排进 parts"是**结构事实**：谓词无法在
  "selected-key 已到位、info 尚未发布"那类帧上成立，空窗被谓词本身排除，而不是被固定时长躲过。
- **未采用的写法（登记以免下轮重提）**：①建议修法 2（只把 `type` 那条塞进 `waitFor`）
  同样消灭竞态，但把"状态标记与部件是否彼此一致"这一维**留在无人检查**的位置，
  实测在 M2 变异下仍然漏（见下），故采修法 1；②`sleep` / 加大 `waitFor` timeout /
  `--retry` / 改弱断言一律未用。
- **断言只增不减（逐字核对）**：`toBe('hash')` 仍是服务端回显的类型名（未降为
  `not.toBeNull()` / 非空），`selected-key` 断言原样保留，`commandInvoke` 的入参断言原样保留；
  本用例 `expect(` 计数 **3 → 4**（净 +1 = 新增 `ready` 判据），用例数 17 → 17，
  未删 / 未 skip / 未改 `it.only`；无英文字面量文案断言（一律 `data-*` + 回显值）。
- **生产代码零改动**：`git diff --stat 9962c9335..59c062da1` 只有
  `packages/drivers/redis/ui/__tests__/kvBarSlots.test.tsx`（+14/−4）一个文件；
  `ui/kv-bar/**`、`ui/overview/**`、宿主 `src/**`、`src-tauri/**`、`packages/driver-sdk`、
  `locales/en.ts`、`*.rs`、`Cargo.toml`/`Cargo.lock` 经逐路径核验**全部 0 行**
  ⇒ 未扩 `KvSlotState`、未动契约、未加词条；也未新增/删除任何测试文件（分母仍是
  41 files / 328 tests）。
- **非空跑与"只增不减"的双向证明**（三次注入，跑完 `git checkout HEAD --` 还原，
  `git status --porcelain` 收尾为空；详细表见 `progress.md`「第 3 轮修复回合」）：
  - **M1 = 任务书点名的"回包链永不填充 type"**（`keyObjectInfo.ts` 的
    `invokeKeyObjectInfo` 出口强制 `type: null`）⇒ 目标用例**转红**
    （`AssertionError: expected undefined to be 'hash'`，新写法在 `waitFor` 1000ms 后失败，
    用时 1015ms（两次独立跑 1015ms / 1017ms）—— 说明谓词真的在等那一格出现，不是白等）；该文件红 3 条 / 17。
  - **M2 = `attributeViewState` 永不返回 `ready`** ⇒ **旧写法漏检**（目标用例仍绿），
    **新写法转红**（`expected 'unavailable' to be 'ready'`，该文件红 4 条 / 17）
    ⇒ 新增判据确实多守了一维，属强化而非等价改写。
  - **时序放大器（只改测试替身，不动生产码）**：把 mock 回包改成 60ms 后在另一个宏任务落地，
    即 1/28 偶发窗口的人为确定性版 ⇒ **旧写法必红**（红的正是登记的裸断言那一行，
    放大补丁加了 5 行故帧号显示 `:193` = HEAD `:188`），**新写法必绿**（17/17，该文件 140ms；修法 2 同条件 139ms）。
- **稳定性实测（三组分母全 0 红）**：目标 spec 单文件串行 **20/20**、全量驱动套件串行 **3/3**、
  全量套件 **6 路并发 × 6 轮（36 次）** 全绿；原始逐次输出见 `progress.md` 同节。
  本条属低频竞态，"注红 + 放大必红"与"三组 0 红"是同一枚证据的两面。
- **复测口径**：按协调者裁定，本条修复**不再派第 4 轮 Tester**，合流时由协调者亲自复跑稳定性证据；
  `progress.md` 文件头 `- 状态:` 本回合**一字未动**（仍 `TEST_FAILED`），返回 `READY_FOR_MERGE`。

---

## 附：本轮判定依据与不计为缺陷的事项

- 门禁四项实测数字见同目录 `progress.md`「门禁实跑数字（Tester 独立复跑）」。
- 变异复验 15 项 + 4 项追加探针逐条记录见 `progress.md`「变异复验表」；
  唯一存活变异 **M13 已判定为等价变异**（`open` 与 `enabled` 两道请求闸门互为冗余），
  并由 M14（只拆 `enabled`）、M15（两道全拆）证明“抽屉收起零请求”这一保证**确实被现有用例钉住**。
- 按协调者裁定**不登记**为本轨缺陷：
  1. `contextBar` 全量版未做（Rescuer-B 负责）；
  2. 状态条缺 `keys` 总数 / `loaded` / 扫描游标 / 多选数 / 最后写操作（需加宽 `KvSlotState`，属新轨 W2-C）。
     已专项核查“是否把取不到的事实伪造出来”：`KvStatusBar.tsx` 只渲染 props 与 `key_object_info`
     能证实的字段，取不到时**不渲染**（`dbIndex` 未解析时甚至不发命令并显式标 `unavailable`），
     **未发现写死数字或假占位当真值**，故不构成缺陷；
  3. 75 条 `redis.overview.*` / `redis.contextBar.*` 只落 `en.ts`、其余语言为空（开发期约定）；
  4. 测试断言英文字面量：本轨新增/继承用例经复核为 0 条可见文案断言（一律 `data-*` / i18n key / 服务端回显值）。

### 第 2 轮追加：核查过但**不**登记为缺陷的三项

1. **`sharedKeyObjectInfo` 的 `.finally()` 微任务竞态**（`useKeyObjectInfo.ts:151-153`）：同一 owner
   token 在极窄窗口内二次起飞（连点刷新）时，上一条 flight 的 `delete(id)` 可能摘掉新表的表项，
   后果只是**少合并一次往返**（多一条命令），表项按身份令牌分桶 ⇒ 不可能因此误归属。不建议加锁。
2. **BUG-002 修复后 `reload` 仍是每槽位各自 attempt**（协调者要求复核的保留形状 (2)）：
   侧栏刷新后状态条可停在它自己上一次的读数 —— 属“**同一个键**的陈旧读数/失败态”，
   不是“上一个键的读数”，未越 BUG-001 红线；该形状已被显式断言钉住。附带 UX 建议（非缺陷）：
   状态条自身无刷新入口，是否在 W2-C 扩契约时补一个 affordance，交协调者裁定。
3. **切键那一帧的状态标记**：`publishRead` 令 `info/loading/failed` 全空，
   `attributeViewState` 因此回 `unavailable`，下一帧（effect 起飞）才是 `loading`。
   两者都是“无已知事实”的命名空态，未伪造任何属性值，测试侧因 effect 提前 flush 而不可见；
   仅记录，不改判。

### 第 3 轮追加：核查过但**不**登记为缺陷的三项

1. **`dbIndex` 不进策略行的失效轴**（会话内换库不清值、不多花一次 `INFO`）：**判为正确，
   不是漏失效**。`INFO memory` 是实例级命令，同一会话的 16 个库共用同一个
   `maxmemory_policy`，把 `dbIndex` 纳入失效轴会在键树每次点库时白付一次往返（注入 V5
   实测正是这个后果：`info_filtered` 1→2，由 `kvBarRound2Fixes` 第三条抓住）。
   ⇒ 与 BUG-001 的键维度不对称**是应当的**，两者失效轴各自等于其数据源的作用域。
2. **策略行不存在“有策略值却没有键属性”的帧**：`<dl>` 整体在 `info && !info.missing`
   分支内（`KeyPropsSidebar.tsx:164`），因此会话跃迁期间策略行要么与其余 6 行同时缺席
   （`propsState` 非 `ready`），要么同时在场且策略为空态；不会出现“单行陈旧、其余正常”
   之外的组合。第 2 轮裁定 1 的形状在本轮 7 项注入下未被破坏。
3. **状态条不受本条影响**：`KvStatusBar.tsx` 无 `maxmemory-policy` 部件，
   且 `010c6b406` 的生产面只有侧栏一个文件 ⇒ BUG-005 的影响范围确认为**单行、单槽位**。
