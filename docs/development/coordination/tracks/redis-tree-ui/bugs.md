# redis-tree-ui — Bug 清单

> 第 1 轮 Tester（全新实例；前任 Tester 死于服务错误，未留半成品）登记。
> 判定：**TEST_FAILED**（2 条 `待修复`：1 Major + 1 Minor）。
> 本轮只测不修：生产代码一行未改。写入面只有 `packages/drivers/redis/ui/__tests__/keyTreeTesterGaps.test.tsx`
> （新增测试文件）与本目录台账。

> 第 2 轮 Tester（全新实例，2026-09-23）复测判定：**TEST_FAILED（第 2 轮，2 个 bug，Bug 循环 2/5）**。
> BUG-001 / BUG-002 复测**通过**，状态已翻 `已修复`（复测记录见各节）；新登记
> `redis-tree-ui-BUG-003`（Minor，跨视图 glob 方言矛盾）与 `redis-tree-ui-BUG-004`
> （Minor，键盘跨面包屑零旅程锁定），均 `待修复`。生产代码仍一行未改：8 发反向突变逐一
> `git checkout HEAD --` 复原，每发后 `git status --porcelain` 验空（CLEAN_OK 8/8）。

| Bug ID | 严重度 | 状态 | 涉及单元 | 一句话 |
|---|---|---|---|---|
| redis-tree-ui-BUG-001 | **Major** | **已修复** | D-2 / D-8（R2 + I-11） | 树视图下 R2 的 pattern **完全不作用于键树行**（既不进 `list_children`，也不做客户端过滤），三个过滤器只有类型 chip 与「仅无过期」生效；连带 I-11 的 `no-match` 在默认视图下**永远不可达**，且「全选已加载」与屏幕上的行互相矛盾 |
| redis-tree-ui-BUG-002 | Minor | **已修复** | D-5 / D-1 / D-8（I-4 + R1 + I-11） | 刷新在途失败时 `markFetchFailed` 的 rescan 分支**不关闭权威 pass**（`pass` 留在非 null），该层级被**永久**判定为「扫描中」⇒ R1 计数恒显 `N+`、空态恒判 `interrupted` |
| redis-tree-ui-BUG-003 | Minor | **待修复** | D-2（R2 pattern 跨视图一致性） | 客户端 glob 方言 ⊂ Redis MATCH：`[...]` 类、`\` 转义、换行键、多字节 `?` 共 **16 个分歧面**上，**同一 `appliedPattern` 对同一已加载键集，列表视图（服务端 MATCH）有行、树视图 0 行 + `no-match`** —— 修复记录声称的「glob 语义对齐 Redis `MATCH`」只在核心方言成立 |
| redis-tree-ui-BUG-004 | Minor | **待修复** | D-7（I-9 键盘 × BUG-001 面包屑） | 修复轮声称的「`stepActiveIndex` 跨过面包屑、`→` 进子树时也跨」**零旅程锁定**：跨过循环体（`KeyTreeList.tsx:174/274`）在全部 613 条测试中执行 **0 次**（v8 计数为证），删掉 `!isNavigable` 守卫所有门禁依旧全绿 |

**复测入口（两条共用）**：
`npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/keyTreeTesterGaps.test.tsx`
（当前：`4 passed | 2 skipped`；两条 `it.skip` 带 `FIXME(redis-tree-ui-BUG-nnn)`，修复后请**解 skip 转绿**，
并按 BUG-001 那节的说明**同步改写**配对的 characterization 用例。）

---

## redis-tree-ui-BUG-001 — 树视图的搜索 pattern 是装饰件

- **严重度**：**Major** —— 向用户展示与筛选条件矛盾的事实（行还在、计数说 0），
  且本轨两个验收面（D-2 pattern 应用、D-8 `no-match` 具名可达）在默认视图下同时失效。
- **状态**：`已修复`（第 2 轮复测通过，2026-09-23）
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

## 复测记录（round-2）— redis-tree-ui-BUG-001

- 判定：**通过** ⇒ 状态 `待复测` → `已修复`（2026-09-23，第 2 轮 Tester，全新实例）。
- 文件面：`git diff f8a191b66..HEAD` = 19 文件全在申报写入面；`KeyTreeList.tsx` 635 行 ≤800；
  `RedisWorkbench.tsx` diff 仅 `appliedPattern: scan.appliedPattern` 传参与注释；en.ts 只 +1 key + 注释。
- 反向突变 6 发全红、逐发复原验空（CLEAN_OK）：
  `i` 去锚定 ⇒ keyTreeFilter.test.ts **3 failed | 35 passed**；
  `ii` 加 `'i'` ⇒ **1 failed**（`glob user vs User ⇒ false`）；
  `iii-a` `countSelectableRows` 数全部行 ⇒ **2 failed**（两条面包屑回填/保留断言）；
  `iii-b` 面包屑分支改可点 ⇒ keyTreePatternFilter **1 failed | 19 passed**（「non-interactive breadcrumb」）；
  `iv` probe 臂 `hasVisibleDescendant(target)`→`false` ⇒ 纯测+旅程 **2 failed | 56 passed**（probe describe +
  「a folder with an open scan」）；`v` `rootPrefix`→`''` ⇒ **4 failed | 22 passed**（prefix 路由旅程×3 + gaps FIXME-001）。
  另 C5 见下条。日志 `/tmp/mut_*.log`（按约销毁）。
- **C5 见证**：`visibleKeys` 树模式去过滤 ⇒ keyTreePatternFilter **1 failed | 25 passed** ——
  「R1 counts the pattern-visible set even when the flat scan ignored the glob」（`data-loaded='0'` 楔子）
  直接变红 ⇒ 计数/全选/级联单一事实源被钉死（R1 计数一致性成立）。
- glob 边界推导（Redis 7.2 `stringmatchlen_impl` 字节移植 × `globToRegExp` 忠实移植，自检 15/15 PASS）：
  **核心方言 25/25 对齐**（字面量/锚定/大小写敏感/`*` 折叠/`?` 单位/元字符字面）；**16 处分歧**：
  `[...]` 类 5 例（`h[ae]llo`/`hello`、`*[0-9]`/`user1`、`user[0-9]`/`user5`、`h[^e]llo`/`hallo`、
  `h[a-b]llo`/`hbllo`，Redis 全匹配 / 客户端全不匹配）、`\` 转义 3（`a\b`/`ab` 与 `a\b`/`a\b` 双向、
  `\*lit`/`*lit`）、换行字节 3（`a?c`/`a\nc`、`*x`/`a\nx`、`a*b`/`a\nb`）、多字节 `?` 4
  （`?`/`é`、`?`/`用` F/T 与 `??`/`é`、`???`/`用` T/F）。
  跨视图实跑：`*[0-9]` over `user1,user2,cache:9` ⇒ 列表 3 行 / 树 0 行 + `no-match`。
  **该分歧 = 新 bug BUG-003**（修复记录声称「glob 语义对齐 Redis MATCH」的范围要收窄）。
- 两项 coder 自发决策独立裁定：**(a) Esc 清文本+重放空 filter —— 维持**（只清文本会留下屏幕上无痕迹的
  过滤态，正是本 bug 的同类谎言；`onClearFilter` 一次跃迁清 draft+重扫，L452 旅程钉住）；
  **(b) 折叠文件夹 probe 臂 —— 维持**（probe 与计数同读同一已加载键集；删 probe 走严格 glob 会重造
  「计数 ≥1 但 `app:` 行不可达」矛盾对；突变 iv 双层打红 2 failed 证明其被钉）。
- 断言纪律：0 几何反查、0 `.skip(`/`it.todo`、改动文件 0 空断言、文案断言全走恒等 `t` 的 i18n key。
- 门禁原文尾：vitest `Test Files 55 passed (55)` / `Tests 613 passed (613)` EXIT=0；
  `tsc --noEmit` EXIT=0 输出 0 行；build `✓ built in 4.76s` EXIT=0；
  boundaries `ok (1486 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))` EXIT=0。
- 覆盖率复算（v8，diff 新增行 ∩ statement/branchMap）：round 轴语句 96.49% (165/171)、分支
  ANY-side **100.00%** (61/61，与自报逐数吻合)；track 轴语句 **87.68%** (790/901，自报 87.77 Δ0.09pp)、
  分支 ANY-side **97.49%** (272/279，与自报逐数吻合)；严口径 ALL-sides 分支 83.61 / 81.36；
  **四数全 ≥80% 地板**。round 轴语句差额 = 不可达 RegExp-throw 路径 3 点（自报按根因计 1 处 catch）
  + 键盘跨面包屑循环 3 点（= BUG-004 证据）。
- 死代码零残留：round-1 清理 commit 后无新增孤儿（`keyTreeFilter` 5 导出全有消费方）；tsc 0 错；
  全仓 `FIXME|@ts-ignore|eslint-disable|\.skip\(|it.todo` 逐条核过均为存量/带理由注释/gaps 头注释。

---

## redis-tree-ui-BUG-002 — 刷新失败的层级把「扫描中」永久钉住

- **严重度**：Minor —— 不展示错误数据、下一次成功刷新可自愈；但在此之间状态指示持续说谎。
- **状态**：`已修复`（第 2 轮复测通过，2026-09-23）
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

## 复测记录（round-2）— redis-tree-ui-BUG-002

- 判定：**通过** ⇒ 状态 `待复测` → `已修复`（2026-09-23，第 2 轮 Tester，全新实例）。
- 代码复核：`treeLevels.ts:131-134` `markFetchFailed` 非 reset 分支 = `{ ...level, loading:false,
  done:true, error:true, pass:null }` —— `pass` 放弃 + `done` 收口；`:142` `anyLevelScanning`
  判据不变，失败层级不再被永久钉 `true`；reset 分支仍归 `EMPTY_LEVEL`。
- 反向突变 `vi`（还原旧行为 `done: level.pass===null ? true : level.done`、去掉 `pass:null`）
  ⇒ keyTreeState + gaps 合跑 **3 failed | 42 passed (45)**，EXIT=1：
  ①「entry + abandon: the failed pass closes and stops claiming a scan」、
  ②「a failure mid-pass drops the partial pass, not the last good subset」、
  ③「FIXME(redis-tree-ui-BUG-002): a failed rescan closes the pass instead of pinning 扫描中 forever」。
  随后 `git checkout HEAD -- treeLevels.ts` + `git status --porcelain` 验空（CLEAN_OK）。
- un-skip 门：`keyTreeTesterGaps.test.tsx` → **`Tests 6 passed (6)`，0 skipped，EXIT=0**
  （round-1 登记时为 `4 passed | 2 skipped`，两条 `FIXME` 均解 skip 转绿）。
- 门禁串行四连全绿：vitest 55 文件/613 tests/0 skip EXIT=0、tsc EXIT=0、build EXIT=0、
  boundaries 1486/0/4 EXIT=0。

---

## redis-tree-ui-BUG-003 — 客户端 glob 方言与 Redis MATCH 不对齐 ⇒ 同一 pattern 两视图互相矛盾

- **严重度**：**Minor** —— 触发面是 `[...]` 类 / `\` 转义 / 换行键 / 多字节 `?` 四组非核心语法
  （核心字面量/`*`/`?` 方言 25/25 对齐），无数据损坏、切列表视图可见真实结果、可绕行；
  但向用户展示与筛选条件矛盾的事实（列表有行、树断言 `no-match`），且修复记录（本文件 BUG-001
  修复记录第 3-4 行「glob 语义对齐 Redis `MATCH`」）的声明在这 16 个面上不成立。
  若协调者认为与 BUG-001「两事实互相矛盾」同级可升 Major，由协调者裁定，Tester 给出证据。
- **状态**：`已修复`（第 3 轮复测通过，2026-09-23）
- **涉及文件**
  - `packages/drivers/redis/ui/key-browser/keyTreeFilter.ts:43-56` —— `globToRegExp`：
    `*`→`.*`、`?`→`.`、其余转义 `[.+^${}()|[\]\\]`、`^...$` 锚定、大小写敏感
    ⇒ `[...]`/`\` 被降为**字面量**，`.` 不跨 `\n`，`?` 按码点非字节。
  - `packages/drivers/redis/ui/key-browser/useWorkbenchSearch.ts` —— `patternHasGlob = /[*?[\]\\]/`
    把 `[`、`\` 认作 glob 字符 ⇒ **原样下发服务端**（不套 `模糊` 包装）。
  - 服务端链（本轨未改，语义来源）：`ops_tree.rs` `format!("{prefix}*")` → `scan_batch` MATCH
    = Redis `stringmatchlen_impl`（类/转义/字节全方言）。
  - 消费面：`useKeyTreeView.ts:160-168`（行过滤）与 `:186-189`（`visibleKeys` 计数）都走客户端方言；
    列表视图 `RedisWorkbench.tsx:255 loadedCount={scan.keys.length}` 走服务端方言。
- **边界推导证据**（`/tmp/glob_boundary.mjs`：双方忠实移植 + 脚本自检 15/15 PASS，用后销毁）：
  - 核心方言 **25/25 一致**；**16 处分歧**，样例：
    | 面 | 样式（pattern/key） | Redis MATCH | 客户端 glob |
    |---|---|---|---|
    | 类 | `h[ae]llo`/`hello`、`*[0-9]`/`user1`、`user[0-9]`/`user5`、`h[^e]llo`/`hallo`、`h[a-b]llo`/`hbllo` | 全匹配 | 全不匹配 |
    | 转义 | `a\b`/`ab`、`\*lit`/`*lit` | 匹配 | 不匹配 |
    | 转义反向 | `a\b`/`a\b` | 不匹配 | 匹配 |
    | 换行 | `a?c`/`a\nc`、`*x`/`a\nx`、`a*b`/`a\nb` | 匹配 | 不匹配（`.` 不跨 `\n`） |
    | 多字节 `?` | `?`/`é`、`?`/`用` | 不匹配 | 匹配 |
    | 多字节 `?` | `??`/`é`、`???`/`用` | 匹配 | 不匹配 |
- **重现步骤（跨视图事实矛盾，纯单测可 mock）**
  1. mock `invokeScanKeys` 按服务端 MATCH 语义对 `*[0-9]` 返回 `['user1','user2','cache:9']`；
     `invokeListChildren` 返回可覆盖这些键的层级。
  2. 渲染 `RedisWorkbench`，输入 `*[0-9]` + Enter。
  3. 切列表视图 ⇒ `redis-tree-count[data-loaded]='3'`、三行可见。
  4. 切回树视图 ⇒ `redis-key-tree[data-row-count]='0'` 且
     `redis-tree-empty[data-empty-state]='no-match'`（空态文案引用 `*[0-9]`）。
  同一 `appliedPattern`、同一已加载键集 ⇒ 两个视图给出相反事实。
- **静态依据**：脚本 64 行矩阵（见上表）；`patternHasGlob` 源码证明产品自己把 `[`/`\` 当 glob 下发；
  修复记录第 3-4 行的「对齐 Redis `MATCH`」声明与 16 分歧面直接冲突。
- **用户可见后果**
  1. 列表能看到的键，切树被断言「没有键匹配该 pattern」—— 与 BUG-001 同类的“筛选条件 vs 事实”矛盾，
     只不过从「列内三方矛盾」换成「跨视图两方矛盾」。
  2. `模糊` chip 的注释明说「pattern 已带 glob 字符则原样发送」—— 产品邀请用户写类表达式，
     树侧却无法求值。
- **建议修法（Tester 不实施，仅供参考）**：三选一 ——
  (a) 客户端方言补齐至 `stringmatchlen` 语义（`[...]`/`\`/字节 `?`/跨行 `*`）；
  (b) 树过滤复用服务端结果：类/转义 pattern 先走 `scan_keys` 预取、树只在预取集上裁行；
  (c) 显式化限制：树视图遇不支持的 pattern 显示「该 pattern 仅列表视图支持」而非 `no-match` 假事实。
  任一方案都要同步收窄修复记录里「glob 语义对齐 Redis MATCH」的表述。
- **是否本轨范围**：是。D-2（pattern 应用）的一致性验收面；纯客户端过滤路线是本轮修复自选（协调者裁定），
  其后果应在本轨内闭环，不属于 Wave 4 或 Rust 契约改动。
- **是否阻断合并**：否（Minor、条件触发、有绕行），但与 BUG-001 同链，建议同回合修避免两次改同一文件。

### 修复记录（coder round-2）

- 修法：glob 方言按 Redis `stringmatchlen` 字节级移植（`698b18174`）——`keyTreeFilter.ts` 的
  `globToRegExp` 退役，改按 Redis 源码逐字节语义求值（`[...]` 类、`\` 转义、`*` 跨 `\n`、`?` 按字节）。
- 验收：第 2 轮 Tester 列出的 16 个分歧面逐条有断言。
- 门禁：见 `progress.md` 的「修复轮第 2 回合」小节。

## 复测记录（round-3）— redis-tree-ui-BUG-003

- 判定：**通过** ⇒ 状态 `待复测` → `已修复`（2026-09-23，第 3 轮 Tester，全新实例）。
- **方法（较第 2 轮升级）**：取 **Redis 7.2.0 `src/util.c` 的 `stringmatchlen_impl` 原文**
  编译为**真实 C 预言机** `/tmp/r3/oracle.c`（`cc -O1`，源码零改动），TS 侧经临时 vitest
  探针以 hex 编码驱动，**102 个模式 × 91 个键 = 9216 例逐例对拍 ⇒ `mismatches=0`**
  （旧法「第二份手写 JS 移植」与实现共享误读风险，故弃用；探针用后已删除，
  `142ae450f` 记录删除动作，`git diff f3a3eea19..HEAD` 复归 10 文件）。
- **16 分歧面逐条复验：16/16 一致**（类 5 / 转义 3 / 换行 3 / 多字节 `?` 5），
  逐面表见 `progress.md` §2。关键面实测：`?` vs `é` = 0（双字节，`?` 不匹配）、
  `???` vs `用` = 1（三字节）、`a?c` vs `a\nc` = 1（跨 `\n`）、`h[ae]llo` vs `hello` = 1、
  `h[^e]llo` vs `hallo` = 1、`\*lit` vs `*lit` = 1。
- **附加面同批一致**：`[b-a]` 交换操作数、`[!e]` 非取反、类内 `\]`、未终止类回退、
  `[^]`、`[]]`、`[a-]`、`[-a]`、`**` 折叠、`*` 不匹配空键、病态模式 `a*a*a*a*a*b`
  与 `skipLongerMatches` 早退。
- **变异 4 发 4 中**（逐发 `git checkout HEAD --` 复原 + `git status --porcelain` 验净，
  CLEAN_OK 4/4）：①键侧按字符编码（等价 `?` 用 `.`）⇒ 探针 **40 mismatches**、
  自带套件 6 failed；②禁用 `[` 类臂 ⇒ **142 mismatches**、16 failed；③去锚定 ⇒
  **1223 mismatches**、14 failed；④删 `\` 转义直落臂 ⇒ **22 mismatches**、4 failed。
  逐发 EXIT=1，复原后复跑探针 `mismatches=0 / faces_ok=16/16 / 5 passed`。
- **trim 口径核对（主动审查项）**：`compileGlob` 先 `trim()`，与
  `toScanPattern`（`useWorkbenchSearch.ts:97`）**同样 trim 后下发**一致，无新增分歧面。
- 覆盖：本回合 diff 语句 99.19%、分支 ANY-side 100%（见 `progress.md` §5）；
  四门 56/697 · tsc 0 · build exit 0 · boundaries 1487/0/4（§4）。

---

## redis-tree-ui-BUG-004 — 「键盘跨过面包屑」声称行为零旅程锁定

- **严重度**：**Minor** —— 当前未观测到用户可见错误（helper 级 `nextActiveIndex` 夹紧有测），
  但修复轮明确声称的行为在全部 613 条测试里执行 0 次，回归（删守卫）不会让任何门禁变红；
  违反本仓「连续旅程测试：交互必须覆盖中间态并断言跃迁」原则对 I-9 的要求。
- **状态**：`已修复`（第 3 轮复测通过，2026-09-23）
- **涉及文件**
  - `packages/drivers/redis/ui/key-browser/KeyTreeList.tsx:171-178` —— `stepActiveIndex`
    的 `while (... !isNavigable(index))` 跨过循环；
  - `KeyTreeList.tsx:268-277` —— `→` 进子树时 `while (... !isNavigable(child))` 跨过循环；
  - 声称出处：`progress.md` 修复轮 §「KeyTreeList」：「I-9 键盘经 `stepActiveIndex` **跨过**面包屑
    且 `→` 进子树时也跨」。
- **实测证据（覆盖执行计数，v8，diff 加权）**
  - `KeyTreeList.tsx:174` 语句 hits=**0**、`:176` 语句 hits=**0**、`:274` 语句 hits=**0**；
    分支 `:176 [0,8]`（条件求值 8 次、跨过体 0 次）、`:337/:342/:347` 单侧 0 ——
    即**没有任何测试让落点或首子命中面包屑行**。
  - 测试面穷举：全部 `__tests__` 中含 breadcrumb 的用例只做渲染/计数断言
    （`keyTreeFilter.test.ts:148/162` 纯函数、`keyTreePatternFilter.test.tsx:315` 渲染旅程）；
    键盘旅程（`keyTreeInteractionsJourney.test.tsx:396-431`、`keyTreeTesterCoverage.test.tsx:470-502`）
    全部跑在**无过滤**的树上 —— 根本没有面包屑可跨；
    `keyTreeState.test.ts:340-361` 只测 `treeNavAction` 键位映射与 `nextActiveIndex` 夹紧，
    不经过 `stepActiveIndex`。
- **重现步骤**
  1. mock 层级使深匹配产生面包屑行（复用 `keyTreePatternFilter:315` 场景：deep-only match）。
  2. 焦点进树，`↓` 从 `-1` 起步：`nextActiveIndex(-1,1,n)=0` 恰是面包屑行。
  3. 期望：`data-active` 不落在 `data-breadcrumb='true'` 行、直接停在子键上；实际当前无任何测试断言此跃迁。
  4. 静态证明：循环体执行计数为 0 ⇒ 把 `!isNavigable(...)` 改恒真（删守卫）不改变任何被观测路径，
     四门预期依旧全绿 —— 即该行为**处于回归裸奔状态**。
- **建议修法（Tester 不实施，仅供参考）**：补一条 DOM 旅程 —— 深匹配出面包屑 → `↓` 不停面包屑
  （断言 `data-active` 永不在 `data-breadcrumb='true'` 行）→ 继续 `↓` 落子键；再补 `→` 进子树时
  首子为面包屑的分支；或把跨过逻辑抽成纯函数进 `keyTreeState.test.ts` 级别的状态机测试。
- **是否本轨范围**：是（I-9 + BUG-001 面包屑渲染的配套交互，两者同回合产物）。
- **是否阻断合并**：否（Minor，无当前可观测错误），但属「声称-证据缺口」，应补测闭环。

### 修复记录（coder round-2）

- 修法：面包屑键盘旅程用例锁定 + 仅字面头做前缀路由（`492f5503d`）。
- 验收：`KeyTreeList.tsx:174/176/274` 在 v8 计数中 hits>0。
- 门禁：见 `progress.md` 的「修复轮第 2 回合」小节。

## 复测记录（round-3）— redis-tree-ui-BUG-004

- 判定：**通过** ⇒ 状态 `待复测` → `已修复`（2026-09-23，第 3 轮 Tester，全新实例）。
- **hits 实测**（v8，`/tmp/r3/cov3/coverage-final.json`，采集命令见 `progress.md` §3）：
  `KeyTreeList.tsx:174` **0 → 13**、`:274` **0 → 7**；
  `:176` 因重构已成为**注释行**（无语句），其「跨过体」语义迁至
  **`treeRowSpec.ts:167`** —— 循环体计数 **32**（第 2 轮该语义等价物为 0），
  分支 `b22 L167 [33,58,51]`、`b23/b24 L168` 两侧全非零。
- **行号漂移的独立裁定**：修复把 `KeyTreeList.tsx` 内**两处内联跨过 while 循环抽成**
  `treeRowSpec.ts` 的 `nextNavigableIndex()`，故 174 变为委托调用、176 变为注释、
  274 臂改走同一 helper。**判据「174/176/274 > 0」在 174/274 上字面成立；
  176 的定位已失效，但被替代的语义点 `treeRowSpec.ts:167` 计数 32 > 0**，
  故实质判据成立，且**强度高于第 2 轮建议**（原建议是「补一条旅程」，
  实际做法是让两臂**共用同一被测 helper**，消灭了第二份无证据内联拷贝）。
- **旅程真伪核验**：`keyTreeBreadcrumbKeyboardJourney.test.tsx`（339 行 / 5 例）为
  真键盘旅程 —— `fireEvent.keyDown(tree(), {key})` 驱动，断言 `data-active-index` /
  `data-active` / `data-breadcrumb` / `data-row-index` / `data-row-count`；
  且 `:208` setup 例**先自证**面包屑确在 index 0、键行在 1，避免「无面包屑的树
  证明不落在面包屑上」的空转；中间态齐全（`-1→↓→1`、`↑` 夹紧、连按三次不得爬升、
  全面包屑树五键均留 `-1`）。非 vacuous。
- **变异 2 发 2 中**（复原后 `git status --porcelain` 验净，CLEAN_OK 2/2）：
  A 删 `treeRowSpec.ts:167` 跨过循环（删 `!isNavigable` 守卫）⇒ 旅程
  **2 failed | 3 passed**（`:232`/`:247` 均 `expected '0' to be '1'`：`↓`/`↑`
  落在面包屑 index 0 而非键行 1，**正是本 bug 复现**）；
  B 还原 round-1 行为（`:182` `return target`）⇒ **1 failed | 4 passed**
  （`:250` 同型失败）。复原后 journey + `keyTreeState` + `keyTreeInteractionsJourney`
  = 64 passed / EXIT=0。
- 第 2 轮「613 条测试中执行 0 次、删守卫不会变红」的**回归裸奔状态已闭环**。

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
