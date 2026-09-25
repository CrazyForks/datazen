# Schema Unified Planner UI · BUG-001 独立复测（round 2）

- **判定**：PASS（UI 子片）。复测目标代码提交：`868e942abdafb45fb4acc85c11a8c8f2d45867e`。
- **范围**：验证导入配置后，同一 source/target connection ID 下切换 database 或 schema 会使已审阅计划失效；仅测试，不修改产品代码。
- **隔离**：在 `feature/migration-schema-unified-ui` worktree 执行；`node_modules` 为 worktree 内实体目录，不是 main checkout 的链接。

## Review 与行为结果

修复把配置导入时的 source/target endpoint 身份记录为 connection ID、database、schema 六项；只有身份完整匹配时才保留 endpoint 变更。任一 database/schema 改变都会进入既有清理逻辑，丢弃 plan、diff 与 deploy result。新增的独立回归断言在每种变化后旧 `schema-diff-copy-sql` 不再出现在页面中。

在保持 connection ID 为 `src` / `tgt` 的情况下，以下四项变化均通过：target database、source database、source schema、target schema。原请求中的 target database、source schema、target schema 三项全部覆盖；source database 也一并覆盖完整 identity。

## 实测

- Schema Diff UI：8 个测试文件、62/62 测试通过。
- `pnpm exec tsc --noEmit`：通过。
- `cargo test -p datazen --lib schema_diff::profile`：6/6 通过。
- `cargo test -p datazen --lib store::schema_diff_profiles`：2/2 通过。
- `cargo fmt --all --check`、改动 TS 文件 Prettier 检查、`git diff --check`：通过。
- `node scripts/generate-builtin-locales.mjs`：成功。
- `useSchemaDiffSavedSetups.ts` 全模块覆盖率：85.34% statements、70.32% branches、96.29% functions、87.44% lines。database/schema 失效回归均通过；模块整体 branch 覆盖低于 80%，未覆盖分支主要在其他保存/导入错误处理路径，不能据此声称整个模块各维度均达 80%。
- 未运行 WDIO：此 UI 分支尚无 unified-plan Host IPC handler；完整桌面旅程留给 Host 与 UI 集成后的全新 Tester。

复测未发现 BUG-001 残留或新增缺陷。按本轮简报要求，未修改共享 `progress.md`、BUG 文件或 README。
