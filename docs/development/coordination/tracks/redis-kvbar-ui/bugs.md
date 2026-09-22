# redis-kvbar-ui — Bug 清单

> 第 1 轮 Tester（全新实例，接管前任现场）登记。判定：**TEST_FAILED**（4 条 `待修复`，其中 1 条 Major）。
> 本轮只测不修：生产代码一行未改，`git status` 全程干净，变异注入均已 `git checkout HEAD --` 还原。
> 命名说明：本文件编号是**本轨私有**的 `redis-kvbar-ui-BUG-nnn`。`progress.md` 里多处引用的
> “BUG-003 口径”（collapsed ⇒ 驱动自身 `redis-kv-key-props-sidebar` 才是开关判据）是**上一波别轨**的
> BUG-003 结论口径，与本文件 `redis-kvbar-ui-BUG-003` 无关，勿混。

| Bug ID | 严重度 | 状态 | 一句话 |
|---|---|---|---|
| redis-kvbar-ui-BUG-001 | **Major** | 待修复 | 切键后新键读数在飞行期间，两个槽位继续打印**上一个键**的 type/大小/TTL；侧栏同时渲染 loading 提示与旧键属性表 |
| redis-kvbar-ui-BUG-002 | Minor | 待修复 | 一次键选中发**两次**完全相同的 `key_object_info`（状态条 + 侧栏各一份，实测 2 次读 / 3 条命令） |
| redis-kvbar-ui-BUG-003 | Minor | 待修复 | 侧栏刷新按钮只重读键属性，**不**重读 `maxmemory_policy` 行（实测 `info_filtered` 1→1） |
| redis-kvbar-ui-BUG-004 | Low | 待修复 | `PTTL -2` 且 `missing:false` 时 ttl 行标成 `redis.noExpiry`；`describeTtl` 的三态分离在渲染侧无人消费 |

---

## redis-kvbar-ui-BUG-001 — 陈旧键属性跨键残留（两槽位均受影响）

- **严重度**：Major（向用户展示**错误的事实**，且与实现自己的文档声明相反）
- **状态**：`待修复`
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

---

## redis-kvbar-ui-BUG-002 — 一次键选中重复读两遍同一命令

- **严重度**：Minor（性能/服务端负载，非正确性）
- **状态**：`待修复`
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

---

## redis-kvbar-ui-BUG-003 — 刷新动作漏刷 `maxmemory_policy` 行

- **严重度**：Minor（一行数据长期陈旧，且与按钮语义不符）
- **状态**：`待修复`
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

---

## redis-kvbar-ui-BUG-004 — `PTTL -2` 被判成 “No expiry”

- **严重度**：Low（竞态下的一行错标签；三态分离在渲染侧整体失效）
- **状态**：`待修复`
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
