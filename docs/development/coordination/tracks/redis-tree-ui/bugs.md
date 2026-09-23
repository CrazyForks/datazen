# redis-tree-ui — Bug 清单

> 第 1 轮 Tester（全新实例；前任 Tester 死于服务错误，未留半成品）登记。
> 判定：**TEST_FAILED**（2 条 `待修复`：1 Major + 1 Minor）。
> 本轮只测不修：生产代码一行未改。写入面只有 `packages/drivers/redis/ui/__tests__/keyTreeTesterGaps.test.tsx`
> （新增测试文件）与本目录台账。

| Bug ID | 严重度 | 状态 | 涉及单元 | 一句话 |
|---|---|---|---|---|
| redis-tree-ui-BUG-001 | **Major** | **待修复** | D-2 / D-8（R2 + I-11） | 树视图下 R2 的 pattern **完全不作用于键树行**（既不进 `list_children`，也不做客户端过滤），三个过滤器只有类型 chip 与「仅无过期」生效；连带 I-11 的 `no-match` 在默认视图下**永远不可达**，且「全选已加载」与屏幕上的行互相矛盾 |
| redis-tree-ui-BUG-002 | Minor | **待修复** | D-5 / D-1 / D-8（I-4 + R1 + I-11） | 刷新在途失败时 `markFetchFailed` 的 rescan 分支**不关闭权威 pass**（`pass` 留在非 null），该层级被**永久**判定为「扫描中」⇒ R1 计数恒显 `N+`、空态恒判 `interrupted` |

**复测入口（两条共用）**：
`npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/keyTreeTesterGaps.test.tsx`
（当前：`4 passed | 2 skipped`；两条 `it.skip` 带 `FIXME(redis-tree-ui-BUG-nnn)`，修复后请**解 skip 转绿**，
并按 BUG-001 那节的说明**同步改写**配对的 characterization 用例。）

---

## redis-tree-ui-BUG-001 — 树视图的搜索 pattern 是装饰件

- **严重度**：**Major** —— 向用户展示与筛选条件矛盾的事实（行还在、计数说 0），
  且本轨两个验收面（D-2 pattern 应用、D-8 `no-match` 具名可达）在默认视图下同时失效。
- **状态**：`待复测`
- **涉及文件**
  - `packages/drivers/redis/ui/key-browser/useKeyTree.ts:79-86` —— `invokeListChildren(..., { sep, noTtlOnly, keyType })`，无 pattern
  - `packages/drivers/redis/ui/key-browser/useKeyTreeView.ts:89-113` —— `useKeyTree` 入参与 `treeRows` 派生都不含 pattern
  - `packages/drivers/redis/ui/key-browser/RedisWorkbench.tsx:100-111` —— 只把**未应用的** `scan.searchPattern` 传给空态判定
  - `packages/drivers/redis/ui/key-browser/useRedisKeyScan.ts:86-91` —— `search()` 只重跑 `scan_keys`
- **实测日志摘录（`ef0d62d94`，un-skip 后运行）**
  ```
  × FIXME(redis-tree-ui-BUG-001): applying a pattern narrows the rendered tree rows
  AssertionError: expected '2' to be '0'   // redis-key-tree[data-row-count]
  ```
  同文件的配对**绿测**（characterization，证明矛盾双方同时成立）：
  输入 `zzz` + Enter 后
  `redis-tree-count[data-loaded] === '0'`（扁平 `scan_keys` 确实收窄到 0）**且**
  `redis-key-tree[data-row-count] === '2'`（树列仍画出两条未过滤行）**且**
  `redis-tree-empty` 不存在，**且** 点「全选已加载」后 `redis-tree-clear-selection` 仍 `disabled`。
- **重现步骤**
  1. mock `invokeListChildren` → `{children:[folder('app:',2), leaf('root-plain')], cursor:0}`；
     `invokeScanKeys` 对 `pattern==='zzz'` 返回空 keys。
  2. 渲染 `RedisWorkbench`（默认即 `tree` 视图）。
  3. `redis-search-input` 输入 `zzz` → `Enter`。
  4. 读 `redis-key-tree[data-row-count]`（实际 `2`，应为 `0`）与 `redis-tree-empty[data-empty-state]`
     （实际不存在，应为 `no-match`）。
- **静态依据（同一结论的第二条路）**
  - `git grep "searchPattern\|appliedPattern" -- packages/drivers/redis/ui/key-browser`：
    `appliedPattern` 的消费方**只有** `useRedisKeyScan` 自己（`loadKeys`/`loadMore`/`refresh`）；
    `useKeyTree` / `useKeyTreeView` / `keyTree.ts` 一处都没有出现。
  - `shared/redisInvoke.ts:134-148` 的 `invokeListChildren` options 只有 `sep`/`noTtlOnly`/`keyType`；
    Rust 侧 `commands_exec_dispatch.rs:26-41` → `.list_children(handle, db, prefix, cursor, count, sep, no_ttl_only, key_type)`
    也没有 pattern 形参 —— 服务端层级取数只按 prefix，与本轨 pattern 无关。
- **用户可见后果**
  1. 树视图输入 pattern → Enter：左列**一行都不减**（看着能筛、实际不筛）。
  2. I-11 四态中的 `no-match` 在默认视图**不可达**：`rowCount` 来自未按 pattern 过滤的 `treeRows`，
     库里只要有键就 `rowCount>0` ⇒ `resolveTreeEmptyState` 第一步就 `return null`。
     （既有旅程 `keyTreeInteractionsJourney.test.tsx:598-629` 之所以能测到 `no-match`，
     是它把 `listChildren` mock 成了**返回空 children**，绕过了真实路径 —— 那条测的是 resolver 纯函数，
     不是这条链路。）
  3. 「全选已加载」与 R1 计数读 `scan.keys`（已过滤），行来自 `tree.levels`（未过滤）⇒
     用户可以「全选」出一个 0 项、或一个和所看见的行不相干的集合；
     folder 复选框级联（`KeyTreeList.tsx:141-150`，同样按 `allKeys` 过滤）能勾中 0 个键却显示为可选。
- **建议修法（Tester 不实施，仅供参考）**
  - 首选：把 `appliedPattern` 作为 `useKeyTree` 的入参 + reset 触发项之一，
    并在折叠前对 `treeLevels` 的 children 做 glob 过滤（新增 `keyTree` 纯函数，状态机可测）；
    或把 pattern 映射成 `prefix` 语义（`app:*` ⇒ 根 `list_children` 用 `prefix='app:'`）。
    若需要服务端支持，`list_children` 加 pattern 形参属本轨外的契约改动 —— 那么退到下面一条。
  - 若裁定「pattern 只作用于列表视图」：必须**显式**化 —— tree 视图下禁用/隐藏 pattern 输入
    （同 `KeyTreeGroupRow` 的 `disabled` 处理），并把 `no-match` 判定源改成 `scan.keys`。
    **禁止**保持现状（输入框看着可用、实际无效）。
- **是否本轨范围**：是。简报 §1 D-2（pattern 输入 + Enter 应用）与 D-8（`no-match` 具名可达）
  都在本轨验收面内，不属于 Wave 4。
- **是否阻断合并**：是（Major，且是 D-2/D-8 的正面验收面）。

### 修复记录（coder round-1）

- 状态置 `待复测`。commit：`03f3790f5`（纯函数 `keyTreeFilter.ts`）+ `307ce40df`
  （`appliedPattern` 接进行派生 / reset / 前缀路由 / 单一事实源）+ `975e23e6b`
  （新旅程 `keyTreePatternFilter.test.tsx`）+ `406253a2f` / `eb733a757`（死代码收口）
  + `87b5e4620`（折叠子树 probe 臂：`*user*` 不得清空 `app:` 文件夹）+ `42c16bbee`
  （把 R1 计数从 flat list 楔开的专用用例）。
- 采**纯客户端过滤**路线（协调者裁定，不改 `list_children` 契约）：glob 语义对齐
  Redis `MATCH`，折叠态祖先补渲染为不可点面包屑（`data-breadcrumb`，不计
  `data-row-count`），空文件夹不显示，可见性按 `row.kind` 分叉。
- 本文件复测入口不变（`keyTreeTesterGaps.test.tsx` 全 6 例，0 skip）；
  裁定细节、prefix 口径与懒加载 pattern 局限记在 `progress.md`「修复轮第 1 回合」。

---

## redis-tree-ui-BUG-002 — 刷新失败的层级把「扫描中」永久钉住

- **严重度**：Minor —— 不展示错误数据、下一次成功刷新可自愈；但在此之间状态指示持续说谎。
- **状态**：`待复测`
- **涉及文件**：`packages/drivers/redis/ui/key-browser/treeLevels.ts:118-122`（`markFetchFailed`）
  + `:124-131`（`anyLevelScanning`）
- **实测日志摘录（`ef0d62d94`，un-skip 后运行）**
  ```
  × FIXME(redis-tree-ui-BUG-002): a failed rescan closes the pass instead of pinning 扫描中 forever
  AssertionError: expected [] to be null      // failed.pass
  ```
  （紧接的 `anyLevelScanning({ '': failed })` 同轮为 `expected true to be false`。
  同轮 `2 failed / 5` 即 BUG-001 + BUG-002 各一条。）
- **重现步骤（纯状态机，无需 DOM）**
  1. `finished = applyFetch(beginFetch(EMPTY_LEVEL,'reset'),'reset',{children:[folder('app:',2)],cursor:0})`
     ⇒ `{done:true, pass:null}`。
  2. `opened = beginFetch(finished,'rescan')` ⇒ `{pass: [], cursor:0, loading:true}`。
  3. `failed = markFetchFailed(opened,'rescan')`。
  4. 实际 `{ done:true, loading:false, error:true, pass: [] }`；
     期望 `pass === null` 且 `anyLevelScanning({ '': failed }) === false`。
- **静态依据**
  - 模块自己的契约（`treeLevels.ts:34-38`）：`pass: ChildEntry[] | null`，
    「`null` ⇒ 没有权威 pass 开着」。
  - `markFetchFailed` 非 reset 分支只写
    `{ ...level, loading:false, done: level.pass===null ? true : level.done, error:true }`
    —— **不含 `pass: null`**。
  - `anyLevelScanning` 判据 `!level.done || level.pass !== null` ⇒ 该层级此后**恒为 true**，
    直到某次 `applyFetch` 把 pass wrap（正常路径下要等下一次成功刷新）。
  - 既有状态机测试只覆盖 `markFetchFailed(scanning /* pass===null */, 'continue')`
    （`keyTreeState.test.ts:180-184`）与 `markFetchFailed(EMPTY_LEVEL,'reset')`（`:186-192`）；
    **`rescan` + 开着的 pass 这一分支零覆盖** ⇒ 门禁全绿拦不住它。
- **用户可见后果**
  - R1 计数徽标 `data-partial` 恒 `'true'`、文案恒 `已加载 N+ / 共 M`
    （PRD §3.2 R1 明确「扫描中显示 `N+`」，此时并没有在扫描）。
  - 键树为空时 I-11 恒判 `interrupted`（"Scan stopped — showing the 0 keys…"），
    压过本该出现的 `none` / `no-match`。
  - `useKeyTree.ts:172` 的注释自称「Any level still scanning ⇒ R1's `N+`」，与本缺陷直接冲突。
- **建议修法（Tester 不实施，仅供参考）**：`markFetchFailed` 非 reset 分支补 `pass: null`
  —— 放弃这次未完成的权威 pass；`children` 本来就保留了旧的已加载子集，正是 I-4 要求的行为。
  同时在 `keyTreeState.test.ts` 的 fetch-modes 一节补该分支断言。
- **是否本轨范围**：是。`treeLevels.ts` 由 D-5 新建，消费面 R1 计数（D-1）与 I-11（D-8）均在本轨。
- **是否阻断合并**：不单独阻断（Minor，可自愈），但与 BUG-001 同属 I-11/R1 判定链，
  建议同回合一起修，避免两次改同一文件。

### 修复记录（coder round-1）

- 状态置 `待复测`。commit：`34ec2828d`。
- `markFetchFailed` 非 reset 分支补 `pass: null` + `done: true`（失败的回填 pass 被
  放弃，`children` 保留旧子集 = I-4 行为），`anyLevelScanning` 不再被永久钉 true；
  `:90` reset 分支与 `:109` continue 分支未回归。
- 测试：`keyTreeState.test.ts` 新增 `[redis-tree-ui-BUG-002]` 三态（进入 / 放弃 /
  下一次成功自愈 + mid-pass 失败），`keyTreeTesterGaps.test.tsx` 对应 `it.skip` 解 skip 转绿。

---

## 验证方法说明（为什么用 skip + 配对绿测而不是只写红测）

- 两条均以「先 un-skip 跑出真实红 → 记录 vitest 原文 → 回到 `it.skip` + `FIXME(...)`」登记，
  与本仓 `redis-kvbar-ui` 轨既定惯例一致（见 `kvBarRound2Tester.test.tsx:475-479`、
  `kvBarSlotTesterGaps.test.tsx` 的成对口径），使本轨门禁在缺陷未修期间仍全绿。
- 断言只走 `data-*` / i18n key / mock 调用参数，`useI18n` 被 stub 成恒等 `t`，
  **全文零英文字面量文案断言**。
- BUG-001 额外留一条**当前为绿**的 characterization 用例（钉住「计数说 0、行说 2」这一矛盾），
  它同时是修复时的改写目标 —— 修复后它必红，届时应把它改成过滤后的期望，
  而不是删掉（删掉会让「配对红测是否真空」失去证据）。
