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

## Phase

`FAILED`

> Tester 已完成阶段 A/B/C/D（逐文件审查 + 独立复跑 + 覆盖率补齐 + E2E 登记）。发现 2 个 Bug：
> `tunnel-backend-BUG-001`（`test_tunnel` 对 HTTP 代理 / WebSocket 恒报成功，假阳性）、
> `tunnel-backend-BUG-002`（SSH 探针 `drop` 不拆除隧道，每次探测泄漏任务 + SSH 会话 + 本地端口）。
> 详见同目录 `bugs.md`。等待原 Coder 修复后由全新 Tester 完整复测。
