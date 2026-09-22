# 数据迁移三件套协调总览

范围：DataZen 的 **Data Sync、Data Transfer、Schema Diff**。本文件只记录该功能的已合入能力与尚存缺口；不包含 AI、查询构建器、Redis 或其他产品工作。

最后核对：2026-09-22。集成分支：`codex/migration-navicat`。

## 核对依据

- 集成分支已合入 Schema Diff view、foreign key、target-only table、CHECK、table options、routine/trigger、PostgreSQL sequence；Data Sync immutable plan、snapshot、流式 ComparisonStore、disk index、conflict policy、row ranges、cross-page selection；Data Transfer immutable plan、SQL-file target、cross-dialect target、structure dependencies、recordset、profiles、编码与压缩。
- 代码入口：`packages/driver-api/src/schema_migration.rs`、`packages/driver-api/src/schema_objects.rs`、`src-tauri/src/schema_diff/objects.rs`、`src-tauri/src/commands/sync/comparison_store.rs`、`src-tauri/src/data_transfer/model.rs` 与 `recordset.rs`。
- 合并后的 focused 回归：Schema Diff 110、Data Sync 129 + commands/sync 58；前端定向套件 14 个文件 / 121 个测试通过。最近完整 Host Rust 基线为 1654 通过、3 忽略。

## 已合入能力

- 三件套均使用服务端不可变计划、一次性执行、目标快照校验、只读/自目标保护和可审查 SQL。
- Data Sync 已有快照读取、精确键契约、过滤、分页、跨页选择、abort/skip/force 冲突策略、配置文件、运行历史和 Workflow 执行。比较生成通过流式 sink 写入有界的私有 framed store；manifest 会校验行帧、索引、insert/update/delete/unchanged 计数，损坏时对 summary/page/load 一致 fail-closed。
- Data Transfer 已有无损值路径、过滤、单列 recordset、表/字段映射、SQL 文件原子发布、目标方言/命名空间、UTF-8/UTF-8 BOM、UTF-16LE/BE、gzip、结构依赖和配置文件。
- Schema Diff 已有目标专属表选择、CHECK、MySQL/MariaDB 的表注释/engine/charset、同方言 view、PostgreSQL/MySQL 的 routine/trigger、PostgreSQL sequence，以及精确 overload/attached-relation 身份。

## 已完成的本轮轨道

- PostgreSQL sequence 已合入：IR、严格 quote_ident 身份校验、catalog DDL、create/replace/drop、目标快照、destructive gate、rollback 完整性和 replay/stale/cross-dialect fail-closed 均已覆盖。Replace 不再虚报可恢复 sequence counter；真实 PostgreSQL journey 仍待 R 环境。
- Data Sync bounded comparison 已合入：流式生成、私有磁盘索引、取消清理、页读取、manifest counter 篡改回归和 64 MiB full-load fail-closed 均已独立复测。
- Data Transfer SQL 文件编码与压缩已合入：UTF-16LE/BE、BOM、gzip、旧 profile 兼容和值回读均已独立复测；Windows 原生 picker/替换仍待 R 环境。

## 剩余工作项

### Schema Diff

1. 为 `ObjectKind::Type` 增加迁移契约和 renderer。目录层已能列出 PostgreSQL/SQL Server type，但现有对象计划器只接受 view、function、procedure、trigger、sequence。
2. 建立跨方言 view/object 翻译器与能力契约；当前 view 及 routine/trigger/sequence 计划函数在源/目标方言不相同时直接拒绝执行。
3. 将对象迁移由分类的固定排序扩展为完整依赖图，覆盖表、FK、view、sequence、routine、trigger、type 的创建、替换和删除顺序与循环报告。
4. 实现 SQLite 需要 table rebuild 的变更路径，或在产品中完整呈现并处理不可回滚风险；当前 API 对这类操作明确返回不支持。
5. 扩展表级能力：collation、partition、compression 与其他可由目标驱动可靠表达的选项；现有已覆盖范围仅限 MySQL/MariaDB comment、engine、charset。
6. 补齐对象 catalog/DDL/renderer 的驱动矩阵；MySQL/SQLite sequence 目前明确 fail closed，其他驱动的 catalog 能力不能直接视为可迁移。

### Data Sync

7. 让大计划的 SQL 预览和执行也按页/流读取 change index，避免 `ComparisonStore::load()` 为执行重新装入所有行；当前 64 MiB full-load ceiling 是明确的 P2 限制。
8. 补齐大表故障恢复：进程异常后的临时索引回收、磁盘容量上限与长时间比较压测；取消清理、帧/索引损坏 fail-closed 已覆盖。
9. 扩展 Sync 的 recordset/selection 到复合键 tuple 范围、多表预设和经过证明的恢复点；仍需保持键序和 source/target 比较语义一致。
10. 增加冲突后的受控 recompare 旅程和能力提示：旧计划必须失效，新比较完成后才能再次执行。
11. 将稳定快照和精确键比较覆盖到更多已注册驱动及真实数据库数据类型/排序规则，并明确不支持的家族。

### Data Transfer

12. 实现经过证明的 checkpoint 或 idempotent resumability；现有 Transfer recordset 代码明确声明它不是 checkpoint，且不会保存 OFFSET。
13. 支持复合 tuple recordset 边界和经过验证的驱动专属范围语义；当前 `TransferRecordset` 只接受一个排序列和标量边界。
14. 扩展跨方言结构语义：target database/schema 创建、类型/表达式/identity/generated 列、索引和 FK 的逐项转换；不能证明等价时必须在预览中阻断或逐对象披露。
15. 让 Transfer 的批处理、取消与错误策略提供逐表已提交/回滚/未知统计，并验证 stop/continue 在事务边界上的实际行为。

### 产品验收与驱动范围

16. 审计三个窗口的完整用户旅程：配置变化使预览失效、返回步骤保留配置、跨页选择和 SQL 导出与同一个服务端计划绑定。
17. 建立并实现能力矩阵：PostgreSQL、MySQL/MariaDB、SQLite、SQL Server、DuckDB 等每个已注册驱动按 Sync、Transfer、Schema Diff 的具体能力测试；未注册的 Oracle、Snowflake 等必须先实现驱动。
18. 补齐真实 PostgreSQL/MySQL source→target 旅程，覆盖对象变更、字节/数值精度、冲突、取消、失败回滚和 stale plan；当前 fixture/只读凭据仍缺失。
19. 在 Windows 上验证 SQL 文件替换、桌面打包和 WebDriver 迁移旅程；macOS App/DMG 测试不能覆盖 Windows 文件替换语义。
20. 完成发布前验收：独立复测、故障注入、大表内存/性能基准、Host/driver/frontend/WebDriver 全量回归与安装包验证。

## 结论边界

- 上述项目来自提交历史和当前可执行/拒绝执行路径，不把文档中的历史“未开始”状态当作事实。
- 不存在可靠 driver capability、精确对象身份、目标快照或 rollback 信息时，必须 fail closed；在第 16–20 项完成前不能宣称已全面追平 Navicat。
