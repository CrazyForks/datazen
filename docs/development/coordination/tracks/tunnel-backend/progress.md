# Track: tunnel-backend — 隧道摘要 / 引用统计 / 连通性测试 IPC + 导出物化隧道引用

- 分支: `feature/tunnel-backend`（worktree `.worktrees/datazen-tunnel-backend`）
- 角色: Coder → Tester
- 计划书: `design-plans/saved-tunnel-management.md`（G3 / G7 / G8 / G9；P0-4、P1-6、P1-7）
- 范围: **仅 Rust 后端**（本轨不碰前端；前端轨道另行处理 G1/G2/G4/G5/G6/G10）

## 目标

把计划书里落在 Rust 侧的 4 件事做完，为前端管理面提供可用的 IPC 面，并修掉一个已确认的静默数据丢失缺陷：

1. **G9 —— 列表 IPC 去密钥**：新增 `get_tunnel_summaries`，只回 `id` / `name` / `kind`。现有 `get_tunnels` 会把解密后的 SSH 密码/口令、代理密码、WS authToken 明文送进 webview；渲染一个下拉不需要这些。
2. **G3 的可见性支撑 —— 引用统计**：新增 `get_tunnel_usage(id)`，供删除确认弹窗展示「哪些连接引用了这条隧道」。
3. **G8 —— 独立连通性测试**：新增 `test_tunnel(id, targetHost, targetPort)`，复用既有隧道启动路径建好即拆，回报耗时毫秒，供管理面单条验证。
4. **G7 —— 导出物化隧道引用**（静默数据丢失）：导出链路 `write_connections_export → build_encrypted_connections_export → tableplus::export_connections → connection_to_tableplus_json` 只读 `conn.ssh_tunnel`，**完全不读 `tunnel_id`**；而前端在设置 `tunnelId` 时不写内联 `ssh_tunnel`（`src/lib/connectionFormModel.ts:117-137`）。后果：一条「引用已保存 SSH 隧道」的连接导出后 `isOverSSH=false`，SSH 跳板被静默丢弃，接收方必然连不上内网库。

## 现状事实（已核对）

- 实体/存储：`SavedTunnel`（`packages/driver-api/src/tunnel_types.rs:80`）；敏感字段 AES-256-GCM（`src-tauri/src/store/tunnels.rs`）；`Store::get_tunnel(id) -> Option<SavedTunnel>` 走内存 cache，返回**已解密**实体。
- 运行时解析：`ConnectionManager::resolve_tunnel_ref`（`src-tauri/src/services/connection_manager/tunnels.rs:22-39`）按 `tunnel_id` 回填 `ssh_tunnel` / `http_proxy_tunnel` / `websocket_tunnel`；找不到 id 时返回 `ConnectionError::Internal("tunnel id '{tid}' not found")`。
- `start_tunnel` 原本是 `pub(super)`，commands 层不可见 —— 本轨按简报要求**不放宽它的可见性**，改为在 `ConnectionManager` 上新增语义清晰的 `pub async fn test_tunnel(...)`。
- `Tunnel`（`src-tauri/src/tunnel/mod.rs:18`）的三种变体都持有 forwarder（`SshTunnel` 持 `JoinHandle`，HTTP/WS 有 `Drop`），drop 即拆除。
- `AppState` 字段见 `src-tauri/src/commands/mod.rs:149`（`connection_manager: Arc<ConnectionManager>`、`store: Arc<Store>`）。

## 改动

| 文件 | 动作 |
|---|---|
| `packages/driver-api/src/tunnel_types.rs` | 新增 `SavedTunnelSummary` / `TunnelUsage` DTO + 序列化无密钥单测 |
| `packages/driver-api/src/lib.rs` | 沿既有 `pub use tunnel_types::{...}` 风格重导出两个 DTO |
| `src-tauri/src/services/connection_manager/tunnels.rs` | 新增 `pub async fn test_tunnel(&self, tunnel_id, target_host, target_port) -> Result<Duration, ConnectionError>`：合成 `ConnectionConfig`（`tunnel_id`/`host`/`port`，其余默认）→ 复用 `start_tunnel` → 立即 drop → 回耗时 |
| `src-tauri/src/commands/tunnel.rs` | 新增 `get_tunnel_summaries` / `get_tunnel_usage` / `test_tunnel`（沿用文件既有 `_impl` + `#[tauri::command]` 双层风格）+ `#[cfg(test)] mod tests` |
| `src-tauri/src/bootstrap/run.rs` | 三个新命令注册进 `generate_handler!`（隧道段内按字母序） |
| `src-tauri/src/commands/ipc_surface_tests.rs` | `SOURCE` 纳入 `tunnel.rs`；断言三命令已注册；新增参数面守卫（摘要命令不得长出密钥参数） |
| `src-tauri/src/bootstrap/tests.rs` | `invoke_handler_contains_tunnel_commands` 补三命令断言 |
| `src-tauri/src/commands/connection_import/ipc.rs` | `write_connections_export` 导出前 `materialize_tunnel_refs`：`Ssh` → 把 `saved.ssh` 物化进 `conn.ssh_tunnel`；`HttpProxy`/`WebSocket`/`None` → `tracing::warn!` 且不带隧道导出；悬空 `tunnel_id` → `tracing::warn!` 跳过。`export_connections` 的 IPC 签名 `Result<Option<u32>, CommandError>` 不变 |
| `src-tauri/src/commands/connection_import/ipc_tests.rs` | 新增导出物化往返测试（SSH 引用 → 解析回 `ssh_tunnel`）+ 不可表达类型/悬空引用降级测试 |

## 设计取舍

- **摘要 DTO 用独立结构而非 `#[serde(skip)]`**：`SavedTunnel` 同时是写盘与全量编辑（`get_tunnel`）的载荷，给它加 skip 会牵连存储与编辑面；独立 DTO 让「列表永不携带密钥」成为类型层面的事实，而不是序列化属性。
- **`test_tunnel` 放在 `ConnectionManager` 而非 commands 层**：合成 config + 隧道生命周期是连接管理器的职责；commands 层只做参数透传与耗时换算，同时避免放宽 `start_tunnel` 可见性。
- **`test_tunnel` 对「解析不出隧道」显式报错**：`kind = none` 的异常数据若返回 0ms「成功」是假阳性，故 `tunnel.is_none()` 时返回 `Internal`。
- **导出物化只做单向投影**：不把 `SavedTunnel` 反向写回连接（与 `connectionFormModel.ts:117-137` 的单向契约一致），也不在导出时清 `tunnel_id`（TablePlus 载荷只挑白名单字段，`tunnel_id` 根本不进 JSON）。
- **HTTP 代理 / WebSocket 明确降级而非静默**：TablePlus 格式无法表达，按简报要求 `tracing::warn!` 记录后不带隧道导出（这是「可观测的降级」，不是静默丢失）。

## 禁止事项

- 只写本 worktree；不碰主检出、其他 worktree；不 `git merge`/`rebase`/`cherry-pick`；不删 worktree/分支。
- 不碰 `docs/development/coordination/hub.md`、其他轨 `progress.md` / `bugs.md`。
- 不 `git add` 未跟踪的规格文档；只提交业务改动 + 本文件。
- 禁止 `pnpm install`；Rust 构建固定 `CARGO_TARGET_DIR=target/cargo-wt`。
- 生产路径无裸 `unwrap()` / `expect()`（AGENTS.md 硬性要求）。

## 验收标准

1. `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib` 全绿。
2. `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-api --lib` 全绿。
3. `cargo fmt --check` 对改动文件无 diff（仅 gitignored codegen `src-tauri/src/driver_init.rs` 有既存 diff，非本轨改动）。
4. 三命令已在 `run.rs` 注册，`ipc_surface_tests` / `bootstrap::tests` 通过。
5. 摘要 DTO 序列化不含任何密钥字段（有测试证明）。
6. 导出物化有测试证明（SSH 引用往返 + 不可表达类型/悬空引用降级）。
7. 生产路径无裸 `unwrap()` / `expect()`。

## 自验结果

- 编码 commit: 本文件与全部业务改动**同体提交**（`feat(tunnel): ...`），hash 见本轨收尾汇报 / `git log -1 --format=%H`。

### 套件实测

| 命令 | 结果 |
|---|---|
| `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-api --lib` | **128 passed; 0 failed; 0 ignored** |
| `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib` | **1487 passed; 0 failed; 3 ignored**（3 个 ignored 为既存 OS-keychain 手动用例） |
| `CARGO_TARGET_DIR=target/cargo-wt cargo fmt --check` | 改动文件 **零 diff**；唯一 diff 在 gitignored codegen `src-tauri/src/driver_init.rs`（既存、非本轨改动） |

### 本轨新增测试（9 个，全部 ok）

| 测试 | 覆盖 |
|---|---|
| `datazen_driver_api::tunnel_types::tests::summary_serializes_metadata_only` | DTO 序列化精确等于 `{id,name,kind}`，无 `password`/`passphrase`/`authToken`/`auth_token`/`ssh`/`httpProxy`/`websocket` |
| `datazen_driver_api::tunnel_types::tests::usage_serializes_camel_case_without_secrets` | `TunnelUsage` camelCase 线名 + 无密钥字段 |
| `commands::tunnel::tests::summaries_drop_every_tunnel_secret` | 真实链路：带明文密钥的 `SavedTunnel` → `get_tunnel_summaries_impl` → 载荷既无密钥字段也**无密钥值/主机名/用户名**，且精确等于 `[{id,name,kind}]` |
| `commands::tunnel::tests::usage_lists_referencing_connections_in_order` | 命中（按序返回 `connection_ids`/`connection_names`）+ 未命中（不存在/无引用 → 双空数组）+ 载荷无密钥 |
| `commands::tunnel::tests::test_tunnel_rejects_unknown_tunnel_id` | 失败路径：不存在的 tunnel id → `Err` 且错误信息点名该 id |
| `commands::tunnel::tests::test_tunnel_rejects_tunnel_without_a_tunnel_config` | 边界：`kind=none` 不得假阳性返回 0ms「成功」 |
| `commands::connection_import::ipc::tests::export_materializes_referenced_ssh_tunnel` | G7 往返：`tunnel_id → ssh` 引用的连接导出后可解析回 `ssh_tunnel`（host/port/username/password 全保留），且数据库目标 host/port 未被跳板覆盖 |
| `commands::connection_import::ipc::tests::export_keeps_connections_whose_tunnel_cannot_be_exported` | `httpProxy` 引用 + 悬空 `tunnel_id` 均降级为「无隧道」导出，不失败、不误配 SSH |
| `commands::ipc_surface_tests::ipc_contract_guards::tunnel_commands_expose_metadata_only_params` | IPC 参数面守卫：摘要命令除 `state` 外无参数；`get_tunnel_usage` / `test_tunnel` 无密钥参数 |

既有守卫同步补断言：`bootstrap::tests::invoke_handler_contains_tunnel_commands`（+3 断言）、`commands::ipc_surface_tests::bootstrap_rs_registers_merged_commands_only`（+3 断言），均通过。

### 生产路径 panic 政策

`git diff` 新增行中的 `unwrap()` / `expect()` **全部**落在 `#[cfg(test)]` 内（`tunnel_types.rs:113` 起、`commands/tunnel.rs:144` 起、`ipc_tests.rs` 测试文件）；新增生产函数 `materialize_tunnel_refs`、`ConnectionManager::test_tunnel`、三个 `*_impl` 与三个 `#[tauri::command]` 中零 `unwrap()` / `expect()`（已逐段核验）。

### 未覆盖 / 交给 Tester 的重点

- `test_tunnel` 的**成功路径**（真实建立隧道并回报耗时）需要活的 SSH/代理/WS 端点，单测无法覆盖：本轨只证明失败路径与「无隧道配置」边界。Tester 若需正向验证，需要夹具端点或 mock。
- `materialize_tunnel_refs` 的 `tracing::warn!` 分支只断言了「导出结果不含隧道」，未断言日志文本（无 subscriber 夹具）。

## Tester 独立复验（全新实例，零信任）

- 被验编码 commit: `7571d2887b027744619c5d2d4a00f52b183c8efe`
- 测试代码 commit: `4b9515b6376ea972cd37e7fee1bd87a10bbe3a28`（`test(tunnel): verify tunnel-backend with integration tests`）
- 本文件 commit: 提交信息为 `docs(coordination): record bugs for tunnel-backend` 的提交
- **结论: `TEST_FAILED`** —— 发现 2 个 Bug，详见同目录 `bugs.md`

### 套件实测（Coder 自报 vs Tester 独立实测）

| 命令 | Coder 自报 | Tester 实测 | 一致? |
|---|---|---|---|
| `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-api --lib` | 128 passed / 0 failed / 0 ignored | **128 passed / 0 failed / 0 ignored** | ✅ |
| `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib`（编码 commit 原样，未加 Tester 用例） | 1487 passed / 0 failed / 3 ignored | **1487 passed / 0 failed / 3 ignored** | ✅ |
| 同上 + Tester 11 个新用例 | — | **1498 passed / 0 failed / 3 ignored** | — |
| `rustfmt --check`（9 个改动文件） | 零 diff | **9 个改动文件全绿** | ✅ |
| `cargo fmt --check`（全仓） | 仅 gitignored codegen `src-tauri/src/driver_init.rs` 有 diff | **同左**；`git check-ignore -v` 确认该文件被 `.gitignore:66` 忽略且不在本 commit 的 10 个文件内 | ✅ |

（3 个 ignored 为既存 OS-keychain 手动用例。）

**一次性 flake 记录（未复现）**：全套件中曾有 **1 次** 运行出现 `1497 passed; 1 failed`，随后 **78 次**全套件重跑（分批 12 / 30 / 1 / 15 / 20 次，含 CPU 满载 + `--test-threads=24`/`32` 压测）全部 `1498 passed; 0 failed`，未能复现，也未捕获失败用例名（当时仅保留 `tail -4`）。该仓库已有**既存 flaky 用例**并自述于注释：`src-tauri/src/commands/mcp.rs:265,274`（"flaky only under full-suite load"/"observed flaky on loaded machines"）、`src-tauri/src/ai/protocol/openai_chat.rs:964`（wiremock "can flake under high parallel load"）。据此判定与本次改动无关，但如实记录。

### 改动文件覆盖率报告（逻辑分支覆盖；本机无 `llvm-tools`/`cargo-llvm-cov`，`rustup component add llvm-tools-preview` 因离线下载失败，故无法产出 llvm-cov 数字）

| 改动文件 | 改动前 | 改动后 | 说明 |
|---|---|---|---|
| `packages/driver-api/src/tunnel_types.rs`（新增 2 个 DTO） | n/a | 序列化路径 100% | 补 ssh/httpProxy/websocket 三型的无密钥投影断言；`Deserialize` derive 未被任何代码使用（见改进项 4） |
| `src-tauri/src/commands/tunnel.rs`（3 个 `*_impl`） | 无此代码 | **100% 分支** | 摘要：空 store / 单条 / 三条；usage：多命中同序、未命中、不存在、`tunnel_id=None` 排除、空串；test_tunnel：成功 + 4 条失败路径 |
| `src-tauri/src/services/connection_manager/tunnels.rs`（`test_tunnel`） | 无此代码 | **100% 分支** | `start_tunnel` Err（id 不存在 / ssh 缺失 / ssh 禁用）、`tunnel.is_none()` 真、`Ok(elapsed)+drop` 假分支 |
| `src-tauri/src/commands/connection_import/ipc.rs`（`materialize_tunnel_refs` + 导出） | 部分 | **100% 分支** | 空串 / 悬空 / kind=None / HttpProxy / WebSocket / Ssh-无配置 / 无引用内联 共 7 条路径 + 导出写失败分支 |
| `src-tauri/src/bootstrap/run.rs`（3 行注册） | n/a | 静态守卫覆盖 | 运行时无法直接执行；由 `bootstrap::tests::invoke_handler_contains_tunnel_commands` 与 `ipc_surface_tests::bootstrap_rs_registers_merged_commands_only` 源码断言锁定 |
| `packages/driver-api/src/lib.rs`（重导出 2 个 DTO） | n/a | 编译期覆盖 | 无运行时语句 |
| `tunnel.rs` 的 3 个 `#[tauri::command]` 薄包装 | n/a | 未执行 | 需要 `State<'_, AppState>`，单测无法构造；由 `ipc_surface_tests::tunnel_commands_expose_metadata_only_params` 静态锁定参数面 |

**≥80% 结论**：核心改动模块（`tunnel.rs` 三个 impl、`ConnectionManager::test_tunnel`、`materialize_tunnel_refs`/`write_connections_export`）可达分支 **100%** 覆盖。未执行项仅为 3 个一行的 `#[tauri::command]` 委托包装、编译期重导出、以及未被使用的 `Deserialize` derive，均已在上表说明，不构成覆盖率缺口。

### 新增测试（11 个，全部通过，命名前缀 `test_tester_`）

| 测试 | 覆盖路径 |
|---|---|
| `tunnel::tests::test_tester_summaries_are_empty_for_an_empty_store` | 空 store 摘要投影 |
| `tunnel::tests::test_tester_summaries_keep_store_order_and_drop_secrets_for_every_kind` | ssh/httpProxy/websocket 三型摘要均无密钥 + store 顺序保持 |
| `tunnel::tests::test_tester_usage_is_positionally_aligned_across_multiple_hits` | 多命中下 ids/names 严格同序对齐（id 与 name 排序刻意错开）；`None` 与异隧道引用被排除 |
| `tunnel::tests::test_tester_usage_with_empty_id_matches_no_real_reference` | 空串查询不误扫直连连接 |
| `tunnel::tests::test_tester_test_tunnel_rejects_ssh_kind_without_ssh_config` | `kind=ssh` 但 `ssh=None` → Err |
| `tunnel::tests::test_tester_test_tunnel_rejects_disabled_ssh_tunnel` | `ssh.enabled=false` → Err |
| `tunnel::tests::test_tester_test_tunnel_success_path_with_local_proxy_fixture` | **成功路径**：本地 TCP 夹具（应答 `HTTP/1.1 200 Connection Established`）→ `Ok(elapsed_ms)`，且 `drop` 不 panic |
| `ipc::tests::test_tester_materialize_does_not_pollute_the_live_connection_cache` | 导出只改 `get_connections()` 的**克隆**，store 内存 cache 的 `ssh_tunnel`/`host`/`port` 不被污染（防别名缺陷） |
| `ipc::tests::test_tester_materialize_degrades_every_unsupported_branch` | 空串 / 悬空 / None / WebSocket / Ssh-无配置 五条降级 + 无引用内联隧道原样保留 + 连接自身 DB host/port 不被跳板覆盖 |
| `ipc::tests::test_tester_materialize_warns_on_dangling_and_unsupported_references` | 线程局部 `tracing_subscriber::fmt` + 共享缓冲夹具，断言 warn 文本同时点名 connection_id 与 tunnel_id（可观测降级） |
| `ipc::tests::test_tester_export_fails_when_the_destination_cannot_be_written` | 导出写失败分支（`cmd_err("export_connections")`） |

**未覆盖项与理由**：

1. **`test_tunnel` 的 SSH 成功路径**：需要一台可用的 SSH 服务器。本机无可用端点，仓库也未提供 in-process SSH 夹具（`russh` 在本仓库仅作客户端使用，无 server 侧测试设施）。替代验证：用本地 TCP 代理夹具覆盖了同一个 `Ok(elapsed) + drop` 代码路径；SSH 特有的 drop 拆除语义改以**逐行静态核验**（`SshTunnel` 无 `Drop`、`JoinHandle` drop 即 detach）并登记为 `tunnel-backend-BUG-002`。**若后续需要动态验证，需新增 `russh` server 夹具并统计会话数。**
2. **`#[tauri::command]` 三个薄包装**：`State<'_, AppState>` 无法在单测中构造；改为静态参数面守卫（既存机制）。
3. **`materialize_tunnel_refs` 的 warn 分支日志**：已按任务要求评估并**补齐**（见上表第 10 条）。注意：若改用线程局部 subscriber 而不新建 `Dispatch`，会受 tracing callsite interest 全局缓存影响而 flaky；本实现通过 `tracing_subscriber::fmt()` 构造新 `Dispatch`（触发 `register_dispatch` → 全量 interest 重建）保证确定性，已用 `--test-threads=1` 定序复现验证。

### E2E 用例登记

| # | 用例 | 覆盖目标 | 可执行性 | 前置条件 |
|---|---|---|---|---|
| E1 | 调用 `get_tunnel_summaries`，断言载荷精确等于 `[{id,name,kind}]`，且无 `password`/`passphrase`/`authToken`/`ssh`/`httpProxy`/`websocket` 字段、无密钥值/跳板主机名/用户名 | G9 摘要 IPC 无密钥 | 【本机可执行】`cargo test -p datazen --lib commands::tunnel::tests` | 无外部依赖；`TestAppState` + `FileKeyringGuard`（`DATAZEN_KEYRING=file`） |
| E2 | 三种 kind 各存一条带明文密钥的隧道后调用摘要 IPC，逐一断言密钥不出现 | G9 全类型无密钥 | 【本机可执行】同上 | 同上 |
| E3 | `get_tunnel_usage(id)` 命中：多条引用连接按 store 顺序返回且 ids/names 一一对应；未命中（不存在 / 无引用 / 空串 / `None`）返回双空数组 | G3 引用统计 | 【本机可执行】`cargo test -p datazen --lib commands::tunnel::tests` | 无外部依赖 |
| E4 | 导出物化：`tunnel_id → ssh` 引用的连接导出后 `isOverSSH=true`、跳板 host/port/user/password 保留、DB 目标 host/port 不变；导出后运行中 cache 不被污染 | G7 静默数据丢失修复 | 【本机可执行】`cargo test -p datazen --lib commands::connection_import::ipc::tests` | 无外部依赖（RNCryptor 本地加解密） |
| E5 | 不可表达类型降级：`httpProxy` / `websocket` / `kind=none` / 悬空 `tunnel_id` / 空串引用导出时均不带隧道、导出不失败，且各自 emit 带 connection_id/tunnel_id 的 warn | G7 可观测降级 | 【本机可执行】同上 | 无外部依赖 |
| E6 | 真实 GUI 旅程：设置页「隧道管理」→「测试」按钮 → SSH 隧道应回报耗时；不可达的 HTTP 代理 / WebSocket 必须回报失败 | G8 端到端可用性（**当前会暴露 `tunnel-backend-BUG-001`**） | 【留待 R 回归】WebdriverIO `e2e/specs/` | 需 `pnpm tauri:build:webdriver`；需前端管理面（本轨不含）；需一台可达 SSH 服务器；代理/WS 用不可达地址做反向断言 |
| E7 | 真实导出→导入往返：A 环境导出引用 SSH 隧道的连接，B 环境导入后 `isOverSSH=true` 且能经跳板连内网库 | G7 端到端 | 【留待 R 回归】手工黑盒 `test/` | 双环境或双 profile；需真实 SSH 跳板与内网数据库 |

## Coder 修复轮（第 2 轮，针对 `bugs.md`）

- 修复 commit: 与本文件同体提交的 `fix(tunnel): ...`（hash 见本轨收尾汇报 / `git log -1 --format=%H`）
- 范围：**只修 2 个 Bug** + 2 条被简报批准的附带修正（Tester 改进项 #2 / #6）。Tester 的 11 个 `test_tester_*` 用例**零改动、零删除**，全部通过。

### BUG-001 修复（`test_tunnel` 对 HTTP 代理 / WebSocket 恒报成功）

根因：`HttpProxyTunnel::start` / `WebSocketTunnel::start` 是**惰性**的 —— 只 bind 本地 127.0.0.1 监听并 spawn accept loop，真正 dial 上游发生在首个入站连接时。`test_tunnel` 只调 `start_tunnel` 就返回，于是对不可达的代理/中继一律 `Ok(0)`。

修法（单一机制，不在 `test_tunnel` 里打特例补丁）：

- `tunnel/http_proxy.rs`：抽出 `normalize_scheme` / `proxy_headers` / `resolve_auth_header` / `connect_timeout` / `dial_proxy` / `tls_connect`，让数据路径（`start` + `connect_and_copy`）与新增探针**共用同一套拨号与握手实现**（而非复制一份探测逻辑）；新增 `pub(crate) async fn verify_upstream(proxy, remote_host, remote_port)`：拨号（`https` 代理含 TLS）→ `perform_connect` 真实 CONNECT 握手 → 关闭连接。
- `tunnel/websocket.rs`：同样抽出 `validate_config` / `ws_headers` / `ws_timeout` / `ws_ping_interval` / `resolve_url`；新增 `pub(crate) async fn verify_upstream(cfg, remote_host, remote_port)`：`connect_ws` →（`datazen_v1` 模式 `open_datazen_channel` 等待 `opened` 应答）→ 发 `close` → 关闭连接。
- `tunnel/mod.rs`：以 `pub(crate) use http_proxy::verify_upstream as verify_http_proxy_upstream` / `... websocket::verify_upstream as verify_websocket_upstream` 重导出（`http_proxy` / `websocket` 是私有子模块，必须重导出）。
- `ConnectionManager::test_tunnel`：先 `store.get_tunnel(id)` 取 `kind`，`start_tunnel` 后按 kind 分派 —— `Ssh` 无需额外动作（`SshTunnel::start` 本就 eager 拨号 + 认证，建隧道即探针），`HttpProxy` / `WebSocket` 调对应 `verify_upstream`；顺序为 **计时（含探针）→ `drop(tunnel)` → `verified?`**，保证探针失败时隧道也一定被拆除。配置缺失（`kind=httpProxy` 而 `http_proxy=None` 等）显式 `Err`，绝不静默成功。
- **未**采用「把探针塞进 `start` 做 eager 预检」：会让生产路径每次建隧道都多一次握手，并破坏既有单连接夹具（`http_proxy.rs::forwards_bytes_through_connect_proxy`、`websocket.rs::forwards_datazen_v1_bytes_and_sends_close_control` 都只 accept 一次）。
- **未**采用「经本地监听器探测」：Tester 的成功夹具（`test_tester_test_tunnel_success_path_with_local_proxy_fixture`）在写完 `200 Connection Established` 后立即 shutdown，EOF 探测会把这条合法成功路径误判为失败。

### BUG-002 修复（`SshTunnel` 缺 `Drop`：每次探测泄漏任务 + SSH 会话 + 本地端口）

`SshTunnel` 增加 `cancel: CancellationToken`（原 `_task` 改名 `task`）并实现：

```rust
impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.task.abort();
    }
}
```

与 `HttpProxyTunnel` / `WebSocketTunnel` **同形**（单一机制，不在 `test_tunnel` 里补）。accept loop 改为 `tokio::select!` 监听 `cancel.cancelled()`；每个连接的子任务也监听克隆 token，使 `Arc<Mutex<client::Handle>>` 克隆随任务结束而释放、russh 会话随之关闭；`_upstream`（跳板链）按字段 drop 递归拆除。**同一机制顺带修掉 `ConnectionManager::test_connection` 里既存的同类泄漏。**

### 附带修正（仅简报批准的 2 条）

- 改进项 **#2**：`get_tunnel_usage_impl` 对空 `id` 直接返回双空数组，与 `materialize_tunnel_refs` 把 `""` 视为「无引用」的语义对齐（此前空串会扫出 `tunnel_id=Some("")` 的连接）。
- 改进项 **#6**：`materialize_tunnel_refs` 中 `kind=ssh` 且 `ssh.enabled == false` 原先是**静默**降级（只有 `ssh=None` 才 warn），现改为与其它不可表达分支一致：`tracing::warn!` 点名 connection_id / tunnel_id 后不带隧道导出。

### 第 2 轮新增测试（7 个，全部 ok）

| 测试 | 覆盖 |
|---|---|
| `commands::tunnel::tests::test_tunnel_rejects_unreachable_http_proxy_endpoint` | **BUG-001 主证**：代理端口无监听 → `Err`（含 `connect to proxy`），不再是 `Ok(0)` 假阳性 |
| `commands::tunnel::tests::test_tunnel_rejects_proxy_that_refuses_connect` | 可达但回 `403` 的代理 → `Err`（含 `CONNECT rejected`）：证明真的做了 CONNECT 握手，而不是只 TCP connect |
| `commands::tunnel::tests::test_tunnel_rejects_unreachable_websocket_endpoint` | **BUG-001 主证（WS）**：中继端口无监听 → `Err` |
| `commands::tunnel::tests::test_tunnel_probes_websocket_relay_end_to_end` | 反向证明：本地 WS 夹具正确应答 `open → opened` 时 → `Ok(elapsed)`，排除「WS 一律返回 Err」的假修复 |
| `commands::tunnel::tests::test_tunnel_rejects_unreachable_ssh_bastion` | 三种 kind 均不谎报成功：不可达 SSH 堡垒 → `Err`（含 `SSH connect`） |
| `ssh_tunnel::tests::drop_cancels_and_aborts_the_forwarder_and_releases_the_local_port` | **BUG-002 主证**：`drop(SshTunnel)` 后 token 已取消、`AbortHandle::is_finished()` 为真、且 `127.0.0.1:<port>` 可被重新 bind（detach-only drop 会让端口永久占用） |
| `commands::connection_import::ipc::tests::export_warns_and_skips_a_disabled_ssh_tunnel` | 附带修正 #6：`ssh.enabled=false` 不物化 + warn 同时点名 connection_id / tunnel_id |

### 第 2 轮套件实测

| 命令 | 结果 |
|---|---|
| `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib` | **1505 passed; 0 failed; 3 ignored**（= 修复前基线 1498 + 本轮 7 个新用例；≥ 基线且 0 failed） |
| `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-api --lib` | **128 passed; 0 failed; 0 ignored** |
| `CARGO_TARGET_DIR=target/cargo-wt cargo fmt --check` | 改动文件 **零 diff**；唯一 diff 仍是 gitignored codegen `src-tauri/src/driver_init.rs`（既存、非本轨改动） |
| Tester 回归用例 | 11 个 `test_tester_*` **全部保留、全部通过**（无一个被修改或删除） |

生产路径 panic 政策：本轮新增行中的 `unwrap()` / `expect()` **全部**位于 `#[cfg(test)]`（`commands/tunnel.rs` 测试模块、`ipc_tests.rs`、`ssh_tunnel.rs` 测试模块）；新增/改写的生产代码（两个 `verify_upstream`、`SshTunnel::drop`、抽出的各 helper、`test_tunnel`、`get_tunnel_usage_impl`、`materialize_tunnel_refs`）零裸 `unwrap()` / `expect()`。

### 未采纳的 Tester 改进项（follow-up，本轮登记不修）

- **#1 `get_tunnel_summaries` 的 N+1 store 加锁**：每条隧道一次 `store.get_tunnel`。当前隧道数量级（个位到几十）下无实测影响；若要优化应新增 `store.get_tunnels()` 批量解密接口，属独立改动。
- **#3 摘要投影约定**：`SavedTunnelSummary` 未走「先全量解密再统一投影」的既有约定，而是直接读解密实体后只映射 `id/name/kind`。若后续 DTO 增多，再抽统一投影层。
- **#4 `SavedTunnelSummary` / `TunnelUsage` 的 `Deserialize` derive 未被任何代码使用**：为与 `driver-api` 其它 DTO 风格一致而保留；删除属纯清理。
- **#5 `test_tunnel` 合成 config 的 `"postgresql"` 占位 `database_type`**：该字段在 `start_tunnel` 路径上不会被解析（不查 driver），保留占位仅为满足 `ConnectionConfig` 必填字段。
- **#8 既存 `ref_count` 未使用告警**：非本轨引入，超出范围。

（**#7 `_upstream` 生命周期已随 BUG-002 的 `Drop` 一并解决**：字段 drop 递归拆除跳板链，不再是遗留问题。）

## Tester 复测轮（第 2 轮）

- 复测对象: 修复 commit `db6fc822`（基线 `4b9515b6` / `6689cbe0`）
- 复测者: **全新 Tester 实例**（与编码代理、上一轮 Tester 均不同实例）
- 测试 commit: 本轨 `feature/tunnel-backend` 上 `docs(coordination): record bugs for tunnel-backend`（23 个新增对抗用例 + 本文档更新；编码修复为 `db6fc822`）
- 环境: macOS / `CARGO_TARGET_DIR=target/cargo-wt`；未使用 `npx`、未执行 `pnpm install`
- 结论: **TEST_FAILED** —— 原 2 个 Bug 均确认修复，但复测新发现 2 个缺陷（BUG-003 / BUG-004）

### (a) BUG-001 是否真的修好 —— 结论：✅ 已修复

| 核验点 | 结论 | 证据 |
|---|---|---|
| (a)1 三种 kind 对不可达端点均 `Err` | ✅ | 自建 `test_tester_every_kind_rejects_an_unreachable_endpoint`：`httpProxy`→`connect to proxy`、`websocket`→`WebSocket connect`、`ssh`→`SSH connect`，端点用 `127.0.0.1:1`（无监听、无 bind/drop 竞态），三者均 `Err`，无一个返回 `Ok` |
| (a)2 探针是真握手而非 TCP connect | ✅ | `verify_upstream` 调用 `perform_connect`（`http_proxy.rs:205`）解析状态行并要求 `200`。自建用例：逐字节断言 `CONNECT db.internal:5432 HTTP/1.1` / `Host` / 显式 `Proxy-Authorization` 优先于 Basic / 终止 keep-alive 头；`407`→`Err("CONNECT rejected with status 407")`、`502`→同构、`NOT-HTTP\r\n\r\n`→`Err("invalid CONNECT response status line")`；`wss`/WS 侧 `connect_async` 会校验 101 升级，非 WS 端点（`HTTP/1.1 500`）→ `Err("WebSocket connect failed")` |
| (a)3 反向夹具不可被绕过 | ✅ | 正向：正确 `200 Connection Established` → `Ok`（Coder 用例 + 自建握手用例）；`{"op":"opened"}` → `Ok`；反向：`{"op":"error","message":"no route to host"}` → `Err("relay rejected open ...")`。**不存在「一律 Err」的假修复**；`Ssh` 成功路径另经 in-process bastion 实测 `Ok` |
| (a)4 `raw_binary` 探针语义 | ✅ 不构成假阳性（见下「语义边界判定」） | `raw_binary` 无应用层 ack，`verify_upstream` 只完成 WS 握手 + 关闭；但 `connect_async` 是**真 HTTP 101 握手**（非 TCP connect），不可达/非 WS 端点均 `Err`；自建用例同时断言探针把 `host`/`port` 注入 query 且覆盖陈旧值 |
| (a)5 SSH 语义一致性 | ⚠️ 语义边界，**不计 Bug**（见下） | `SshTunnel::start` eager，只证明「跳板机可达 + 认证成功」；in-process bastion 实测：`start(..., target=127.0.0.1:1)` 成功且 `channel_opens == 0`，而第一次真实转发才失败。与「验证隧道可用」的目标**部分相称**（代理/WS 侧已做到真握手），建议在 UI 文案/文档中显式声明边界 |

### (b) BUG-002 是否真的修好 —— 结论：✅ 已修复（真实路径动态验证）

macOS 非 root 无法运行 `sshd`（`ssh_sandbox_child: sandbox_init: Operation not permitted [preauth]`），因此自建 **in-process russh bastion 夹具**（`ssh_tunnel::test_fixture`，`#[cfg(test)]`，接受任意公钥、真实转发 `direct-tcpip`、暴露 live session / channel-open 计数）。据此对**真实 `SshTunnel::start`** 验证：

| 核验点 | 结论 | 证据 |
|---|---|---|
| (b)1 转发任务终止 / 端口可重新 bind / SSH 会话关闭 | ✅ | `test_tester_ssh_drop_aborts_the_real_forwarder_and_closes_the_session`：真实字节 `ping→ping` 穿过 bastion → `drop` 后 `AbortHandle::is_finished()` 为真；已建立的转发连接读到 EOF/Err；`127.0.0.1:<port>` 重新 bind 成功；`live_sessions` 归 0（Handler 在会话结束时 Drop，证明 `Arc<Mutex<Handle>>` 克隆全部释放、russh 会话任务随 sender 归零退出） |
| (b)2 accept loop 与每连接子任务都监听 cancel | ✅（含残余窗口，见改进项 9） | accept loop `select!` + `child_cancel` 已实测生效；子任务在 `copy_bidirectional` 阶段 `select!` 监听 cancel，实测 drop 后连接被拆除。**残余**：子任务在 `session.lock()` / `channel_open_direct_tcpip` 阶段不响应取消（跳板机不回应 channel-open 时 drop 会卡住并持有会话克隆）——常规 `test_tunnel`/`test_connection` 路径不触发，记为非阻断风险 |
| (b)3 `_upstream` 递归拆除 | ✅ | `test_tester_ssh_jump_chain_drop_tears_down_every_bastion`：两跳 bastion 链转发成功，`drop` 后**两个** bastion 的 `live_sessions` 均归 0 |
| (b)4 `test_tunnel` 所有 Err 路径不泄漏 | ✅（静态逐行） | `get_tunnel` 未命中 → 未建隧道；`start_tunnel?` → 失败前未 spawn（`HttpProxy`/`WS` 校验/绑定在 spawn 前，`Ssh` 的部分 `upstream` 由局部变量 drop 递归拆除）；`tunnel = None` → 无值可泄漏；`saved.http_proxy/websocket.ok_or_else(..)?` 与 `verified?` 均让局部 `tunnel` 在 return 前被 drop（`drop(tunnel)` 显式置于 `verified?` 之前）。Coder 的 `test_tester_test_tunnel_succeeds_against_a_real_ssh_bastion`（自建）另证明成功路径也不泄漏会话 |
| 既存 `test_connection` 同类泄漏 | ✅ | 同一 `impl Drop`；`_tunnel` 局部变量在函数返回时 drop。静态确认，未单独动态复现（无既存泄漏断言） |

### (c) 重构回归风险 —— 结论：生产数据路径**行为未变**

逐函数 diff 审查 `git diff 6689cbe0 db6fc822 -- src-tauri/src/tunnel/`：

- `normalize_scheme` / `proxy_headers` / `resolve_auth_header` / `connect_timeout` / `dial_proxy` / `tls_connect` / `validate_config` / `ws_headers` / `ws_timeout` / `ws_ping_interval` / `resolve_url` 均为**逐字搬移**（表达式、默认值、`max(1)` 下限、`or_else` 顺序、`raw_binary` 注入顺序完全一致），`perform_connect` / `establish_and_copy` / `connect_and_copy` / `pipe_tcp_ws` / `handle_client` / `connect_ws` / `open_datazen_channel` **零改动**。
- 超时：数据路径 `establish_and_copy` 仍用 `timeout` 包住 CONNECT 读取；`dial_proxy` / `tls_connect` 仍带超时。**（探针路径缺该超时 → BUG-003）**
- `https` 分支：TLS 代码等价搬移（**但该分支运行即 panic → BUG-004**）。
- 既有数据路径测试仍在且仍通过：`tunnel::http_proxy::tests::forwards_bytes_through_connect_proxy`、`tunnel::websocket::tests::forwards_datazen_v1_bytes_and_sends_close_control`（另加 `parse_status_200` / `basic_auth_encodes` / `base64_padding` / `rejects_empty_url` / `raw_binary_url_injects_target_without_duplicate_keys`）。
- 新增锁定用例：`test_tester_connect_proxy_data_path_keeps_auth_priority_and_forwarding`（数据路径的请求行/显式 `Proxy-Authorization` 优先级/额外 header/字节转发/**Drop 释放本地端口**）、`test_tester_websocket_data_path_still_sends_ping_frames`（`ws_ping_interval` 仍驱动 keepalive + Drop 释放端口）、两个 `test_tester_extracted_helpers_keep_their_semantics`（抽出的纯函数逐分支，含 `connect_timeout_secs = 0 → 1s` 下限）。
- 行为漂移：**数据路径无漂移**；探针路径新增的 2 个缺陷已分别登记为 BUG-003 / BUG-004。

### (d) 回归覆盖未被削弱 —— 结论：✅ 11 个 `test_tester_*` 逐字节未改

`git diff 4b9515b6 db6fc822 --stat` 与逐函数体比对（脚本按大括号匹配提取函数体后 `==` 比较）：

```text
commands/tunnel.rs 7 个 + connection_import/ipc_tests.rs 4 个 = 11 个 test_tester_*
全部 IDENTICAL（字节级），无删除、无新增 #[ignore]、无断言放宽、无 is_err() 替代
```

`git diff 4b9515b6 db6fc822` 中 `commands/tunnel.rs` 只有 2 个 hunk：`get_tunnel_usage_impl` 的空串守卫（生产）与测试模块**纯追加**；`ipc_tests.rs` 只有纯追加。

### (e) 附带修正核验（简报仅批准 #2 / #6）—— 两条均已实现且有测试

- **#2 空 id**：`get_tunnel_usage_impl` 加 `if !id.is_empty()` 守卫（`commands/tunnel.rs:66`）。**但 Coder 的原用例不足以证明该修复**：其夹具只有 `tunnel_id = None` 与 `Some("t1")`，两种情况在修复前后都返回空。本轮补 `test_tester_usage_with_empty_id_excludes_empty_string_references`（夹具含 `tunnel_id = Some("")`）——修复前会误命中，修复后为空。
- **#6 `ssh.enabled == false`**：`materialize_tunnel_refs` 改为 `Some(ssh) if ssh.enabled => 物化` / `Some(_) => tracing::warn!("SSH tunnel is disabled; ...")` 且不写入导出；Coder 用例 `export_warns_and_skips_a_disabled_ssh_tunnel` 断言 payload 无隧道 + warn 同时点名 `connection_id`/`tunnel_id`。独立单测隔离运行通过（`set_default` 的线程局部订阅在单独运行该用例时同样生效，非顺序依赖）。

### (f) 常规

- **生产路径裸 `unwrap()`/`expect()`**：`db6fc822` 新增行中 17 处 `unwrap()/expect(` **全部**位于 `#[cfg(test)]` 模块（脚本按文件首个 `#[cfg(test)]` 行号判定，生产段命中 0）。改动文件生产段无 panic 宏。
- **覆盖率**：见下表（逻辑分支覆盖法，本机无 llvm-tools）。
- **死代码/可见性**：`verify_upstream` 以 `pub(crate) use` 重导出、仅 `connection_manager` 使用，可见性恰当；`test_fixture` 为 `#[cfg(test)] pub(crate)`；`test_tunnel` 的两条 `ok_or_else` 防御分支与 `TunnelKind::None` 分支实际不可达（改进项 10）；无新增冗余 import（编译告警仅既存的 `ipc_surface_tests`/`app_archive_tests` 未用 import 与 `ref_count`/`emit_task_progress` 未使用）。

### 各套件实测数字（Coder 自报 vs 独立实测）

| 套件 | Coder 自报 | Tester 独立实测（含本轮新增 18 个用例） | 差异 |
|---|---|---|---|
| `cargo test -p datazen --lib` | 1505 passed / 0 failed / 3 ignored | **1526 passed / 0 failed / 5 ignored** | +21 通过（本轮新增用例），0 failed 一致；ignored 3→5（新增 2 条 BUG-004 复现守卫，见追加项 1） |
| `cargo test -p datazen-driver-api --lib` | 128 passed / 0 failed | **128 passed / 0 failed** | 一致 |
| `cargo fmt --check` | 仅 gitignored `driver_init.rs` | 仅 `driver_init.rs`（2 处），改动文件全部干净 | 一致 |
| 稳定性 | — | 新增用例连跑 5 次全绿（`test_tester_` 122 项/次，无 flake） | — |

### 覆盖率评估（改动文件，逻辑分支覆盖法）

| 文件 | 改动 | 估计分支覆盖 | 未覆盖路径 |
|---|---|---|---|
| `tunnel/http_proxy.rs` | +182 | ~95% | `dial_proxy` 超时分支（需黑洞地址，仅静态审查）；**`tls_connect` 与 `https` 数据路径 0%**（运行即 panic → BUG-004；已留 `#[ignore]` 复现守卫） |
| `tunnel/websocket.rs` | +110 | ~95% | `connect_ws` 的 `wss` 分支 0%（同上，BUG-004；已留 `#[ignore]` 复现守卫）；其余 validate/headers/timeout/ping/resolve_url、datazen_v1 与 raw_binary 探针、error ack、超时、非 WS 端点、数据路径转发+close+ping+Drop 全覆盖 |
| `ssh_tunnel.rs` | +112 | ~90% | 子任务 `session.lock()`/`channel_open_direct_tcpip` 的非 cancel-aware 窗口（改进项 9）；`agent` 认证分支（既存，无 agent 夹具） |
| `services/connection_manager/tunnels.rs` | +57 | 100%（可达分支） | 两条 `ok_or_else` 防御分支不可达 |
| `commands/tunnel.rs`（`get_tunnel_usage_impl`） | +4 | 100% | — |
| `connection_import/ipc.rs`（disabled ssh） | +7 | 100% | — |

改动模块整体 ≥ 80%；**唯一不达标的 `https`/`wss` TLS 分支，其不可覆盖性本身就是 BUG-004 的表现**。

### 语义边界判定（明确结论）

1. **`raw_binary` 探针不是假阳性**：该模式协议上**没有**可校验的握手语义（`host`/`port` 经 query 传给中继后直接二进制透传），因此「WS 握手完成」就是该模式能验证的全部；`connect_async` 执行的是真 HTTP 101 升级握手而非 TCP connect（非 WS 端点实测 `Err`），且中继不可达时 `Err`。**结论：语义边界，不登记 Bug**；建议 UI/文档说明「raw_binary 只验证中继可达，不验证目标可达」。
2. **SSH 探针语义**：`start` 只证明「跳板机可达 + 认证成功」，不证明 `target_host:target_port` 经跳板可达（已动态证明：`channel_opens == 0`）。**结论：不作为 Bug 登记，作为已知语义边界**——理由：(i) 该行为由 `SshTunnel` 的 eager 语义客观决定，探针已把「能验证的部分」都验证了；(ii) 要真正验证目标可达，需要额外开一次 `direct-tcpip` 通道（可作为后续增强：探针打开并立即关闭一个到目标的通道）；(iii) 与 `httpProxy`/`websocket` 的「真握手」相比语义略弱，但不会谎报「隧道不可用」。建议写入文档并在管理面文案中体现。

### 新增测试清单（18 个，前缀 `test_tester_`）

`src-tauri/src/commands/tunnel_probe_tests.rs`（新文件，784 行；避免 `commands/tunnel.rs` 突破 800 行）：

1. `test_tester_every_kind_rejects_an_unreachable_endpoint` —— (a)1 三 kind 不可达全 `Err`
2. `test_tester_usage_with_empty_id_excludes_empty_string_references` —— (e)#2 真正证明空串守卫
3. `test_tester_http_proxy_probe_performs_a_real_connect_handshake` —— (a)2 请求逐字节 + 200 通过 + 认证优先级
4. `test_tester_http_proxy_probe_rejects_non_200_statuses` —— (a)2 407/502
5. `test_tester_http_proxy_probe_rejects_a_malformed_status_line` —— (a)2 非 HTTP 应答
6. `test_tester_http_proxy_probe_validates_its_config_first` —— (a)1 空 host / 非法 scheme
7. `test_tester_websocket_probe_rejects_a_relay_that_errors_the_open` —— (a)3 反向夹具
8. `test_tester_websocket_probe_is_bounded_when_the_relay_never_acks` —— (c) WS 探针有界（对照 BUG-003）
9. `test_tester_raw_binary_probe_verifies_the_ws_handshake_and_carries_the_target` —— (a)4 raw_binary 契约 + query 注入
10. `test_tester_raw_binary_probe_rejects_a_non_websocket_endpoint` —— (a)4 非 WS 端点
11. `test_tester_connect_proxy_data_path_keeps_auth_priority_and_forwarding` —— (c) 生产路径行为锁定 + Drop 释放端口
12. `test_tester_websocket_data_path_still_sends_ping_frames` —— (c) ping interval 仍生效 + Drop 释放端口
13. `test_tester_test_tunnel_succeeds_against_a_real_ssh_bastion` —— (a)1 SSH 成功路径 + 不泄漏会话 + 不开目标通道

`src-tauri/src/ssh_tunnel.rs`（3）：

14. `test_tester_ssh_drop_aborts_the_real_forwarder_and_closes_the_session` —— (b)1 真实路径四项证据
15. `test_tester_ssh_probe_does_not_prove_target_reachability` —— (a)5 语义边界动态证明
16. `test_tester_ssh_jump_chain_drop_tears_down_every_bastion` —— (b)3 跳板链递归拆除

`src-tauri/src/tunnel/http_proxy.rs` / `websocket.rs`（2）：

17. `http_proxy::tests::test_tester_extracted_helpers_keep_their_semantics` —— (c) 抽出函数逐分支（含 `max(1)` 下限）
18. `websocket::tests::test_tester_extracted_helpers_keep_their_semantics` —— (c) 同上 + `resolve_url` 双分支

协调者追加覆盖面检查项（第 2 轮补充）新增 5 个：

19. `test_tester_http_proxy_probe_sends_basic_credentials_without_echoing_them` —— 追加项 2：探针路径的 **Basic 凭据回退**（此前只在数据路径与纯函数层覆盖）+ 407 错误消息不含密码
20. `test_tester_websocket_probe_sends_the_bearer_token_and_custom_headers` —— 追加项 2：探针路径的 `auth_token`（`Authorization: Bearer`）与自定义 header（此前探针用例 `auth_token` 全为 `None`）+ error ack 不泄露 token
21. `test_tester_websocket_probe_never_echoes_a_url_embedded_token` —— 追加项 2：URL query 内嵌 token 在「非 WS 端点 / 不可达 / URL 畸形」三种失败下均不出现在错误消息中（RFC §5.4）
22. `test_tester_https_proxy_probe_reports_tls_failure_instead_of_panicking` —— 追加项 1：**`#[ignore]`**，BUG-004 复现守卫（今日必 panic），修复后去掉 `#[ignore]`
23. `test_tester_wss_relay_probe_reports_tls_failure_instead_of_panicking` —— 追加项 1：同上，`wss://` 变体

临时复现用例（BUG-003 证据，**已从提交中移除**，代码片段见 `bugs.md`）：
`zz_temp_silent_proxy_probe_outcome`；另 `zz_temp_tls_paths_panic_instead_of_erroring` 的结论已固化为上面第 22/23 条 `#[ignore]` 守卫。

### 协调者追加覆盖面检查项（第 2 轮补充）—— 逐项结论

**追加项 1：`https`（TLS 拨号）分支是否有覆盖？风险等级？**

- **覆盖情况：完全没有。** `grep -rn '"https"' src-tauri/src` 在测试代码中零命中；`"wss://"` 仅出现在**摘要脱敏**用例（`commands/tunnel.rs:358`）与导出用例（`ipc_tests.rs:514/631`），都不建立连接。即两个 TLS 变体**从未被任何测试执行过**。
- **风险等级：高（且不止是「未经测试」——该路径今日必然 panic）**。见 BUG-004：rustls 同时启用 `aws-lc-rs` + `ring` 且全仓无 `install_default()`，`ClientConfig::builder()` 直接 panic。这不是「TLS 失败未被断言」，而是**探针与生产数据路径都会崩**。
- **按建议补了用例，但今日无法让它通过**：`scheme="https"` 指向纯明文 TCP 端口，期望 `Err`（而非 panic/挂起）——实测**直接 panic**：

```text
---- commands::tunnel_probe_tests::test_tester_https_proxy_probe_reports_tls_failure_instead_of_panicking stdout ----
thread '...' panicked at rustls-0.23.43/src/crypto/mod.rs:249:14:
Could not automatically determine the process-level CryptoProvider from Rustls crate features.
Call CryptoProvider::install_default() before this point ...
```

  为避免把主干套件染红（Tester 不提交失败用例），两条用例以 **`#[ignore = "blocked by tunnel-backend-BUG-004 ..."]`** 落库，并在注释里写明「修复后去掉 `#[ignore]`」；`cargo test -- --ignored test_tester_` 可随时复现（今日两条均 FAILED）。
- `https` 属**必要功能**（`docs/features/tunnel-guide.zh-CN.md`：「HTTPS scheme 会先完成 TLS」；RFC 指定 `tokio-rustls`），因此 BUG-004 列为阻断项。

**追加项 2：探针路径是否覆盖「带凭据 / 带自定义 header」？**

| 场景 | 复测前覆盖情况 | 处理 |
|---|---|---|
| 代理自定义 header + 显式 `Proxy-Authorization`（探针） | ✅ 已覆盖（本轮 `..._performs_a_real_connect_handshake` 逐字节断言，且断言显式头**胜过** Basic） | 无需补 |
| 代理 **Basic 凭据回退**（探针，无显式头） | ❌ 未覆盖（此前只在数据路径 `..._data_path_keeps_auth_priority_and_forwarding` 与纯函数层覆盖） | 补第 19 条 |
| WS `auth_token` + 自定义 header（探针） | ❌ **完全未覆盖**：探针用例 `auth_token` 全为 `None`；`tunnel.rs:359` 的 `Some("ws-auth-token-secret")` 属摘要脱敏用例，不建连 | 补第 20 条 |
| 凭据是否出现在错误消息/日志（RFC §5.4「日志与 UI 不得打印代理密码 / token」） | ❌ 未覆盖 | 补第 19/20/21 条，覆盖「407 拒绝 / `op=error` 拒绝 / 非 WS 端点 / 不可达 / URL 畸形」五种失败 |

- 结论：**未发现泄露**。五条失败路径的错误消息均不含密码、Basic 密文或 token（`verify_upstream` 的错误只带状态码/IO 原因；`connect_ws` 的 `WebSocket connect failed: {e}` 也未回显 URL 中的 `?token=`）。RFC §5.4 在这些路径上成立。
- 顺带确认：`connect_ws` 对自定义 header 会**跳过** `authorization`/`host`（避免覆盖 token 与 Host），第 20 条的夹具实测 `Authorization: Bearer s3cr3t-ws-token` 与 `X-Relay: 1` 同时到达中继。

**追加项 3：`raw_binary` 是否构成新的假阳性？—— 结论：不构成（语义边界），但需文档化**

判定依据（不是主观裁量，而是设计文档自身的口径）：

1. `design-plans/saved-tunnel-management.md:80` 规定的不变量与实现方式：「**实现须为每种隧道做真实的上游链路探测（HTTP 代理做 CONNECT 握手、WS 做 `connect_async`、或穿透本地 listener 打真实连接）**，确实无法探测的类型必须显式返回 `Err` 而非 `Ok(0)`」。→ 对 WS，**`connect_async` 就是计划钦定的探针强度**；`datazen_v1` 额外等 `opened` 属超出计划要求的加强。
2. RFC §5.3 / tunnel-guide §4 的协议口径：「`raw_binary` 下首条连接即双向二进制，目标由 URL query 指定」且「DataZen **不**内置中继服务端；需自备兼容的中继」——该模式**不存在**应用层 ack 帧，因此「WS 101 握手成功」是协议内可验证的最大信号；中继是否打通目标**在该模式下不可观测**（不像 `datazen_v1` 有 `opened`/`error`）。
3. 反假阳性检验通过：修复前对**任何**端点都 `Ok(0)`（BUG-001）；现在不可达中继 `Err`、非 WS 端点（`HTTP 500`）`Err`、TLS 失败 `Err`。没有「连不上也报成功」的情形。
4. 因此与 SSH 探针（只证明跳板机可达 + 认证成功）**同类同判**：属「端点可达性已验证、目标可达性未验证」的语义边界，**不登记 Bug**。
5. 残余风险与建议：raw_binary 下「中继活着但目标不通」会报成功。建议 (i) 在管理面文案/`tunnel-guide` 中写明该模式只验证中继可达；(ii) 可选增强：握手后留一个很短的宽限期，若中继立刻发 Close/error 帧或断开则判 `Err`（启发式，非保证）；(iii) 需要强保证时引导用户改用 `datazen_v1`。

### 复现命令

```bash
CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib                     # 1523 / 0 / 3
CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib test_tester_        # 122 项
CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-api --lib          # 128 / 0
CARGO_TARGET_DIR=target/cargo-wt cargo fmt --check                                # 仅 driver_init.rs
```

### Bug 清单（本轮）

| ID | 标题 | 状态 | 阻断 |
|---|---|---|---|
| BUG-001 | `test_tunnel` 对 HTTP 代理 / WebSocket 恒报成功 | ✅ 已修复（复测通过） | — |
| BUG-002 | `drop(SshTunnel)` 不拆除，泄漏任务/会话/端口 | ✅ 已修复（真实路径复测通过） | — |
| BUG-003 | 探针对「接受 TCP 但不回应 CONNECT」的代理无限挂起 | ✅ 已修复（第 3 轮）→ 待复测 | — |
| BUG-004 | `https` 代理 / `wss` 中继 TLS 路径运行时 panic（CryptoProvider 未安装） | ✅ 已修复（第 3 轮，既存缺陷）→ 待复测 | — |

> BUG-004 的两条 `#[ignore]` 守卫已在第 3 轮**去掉 `#[ignore]` 并转正通过**（见「Coder 修复轮（第 3 轮）」）。

## Coder 修复轮（第 3 轮，针对 BUG-003 / BUG-004 + 拆文件）

- 修复 commit: 与本文件同体提交的 `fix(tunnel): bound the CONNECT probe and install a rustls CryptoProvider`（hash 见本轨收尾汇报 / `git log -1 --format=%H`）
- 范围：**只修 BUG-003、BUG-004 + 把 `commands/tunnel.rs` 拆到 800 行以内**。Tester 的 23 个新用例（`302cf444`）除去掉 2 个 `#[ignore]` 外**断言零改动**；Tester 本轮另报的 14 条改进建议**全部登记为 follow-up，本轮不动**。

### BUG-003 修复（探针对「接受 TCP 但不回应 CONNECT」的代理无限挂起）

根因：`verify_upstream` 只把 `dial_proxy` / `tls_connect` 包了超时，`perform_connect(...)` 是**裸 await**（`perform_connect` 内部无 deadline，逐字节读状态行）；而生产数据路径 `establish_and_copy` 反而包了 `tokio::time::timeout` → **只有探针**会永久 pending，IPC future 永不 settle。

修法（单一机制，两处共用同一个有界入口）：
- 新增 `async fn perform_connect_within(stream, remote_host, remote_port, auth_header, extra_headers, timeout)`：把 `perform_connect` 整体包进 `tokio::time::timeout`，超时错误为 `"CONNECT handshake timed out"`（与数据路径原文案一致）。超时覆盖**整个**握手（写请求 + 逐字节读状态行），不是单次 read。
- `establish_and_copy` 的内联 `timeout(perform_connect(..))` 改为调用该 helper（行为等价，去重）。
- `verify_upstream` 的两个分支（`http` / `https`）都改用该 helper，使用同一个 `connect_timeout(proxy)` 值 → 探针的 dial / TLS / CONNECT 三段全部有界。

### BUG-004 修复（rustls CryptoProvider 未安装 → TLS 路径 panic）

根因：workspace 同时启用了 rustls 的 `aws-lc-rs`（reqwest / hyper-rustls / tokio-rustls）与 `ring`（sqlx / mongodb / redis / ureq / tauri-plugin-updater）两个 provider feature，且全仓无任何 `install_default` → `ClientConfig::builder()` 必然 panic（`rustls-0.23.43/src/crypto/mod.rs:249`）。既存缺陷，本轮把探针接到同一 TLS 路径后暴露。

修法（全局首选方案 + 构造点兜底，同一个幂等函数）：
- 新增模块 `src-tauri/src/tls.rs`：`pub fn install_default_crypto_provider()` —— 若 `CryptoProvider::get_default().is_none()` 则 `aws_lc_rs::default_provider().install_default()`，`install_default` 的返回值（含"已被安装"）**丢弃**，永不 panic；可从任意线程重复调用。
- `src-tauri/src/main.rs`：作为 `main()` 的**第一条语句**调用，覆盖 GUI 与 `--mcp-stdio` 两条入口。
- `lib.rs`：`mod tls;` + `pub use tls::install_default_crypto_provider;`。
- `tunnel/http_proxy.rs::tls_connect` 与 `tunnel/websocket.rs::connect_ws`（`wss://` 在 tungstenite 内部建 `ClientConfig`）在构造 TLS 之前各调用一次同一函数。**理由**：`main()` 不被单元测试 harness 执行，而协调者要求两条 `#[ignore]` 守卫转正后必须通过；把幂等安装放到 TLS 构造点，使保证与入口无关（库/测试嵌入方同样安全）。两者是同一个函数、同一套语义，不是两套机制。

**provider 选择：`aws_lc_rs`**，理由：
1. 它是 rustls 0.23 **自身**的默认 provider（`rustls` crate 的 `default` feature 即 `aws_lc_rs`），也就是"若只启用一个 provider feature，`ClientConfig::builder()` 本来就会自动选中的那个"——安装它是**复现既定语义**而非覆盖它；
2. `tokio-rustls` 的默认 feature 与 `reqwest` 的 `rustls` feature（`__rustls-aws-lc-rs`）都启用 `aws-lc-rs`，本应用最大的 TLS 消费者（reqwest：AI provider + 各 HTTP 驱动）就是按 aws-lc-rs 构建的；
3. 依赖树里唯一另一个安装点 `tauri-plugin-updater`（`updater.rs:445-449`）本身就写成 `if CryptoProvider::get_default().is_none() { let _ = ring::default_provider().install_default(); }`，所以先装 aws-lc-rs 对它只是**跳过**，不会冲突、不会 panic。
4. 其它 rustls 使用者均**显式传 provider**，不受全局默认影响：`sqlx-core`（`builder_with_provider`）、`mongodb`（`builder_with_provider`）、`ureq`（`builder_with_provider`）；反而依赖自动探测的 `redis 0.27`（`ClientConfig::builder()`）与本轨隧道一起被这条全局安装**顺带修好**（此前同样会 panic）。

### 附带清理：拆文件（纯搬迁）

- 新增 `src-tauri/src/commands/tunnel_summary_tests.rs`（289 行，`commands/mod.rs` 以 `#[path]` 注册），承载「摘要 / usage」类测试：Coder 的 2 个 + Tester 的 4 个，以及它们共享的 `SSH_*` 常量、`saved_ssh_tunnel`、`assert_no_secret_leak`。
- `commands/tunnel.rs` **809 → 598 行**（< 800 达标）；保留全部 `test_tunnel` 探针类测试与探针夹具。
- **搬迁已用脚本逐字节证明**：6 个被移动的测试体与 `302cf444` 版本去缩进后 `diff` 全等（`ALL_MOVED_TESTS_BYTE_IDENTICAL = True`），且全仓 `async fn test_*` 名称清单无丢失（lost count = 0）。

### 第 3 轮新增测试（4 个，全部 ok）

| 测试 | 覆盖 |
|---|---|
| `commands::tunnel::tests::test_tunnel_times_out_against_a_proxy_that_never_answers_connect` | **BUG-003 主证**：夹具 accept 后读完请求**永不回包**（`connect_timeout_secs=2`）→ 断言返回 `Err` 且错误含 `timed out`、耗时 < 10s；**用例本身外包 15s `tokio::time::timeout` 兜底**，修复失效时是失败而不是挂死整个套件 |
| `tunnel::http_proxy::tests::https_data_path_reports_tls_failure_without_panicking` | **BUG-004 证据②**：直接调用数据路径函数 `connect_and_copy`（即 accept 循环子任务执行的同一个函数），`scheme=https` 指向明文 TCP 端点 → 返回 `Err` 而非 panic（若 panic 会直接判该用例失败，不再被 detach 的 `JoinHandle` 吞掉） |
| `tls::tests::install_is_idempotent_and_selects_a_provider` | 幂等 + 不 panic + 安装后 `get_default()` 为 `Some` |
| `tls::tests::client_config_builder_works_after_install` | 直接复现原 panic 调用点：`ClientConfig::builder()` 在安装后可正常构造 |

### 第 3 轮转正 / 保留的 Tester 守卫

- `commands::tunnel_probe_tests::test_tester_https_proxy_probe_reports_tls_failure_instead_of_panicking` —— **去掉 `#[ignore]`，已通过**（BUG-004 证据①）。
- `commands::tunnel_probe_tests::test_tester_wss_relay_probe_reports_tls_failure_instead_of_panicking` —— **去掉 `#[ignore]`，已通过**（BUG-004 证据①）。
- 对 `tunnel_probe_tests.rs` 的全部改动仅 2 行 `#[ignore = ...]` 属性删除 + 对应 doc 注释更新（`git diff` 6 insertions / 8 deletions，无一行断言变动）。
- 剩余 ignored = **3**（`mcp::contract::dump_mcp_contract_snapshot`、`store::key_store::keyrings_*`、`store::tests::migrates_dot_key_*`，均为既存手工用例），即 ignored 数由 5 回到 3。

### 第 3 轮套件实测

| 命令 | 结果 |
|---|---|
| `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib` | **1532 passed; 0 failed; 3 ignored**（= 第 2 轮 1505 + Tester 新增 23（其中 2 条由 ignored 转正）+ 本轮新增 4） |
| `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen-driver-api --lib` | **128 passed; 0 failed; 0 ignored** |
| `CARGO_TARGET_DIR=target/cargo-wt cargo check -p datazen --bins` | **exit 0**（`main.rs` 的新调用编译通过；`cargo test --lib` 不编译 bin target，故单独验证） |
| `CARGO_TARGET_DIR=target/cargo-wt cargo fmt --check` | **零 diff**（全仓，含 codegen） |
| `wc -l src-tauri/src/commands/tunnel.rs` | **598**（< 800） |

生产路径 panic 政策：本轮改动文件的生产行段（`tls.rs` 1..47、`main.rs` 全文件、`lib.rs` 全文件、`http_proxy.rs` 1..472、`websocket.rs` 1..412、`commands/tunnel.rs` 1..147、`commands/mod.rs` 本轨仅新增一行模块声明）逐段统计 `unwrap()` / `expect()` **均为 0**；新增的 `unwrap/expect` 全部落在 `#[cfg(test)]` 内。

### 本轮未处理的 Tester 改进建议（全部 follow-up）

Tester 第 2 轮新增的 14 条建议本轮**一条未动**，其中与本次改动相邻的两条特别记录：

- **#9 `SshTunnel` 子任务「非 cancel-aware 窗口」**：子任务只在 `copy_bidirectional` 阶段 `select!` 监听 `child_cancel`，其前的 `session.lock().await` 与 `channel_open_direct_tcpip(...).await` 不响应取消。本轮未改（避免在修复轮扩大改动面）；如后续要修，应把这两步也纳入 `select!`。
- **#10 `test_tunnel` 三条防御分支不可达**（`http_proxy/websocket` 配置缺失、`TunnelKind::None`）：本轮未删，保留为无害防御。
- **#11 拆文件**：本轮已完成 `commands/tunnel.rs` 的部分（809 → 598）。**遗留**：Tester 自己的 `commands/tunnel_probe_tests.rs` 仍有 **1109 行**（> 800），建议下轮按「BUG-001 对抗用例 / BUG-002 bastion 用例 / BUG-003+004 守卫」再拆，属 Tester 侧文件，本轮不擅自改动其结构。
- **#12 / #14 `raw_binary` 与 SSH 的语义边界（只证明上游一跳可达）应写进文档/UI 文案**：本轮未动。
- 其余（#1 N+1 加锁、#3 摘要投影约定、#4 未用 `Deserialize`、#5 `"postgresql"` 占位、#8 既存 `ref_count` 告警、#13 https/wss 覆盖）维持第 2 轮登记状态；其中 **#13 已由本轮两条转正守卫 + `tls.rs` 两条单测 + 数据路径用例实质补上**。

## Phase

`READY_FOR_TEST`

> 第 3 轮修复完成：`tunnel-backend-BUG-003`（CONNECT 探针无超时 → 永久挂起）与 `tunnel-backend-BUG-004`（rustls CryptoProvider 未安装 → `https`/`wss` TLS 路径 panic）均已修复，各有主证测试；`commands/tunnel.rs` 已拆到 598 行。
> 实测 `cargo test -p datazen --lib` **1532 passed / 0 failed / 3 ignored**（ignored 由 5 回到 3，两条 BUG-004 守卫已转正并通过）、`cargo test -p datazen-driver-api --lib` **128 passed / 0 failed**、`cargo check -p datazen --bins` exit 0、`cargo fmt --check` 零 diff。
> 两条 Bug 状态 → **待复测**（`bugs.md` 已同步）。请**全新 Tester 实例**完整复测，重点：
> （a）BUG-003 —— 静默代理 / 只放行 SYN 的防火墙是否都在 `connect_timeout_secs + 余量` 内返回 `Err`；`https` 分支的 CONNECT 是否同样有界（本轮只加了明文分支的用例）；
> （b）BUG-004 —— provider 选择是否与 reqwest/sqlx/mongodb/redis/ureq 全部 TLS 使用者兼容（本轮已静态核对调用方式，建议动态复跑相关 TLS 用例）；`main()` 之外的入口（如 `--mcp-stdio`、测试 harness）是否都不再 panic。
> 本轨不自评 `PASSED`。

> **Tester 复测（第 2 轮）终判：`FAILED`** —— BUG-001 / BUG-002 已确认修复（BUG-002 经 in-process bastion 在真实路径上动态验证），附带修正 #2 / #6 落实且 11 个回归用例逐字节未改；但复测新登记 **BUG-003**（HTTP 探针无超时 → 永久挂起）与 **BUG-004**（`https`/`wss` TLS 路径 panic，既存但本轨拥有该代码）两个阻断项。详见上方「Tester 复测轮（第 2 轮）」。
