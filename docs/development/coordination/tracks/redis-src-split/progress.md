# `redis-src-split` 台账

- 任务: 把 redis 驱动 crate 超 800 行的文件按职责拆分，**零行为变更**（纯机械重构 + 测试保持全绿）
- 状态: **FIXED_PENDING_RETEST**（修复轮第 1 回合：BUG-001 已修 + ERR-01/ERR-02 已更正；待第 2 轮 Tester 复测）
- 分支: `feature/redis-src-split`
- Worktree: `.worktrees/datazen-redis-src-split`
- 基线: `d049ceb4e`
- 代理: w?-redis-src-split（Coder，全新实例）
- 心跳: 2026-09-23（本回合收尾）

## 0. 环境事实（重要，供后续轨道复用）

**`read` / `grep` 工具传相对路径时解析到主检出，不是本 worktree。**
实测：`packages/drivers/redis/src/ops.rs` 在主检出是 **1172 行**（`main`，含
`count_matching`(:143) / `set_string_with_options`(:169)），在本 worktree 是 **1124 行**
（基线版**没有**这两个函数，它们来自 `main` 的独立提交）。

原因：主检出在 `main`，与基线 `d049ceb4e` **已分叉** —— `git rev-list --left-right --count main...d049ceb4e`
= **18 / 219**，且 `d049ceb4e` **不是** `main` 的祖先。

→ **本轨道全程用绝对路径**读取/编辑；后续轨道排查代码请一律绝对路径，否则会看到别的分支的代码。
（已上报协调者，写入协调者手册 §2.0。）

**本轨道基线版 `ops.rs` 无重复函数**：任务书叮嘱的「同一函数出现两次」不成立。做过函数体哈希检查，
42 个顶层函数**零重复**；任务书点名的 `count_matching` / `set_string_with_options` 在基线版**根本不存在**
（它们只存在于主检出）。故无需停下来汇报重复定义，拆分照常进行。

## 1. 门禁基线（拆分前实测，逐字）

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.05s

$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis 2>&1 | grep -E "^(running|     Running|test result)"
     Running unittests src/lib.rs
running 346 tests
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.02s
     Running tests/tree_contract_tester.rs
running 9 tests
test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/tree_scan_budget.rs
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/workbench_commands.rs
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`cargo fmt --check` 在**拆分前**即有 2 处漂移，位于**未触碰**的 `src/ops_observe.rs`：

```
$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:
```

→ 本轨道**不修**该文件（非本回合写面）；**每个 commit 后 `cargo fmt --check` 的残余必须恰好是这 2 条**，
多一条即本回合引入格式回归。所有新文件均以 `rustfmt` 独立格式化过。

## 2. 拆分前后行数表

| # | 原文件 | 前 | 拆分后 | commit |
|---|---|---|---|---|
| 1 | `src/ops_tree_scan/tests.rs` | 2394 | `tests.rs` **269** + `tests/{page_coverage 684, fail_soft 402, page_cost 282, dbsize_degradation 223, cluster 197, batch_shapes 157, count_matching 139, list_children 96}` | `bd887e0e0` |
| 2 | `src/ops_workbench/tests.rs` | 1602 | `tests.rs` **301** + `tests/{tester_coverage 360, type_distribution 272, cluster_batch 244, key_object_info 166, memory_sample 162, contract_helpers 117}` | `d230a6028` |
| 3 | `src/ops.rs` | 1124 | `ops/mod.rs` **490** + `ops/{list 122, batch 100, parse 90, types 75, scan 66, zset 61, hash 60, set 50, flush 50, keys 43, ttl 33}` | `5ebfd6290` |
| 4 | `src/connect.rs` | 1091 | `connect/mod.rs` **317** + `connect/{parse 202, live 186, plan 122, client 114, standalone 92, tls 91, cluster 67, sentinel 56}` | `dc5b34b95` |
| 5 | `src/ops_workbench/tests/cluster_topology.rs` | 1164 | `cluster_topology/mod.rs` **423** + `{census 277, routing 177, batch 161, hash_tag 150}` | `00c5f4086` |
| 6 | `src/ops_tree_scan.rs` | 988 | `ops_tree_scan/mod.rs` **107** + `{value 197, page 169, batch 160, transport 139, budget 137, meta 102, count 92}` → **见下方勘误 ERR-02** | `197434dc4` |
| 7 | `src/ops_workbench.rs` | 1070 | `ops_workbench/mod.rs` **161** + `{shapes 277, transport 253, distribution 187, memory_sample 168, primitives 96, key_info 62}` | `833fef717` |
| 8 | `src/ops_stream.rs` | 975 | `ops_stream/mod.rs` **313** + `{parse 223, entries 210, groups 114, types 99, overview 96}` | `6d8ea052e` |

### 勘误 ERR-02（第 1 轮 Tester 发现，Coder 修复回合更正）

上表第 6 行（`ops_tree_scan` 组）的 8 个数字是**誊写偏差**：Coder 当时抄的是生成器
**rustfmt 之前**的行数，而 commit 里落盘的是 rustfmt **之后**的行数（签名因加 `pub(crate) ` 变长被
换行 / 加尾逗号，每个文件多出 3~8 行）。**原值保留在上表中**，实测更正如下（其余 55 个产出文件行数正确）：

| 产出文件 | 原记 | 实测（= commit `197434dc4` 落盘值） | 差 |
|---|---|---|---|
| `ops_tree_scan/mod.rs` | 107 | **106** | −1 |
| `ops_tree_scan/value.rs` | 197 | **202** | +5 |
| `ops_tree_scan/page.rs` | 169 | **172** | +3 |
| `ops_tree_scan/batch.rs` | 160 | **165** | +5 |
| `ops_tree_scan/transport.rs` | 139 | **147** | +8 |
| `ops_tree_scan/budget.rs` | 137 | **140** | +3 |
| `ops_tree_scan/meta.rs` | 102 | **105** | +3 |
| `ops_tree_scan/count.rs` | 92 | **95** | +3 |

> 注：修复回合给 `ops_tree_scan/mod.rs` 补了 BUG-001 的 1 行 `pub use meta::meta_slots;`，
> 故其**当前**工作区行数为 **107**（= 拆分当时的 106 + 1）。上表「实测」列取**拆分 commit 当次**的值，
> 与 Tester 的口径一致。

**判据不受影响**：本条是说明性表格的誊写误差；实质判据「**每个新文件 ≤800 行**」已独立验证通过
（更正后最大者 `ops_tree_scan/value.rs` 202，全轨最大 `ops_tree_scan/tests/page_coverage.rs` 684）。

**每个新文件 ≤800 行**（最大 `ops_tree_scan/tests/page_coverage.rs` 684）。
原文件变 `mod.rs` 后均 ≤800（最大 `ops/mod.rs` 490）。

**`packages/drivers/redis/src/` 现已无任何 >800 行的文件**（任务书列出的 7 个 Rust 超限文件 +
协调者追加的 `cluster_topology.rs` **全部拆完**）。复核：

```
$ find src -name "*.rs" -exec wc -l {} + | awk '$1>800 && $2!="total"' | sort -rn
（空）

$ find src -name "*.rs" -exec wc -l {} + | grep -v total | sort -rn | head -5
     787 src/commands.rs
     786 src/redis_driver.rs
     708 src/commands_exec_dispatch.rs
     684 src/ops_tree_scan/tests/page_coverage.rs
     601 src/ops_observe.rs
```

## 3. 零行为变更的论证方法（不依赖「测试全绿」推断）

每个文件拆完都做**逐行原文比对**，不是靠测试通过反推：

1. 原文件每一行必须落进**恰好一个**新文件（用区间记账脚本断言：无重叠、无遗漏）；
2. 允许丢弃的只有**分段之间的空行**，以及**被提升到父模块的 1 行 `use`**（`ops_tree_scan` 的
   `use redis::ErrorKind;`，原因见 §4）；
3. 每个子模块的 payload 必须**逐字出现在原文对应区间**里（不是「相似」，是 `in` 判定）；
4. 断言失败就**不写文件**，脚本直接 abort。

各文件的实测结论：

| 文件 | 校验结果 |
|---|---|
| `ops_tree_scan/tests.rs` | 2394 行**行行有归属**；9 个 payload 全部逐字命中（244/151/276/134/218/91/192/397/679） |
| `ops_workbench/tests.rs` | 1583 行归属 + 19 行（空行/分段注释）丢弃；6 个 payload 逐字命中 |
| `ops.rs` | 11 个子模块 = 原文「空白 + `pub(crate) ` 前缀」等价；tests 块与模块文档逐字进 `mod.rs` |
| `connect.rs` | 8 个子模块「空白 + `pub(crate) ` + rustfmt 尾逗号」等价；macro 块与 tests 块逐字进 `mod.rs` |
| `cluster_topology.rs` | 1159 行归属 + 5 空行丢弃；4 个 payload 逐字命中（173/157/273/146） |
| `ops_tree_scan.rs` | 7 个子模块「空白 + `pub(crate) ` + 尾逗号」等价；模块文档逐字进 `mod.rs` |
| `ops_workbench.rs` | 6 个子模块同上等价；模块文档逐字进 `mod.rs`（`value`/`primitives` 两段按常量归属分段比对） |
| `ops_stream.rs` | 5 个子模块同上等价；模块文档与 tests 块逐字进 `mod.rs` |

**公开 API 面逐项不变**（拆分 `ops.rs` / `connect.rs` 的硬要求，因为 `lib.rs` 有 `pub use`）：

- `ops.rs`：拆前 `pub` 项 **38** 个，拆后 `ops/mod.rs` 的 `pub use` 重新导出 **38** 个，集合**完全相等**
  （`missing: none / extra: none`）；
- `connect.rs`：拆前 **12** 个 == 拆后 **12** 个，集合完全相等。
- `ops_tree_scan.rs`：拆前 `pub` **19** 项 + **1** 个内联 `pub mod`（`meta_slots`）= **20**；
  拆后 `pub use` **20** —— **但首次拆分时漏了 `meta_slots`（19 vs 20）**，由第 1 轮 Tester 以编译级双向探针
  判为 **BUG-001**，修复回合补 `pub use meta::meta_slots;` 后回到 **20 == 20**（见 §4b 修复记录）；
- `ops_workbench.rs`：拆前 `pub` **33**（含 2 个嵌套 `pub mod`）→ 拆后 **35** = 33 顶层项 + 2 嵌套模块；
- `ops_stream.rs`：拆前 **23** == 拆后 **23**。
- 所有调用方路径（`crate::ops::X` / `crate::connect::X` / `crate::ops_tree_scan::X` /
  `crate::ops_workbench::X` / `crate::ops_stream::X` / `lib.rs` 的 `pub use connect::{...}`）**一行未改**，
  因为 `mod.rs` 用 `pub use` 把它们原样透出。

## 4. 可见性变更清单（唯一被允许的签名改动，已在 commit message 说明）

跨子模块边界后，原本**私有**的条目无法再被兄弟模块/父模块的 `mod tests` 看到。处置规则：

- `pub` → `pub use`（crate 外部面，**不变**）；
- `pub(crate)` → `pub(crate) use`（crate 内部调用方，**不变**）；
- **私有 → `pub(crate)`**（仅此一种放宽，并在 `mod.rs` 用 `pub(crate) use` 提升）。

| 文件 | 放宽为 `pub(crate)` 的条目 |
|---|---|
| `ops.rs` | 9 个私有 fn：`apply_ttl_command`、`parse_cursor_from_value`、`parse_flat_string_array`、`parse_flat_string_pairs`、`parse_hash_scan_result`、`parse_scan_result_generic`、`parse_string_array`、`parse_zscan_result`、`value_to_string` |
| `connect.rs` | ~~18 个私有 fn~~ **23 个私有 fn**（经第 1 轮 Tester 复核更正）+ `PREFER_TLS_PROBE` 常量 + `TlsPlan::plaintext` 关联函数 |
| `ops_tree_scan.rs` | 6 个私有 fn：`fetch_page_groups`、`scatter`、`reply_at`、`pipeline_raw`、`fold_command_answer`、`is_connection_level_failure` |
| `ops_workbench.rs` | 10 个私有 fn：`slot`、`unreadable_key_state`、`master_route`、`pipeline_raw`、`routed_single`、`routed_sequential`、`issue_batch`、`fetch_dbsize`、`is_connection_level_failure`、`sample_types` |
| `ops_stream.rs` | 7 个私有 fn：`parse_stream_entry`、`parse_stream_id`、`parse_xinfo_consumers`、`parse_xinfo_groups`、`parse_xpending_entries`、`value_to_string`、`value_to_u64` |

### 勘误 ERR-01（第 1 轮 Tester 发现，Coder 修复回合更正）

**计数更正（名单本身正确，无泄漏；原值保留在上表中并划除）**：

| 项 | 原记 | 实测 | 说明 |
|---|---|---|---|
| `connect.rs` 放宽数 | 20 | **25** | = 23 私有 fn + `PREFER_TLS_PROBE` 常量 + `TlsPlan::plaintext` 关联函数。原文把「23 个私有 fn」误写成「18 个私有 fn」，故 18+1+1=20 亦随之错 |
| 全轨放宽合计 | 52 | **57** | 9（`ops`）+ 25（`connect`）+ 6（`ops_tree_scan`）+ 10（`ops_workbench`）+ 7（`ops_stream`） |

**Coder 复核实测**（按「BASE 中为私有、HEAD 中为 `pub(crate)`」的口径逐模块重算）：

```
ops             widened=  9
connect         widened= 25
ops_tree_scan   widened=  6
ops_workbench   widened= 10
ops_stream      widened=  7
GRAND TOTAL WIDENED: 57
```

`connect.rs` 的 25 项明细：`PREFER_TLS_PROBE`（常量）、`plaintext`（`TlsPlan` 关联函数）、
其余 23 个为自由 fn —— `connect_with_timeout`、`non_empty`、`opt_string`、`parse_db_index`、
`parse_host_port`、`parse_node_urls`、`parse_sentinel_urls`、`parse_tls`、`parse_topology`、
`scheme_for_tls`、`build_node_url`、`load_tls_certificates`、`tls_mode_for_plan`、`plaintext_url`、
`plaintext_sentinel_plan`、`open_standalone_client`、`open_standalone_conn_with_fallback`、
`open_standalone_pubsub`、`open_standalone_pubsub_with_fallback`、`open_cluster_conn_with_fallback`、
`open_sentinel_conn`、`open_sentinel_pubsub`、`sentinel_node_info`。

**判据不受影响**：放宽只增不减外部面（`pub(crate)` 不进 crate 对外 API），故 §3「38 == 38」「12 == 12」
及本轮修复后的 `ops_tree_scan`「20 == 20」全部成立；勘误纯属文字计数，名单与结论均未变。

**放宽只增不减外部面**：`pub(crate)` 不进入 crate 的对外 API，故 §3 的「38 == 38」「12 == 12」成立。
`ops_tree_scan/tests.rs` 的 1 行 `use redis::ErrorKind;` 从文件中段提升到父模块头部 —— 原因：拆成子模块后
该 `use` 落在兄弟模块里，`fail_soft` 取不到；提升到父模块后子模块经 `use super::*;` 正常解析（语义等价）。

**`ops.rs` 全部函数体未重写**：只移动、只加 `pub(crate) ` 前缀。rustfmt 因签名变长做了换行/尾逗号重排
（`hash.rs` 的 `parse_hash_scan_result`、`ttl.rs` 的 `apply_ttl_command`），这是**空白层**差异，字符级
（去空白后）比对确认语义零变化。

## 4b. 修复轮第 1 回合：BUG-001（`ops_tree_scan::meta_slots` 公开路径断裂）

**缺陷**（第 1 轮 Tester 登记，Coder 独立复现）：基线 `ops_tree_scan.rs` 的**顶层** `pub mod meta_slots`
使 `crate::ops_tree_scan::meta_slots` 可达；拆分把模块本体逐字留在 `ops_tree_scan/meta.rs:35`，
但 `ops_tree_scan/mod.rs` 的 `pub use` 区**漏了它** ⇒ 该路径失效（`E0433`）。
**属遗漏而非设计选择**：同批拆分的另 2 个内联 `pub mod`（`ops_workbench` 的 `key_info_slots` /
`memory_sample_slots`）都已显式 `pub use` 透出。

**修法**：`packages/drivers/redis/src/ops_tree_scan/mod.rs` 补**一行**，紧邻 `meta::*` 分组：

```rust
pub use meta::meta_slots;
```

**commit**：`5f78065cb`（`fix(redis): re-export ops_tree_scan::meta_slots (BUG-001 — broken public path, no behavior change)`）

**Coder 独立复现（编译级双向探针，验完已验净还原）**：

```
探针 A（修复前）—— 在 meta.rs 末尾注入：
    const _PROBE_A: usize = crate::ops_tree_scan::meta_slots::TYPE;
$ CARGO_TARGET_DIR=/tmp/dz-split-fix cargo build -p datazen-driver-redis
error[E0433]: failed to resolve: could not find `meta_slots` in `ops_tree_scan`
   --> could not compile `datazen-driver-redis` (lib) due to 1 previous error      ← 红

探针 A（补一行后，探针仍在）—— 同一命令：
（无 error 行；探针解析通过）                                                       ← 绿

验净：cp 备份还原 meta.rs；`grep -c _PROBE_A` = 0；`git diff --stat -- meta.rs` 无输出（逐字节同一）。
```

**公开面 20 vs 20（实测）**：

```
BASE  ops_tree_scan.rs : 19 top-level pub items + 1 inline pub mod = 20
        mods =['meta_slots']
HEAD  mod.rs           : 20 `pub use` + 14 `pub(crate) use`
BASE total (20) == HEAD `pub use` (20) : True
  missing now: none
  extra  now : none
```

**同类不对称已消除**（全轨内联 `pub mod` 与透出一一对应）：

```
OK   ops_tree_scan::meta_slots          (defined src/ops_tree_scan/meta.rs:35,  re-exported mod.rs:80)
OK   ops_workbench::key_info_slots      (defined src/ops_workbench/shapes.rs:90, re-exported mod.rs:138)
OK   ops_workbench::memory_sample_slots (defined .../memory_sample.rs:27,        re-exported mod.rs:116)
```

**门禁（修复后）**：

```
$ CARGO_TARGET_DIR=/tmp/dz-split-fix cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.06s

$ CARGO_TARGET_DIR=/tmp/dz-split-fix cargo test -p datazen-driver-redis 2>&1 | grep -E "test result"
  test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.02s
  test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.00s
  test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
  test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:          ← 仍恰为基线既有的 2 条，无新增漂移
```

**本轮关键教训**：BUG-001 存在时 `342 passed; 0 failed; 4 ignored` **依然全绿**（crate 内无调用方），
**门禁测不出公开面收缩**。「公开面集合相等」必须作为**独立判据**单独跑 —— 这是本轨最有价值的结论。

**TS-01 / TS-02（Tester 登记的覆盖空洞，均为基线既有、非本轨引入）**：本轮**未修**。
理由：本轨只做机械拆分，补测试属**扩大改动面**；两者都不是本轮引入的缺陷。
**留待独立轮**（建议单开一条「redis 驱动变异测试补强」轨道，用 `secs+1` 与去掉 `n >= 0` 两个已知变异
作为起点，反证补测有效）。

## 5. 每步门禁尾部（逐字）

### 步骤 1 — `ops_tree_scan/tests.rs` → `tests/{8 子模块}`

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.06s

$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis 2>&1 | grep -E "^(running|     Running|test result)"
     Running unittests src/lib.rs (datazen_driver_redis-7b8202e24996fc60)
running 346 tests
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.02s
     Running tests/tree_contract_tester.rs (tree_contract_tester-462a41d80c275261)
running 9 tests
test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/tree_scan_budget.rs (tree_scan_budget-f368da5a5b931df8)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/workbench_commands.rs (workbench_commands-70bfad61f163c4f4)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:
```

（本步曾引入 2 处自有 fmt 漂移：`mod` 声明未按字母序、以及提升 `use` 留下的双空行。**均已修掉** ——
`mod` 声明排序 + 空行合并，故上表只剩基线既有的 2 条。）

### 步骤 2 — `ops_workbench/tests.rs` → `tests/{6 子模块}`

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.05s

$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis 2>&1 | grep -E "^(running|     Running|test result)"
     Running unittests src/lib.rs (datazen_driver_redis-7b8202e24996fc60)
running 346 tests
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.02s
     Running tests/tree_contract_tester.rs (tree_contract_tester-462a41d80c275261)
running 9 tests
test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.01s
     Running tests/tree_scan_budget.rs (tree_scan_budget-f368da5a5b931df8)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
     Running tests/workbench_commands.rs (workbench_commands-70bfad61f163c4f4)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:
```

**本步有一次失败与回退（如实记录）**：首版拆分把跨主题共用的 reply fixture `full_key_info_replies`
和 `ShortReplyConn` 一起搬进了子模块，导致**既有**子模块 `fix_round1` 经 `use super::*;` 取不到它们
（10 个编译错误）。处置：`git checkout HEAD -- <file>` **完全回退**该文件拆分，重新分析跨模块依赖后
改为把这两个共用项**留在父模块**（`ShortReplyConn` 连同 `fix_round1` 的依赖一起提升），第二次成功。
**未留半成品**。

### 步骤 3 — `ops.rs` → `ops/{11 子模块}` + `mod.rs`

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.05s

$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis 2>&1 | grep -E "^(running|     Running|test result)"
     Running unittests src/lib.rs (datazen_driver_redis-7b8202e24996fc60)
running 346 tests
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.03s
     Running tests/tree_contract_tester.rs (tree_contract_tester-462a41d80c275261)
running 9 tests
test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.01s
     Running tests/tree_scan_budget.rs (tree_scan_budget-f368da5a5b931df8)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
     Running tests/workbench_commands.rs (workbench_commands-70bfad61f163c4f4)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:
```

本步修过 3 轮编译错误（均在 commit 前解决，**未留半成品**）：① `pub use X::*` 会把已放宽的
`pub(crate)` 项一起 glob 重导出而被 rustc 拒绝 → 改为**逐项显式 `pub use`**；
② 漏掉 `pub(crate)` 类（`scan_batch` 原就是 `pub(crate)`，导致 `crate::ops::scan_batch` 三条调用找不到）
→ 补上 `pub(crate) use`；③ 私有 helper 跨模块 → 按 §4 放宽。

### 步骤 4 — `connect.rs` → `connect/{8 子模块}` + `mod.rs`

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.03s

$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis 2>&1 | grep -E "^(running|     Running|test result)"
     Running unittests src/lib.rs (datazen_driver_redis-7b8202e24996fc60)
running 346 tests
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.03s
     Running tests/tree_contract_tester.rs (tree_contract_tester-462a41d80c275261)
running 9 tests
test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.01s
     Running tests/tree_scan_budget.rs (tree_scan_budget-f368da5a5b931df8)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
     Running tests/workbench_commands.rs (workbench_commands-70bfad61f163c4f4)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:
```

本步修过 3 轮编译错误（均在 commit 前解决）：① 父模块 `mod tests` 原本靠 `use super::*;` 看到扁平模块的
`SslMode` / `Map` / `Duration`，拆分后这些 import 落在子模块 → 父模块按需**重述**这 3 条 `use`；
② 关联函数 `TlsPlan::plaintext` 是私有但要跨模块 → 放宽为 `pub(crate)`（缩进级重写）；
③ 常量 `PREFER_TLS_PROBE` 跨模块 → 放宽为 `pub(crate)`。

### 步骤 5 — `ops_workbench/tests/cluster_topology.rs` → `cluster_topology/{4 子模块}`

（协调者批准纳入本轮：它超 800 红线，且是本轨 `ops_workbench/tests.rs` 的子模块，
拆完父文件再留 1164 行的子模块等于把红线从父挪到子。）

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.05s

$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis 2>&1 | grep -E "^(running|     Running|test result)"
     Running unittests src/lib.rs (datazen_driver_redis-7b8202e24996fc60)
running 346 tests
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.04s
     Running tests/tree_contract_tester.rs (tree_contract_tester-462a41d80c275261)
running 9 tests
test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/tree_scan_budget.rs (tree_scan_budget-f368da5a5b931df8)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/workbench_commands.rs (workbench_commands-70bfad61f163c4f4)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:
```

本步**一次成功**（先写探针实验证明「孙模块经 `use super::*;` 逐层可见父模块的私有项」，
再用 1164 行做区间记账；跨两条测试带共用的 `scan_round_cmd` 与双替身 `ClusterFoldingConn`
按 §4 留在父模块）。

### 步骤 6 — `ops_tree_scan.rs` → `ops_tree_scan/{7 子模块}` + `mod.rs`

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.03s

$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis 2>&1 | grep -E "test result"
  test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.05s
  test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.00s
  test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
  test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
  test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:
```

公开面：拆前 `pub` **19** 个，`pub(crate)` **8** 个；拆后 `mod.rs` 的 `pub use` 重新导出 **19** 个
（**集合相等**），`pub(crate) use` **14** 个（原 8 个 + 本次放宽的 6 个私有 helper），外部面不变。

### 步骤 7 — `ops_workbench.rs` → `ops_workbench/{6 子模块}` + `mod.rs`

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.03s

$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis 2>&1 | grep -E "test result"
  test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.05s
  test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.01s
  test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
  test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
  test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:
```

公开面：拆前 `pub` **33** 个（含 2 个嵌套 `pub mod`），拆后 `pub use` 重新导出 **35** 个
= 33 个顶层项 + `key_info_slots` / `memory_sample_slots` 两个嵌套模块（**无缺无溢**）。

本步修过 3 轮编译错误（均在 commit 前解决）：① 关联函数（`TypeDistribution::from_sample`、
`KeyObjectInfo::missing`）被误当作自由函数生成 `use super::shapes::from_sample;` —— 关联函数只能经
`Type::` / `Self::` 抵达，**不生成 import**；② 嵌套 `pub mod key_info_slots` / `memory_sample_slots`
未随 `pub use` 透出，既有子模块 `fix_round1` 等取不到 → 补 `pub use`；③ `.boxed()` 需要 `FutureExt`
在作用域内 → 按调用点推断补 import。

### 步骤 8 — `ops_stream.rs` → `ops_stream/{5 子模块}` + `mod.rs`

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.02s

$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis 2>&1 | grep -E "test result"
  test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.03s
  test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.00s
  test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
  test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
  test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:

$ find src -name "*.rs" -exec wc -l {} + | awk '$1>800 && $2!="total"' | sort -rn
（空）
```

公开面：拆前 `pub` **23** 个，拆后 `pub use` **23** 个，**集合完全相等**。本步一次编译通过。

### 步骤 9 — 全量复核

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.03s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:

$ find src -name "*.rs" -exec wc -l {} + | awk '$1>800 && $2!="total"' | sort -rn
（空 —— src/ 中已无超限文件）

$ wc -l ui/console/consoleCompletion/commandMeta.ts
     873 ui/console/consoleCompletion/commandMeta.ts   （TS 侧，见 §7 未完成项 2）
```

## 6. 完成定义对照

| 要求 | 状态 |
|---|---|
| 至少 4 个超限文件已拆 | ✅ **8 个**（任务书 7 个 Rust 超限文件全部 + 协调者追加的 `cluster_topology.rs`） |
| 每个独立 commit | ✅ 8 个拆分 commit + 1 个台账 commit，一文件一 commit |
| `cargo test` 数字逐位不变 | ✅ 每步 `342 passed; 0 failed; 4 ignored`，集成测试 4 目标全绿 |
| 每个新文件 ≤800 行 | ✅ 最大 684 |
| 原文件（`mod.rs`）≤800 | ✅ 最大 490 |
| 台账 `progress.md` | ✅ 本文件（首轮头部为 `READY_FOR_TEST`，Tester 终判后翻 `TEST_FAILED`，修复回合翻 `FIXED_PENDING_RETEST`） |
| `bugs.md` 存在 | ✅ 同目录（首轮为空表；第 1 轮 Tester 登记 BUG-001 + TS-01/TS-02/ERR-01/ERR-02） |
| 树净 | ✅ 见 §7 |

## 7. 终态与未完成项

**commit 列表（本轨道，11 个）**

```
5f78065cb  fix(redis): re-export ops_tree_scan::meta_slots (BUG-001 — broken public path, no behavior change)
b47c14d24  docs(coordination): bugs.md: register BUG-001 + TS-01/TS-02 + ERR-01/ERR-02   ← 第 1 轮 Tester
6d8ea052e  refactor(redis): split ops_stream.rs into ops_stream/{types,parse,groups,entries,overview}.rs + mod.rs
833fef717  refactor(redis): split ops_workbench.rs into ops_workbench/{primitives,shapes,transport,distribution,key_info,memory_sample}.rs + mod.rs
197434dc4  refactor(redis): split ops_tree_scan.rs into ops_tree_scan/{transport,batch,budget,meta,value,page,count}.rs + mod.rs
0501b880a  docs(coordination): redis-src-split — READY_FOR_TEST ledger
00c5f4086  refactor(redis): split ops_workbench/tests/cluster_topology.rs into cluster_topology/{routing,batch,census,hash_tag}.rs + mod.rs
dc5b34b95  refactor(redis): split connect.rs into connect/{plan,live,standalone,cluster,sentinel,parse,tls,client}.rs + mod.rs
5ebfd6290  refactor(redis): split ops.rs into ops/{types,scan,hash,list,set,zset,parse,keys,ttl,batch,flush}.rs + mod.rs
d230a6028  refactor(redis): split ops_workbench/tests.rs into tests/{contract_helpers,key_object_info,type_distribution,memory_sample,cluster_batch,tester_coverage}.rs
bd887e0e0  refactor(redis): split ops_tree_scan/tests.rs into tests/{batch_shapes,page_cost,count_matching,dbsize_degradation,list_children,cluster,fail_soft,page_coverage}.rs
```

**未完成项（本轮未做，逐条给原因）**

1. `ui/console/consoleCompletion/commandMeta.ts`（873，TS 侧；任务书列为「另一轨 Tester 建议项」）——
   **原因：本轮把时间片全投在 Rust 侧 8 个文件的拆分上（任务书要求「至少前 4 个」，实际做到全部 7 个 + 追加 1 个）；
   TS 侧改文件会额外触发 `npx tsc --noEmit` + `npx vitest run --config vitest.drivers.config.ts`
   两道门禁，为不把门禁跑到半途而留待**下一轮单独做**（单独的 Coder 实例做这一项成本更低、风险更小）。
   注意：`commandMeta.ts` 是**静态命令元数据表**，按 group 切分时需保证导出的聚合对象逐键不变
   （等价于 Rust 侧的「公开面集合相等」校验），建议沿用本台账 §3 的方法论。**

**未触碰（按纪律）**：`hub.md`、他轨台账、gitignored codegen、`Cargo.lock`、`src-tauri/Cargo.toml`。
`Cargo.lock` 在工作区显示为已修改（`datazen-driver-redis` 依赖列表多了 `flate2`），
**那是 worktree 建立时就存在的既有漂移，本轨道未 `git add` 它**，9 个 commit 均不含 `Cargo.lock`
（已用 `git show --name-only` 逐个复核，另核 `Cargo.toml` / `hub.md` / generated 均未出现）。

**合流风险提示（交给协调者）**：主检出 `main` 已在 `ops.rs` 上演进到 1172 行，且含本轨道基线没有的
`count_matching` / `set_string_with_options`（后者被 `redis_driver.rs:356` 与 `ops_write.rs` 引用）。
本轨道的拆分**基于基线 1124 行版**，故 `ops.rs` → `ops/` 的合流是**语义冲突**（不是文本冲突），
需按协调者手册 §6.1.1 处理。`connect.rs`、`ops_tree_scan.rs`、`ops_workbench.rs`、`ops_stream.rs` 同理
需先查 `d049ceb4e..main` 是否动过这几个文件再判断冲突类型。

---

## 8. Tester 第 1 轮验收（全新实例，独立复现，不采信自报）

- Tester: `session-61319db9-6e5c-4f32-a35e-cad750b647dd`（全新实例）
- 被验终态: `2e3d0c6b7`（分支 `feature/redis-src-split`，起点 `d049ceb4e`）
- 纪律: 一律绝对路径（本 worktree 基线 `d049ceb4e` 与主检出 `main` 已分叉，相对路径会读到 `main`）；
  `CARGO_TARGET_DIR=/tmp/dz-split-tester`；重命令串行；一动作一 commit。

### 步骤 1 — 文件面审计（含反向检查）

正向：`git diff --name-only d049ceb4e..HEAD` 共 **71** 个路径，全部落在

```
docs/development/coordination/tracks/redis-src-split/{progress.md,bugs.md}      2
packages/drivers/redis/src/**                                                  69
```

反向断言（**关键**）——`git log --name-only d049ceb4e..HEAD` 中不得出现的 7 类路径：

```
$ git log --name-only --pretty=format:'--- %h %s' d049ceb4e..HEAD \
    | grep -n -E 'Cargo\.lock|Cargo\.toml|hub\.md|src/extensions/generated|driver_init\.rs|capabilities/default\.json|\.driver-features\.json'
（无输出，grep exit=1）

$ git diff --name-only d049ceb4e..HEAD -- Cargo.lock Cargo.toml \
    docs/development/coordination/hub.md src/extensions src-tauri/src/driver_init.rs \
    src-tauri/capabilities/default.json packages/drivers/.driver-features.json
（无输出）
```

→ **7 类禁改路径全部未出现在 10 个 commit 中，PASS。**

**附带发现（非本轨道缺陷、非 bug）**：worktree 工作区有**未提交**的 `Cargo.lock` 漂移
（`datazen-driver-redis` 依赖列表 +1 行 `flate2`）。已独立核实为**既有漂移**：

```
$ git log --name-only d049ceb4e..HEAD -- Cargo.lock     # 空 → 本轨道 10 个 commit 均不含 Cargo.lock
$ git show d049ceb4e:packages/drivers/redis/Cargo.toml | grep -n flate2
26:flate2 = "1.1.9"                                       # 基线 Cargo.toml 已声明 flate2
$ git show d049ceb4e:Cargo.lock | grep -A30 'name = "datazen-driver-redis"' | grep flate2
（无）                                                    # 基线 Cargo.lock 未记录该依赖
```

即：基线起 `Cargo.toml` 有 `flate2` 而 `Cargo.lock` 未同步，属**进入本轨道前就存在**的状态
（Coder 声明一致，见 §7）。Tester 全程只读，**不修改、不提交**该文件。

**commit 计数复核**：`git rev-list --count d049ceb4e..HEAD` = **10**（8 拆分 + 2 台账），与任务书一致。
逐 commit 文件数：`bd887e0e0`9 / `d230a6028`7 / `5ebfd6290`13 / `dc5b34b95`10 / `00c5f4086`6 /
`0501b880a`2（台账）/ `197434dc4`9 / `833fef717`8 / `6d8ea052e`7 / `2e3d0c6b7`1（台账）。

**步骤 1 结论：PASS。**

### 步骤 2 — 独立复现「逐行原文比对」（Tester 自写脚本，非采信自报）

脚本：`/tmp/dz-prov/{final2.py,bodyaudit.py,nine.py}`（临时目录，验收后删除）。
取原文 `git show d049ceb4e:<原文件>`，取新文件集合 = `git show --name-only <拆分commit>` 中
**在 HEAD 仍存在的 `.rs`**（原文件已被删除成目录的不再计入，否则会 `git show` 报 128）。

**结论：8 个原文件全部 PASS。** 分两层证据：

**(a) 行级多重集合包含（4 级规范化，逐级收紧口径）**

| 原文件 | 原文非空行 | A(rstrip) 缺失 | B(+strip 前导空白) | C(+去 1 个 `pub(crate) `) | D(+rustfmt 换行规范化) |
|---|---|---|---|---|---|
| `src/ops_tree_scan/tests.rs` | 2218 | 0 | 0 | 0 | 0 |
| `src/ops_workbench/tests.rs` | 1463 | 0 | 0 | 0 | 0 |
| `src/ops.rs` | 1010 | 9 | 9 | **2** | 2 |
| `src/connect.rs` | 1022 | 25 | 25 | **3** | 3 |
| `src/ops_workbench/tests/cluster_topology.rs` | 1090 | 0 | 0 | 0 | 0 |
| `src/ops_tree_scan.rs` | 926 | 6 | 6 | **2** | 2 |
| `src/ops_workbench.rs` | 1008 | 10 | 10 | **2** | 2 |
| `src/ops_stream.rs` | 874 | 7 | 7 | 0 | 0 |
| **合计** | **9611** | 57 | 57 | **9** | 9 |

A/B 级的 57 条缺失**全部是函数签名行**且**全部**是 `pub(crate)` 放宽的 50 个 helper 中的条目
（C 级把 57 降到 9 即证）。**这 9 条 D 级仍不收敛，Tester 逐条追到底**（脚本 `nine.py`，按标识符
定位新文件中的同名条目、抽出完整签名 span、用
`canon = 折叠空白 + 去 pub(crate) + 去 `)` 前尾逗号 + 去结尾 `{`/`;`/`,` ` 比对）：

```
[OK ] src/ops.rs:346  parse_hash_scan_result      -> ops/hash.rs:49
[OK ] src/ops.rs:543  apply_ttl_command           -> ops/ttl.rs:6
[OK ] src/connect.rs:496  parse_tls               -> connect/parse.rs:34
[OK ] src/connect.rs:533  opt_string              -> connect/parse.rs:74
[OK ] src/connect.rs:706  load_tls_certificates   -> connect/tls.rs:61
[OK ] src/ops_tree_scan.rs:89  pipeline_raw       -> ops_tree_scan/transport.rs:33
[OK ] src/ops_tree_scan.rs:121 fold_command_answer-> ops_tree_scan/transport.rs:68
[OK ] src/ops_workbench.rs:572 pipeline_raw       -> ops_workbench/transport.rs:122
[OK ] src/ops_workbench.rs:627 routed_single      -> ops_workbench/transport.rs:180
```

即：**这 9 条与原文的差异 = 恰好 1 个 `pub(crate) ` 前缀 + rustfmt 因签名变长产生的换行/尾逗号重排**，
函数体、参数列表、返回类型、`where` 子句**逐字相同**。**无一条是内容改写。**

**(b) 条目级函数体逐字比对（决定性证据，绕开换行噪声）**

对每个原文件做顶层 `{...}` 配平切片，把每个条目的**花括号体**折叠空白后在新文件集合里做多重集合包含：

| 原文件 | 原顶层条目数 | 函数体逐字命中 | 未命中 | 判定 |
|---|---|---|---|---|
| `src/ops_tree_scan/tests.rs` | 13 | 13 | 0 | PASS |
| `src/ops_workbench/tests.rs` | 65 | 65 | 0 | PASS |
| `src/ops.rs` | 50 | 50 | 0 | PASS |
| `src/connect.rs` | 37 | 36 | 1 | PASS（见下） |
| `src/ops_workbench/tests/cluster_topology.rs` | 34 | 34 | 0 | PASS |
| `src/ops_tree_scan.rs` | 40 | 40 | 0 | PASS |
| `src/ops_workbench.rs` | 32 | 32 | 0 | PASS |
| `src/ops_stream.rs` | 32 | 32 | 0 | PASS |
| **合计** | **303** | **302** | **1** | **PASS** |

唯一「未命中」是 `connect.rs` 的 `TlsPlan::plaintext`：其**类型声明**位于 `impl TlsPlan { ... }` 体内，
该条目的「花括号体」`{ fn plaintext() -> TlsPlan { ... } }` 因内层函数加了 `pub(crate) ` 而不逐字相等。
已手工逐行核对原文 `connect.rs:32-44` vs 新文 `connect/plan.rs:23-35`：**除 `pub(crate) ` 前缀外逐字相同**
（`TlsPlan { enabled: false, prefer_fallback: false, ca_path: None, cert_path: None, key_path: None,
key_passphrase: None, insecure_skip_verify: false }` 一致）。归一化掉该前缀后 **303/303 全命中**。

**(c) 新增行审计（反查「有没有夹带/复制粘贴/重写」）**

新文件里**不属于原文**的行，逐行分类，**8 个文件均为 0 条"代码形状"外来行**：

- `ops_tree_scan/tests.rs` 48 条外来行 → 全部是 `mod`/`use super::*;`/`//` 注释；
- `ops_workbench/tests.rs` 24 条 → 同上；
- `cluster_topology.rs` 18 条 → 同上；
- `ops.rs`/`connect.rs`/`ops_tree_scan.rs`/`ops_workbench.rs` 的「代码形状」外来行**全部**是
  §(a) 中那 9 条签名的**跨行碎片**（如 `raw: &redis::Value,`、`) -> Result<...> {`）与**跨行 `use` 续行**
  （`use crate::ops_workbench::{` / `Client, ClientTlsConfig, ...`）—— 均已由 (a) 的 `nine.py` 定位到原文对应条目，
  非新增逻辑。

**步骤 2 结论：PASS（8/8 文件行行有归属，303 个函数体逐字保留，无夹带代码）。**

### 步骤 3 — 公开面集合相等（合流硬保证）

脚本：`/tmp/dz-prov/pubname_final.py`（名字集合）+ `pubv3.py`（brace 配平的结构化对照）。
口径按任务书：顶层 `pub fn/struct/enum/const/static/type/trait/mod` + `pub use` 转发，**名字集合**。

| 原文件 | BASE 公开名 | HEAD 根可达名 | 缺失 | 多余 | 判定 |
|---|---|---|---|---|---|
| `src/ops.rs` | **38** | **38** | none | none | **PASS** |
| `src/connect.rs` | **12** | **12** | none | none | **PASS** |
| `src/ops_tree_scan.rs` | **20** | **19** | **`meta_slots`** | none | **FAIL → BUG-001** |
| `src/ops_workbench.rs` | **35** | **35** | none | none | **PASS** |
| `src/ops_stream.rs` | **23** | **23** | none | none | **PASS** |

- `ops.rs` 38==38、`connect.rs` 12==12、`ops_stream.rs` 23==23：**集合完全相等**，与 Coder 自报一致。
- `ops_workbench.rs` 35==35：**Coder 自报的「33→35 含 2 个嵌套 `pub mod`」解释成立** ——
  BASE 顶层 `pub` **33 项 + 2 个内联 `pub mod`（`key_info_slots`/`memory_sample_slots`）** = 35 个公开名；
  HEAD 由 35 条 `pub use` 逐一透出（含 :116 `pub use memory_sample::memory_sample_slots;`、
  :138 `pub use shapes::key_info_slots;`），**35==35 无缺无溢**。Coder 的算术无误。
- `ops_tree_scan.rs` **20→19**：Coder 自报「19==19」**口径不全** —— 19 只数了顶层 `pub` **项**，
  漏掉了同在该文件**顶层**（brace 深度 0，已验证）的 `pub mod meta_slots`。

**BUG-001 已登记**（`bugs/redis-src-split-BUG-001.md`）。关键证据：

```
$ grep -n "meta_slots" packages/drivers/redis/src/ops_tree_scan/mod.rs
（无输出 —— 19 条 pub use 里没有 meta_slots）

探针 A（在 mod.rs 追加 `const _ZZ_PROBE_meta_slots_root: usize = crate::ops_tree_scan::meta_slots::TYPE;`）
  error[E0433]: failed to resolve: could not find `meta_slots` in `ops_tree_scan`
探针 B（同一探针 + 先补一行 `pub use meta::meta_slots;`）
  （编译通过，仅剩命名风格 warning）
```

⇒ 缺陷恰为**少一行 `pub use meta::meta_slots;`**；`meta_slots` 本体与 3 个常量已逐字在
`ops_tree_scan/meta.rs:35-42`（步骤 2 已证），故修复不触碰任何函数体。
**同类不对称**：另外 2 个嵌套 `pub mod` 都被显式 `pub use` 透出，唯 `meta_slots` 漏 —— 属遗漏。

**结构性新增 `pub mod`（`ops.rs` 11 个 / `connect.rs` 8 个 / `ops_stream.rs` 5 个）**：
这些是拆分自带的**新增路径**（`crate::ops::hash` 等），**纯增量、不遮蔽任何旧名**，且旧名经
`pub use` 全部原样可达。任务书允许「新增 `pub use` 转发」，此处新增的是 `pub mod` + `pub use`，
判定为**合规的结构性增量，非缺陷**（已逐名核验：BASE 名集合 ⊂ HEAD 根可达名集合，无 `missing`）。

**再导出点解析验证**：`lib.rs` 的 `pub use connect::{build_connection_plan, ConnectionPlan,
RedisLiveConn, TlsPlan, Topology};`（:35）与 `pub use ops::{set_settings_allow_flush,
settings_allow_flush};`（:36）—— 5+2 个名字**全部**出现在步骤 4 的 `cargo check` 通过结果中（编译即证）。

**步骤 3 结论：4/5 PASS，`ops_tree_scan.rs` FAIL → BUG-001（已登记）。**

### 步骤 4 — 门禁独立复跑（提交态 `2e3d0c6b7`，Tester 自己的 target 目录，逐字留尾）

**4.1 单元测试** — `CARGO_TARGET_DIR=/tmp/dz-split-tester cargo test -p datazen-driver-redis --lib`

```
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

→ **逐位命中 Coder 自报的 `342 passed; 0 failed; 4 ignored`，PASS。**

**4.2 集成测试** — `CARGO_TARGET_DIR=/tmp/dz-split-tester cargo test -p datazen-driver-redis`

```
     Running unittests src/lib.rs (/tmp/dz-split-tester/debug/deps/datazen_driver_redis-7b8202e24996fc60)
running 346 tests
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.02s
     Running tests/tree_contract_tester.rs (/tmp/dz-split-tester/debug/deps/tree_contract_tester-462a41d80c275261)
running 9 tests
test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 0.01s
     Running tests/tree_scan_budget.rs (/tmp/dz-split-tester/debug/deps/tree_scan_budget-f368da5a5b931df8)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
     Running tests/workbench_commands.rs (/tmp/dz-split-tester/debug/deps/workbench_commands-70bfad61f163c4f4)
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
   Doc-tests datazen_driver_redis
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

→ **5 个目标全绿**（lib 342/0/4、tree_contract_tester 4/0/5、tree_scan_budget 4/0/0、
workbench_commands 4/0/0、doc-tests 0/0/0），与 Coder 自报一致，PASS。

**4.3 `cargo fmt --check`** — 残余**恰为基线既有 2 条**，**无新增漂移**：

```
$ CARGO_TARGET_DIR=/tmp/dz-split-tester cargo fmt --check -p datazen-driver-redis 2>&1 \
    | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:
```

→ 与 Coder 自报的基线残差**逐条相同**；**新拆分的 8 组文件里零漂移**，PASS。

**4.4 单文件规模** — `find <worktree>/packages/drivers/redis/src -name "*.rs" -exec wc -l {} + | sort -rn | head -5`

```
   23526 total
     787 packages/drivers/redis/src/commands.rs
     786 packages/drivers/redis/src/redis_driver.rs
     708 packages/drivers/redis/src/commands_exec_dispatch.rs
     684 packages/drivers/redis/src/ops_tree_scan/tests/page_coverage.rs
     601 packages/drivers/redis/src/ops_observe.rs
```

超 800 行文件：**空**。最大 **787 = `commands.rs`**，与 Coder 自报「最大 787 `commands.rs`」**逐位一致**，PASS。
（8 个被拆原文件全部转为 `mod.rs` 或子模块，最大 `ops/mod.rs` 490。）

**4.5 `npx tsc --noEmit`**

```
$ npx tsc --noEmit
（无输出）   --- tsc exit: 0 ---
```

→ **0 错误**。本轨未触碰 TS，符合预期，PASS。

**步骤 4 结论：5/5 门禁 PASS，全部与 Coder 自报数字逐位一致。**
**注意：BUG-001（`meta_slots` 根路径丢失）在本步门禁下不可见** —— 因 crate 内暂无调用方，
`342/0/4` 仍全绿。这正是「公开面集合相等」必须作为**独立**判据的原因。

### 步骤 5 — 行为等价抽查（变异探针，共 6 处）

方法：在**拆分后的新文件**里改一处逻辑 → `CARGO_TARGET_DIR=/tmp/dz-split-tester cargo test -p datazen-driver-redis --lib`
→ 必须变红并指出红在哪条测试 → `git checkout HEAD -- <file>` 还原 → 验 `git status --porcelain` 净 → 复跑确认回绿。

**探针有效性前置验证**（防止「改了没编译进去」的假阴性）：先 `touch` 目标文件确认 cargo 确实 `Compiling`，
再注入一处**语法错误**确认测试目标会编译失败 —— 两次都对，故下列「全绿」结论均为**真阴性**而非构建未生效。

| # | 新文件 | 变异 | 结果 | 红的测试 |
|---|---|---|---|---|
| 1 | `ops/ttl.rs:21` | `apply_ttl_command` 的 `Expire` 分支：`secs as i64` → `secs as i64 + 1` | **全绿（未感知）** | — |
| 2 | `ops_tree_scan/budget.rs:82` | `truncated: !(exhausted \|\| page_filled)` → `truncated: !exhausted` | **红（感知）** | `ops_tree_scan::tests::page_cost::a_full_page_with_an_open_cursor_is_pagination_not_truncation` |
| 3 | `ops_tree_scan/budget.rs:120` | `read_dbsize` 的 `Some(n) if n >= 0` → `Some(n)`（去掉负数守卫） | **全绿（未感知）** | — |
| 4 | `ops_tree_scan/budget.rs:133` | `read_dbsize` 的 `Err` 分支返回值 `0` → `1`（BUG-003 降级契约） | **红（感知，4 条）** | `dbsize_degradation::read_dbsize_never_fails_and_reports_zero_when_refused`、`dbsize_degradation::scan_keys_succeeds_when_dbsize_is_refused`、`dbsize_degradation::count_star_verifies_with_a_scan_when_dbsize_is_refused`、`dbsize_degradation::list_children_succeeds_with_own_attributes_when_dbsize_is_refused` |
| 5 | `ops_stream/parse.rs:217` | `parse_stream_id` 的 `parts.len() != 2` → `parts.len() < 2` | **红（感知）** | `ops_stream::tests::test_tester_parse_stream_id_multiple_dashes` |
| 6 | `ops_tree_scan/meta.rs:41` | `meta_slots::MEMORY` 常量 `2` → `3` | **红（感知，2 条）** | `ops_tree_scan::tests::batch_shapes::parse_meta_group_tells_absent_apart_from_unreadable`、`ops_tree_scan::tests::page_coverage::test_tester_scan_keys_page_with_memory_reports_bytes_and_falls_back_to_length` |

**关键正向结论（证明拆分后的测试确实还压在那些代码上）**：
`ops_tree_scan/tests/*`（本轮被拆成 8 个子模块）、`ops_stream/parse.rs`（本轮被拆出）、
`ops_tree_scan/{budget,meta}.rs`（本轮被拆出）**都仍被 lib 测试目标编译并真实覆盖** ——
探针 2/4/5/6 四条都精准红在**对应主题**的测试上，说明 `mod tests;` + `use super::*;` 的
子模块化没有把测试变成「不再编译进测试目标的角落」。**拆分未削弱测试强度，这部分 PASS。**

**如实登记的测试强度缺陷（探针 1 / 探针 3，注入不可感知）**：

| 缺陷 | 位置 | 事实 | 判断 |
|---|---|---|---|
| TS-01 | `ops/ttl.rs:20-24`（`apply_ttl_command` 的 `TtlCommand::Expire` 分支） | 把发给 redis 的 `EXPIRE` 秒数整体 `+1`，**342 条 lib 测试全绿** | 该**网络发送分支**无测试覆盖 |
| TS-02 | `ops_tree_scan/budget.rs:119-127`（`read_dbsize` 的 `Ok` 分支负数守卫） | 去掉 `n >= 0` 守卫，**342 条 lib 测试全绿** | `Ok` 分支的**负数回复**路径无测试覆盖 |

**为什么 TS-01 / TS-02 不作为 `bugs/` 里的功能缺陷登记**（判据说明，避免误记）：
两者都是**基线既有**的覆盖空洞，**不是本次拆分引入的** —— 探针打在**新文件里的原函数体**上，
而这些函数体在步骤 2 已证**逐字来自基线**（未改一行）。拆分的验收判据是「零行为变更 /
公开面集合相等 / 门禁数字逐位不变」，覆盖空洞不改变任何一项。
但任务书明确要求「**如实登记为测试强度缺陷（不要当作无害）**」，故在此**逐条登记为 TS-01/TS-02**，
并建议下一轮补测：
- TS-01：给 `apply_ttl_command` 加一个 scripted-connection 单测，断言 `Expire(60)` 发出的命令是
  `EXPIRE key 60`（现成的 `ShortReplyConn` 类 double 已可复用，见 `ops_workbench/tests/contract_helpers.rs`）；
- TS-02：给 `read_dbsize` 补一条「DBSIZE 回 `Int(-1)` / 非法 bulk」的用例，断言返回 `0` 且不 panic。

**探针 6 的额外价值**：它证明 `meta_slots` 的**取值**是有覆盖的（改常量即红），
从而把 BUG-001 精确定位为**纯路径可见性缺陷**（值对、路径丢），而非「常量搬丢了」。

**还原与洁净验证**：6 次探针全部 `git checkout HEAD -- <file>` 还原；
`git status --porcelain` 仅剩既有 `Cargo.lock` 漂移；`grep -rn "_ZZ_PROBE|zz_syntax_probe"` 无残留；
还原后复跑 `test result: ok. 342 passed; 0 failed; 4 ignored` —— **回绿确认**。

**步骤 5 结论：4/6 探针感知（拆分后测试强度完好），2 处如实登记为覆盖空洞 TS-01/TS-02。**

### 步骤 6 — `pub(crate)` 放宽审计

抽 5 个核对（任务书要求），并**顺手做了全量复核**（3 种独立方法交叉验证）。

**(a) 抽样 5 个：确实原为私有 + 放宽后未进任何 `pub use` 转发**

| # | helper | 基线 `d049ceb4e` 声明（逐字） | HEAD 声明 | (a) 原私有 | (b) 被裸 `pub use` 转发？ | 转发形式 |
|---|---|---|---|---|---|---|
| 1 | `parse_hash_scan_result` | `ops.rs:346` `fn parse_hash_scan_result(raw: &redis::Value) -> ...` | `ops/hash.rs:49` `pub(crate) fn` | ✅ 是 | ❌ 无 | `ops/mod.rs:30` `pub(crate) use`（crate 内） |
| 2 | `value_to_string` | `ops.rs:495` `fn value_to_string(v: &redis::Value) -> String {` | `ops/parse.rs:81` `pub(crate) fn` | ✅ 是 | ❌ 无 | `ops/mod.rs:47` `pub(crate) use` |
| 3 | `PREFER_TLS_PROBE` | `connect.rs:293` `const PREFER_TLS_PROBE: Duration = Duration::from_secs(5);` | `connect/standalone.rs:14` `pub(crate) const` | ✅ 是 | ❌ 无 | 无转发（同模块内用） |
| 4 | `slot` | `ops_workbench.rs:393` `fn slot(values: &[RValue], index: usize) -> RValue {` | `ops_workbench/shapes.rs:208` `pub(crate) fn` | ✅ 是 | ❌ 无 | `ops_workbench/mod.rs:150` `pub(crate) use` |
| 5 | `parse_stream_id` | `ops_stream.rs:310` `fn parse_stream_id(id: &str) -> Option<(u64, u64)> {` | `ops_stream/parse.rs:215` `pub(crate) fn` | ✅ 是 | ❌ 无 | `ops_stream/mod.rs:41` `pub(crate) use` |

→ **5/5 两项条件同时满足，未发现「放宽后泄漏到对外 API」的条目。**

**(b) 全量泄漏扫描（不止抽样）**：把 HEAD 下 5 个拆分目录里**所有** `pub use` 转发名
与**所有** `pub(crate)` 声明名求交集：

```
pub(crate)-declared names found at HEAD: 126
BARE `pub use` forwarding a pub(crate) name (LEAKS): NONE
```

**(c) crate 对外 API 面复核**：`lib.rs` 的对外再导出只有
`pub use connect::{build_connection_plan, ConnectionPlan, RedisLiveConn, TlsPlan, Topology};`（:35）、
`pub use ops::{set_settings_allow_flush, settings_allow_flush};`（:36）、`pub use redis_driver::*;`（:41）、
`pub use plugin::init;`（:47）。求交集：

```
INTERSECTION of lib.rs re-exports with pub(crate)-widened names: EMPTY
```

且已核 `redis_driver.rs` **没有** glob 转发这 5 个模块（其唯一 `use` 是 `pub(crate) use crate::redis_value::{...}`），
故 `pub use redis_driver::*` 不会把放宽名带出去。
→ **放宽确实只增 crate 内部可见性，不增对外 API，结论 PASS。**

**(d) 台账计数勘误（非缺陷，属台账精度问题，如实记录）**：
Coder 台账 §4 的放宽清单**逐条名字与我实测一致**，但 `connect.rs` 一行的**计数写小了**：

| 口径 | `ops` | `connect` | `ops_tree_scan` | `ops_workbench` | `ops_stream` | 合计 |
|---|---|---|---|---|---|---|
| Coder 台账 §4 文字 | 9 | 「18 个私有 fn + 1 常量 + 1 关联函数」= **20** | 6 | 10 | 7 | **52** |
| Tester 实测（3 法一致） | 9 | **25**（23 私有 fn + 1 常量 + 1 关联函数） | 6 | 10 | 7 | **57** |
| 任务书转述 | — | — | — | — | — | 50 |

`connect.rs` 实测 25 条的**完整名单**（已逐条在该文件基线里确认无 `pub` 前缀）：
`open_standalone_conn_with_fallback`、`open_standalone_pubsub`、`open_standalone_pubsub_with_fallback`、
`open_cluster_conn_with_fallback`、`open_sentinel_conn`、`open_sentinel_pubsub`、`plaintext_url`、
`plaintext_sentinel_plan`、`connect_with_timeout`、`parse_topology`、`parse_tls`、`opt_string`、`non_empty`、
`parse_db_index`、`parse_host_port`、`parse_node_urls`、`parse_sentinel_urls`、`scheme_for_tls`、
`build_node_url`、`tls_mode_for_plan`、`load_tls_certificates`、`open_standalone_client`、`sentinel_node_info`、
`plaintext`（`TlsPlan` 关联函数）、`PREFER_TLS_PROBE`（常量）。

**三法互证**：① 「HEAD 的 pub(crate) 声明 ∩ 基线同名无 `pub` 前缀」；
② 逐名在基线原文里 grep 声明行看前缀；③ 去掉 `impl` 体后的 depth-0 扫描。三法均得 **25**。

**判定**：这是**台账文字计数**与代码的偏差，**不是行为缺陷** ——
放宽的**名单本身正确、无泄漏、对外面不变**（(a)(b)(c) 已证）。
但按任务书「逐条核验 Coder 自报」的要求，**如实登记为台账勘误**，建议下一轮 Coder 把 §4 的
`connect.rs` 计数由 20 改为 25、合计由 52 改为 57（或声明 50 的口径来源）。
**不计入 `bugs/`**（不改变任何验收判据：公开面集合、门禁数字、行为等价均不受影响）。

**步骤 6 结论：(a)(b)(c) 全部 PASS，无泄漏；发现台账计数勘误 1 处（52/50 vs 实测 57），已如实记录。**

### 步骤 7 — 台账审阅

| 审阅项 | 结果 |
|---|---|
| `progress.md` 头部 `READY_FOR_TEST` | ✅ 存在（审阅时位于 :5 `- 状态: **READY_FOR_TEST**`；本轮终判已按协议翻为 `TEST_FAILED`） |
| 拆分前后行数表 | ✅ 存在（§2，8 行，一文件一 commit 列全） |
| 每步门禁尾部 | ✅ 存在（§5，步骤 1-9 逐字 `test result` / fmt 残差） |
| 未完成项声明 | ✅ 存在（§7 第 1 条明确 `ui/console/consoleCompletion/commandMeta.ts` 873 行留给下一轮，附原因） |
| `bugs.md` 存在 | ✅ 存在（同目录，空表 + 判据说明） |

**基线行数复核（§2 的「前」列）—— 8/8 逐位正确**：

```
BASE ops_tree_scan/tests.rs                  2394   ✅
BASE ops_workbench/tests.rs                  1602   ✅
BASE ops.rs                                  1124   ✅
BASE connect.rs                              1091   ✅
BASE ops_workbench/tests/cluster_topology.rs 1164   ✅
BASE ops_tree_scan.rs                         988   ✅
BASE ops_workbench.rs                        1070   ✅
BASE ops_stream.rs                            975   ✅
```

**拆分后行数复核（§2 的「后」列）—— 63 个产出文件全部存在，其中 55 个计数正确、8 个偏差**：

```
rows in ledger §2: 63   files present: 63   missing files: []
MISMATCHES: 8  —— 全部集中在 ops_tree_scan 这一行：
   ops_tree_scan/mod.rs         ledger  107  actual  106  (-1)
   ops_tree_scan/value.rs       ledger  197  actual  202  (+5)
   ops_tree_scan/page.rs        ledger  169  actual  172  (+3)
   ops_tree_scan/batch.rs       ledger  160  actual  165  (+5)
   ops_tree_scan/transport.rs   ledger  139  actual  147  (+8)
   ops_tree_scan/budget.rs      ledger  137  actual  140  (+3)
   ops_tree_scan/meta.rs        ledger  102  actual  105  (+3)
   ops_tree_scan/count.rs       ledger   92  actual   95  (+3)
```

已核这 8 个计数在**拆分 commit `197434dc4` 当次**即为当前值（该行此后未再改动，
`git log -- ops_tree_scan/` 只有拆分的两个 commit），故属**该行行数表誊写偏差**，
非后续提交引入。**其余 7 行（55 个文件）行数逐位正确**。

**判定：台账勘误，不计入 `bugs/`** —— 行数表是**说明性表格**，不是验收判据；
真正的实质判据（「每个新文件 ≤800 行」）已独立验证通过：

```
$ find packages/drivers/redis/src -name "*.rs" -exec wc -l {} + | awk '$1>800 && $2!="total"'
（空 —— src/ 中无任何 >800 行文件）
$ find packages/drivers/redis/src/ops_tree_scan -name "*.rs" -exec wc -l {} + | sort -rn | head -3
    3581 total
     684 packages/drivers/redis/src/ops_tree_scan/tests/page_coverage.rs
     402 packages/drivers/redis/src/ops_tree_scan/tests/fail_soft.rs
```

`ops_tree_scan` 组最大文件仍是 `tests/page_coverage.rs` 684（远低于 800），
偏差全部是 +3~+8 行的小量誊写误差，**不影响任何完成定义**。
建议下一轮 Coder 顺手把 §2 第 6 行 8 个数字改为实测值。

**未完成项复核**：`wc -l packages/drivers/redis/ui/console/consoleCompletion/commandMeta.ts` = **873**，
与 Coder 声明**逐位一致**；该文件确实**未被本轨任何 commit 触碰**（步骤 1 正向清单 71 条路径里
只有 `packages/drivers/redis/src/**` 与本轨台账，**无 `ui/` 路径**），
故「留给下一轮」的声明与实际状态**相符**。

**步骤 7 结论：审阅项 5/5 存在；基线行数 8/8 正确；拆分后行数 55/63 正确、8 处誊写偏差（已登记为勘误）；
未完成项声明与实际一致。**

---

## 9. Tester 第 1 轮终判：**TEST_FAILED（1 个 bug）**

**判据汇总**

| 验收动作 | 结果 |
|---|---|
| 1 文件面审计（正向 71 路径 + 反向 7 类禁改路径） | **PASS** |
| 2 逐行原文比对（8 文件 / 9611 非空行 / 303 个条目函数体） | **PASS（8/8）** |
| 3 公开面集合相等（5 个拆分文件） | **FAIL（4/5）→ BUG-001** |
| 4 门禁独立复跑（lib / 集成 / fmt / 行数 / tsc） | **PASS（5/5，数字逐位命中）** |
| 5 行为等价抽查（6 处变异探针） | **PASS（4/6 感知）**；另有覆盖空洞 TS-01/TS-02 |
| 6 `pub(crate)` 放宽审计（抽样 5 + 全量泄漏扫描） | **PASS**；另有台账计数勘误 |
| 7 台账审阅 | **PASS**；另有行数表誊写勘误 |

**阻断项（唯一）**

- **BUG-001**（`bugs/redis-src-split-BUG-001.md`）：`crate::ops_tree_scan::meta_slots` 在拆分后
  **失去根路径可达性**，`ops_tree_scan` 公开面 **20 → 19**。编译级探针双向证明：
  路径解析失败（E0433），补一行 `pub use meta::meta_slots;` 即恢复。

**非阻断项（如实记录，不计入 bug 数）**

- **TS-01 / TS-02**（步骤 5）：`ops/ttl.rs` 的 `Expire` 网络发送分支、`ops_tree_scan/budget.rs`
  的 `read_dbsize` 负数守卫，**注入变异后 342 条测试全绿** ⇒ 覆盖空洞。**均为基线既有**，
  非本次拆分引入（函数体经步骤 2 证实逐字未改），故不影响「零行为变更」判定。
- **台账勘误 ×2**（步骤 6/7）：`§4` 放宽计数 `connect.rs` 20→实测 25（合计 52→实测 57）；
  `§2` 行数表 `ops_tree_scan` 行 8 个数字偏差 ±1~±8。均为**说明性文字**误差，
  不影响任何实质判据（≤800 行已独立验证通过）。

**为什么「门禁全绿」不等于通过**：步骤 4 实测 `342 passed; 0 failed; 4 ignored`、5 目标全绿、
fmt 残差恰为基线 2 条、最大文件 787、`tsc` 0 —— 与 Coder 自报**逐位一致**。
但 BUG-001 在此门禁下**完全不可见**（crate 内暂无 `meta_slots` 调用方，故编译与测试都不报）。
这正是任务书把「公开面集合相等」列为**独立硬判据**的原因：纯机械重构的验收
必须同时满足「行行有归属」与「公开面集合相等」，二者缺一不可。

**给下一轮 Coder 的最小修复动作**

1. `packages/drivers/redis/src/ops_tree_scan/mod.rs` 的 `pub use` 区补一行 `pub use meta::meta_slots;`
   （建议紧邻 :77-81 的 `meta::*` 分组）；
2. 复跑 `cargo test -p datazen-driver-redis --lib`（应仍 `342 passed; 0 failed; 4 ignored`）+
   复跑本轨步骤 3 的公开面脚本（`ops_tree_scan` 应回到 **20 vs 20**）；
3. 顺手修 §2 `ops_tree_scan` 行数表的 8 个数字与 §4 的 `connect.rs` 计数；
4. （可选，独立一轮）补 TS-01/TS-02 两条覆盖，以及 `commandMeta.ts` 873 行的 TS 侧拆分。

## 10. Tester 第 2 轮复测（进行中）

### BOOTSTRAP 与阶段 A：独立代码审查（2026-09-23）

- Worktree: `/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-redis-src-split`
- Branch / HEAD: `feature/redis-src-split` / `6361a65db`
- 对照基线：`d049ceb4e`；BUG-001 修复 `5f78065cb` 是当前 HEAD 的祖先，修复仅为 `ops_tree_scan/mod.rs` 增加 `pub use meta::meta_slots;`。
- 启动时唯一工作区改动为既存 `Cargo.lock` 的 `+ "flate2"`；保留、不暂存、不提交。
- `post-review-hardening-plan.md` 在本 worktree 内未找到；本轮逐项按本文件 §3/§4 的纯机械拆分、公开面集合、≤800 行及零行为变更验收要求核对。

**8 组源文件拆分审查：**按基线版本与当前变更文件集合，以词法花括号扫描提取函数体，折叠空白并剔除唯一允许的 `pub(crate)` 前缀后逐体多重集合比较。共核对 **429 个函数定义，缺失 0、额外 0**。逐行非空行多重集合核对在剔除 `pub(crate)` 后剩余 **9 条**差异，全部是以下函数签名因可见性前缀长度触发 rustfmt 换行；9 项签名规范化比较均通过，未见参数、约束、返回类型或函数体变化：

- `ops.rs`: `parse_hash_scan_result`、`apply_ttl_command`
- `connect.rs`: `parse_tls`、`opt_string`、`load_tls_certificates`
- `ops_tree_scan.rs`: `pipeline_raw`、`fold_command_answer`
- `ops_workbench.rs`: `pipeline_raw`、`routed_single`

新增代码仅有模块拆分所需的模块声明/import/re-export 及 BUG-001 的根路径转发；未发现函数体增删或重写。顶层公开名称集合独立从基线声明与当前 `mod.rs` 转发逐名构造，结果：`ops` 38/38、`connect` 12/12、`ops_tree_scan` 20/20、`ops_workbench` 35/35、`ops_stream` 23/23，均无缺失/多余；旧路径 `crate::ops_tree_scan::meta_slots` 已包含在 20 项中。新 Rust 文件均 ≤800 行，`commandMeta.ts` 的 873 行仍留待后续轨道且未触碰。

为锁定 BUG-001 的 crate 内根路径契约，新增 `test_tester_meta_slots_preserve_legacy_root_path`：分别编译并比较 `TYPE`、`TTL`、`MEMORY` 的旧根路径与模块内定义路径。阶段 A 判定 **PASS**；阶段 B/C/D 待完成。

### 阶段 B：独立复验门禁（2026-09-23）

命令串行执行，`CARGO_TARGET_DIR=/tmp/dz-redis-src-split-r2`：

- `cargo test -p datazen-driver-redis --lib`：**343 passed / 0 failed / 4 ignored**（347 个测试；新增根路径回归测试使 passed 从基线 342 增至 343）。
- `cargo test -p datazen-driver-redis --tests`：退出码 0；lib **343/0/4**，`tree_contract_tester` **4/0/5**，`tree_scan_budget` **4/0/0**，`workbench_commands` **4/0/0**，另有 0-test target。
- `cargo fmt --check -p datazen-driver-redis`：退出码 1；输出仅为未改动且基线已有的 `src/ops_observe.rs:280`、`:569` 两处漂移，新拆分文件及本轮测试文件无格式差异。
- `npx --no-install tsc --noEmit`：退出码 0，无输出；本轨没有 TS 改动。

**代码审查非阻断观察：** Rust 编译器摘要为 lib **168 warnings（其中 101 duplicate）**、lib-test **105 warnings**。诊断主要是拆分后子文件沿用了原大文件的宽泛 `use` 列表，造成未用导入；另有一条 `private_interfaces`：`ops_tree_scan/batch.rs` 的 `GroupItem` 比 `fetch_page_groups` 可见性更窄。全部是 warning，未使构建或测试失败，也未发现运行时/契约错误；属于拆分后的导入与可见性清理项，本轮只记录，不扩大业务改动范围。

阶段 B 判定：Rust lib、集成测试和 TS 类型门禁通过；fmt 仅保留已登记的两处基线漂移。覆盖率和行为/敏感性探针仍待阶段 C。
