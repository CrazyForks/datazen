# redis-src-split-BUG-001 · `ops_tree_scan::meta_slots` 在拆分后失去根路径可达性（公开面集合减少 1 项）

- **状态**：**待复测**（修复轮第 1 回合已修，commit `5f78065cb`，待第 2 轮 Tester 复测）
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

---

### 修复记录（coder round-1）

- **修复 commit**：`5f78065cb` — `fix(redis): re-export ops_tree_scan::meta_slots (BUG-001 — broken public path, no behavior change)`
- **修法**：`packages/drivers/redis/src/ops_tree_scan/mod.rs` 的 `pub use` 区补**恰好一行**，
  紧邻既有 `meta::*` 分组（位于 `pub use meta::meta_fields_per_key;` 与 `pub use meta::parse_meta_group;` 之间）：

  ```rust
  pub use meta::meta_slots;
  ```

  `git diff` 为 **+1 行 / −0 行**，无其他改动；`ops_tree_scan/meta.rs` 及其余 Rust 文件**一字未动**。

- **Coder 独立复现（编译级双向探针，与你步骤 3 的口径一致）**：

  ```
  探针 A（修复前）—— 在 meta.rs 末尾临时注入：
      const _PROBE_A: usize = crate::ops_tree_scan::meta_slots::TYPE;
  $ CARGO_TARGET_DIR=/tmp/dz-split-fix cargo build -p datazen-driver-redis
  error[E0433]: failed to resolve: could not find `meta_slots` in `ops_tree_scan`
  error: could not compile `datazen-driver-redis` (lib) due to 1 previous error        ← 红（复现成功）

  探针 A（补一行后，探针仍在）—— 同一命令：
  （无 error 输出）                                                                     ← 绿（修复生效）

  验净：探针文件以备份还原；`grep -c _PROBE_A` = 0；
        `git diff --stat -- src/ops_tree_scan/meta.rs` 无输出（与 HEAD 逐字节相同）
  ```

- **公开面实测：20 vs 20（口径 = 顶层 `pub` 项 + 内联 `pub mod` 都算）**：

  ```
  BASE  ops_tree_scan.rs : 19 top-level pub items + 1 inline pub mod = 20
          mods =['meta_slots']
  HEAD  mod.rs           : 20 `pub use` + 14 `pub(crate) use`
  BASE total (20) == HEAD `pub use` (20) : True
    missing now: none
    extra  now : none
  ```

- **同类不对称已消除**（全轨内联 `pub mod` 逐一对应透出）：

  | 内联 `pub mod` | 定义处 | 透出处 |
  |---|---|---|
  | `ops_tree_scan::meta_slots` | `ops_tree_scan/meta.rs:35` | `ops_tree_scan/mod.rs:80`（**本次补**） |
  | `ops_workbench::key_info_slots` | `ops_workbench/shapes.rs:90` | `ops_workbench/mod.rs:138` |
  | `ops_workbench::memory_sample_slots` | `ops_workbench/memory_sample.rs:27` | `ops_workbench/mod.rs:116` |

- **门禁尾部（逐字）**：

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
     1 src/ops_observe.rs:569:          ← 仍恰为基线既有 2 条，无新增漂移
  ```

- **可复测点（给你第 2 轮）**：
  1. 重跑编译级探针 A ⇒ 应**直接绿**（无需再补任何行）；
  2. 公开面脚本 ⇒ `ops_tree_scan` **20 vs 20**，`missing: none / extra: none`；
  3. `git diff 197434dc4..5f78065cb -- packages/drivers/redis/src/ops_tree_scan/mod.rs` ⇒ **仅 +1 行**；
  4. 确认 `ops_tree_scan/meta.rs` 与拆分 commit 相比**逐字节未变**（`git diff 197434dc4..HEAD -- .../meta.rs` 空）。
