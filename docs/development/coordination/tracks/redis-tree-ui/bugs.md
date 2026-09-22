# redis-tree-ui — Bug 清单

> 第 1 轮 Tester（全新实例；前任 Tester 死于服务错误，未留半成品）登记。
> 判定：**待验证中**（本节两条均为阶段 A 代码审查产出的疑点，`待验证` 状态；
> 逐条以「新增红测复现」验证后才改判为 `待修复` 或撤销）。
> 本轮只测不修：生产代码一行未改。允许写入的只有测试文件与本目录台账。

| Bug ID | 严重度 | 状态 | 涉及单元 | 一句话 |
|---|---|---|---|---|
| redis-tree-ui-BUG-001 | **待定（初判 Major）** | **待验证** | D-2 / D-8（R2 + I-11） | 树视图下 R2 的 pattern **完全不作用于键树行**（`list_children` 收不到 pattern，`treeRows` 也不做客户端过滤），三个过滤器里只有类型 chip 与「仅无过期」生效；连带 I-11 的 `no-match` 在默认视图下**永远不可达** |
| redis-tree-ui-BUG-002 | **待定（初判 Minor）** | **待验证** | D-5 / D-1 / D-8（I-4 + R1 + I-11） | 刷新在途失败时 `markFetchFailed` 的 rescan 分支**不关闭权威 pass**（`pass` 留在非 null），该层级被**永久**判定为「扫描中」⇒ R1 计数恒显 `N+`、空态恒判 `interrupted` |

---

## redis-tree-ui-BUG-001 — 树视图的搜索 pattern 是装饰件（待验证）

- **严重度（初判）**：Major —— R2 交付面的主过滤器对其默认视图无效，且 I-11 的一个具名状态因此不可达。
- **状态**：`待验证`
- **涉及文件**
  - `packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx:100-111`（`useKeyTreeView` 入参不含 pattern）
  - `packages/drivers/redis/ui/key-browser/useKeyTreeView.ts:89-113`（`useKeyTree` 只转 `noTtlOnly`/`keyType`/`separator`）
  - `packages/drivers/redis/ui/key-browser/useKeyTree.ts:79-86`（`invokeListChildren(..., { sep, noTtlOnly, keyType })` —— 无 pattern）
  - `packages/drivers/redis/ui/key-browser/useRedisKeyScan.ts:86-91`（`search()` 只重跑 `scan_keys`）
- **静态依据**
  - `appliedPattern` 的消费方**只有** `useRedisKeyScan` 自己（`loadKeys` / `loadMore` / `refresh`）。
    `git grep "searchPattern\|appliedPattern" -- ui/key-browser` 的完整结果里，`useKeyTree` /
    `useKeyTreeView` / `keyTree.ts` 一处都没有出现。
  - `shared/redisInvoke.ts:134-148` 的 `invokeListChildren` options 只有 `sep` / `noTtlOnly` / `keyType`；
    Rust 侧 `commands_exec_dispatch.rs:41` → `.list_children(handle, db, prefix, cursor, count, sep, no_ttl_only, key_type)`
    同样没有 pattern 形参 —— 即服务端层级取数按 prefix 走，与本轨的 pattern 无关。
  - 默认视图是 `tree`（`treePreferences.ts:32` `DEFAULT_TREE_PREFS = { view:'tree', … }`），
    而 `useKeyTreeView.ts:110-113` 在 tree 分支返回 `buildServerTreeRows(tree.levels, …)`，
    `tree.levels` 与 pattern 无任何关系。
- **预期用户可见后果（待实测确认）**
  1. 树视图输入 `app:*` → Enter：`scan_keys` 按新 pattern 重扫（`scan.keys` 收窄），
     但左列**仍然原样显示全部 folder / 键行**（不随 pattern 收窄）。
  2. I-11 的 `no-match` 具名空态在树视图**永不出现**：`rowCount` 来自未按 pattern 过滤的 `treeRows`，
     只要库里有任何键 `rowCount > 0` ⇒ `resolveTreeEmptyState` 在第一步就 `return null`。
  3. 两份「已加载」集不一致：`⌘A` / 全选按钮读的是**按 pattern 过滤后**的 `scan.keys`
     （`KeyTreePane.tsx:63` `selectAllLoaded`），而屏幕上的行来自**未过滤**的树 ⇒
     用户会看到「选中数少于（甚至为 0）我看到的行」，folder 复选框级联
     （`KeyTreeList.tsx:141-150`，同样按 `allKeys` 过滤）也可能勾中 0 个键却显示为可选。
- **重现步骤（计划中的红测）**
  1. mock `invokeListChildren` 返回 `{children:[folder('app:',2), leaf('root-plain')], cursor:0}`，
     `invokeScanKeys` 对 `pattern==='zzz'` 返回空 keys。
  2. 渲染 `RedisWorkbench`（默认 tree 视图）。
  3. 在 `redis-search-input` 输入 `zzz` → `Enter`。
  4. 断言：`redis-key-tree` 的 `data-row-count` 应为 `0`（树应按 pattern 收窄）
     且 `data-empty-state` 应为 `no-match`。
     ⇒ 预测实际值为 `data-row-count='2'` / 无空态（缺陷成立时此测为红）。
- **建议修法（仅供 Coder 参考，Tester 不实施）**
  - 首选：把 `appliedPattern` 作为 `useKeyTree` 的入参与 reset 触发项之一，
    并在**折叠前**对 `treeLevels` 的 children 做 glob 过滤（新增 `keyTree` 纯函数，状态机可测）；
    或映射 `prefix` 语义（`app:*` ⇒ 根 `list_children` 的 `prefix='app:'`）。
  - 若裁定「pattern 仅作用于列表视图」，则必须显式：在 tree 视图禁用/隐藏 pattern 输入
    （同 `KeyTreeGroupRow` 的 `disabled` 处理），并把 `no-match` 的判定源改成 `scan.keys`。
    **禁止**保持现状（看着能筛、实际不筛）。
- **是否本轨范围**：是。简报 §1 D-2 要求 pattern 输入 + Enter 应用，D-8 要求 `no-match` 具名可达；
  两者都在本轨验收面内，不属于 Wave 4。

---

## redis-tree-ui-BUG-002 — 刷新失败的层级把「扫描中」永久钉住（待验证）

- **严重度（初判）**：Minor —— 不显示错误数据，下一次成功刷新可自愈，但状态指示与空态在此之间持续说谎。
- **状态**：`待验证`
- **涉及文件**：`packages/drivers/redis/ui/key-browser/treeLevels.ts:118-122`（`markFetchFailed`）
  + `:129-131`（`anyLevelScanning`）
- **静态依据**
  - 模块自己的契约写在 `:34-38`：`pass: ChildEntry[] | null`，「`null` ⇒ 没有权威 pass 开着」。
  - `markFetchFailed` 的非 reset 分支只做 `{ ...level, loading:false, done: level.pass===null ? true : level.done, error:true }`
    —— **不含 `pass: null`**。
  - 于是 `beginFetch(finished, 'rescan')` 造出 `pass: []` 后若该次 `list_children` 抛错，
    层级落到 `{ done:true, pass: [], error:true, loading:false }`。
  - `anyLevelScanning`（`:129-131`）判据是 `!level.done || level.pass !== null` ⇒ 该层级**恒为 true**，
    一直到我方下一次 `applyFetch` 把它 wrap（`pass:null`）。
  - 既有状态机测试只覆盖 `markFetchFailed(scanning /* pass===null */, 'continue')`
    （`keyTreeState.test.ts:180-184`）与 `markFetchFailed(EMPTY_LEVEL,'reset')`（`:186-192`）
    —— **rescan + 开着的 pass 这一分支零覆盖**，所以门禁全绿也拦不住它。
- **预期用户可见后果（待实测确认）**
  - R1 计数徽标 `data-partial` 恒为 `'true'`，文案恒 `已加载 N+ / 共 M`（PRD §3.2 R1 明确
    「扫描中显示 `N+`」，此处并没有在扫描）。
  - 键树为空时（根层级无子行）I-11 恒判 `interrupted`（"Scan stopped — showing the 0 keys…"），
    压过本该出现的 `none` / `no-match`。
  - `useKeyTree.scanning` 文档注释（`:172`）自称「Any level still scanning ⇒ R1's `N+`」，
    与本缺陷直接冲突。
- **重现步骤（计划中的红测）**
  1. 纯状态机层：`const finished = applyFetch(beginFetch(EMPTY_LEVEL,'reset'),'reset',{children:[…],cursor:0})`；
     `const opened = beginFetch(finished,'rescan')`（此时 `pass===[]`）；
     `const failed = markFetchFailed(opened,'rescan')`。
  2. 断言 `anyLevelScanning({ '': failed })` 应为 `false`（pass 必须随失败关闭）。
     ⇒ 预测实际为 `true`（缺陷成立时此测为红）。
  3. DOM 层（同一缺陷的用户可见面）：刷新在途时让 `list_children` reject，
     断言 `redis-tree-count` 的 `data-partial` 最终回到 `'false'`。
- **建议修法（仅供 Coder 参考，Tester 不实施）**：`markFetchFailed` 非 reset 分支加
  `pass: null`（并把该次未完成的权威 pass 结果丢弃 —— `children` 已经保留了旧的已加载子集，
  正是 I-4 要求的行为）。同时补 `keyTreeState.test.ts` 该分支断言。
- **是否本轨范围**：是。D-5 的 `treeLevels.ts` 与 D-1/D-8 的两个消费面全在本轨。

---

## 登记纪律说明

- 两条均为**代码审查阶段（A）**产出的疑点，尚未经红测证实 ⇒ 状态 `待验证`，
  **不作为**本轨 `TEST_FAILED` 的判据。判定将在验证后于 `progress.md` 头部给出。
- 证实后：状态 → `待修复`，并附实测日志（vitest 原始输出 + 断言差异）。
- 撤销条件：若实测证明行为与本节判断不符（例如另有隐式过滤路径），本节改注
  「撤销（Tester 自查误判）+ 依据」，不删除条目。
