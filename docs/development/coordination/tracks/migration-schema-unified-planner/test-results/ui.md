# Schema Unified Planner UI 子片独立验收

- **判定**：`TEST_FAILED`（仅 UI 子片）。全轨仍需 Host/driver 集成和 WDIO 验收。
- **交接基线**：`feature/migration-schema-unified-ui`，编码提交 `bdd8cb79fe412b28311c46c50e1eb23bc7af2891`；开测时工作树干净。
- **Tester 提交**：BUG-001 单独提交为 `aa5ea1c2ad087d274d3e02d096d186bbae077f35`；新增覆盖测试与本文档另行提交。
- **环境**：当前 worktree 的 `node_modules` 是本地实体目录 `/Users/flyxl/code/datazen/.worktrees/datazen-migration-schema-unified-ui/node_modules`，不是指向 main checkout 的链接。

## 独立 Review

保存配置和 profile 的对象身份使用 kind、schema、name、routine signature 及 trigger target 信息；profile DTO 对旧记录使用 serde defaults，拒绝重复选择、未知 object kind、缺少 routine signature 或 trigger target 的配置。列表恢复以完整身份键匹配，不会把同名 overload 或挂在另一张表上的 trigger 误选。object-only profile 可保存和加载。

跨 dialect picker 保留导入/profile 中已有的对象选择，禁止新增跨 dialect 对象选择，提供清空动作，并在继续迁移前阻止未清空的对象；清空后 table-only 路径仍可继续。English 字典补充了相应提示和新向导步骤。一个轻微文案问题：`schemaDiff.profileSaveHint` 仍只说会保存 table selection，没有提到 schema object selection。

确认的缺陷见 [migration-schema-unified-planner-BUG-001.md](../bugs/migration-schema-unified-planner-BUG-001.md)：导入 config 后，`configLoadEndpointRef` 只用 connection ID 匹配，且在匹配后不清空。用户在相同连接下切换 database/schema 时，endpoint 变更清理逻辑仍会保留旧 reviewed plan；独立测试观察到旧 `schema-diff-copy-sql` 仍在 DOM 中。

当前 UI 分支的 Rust 源码中没有 `prepare_schema_unified_plan` handler，只有前端 IPC 调用，因此没有把模拟前端测试误报成 app journey，也没有使用 black-box-tester。**完整混合对象 app journey 留待集成 WDIO**：需在 Host unified IPC 合入后覆盖 PG/MySQL mixed-object plan、部署 readback 和 invalid-graph no-write 路径。

## 实测结果

- changed UI Vitest：2 个文件，21 passed、1 failed（BUG-001 回归断言）、0 skipped；失败断言预计 endpoint 切换后旧 Copy SQL 控件应移除，实测仍存在。
- 覆盖率复跑：排除已知失败的 BUG-001 回归用例，其他测试 21 passed、1 skipped。改动 TS 文件汇总为 **90.00% statements、80.36% branches、90.76% functions、92.70% lines**。核心 `useSchemaDiffSavedSetups.ts` 为 **85.15% statements、68.78% branches、96.29% functions、87.32% lines**；`useSchemaDiffUnifiedObjects.ts` 为 **98.63% statements、88.46% branches、100% functions、100% lines**。分支覆盖薄弱处主要是保存/导入/删除命令的错误分支，line coverage 总体超过 80%。
- `pnpm exec tsc --noEmit`：通过。
- `cargo test -p datazen --lib schema_diff::profile`：6 passed，0 failed。
- `cargo test -p datazen --lib store::schema_diff_profiles`：2 passed，0 failed。
- `cargo fmt --all --check`、全部改动 TS 文件的 Prettier 检查及 `git diff --check`：通过。
- `node scripts/generate-builtin-locales.mjs`：成功。非英文 locale 同步属于发布前工作，未在开发期改动其他语言包。

新增 Tester 用例覆盖：导入 config 后 database 变更必须使 reviewed plan 失效（BUG-001）；profile 对象身份在当前 catalog 缺失时显示提示；对象 catalog 权限错误在重试后清除；保存 profile 与导入 config 对话框可通过取消关闭。
