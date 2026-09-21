# 子进程驱动技术设计

> 状态：Draft
>
> 相关现状：[Driver API](../../../architecture/backend/drivers.md)、[Driver Registry](../../../architecture/backend/drivers.md)、[Driver API 依赖边界](../../../development/driver-api-dependency-boundary.md)。

## 1. 总体架构

```text
ConnectionManager
        |
        v
DriverRegistry
  |             |
  |             +-- ProcessDriverFactory
  |                         |
  +-- BuiltinDriverFactory  v
        |             ProcessDriverProxy
        |                         |
        +-- Arc<dyn DatabaseDriver>|
                                  v
                         DriverProcessManager
                                  |
                    framed stdin/stdout RPC
                                  |
             +--------------------+--------------------+
             |                    |                    |
           Rust driver         Go/C++ driver       Java JDBC Runner
                           |
                       JDBC JAR packages
```

Host 只依赖 `DatabaseDriver`，不依赖驱动实现语言。运行时驱动通过 manifest 注册为 `ProcessDriverFactory`，最终仍返回 `Arc<dyn DatabaseDriver>`。

## 2. Bundle 和 manifest

### 2.1 目录

```text
drivers/<id>/<version>/
├── manifest.json
├── bin/
│   └── driver executable
├── lib/
│   └── optional dependencies
├── runtime/
│   └── optional Java runtime
├── LICENSE
└── checksums.txt
```

应用资源中的内置驱动和用户数据目录中的托管驱动使用相同 bundle 格式。

### 2.2 Manifest

```json
{
  "id": "java-jdbc-runner",
  "displayName": "DataZen JDBC Runner",
  "version": "1.0.0",
  "protocolVersion": 1,
  "hostApi": { "min": 3, "max": 3 },
  "platform": "macos",
  "arch": "aarch64",
  "source": "managed",
  "executable": "bin/datazen-jdbc-runner",
  "capabilities": {
    "streamingResults": true,
    "queryCancellation": true,
    "transactions": true
  },
  "runtime": "java-21-bundled",
  "sha256": "...",
  "signature": "..."
}
```

Manifest 校验规则：

- id 只允许稳定的 ASCII 标识符。
- executable 必须是 bundle 内相对路径，禁止 `..`。
- platform、arch 必须匹配当前运行环境。
- protocolVersion 必须在 Host 支持范围内。
- hostApi 范围必须与 Host Driver API 兼容。
- 签名和 SHA-256 校验通过后才允许激活。

## 3. 安装、激活和回滚

```text
下载临时文件
  -> 解压临时目录
  -> 检查路径和 manifest
  -> 校验 checksum
  -> 校验签名
  -> 启动 hello
  -> ping / capability check
  -> 原子写入 active.json
  -> 删除过期版本
```

安装目录：

```text
macOS: ~/Library/Application Support/DataZen/drivers/
Windows: %LOCALAPPDATA%\\DataZen\\drivers\\
Linux: ~/.local/share/DataZen/drivers/
```

不修改当前版本目录，不覆盖正在运行的 executable。激活失败时保留原 active 指针。

## 4. 进程管理

### 4.1 DriverProcess

```rust
struct DriverProcess {
    manifest: DriverManifest,
    child: tokio::process::Child,
    pending: PendingRequests,
    write_lock: tokio::sync::Mutex<()>,
    sessions: SessionMap,
    cancel: CancellationToken,
}
```

### 4.2 启动

1. 解析并校验 executable。
2. 使用 `Command::new` 和参数数组，禁止 shell 拼接。
3. 默认清空环境变量，只注入明确允许的变量。
4. 分离 stdout、stdin、stderr。
5. stdout 只用于协议，日志全部走 stderr。
6. 等待 `hello`，超时即 kill。
7. 校验 driver id、protocol version 和 capabilities。

### 4.3 请求路由

读取任务持续解析 stdout：

```text
request id -> oneshot response sender
request id -> stream event sender
```

写入只需要保护单次 frame 写入，不应使用全局请求锁导致所有查询串行化。

子进程退出时：

- 标记进程不可用
- 关闭所有 stream sender
- 以 `process_exited` 失败所有 pending request
- 保留 stderr 摘要
- 根据策略允许下一次请求触发重启

## 5. RPC 协议

生产协议使用 length-prefixed MessagePack 或 CBOR：

```text
4-byte big-endian payload length
N-byte payload
```

开发阶段可提供 JSON Lines debug transport，但不得让换行成为生产协议的唯一 framing 方式。

### 5.1 请求

```json
{
  "type": "request",
  "id": "req-1",
  "method": "query",
  "sessionId": "session-1",
  "params": {
    "sql": "select * from users",
    "limit": 1000
  }
}
```

### 5.2 响应

```json
{
  "type": "response",
  "id": "req-1",
  "ok": true,
  "result": {}
}
```

### 5.3 流式事件

```json
{
  "type": "event",
  "id": "req-2",
  "event": "rows",
  "data": {
    "columns": [],
    "rows": []
  }
}
```

流式请求必须以最终 response 结束。Host 收到进程退出或协议错误时，必须结束对应 stream。

### 5.4 错误

```json
{
  "type": "response",
  "id": "req-1",
  "ok": false,
  "error": {
    "code": "permission_denied",
    "message": "permission denied",
    "retryable": false,
    "details": null
  }
}
```

错误 code 应能映射到现有 `DriverError`，至少包括：

```text
invalid_request
unsupported
connection_failed
authentication_failed
query_failed
transaction_failed
cancelled
timeout
process_exited
protocol_error
resource_exhausted
```

## 6. 会话和事务模型

Host 维护 `db_session_id`，子进程维护其对应的远程 connection handle。每个 handle 必须绑定 driver process 和 session。

```text
DataZen db_session_id
  -> process id
  -> remote connection handle
```

事务使用独立的 `transactionId`，不能把事务对象跨进程传递。断开 session 时，Runner 必须关闭连接和未完成 statement。

这与现有 [ConnectionManager](../../../src-tauri/src/services/connection_manager.rs) 的 session owner、空闲回收和重连行为保持一致。

## 7. Java JDBC Runner 与 JAR 包管理

Java 只分发一个通用 Runner，不为每一种数据库单独创建 Java 进程。数据库支持由独立 JDBC JAR 包提供。

### 7.1 加载流程

```text
Runner 启动
  -> 读取 Runner manifest
  -> 读取已启用 JDBC JAR package manifests
  -> 为每个 package 创建独立 URLClassLoader
  -> 加载 driverClass 或 ServiceLoader
  -> 注册 JDBC Driver
  -> 等待 RPC
```

Runner 进程只有一个；每个 JDBC JAR package 使用独立 ClassLoader，避免 MySQL、Oracle、PostgreSQL 依赖冲突。无法隔离的冲突依赖必须被 JAR 管理器拒绝同时启用。

### 7.2 JDBC JAR package manifest

```json
{
  "id": "postgresql-jdbc",
  "type": "jdbcJar",
  "version": "42.7.4",
  "driverClass": "org.postgresql.Driver",
  "urlPrefixes": ["jdbc:postgresql:"],
  "jar": "lib/postgresql-42.7.4.jar",
  "sha256": "...",
  "license": "BSD-2-Clause"
}
```

JAR 管理器负责发现 service provider、识别 driver class、检查 URL prefix、校验 hash/signature、启停包以及通知 Runner 重建 ClassLoader。

### 7.3 JDBC 映射

- `connect` 使用 `DriverManager.getConnection(url, properties)`。
- 参数查询必须使用 `PreparedStatement`。
- 结果列使用 `ResultSetMetaData`。
- 行数据转换为 DataZen transport-neutral value。
- 查询流按 batch 发送 rows。
- `executionId -> Statement` 用于 `Statement.cancel()`。
- 事务使用 JDBC `setAutoCommit(false)`、`commit()`、`rollback()`。

JDBC JAR 本身不负责 DataZen 的 UI metadata、SQL dialect 或图标。它们由 JAR manifest 和 Host 前端 registry 提供。

### 7.3 Java Runtime

生产 bundle 默认附带 Java runtime，优先使用 `jlink` 生成精简 runtime。Runner 通过 bundle 内的 `runtime/bin/java` 启动，不依赖用户机器安装 Java。

启动时设置合理的 `-Xms`、`-Xmx`，并使用比 Go/Rust 更长的启动超时。

## 8. 安全模型

- executable 使用 allowlist 或已验证 manifest。
- 禁止 shell 字符串拼接。
- 默认 `env_clear`。
- 凭据不得进入 argv、manifest 和普通日志。
- bundle 使用签名公钥验证。
- 下载和解压过程限制文件大小、路径和数量。
- stdout 解析限制单 frame 大小。
- stderr 使用有界缓冲并脱敏。
- 驱动进程不能访问 Host 私有 IPC，数据库权限由连接配置控制。
- Java Runner runtime 与每个 JDBC JAR 独立进行 hash 和签名校验。

## 9. 可观测性

每个驱动进程记录：

- driver id、version、protocol version
- pid、启动耗时、退出原因
- request id、method、耗时
- rows 和 bytes 统计
- stderr 摘要

不记录：

- 密码
- 完整 JDBC URL 中的 secret
- 完整 SQL 参数值
- 认证 token

## 10. 兼容策略

- RPC protocol version 独立于应用 semver。
- 向后兼容字段采用 optional 字段和 capability negotiation。
- breaking wire change 增加 protocol major version。
- Host 可拒绝不兼容驱动，不得静默按未知结构执行。
- 旧驱动缺少高级能力时，Host 按 capabilities 禁用对应 UI。
