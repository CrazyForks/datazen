# migration-schema-unified-planner-BUG-001 · Imported config keeps a reviewed plan after database or schema changes

- **严重度**：P2
- **状态**：待复测
- **涉及文件**：`src/windows/schema-diff/useSchemaDiffSavedSetups.ts` (`shouldPreserveEndpointChange`); `src/windows/schema-diff/SchemaDiffWindow.tsx` (endpoint-change invalidation); `src/windows/schema-diff/__tests__/SchemaDiffWizard.test.tsx`
- **描述**：导入 Schema Diff JSON 配置后，`configLoadEndpointRef` 保存配置对象，但只用 source/target connection ID 判断 endpoint 是否匹配；一旦匹配，该 ref 不会清空。此后用户在相同连接下切换 source/target database 或 schema 时，`shouldPreserveEndpointChange()` 仍返回 `true`，导致 `SchemaDiffWindow` 跳过清除旧 plan、diff 与 deploy result。审阅 SQL 和后续 deploy 导航因此继续使用基于旧数据库/Schema 的计划。
- **重现步骤**：
  1. 在 Schema Diff 中导入 version 2 配置（source/target connection ID 与当前相同，选择至少一张表）。
  2. 基于导入的选择生成 reviewed plan。
  3. 保持连接不变，将 target database 或 source/target schema 切换到另一值。
  4. 观察旧 plan 的 Copy SQL 操作仍可用，证明 endpoint 变更没有使审阅计划失效。
- **实测错误日志与影响范围**：独立回归测试 `SchemaDiffWizard.test.tsx > [tester] clears a reviewed plan after changing database following config import` 失败：预期 `schema-diff-copy-sql` 控件被移除，实测仍在 DOM 中。UI 仍展示旧 SQL/plan；后端是否会拒绝对不同数据库的部署不在此 UI 子片中验证。

## 修复记录（round-1）

- `configLoadEndpointRef` 现在保存导入时的完整 source/target endpoint identity：connection ID、database 与 schema。endpoint 保留只在待应用导入连接切换或六项身份完全匹配时发生；完整身份匹配后 ref 即清空，后续 database/schema 变化会走现有失效逻辑，清除旧 plan、diff 和 deploy result。
- 扩展独立回归测试，覆盖相同 connection ID 下修改 target database、source schema、target schema，均断言 reviewed plan 的 Copy SQL 控件移除。
- 自验：`SchemaDiffWizard.test.tsx` 18/18 通过；`pnpm exec tsc --noEmit`、定向 Prettier 检查与 `git diff --check` 通过。状态交回独立 Tester 复测。
