# Backend Services

> Source of truth: `src-tauri/src/services/`。

Services 是 DataZen backend 中复用性的运行时服务层，不承担 Tauri IPC 的参数边界，也不承担具体 Driver 方言实现。

## 1. 当前服务

| 服务 | 位置 | 职责 |
|---|---|---|
| ConnectionManager | `connection_manager.rs` | Driver 选择、连接建立、session 生命周期、引用计数、idle eviction、隧道解析（`resolve_tunnel_ref` / `maybe_start_tunnel`） |
| QueryExecutor | `query_executor.rs` | 查询执行相关的参数、过滤、排序和执行辅助 |
| DbTools | `db_tools.rs` | 数据库工具类复用能力 |
| JobRegistry | `job_registry.rs` | 长任务/job 生命周期和取消注册 |
| Transaction | `transaction.rs` | 事务相关运行时辅助 |

## 2. ConnectionManager

DataZen 明确区分：

- `connectionId`：持久化连接配置 ID。
- `dbSessionId`：运行时数据库 session ID。

```text
connectionId
   ↓
Store
   ↓
ConnectionManager
   ↓
Driver.connect()
   ↓
dbSessionId
```

Schema Diff、Data Sync、Data Transfer 使用 dedicated session，避免共享主工作区的 database selection 或事务状态。

连接建立时先解析隧道再创建 driver：配置若带 `tunnel_id`，`resolve_tunnel_ref` 会从 `tunnels.json` 还原为内联的 `tunnel_kind` + 各类隧道参数；随后 `maybe_start_tunnel` 在本机监听回环端口并把 driver 看到的 host/port 改写为该回环地址。四种隧道类型（直连 / SSH / HTTP CONNECT / WebSocket）的差异对 driver 不可见。详见 [tunnel.md](tunnel.md)。

## 3. Query execution

普通 Query 由 command 层进入 QueryExecutor / Driver。流式查询可以绑定 `QueryExecutionId`，用于精确取消。

Services 不根据 PostgreSQL/MySQL 等类型拼接方言 SQL；数据库特定能力由 Driver 提供。

## 4. 长任务

Data Sync、Data Transfer 等任务通过 job registry / job id 管理取消和生命周期。取消是显式的 job 操作，不应通过关闭 UI 猜测任务已经停止。

## 5. 依赖方向

```text
Commands
   ↓
Services / Domain modules
   ↓
Driver API / Driver Registry
   ↓
Concrete Drivers
```

持久化通过 Store；Services 不把 React/Zustand 状态下沉到 Rust。
