# `redis-src-split` 台账

- 任务: 把 redis 驱动 crate 超 800 行的文件按职责拆分，**零行为变更**（纯机械重构 + 测试保持全绿）
- 状态: **READY_FOR_TEST**
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

**每个新文件 ≤800 行**（最大 `ops_tree_scan/tests/page_coverage.rs` 684）。
原文件变 `mod.rs` 后均 ≤800（最大 `ops/mod.rs` 490）。

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

**公开 API 面逐项不变**（拆分 `ops.rs` / `connect.rs` 的硬要求，因为 `lib.rs` 有 `pub use`）：

- `ops.rs`：拆前 `pub` 项 **38** 个，拆后 `ops/mod.rs` 的 `pub use` 重新导出 **38** 个，集合**完全相等**
  （`missing: none / extra: none`）；
- `connect.rs`：拆前 **12** 个 == 拆后 **12** 个，集合完全相等。
- 所有调用方路径（`crate::ops::X` / `crate::connect::X` / `lib.rs` 的 `pub use connect::{...}`）**一行未改**，
  因为 `mod.rs` 用 `pub use` 把它们原样透出。

## 4. 可见性变更清单（唯一被允许的签名改动，已在 commit message 说明）

跨子模块边界后，原本**私有**的条目无法再被兄弟模块/父模块的 `mod tests` 看到。处置规则：

- `pub` → `pub use`（crate 外部面，**不变**）；
- `pub(crate)` → `pub(crate) use`（crate 内部调用方，**不变**）；
- **私有 → `pub(crate)`**（仅此一种放宽，并在 `mod.rs` 用 `pub(crate) use` 提升）。

| 文件 | 放宽为 `pub(crate)` 的条目 |
|---|---|
| `ops.rs` | 9 个私有 fn：`apply_ttl_command`、`parse_cursor_from_value`、`parse_flat_string_array`、`parse_flat_string_pairs`、`parse_hash_scan_result`、`parse_scan_result_generic`、`parse_string_array`、`parse_zscan_result`、`value_to_string` |
| `connect.rs` | 18 个私有 fn + `PREFER_TLS_PROBE` 常量 + `TlsPlan::plaintext` 关联函数 |

**放宽只增不减外部面**：`pub(crate)` 不进入 crate 的对外 API，故 §3 的「38 == 38」「12 == 12」成立。
`ops_tree_scan/tests.rs` 的 1 行 `use redis::ErrorKind;` 从文件中段提升到父模块头部 —— 原因：拆成子模块后
该 `use` 落在兄弟模块里，`fail_soft` 取不到；提升到父模块后子模块经 `use super::*;` 正常解析（语义等价）。

**`ops.rs` 全部函数体未重写**：只移动、只加 `pub(crate) ` 前缀。rustfmt 因签名变长做了换行/尾逗号重排
（`hash.rs` 的 `parse_hash_scan_result`、`ttl.rs` 的 `apply_ttl_command`），这是**空白层**差异，字符级
（去空白后）比对确认语义零变化。

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

### 步骤 6 — 全量复核

```
$ CARGO_TARGET_DIR=/tmp/dz-split-cargo cargo test -p datazen-driver-redis --lib 2>&1 | tail -3
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.03s

$ cargo fmt --check 2>&1 | grep "^Diff in" | sed 's|.*/redis/||' | sort | uniq -c
   1 src/ops_observe.rs:280:
   1 src/ops_observe.rs:569:

$ find src -name "*.rs" -exec wc -l {} + | awk '$1>800 && $2!="total"' | sort -rn
    1070 src/ops_workbench.rs
     988 src/ops_tree_scan.rs
     975 src/ops_stream.rs
```

→ 步骤 1–5 的目标文件**全部 ≤800**；`src/` 中**剩余 3 个**超限文件见 §6（本轮未做，原因如下）。

## 6. 完成定义对照

| 要求 | 状态 |
|---|---|
| 至少 4 个超限文件已拆 | ✅ **5 个**（含协调者追加批准的 `cluster_topology.rs`） |
| 每个独立 commit | ✅ 5 个 commit，一文件一 commit |
| `cargo test` 数字逐位不变 | ✅ 每步 `342 passed; 0 failed; 4 ignored`，集成测试 4 目标全绿 |
| 每个新文件 ≤800 行 | ✅ 最大 684 |
| 原文件（`mod.rs`）≤800 | ✅ 最大 490 |
| 台账 `progress.md` | ✅ 本文件，头部 `READY_FOR_TEST` |
| `bugs.md` 存在 | ✅ 同目录，空表 |
| 树净 | ✅ 见 §7 |

## 7. 终态与未完成项

**commit 列表（本轨道，5 个）**

```
00c5f4086  refactor(redis): split ops_workbench/tests/cluster_topology.rs into cluster_topology/{routing,batch,census,hash_tag}.rs + mod.rs
dc5b34b95  refactor(redis): split connect.rs into connect/{plan,live,standalone,cluster,sentinel,parse,tls,client}.rs + mod.rs
5ebfd6290  refactor(redis): split ops.rs into ops/{types,scan,hash,list,set,zset,parse,keys,ttl,batch,flush}.rs + mod.rs
d230a6028  refactor(redis): split ops_workbench/tests.rs into tests/{contract_helpers,key_object_info,type_distribution,memory_sample,cluster_batch,tester_coverage}.rs
bd887e0e0  refactor(redis): split ops_tree_scan/tests.rs into tests/{batch_shapes,page_cost,count_matching,dbsize_degradation,list_children,cluster,fail_soft,page_coverage}.rs
```

**未完成项（本轮未做，逐条给原因）**

1. `src/ops_workbench.rs`（1070）、`src/ops_tree_scan.rs`（988）、`src/ops_stream.rs`（975）——
   任务书列的第 6/7 项。**原因：本轮时间优先给了前 4 项 + 协调者追加的 `cluster_topology.rs`；
   三者均为实现模块（含生产逻辑与 module docs），拆分需重做与 `ops.rs` 同级的可见性/`pub use` 面
   分析（`ops_workbench.rs` 还被 `ops_tree_scan/tests/*` 与 `ops_tree_scan.rs` 反向引用），
   风险高于纯测试文件拆分，故留待下一轮。**建议下一轮按 `ops_tree_scan.rs` 已点名的
   `ops_tree_scan/{batch,page}.rs` 切法起步。
2. `ui/console/consoleCompletion/commandMeta.ts`（873，TS 侧）—— 任务书列为「另一轨 Tester 建议项」。
   **原因：TS 侧改文件即触发 `npx tsc --noEmit` + `npx vitest run --config vitest.drivers.config.ts`
   两道额外门禁；本轮 Rust 侧已用满时间片，为不把门禁跑到半途而留待下一轮**（单独一轮做，成本更低）。

**未触碰（按纪律）**：`hub.md`、他轨台账、gitignored codegen、`Cargo.lock`、`src-tauri/Cargo.toml`。
`Cargo.lock` 在工作区显示为已修改（`datazen-driver-redis` 依赖列表多了 `flate2`），
**那是 worktree 建立时就存在的既有漂移，本轨道未 `git add` 它**，5 个 commit 均不含 `Cargo.lock`
（已用 `git show --stat` 逐个复核）。

**合流风险提示（交给协调者）**：主检出 `main` 已在 `ops.rs` 上演进到 1172 行，且含本轨道基线没有的
`count_matching` / `set_string_with_options`（后者被 `redis_driver.rs:356` 与 `ops_write.rs` 引用）。
本轨道的拆分**基于基线 1124 行版**，故 `ops.rs` → `ops/` 的合流是**语义冲突**（不是文本冲突），
需按协调者手册 §6.1.1 处理。`connect.rs` 同理需查 `d049ceb4e..main` 是否动过。
