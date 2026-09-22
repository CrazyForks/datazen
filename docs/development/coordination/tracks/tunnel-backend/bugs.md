# Track: tunnel-backend — Bug 清单

- 分支: `feature/tunnel-backend`（worktree `.worktrees/datazen-tunnel-backend`）
- 被验编码 commit: `7571d2887b027744619c5d2d4a00f52b183c8efe`
- 发现者: Tester（独立全新实例）
- 复测命令: `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib`

---

## tunnel-backend-BUG-001 — `test_tunnel` 对 HTTP 代理 / WebSocket 隧道恒报成功（假阳性）

> **状态变更（Coder 第 2 轮）**: 已修复，待 Tester 复测。修复说明与主证测试见同目录 `progress.md`「Coder 修复轮（第 2 轮）」。

- **量级**: 中高（G8 新功能对 3 种隧道类型中的 2 种完全失效，且是"谎报成功"而非报错）
- **状态**: 待复测（已修复）
- **影响范围**: `ConnectionManager::test_tunnel`（`src-tauri/src/services/connection_manager/tunnels.rs:68-120`）→ 新 IPC `test_tunnel(id, targetHost, targetPort)`（`src-tauri/src/commands/tunnel.rs:131-139`）。管理面「测试隧道」按钮对 HTTP 代理 / WebSocket 隧道会显示"连通"，即使代理/中继地址根本不可达。SSH 类型不受影响。

### 描述

`test_tunnel` 复用 `start_tunnel` 建立隧道，并以 `tunnel.is_none()` 作为"什么都没探测到"的守卫：

```rust
let (_resolved, tunnel) = self.start_tunnel(config).await?;
let elapsed = started.elapsed();
if tunnel.is_none() {
    return Err(ConnectionError::Internal(format!(
        "tunnel '{tunnel_id}' resolved to no tunnel configuration"
    )));
}
```

该守卫只能拦住 `TunnelKind::None`。**HTTP 代理与 WebSocket 的 `start` 是惰性的**：只绑定本地 listener 并 spawn accept 循环，直到有客户端连入本地端口时才真正去连代理 / WS 中继。

- `HttpProxyTunnel::start`（`src-tauri/src/tunnel/http_proxy.rs:25-121`）：`TcpListener::bind("127.0.0.1:0")` → `tokio::spawn(accept loop)` → `Ok(Self{..})`，**全程不与 `proxy.host:proxy.port` 建立任何连接**（CONNECT 在 `connect_and_copy` 里，只有 accept 到入站连接才跑）。
- `WebSocketTunnel::start`（`src-tauri/src/tunnel/websocket.rs:29-127`）：同上，**不连 `cfg.url`**（`connect_async` 在 `handle_client` 里）。
- 只有 `SshTunnel::start`（`src-tauri/src/ssh_tunnel.rs:112-239`）在 start 阶段就 `client::connect` + 认证 + 绑定本地端口，所以只有 SSH 是真的在探测。

因此 `test_tunnel` 对 HttpProxy / WebSocket 返回 `Ok(elapsed)`（实测恒为 `0` ms），与目标端点是否可达无关。这与代码注释自称的"reporting success would be a false positive"以及计划书 P1-7「单独验证一条隧道是否可用」直接矛盾。

### 重现步骤

1. 保存一条 `kind = httpProxy` 的 `SavedTunnel`，`host = "127.0.0.1"`、`port = 1`（该端口无任何监听）。
2. 调用 `test_tunnel_impl(&state, "t-dead-proxy", "127.0.0.1", 5432)`。
3. 对 `kind = websocket`、`url = "ws://127.0.0.1:1/nope"` 重复。
4. 期望：两者都应报错（或至少 `elapsed` 反映一次真实握手尝试）；实际：两者都 `Ok(0)`。

### 实测错误日志

Tester 临时复现用例（已从提交中移除，仅作证据）输出：

```text
REPRO http-proxy(closed port 1) -> Ok(0)
REPRO websocket(closed port 1) -> Ok(0)
test commands::tunnel::tests::zz_temp_repro_dead_endpoints_report_success ... ok
```

即：代理与中继端口上没有任何东西在监听，探测仍返回 `Ok(0)`。

### 建议修复方向（不代改业务代码）

- 对 `HttpProxy` / `WebSocket`：在 `start` 之后做一次真实的握手（HTTP CONNECT 到代理；WS 到 `cfg.url`），或让 `test_tunnel` 主动连一次隧道本地端口并断言转发成功；若某类型暂无法真实探测，应显式返回 `Err`（"kind not probeable"）而不是 `Ok(0)`。
- 计划书 P1-7 的措辞「复用 `start_tunnel` 建立隧道后立即拆除并回报」本身没有覆盖"惰性 start"这一事实，建议同步修正计划书或实现。

---

## tunnel-backend-BUG-002 — SSH 探针 `drop(tunnel)` 不拆除隧道，每次探测泄漏一个 SSH 会话 + 任务 + 本地端口

> **状态变更（Coder 第 2 轮）**: 已修复，待 Tester 复测。修复说明与主证测试见同目录 `progress.md`「Coder 修复轮（第 2 轮）」。

- **量级**: 中（资源泄漏，非数据损坏；但管理面可被反复点击，泄漏会累积）
- **状态**: 待复测（已修复）
- **影响范围**: `ConnectionManager::test_tunnel`（`src-tauri/src/services/connection_manager/tunnels.rs:113-119`）的 SSH 分支；根因在 `SshTunnel` 缺少 `Drop`（`src-tauri/src/ssh_tunnel.rs:99-103`）。既存 `ConnectionManager::test_connection`（`tunnels.rs:41-57`）有同一形状的既存泄漏。

### 描述

`test_tunnel` 依赖 drop 拆除隧道：

```rust
// Dropping the tunnel tears the local forwarder down: the probe is
// deliberately one-shot and must not leak a listener.
drop(tunnel);
Ok(elapsed)
```

但 `Tunnel::Ssh` 持有的 `SshTunnel` **没有 `Drop` 实现**：

```rust
pub struct SshTunnel {
    local_port: u16,
    _task: tokio::task::JoinHandle<()>,      // ssh_tunnel.rs:101
    _upstream: Option<Box<SshTunnel>>,
}
```

按 tokio 语义，**drop 一个 `JoinHandle` 只是 detach，不会 abort 任务**。因此 `drop(tunnel)` 之后：

- SSH 转发 accept 循环（`ssh_tunnel.rs:194-232`）继续存活；
- 它持有的 `Arc<Mutex<client::Handle>>` 让 SSH 会话保持打开；
- `TcpListener`（`ssh_tunnel.rs:175`）仍绑定在 127.0.0.1 的随机端口上，无人知晓、无人回收；
- `_upstream`（跳板链）同样被 detach。

对照另外两种类型，它们都显式实现了 `Drop` 并 abort：

- `impl Drop for HttpProxyTunnel`（`src-tauri/src/tunnel/http_proxy.rs:124-129`）：`cancel.cancel(); task.abort();`
- `impl Drop for WebSocketTunnel`（`src-tauri/src/tunnel/websocket.rs:130-135`）：同上。

所以 `test_tunnel` 的"建好即拆"只对 HTTP 代理 / WebSocket 成立；对真正做了握手的 SSH 类型，**每次调用泄漏一个任务 + 一个 SSH 会话 + 一个本地监听端口**（直到进程退出）。注释与 `progress.md` 的「drop 即拆除」对 SSH 是错误陈述。

### 重现步骤

1. 需要一台可用的 SSH 服务器（本机无，故未能动态复现，见下"替代验证"）。
2. 保存 `kind = ssh` 的 `SavedTunnel` 指向该服务器。
3. 反复调用 `test_tunnel_impl`；观察 SSH 服务器侧会话数单调增长，且本机 `lsof -iTCP -sTCP:LISTEN` 中 127.0.0.1 的随机端口持续增加。

### 替代验证（静态证明，本机无 SSH 端点）

- `grep -n "impl Drop" src-tauri/src/ssh_tunnel.rs` → 无任何命中；`SshTunnel` 只含 `JoinHandle`。
- `grep -n "impl Drop" src-tauri/src/tunnel/mod.rs` → 无命中；`Tunnel` 枚举不提供聚合 Drop。
- `_task` 字段名前缀下划线仅抑制 unused 警告，不改变 drop 语义。
- tokio 文档明确：`JoinHandle` 被 drop 时任务继续运行（detach），需要 `abort()` 才会取消。

### 实测错误日志

无（无可用 SSH 端点，未做动态复现）。上面为逐行静态证明。

### 建议修复方向（不代改业务代码）

- 给 `SshTunnel` 补 `Drop`（保存 `AbortHandle` 或 `CancellationToken` 并 `abort()`），与 HTTP/WS 两个实现保持一致；这样 `test_tunnel` 与既存 `test_connection` 的 drop 假设才成立。
- 若短期内不修 `SshTunnel`，则 `test_tunnel` 的 SSH 分支不能靠 `drop` 拆除，需要显式持有并 abort 转发任务；同时修正注释与 `progress.md` 的错误陈述。

---

## 非 Bug 的改进建议（不阻断）

1. **`materialize_tunnel_refs` 存在 N+1 次 store 加锁**：每条连接都 `state.store.get_tunnel(tunnel_id).await` 一次读锁（`src-tauri/src/commands/connection_import/ipc.rs:194`）。可在循环前一次性 `get_tunnels()` 建 `HashMap<id, SavedTunnel>`，把 O(N) 次加锁降为 1 次。
2. **`get_tunnel_usage` 与 `materialize_tunnel_refs` 对空串引用不一致**：前者用 `conn.tunnel_id.as_deref() == Some(id)`，若查询 id 为空串会命中 `tunnel_id = Some("")` 的连接；后者显式 `filter(|id| !id.is_empty())` 把空串当无引用（`ipc.rs:191`）。当前 UI 只可能用真实 tunnel id 调用，无用户可见影响；建议统一为同一判定。
3. **摘要投影只靠投影点保证"无密钥"**：`get_tunnel_summaries_impl` 先 `store.get_tunnels()` 克隆出**完整明文实体**（含密钥）再投影（`src-tauri/src/commands/tunnel.rs:40-53`）。IPC 载荷确实无密钥，但"无密钥"是调用点约定而非存储层 API 保证。建议加 `Store::get_tunnel_summaries()` 之类只读元数据的入口，避免未来重构把整实体泄出去。
4. **`SavedTunnelSummary` / `TunnelUsage` 的 `Deserialize` derive 未被使用**（`packages/driver-api/src/tunnel_types.rs:96,107`）：二者只作为响应载荷序列化。若有意留作双向契约，建议补一条反序列化单测；否则可去掉 `Deserialize`。
5. **`test_tunnel` 合成 config 的占位 `database_type = "postgresql"`**（`tunnels.rs:81`）与仓库其它处惯用的 `"postgres"` 不一致。因为该函数不查 registry，当前无影响，但占位值容易误导后续维护者。
6. **`kind = ssh` 但 `ssh.enabled == false` 的导出是静默降级**：`materialize_tunnel_refs` 只对 `saved.ssh == None` 打 warn（`ipc.rs:205-209`）；`Some(enabled=false)` 会照常写进 `conn.ssh_tunnel`，随后被 `connection_to_tableplus_json` 的 `.filter(|s| s.enabled)` 静默丢弃（`tableplus.rs:149`）。与"可观测降级"的既定策略不一致，建议一并 warn（属边界态，故未计为 Bug）。
7. **`SshTunnel::_upstream` 命名与生命周期**：跳板链的 upstream 隧道也依赖 drop 拆除（同样 detach），修复 BUG-002 时应一并覆盖。
8. **既存未使用代码**：`ConnectionManager::ref_count`（`src-tauri/src/services/connection_manager/tunnels.rs:196`）在编译时产生 `never used` 警告；**非本轨引入**（`7571d288^` 已存在），仅记录。
