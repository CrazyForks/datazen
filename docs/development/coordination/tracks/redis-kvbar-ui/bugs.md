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
| **redis-kvbar-ui-BUG-005** | Low | **待修复**（第 2 轮 Tester 登记） | `dbSessionId` 跃迁时驱逐策略行**保留上一会话的值**：新会话的键属性已落地、策略行仍写旧服务器答案（BUG-001 同族的“会话维度”残留） |

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
- **状态**：`待修复`（第 2 轮 Tester 全新实例登记）
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
