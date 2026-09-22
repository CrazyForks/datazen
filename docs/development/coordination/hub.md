# 数据迁移三件套协调总览

范围：DataZen 的 **Data Sync、Data Transfer、Schema Diff**，目标是在已注册驱动范围内追平 Navicat 的迁移能力，并以服务端不可变计划、精确对象身份和可验证执行为基础。本总览不包含 AI、查询构建器、Redis 或其他产品轨道。

最后更新：2026-09-22。集成分支：`codex/migration-navicat`。

## 已集成且验证完成

- 三件套统一的服务端不可变计划、一次性执行、目标快照校验、只读/自目标保护、可审查 SQL 与失败状态。
- Data Sync：精确主键契约、过滤条件、单列稳定 recordset、快照读取、分页与跨页选择、磁盘索引、冲突的 abort/skip/force 策略、任务安全持久化、配置文件、运行历史和 Workflow 执行。
- Data Transfer：无损值导出、过滤/recordset、表和字段映射、SQL 文件目标及原子发布、目标方言/命名空间/UTF-8 编码选择、表/索引/外键顺序、可复用配置文件。
- Schema Diff：目标专属表选择、CHECK 约束、MySQL/MariaDB 表注释/engine/charset、同方言 PostgreSQL/MySQL 视图、PostgreSQL/MySQL routine 和 trigger 的创建、替换、受确认删除，以及精确的 overload/attached-relation 身份验证。
- 最近完整 Host Rust 回归：1654 通过，3 忽略；routine/trigger 合并后的 focused Schema Diff：105 通过。

## 当前轨道

### Schema Diff PostgreSQL sequence 迁移

- 工作区：`.worktrees/datazen-migration-sequence`
- 分支：`feature/migration-sequence`
- 状态：实现中，尚未独立测试或合入。
- 目标：仅 PostgreSQL 同方言的 sequence create/replace/drop、精确 selector 身份、服务端 catalog DDL、destructive confirmation、reviewed snapshot 与 rollback。MySQL、SQLite、未支持驱动和跨方言一律 fail closed。

## 剩余任务

### Schema Diff

1. 完成并独立复测、合入 PostgreSQL sequence 迁移；补齐 live PostgreSQL create/replace/drop 旅程。
2. 为未覆盖的序列、视图、routine、trigger 和其他 schema object 建立驱动能力矩阵；支持者实现迁移，不支持者在比较阶段给出明确原因。
3. 实现跨方言视图及其他对象的翻译契约；不可证明等价的定义必须逐对象阻断并说明原因。
4. 扩展对象依赖图，覆盖表、索引、外键、视图、序列、routine、trigger 等对象的创建、替换和删除顺序。
5. 补齐表级 collation、partition、compression 等选项；实现 SQLite 必须重建表时的安全迁移和回滚/不可回滚提示。
6. 扩展已注册驱动中的 Schema Diff catalog、snapshot 和 renderer 覆盖，并为新增数据库驱动实现相同能力。

### Data Sync

7. 将比较生成改为真正有界的流式过程：当前索引文件只避免分页时反序列化全部结果，比较引擎仍会先构建完整结果。
8. 完成崩溃后的私有比较索引清理与恢复策略，并用大表、取消和损坏索引故障注入验证资源上限。
9. 将稳定快照扩展到仍缺失的驱动/元数据路径；明确并消除临时连接枚举与单次 compare 生命周期限制。
10. 提供自动重新比较工作流；冲突后只允许用户显式 recompare，再基于新计划执行，不能复用旧行状态。
11. 扩展 Sync recordset：复合主键 tuple 边界、非键排序的可证明稳定语义、多表预设和经过验证的恢复检查点。
12. 补齐大规模选择体验：多表一键范围选择、全部筛选差异的计数/状态，以及不随比较行数增长的前端内存。

### Data Transfer

13. 提供可验证的 checkpoint/idempotent resumability、取消后的逐表已提交/回滚/未知统计，以及批处理的 stop/continue 策略。
14. 扩展 recordset 到复合 tuple 范围和驱动专属安全语法，并补齐真实数据库的分页/边界验证。
15. 扩展 SQL 文件输出：压缩、UTF-16/传统代码页等明确编码策略；每种编码都要验证二进制、decimal、日期、JSON 与字符串的无损表示。
16. 扩展目标命名空间与数据库/schema 创建策略；跨方言的名称、类型、表达式、索引/外键语义必须逐项映射或阻断。
17. 完成更广泛的结构与对象保留：generated/identity 列、默认值、checks、索引、外键以及驱动支持的对象元数据；跨族丢失需在预览中逐对象显示并要求确认或阻断。
18. 补齐 SQL 文件和数据库目标的配置共享/加密策略、历史审计及 unattended destructive policy 的端到端旅程。

### 共同产品与发布验证

19. 审计三个窗口的完整旅程：返回步骤时保留端点/映射/过滤；输入变化立即使预览和选择失效；跨页选择、SQL 导出、profile/run history 均使用同一后端计划。
20. 建立能力驱动的产品矩阵，覆盖 PostgreSQL、MySQL/MariaDB、SQLite、Redis 及已注册的其他驱动；Oracle、Snowflake 等未注册驱动必须先实现驱动后才能纳入“已支持”。
21. 运行真实 PostgreSQL/MySQL source→target 旅程，包括字节/数值精度、schema/object 变化、冲突、取消、失败回滚和 stale-plan；当前缺失的 fixture/只读凭据需补齐。
22. 在 Windows 上运行 SQL 文件原子替换、桌面打包与 WebDriver 迁移旅程；macOS 验证不能替代 Windows 行为。
23. 完成最终验收：每项能力的独立复测、故障注入、可测量覆盖率、大表内存/性能基准、全量 Host/driver/frontend/WebDriver 回归和发布包验证。

## 约束

- 未完成任务不应通过“默认支持”或客户端 SQL 绕过；缺少可靠 driver capability、身份、快照或 rollback 信息时必须 fail closed。
- 真实数据库旅程、Windows 验证和新增驱动实现没有完成前，不能宣称产品已全面追平 Navicat。
- 用户主检出不用于此功能开发；开发仅在隔离 worktree 中进行。
