# 子进程驱动实施方案

> 状态：Draft
>
> 目标：按照可验证的小步迭代，把运行时子进程驱动接入现有 DataZen 驱动体系。

## 1. 实施原则

- 先打通一个最小 Rust/Go 驱动，再扩展 Java JDBC。
- 先使用可调试的 JSON Lines transport，协议稳定后再切换二进制 framing。
- 保持 `DatabaseDriver` 为 Host 唯一业务抽象。
- 每阶段都有单测、进程级集成测试和失败路径测试。
- 不修改现有内置驱动的默认行为。

## 2. 代码结构

建议新增：

```text
src-tauri/src/db/process/
├── mod.rs
├── manifest.rs       # manifest 解析、兼容性和路径校验
├── catalog.rs        # 已安装 bundle 发现、版本和 active 指针
├── manager.rs        # 启停、重启、回收和崩溃处理
├── transport.rs      # framing、stdin/stdout reader/writer
├── protocol.rs       # request/response/event/error DTO
├── pending.rs        # request id 路由
├── proxy.rs          # ProcessDriverProxy
└── java.rs           # Java Runner 启动参数和 bundle 约束
```

可选新增：

```text
packages/driver-process-protocol/
├── schema/
│   └── protocol-v1.json
└── README.md
```

Java Runner 独立仓库或独立包：

```text
datazen-jdbc-runner/
├── src/main/java/com/datazen/jdbc/
├── protocol-schema/
├── build.gradle 或 pom.xml
└── packaging/
```

## 3. Phase 0：协议和样例驱动

### 任务

- 定义 protocol v1 的 request、response、event、error。
- 定义 `hello`、`ping`、`shutdown`。
- 实现一个最小 Rust 或 Go echo driver。
- 写 Host transport 单测。
- 写独立脚本验证 stdout 只有协议，stderr 可写日志。

### 验证

- request id 可以乱序响应。
- frame 过大时被拒绝。
- 非法 JSON 或未知 message type 返回 protocol error。
- 子进程退出后所有 pending request 都结束。

## 4. Phase 1：Host ProcessDriver

### 任务

- 新增 `DriverManifest` 和兼容性检查。
- 实现 bundle 目录扫描。
- 实现 `DriverProcessManager`。
- 实现 `ProcessDriverProxy`，先覆盖：
  - connect
  - test_connection
  - disconnect
  - query
  - execute
- 增加 runtime driver factory 到 `DriverRegistry`。

### 相关现有代码

- [registry.rs](../../../../src-tauri/src/db/registry.rs)
- [traits.rs](../../../../packages/driver-api/src/traits.rs)
- [connection_manager.rs](../../../../src-tauri/src/services/connection_manager.rs)
- [resolve.rs](../../../../src-tauri/src/commands/driver_command/resolve.rs)

### 验证

- 内置驱动和 process driver 同时注册。
- `ConnectionManager` 可以建立并释放子进程 session。
- `execute_driver_command` 不增加按 driver type 的特殊分支。
- 子进程 kill 后 Host 仍可使用内置驱动。

## 5. Phase 2：结果、Schema 和参数

### 任务

- 统一 scalar、bytes、timestamp、JSON、null 映射。
- 实现 `query_with_params`。
- 使用 PreparedStatement 或等价安全参数 API。
- 实现 get_databases、get_tables、get_table_schema。
- 实现标准 command definitions 和 execute_command。

### 验证

- null、中文、emoji、二进制数据、超长字符串能够往返。
- 参数不会被拼接进 SQL。
- Schema 结果可以驱动现有连接树。
- 结果类型与内置驱动的 DataTable 兼容。

## 6. Phase 3：流式和取消

### 任务

- 增加 stream event channel。
- 增加 `executionId` 生命周期：

```text
prepare_query_execution
  -> query_stream_with_execution
  -> cancel_query_with_execution
  -> cleanup_query_execution
```

- Host 侧设置 stream backpressure。
- Runner 侧保存 executionId 到 statement/cursor 的映射。

### 验证

- 大结果集不需要在 Host 或 Runner 一次性物化。
- 取消一个查询不会取消同一进程的另一个查询。
- 查询完成、取消、进程退出三种路径都会关闭 stream。
- 重复 cancel 不会 panic。

## 7. Phase 4：事务和恢复

### 任务

- 实现 begin、commit、rollback。
- 为 session、transaction、execution 建立归属检查。
- 实现 idle eviction 后的重新连接。
- 定义进程重启策略：默认下一次使用时冷启动，不自动重放事务或查询。

### 验证

- 事务 handle 不可跨 session 使用。
- 进程崩溃后旧事务明确失败，不会被错误重放。
- 重连后 `db_session_id` 的 Host 语义符合现有 ConnectionManager 约束。

## 8. Phase 5：Java JDBC Runner

### 任务

- 创建通用 Java Runner。
- 实现 bundle manifest 解析。
- 使用独立 URLClassLoader 加载 `lib/*.jar`。
- 支持显式 `driverClass` 和 `ServiceLoader`。
- 实现：
  - DriverManager connection
  - PreparedStatement 参数绑定
  - ResultSetMetaData
  - JDBC transaction
  - Statement.cancel
  - JDBC 到 DataZen 类型映射
- 用 PostgreSQL 或 MySQL JDBC 驱动做第一个验收 bundle。
- 为 Java bundle 加入 jlink runtime 打包流程。

### 验证

- 只更换 manifest 和 JDBC bundle，不修改 Runner 代码，即可切换数据库。
- MySQL 和 PostgreSQL 两个 bundle 的依赖不会互相污染。
- 缺少依赖时有明确错误，而不是 ClassNotFoundException 原样泄露给用户。
- JDBC URL、用户名和密码不会出现在日志或进程参数中。

## 9. Phase 6：Bundle 管理和发行

### 任务

- 定义 bundle 文件名和 release asset 命名。
- 为 macOS arm64/x64、Windows x64、Linux x64 构建 bundle。
- 实现安装临时目录、checksum、签名验证。
- 实现 active.json 原子切换。
- 实现失败回滚和旧版本清理。
- 将内置 bundle 放入 Tauri resources。
- 更新 release workflow，生成并上传驱动 bundle。

### 建议产物

```text
datazen-driver-<id>-<version>-macos-arm64.tar.zst
datazen-driver-<id>-<version>-macos-x64.tar.zst
datazen-driver-<id>-<version>-windows-x64.zip
datazen-driver-<id>-<version>-linux-x64.tar.zst
```

### 验证

- 伪造 checksum 或签名无法激活。
- 更新过程中中断不会损坏 active 版本。
- 新版本启动失败时自动恢复旧版本。
- 各平台 executable 权限和路径正确。

## 10. 测试矩阵

### Unit

- manifest schema 和路径穿越
- platform/arch 选择
- protocol encode/decode
- request id 路由
- error mapping
- capability negotiation
- Java 类型映射

### Process integration

- 启动成功
- 启动超时
- hello 不兼容
- stdout 协议污染
- stderr 超长
- 并发请求乱序返回
- 子进程异常退出
- 子进程无响应
- cancel race
- graceful shutdown

### Host integration

- Registry 发现和加载
- ConnectionManager connect/reconnect/release
- execute_driver_command
- streaming channel
- transaction lifecycle
- driver crash isolation

### Security

- 任意 executable 拒绝
- manifest `../` 拒绝
- 未签名 bundle 拒绝
- frame size 限制
- env 未泄露
- 密码不出现在 argv/log/error
- bundle 解压文件数和总大小限制

## 11. 交付顺序

1. Protocol v1 + echo driver
2. ProcessDriverManager + proxy
3. connect/query/execute
4. Schema 和参数查询
5. stream/cancel
6. transaction/reconnect
7. Java JDBC Runner
8. bundle install/sign/update/rollback
9. release workflow 和驱动管理 UI

## 12. 停止条件

遇到以下情况应暂停扩展范围并重新评审协议：

- 需要让 Host 依赖某个具体语言 runtime 的内部类型。
- 需要通过杀整个进程实现普通查询取消。
- 需要让驱动自行修改 Host 数据库连接或 Store。
- wire protocol 需要暴露 sqlx、JDBC、MongoDB 等实现类型。
- 一个 bundle 同时加载互相冲突的库且无法通过 ClassLoader 或进程隔离解决。
- 签名、更新和回滚策略尚未确定却准备开放远程驱动下载。

## 13. 完成定义

- 至少一个非 Rust 驱动完成端到端连接、查询、Schema 和断开。
- Java JDBC Runner 能通过替换 bundle 支持至少两个 JDBC 数据库。
- `cargo test -p datazen --lib`、driver-api 测试和新增 process integration tests 通过。
- 失败进程、协议错误、取消、回滚和签名失败均有自动化测试。
- 新增驱动不修改 Host 业务代码中的 database-type 分支。
