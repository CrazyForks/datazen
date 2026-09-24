# `redis-src-split` 缺陷台账

本轨道是**纯机械重构**（按职责拆分超 800 行的文件，零行为变更）。
**第 1 轮 Tester 验收发现 1 个 Bug**（公开面集合收缩），已登记：

| ID | 严重度 | 标题 | 状态 | 证据 / 备注 |
|---|---|---|---|---|
| `redis-src-split-BUG-001` | 中 | `ops_tree_scan::meta_slots` 拆分后失去根路径可达性（公开面 20→19） | **待修** | 编译级双向探针：`crate::ops_tree_scan::meta_slots::TYPE` → `error[E0433] could not find meta_slots in ops_tree_scan`；补一行 `pub use meta::meta_slots;` 即恢复。详见 `bugs/redis-src-split-BUG-001.md` |

**未登记的观察（如实记录，不计入 bug 数）**：

| 编号 | 类型 | 事实 | 为何不计入 bug |
|---|---|---|---|
| TS-01 | 测试强度缺陷 | `ops/ttl.rs` 的 `TtlCommand::Expire` 发送分支变异（`secs+1`）后 342 条测试**全绿** | **基线既有**覆盖空洞，非本轨引入（函数体步骤 2 证实逐字未改）；不改变「零行为变更」判定 |
| TS-02 | 测试强度缺陷 | `ops_tree_scan/budget.rs` 的 `read_dbsize` `Ok` 分支负数守卫变异后**全绿** | 同上 |
| ERR-01 | 台账勘误 | `progress.md` §4 放宽计数：`connect.rs` 记 20、实测 **25**；合计记 52、实测 **57** | 说明性文字误差；放宽名单本身正确、无泄漏、对外面不变（步骤 6 三法互证） |
| ERR-02 | 台账勘误 | `progress.md` §2 行数表 `ops_tree_scan` 行 8 个数字偏差 ±1~±8 | 说明性表格；实质判据「每个新文件 ≤800」已独立验证通过（无任何 >800 文件） |

> 口径说明：本轨 Tester 把「**公开面集合相等**」作为独立硬判据（任务书步骤 3），
> 它**不被门禁覆盖** —— BUG-001 存在时 `342 passed; 0 failed; 4 ignored` 依然全绿。
> 「测试全绿」不能替代「公开面集合相等」，这是本轮的关键结论。

## 说明

- **判据**：行为变更的判据不是「测试全绿」，而是逐行原文比对（原文件每一行必须逐字落进某个新文件，
  且行行有归属）+ 公开 API 面集合相等（`ops.rs` 38==38、`connect.rs` 12==12）。详见 `progress.md` §3。
- **允许的签名改动**：仅「私有 → `pub(crate)`」一种放宽（跨子模块边界所必需），清单见 `progress.md` §4；
  `pub(crate)` 不进入 crate 对外 API，故不构成行为/契约变更。
- **过程性失败**（非缺陷、未留半成品、已回退重做）：
  1. `ops_workbench/tests.rs` 首版拆分把跨主题共享的 `full_key_info_replies` / `ShortReplyConn` 误搬进
     子模块，致既有子模块 `fix_round1` 编译失败 → 已 `git checkout HEAD -- <file>` 整文件回退并重做；
  2. `ops.rs` / `connect.rs` 拆分时的可见性与 `pub use` 形状问题（`pub use X::*` 与 `pub(crate)`
     冲突、遗漏 `pub(crate)` 类、关联函数与常量跨模块）→ 均在 commit 前修净。
- **既有漂移（非本轨道引入，未修）**：`src/ops_observe.rs` 在拆分**前**即有 2 处 `cargo fmt --check`
  漂移（:280 / :569）。该文件不在本回合写面内，故保留原样；本轨道每个 commit 后的 fmt 残余**必须恰好
  是这 2 条**，多一条即回归。
