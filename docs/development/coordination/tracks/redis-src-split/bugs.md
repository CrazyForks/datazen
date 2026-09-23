# `redis-src-split` 缺陷台账

本轨道是**纯机械重构**（按职责拆分超 800 行的文件，零行为变更），因此不预期产生功能缺陷。
本轮未发现、未登记任何 Bug。

| ID | 严重度 | 标题 | 状态 | 证据 / 备注 |
|---|---|---|---|---|
| — | — | （空表） | — | 本轮 5 个文件的拆分均为纯移动；门禁 `342 passed; 0 failed; 4 ignored` 逐位不变 |

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
