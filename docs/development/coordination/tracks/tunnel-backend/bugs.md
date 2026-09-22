# Track: tunnel-backend — Bug 清单

- 分支: `feature/tunnel-backend`（worktree `.worktrees/datazen-tunnel-backend`）
- 被验编码 commit（第 1 轮）: `7571d2887b027744619c5d2d4a00f52b183c8efe`
- 被验编码 commit（第 2 轮复测）: `db6fc822f37290ea01348aec14ffa021c46d9640`
- 被验编码 commit（第 3 轮复测）: `1398bd7d`（`fix(tunnel): bound the CONNECT probe and install a rustls CryptoProvider`）
- 发现者: Tester（独立全新实例，第 1 / 2 / 3 轮各为不同实例）
- 登记 commit（第 2 轮）: `docs(coordination): record bugs for tunnel-backend`（`feature/tunnel-backend`）
- 复测命令: `CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib`

---

## tunnel-backend-BUG-001 — `test_tunnel` 对 HTTP 代理 / WebSocket 隧道恒报成功（假阳性）

> **状态变更（Coder 第 2 轮）**: 已修复，待 Tester 复测。修复说明与主证测试见同目录 `progress.md`「Coder 修复轮（第 2 轮）」。
> **复测结论（Tester 第 2 轮）**: ✅ **已修复**。独立重跑 + 自建对抗用例（三种 kind 不可达端点全部 `Err`；`CONNECT` 请求行/`Host`/`Proxy-Authorization` 优先级/终止头逐字节断言；`407`/`502`/畸形状态行均 `Err`；`datazen_v1` `op=error` 与静默中继均 `Err`；`raw_binary` 非 WS 端点 `Err`；Ssh 成功路径经 in-process bastion 实测 `Ok`）。详见 `progress.md`「Tester 复测轮（第 2 轮）」。残留问题另登记为 BUG-003（探针无超时）与 BUG-004（TLS 路径 panic），二者**不在**原 BUG-001 的定义域内。

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
> **复测结论（Tester 第 2 轮）**: ✅ **已修复**。本轮自建 **in-process russh bastion 夹具**（macOS 非 root 无法跑 `sshd`：`ssh_sandbox_child: sandbox_init: Operation not permitted`），对**真实 `SshTunnel::start`** 路径动态验证：转发真实字节 → `drop` 后 `AbortHandle::is_finished()` 为真、已建立的转发连接被拆除、`127.0.0.1:<port>` 可重新 bind、**SSH 会话计数归零**（`Arc<Mutex<Handle>>` 克隆全部释放）；跳板链（`_upstream`）两跳会话同样归零。既存 `test_connection` 的同类泄漏随之修复（同一 `Drop`）。

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

## tunnel-backend-BUG-003 — `test_tunnel` 对「接受 TCP 但不回应 CONNECT」的 HTTP 代理**无限挂起**（探针无超时）

> **状态变更（Coder 第 3 轮）**: 已修复，待 Tester 复测。修复说明与主证测试见同目录 `progress.md`「Coder 修复轮（第 3 轮）」。
> **复测结论（Tester 第 3 轮）**: ✅ **已修复**。独立重跑 `perform_connect_within` 三处调用点并自建 3 条对抗用例：①`https` 分支对静默明文端点 → `Err("TLS proxy handshake timed out")`，实测 **2.08s**（`connect_timeout_secs = 2`），不再挂起；②**持续滴字节**的代理（每次 read 都在推进、header 永不终止）→ `Err("CONNECT handshake timed out")`，实测 **2.05s**，证明约束的是**整个握手**而非单次 read；③直接对 `perform_connect_within` 用静默 peer → 0.70s 有界 `Err`。另加一条特征化守卫证明 `perform_connect` 自身确实无内部 deadline（500ms 窗口内不返回），即 wrapper 是承重的。数据路径语义逐项等价（同一 `timeout` 值、同一文案 `"CONNECT handshake timed out"`，`??` 与 `?`+直接返回等价）。**残余（非 Bug）**：`https` 分支的 CONNECT-*读*阶段无法在封闭环境中抵达（需要能链到 `webpki-roots` CA 的证书），已改由 `perform_connect_within` 的直接用例覆盖；纯 dial 超时（SYN 黑洞）仅静态核验（见 `progress.md`）。

- **量级**: 中（管理面「测试隧道」永久无响应；探针与生产数据路径的超时语义不一致）
- **状态**: ✅ 已修复（复测通过）
- **引入**: `db6fc822`（本轮新增的探针路径）。根因：`verify_upstream` 只对 `dial_proxy` / `tls_connect` 加了超时，**没有**对 `perform_connect` 的 CONNECT 响应读取加超时。
- **影响范围**: `src-tauri/src/tunnel/http_proxy.rs::verify_upstream` → `ConnectionManager::test_tunnel` → IPC `test_tunnel`。对比：生产数据路径 `establish_and_copy` 用 `tokio::time::timeout(timeout, perform_connect(...))` 包住了同一次握手，因此**只有探针**会挂死。

### 描述

`perform_connect` 的响应读取循环是裸 `await`：

```rust
while response.len() < 16 * 1024 {
    let n = stream.read(&mut byte).await.map_err(...)?;   // 无超时
    if n == 0 { break; }
    ...
}
```

`verify_upstream` 直接 `perform_connect(...).await`，没有任何外层 timeout。于是当代理**接受了 TCP 连接但不写任何响应**（过载/半死的 squid、只放行 SYN 的防火墙、把端口转给死后端的转发器）时，`test_tunnel` 永不返回：IPC 命令 future 永久 pending，前端 `invoke` 永不 settle。

### 重现步骤

1. 夹具：`TcpListener` 绑定 127.0.0.1:0，accept 后读完请求**不回任何字节**。
2. 保存 `kind = httpProxy` 的隧道指向该端口，`connect_timeout_secs = 2`。
3. `test_tunnel_impl(state, id, "127.0.0.1", 5432)` 外包 3s `tokio::time::timeout`。
4. 期望：≤2s 返回 `Err`（超时）；实际：3s 后仍未返回。

### 实测错误日志

Tester 临时复现用例（已从提交中移除，仅作证据）输出：

```text
REPRO silent-proxy probe STILL PENDING after 3s (connect_timeout_secs=2) -> unbounded CONNECT read
test commands::tunnel::tests::zz_temp_silent_proxy_probe_outcome ... ok (3.04s)
```

对照：`wss`/`datazen_v1` 的 WS 探针**是有界的**（`connect_timeout_secs = 1` 时静默中继约 1s 返回 `Err("timed out waiting for WebSocket open ack")`），见新增用例 `test_tester_websocket_probe_is_bounded_when_the_relay_never_acks`。两种 kind 的对称性缺失说明这是疏漏而非有意设计。

### 建议修复方向（不代改业务代码）

- 在 `verify_upstream` 中把 `perform_connect` 包进 `tokio::time::timeout(timeout, ...)`（与 `establish_and_copy` 一致），或对整条探针链路设一个总超时；错误文案建议含 `timed out`。
- 顺带为该分支补一条测试：静默代理 → `Err` 且耗时 < `connect_timeout_secs + 余量`。

---

## tunnel-backend-BUG-004 — `https` 代理 / `wss` 中继的 TLS 路径**运行时 panic**（rustls CryptoProvider 未安装）

> **状态变更（Coder 第 3 轮）**: 已修复，待 Tester 复测。修复说明、provider 选择理由与主证测试见同目录 `progress.md`「Coder 修复轮（第 3 轮）」。两条 `#[ignore]` 守卫已转正（`cargo test -p datazen --lib` 的 ignored 数由 5 回到 3）。
> **复测结论（Tester 第 3 轮）**: ✅ **已修复**。①两条转正守卫在**全新进程**中逐条隔离复跑通过（`--exact`，同进程内无其它用例可先行安装 provider），证明 `https`/`wss` 的修复来自 **TLS 构造点自身**而非 `main()`；`https_data_path_reports_tls_failure_without_panicking` 同样隔离通过（1.02s）。②`git diff 302cf444 1398bd7d -- commands/tunnel_probe_tests.rs` 仅 2 行 `#[ignore]` 属性删除 + 2 处 doc 注释改写（6 insertions / 8 deletions），**断言零改动**；`--ignored --list` 精确剩 3 条既存手工用例。③全仓 `#[ignore]` 属性共 3 处、无 `should_panic`、无删断言。④独立读源码复核：`redis 0.27.6 src/connection.rs:891` 确为 `ClientConfig::builder()`（自动探测，且 `datazen-driver-redis` 启用 `tokio-rustls-comp` → `tls-rustls`，该路径是活代码）；`tauri-plugin-updater 2.10.1 src/updater.rs:446` 确有 `get_default().is_none()` 守卫 + 丢弃返回值，先装 aws-lc-rs 对它只是跳过；`reqwest 0.13.4 client.rs:719` 是 `get_default().unwrap_or_else(default_rustls_crypto_provider)`，而其默认 provider 在本 workspace 就是 aws-lc-rs → **选择不冲突，且把此前"谁先装谁生效"的顺序不确定性变为确定**。⑤新增源码级守卫锁定 `main()` 首语句 + `lib.rs` 重导出 + 两个 TLS 构造点调用（进程级 provider 会被同套件其它用例掩盖，只有源码断言能防回归）。

- **量级**: 中高（加密隧道变体直接 panic；生产转发任务静默 panic → 连接静默失败，无用户可见错误）
- **状态**: ✅ 已修复（复测通过）
- **引入**: **既存缺陷**（非本轮引入）：`ClientConfig::builder()` 早在 `7fc55501 feat: complete HTTP/HTTPS and WebSocket tunnels (#37)` 就存在（`git show 6689cbe0:src-tauri/src/tunnel/http_proxy.rs` 第 156 行）。但本轮把**探针**也接到同一 TLS 路径，使其首次在 `test_tunnel` 上暴露；上一轮 Tester 的用例只覆盖 `http`/`ws` 明文变体，故未发现。
- **影响范围**: `tunnel/http_proxy.rs::tls_connect`（`https` 代理，探针 + 数据路径）、`tunnel/websocket.rs::verify_upstream` → `connect_ws`（`wss://` 中继，走 tungstenite 0.26 的 `ClientConfig::builder()`）。

### 描述与根因

本 workspace 的 feature 统一后，`rustls 0.23.43` **同时**启用了 `aws-lc-rs` 与 `ring`：

```text
rustls feature "aws-lc-rs"  <- reqwest/hyper-rustls/tokio-rustls(default)
rustls feature "ring"       <- tauri-plugin-updater / sqlx-core(tls-rustls) / mongodb / redis / ureq
```

（`cargo tree -e features,no-dev -i rustls@0.23.43`，即**非 dev** 依赖也已如此，故 release 构建同样受影响。）

`rustls::ClientConfig::builder()` 在「两个 provider feature 都开且未显式安装默认 provider」时会 panic：

```text
thread panicked at rustls-0.23.43/src/crypto/mod.rs:249:
Could not automatically determine the process-level CryptoProvider from Rustls crate features.
Call CryptoProvider::install_default() before this point to select a provider manually, ...
```

全仓 `grep -rn "install_default|CryptoProvider" --include=*.rs`（排除 target）**零命中**：DataZen 自己不安装 provider。唯一非测试的安装点是 `tauri-plugin-updater` 在**首次检查更新**时的 `ring::default_provider().install_default()`（`updater.rs:448`），以及 `tauri` 的 `#[cfg(all(dev, mobile))]` 分支（桌面 release 不适用）。因此：

- 进程内**第一次**触发 TLS 的组件若是隧道 → **必然 panic**（单元测试进程就是这种情况，已实测）；
- 若此前已跑过更新检查（安装了 `ring`）→ 不 panic。**即生产环境是顺序相关的潜在 panic**，而测试环境是确定性 panic。

### 实测错误日志

Tester 临时复现用例（已从提交中移除，仅作证据；`AssertUnwindSafe(..).catch_unwind()` 捕获）：

```text
REPRO https-proxy probe (reachable TCP endpoint) -> Err("PANIC")
REPRO wss-probe -> Err("PANIC")
REPRO https data-path task -> Ok("data-path tunnel alive (forwarder task panicked silently)")
```

第三条说明生产数据路径的后果：`start` 是惰性的所以能返回，但 `connect_and_copy` 的子任务 panic → 该转发器静默死掉，客户端连接无字节可通、无错误上报。

注意范围：**TCP 不可达**的 `https` 代理会在 `dial_proxy` 阶段先返回 `Err`，不 panic；只有 TCP 可达的加密端点才 panic。

复现已固化为两条 `#[ignore]` 用例（第 2 轮提交，随时可跑）：

```bash
CARGO_TARGET_DIR=target/cargo-wt cargo test -p datazen --lib -- --ignored test_tester_
# test_tester_https_proxy_probe_reports_tls_failure_instead_of_panicking ... FAILED
# test_tester_wss_relay_probe_reports_tls_failure_instead_of_panicking   ... FAILED
#   panicked at rustls-0.23.43/src/crypto/mod.rs:249:14:
#   Could not automatically determine the process-level CryptoProvider from Rustls crate features.
```

用例体即「明文 TCP 端口 + `scheme="https"` / `wss://` → 断言 `Err`」；**修复后请去掉 `#[ignore]`**，它们就是这两个分支的常驻回归守卫（当前覆盖率 0 的分支由此转为受保护）。

### 建议修复方向（不代改业务代码）

- 在 bootstrap 一次性安装默认 provider（例如 `rustls::crypto::aws_lc_rs::default_provider().install_default()`，忽略「已安装」错误），或改用 `ClientConfig::builder_with_provider(...)`；`wss` 侧需给 tungstenite 显式传入带 provider 的 `ClientConfig`。
- 或收窄 feature（`tokio-rustls`/`reqwest` 关闭 `aws-lc-rs`，或统一到 `ring`），使 rustls 能自动选择。
- 补测试：`https` 代理探针在「可达但 TLS 失败」时返回 `Err`（当前该分支不可测，覆盖率因此为 0——见 `progress.md` 覆盖率评估）。**第 2 轮已预置两条 `#[ignore]` 用例，修复后去掉 `#[ignore]` 即可。**

---

## 非 Bug 的改进建议（不阻断）

1. **`materialize_tunnel_refs` 存在 N+1 次 store 加锁**：每条连接都 `state.store.get_tunnel(tunnel_id).await` 一次读锁（`src-tauri/src/commands/connection_import/ipc.rs:194`）。可在循环前一次性 `get_tunnels()` 建 `HashMap<id, SavedTunnel>`，把 O(N) 次加锁降为 1 次。**（第 2 轮未处理）**
2. ~~`get_tunnel_usage` 与 `materialize_tunnel_refs` 对空串引用不一致~~ → **第 2 轮已修复**（`get_tunnel_usage_impl` 加 `if !id.is_empty()` 守卫；Tester 复测：修复前的 Coder 用例无法区分，已补 `test_tester_usage_with_empty_id_excludes_empty_string_references`）。
3. **摘要投影只靠投影点保证"无密钥"**：`get_tunnel_summaries_impl` 先 `store.get_tunnels()` 克隆出**完整明文实体**（含密钥）再投影（`src-tauri/src/commands/tunnel.rs:40-53`）。IPC 载荷确实无密钥，但"无密钥"是调用点约定而非存储层 API 保证。建议加 `Store::get_tunnel_summaries()` 之类只读元数据的入口，避免未来重构把整实体泄出去。
4. **`SavedTunnelSummary` / `TunnelUsage` 的 `Deserialize` derive 未被使用**（`packages/driver-api/src/tunnel_types.rs:96,107`）：二者只作为响应载荷序列化。若有意留作双向契约，建议补一条反序列化单测；否则可去掉 `Deserialize`。
5. **`test_tunnel` 合成 config 的占位 `database_type = "postgresql"`**（`tunnels.rs:89`）与仓库其它处惯用的 `"postgres"` 不一致。因为该函数不查 registry，当前无影响，但占位值容易误导后续维护者。
6. ~~`kind = ssh` 但 `ssh.enabled == false` 的导出是静默降级~~ → **第 2 轮已修复**（`Some(_) => tracing::warn!("SSH tunnel is disabled; ...")` 且不物化；Coder 用例 + Tester 隔离复跑通过）。
7. ~~`SshTunnel::_upstream` 命名与生命周期~~ → **已随 BUG-002 的 `Drop` 解决**：字段 drop 递归拆除；Tester 用两跳 in-process bastion 动态验证两个会话均归零。
8. **既存未使用代码**：`ConnectionManager::ref_count`（`src-tauri/src/services/connection_manager/tunnels.rs:237`）在编译时产生 `never used` 警告；**非本轨引入**（`7571d288^` 已存在），仅记录。
9. **`SshTunnel` 每连接子任务存在「非 cancel-aware 窗口」（第 2 轮新增评估）**：子任务只在 `copy_bidirectional` 阶段 `select!` 监听 `child_cancel`；其前的 `session.lock().await` 与 `channel_open_direct_tcpip(...).await` 不响应取消。若在「跳板机不回应 channel-open」时 `drop`，该子任务会卡住并继续持有 `Arc<Mutex<Handle>>` 克隆，SSH 会话不会关闭。常规 `test_tunnel`（本地端口无人连接）与 `test_connection`（连接处于 copy 阶段）都不触发；本轮 in-process bastion 实测的正常路径已完整拆除，故仅记为残余风险，非 Bug。
10. **`test_tunnel` 的三条防御分支实际不可达**：`saved.http_proxy.ok_or_else(..)?` / `saved.websocket.ok_or_else(..)?` 以及 `TunnelKind::None => Ok(())` 永远不会执行——`start_tunnel` 已对「配置缺失/disabled」先行报错、对 `None` 返回 `tunnel = None` 并在其上提前 `Err`。属无害防御，但无法被测试覆盖，建议加注释或删除。
11. **`commands/tunnel.rs` 体量**：生产代码约 150 行，测试模块使其达到 809 行（第 2 轮 Tester 已把自己的对抗用例拆到独立文件 `src-tauri/src/commands/tunnel_probe_tests.rs`，784 行）；仍建议把 Coder 的 12 个用例也移出，使单文件回到 800 行以内。
12. **`raw_binary` 与 SSH 的语义边界应写进文档/UI 文案**：见 `progress.md`「语义边界判定」——两者都只证明「上游一跳可达」，不证明 `target_host:target_port` 可达。
13. **`https` / `wss` 分支缺测试**：本轮之前两个 TLS 变体零覆盖（无任何 `https`/`wss` 建连用例），这正是 BUG-004 长期未被发现的原因；第 2 轮已预置 2 条 `#[ignore]` 用例（见 BUG-004），修复后去掉 `#[ignore]` 即可转为常驻守卫。
14. **`raw_binary` 的「只验证中继可达」应在 UI/文档中写明**（追加项 3 结论：非 Bug）：该模式无应用层 ack，探针强度以计划钦定的 `connect_async` 为准；建议在 `tunnel-guide` 与管理面文案中声明「raw_binary 只验证中继可达，不验证目标可达」，强保证场景引导使用 `datazen_v1`。
