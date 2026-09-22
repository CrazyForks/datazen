# `redis-tree-backend` Bug 清单（W3-B 键树扫描预算模型）

> 登记人：第 1 轮 Tester（全新实例）。规则：只测不修；缺陷在此登记，由协调者 resume 原 Coder 修复后派新 Tester 完整复测。
> 复现环境：`.worktrees/datazen-redis-tree-backend` @ HEAD `1c03f1595`，`CARGO_TARGET_DIR=/tmp/w3b2-cargo-target`，无 live Redis。

## 汇总

| Bug ID | 严重度 | 状态 | 标题 |
|---|---|---|---|
| redis-tree-backend-BUG-001 | **高** | 待修复 | `list_children` 叶子属性按**位置**回填，行集一被缩短就整体错位（`noTtlOnly` / 键中途消失即触发）——本轨引入的**回归** |
| redis-tree-backend-BUG-002 | **高** | 待修复 | `count_matching` out 由 `u64` 改对象，**驱动 UI 既有消费端未跟改**（`BatchBar` / `ImportExport` 仍 `as number`），界面渲染 `[object Object]`；tsc/vitest 全绿只因该路径零测试 |
| redis-tree-backend-BUG-003 | 中 | 待修复 | DBSIZE 读失败时三条键树命令**整条报错**，而 `## 契约冻结` 明写"DBSIZE 不可得 ⇒ 回落默认档"；较基线是**能力回退**（旧代码 `unwrap_or(0)` 容忍） |

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

### 复现（可粘贴，无需 live Redis）

临时用例（本 Tester 实测用后即删，未提交；正式 pin 建议 Coder 随修复一并落地）：
追加到 `packages/drivers/redis/src/ops_tree_scan/tests.rs`：

```rust
#[tokio::test]
async fn test_tester_list_children_keeps_leaf_rows_aligned() {
    let mut conn = TreeConn::new();
    conn.state().dbsize = 6;
    for (key, ttl, len) in [("app:a", -1i64, 1i64), ("app:b", 7, 2), ("app:c", 9, 3)] {
        let mut st = conn.state();
        st.types.insert(key.to_string(), "string".to_string());
        st.ttls.insert(key.to_string(), ttl);
        st.lens.insert(key.to_string(), len);
        st.previews.insert(key.to_string(), bulk("v"));
    }
    conn.state().scan_script.push_back((
        0,
        vec!["app:a".to_string(), "app:b".to_string(), "app:c".to_string()],
    ));

    // Path 1: the frozen `noTtlOnly` filter drops app:b from the row set.
    let page = list_children_page(
        &mut conn, "app:", 0, 100, None, true, None, false, None,
        Topology::Standalone, Instant::now(),
    )
    .await
    .expect("noTtlOnly page");
    let leaves: Vec<(String, String, i64, u64)> = page.entries.iter().filter_map(|e| match e {
        ChildEntry::Key { key, key_type, ttl, logical_len, .. } => {
            Some((key.clone(), key_type.clone(), *ttl, *logical_len))
        }
        _ => None,
    }).collect();
    assert_eq!(
        leaves,
        vec![
            ("app:a".to_string(), "string".to_string(), -1, 1),
            ("app:c".to_string(), "string".to_string(), -1, 3),
        ],
        "noTtlOnly must return exactly the non-expiring leaves, each with its OWN attributes"
    );
}
```

Tester 实测日志（两条路径各一次）：

```
# noTtlOnly=true 路径
thread '...' panicked at packages/drivers/redis/src/ops_tree.rs:239:21:
assertion `left == right` failed: leaf rows must keep page order
  left: "app:c"
 right: "app:b"
test result: FAILED. 0 passed; 1 failed; 0 ignored; ...

# app:b 的 TYPE 回 none（键中途消失）路径
thread '...' panicked at packages/drivers/redis/src/ops_tree.rs:239:21:
assertion `left == right` failed: leaf rows must keep page order
```

⇒ 现有 271 条 lib 用例**无一**走过「叶子被过滤 + 仍有其它叶子」的组合
（`list_children_appends_the_budget_trio_and_types_only_leaves` 用 `no_ttl_only=false` 且无 absent 键），
所以门禁全绿。这正是本条要补的覆盖缺口。

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

---

## 审查发现（非缺陷，不阻断，随修复回合顺手收）

- **R-1（预算 0 的双口径）**：`## 契约冻结` 写"`budget` 缺失或 `0` ⇒ `min(1M, max(50k, dbsize×2))`"，
  命令层确实如此（`commands_exec_dispatch.rs:22`/`:63`/`:392` 的 `.filter(|v| *v > 0)` ⇒ 0 折成 `None` ⇒ 走派生档）✓。
  但 `ops_tree_budget.rs:91-101` 的 op 函数对 `Some(0)` 返回 **1**（`:259-261` 还有单测钉死
  `tree_scan_budget(Some(0), 0) == 1`，注释称"typo, not scan nothing"）。两句对"0"的语义**相反**，
  今日靠分发臂的 `filter` 才没被外部走到。建议：要么 op 文档/单测改成与冻结一致（0 ⇒ None 语义），
  要么在冻结里删掉"`0`"字样、改成"缺失或 **<1**"。二选一，别两套并存。
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
