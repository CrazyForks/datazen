# redis-src-split-BUG-001 · `ops_tree_scan::meta_slots` 在拆分后失去根路径可达性（公开面集合减少 1 项）

- **状态**：**待修**（第 1 轮 Tester 登记）
- **严重度**：中（`pub mod` 层级可达路径丢失 —— 对外/对 crate 的路径契约变化；当前**无编译期破坏**，因本 crate 内暂无调用方，但属**真实公开面收缩**，违反本轨「零行为变更/公开面集合相等」的硬要求；合流后若 `main` 侧有任何 `crate::ops_tree_scan::meta_slots` 引用即编译失败）
- **登记人**：Tester `session-61319db9-6e5c-4f32-a35e-cad750b647dd`（全新实例）· 2026-09-23
- **登记依据**：第 1 轮验收**步骤 3「公开面集合相等」** —— `ops_tree_scan` 公开面 **20 → 19**，缺失 `meta_slots`
- **涉及文件**：
  - `packages/drivers/redis/src/ops_tree_scan.rs`（基线 `d049ceb4e`，只读对照）
  - `packages/drivers/redis/src/ops_tree_scan/meta.rs:35`（新家，`pub mod meta_slots { ... }`，只读）
  - `packages/drivers/redis/src/ops_tree_scan/mod.rs`（**缺陷所在**：缺少 `pub use meta::meta_slots;`，只读——**Tester 禁改 Rust 源文件**）

## 复现（逐字）

**基线成立**：`meta_slots` 是 `ops_tree_scan.rs` 的**顶层** `pub mod`（brace 深度 0）：

```
$ python3 <depth-0 brace scan of git show d049ceb4e:packages/drivers/redis/src/ops_tree_scan.rs>
depth-0 top-level `pub mod` / `pub` decls in BASELINE ops_tree_scan.rs:
  line  499  DEPTH 0  pub mod meta_slots   <- top-level public module
```

→ 基线公开面含 `crate::ops_tree_scan::meta_slots::{TYPE, TTL, MEMORY}`（3 个 `pub const`）。

**HEAD 丢失**：`ops_tree_scan/mod.rs` 的 19 条 `pub use` 里**没有** `meta_slots`
（对照：兄弟文件的嵌套模块 `key_info_slots` / `memory_sample_slots` **有** `pub use` 透出）：

```
$ grep -n "meta_slots" packages/drivers/redis/src/ops_tree_scan/mod.rs
（无输出，grep exit=1）

$ grep -n "key_info_slots\|memory_sample_slots" packages/drivers/redis/src/ops_workbench/mod.rs
116:pub use memory_sample::memory_sample_slots;
138:pub use shapes::key_info_slots;
```

**编译级证明（双向探针，均已在验证后 `git checkout HEAD --` 还原并验净）**：

```
探针 A —— 在 ops_tree_scan/mod.rs 追加：
    const _ZZ_PROBE_meta_slots_root: usize = crate::ops_tree_scan::meta_slots::TYPE;

$ CARGO_TARGET_DIR=/tmp/dz-split-tester cargo check -p datazen-driver-redis --lib --message-format short
packages/drivers/redis/src/ops_tree_scan/mod.rs:109:64: error[E0433]: failed to resolve:
    could not find `meta_slots` in `ops_tree_scan`: could not find `meta_slots` in `ops_tree_scan`
error: could not compile `datazen-driver-redis` (lib) due to 1 previous error

探针 B —— 同一路径，但先追加一行 `pub use meta::meta_slots;`：
$ CARGO_TARGET_DIR=/tmp/dz-split-tester cargo check -p datazen-driver-redis --lib --message-format short
（无 error；仅剩 warning：constant `_ZZ_PROBE_meta_slots_root` should have an upper case name）
```

探针 A 红 / 探针 B 绿 ⇒ **缺陷恰为 `ops_tree_scan/mod.rs` 少一行 `pub use meta::meta_slots;`**。
`meta_slots` 本体与三个常量**都已逐字搬进** `ops_tree_scan/meta.rs:35-42`（步骤 2 已证），故修复不影响任何函数体。

## 为什么这不是「无调用方所以无害」

1. **本轨的硬判据是公开面「名字集合完全相等」**（任务书步骤 3 原文），`ops_tree_scan` 为 **20 vs 19**，不等即不合规。
2. **基线全 crate 无调用方，不等于合流后无调用方**：本 worktree 基线 `d049ceb4e` 与 `main` **已分叉**
   （`main` 独有 18 提交，且 `main` 已把 `ops_tree_scan.rs` 演进为 `ops_tree.rs`），
   `meta_slots` 在 `main` 上**不存在**任何同名符号，说明 `main` 侧的树扫描模块已另有实现；
   合流时若按路径引用，`crate::ops_tree_scan::meta_slots` 会**直接编译失败**而非静默降级。
3. **同类不对称**：同一批拆分里，另外 2 个嵌套 `pub mod`（`key_info_slots`、`memory_sample_slots`）
   都被 Coder **显式 `pub use` 透出**，唯独 `meta_slots` 漏了 —— 属**遗漏**而非有意设计。

## 影响面

- 受影响路径：`crate::ops_tree_scan::meta_slots`（已失效）→ 现仅 `crate::ops_tree_scan::meta::meta_slots` 可达（`meta` 为 `pub(crate) mod`）。
- 受影响符号：`meta_slots::{TYPE, TTL, MEMORY}` 三个 `pub const`（**内容未变**，只是根路径不可达）。
- **未**影响：`ops_tree_scan` 的 19 个顶层 `pub` 项（`PageKey`/`ScannedPage`/`KeyMeta`/`ValueFields`/
  `ScanKeysPage`/`CountOutcome`/`build_meta_pipeline`/`parse_meta_group`/…全部名字集合相等）；
  `cargo test --lib` 数字（步骤 4 实测仍为 342/0/4，因为无调用方，故**门禁测不出这个缺陷**）。

## 建议修复（下一轮 Coder）

在 `packages/drivers/redis/src/ops_tree_scan/mod.rs` 的 `pub use` 区块（现有 :77-81 的 `meta::*` 分组内）
补一行：

```rust
pub use meta::meta_slots;
```

补后需复跑：`cargo test -p datazen-driver-redis --lib`（应仍 342 passed; 0 failed; 4 ignored）+
本轨 Tester 步骤 3 的公开面脚本（`ops_tree_scan` 应回到 20 vs 20）。
