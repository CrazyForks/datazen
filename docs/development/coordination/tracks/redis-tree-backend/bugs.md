# `redis-tree-backend` Bug 清单（W3-B 键树扫描预算模型）

> 登记人：第 1 轮 Tester（全新实例）。规则：只测不修；缺陷在此登记，由协调者 resume 原 Coder 修复后派新 Tester 完整复测。
> 复现环境：`.worktrees/datazen-redis-tree-backend` @ HEAD `1c03f1595`，`CARGO_TARGET_DIR=/tmp/w3b2-cargo-target`，无 live Redis。

## 汇总

| Bug ID | 严重度 | 状态 | 标题 |
|---|---|---|---|
| redis-tree-backend-BUG-001 | **高** | 已修复（round-2 Tester 复验通过） | `list_children` 叶子属性按**位置**回填，行集一被缩短就整体错位（`noTtlOnly` / 键中途消失即触发）——本轨引入的**回归** |
| redis-tree-backend-BUG-002 | **高** | 已修复（round-2 Tester 复验通过） | `count_matching` out 由 `u64` 改对象，**驱动 UI 既有消费端未跟改**（`BatchBar` / `ImportExport` 仍 `as number`），界面渲染 `[object Object]`；tsc/vitest 全绿只因该路径零测试 |
| redis-tree-backend-BUG-003 | 中 | 已修复（round-2 Tester 复验通过） | DBSIZE 读失败时三条键树命令**整条报错**，而 `## 契约冻结` 明写"DBSIZE 不可得 ⇒ 回落默认档"；较基线是**能力回退**（旧代码 `unwrap_or(0)` 容忍） |

---

## redis-tree-backend-BUG-001 · 高 · `list_children` 叶子属性错位（回归）

### 现象与根因

`packages/drivers/redis/src/ops_tree.rs:151-252` `list_children_page` 把「扫描到的键」和「children 槽位」
两条序列用**位置**对齐，但 `rows` 在回填前被 `retain` 缩短，而 `children` 没缩：

1. `split_children(&page.keys, prefix, &seps)`（`:194`）产出 `children`，叶子槽位数 = 扫描键数 N。
2. `leaf_keys`（`:195-201`）从 `children` 取，长度 N。
3. `fetch_key_meta` → `rows`（`:207-212`）**丢掉 `absent` 的键**；`no_ttl_only` 时（`:213-215`）**再丢掉有过期时间的键**。
4. `leaf_iter = rows.zip(values)`（`:228`）长度 M ≤ N，然后 `for child in children.iter_mut()`（`:229`）
   按**槽位顺序**逐个 `leaf_iter.next()`。槽位 i ≥ M 之后取到的是**后面键**的行，而不是自己的行。

`scan_keys_page`（`ops_tree_scan.rs:782-875`）无此问题：它是 `rows.into_iter().enumerate()` 重建 entries，
行集与属性同源。

### 与旧行为对比 ⇒ 本轨回归

`git show 8981d3078:packages/drivers/redis/src/ops_tree.rs`：旧实现在**回填之后**才
`children.retain(|e| Key{ttl,..} => *ttl == -1)`，即「先富化、后过滤」⇒ 位置对齐永不破坏。
新实现改成「先过滤行、后按位置富化」⇒ 语义被反转。`noTtlOnly` 是 `## 契约冻结` 承诺的既有入参，非新增面。

### 量级（两条独立触发路径，生产都常见）

- **`noTtlOnly=true`（"仅无过期"过滤，冻结承诺入参）**：一页里有 k 个带 TTL 的叶子 ⇒ 第 (第一个被过滤叶子的槽位)
  起全部错位。Release 构建下 `debug_assert_eq!`（`:239`）被编译掉，**静默**返回错数据；Debug 构建直接 panic。
- **键在 SCAN 与 meta 批之间过期/被删**（`absent` 分支，`:212`）：大库上极常见，后果同上。
- 最后一个叶子因拿不到行而保留占位值（`split_children` 的 `key_type: ""`、`ttl: -1`、`logical_len: 0`）
  ⇒ UI 显示「空类型 + 永不过期 + 长度 0」，而该键真实存在且有值。

### 复现（无需 live Redis）

Tester 已把两条路径各写成一条**提交在库里的 RED pin**（`#[ignore]` + 缺陷 ID 说明，修复后去掉
`#[ignore]` 即成为回归防线）：
`packages/drivers/redis/src/ops_tree_scan/tests.rs` 的
`test_tester_list_children_no_ttl_only_keeps_rows_aligned`（`TreeConn` 脚本化连接，
`app:a/-1/1`、`app:b/7/2`、`app:c/9/3` 三叶，`noTtlOnly=true` 只应留 a、c）与
`test_tester_list_children_survives_a_key_that_vanished_mid_page`（同形，改为 `app b` 的 `TYPE` 回 `none`）。

Tester 实测日志（两条路径各一次；`-- --ignored` 强制跑即红）：

```
# Path 1 — noTtlOnly=true（断言级证据，= release 构建的真实形态，debug_assert 被编译掉）
assertion `left == right` failed: noTtlOnly must return exactly the non-expiring leaves, each with its OWN attributes
  left:  [("app:a", "string", -1, 1), ("app:b", "", -1, 0), ("app:c", "", -1, 0)]
  right: [("app:a", "string", -1, 1), ("app:c", "string", -1, 3)]

# Path 2 — app:b 的 TYPE 回 none（键中途消失），命中 ops_tree.rs:239 的 debug_assert
panicked at packages/drivers/redis/src/ops_tree.rs:239:21:
assertion `left == right` failed: leaf rows must keep page order
  left: "gone:c"
 right: "gone:b"
```

⇒ **Path 1 是生产形态**：`app:b`（TTL=7，本该被 `noTtlOnly` 滤掉）**仍出现在结果里**，且
`app:b`/`app:c` 双双拿到占位值 `key_type:""`、`ttl:-1`、`logical_len:0` —— UI 把"7 秒后过期"的键
画成"永不过期、空类型、长度 0"。
⇒ 补测前 271 条 lib 用例**无一**走过「叶子被过滤 + 仍有其它叶子」的组合
（`list_children_appends_the_budget_trio_and_types_only_leaves` 用 `no_ttl_only=false` 且无 absent 键），
`ops_tree.rs:214`（`noTtlOnly` 臂）是**未执行行** ⇒ 门禁全绿。上述两条 RED pin 已堵上该缺口。


### 影响范围

`list_children` 命令（服务端层级树，PRD §3.2「folder 展开」的主取数路径）；
`noTtlOnly` chips（R2 过滤行）与任何带过期键的库上的普通展开。Wave 4 树 UI 一接上就会把
**别的键的类型/TTL/大小**画到某个键的行上。Cluster 与 standalone 同受影响（与路由无关）。

### 修法建议（Tester 不改业务码，仅供 Coder）

1. **按 key 关联而非位置**：`rows` 收进 `HashMap<&str, (KeyMeta, ValueFields)>`（或以
   `Vec<Option<(KeyMeta, ValueFields)>>` 与 `leaf_keys` 等长对齐），回填时 `children` 每个 `Key` 槽
   按 `key` 查自己的行；`no_ttl_only` 与 `absent` 改为在回填**之后** `children.retain(...)`（= 旧语义）。
2. 保留 `debug_assert` 之外，加一条 release 可见的守卫：行数 ≠ 叶子槽位数时 `tracing::warn!`
   （与 `:249-251` 那条"多出行"的 warn 对称），否则这条只在 debug 生效的断言就是唯一防线。
3. 补两条用例：`noTtlOnly` 混合 TTL 页；一页内一个键 `absent`。两者都要断言"每个叶子拿到自己的属性"。


### 修复记录（coder round-1）

- **commit**：`b7abb440c`（修复 + 两条回归钉子摘 `#[ignore]` 转常绿）。
- **落点**：`ops_tree.rs:205-293`。属性改为**按 key 关联**（`attrs: HashMap<String,(KeyMeta,ValueFields)>`），
  不再有任何位置 zip 回填；`absent` 键先入 `gone` 集并 `continue`（不占 `items`/`attrs` ⇒ 既不占占位值
  也不消费他键属性）；`noTtlOnly` 与 `absent` 两条过滤都挪到富化**之后**对 `children` 做 `retain`
  ⇒ 恢复 `8981d3078` 的"先富化、后过滤"语义；`debug_assert_eq!(filled, attrs.len())` 旁新增
  **release 可见** `tracing::warn!`，且批长≠叶子数时另有一条 warn（两个方向都覆盖）。
- **建议 1/2/3 全部采纳**（本清单"修法建议"三条逐条对应）。
- **用例**：`test_tester_list_children_no_ttl_only_keeps_rows_aligned`（混合 TTL 页，`app:c` 逻辑长度
  改为 3 使"错一格"可见）、`test_tester_list_children_survives_a_key_that_vanished_mid_page`（页内一键
  absent）；均断言"每个叶子拿到自己的属性"。
- **复测入口**：`cargo test -p datazen-driver-redis --lib list_children`（4 passed）；全量 lib **299 passed / 0 failed / 1 ignored**
  （基线 291 + 本条摘掉的 2 条 RED pin）。

### 复测记录（round-2）

- **判定：已修复。** 复验人：第 2 轮 Tester（全新实例）。HEAD `008fbfb75`。
- 审计 a–e 四项独立复核（按 key 关联 HashMap / retain 在富化后且与基线 `8981d3078` 同序 /
  gone 不入 attrs 无占位值 / 两条 release warn）——详见 `progress.md` `## 第 2 轮 Tester 复验记录` 阶段 1-1。
- 两条转正用例绿；**两次独立变异**：retain 挪回富化前 ⇒ 用例 1 红（+dbsize 交叉用例同红）；
  去掉 `!gone.contains(key)` ⇒ 用例 2 红。各自还原后复跑绿 ⇒ 修复由用例真实钉住，非空壳。
- 全量门禁 299/0/1 + 4/0 + 4/5 ignored + 4/0 + fmt/clippy/tsc/vitest/boundaries 全绿（阶段 2 表）。

---

## redis-tree-backend-BUG-002 · 高 · `count_matching` 形状变更漏改驱动 UI 消费端

### 现象

本轨把 `count_matching` 的 out 从 **`u64` 裸数字**（`git show 8981d3078` 的
`plugin_count_matching(...) -> u64` + `json_ok(<u64>)`）改为对象
`{count,truncated,consumed,dbsize}`（`ops_tree_scan.rs:877-890` `CountOutcome`）。这是 `## 契约冻结`
明确要求的形状（I-2 `n+` 需要它），**形状本身没错**；错在既有消费端没跟改：

- `packages/drivers/redis/ui/key-browser/BatchBar.tsx:85-96`
  `invokeCountMatching(...): Promise<number>` 里 `... ) as number`；
  `:128` `useState<number | null>`；`:152` 直接 `setMatchCount(count)`；`:366-368`
  `String(matchCount)` 渲染进 `t('redis.matchCount')`。
- `packages/drivers/redis/ui/key-browser/ImportExport.tsx:131`（同一函数）、`:99`、`:296-298` 同型。

`redisCommandInvoke`（`ui/shared/redisInvoke.ts:25-34`）返回 `result.data`，即新对象本体
（只有 `{ok:true}` 单键才 unwrap）。`as number` 是无校验断言，TS 不会报错。

### 量级

**每一次**「批量删除/批量 TTL」对话框打开（`BatchBar` `loadPatternCount`）与**每一次**
导出对话框按 pattern 估数（`ImportExport` `loadPatternCount`）都稳定复现。用户可见：
计数行渲染成 `[object Object]`（本应 `匹配 N 个键`），且 `matchCount !== null` 判定永远为真，
空态/加载态也不会回落。属信息错误而非崩溃。

### 复现（Tester 实测，scratch 用例，未提交）

```ts
const invoke = vi.fn(async () => ({ count: 7, truncated: false, consumed: 1000, dbsize: 42 }));
const count = await invokeCountMatching('sess', 0, 'app:*', invoke);
// typeof count === 'object' ; String(count) === '[object Object]'
```

输出：

```
[scratch] typeof = object | String() = [object Object] | value = {"count":7,"truncated":false,"consumed":1000,"dbsize":42}
AssertionError: expected 'object' to be 'number'
```

### 为什么四道门禁全部漏过

- `npx tsc --noEmit` = 0：`as number` 是显式断言，编译器闭嘴（这正是它危险的地方）。
- `npx vitest run --config vitest.drivers.config.ts` = 47/456 全绿：Tester 复核
  `grep -rn "count_matching" packages/drivers/redis/ui/__tests__/` ⇒ **零命中**，该函数无任何测试。
- Rust 侧全绿：命令层测试只断言新形状（正确）。
- `commands_exec_all_arms.rs:223` / `commands_exec_mutate.rs:282` 里还有**旧签名**的
  `count_matching` 臂（三参 `plugin_count_matching(id, db, pattern)`，与新四参签名不符）——
  二者均无 `include!` 引用（`commands_exec.rs:117` 只 include `commands_exec_dispatch.rs`），
  是**不参与编译的死片段**，故不红。但它们是下一次误接线时的定时炸弹，建议随本条一并删或对齐
  （死码清理属本轨范围外的存量债，本条不作为判定依据）。

### 影响范围

驱动 UI 键浏览器两处对话框的匹配计数显示（既有功能，Wave 2 之前就存在）。
Wave 4 上线树预算 UI 后，`n+` 消费的是新形状，问题会被误读成"UI 已支持"而长期潜伏。

### 修法建议（UI 面属 W3-D/E/F 或 Wave 4，本轨需裁定归属）

1. `invokeCountMatching` 返回类型改 `CountMatchingResult { count: number; truncated: boolean; consumed: number; dbsize: number }`，
   两处 `matchCount` state 同步改型，渲染按 `truncated ? `${count}+` : String(count)`（i18n 复用 `redis.matchCount`，
   `n+` 新 key 由 W3-D/E/F 轨补 `en.ts`）。
2. 补最小测试面（否则同类泄漏还会再来一次）：
   `__tests__` 里钉住"`count_matching` 消费端读 `.count` 字段"——按 `data-testid` 断言渲染结果，
   禁英文字面量（PRD §7-6）。
3. 协调者裁定：本条修复落哪一轨。若判"后端形状已冻结、消费端改动归 UI 轨"，则本条转 W3-D/E/F；
   但**必须**在合流前完成，否则 Redis 驱动 UI 带着 `[object Object]` 进 R 回归。

### 修复记录（coder round-1）

- **commit**：`dc7f55db0`。**协调者裁定归本回合，单点授权三个 ui 文件 + 新测试文件。**
- **落点**：`ui/shared/redisInvoke.ts` 导出 `CountMatchingResult{count,truncated,consumed,dbsize}`；
  `BatchBar.tsx:85-96` 的 `invokeCountMatching` 返回该对象（`as number` 消失）、`:136` state 改型、
  `:161` 消费端、`:376-381` 渲染；`ImportExport.tsx:99` state、`:131` 消费端、`:296-302` 渲染。
  新增共享 `formatMatchCount`（`truncated ⇒ "${count}+"`，否则 `String(count)`）——`+` 是数据，
  `redis.matchCount` 的 `{count}` 占位不变 ⇒ **`en.ts` 零改动**（新 key 归 W3-D/E/F 追加面）。
- **建议 2 采纳**：新测试 `ui/__tests__/treeUiBug002CountMatching.test.tsx`（8 例）钉住"消费端读 `.count`"，
  全部按 `data-testid`（`redis-pattern-match-count` / `redis-export-match-count`）断言，
  **零英文字面量**（`redis.matchCount` 被 mock 成只回 `{count}` 替换值 ⇒ 断言里只有数字）。
  覆盖两条消费端 + 空态/失败回落 + `n+` 两态。
- **反证**（证明测试非空壳）：手工把 `formatMatchCount(matchCount)` 改回 `String(matchCount)` ⇒
  BatchBar 侧 3 例红、ImportExport 侧 2 例红，收到的值恰为 `[object Object]`。
- **建议 3（本条归属）**：已按裁定在本回合修完，未转 W3-D/E/F。
- **顺带（本清单 note 4 的定时炸弹）**：`commands_exec_all_arms.rs:223` / `commands_exec_mutate.rs:282`
  的死片段选了"对齐"方案 —— 补第四参 `budget`（与 live 臂同一表达式）并在臂上加
  「DEAD FRAGMENT：本文件无人 `include!`，勿 include」说明。两文件不参与编译，门禁无感。
- **复测入口**：`npx vitest run --config vitest.drivers.config.ts` ⇒ **48 files / 464 tests passed**
  （基线 47/456 + 本文件 8 例）。

### 复测记录（round-2）

- **判定：已修复。** HEAD `008fbfb75`。
- `CountMatchingResult` 四字段与 Rust `CountOutcome`（camelCase serde）逐字段一致；
  `formatMatchCount` 的 `truncated ⇒ ${count}+` 逐字成立；UI 面 grep 确认无第三个漏网消费端
  （`delete_keys` 等其余 `as number` 属未变更形状的命令）。
- `treeUiBug002CountMatching.test.tsx` **8/8 绿**，断言全部 `data-testid` + 数字，零英文字面量。
- **两次独立变异**：BatchBar 渲染改回 `String(matchCount)` ⇒ 3 例红（收到 `[object Object]`）；
  ImportExport 同法 ⇒ 2 例红（`renders .count after the estimate is requested`、`renders n+ for a truncated count`）。
  两侧各自有防线、还原后 8/8 复绿 ⇒ 该测试文件不是只测 helper 的空壳（本清单"为什么四道门禁全部漏过"的病根已闭）。
- 改动 hunk 覆盖率：`BatchBar` 8/8 语句、`ImportExport` 6/6 语句 = **100%**；`redisInvoke.ts` 的 +16 行为纯类型声明（零运行时语句），由 tsc exit 0 与两消费端用例钉住。

---


## redis-tree-backend-BUG-003 · 中 · DBSIZE 失败 ⇒ 三条键树命令整条报错（冻结承诺的降级路径不可达 + 基线能力回退）

### 现象

`ops_tree_scan.rs:436-445` `read_dbsize` 对服务端错误 `.map_err(...)?` 直接上抛，而它是
`scan_keys_page` / `list_children_page` / `count_budgeted` 三条命令的**第一行**：

```rust
let dbsize = read_dbsize(conn).await.map_err(DriverError::QueryFailed)?;   // scan_keys_page:797
let dbsize = read_dbsize(conn).await.map_err(DriverError::QueryFailed)?;   // list_children_page:176
let dbsize = read_dbsize(conn).await?;                                     // count_budgeted:907
```

DBSIZE 一读失败，SCAN/TYPE/TTL/probe 全都没机会跑 ⇒ 键树页与计数全部红色失败。

### 与 `## 契约冻结` 冲突

预算公式段写：

> `dbsize == 0`（空库或 **DBSIZE 不可得**）回落默认档，永不产生 0 预算。

代码里"DBSIZE 不可得"这一支**不可达**：不可得 ⇒ `Err` ⇒ 整条命令失败，根本走不到
`tree_scan_budget`。Wave 4 若照这句实现"读不到 DBSIZE 就用 50k 档"的兜底 UI，会发现永远拿不到
一个带 `dbsize: 0` 的成功响应。**文档与实现二选一**（Tester 倾向：改实现 + 补用例，因为回退是基线行为）。

### 较基线是能力回退（regression）

`git show 8981d3078:packages/drivers/redis/src/redis_driver_on.rs:138`：

```rust
let db_size: i64 = redis::cmd("DBSIZE").query_async(conn).await.unwrap_or(0);
```

旧实现把 DBSIZE 当**装饰值**（失败就报 0，页照样出）。新实现把它升格为**预算输入**（合理），
但顺带把它变成**硬依赖**（不合理）：DBSIZE 是一条可以被 ACL 拒（`-NOPERM`）、被托管/代理层屏蔽、
在 Cluster 下"任一 master 不可达即整个 `Aggregate(Sum)` 失败"（见 `ops_workbench.rs` 模块文档对
`MultiNode(AllMasters, Aggregate(Sum))` 的既有描述）的命令。旧代码不受影响，新代码受影响。
⇒ 一次"每页重发 DBSIZE"的性能修复，附带引入了三类实例上的功能性回归。

### 复现（Tester 实测，scratch 双连接，用后即删）

`NoDbSizeConn`：仅 DBSIZE 返回 `ErrorKind::ClusterDown`，其余命令全部正常应答。

```
[probe2] scan_keys     -> Err("Query failed: aggregated dbsize failed- ClusterDown")
[probe2] list_children -> Err("Query failed: aggregated dbsize failed- ClusterDown")
[probe2] count         -> Err("aggregated dbsize failed- ClusterDown")
test result: ok. 1 passed; 0 failed; ...
```

⇒ 三条命令在"DBSIZE 不可得、键空间完全健康"的服务器上**一致地**全红。
（本条与 cluster 无关，standalone 下 ACL 禁 `DBSIZE` 同形复现。）

### 影响范围

- 托管 Redis（部分厂商默认不放开 `DBSIZE`）、只读 ACL profile、带代理的集群、
  以及 R 项 9a 里"某个 master 不可达"的集群。
- 同一缺陷会**顺带**放大 BUG-001：一旦按建议改为"失败 ⇒ dbsize=0 ⇒ 默认档"，
  `list_children` 的降级路径也要保证不因 `dbsize` 缺失而改行数对齐语义。

### 修法建议（Tester 不改业务码）

1. `read_dbsize` 改为**永不失败**：`Err`/不可解析 ⇒ `Ok(0)` + 一个 `tracing::warn!`
   （与基线 `unwrap_or(0)` 同语义），并让 `tree_scan_budget(None, 0)` 自然回落
   `DEFAULT_TREE_BUDGET`（该分支已有单测 `tree_scan_budget_scales_with_dbsize...` 钉住）。
   这样"DBSIZE 不可得 ⇒ 默认档"从文字变成事实，冻结无需改写。
2. 若要区分"空库"与"读不到"，追加 `dbsize_available: bool`（append-only 允许），
   UI 可据此决定"共 M 个 key"显示数字还是显示 `—`；不加也能修，属增强。
3. 补用例：`read_dbsize` 报错时三条命令仍成功且 `dbsize == 0`、`consumed` 落在默认档的首轮 1000。
4. `count_budgeted` 的 `*` 分支需同步决定：DBSIZE 不可得时 `count` 报 `0` 还是
   标记不可信 —— 建议按 (2) 的位或 `truncated=true`，避免"空库"假象（当前会把错误读成 `count: 0` 成功）。


### 修复记录（coder round-1）

- **commit**：`4380fc09b`（主体）+ `331e95b51`（SCAN 兜底形状收尾）。
- **建议 1 采纳**：`read_dbsize` **签名去掉 `Result`，直接返回 `u64`** —— 比"保留 Result 让调用方处理"
  更稳：任何未来调用方都无法再把它升回硬依赖（协调者已批准该收紧）。服务端错误与不可解析回复
  各自一条 **release 可见** `tracing::warn!` ⇒ `0`，与基线 `unwrap_or(0)` 同语义；
  三处调用点（`scan_keys_page` / `list_children_page` / `count_budgeted`）跟改。
  "DBSIZE 不可得 ⇒ 默认档"从文字变成事实（`tree_scan_budget(None, 0) == DEFAULT_TREE_BUDGET`）。
- **建议 4 由协调者裁定**：`count_budgeted` 的"全量"分支只在 `dbsize > 0` 时短路；`dbsize == 0`
  （空库或读不到）**改走一轮真 SCAN** 再出 `count`，消"空库假象"。空库只多付一轮、游标即刻归零。
  另：该轮不再发冗余 `SCAN … MATCH *`，且空 pattern 与 `*` 统一按"全量"处理。
  **冻结只追加注记、JSON 一字未动**（见 `progress.md` `## 契约冻结` `count_matching` 段）。
- **建议 2 未采纳**（`dbsize_available: bool`）：那会给冻结形状加字段，与本轨"形状不可动"红线冲突；
  裁定用 SCAN 兜底消歧后，该位不再有信息增量。留作 Wave 4 若要区分展示再议。
- **建议 3 采纳**：新增 5 条用例 —— `read_dbsize_never_fails_and_reports_zero_when_refused`、
  `scan_keys_succeeds_when_dbsize_is_refused`、
  `list_children_succeeds_with_own_attributes_when_dbsize_is_refused`（顺带钉本清单"影响范围"里
  BUG-003 会放大 BUG-001 的交叉项：降级路径不得扰动属性绑定）、
  `count_star_verifies_with_a_scan_when_dbsize_is_refused`（含空库与空 pattern 两形）、
  `count_star_still_short_circuits_when_dbsize_answers`（快路径未被削弱）。
- **复测入口**：`cargo test -p datazen-driver-redis --lib dbsize`／`... count_star`；
  全量 lib **299 passed / 0 failed / 1 ignored**。真连侧证仍挂 R-9。

### 复测记录（round-2）

- **判定：已修复。** HEAD `008fbfb75`。
- `read_dbsize` 签名实测无 `Result`（`-> u64`），三条命令的调用点全为裸 `.await`，硬依赖在类型层面已不可重建；
  refused / 不可解析两臂各自 release `warn!` ⇒ `0`，与基线 `unwrap_or(0)` 同语义（该基线行第 1 轮已 `git show` 核过）。
- 修复轮自报 5 条用例全绿且语义到位：三条命令在"仅 DBSIZE 报错、其余健康"替身下**全部成功**、
  `dbsize == 0`、`consumed` 落默认档首轮（1000）；`count_matching("*")` dbsize==0 走**恰一轮**真 SCAN
  且不带 `MATCH`（冗余已消）、空库与空 pattern 两形俱在；`dbsize > 0` 快路径 `consumed == 0` 未被削弱。
- **`## 契约冻结` 追加注记与实现逐字对照成立**（无"注记不实"型新 Bug）；一条文字精度提示（"一轮"=至少一轮、
  预算内扫尽）记入 `progress.md` 阶段 1-2，不改判。
- **两次独立变异**：去掉 `&& dbsize > 0` ⇒ `count_star_verifies…` 红（`0` vs `2`，即假答复活）；
  把"不可解析 ⇒ 0"改成返回垃圾值 ⇒ `read_dbsize_never_fails…` 红。还原后全绿。
- BUG-001/003 交叉项（降级路径扰动属性绑定）由 `list_children_succeeds_with_own_attributes_when_dbsize_is_refused`
  钉住，且该用例在变异 1（retain 前移）下同红 ⇒ 交叉防线有效。真连侧证仍挂 R-9（本轨禁 live）。


---

## 审查发现（非缺陷，不阻断，随修复回合顺手收）

- **R-1（预算 0 的双口径）**：`## 契约冻结` 写"`budget` 缺失或 `0` ⇒ `min(1M, max(50k, dbsize×2))`"，
  命令层确实如此（`commands_exec_dispatch.rs:22`/`:63`/`:392` 的 `.filter(|v| *v > 0)` ⇒ 0 折成 `None` ⇒ 走派生档）✓。
  但 `ops_tree_budget.rs:91-101` 的 op 函数对 `Some(0)` 返回 **1**（`:259-261` 还有单测钉死
  `tree_scan_budget(Some(0), 0) == 1`，注释称"typo, not scan nothing"）。两句对"0"的语义**相反**，
  今日靠分发臂的 `filter` 才没被外部走到。建议：要么 op 文档/单测改成与冻结一致（0 ⇒ None 语义），
  要么在冻结里删掉"`0`"字样、改成"缺失或 **<1**"。二选一，别两套并存。
  > **round-2 复核**：已按"改实现"一支收口（`a0444e1c1`）——`tree_scan_budget` 以
  > `requested.filter(|raw| *raw > 0)` 把 `Some(0)` 折进派生档，替换后的单测对 dbsize 三档断言
  > `Some(0) ≡ None`；命令层三处 `.filter(|v| *v > 0)` 仍在 ⇒ 两层同向，双口径消除。**已闭环。**
- **R-2（已自查撤销）**：曾疑 `ops_tree_budget.rs:60` "继承自 `ops_workbench::MAX_SCAN_ROUNDS`"
  为不实注释。Tester 复核 `ops_workbench.rs:149` 确为 `MAX_SCAN_ROUNDS: u32 = 64`、
  `MAX_STALLED_SCAN_ROUNDS` 亦为 16，与 `MAX_TREE_SCAN_ROUNDS = 64` / `MAX_TREE_STALLED_ROUNDS = 16`
  **同值同理由** ⇒ 注释成立，**不构成发现**。（登记此条自查过程，提示后续轮次勿重复误报。）
- **R-3（`list_children` 的 `keyType` 与 folder 计数）**：`keyType` 过滤在 `scan_budgeted` 里经
  `SCAN … TYPE` 生效，folder 的 `count` 因此是"该前缀下**该类型**的键数"。冻结未写明这点，Wave 4
  若把 folder 计数当"子树总键数"展示会与预期不符。建议在冻结小节补一句口径说明。
- **R-4（`exact` 分支与 `count` 的交互）**：`scan_keys_page` 精确键路径 `stop_at` 不参与
  （`ops_tree_scan.rs:801-803`），返回 0 或 1 行、`cursor=0`、`consumed=0`、`truncated=false`；
  与 I-3"计数显示 1/1"一致 ✓。仅提示 UI：`exact=true` 时不要再显示"加载更多"。
- **R-5（`redis_driver_kv.rs` 投影）**：`KeyValueDriver::scan_keys` 现在丢弃
  `consumed/truncated/exact`，只回 `(cursor, entries, dbsize)`。宿主 trait 无槽位，属预期，
  但宿主导航树因此**看不到** `truncated`，大库下会把"预算截断的首页"当全量。记为 Wave 3-A 的知情项。
