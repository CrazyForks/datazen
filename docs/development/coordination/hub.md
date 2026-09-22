# 数据迁移三件套协调总览

范围：DataZen 的 **Data Sync、Data Transfer、Schema Diff**。本文件只记录该功能的已合入能力与尚存缺口；不包含 AI、查询构建器、Redis 或其他产品工作。

最后核对：2026-09-22。集成分支：`codex/migration-navicat`。

## 核对依据

- 集成分支最近的功能合并：Schema Diff view、foreign key、target-only table、CHECK、table options、routine/trigger；Data Sync immutable plan、snapshot、ComparisonStore、disk index、conflict policy、row ranges、cross-page selection；Data Transfer immutable plan、SQL-file target、cross-dialect target、structure dependencies、recordset、profiles。
- 代码入口：`packages/driver-api/src/schema_migration.rs`、`packages/driver-api/src/schema_objects.rs`、`src-tauri/src/schema_diff/objects.rs`、`src-tauri/src/commands/sync/comparison_store.rs`、`src-tauri/src/data_transfer/model.rs` 与 `recordset.rs`。
- 最近完整 Host Rust 回归：1654 通过、3 忽略；routine/trigger 合并后的 focused Schema Diff：105 通过。

## 已合入能力

- 三件套均使用服务端不可变计划、一次性执行、目标快照校验、只读/自目标保护和可审查 SQL。
- Data Sync 已有快照读取、精确键契约、过滤、分页、跨页选择、ComparisonStore/disk index、abort/skip/force 冲突策略、配置文件、运行历史和 Workflow 执行。
- Data Transfer 已有无损值路径、过滤、单列 recordset、表/字段映射、SQL 文件原子发布、目标方言/命名空间、UTF-8/UTF-8 BOM、结构依赖和配置文件。
- Schema Diff 已有目标专属表选择、CHECK、MySQL/MariaDB 的表注释/engine/charset、同方言 view、PostgreSQL/MySQL 的 routine/trigger，以及精确 overload/attached-relation 身份。

## 当前未完成轨道

### PostgreSQL sequence 迁移

- 工作区：`.worktrees/datazen-migration-sequence`；分支：`feature/migration-sequence`。
- 状态：有未提交的 IR 初稿，尚未完成、测试、独立复测或合入。
- 代码证据：`schema_objects.rs` 已能列出和读取 PostgreSQL sequence DDL，`packages/drivers/postgres/src/catalog.rs` 已有创建 sequence 的辅助函数；但集成分支的 `MigrationOperation` 没有 sequence 变体，`schema_diff/objects.rs` 也没有 sequence 计划器或 renderer 路径。

## 剩余工作项

### Schema Diff

1. 完成 PostgreSQL sequence 的 create/replace/drop、精确 catalog identity、destructive approval、reviewed snapshot、rollback 和真实数据库旅程；同时处理 PostgreSQL identity/auto-increment 变化目前要求 sequence metadata 的缺口。
2. 为 `ObjectKind::Type` 增加迁移契约和 renderer。目录层已能列出 PostgreSQL/SQL Server type，但现有对象计划器只接受 view、function、procedure、trigger。
3. 建立跨方言 view/object 翻译器与能力契约。当前 view 及 routine/trigger 计划函数在源/目标方言不相同时直接拒绝执行。
4. 将对象迁移由分类的固定排序扩展为完整依赖图，覆盖表、FK、view、sequence、routine、trigger、type 的创建、替换和删除顺序与循环报告。
5. 实现 SQLite 需要 table rebuild 的变更路径，或在产品中完整呈现并处理不可回滚风险；当前 API 对这类操作明确返回不支持。
6. 扩展表级能力：collation、partition、compression 与其他可由目标驱动可靠表达的选项；现有已覆盖范围仅限 MySQL/MariaDB comment、engine、charset。
7. 补齐对象 catalog/DDL/renderer 的驱动矩阵。PostgreSQL、DuckDB、SQL Server 等已有部分 sequence/type catalog 查询，但不等于可迁移；MySQL/SQLite sequence 目前明确 fail closed。

### Data Sync

8. 将比较**生成**改为真正流式有界：当前 `ComparisonStore` 只在生成完成后把 `ComparisonResult` 写入内存或磁盘，并在 SQL/执行时可重建完整结果。
9. 让大计划的 SQL 预览和执行也按页/流读取 change index，避免 `ComparisonStore::load()` 为执行重新装入所有行。
10. 补齐大表故障恢复：进程异常后的临时索引回收、取消时的资源释放、磁盘损坏/容量上限与长时间比较的压测。
11. 扩展 Sync 的 recordset/selection 到复合键 tuple 范围、多表预设和经过证明的恢复点；仍需保持键序和 source/target 比较语义一致。
12. 增加冲突后的受控 recompare 旅程和能力提示：旧计划必须失效，新比较完成后才能再次执行。
13. 将稳定快照和精确键比较覆盖到更多已注册驱动及真实数据库数据类型/排序规则，并明确不支持的家族。

### Data Transfer

14. 实现经过证明的 checkpoint 或 idempotent resumability；现有 Transfer recordset 代码明确声明它不是 checkpoint，且不会保存 OFFSET。
15. 支持复合 tuple recordset 边界和经过验证的驱动专属范围语义；当前 `TransferRecordset` 只接受一个排序列和标量边界。
16. 扩展 SQL 文件编码。当前 `SqlFileEncoding` 只有 UTF-8 和 UTF-8 BOM；压缩、UTF-16、传统代码页及其无损字节/数值/JSON 验证尚未实现。
17. 扩展跨方言结构语义：target database/schema 创建、类型/表达式/identity/generated 列、索引和 FK 的逐项转换；不能证明等价时必须在预览中阻断或逐对象披露。
18. 让 Transfer 的批处理、取消与错误策略提供逐表已提交/回滚/未知统计，并验证 stop/continue 在事务边界上的实际行为。

### 产品验收与驱动范围

19. 审计三个窗口的完整用户旅程：配置变化使预览失效、返回步骤保留配置、跨页选择和 SQL 导出与同一个服务端计划绑定。
20. 建立并实现能力矩阵：PostgreSQL、MySQL/MariaDB、SQLite、SQL Server、DuckDB 等每个已注册驱动按 Sync、Transfer、Schema Diff 的具体能力测试；未注册的 Oracle、Snowflake 等必须先实现驱动。
21. 补齐真实 PostgreSQL/MySQL source→target 旅程，覆盖对象变更、字节/数值精度、冲突、取消、失败回滚和 stale plan；当前部分 fixture/只读凭据仍缺失。
22. 在 Windows 上验证 SQL 文件替换、桌面打包和 WebDriver 迁移旅程；macOS App/DMG 测试不能覆盖 Windows 文件替换语义。
23. 完成发布前验收：独立复测、故障注入、大表内存/性能基准、Host/driver/frontend/WebDriver 全量回归与安装包验证。

## 结论边界

- 上述项目来自提交历史和当前可执行/拒绝执行路径，不把文档中的历史“未开始”状态当作事实。
- 不存在可靠 driver capability、精确对象身份、目标快照或 rollback 信息时，必须 fail closed；在第 19–23 项完成前不能宣称已全面追平 Navicat。
