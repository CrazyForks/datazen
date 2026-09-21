# Bugs

## migration-schema-profiles-BUG-001

- **级别**：P1
- **描述**：从不同端点加载 Schema Diff profile 时，profile 中的 `typeOverrides` 会在端点变更清理 effect 中被无条件清空，导致重新生成计划时不再传递用户确认的类型覆盖。
- **状态**：FIXED / READY_FOR_TEST
- **重现步骤**：
  1. 保存一个包含 `public.users.name -> VARCHAR(64)` 类型覆盖、`allowDestructive=true`、`includeIndexes=false` 的 profile。
  2. 在 Schema Diff 计划步骤切换到该 profile，并点击加载，使 source/target connection 或 database 与当前端点不同。
  3. 等待新的 source objects 检查完成，继续 Compare → Plan。
  4. 观察 `prepare_schema_diff_plan` 请求的 `typeOverrides`。
- **实测日志**：独立测试 `src/windows/schema-diff/__tests__/SchemaDiffProfileLoad.test.tsx` 失败。请求实际为：
  ```text
  tableNames: ["public.users"], allowDestructive: true, includeIndexes: false,
  typeOverrides: undefined
  ```
  期望为：
  ```text
  typeOverrides: [{ table: "public.users", column: "name", targetType: "VARCHAR(64)" }]
  ```
- **影响范围**：跨端点加载 profile 后，用户的类型映射被静默丢失，跨方言或需要显式类型覆盖的 Schema Diff 计划可能生成错误 DDL；保存到 profile 的覆盖配置无法兑现。
- **定位线索**：`src/windows/schema-diff/SchemaDiffWindow.tsx` 端点变化清理 effect（约 132–139 行）调用 `setTypeOverrides([])`；`handleLoadProfile` 先设置 profile 覆盖，随后端点更新触发该清理。

- **修复**：profile 加载期间保留端点 transition 标记，端点变化清理 effect 仅清理普通手动切换；profile 端点匹配并完成 fresh inspect 后恢复普通清理行为。
- **回归测试**：`src/windows/schema-diff/__tests__/SchemaDiffProfileLoad.test.tsx` 验证跨端点加载后 `preparePlan` 仍收到 `typeOverrides`。
- **存储测试隔离**：加密 profile 往返测试使用 `FileKeyringGuard` 覆盖整个测试生命周期，避免并发测试修改 `DATAZEN_KEYRING` 后导致 fresh store 无法解密而错误返回空 profile。
