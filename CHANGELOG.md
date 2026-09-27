# 更新日志 / Changelog

本文件记录 DataZen 的显著变更，重点是影响外部契约的破坏性变更。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 简化版；
术语约定：**`connectionId` / `connection_id` = 配置连接 id（持久化）**，
**`dbSessionId` / `db_session_id` = 运行时数据库会话 id（内存态）**。

---

## [Unreleased]

_（暂无）_

---

## [0.2.2] - 2026-09-27

> 自 v0.2.1 以来累计 **829** 次提交。主线是可视化查询构建器、Redis 工作台重做、数据库隧道，以及一次驱动契约的硬切换。

### ⚠️ 破坏性变更（Breaking Changes）

- **Driver API `PROTOCOL_VERSION` 3 → 4（硬切换）**：元数据契约里的 `(database, schema)` 维度不再靠会话隐式携带。
  - `get_tables` / `get_table_schema` / `get_columns` / `get_all_columns` / `dump_*_ddl` 现在显式接收 `database` + `schema`。
  - **删除 `use_database`**：宿主不再在每次读取前发 `USE` 语句。
  - 新增 `has_schema_level()` / `default_schema()` 描述驱动是否有第二层命名空间；`validate_schema_target(driver, database, schema, scope)` 成为双方共用的唯一校验规则。
  - `SchemaScope::{AnySchema, ExactSchema}`：列举类方法可接受「全部 schema」，解析类方法必须指定一个。
  - **所有外部驱动必须重新编译。** Kiwi、Superset 已于 2026-09-21 在各自 `main` 跟进该契约；`olap` 仍钉在 `ref 7096c873`（v3 时代）。
- **宿主移除 `ensure_session_database` / `set_active_database`** 及 12 处调用点；`SchemaCache` 键纳入 schema，空列集不再写入也不再返回。

### 🚀 新功能（Added）

#### 可视化查询构建器

- **三区布局** 全新 Query Builder：Navicat 式子句列表 + 字段选项弹窗 + HAVING，画布原生滚动，`Ctrl`/`Cmd` + 滚轮缩放。
- **拖拽建 JOIN**：点列到列手动连线，连线锚定到具体列；复合外键按「一对表只连一条」归一化。
- **外键自动推断**：仅从元数据推断外键，**默认关闭**，编辑器与构建器共用同一份推断结果；ER 图也接入同一开关。
- **方言适配**：`DatabaseTypeMeta.qbTypeCategories` 描述每种类型的可用操作符（如 `LIKE` 仅对文本/二进制列开放），宿主侧有兜底。

#### 数据库隧道

- **HTTP/HTTPS CONNECT 与 WebSocket 隧道**，本地 loopback 端口转发，覆盖三大云数据库代理场景。
- **SavedTunnel 持久化**：隧道引用在导出时物化，凭据走 AES-256-GCM 加密存储；连接表单可配置隧道来源。
- **设置窗口统一管理已保存隧道**，隧道来源三态状态机闭环。
- 中继链路集成测试 + 上游探测（代理/WS），转发器随句柄 drop 中止。

#### Redis 工作台重做

- **Key 写入语义**：`SET ... KEEPTTL`、绝对过期 `EXPIREAT`，`set_string` 增加 `keepTtl` / `expireAt` 参数。
- **压缩值查看**：gzip / zlib / raw-deflate / base64 / none 编解码器，字符串值可解压查看，JSON 美化。
- **Key 浏览**：TYPE 过滤、树形/扁平视图切换、`MEMORY USAGE` 开关、命名空间树、SCAN 游标与层级保持刷新。
- **面板重组**：Console 结构化结果 + fail-closed 危险分类、Slowlog 提升为一级 Tab、Pub/Sub 增强（订阅列表/统计/搜索）、独立连接的实时 MONITOR 面板。
- **观测组件**：`memory_usage_key`、INFO 搜索过滤面板，Cluster / Sentinel 模式感知的服务端行与拓扑指标。
- **集群寻址修正**：探测命令按槽位显式寻址，大 key 字段读改为每键一次寻址批次。

#### AI

- **会话隔离** + **NL2SQL 流式预览** + 展示修正。
- **可取消**：新增 `AiError::Cancelled`、`StreamChunk.cancelled`、`CompletionRequest.cancel_token`、`CancellationRegistry`，覆盖 SSE 中断与 Tool Loop 守卫。
- **egress 汇总**：`egress_summary` StreamChunk + 协议升级，暴露用量/测试面。
- 宿主持有的 Redis 键值事实接入 AI 助手。

### 🔧 改进（Changed）

- **全量语言包补齐**：9 个宿主语言包（de / es / fr / ja / ko / pt-BR / ru / zh-CN / zh-TW）与 9 个 Redis 驱动语言包全部对齐 `en.ts`——宿主侧补 172 个缺失 key、删除 20 个已废弃 key，Redis 驱动侧补 247 个缺失 key。占位符一致性逐 key 校验（0 失配）。隧道、可视化查询构建器、对象树等本版新术语已在全部语言中统一落地，并顺带修正了一批既有误译（如 de `newConn.host` 误作「Gastgeber」、es `settings.logging` 误作「Explotación florestal」、pt-BR `workflows.form.condition` 误作「Doença」）。
- **驱动 ↔ 宿主解耦**：新增边界护栏（宿主 src、驱动内部、`setLocale`）并接入 CI；驱动不再引用宿主 `src/lib/cn`，统一从 `@datazen/ui` 导入。
- **驱动 locale 包自注册**进共享 i18n 登记表，并在 `i18n-sync-check` 中纳入校验。
- **LIMIT/OFFSET 改为驱动自主声明**（`supports_offset()` 语义收敛），宿主不再硬编码。
- Redis 驱动按职责拆分为 `driver/` / `value/` / `commands/` / `ops/` / `tree/` / `stream/` / `workbench/` 模块树，移除 `include!` 反模式。
- AI Prompt 解析异步化，补充 PG / MySQL / SQLite 方言提示。

### 🐛 修复（Fixed）

- **多库 workflow 未指定 database（重要）**：用户在多库连接上建 workflow 时，界面标注「必填」的 database 实际并未强制——`validateWorkflowFields` 只校验 id/name/steps，可视化模式有拦截但 **YAML 模式与 AI 生成面板没有**，workflow 因此得以保存。运行时三处（step / workflow / connection）都没配时，驱动静默回落到内置默认（PostgreSQL 在 `resolve_connect_database` 硬编码 `"postgres"`），用户最终只看到误导性的 `relation "..." does not exist`。
  - 三条编辑路径（可视化 / YAML / AI）统一走同一校验，缺库时直接指出 `steps[N].database`。
  - command step 此前拿不到 workflow 级 database（`WorkflowStep::Command` 在 Rust 侧无 `database` 字段，目标库在 `input.database`），现已补齐继承，step 自身显式值仍优先。
  - 运行时改为报明确的 `MissingDatabase`，指明 step、connection 与三个可设置位置。
  - 该校验**只对多库驱动生效**：新增 trait 方法 `has_multi_database()`（默认 `false`，与既有 `has_schema_level()` 同构，不破坏任何外部驱动），在声明 `hasMultiDatabase: true` 的 postgres / mysql / sqlserver / clickhouse / mongodb 中覆写为 `true`。SQLite 等单库驱动行为不变。
  - 附带修复：表单为 command step 提供的 database 下拉框此前在 `workflowDraftToDefinition` 中被直接丢弃，YAML 侧又写成 serde 忽略的平铺键——选了不起作用。
- **PostgreSQL 流式查询读错库**：`query_stream` 在准备阶段即快照会话默认连接池，即使调用方指定了 target database，语句仍从默认库取数且不报错。现按目标库重新解析并装回执行记录；事务仍绑定其原库，传入外部 target 直接拒绝。
- **表右键菜单缺少「打开结构」**：navigator 未设置 `showOpenStructure`，该入口一直缺失。改由宿主通过 `ConnectionViewActions.openTableStructure` 显式暴露（可选成员，插件无需同步改动）。
- **BUG-003 SchemaCache 污染（重要）**：先打开 ER 图会读取非当前会话的数据库并切换共享会话，随后把**零列结果**以 300s TTL 写进 `SchemaCache`。此后所有读取都命中被污染的条目——网格行数正确但单元格为空、结构视图无列、ER 图表格无列。随 v4 契约一并根治。
- **MySQL SQL 字面量反斜杠转义缺失**（注入风险），并补充双引号转义以兼容 Navicat。
- 切换到从未打开过的连接时，不再沿用上一个连接的面板状态（表数据状态改为按面板而非按连接隔离）。
- Redis 字面量检索由精确键匹配改为按前缀搜索。
- 写入语句后丢弃已缓存的表数据；表切换时确保列元数据已加载。
- i18n 补齐 25 条「代码在用、词典里没有」的 key，并加入守卫防回归。

### 🧪 测试（Testing）

- 新增 / 修复 133 个测试提交：Redis 键树契约对齐、Visual Query Builder journey（连续击键状态机 + 残缺中间态）、QB 回归矩阵。
- 修复 9 个 spec 的陈旧会话等待与一次性树断言，以及 7 个失败 spec 的根因（改为修测试而非改断言掩盖）。
- 消除了全部 57 条未使用导入告警。

---

## [0.2.1] - 2026-09-17

> 自 v0.2.0 以来累计 **627** 次提交。本节为按 Git 历史回溯补记。

### 🚀 新功能（Added）

- **SQL 编辑器 Pro 扩展**：EP 热插拔运行时 + CodeMirror Compartment 动态重组；签名验证门禁与 `.dzx` 打包工具，Release 自动上传扩展。
- **Schema 迁移能力契约**：`SchemaMigrationRenderer` / `SchemaMigrationCapabilities` 驱动侧方言渲染，可取消的 DDL 部署任务（共享 Job Registry），建表迁移操作。
- **同族类型归一化**：驱动级 `TypeNormalizer` 供同族类型比较。
- **Workflow / Dashboard**：Dashboard 首次执行辅助、Widget 创建后自动执行。
- **对象树**：`ObjectKind::Table` / `View` 支持 `object_ddl_sql`。
- **连接表单** 新增独立 `domain` 字段。
- 官网 SEO：双语博客系统（12 篇）。

### 🔧 改进（Changed）

- 扩展点中的 statement range 合并，默认执行策略收敛。
- 补全表前缀偏好与统一提示 tooltip。
- 暗色主题全面翻新 + UI 打磨。

### 🐛 修复（Fixed）

- 修复 `CONFIG_ID` 术语遗留、深层评审 Wave 1 / Wave 2 全部 12 条轨道的遗留缺陷。
- Pro 扩展配置与翻译在发布构建中的固定（`fix(release)`）。

> 更细的逐条变更请查阅 v0.2.1 的 Git 历史与 `docs/release-notes/v0.2.1-github.md`。

---

## [0.2.0] - 2026-09-13

> 自 v0.1.2 以来累计 **493** 次提交，涵盖功能新增、架构重构、质量加固与官网重塑。

### ⚠️ 破坏性变更（Breaking Changes）

- **MCP DB 工具入参改名**：所有数据库工具（`list_databases`、`list_tables`、`search_tables`、`query`、`get_schema`、`explain_query`、`describe_table` 等）的参数 `config_id` → `connection_id`，旧键名会被直接拒绝（deserialize 失败），无别名回退。
- **MCP 资源输出与模板改名**：Schema 资源 URI 模板为 `datazen://schema/{connectionId}/{database}`；`datazen://query-history` 条目 JSON 字段 `configId` → `connectionId`。
- **SQLite 历史库列名改名**：`history.sqlite` 中 `query_history.config_id` / `favorite_queries.config_id` → `connection_id`。应用启动时自动执行一次性迁移（schema v3 → v4），数据完整保留。
- **Schema Diff 剪贴板/配置 JSON 升级到 v2**：导出格式键 `configId` → `sourceConnectionId` / `targetConnectionId`（`version: 2`）。v1 格式导入会被明确拒绝。
- **数据同步任务持久化字段改名**：`sourceConfigId/targetConfigId` → `sourceDbSessionId/targetDbSessionId` + `sourceConnectionId/targetConnectionId`。旧字段名的持久化载荷将无法反序列化。
- **插件桥协议键改名**：`command.invoke` 消息参数 `configId` → `connection_id`；无别名回退。
- **命名空间重构**：`Extension` / `Plugin` → `Wapp`（Workspace App）/ `Driver`；`app-sdk` → `wapp-sdk`；`nav.connections` → `nav.databases`。

### 🚀 新功能（Added）

#### 首次运行引导向导

- 全新 **Onboarding Wizard**：首次启动时提供 3 步引导流程（连接数据库 → 探索 AI → 开始使用），内置示例 SQLite 数据库自动初始化。
- 向导支持 8 种语言（en, zh-CN, ja, ko, es, fr, de, pt），含状态机持久化，中断后可恢复。
- 连接工作区空状态引导：未连接时提供快速操作入口和示例查询一键打开。

#### SQL 编辑器增强

- **4 模式精准执行策略**：Run Current（当前语句，默认）/ Run Selection / Run All / Ask（每次询问），通过工具栏下拉选择器切换。
- **SQL Snippets 管理**：设置页新增代码片段管理卡片，支持自定义片段并通过 CodeMirror 补全扩展热插拔注入。
- **Paste as IN 批量导入**（`Mod+Shift+V`）：将多行文本自动转为 `IN ('a', 'b')` 格式。
- **Pro 扩展热插拔**：SQL Editor Pro 扩展通过 Extension Points 机制运行时加载，CodeMirror Compartment 动态重组。
- **危险执行确认**：新增 `confirmDangerousExecution` 设置项，识别无 WHERE 的 UPDATE/DELETE 时强制红色弹窗二次确认。
- **未赋值占位符拦截**：当 SQL 中含 `:param` 或 `?` 占位符但未填值时，直接拦截执行，防止隐式 NULL。

#### Schema Diff 架构升级

- **DAG 拓扑排序**：基于外键依赖构建有向无环图，按 `主表创建 → 从表创建 → 外键关联 → 索引` 严格顺序生成 DDL。
- **Driver API 迁移渲染**：Schema Diff 通过 `SchemaMigrationRenderer` trait 委托驱动层渲染方言特定 DDL，移除旧版方言模块。
- **MySQL 跨方言类型建议** + **索引前缀处理**。
- **可取消部署任务**：通过共享 Job Registry 支持 DDL 部署取消。

#### Extension Points（扩展点）体系

- **EP 核心运行时**：Extension Points 框架支持热插拔挂载、CodeMirror Compartment 动态重组。
- **EP 签名验证门禁**：`.dzx` 扩展包支持签名验证，防止未授权篡改。
- **EP 打包与发布**：`pack-ep.mjs` 打包脚本，GitHub Actions 自动上传 `.dzx` 到 Release。
- **Pro 扩展预构建快速通道**：CI 支持从 Pro 仓库下载预构建 tarball，避免源码编译。

#### Driver API 扩展

- 新增 `ObjectKind::Table` / `ObjectKind::View` 支持 `object_ddl_sql`。
- 新增 `SchemaMigrationCapabilities` 和 `SchemaMigrationRenderer` trait，驱动层可声明支持的迁移操作类型。
- 各驱动（PostgreSQL、MySQL、SQLite）实现迁移渲染器并暴露迁移能力。
- `effective_primary_keys` 移入 `TableSchema`，`get_columns` 和 `table_to_ir` 统一使用。

#### 连接工作区

- 可折叠的最近连接分区。
- 双模式侧边栏（导航/查询模式切换）。
- 集成引导栏，自动打开示例查询。

#### 安全加固

- IPC 错误 Payload 自动脱敏：密码、Token、本地文件绝对路径由正则星号模糊化。
- 导入连接配置时拒绝覆盖 `.key` 文件（除非显式 opt-in）。
- SQL Guard 增强：只读/安全模式下，注释中的写操作动词也被正确识别。

#### CI/CD 与构建

- `--edition` 与 `--drivers` 参数可同时使用，支持 `tauri:build` 和 `tauri:dev`。
- GitHub Actions 构建矩阵支持 Basic / All / Akulaku 三种变体。
- CI 入口新增 `workflow_dispatch`，支持手动触发。
- macOS bash 3.2 兼容性修复。

#### i18n 国际化

- 拆分为 **领域包（Domain Packs）** 架构：core、connection、schema、query、settings、sync、transfer、dashboard、ai、chart、backup、mcp、workflows、schemaDiff。
- `useLocaleDomains` Hook 实现子窗口按需惰性加载，减少首屏 JS 体积。
- 全端 8 语言翻译同步完成。

#### 官网重塑

- 全站去 AI 味：下载卡重构、按钮实心化、移除 emoji。
- Hero 区域重写、场景卡片、对比表升级、Demo 流程扩展。
- SEO 结构化数据、博客文章、Mid-page CTA。

### 🔧 改进（Changed）

- 全端 ID 术语统一：`connectionId`（持久化配置）/ `dbSessionId`（运行时会话），MCP、Workflow、IPC 全面对齐。
- Query Toolbar 重构为 4 个功能区 + 溢出菜单。
- 暗色主题全面刷新 + 亮色主题 Token 微调。
- `Badge` 组件统一使用 `tone` prop。
- `prettier@3.6.2` 锁定为 devDependency，移除 dlx pre-commit hook。

### 🐛 修复（Fixed）

- E2E 稳定性：滚动锁轮询、右键菜单抑制、表选择重试、并行隔离（每 worker 独立 PG 库）。
- 平台键盘快捷键对齐（Cmd vs Ctrl）。
- CSP 允许 `asset:` 协议以支持 Pro 扩展加载。
- 导航器右键菜单：Schema 根节点不再传递给 `switchDatabase`，Copy-DDL 固定到表所属数据库。
- 连接标签关闭：删除数据库/表后自动关闭对应标签。
- SQL 语法主题颜色应用到编辑器。
- Dashboard 图表配置在添加 SQL 时正确携带。
- Databases 标签截断防止与工具栏按钮重叠。
- 查询工具栏滚动条隐藏。
- 结果集 Tab 列表水平滚动（隐藏滚动条）。
- Schema Diff：MySQL/PostgreSQL/SQLite 迁移能力对齐、拒绝不安全的空值渲染。
- Driver API：SQL Server 对象 DDL 标识符引用转义、`parse_type_parts` 保留数组括号。
- 连接池泄漏修复：错误路径关闭连接池。

### 🧪 测试（Testing）

- Journey Test 体系建立：连续状态机测试覆盖关键交互路径。
- E2E 并行化：分组并行脚本 + 每 worker 独立数据库隔离。
- Onboarding 全流程 E2E（正常 + 异常 + 边界场景）。
- Schema Diff 迁移渲染器能力测试（PostgreSQL、MySQL、SQLite）。
- EP 签名验证集成测试 + Pro 打包管道验证。
- Settings Snippets 生命周期 Journey Test。
- UI 语义 Token 迁移回归测试。

### 📦 架构重构（Refactoring）

- **Plugin/Extension → Wapp/Driver 命名迁移**：移除旧版兼容层，统一术语。
- **Schema Diff 重构**：移除旧版方言模块，通过 Driver API `SchemaMigrationRenderer` trait 委托渲染。
- **前端模块拆分**：大型 Store 和组件按职责拆分为高内聚、低耦合子模块。
- **AI Prompt 模板**：从 `.txt` 迁移到 `.markdown`，统一 PromptResolver 优先级。
- **i18n 领域包拆分**：从单一大文件拆分为 14 个领域包 + 惰性加载。

---

## [0.1.2] - 2026-08-XX

_（v0.1.x 版本变更记录请参阅 Git 历史）_

---

## [0.1.0] - 2026-07-XX

_（初始发布版本）_
