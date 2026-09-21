# 外置驱动管理 UI 设计稿

> 状态：Draft
>
> 设计目标：在现有 Settings 页面语言内增加外置驱动管理，不引入独立的插件市场视觉，也不把驱动生命周期藏在连接页。
>
> 原型：[prototype.html](./prototype.html)
>
> 现有设计依据：
>
> - Settings 容器：[SettingsContent.tsx](../../../../src/windows/settings/SettingsContent.tsx)
> - Settings 图元：[settingsUi.tsx](../../../../src/windows/settings/settingsUi.tsx)
> - 驱动设置面板：[DriverSettingsSection.tsx](../../../../src/windows/settings/DriverSettingsSection.tsx)
> - 外观设置的空态和错误态：[AppearanceSection.tsx](../../../../src/windows/settings/AppearanceSection.tsx)
>
> ## 1. 设计语言
>
> - 页面保持 Settings 的左侧导航 + 右侧滚动内容结构。
> - 使用现有 `SectionTitle`：13px、uppercase、tracking-wider、muted foreground。
> - 使用现有 `SettingRow`：左侧 128px 标签列，右侧控件列。
> - 可管理实体使用 `rounded-md border border-edge bg-surface p-4`，与现有 Driver Settings 面板一致。
> - 默认操作使用紧凑按钮，不使用大号 marketing CTA。
> - 状态优先使用文字 + 颜色：绿色表示已验证/已启用，琥珀色表示需要注意，红色表示阻断。
> - 不使用渐变、装饰性大卡片或额外的视觉主题。
>
> ## 2. 入口与导航
>
> 驱动不属于 Extensions。Settings 左侧导航增加独立的 `Drivers` 配置目录，和 `Extensions` 并列：
>
> ```text
> Settings
>   ├── Drivers
>   └── Extensions
>       └── Workspace Apps
> ```
>
> `Extensions` 只管理 Workspace Apps 和主题扩展；`Drivers` 专门管理外置驱动进程、Java Runner 和 JDBC JAR 包。驱动页面使用独立深链接，例如 `?section=drivers`。
>
> 推荐文案：
>
> - 标题：`Drivers`
> - 副标题：`Manage external database drivers and Java JDBC packages.`
> - Extensions 页面标题：`Workspace Apps`
>
> ## 3. 页面信息架构
>
> ```text
> Settings / Drivers
> ├── SectionTitle: Drivers
> ├── subtitle
> ├── summary row
> │   ├── Native drivers 3
> │   ├── Java Runner 1
> │   └── JDBC packages 2
> ├── primary actions
> │   ├── Add native driver
> │   └── Check for updates
> ├── Native process drivers
> │   ├── Driver item: PostgreSQL Native
> │   ├── Driver item: ClickHouse Go
> │   └── Driver item: SQLite Rust
> ├── Java runtime
> │   ├── One item: DataZen JDBC Runner
> │   └── Manage JDBC JAR packages
> └── Security / runtime note
> ```
>
> 页面内容仍控制在 `max-w-lg`，列表项目纵向排列，避免在窄 Settings 窗口中制造横向表格。
>
> ## 4. 驱动列表项
>
> 每个驱动项是一个独立面板，不嵌套卡片：
>
> ```text
> [database icon]  PostgreSQL Native                       [Enabled]
>                 PostgreSQL 16.x · v1.4.0
>                 Signed by DataZen · macOS arm64
>                 Streaming · Transactions · Cancellation
>                 Last used yesterday
>                                      [Details] [Disable]
> ```
>
> 视觉层级：
>
> 1. 驱动名称和启用状态是第一视觉层。
> 2. 版本、平台和签名是第二层，使用 `text-xs text-fg-muted`。
> 3. 能力显示为短文本列表，不使用大量彩色 badge。
> 4. `Details` 为次要按钮，`Disable` 为 ghost/danger 语义。
>
> 对未验证驱动：
>
> ```text
> [!] Signature could not be verified
>     This driver is disabled until trust is confirmed.
>                                      [Review] [Remove]
> ```
>
> 不允许只用颜色表达风险；必须有文字状态。
>
> ## 5. 状态设计
>
> | 状态 | 主文案 | 操作 | 颜色 |
> | --- | --- | --- | --- |
> | enabled | Enabled | Details / Disable | green |
> | disabled | Disabled | Enable / Details | muted |
> | update | Update available | Update / Details | accent |
> | verifying | Verifying bundle… | Cancel | muted |
> | unverified | Signature not verified | Review / Remove | amber |
> | incompatible | Requires newer DataZen | Details / Remove | red |
> | crashed | Driver stopped unexpectedly | Restart / Logs | red |
> | installing | Installing… | Cancel | muted |
>
> 状态变化只替换列表项内状态行和操作，不弹出全屏遮罩。
>
> ## 6. 添加原生驱动流程
>
> 点击 `Add native driver` 后打开现有 Dialog 图元：
>
> ```text
> Add native driver
> ├── source tabs: Local bundle | Download URL
> ├── PathInput / URL input
> ├── detected metadata preview
> │   ├── name
> │   ├── version
> │   ├── platform
> │   ├── signature
> │   └── capabilities
> ├── verification result
> └── Cancel / Install
> ```
>
> 规则：
>
> - 文件选择使用 `PathInput` 或现有文件选择能力，不手写新的路径输入样式。
> - 安装按钮在 manifest、平台和签名检查完成前禁用。
> - 本地开发 bundle 可以显示 `Developer build`，但不能默认为受信状态。
> - URL 下载必须显示来源域名和签名状态。
>
> ## 7. Java Runtime 与 JDBC JAR 管理
>
> Java 不按数据库拆成多个 Java 驱动进程。页面只展示一个通用 `DataZen JDBC Runner`，数据库支持来自独立的 JDBC JAR 包。
>
> ### 7.1 Java Runtime 卡片
>
> ```text
> Java runtime
> ├── DataZen JDBC Runner                         [Enabled]
> │   v1.0.0 · Java 21 · Signed by DataZen
> │   Loaded packages: 2
> │   PostgreSQL JDBC · MySQL Connector/J
> │                              [Details] [Restart]
> └── [Manage JDBC JAR packages]
> ```
>
> Runner 卡片不复制 PostgreSQL/MySQL 的驱动项。连接类型由已安装 JAR 的 manifest、driver class 和 JDBC URL prefix 提供。
>
> ### 7.2 JDBC JAR 包管理器
>
> 点击 `Manage JDBC JAR packages` 进入 Drivers 下的独立子目录或 Dialog，不能和原生进程列表混在一起：
>
> ```text
> JDBC JAR packages
> ├── Add JAR package
> ├── Check for updates
> ├── PostgreSQL JDBC Driver
> │   org.postgresql:postgresql · 42.7.4
> │   URL prefix: jdbc:postgresql: · Loaded by JDBC Runner
> │                                      [Details] [Remove]
> ├── MySQL Connector/J
> │   com.mysql:mysql-connector-j · 9.0.0
> │   URL prefix: jdbc:mysql: · Loaded by JDBC Runner
> │                                      [Details] [Remove]
> └── Security / classloader note
> ```
>
> JAR 管理器负责：
>
> - 添加单个 JAR 或完整依赖目录
> - 读取 `META-INF/services/java.sql.Driver`
> - 维护 driver class、坐标、版本和 URL prefix
> - 校验 SHA-256、签名和 license metadata
> - 启用/禁用 JAR
> - 处理依赖冲突
> - 重启 Java Runner 使 classloader 变更生效
>
> 一个 JDBC JAR 包更新失败时，不能影响其他包，也不能删除当前可用版本。
>
> ## 8. 详情视图
>
> 详情使用 Dialog，而不是跳到另一种页面：
>
> ```text
> PostgreSQL Native / DataZen JDBC Runner
> ├── Overview
> │   ├── version / platform / protocol
> │   ├── executable path
> │   └── signature fingerprint
> ├── Capabilities
> │   ├── Streaming results
> │   ├── Query cancellation
> │   └── Transactions
> ├── Runtime
> │   ├── process status
> │   ├── last start / last exit
> │   └── stderr log link
> └── Update / Rollback / Remove
> ```
>
> 对 `DataZen JDBC Runner` 额外显示：
>
> - bundled Java runtime version
> - loaded JAR package count
> - classloader status
> - restart required 状态
>
> 对单个 JDBC JAR 包显示：
>
> - driver class
> - JDBC URL prefix
> - Maven coordinates（如果可识别）
> - JAR SHA-256
> - license 和依赖信息
>
> ## 9. 更新、回滚和移除
>
> ### 更新
>
> 列表项显示 `Update available`，点击后在详情 Dialog 中显示版本差异和签名状态。安装采用后台流程，成功后显示 `Restart required` 或下一次连接时生效。
>
> ### 回滚
>
> 详情中显示上一版本时才展示 `Rollback`。操作必须二次确认，并说明不会删除当前版本文件，直到新版本验证成功。
>
> ### 移除
>
> 如果仍有活动连接，先显示使用中的连接列表，阻止直接移除。无活动连接时使用标准确认 Dialog。
>
> ## 10. 响应式与窗口约束
>
> - 保持 Settings 左导航行为；窗口过窄时内容区仍可滚动。
> - 驱动项操作按钮允许换行，不能依靠固定宽度避免溢出。
> - 长路径使用截断 + tooltip，不能让 bundle 路径撑宽页面。
> - 状态行和错误文案允许换行，不能覆盖操作按钮。
> - 最小验证视口：1024x700；窄窗口：760x640。
>
> ## 11. 组件映射
>
> | 设计元素 | 复用/新增 |
> | --- | --- |
> | section title | `SectionTitle` |
> | label + hint | `SettingRow` |
> | 开关 | `ToggleRow` |
> | 选择 | `Select` |
> | 路径选择 | `PathInput` |
> | 详情/确认 | `Dialog` / `ConfirmDialog` |
> | 驱动面板 | 复用 `DriverSettingsSection` 面板 class |
> | 状态标识 | 优先使用文字行；必要时复用现有 Badge |
> | 下载/安装进度 | 新增轻量 `DriverStatusRow`，不新增大容器 |
> | JDBC JAR 管理 | 新增 `JdbcJarManagerSection`，复用驱动面板和 Dialog |
>
> ## 12. 交互验收
>
> - 首次进入 Drivers 后能明确区分原生进程、Java Runner 和 JDBC JAR 包。
> - Extensions 页面不出现驱动列表；它只保留 Workspace Apps。
> - Java 页面只出现一个 Runner，不为 PostgreSQL、MySQL 等重复创建 Java 驱动进程。
> - Add native driver、Add JAR、Details、Update、Rollback、Remove 都有明确反馈。
> - 安装失败不会从列表中删除原有版本。
> - 未验证驱动不能通过一次普通点击直接启用。
> - 活跃连接使用中的驱动不能被直接移除。
> - Java Runner 的 runtime、classloader 和 JDBC JAR 信息可在详情中被识别。
