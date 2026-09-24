# 数据迁移三件套交付跟踪

范围：Data Sync、Data Transfer、Schema Diff。这里只记录这三项功能的实现状态、验证结果和发布门槛。

最后核对：2026-09-24。集成分支：`codex/migration-navicat`，HEAD `47b04a66`，`main` 已是祖先。最近合入的轨道：Data Sync 未知结果复核、ConnectionView 类型契约修复，以及 Data Transfer 未知结果 fencing（均由独立 Tester 验证）。

## 已交付能力

- 三个功能均使用服务端计划与审阅后的单次执行；执行前校验连接、目标状态或 schema，并对只读目标和无法证明安全的操作拒绝写入。
- Data Sync 支持同族数据库比较、私有磁盘比较存储、分页 review、跨页选择、过滤、冲突策略、配置文件、运行历史及真实 PostgreSQL/MySQL 执行。表级选择范围避免“全选”时把所有 row key 留在前端。
- Data Transfer 已支持参数化值传输、过滤与映射、跨方言目标、SQL 文件原子发布、结构依赖、recordset、profile、编码与压缩；恢复点位于已提交表边界。未知事务结果现以逐表 typed outcome fencing：确认提交/回滚/未知/未启动/部分应用分别呈现，未知结果会终止后续写入、隐藏未确认行数、消费旧计划并失效恢复令牌。
- Schema Diff 支持目标专属对象选择、CHECK、MySQL/MariaDB 表注释/engine/charset、同方言 view、PostgreSQL/MySQL routine 与 trigger、PostgreSQL sequence，以及 PostgreSQL enum/domain/composite/range 类型。没有可信身份、类型转换或 renderer 的操作继续 fail closed。
- MySQL CHECK catalog 解析会忽略字符串与注释中的伪匹配；MySQL 参数化写入和二进制 SQL 字面量、SQLite 参数化事务写入与 BLOB 读取均有驱动级覆盖。

## 已完成的发布验证

- Vitest：482 个文件、4,986 项通过。
- Host Rust：1,795 项通过、3 项环境测试忽略；Driver API、PostgreSQL、MySQL、SQLite crate 联合测试通过。
- 前端类型检查与生产构建通过；WDIO 构建生成可运行的 `DataZen.app`。构建随后只在 macOS DMG 阶段失败，依用户明确要求不作为本功能阻塞项，详见 `AGENTS.md`。
- Data Sync WDIO：4 个 spec、56 项通过；覆盖 PostgreSQL/MySQL 全旅程、执行后删除确认、并发写冲突回滚及真实数据库读回。
- Schema Diff WDIO：7 个 spec、38 项通过；覆盖 PostgreSQL/MySQL 双向结构部署、联合主键、复合索引、宽类型与 profile。
- Data Transfer WDIO：8 个 spec、40 项通过；覆盖 PG↔MySQL 宽数据真实传输、模式路径、类型映射与执行读回。
- 本轮在获准的本机 PostgreSQL/MySQL 上完成了真实数据库用例。Data Sync 删除旅程第一次随整套运行出现一次行数超时，单独重跑和之后完整 4-spec 套件均通过；测试超时现会报告实际观察到的行数，便于定位后续回归。
- Data Sync 未知提交结果复核：独立 WDIO Tester 的四个 PG/MySQL 场景通过，旧计划重放被拒，真实读回和刷新比较一致；无法确认结果时保留写入闸门。
- ConnectionView 集成修复：Host TypeScript 检查和 5 个聚焦 Vitest 文件（141 项）通过；`tauri:build:webdriver` 已生成 app binary 与 `DataZen.app`。未运行会删除固定表的连接菜单套件；DMG 阶段按用户要求排除。
- Data Transfer 未知结果 fencing：已合入 `47b04a66`。独立 Tester 在 fresh worktree 重建候选并通过 Rust 152/152、聚焦 Vitest 54/54、Host TSC，以及改动生产行覆盖率 420/491（85.54%）。四条串行 PG↔MySQL WDIO（真实 commit 后注入 acknowledgement loss、未知结果后停止写入、确认回滚后继续）全部通过；验证了数据库读回、history、plan/token 拒绝和连接配置清理。BUG-003/004 已修复并由独立 Tester 复测通过。故障 seam 仅在 debug webdriver build 注册，模拟的是实际 commit 成功后的确认丢失，不代表网络分区。
- 当前工作树执行 `git diff --check` 无空白错误；`main` 是集成分支祖先。此工作树的 `node_modules` 是本地目录，不链接主 checkout。

## 仍未达到完整 Navicat 能力的工作

### Schema Diff

1. 为跨方言 view、routine、trigger 和自定义类型提供可审查的语义转换；目前不能证明等价时会阻止执行。
2. 完成覆盖自定义类型、表、FK、view、sequence、routine、trigger 的依赖 DAG，包含替换、删除顺序和循环报告。
3. 实现 SQLite table rebuild 与完整风险/回滚处理；当前需要 rebuild 的变更会明确拒绝。
4. 扩充可靠表达的表选项和驱动对象目录能力，例如 collation、partition、compression，并给每个注册驱动建立实际可执行的能力矩阵。

### Data Sync

5. 取消当前比较结果约 10,000 个差异行 / 32 MiB 的硬上限；review 数据虽按页落盘读取，SQL 预览和执行仍会生成整个语句 `Vec`，超大迁移仍有大小限制与额外内存占用。
6. 为比较存储增加异常退出回收、容量/磁盘不足控制和长时间大表压力测试；正常取消与计划释放已清理临时文件，manifest 损坏会 fail closed。
7. 支持经过驱动排序契约证明的复合键 tuple 范围和恢复点，并把快照、排序与真实类型语义扩展至所有要声明支持的驱动。
8. 扩展 Sync 未知提交结果复核到全部声明支持的驱动和更复杂的恢复场景。PG/MySQL 主旅程已证明警告呈现、写入隔离、旧计划拒绝、真实读回与新比较；不确定结果仍不能直接重放。

### Data Transfer

9. 把表级 checkpoint 扩展到大表内有界 chunk；提交结果不确定时需要可靠幂等或恢复证明。
10. 支持复合 tuple recordset 边界和驱动专属排序语义；目前 recordset 只接受单一排序列和标量范围。
11. 补足异构结构迁移中的目标 database/schema、identity/generated 列、类型/表达式、索引和 FK 映射；不能证明等价的对象必须明确阻断。
### 发布范围与跨平台验收

12. 为所有注册驱动列出 Sync、Transfer、Schema Diff 的能力矩阵与对应测试；只有真实实现并通过验证的能力才能对外标为支持。
13. 扩展 PostgreSQL/MySQL 故障旅程，覆盖写入中取消、失败回滚、未知提交结果和 stale plan；现有真实旅程已验证确认回滚继续、未知结果 fencing、基本读写、类型、跨方言结构、只读和 stale schema。
14. 在 Windows 验证 SQL 文件 picker/原子替换、可运行包和迁移 WebDriver 旅程。当前环境是 macOS；DMG 阶段问题不属于本功能门槛。
15. 在解除上述能力限制后补齐大表内存/性能基准、驱动故障注入以及完整安装介质验证。

## 发布判断

已集成的三件套基础主旅程与 Data Sync/Transfer 未知结果 fencing 均通过 macOS 独立 WDIO 真实数据库验证；Transfer 的 BUG-003/004 已关闭。当前集成分支仍未达到发布标准：大表/有界恢复、异构结构语义、全驱动能力矩阵、Windows 验收及性能验证存在明确缺口，不能宣称追平完整 Navicat。对于缺乏可靠身份、类型、快照、事务或 rollback 证明的操作，继续 fail closed。
