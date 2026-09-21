# 子进程驱动 PRD

> 状态：Draft
>
> 目标：在不改变 Host 业务调用模型的前提下，支持以独立进程交付的数据库驱动，并统一兼容 C/C++、Go、Rust、Java 实现。

## 1. 背景

当前 DataZen 驱动主要通过 Rust `inventory` 在编译期集成。该模式性能和类型安全较好，但要求驱动与 Host 共同构建，无法直接接入已有的 Go、C/C++、Java 驱动，也会增加第三方驱动的发布和升级成本。

本功能引入运行时子进程驱动：Host 通过版本化 RPC 与驱动通信，驱动自身持有数据库连接、连接池、事务和方言实现。

## 2. 用户与场景

### 2.1 用户

- 需要使用 DataZen 连接更多数据库的最终用户
- 已有 JDBC 驱动或 Java 数据库 SDK 的驱动开发者
- 使用 Go、Rust、C/C++ 编写独立数据库适配器的团队
- 需要独立升级驱动而不重新发布整个 DataZen 的发行团队

### 2.2 主要场景

1. 用户安装一个驱动 bundle 后，在新建连接中看到对应数据库类型。
2. Host 自动选择当前平台和架构的驱动二进制。
3. 用户建立连接、执行查询、查看 Schema、执行事务。
4. 驱动崩溃时，当前请求失败，但 Host 不崩溃。
5. 驱动升级失败时，自动保留并恢复上一版本。
6. Java 驱动通过通用 JDBC Runner 加载对应 JDBC JAR，无需为每个数据库重新编写 Java 进程。

## 3. 目标

- 保持 `DatabaseDriver`、`ConnectionManager`、`execute_driver_command` 对上层业务透明。
- 支持内置驱动和运行时子进程驱动并存。
- 通过统一协议支持 C/C++、Go、Rust、Java。
- 支持驱动 bundle 的安装、校验、启用、升级和回滚。
- 支持连接、查询、参数查询、执行、Schema、事务、流式结果和取消。
- Java 侧提供通用 JDBC Runner，通过 manifest + JDBC 依赖包接入数据库。
- 驱动崩溃、超时、协议损坏不应导致 Host 进程崩溃。

## 4. 非目标

- 本期不定义跨语言 ABI，不加载第三方 Rust/C 动态库。
- 本期不允许驱动进程直接调用 Host 内部 Rust API。
- 本期不把 MCP 作为数据库驱动协议。
- 本期不自动解决每种数据库的方言差异；方言能力仍由驱动 manifest 和驱动实现声明。
- 本期不承诺所有 JDBC 驱动只需一个 JAR；存在依赖时必须以完整 bundle 分发。

## 5. 用户体验

Settings 中增加独立的 `Drivers` 配置目录，与 `Extensions` 并列。`Extensions` 只管理 Workspace Apps；驱动列表、Java Runner 和 JDBC JAR 包全部归 `Drivers`。

### 5.1 驱动状态

Drivers 页面分为两类资源：

- Native process drivers：C/C++、Go、Rust 等独立进程驱动。
- Java runtime：只安装一个通用 DataZen JDBC Runner，数据库支持由 JDBC JAR packages 提供。

页面显示：

- 驱动名称、实现类型和数据库类型
- 已安装版本
- 当前平台和架构
- 来源：内置、托管下载、本地开发
- 签名和校验状态
- 支持的能力
- 启用、更新、回滚、移除操作
- Java Runner 当前加载的 JAR 包数量和重启状态

### 5.2 连接配置

连接配置继续使用现有数据库类型和连接表单。JDBC 驱动额外支持：

- JDBC URL
- 驱动属性
- 显式 driver class（manifest 已声明时可隐藏）
- 用户名、密码和认证方式

密码不得出现在命令行、manifest、普通日志或错误消息中。

## 6. 功能需求

### P0：运行与连接

- 发现有效驱动 manifest
- 按平台、架构、版本选择 executable
- 启动、握手、健康检查、关闭驱动进程
- `connect`、`test_connection`、`disconnect`
- 将驱动错误转换为统一 `DriverError`
- 进程退出时唤醒并失败所有 pending request

### P0：查询能力

- `query`
- `query_with_params`
- `execute`
- `get_databases`
- `get_tables`
- `get_table_schema`
- 标准结果类型和类型映射

### P1：高级能力

- 流式查询和行批次事件
- execution id 和精确取消
- begin / commit / rollback
- Driver Command API
- 驱动能力发现
- 多连接会话隔离

### P1：生命周期与发布

- bundle 安装到用户数据目录
- SHA-256 校验
- 签名校验
- 原子启用
- 失败回滚
- 版本兼容检查
- 崩溃诊断和 stderr 日志采集

### P1：Java JDBC Runner 与 JAR 管理器

- 通用 Java Runner
- 页面中只出现一个 Java Runner，不按数据库重复创建 Java 进程
- 独立 ClassLoader 加载各 JDBC JAR package
- 单独的 JDBC JAR 包安装、校验、启用、禁用、更新和移除
- 支持 `META-INF/services/java.sql.Driver` 和 manifest 指定 driver class
- 使用 `DriverManager` / `PreparedStatement` / `ResultSet`
- 支持依赖 JAR bundle
- 支持捆绑 JRE 或 jlink runtime

## 7. 验收标准

- 一个示例 Go 或 Rust 子进程驱动可以被发现并完成连接、查询、断开。
- 一个 Java JDBC Runner 可以通过替换 JDBC JAR package 接入 PostgreSQL 或 MySQL，不新增 Java 进程。
- Host 可同时运行内置驱动和子进程驱动。
- 子进程崩溃不会导致 Host 崩溃，pending 请求能收到确定错误。
- 查询取消不会影响同一驱动进程中的其他连接。
- bundle 校验失败不会被激活。
- 更新失败后旧版本仍可启动。
- 多平台 bundle 能正确选择 macOS、Windows、Linux 及架构。
- 运行时协议版本不兼容时，连接在握手阶段被拒绝并给出可理解错误。

## 8. 约束与风险

- JVM 启动时间和运行时体积高于 Go/Rust。
- C/C++ 可能依赖系统 CRT、OpenSSL、Kerberos 或 ODBC。
- JDBC 驱动的 license 和传递依赖必须可审计。
- 大结果集不能一次性物化到内存。
- 驱动二进制必须签名，下载源和更新密钥必须可轮换。
- 子进程协议设计一旦发布，需要遵守独立的兼容策略。

## 9. 成功指标

- 新增一个外部数据库驱动不需要修改 Host 业务领域代码。
- 新增一个 JDBC 数据库只需新增 bundle 和前端元数据，不需要新增 Java Runner。
- 驱动独立升级不需要升级 DataZen 主程序。
- 查询、事务和 Schema 的行为与内置驱动保持统一错误和结果模型。
