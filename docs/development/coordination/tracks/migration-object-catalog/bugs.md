# migration-object-catalog Bugs

## migration-object-catalog-BUG-001

- 状态：待修复
- 严重级别：P1（对象树虚拟列表无法稳定区分对象）
- 描述：`getUnifiedRowKey` 对 `UnifiedRow.type === 'object'` 只使用 `catId` 和 `obj.name`。同 schema/name 的 PostgreSQL routine overload，以及同名但 target schema/name 不同的 trigger，都会得到相同 React/virtualizer key。
- 重现步骤：
  1. 构造同一 `functions` category 下 `public.lookup(integer)` 与 `public.lookup(text)` 两个 object row。
  2. 分别调用 `getUnifiedRowKey(row, index)`。
  3. 构造同一 `triggers` category 下 `public.audit_trigger` 挂在 `public.orders` 与 `public.users` 的两个 object row，并分别调用 `getUnifiedRowKey`。
  4. 运行 `src/windows/connection/__tests__/ConnectionNavigatorTree.test.tsx` 中 `[tester] navigator object identity keys` 两条测试。
- 实测结果：routine 两行均为 `obj:functions:lookup`；trigger 两行均为 `obj:triggers:audit_trigger`。测试结果为 2 failed / 97 passed（该文件与 ObjectBrowser、usePanelHandlers 三文件合计 99 tests）。
- 影响范围：ConnectionNavigatorTree 的 TanStack virtualizer 复用重复 key，可能导致同名 overload/trigger 行复用、错误选中或错误操作目标；ObjectBrowser 自身的完整 identity key 已通过独立测试。
- 建议修复方向：navigator object row key 至少纳入 kind、schema、signature、targetSchema、targetName，并保持稳定且可序列化。

