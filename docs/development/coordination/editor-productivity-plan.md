---
title: 多目标协调计划（hub 静态段落来源）
---

# 协调计划（hub 静态段落来源）

本文件是 `scripts/aggregate-hub.mjs` 读取的静态段落来源。
**`docs/development/coordination/hub.md` 永远由聚合器生成，禁止手改。**

## 轨道任务表

| Track | 工作区 | 任务摘要 |
| --- | --- | --- |
| ep-runtime-globals | 已合流 `46be145af`（Tester FAILED，见 BUG-002/003） | G1 补齐 EP 运行时共享模块（`@codemirror/language`、`@codemirror/commands`）并加防漂移测试守住宽/窄探针不对称 |
| ep-hooks-settings | 已合流 `1837096f0`；Tester 复测中（6bef2cf8） | G2 通用契约钩子 + G3 打通设置生效 + G4 契约版本 bump |
| pane-layout | 已合流 `0042d8ef7`；7 处真门禁类型错修复中（Coder 8bbf64a0） | G5 pane 维度布局模型与焦点路由（不含 UI） |
| multi-cursor | **已合流 `2f4a07a52`；TEST_DONE，0 Bug**（覆盖率 70%→100% 行 / 26.31%→94.73% 分支） | 解 `Shift-Alt-ArrowUp/Down` 多光标死键（macOS 被 `defaultKeymap` 抢占） |
| code-folding | （待 `ep-hooks-settings` 交回后建轨） | Code Folding：Pro 侧实现，宿主提供 compartment 槽位 |

## 波次记录


### Redis Workbench P0（集成分支 `feat/redis-workspace-ux`，基准 `ae65ae375`）

- **Wave 0**（2026-09-21）：PRD v1.1.0 与原型落档；三条轨道 worktree 建立。
- **Wave 1**（2026-09-22，全部合入）：
  - `redis-host-slots` —— 宿主 KV 槽位与能力判定（`kvWorkspace` 能力位 + 4 个 codegen 槽位 + 死按钮修正）。Bug 循环 1 轮，复测 PASSED → `fcf606ca2`。
  - `redis-cmds-p0` —— `type_distribution` / `key_object_info` 两条 P0 后端命令（三拓扑往返口径）。Bug 循环 3 轮，复测 TEST_DONE → `f3d396292`。
  - `redis-assert-policy` —— 存量"钉死英文文案"断言改写 + 原则六口径落档 → `9a194afa7`。**中途裁定**：i18n 文案护栏脚本（420 行）+ 自测（687 行）+ 两条 npm 脚本按用户裁定整体删除，不再开第 3 轮复测（详见该轨 progress.md「协调者裁定（第 2 轮 · 护栏整体撤销）」）。
- **Wave 2**（第一段 2026-09-22 两条均已合入）：
  - `redis-overview` —— 屏 A 连接总览七区块 + `connectionHome` 槽位 + `memory_sample` 扩列。Bug 循环 2 轮（第 1 轮 3 条待修复 → 修复 → 第 2 轮 TEST_DONE）→ `1e26c8003`。
  - `redis-kvbar-ui` —— 状态条 + 键属性侧栏 + 契约 F-2 中继接线（`contextBar` 全量版另立第二段 #69）。Bug 循环 3 轮（BUG-001~006），第 3 轮仅剩 1 条测试侧竞态，按相称性裁定**免第 4 轮 Tester**、由协调者合流复验 64 次 0 红 → `b1e991ab1` + 合流修复 `01d3ad269`。
  - **合流期新增缺陷（不属任一轨）**：两轨各自往 `ui/shared/meta.ts` 的同一个 `redisMeta` 对象里加了一个**同名 `kvWorkspace` 键**（相隔 15 行 ⇒ git 静默自动合并），运行时后者覆盖前者 ⇒ 状态条与侧栏能力位归零、两槽整体不渲染且无运行时报错；`tsc` 以 TS1117 拦住，双闸门护栏 `kvSlotRegistration.test.ts` 首跑 4 例红抓到它。`resolve-drivers.mjs` 的 `kvSlots` 块同形（那处是真冲突，手工合）。
  - **Wave 2 未完部分**：`redis-kv-contract`（#70，`KvSlotState` 按裁定 F-2.1 加宽，只加 workbench 私有事实且 getter 必须返回标量）→ `contextBar` 全量版（#69，消费新 getter；反向动作通道需先过协调者裁定）。
- **Wave 3**（2026-09-23）：
  - `redis-tree-backend` / `redis-kv-contract` / `redis-codec-write` / `redis-console-safety` / `redis-kvbar-ui` / `redis-overview` / `driver-ui-type-gate` / `redis-tree-ui` / `redis-detail-ui` **九轨全部已合入**（E 轨合流 `1135b2ff4`）。Wave 3 收口。
  - **E 轨合流的第二次语义冲突**（`RedisWorkbench.tsx`，9 hunks，比 `BatchBar.tsx` 那次更深）：E 基于旧 base（705 行）把 I-1 守卫加到 795 行，D 已把同文件拆成 369 行 + 抽出 `useKeyDetailState`/`useKeySelection`/`useWorkbenchSearch`/`KeyTreePane`/`WorkbenchToolbar`/`DbSidebar` 六个模块。**处置**：保留 D 的结构、把 E 的守卫语义**移植**进 D 的 hook/组件（`inPlace` 下沉到 `useKeyDetailState.selectKey`；`refreshKeys` 取 D 的 `clearFocus()` + E 的 `requestDraftLeave()`；`refreshAfterWrite`（D 的 I-8）不动；`refreshKeysForDialogs`（E 的防双弹）保留；`handleRefresh` 的**两道链式守卫**按 round2Probe P2 的钉保持不变）。合流 commit 干净（未卷入任何游离文件）。
  - **合流后首次全量 drivers 跑出 12 例红 —— 9 例是 testid 迁移未同步（语义零丢失）、2 例是真语义冲突、1 例是行数预算**（「两轨各自全绿、合流才暴露」的典型）：
    - **testid 迁移（9 例）**：`redis-refresh`→`redis-tree-refresh`、`redis-create-key`→`redis-tree-create-key`、`redis-no-ttl-only`→`redis-tree-chip-no-ttl`（最后一处 D 还把它从 checkbox 换成 chip `<button data-active>`，断言写法随之适配）。生产码语义完好——列头刷新按钮接的正是 E 加了守卫的 `handleRefresh`。**教训**：跨轨拆分/改名 testid 必须在 `progress.md` 登记「旧名 → 新名」对照，否则消费轨的旅程测试会在合流时集体失效。
    - **真语义冲突（2 例，I-1 vs I-8）**：批量写后的刷新走哪条路——走 D 的 `refreshAfterWrite`（只刷数据、保选择 = I-8）⇒ E 的 2 条守卫测试红；走 E 的 `refreshKeys`（过守卫 + `clearFocus`）⇒ D 的 I-8 用例红（失败键被刷掉勾选）。Rescuer 先写了「二选一」报告，**但没停在报告上**：判出 I-1 的触发条件（「动作会毁掉草稿」）与 I-8 的前提（「**干净态**刷新不清选择」）**互不重叠**，遂落成 `if (isDraftDirty()) { 守卫 → 拒绝即 return；否则 clearFocus } ; scanRefresh(); tree.refresh();` —— 两侧验收同时成立，无需协调者裁定。**协调者已用双向变异独立验证**：关闭脏分支 ⇒ E 的 2 条精确红（D 的 14 条不受影响）；干净路径也 `clearFocus` ⇒ D 的 I-8 用例红（`keeps the failed key checked after a partial batch TTL`）⇒ 分支确被两侧钉住，非「恰好没踩到」。**这是「语义冲突」协议的升级**：当两轨的验收面看似互斥时，先查两者的**触发条件是否真的重叠**，往往能构造出同时满足的解，而不是二选一。
    - **行数预算（1 例）**：E 的守卫使 `RedisWorkbench.tsx` 涨到 408 > D 的 `SOFT_FILE_LIMIT=400`（HARD 800 未破）。Rescuer 压缩重复注释（保留「为什么」）压回 **399/400**。**处置正确**：推荐上限是结构信号，不该为绿灯放宽断言。
  - `driver-ui-type-gate` —— 驱动 UI 纳入根 tsc（详见「跨轨风险」首条），并顺带修掉 2 个真实行为 bug；其中挖出 **`info_filtered` 假契约**事件并形成裁决 A。
  - `redis-tree-ui` —— R2 pattern 客户端过滤（glob 方言按 Redis `stringmatchlen` **字节级移植**，用真实 C 预言机 9216 例对拍 0 mismatch）+ 面包屑键盘旅程；Bug 循环 3 轮。
  - **合流期语义冲突（不属任一轨）**：`redis-tree-ui` 把 `BatchBar.tsx`（465 行）拆成 `batchInvokes.ts`（invoke 层）+ `useBatchActions.tsx`（对话框），而 `redis-tree-backend`（W3-B）在同文件把 `count_matching` 消费端升到冻结契约 `CountMatchingResult`（对象 + `truncated` ⇒ 标签渲染 `n+`）。D 轨从更早 base 分出 ⇒ 机械取任一整侧都会出事：取 D 侧静默把契约退回 `Promise<number>`（`[object Object]` bug 复发），取 HEAD 侧丢掉模块拆分。
  - **裁定与解法**：保留 D 的结构（拆分已验收），把 W3-B 的契约**移植**进 `batchInvokes.ts`（`invokeCountMatching` → `CountMatchingResult`、`formatMatchCount` 随迁、`useBatchActions` 渲染改走它），并把 W3-B 的回归测试按 D 的架构重写（`PatternStripHarness` = hook + strip + `actions.dialogs`，与原 workbench 挂载同形），**8 条断言一条不减**（含 `[object Object]` 反断言、`n+` 截断臂、`count_matching` 入参、切换清空陈旧计数）。
  - **教训**：同一文件被两轨以不同"切法"改动时（一轨拆模块、一轨升契约），git 的文本合并会**静默丢失语义** —— 判据必须是契约/语义（哪一侧的形状被冻结、被谁消费），不是"哪个分支更新"。合流前应查两轨是否都碰过同一文件的**不同抽象层**。
- **R 阶段**（待执行）：见下方「R 阶段清单」。

### Editor Productivity P0（集成分支 `feature/editor-productivity`，基准 `11c2f222a`）

- **Wave 0**（方案定稿）：产出 `docs/development/editor-pro-productivity-plan.zh-CN.md`（567 行）。
  五项锁定裁决：① Code Folding 落在 Pro，宿主只提供 compartment 槽位；② Split Pane 全部宿主侧；
  ③ Query History 保持 SQLite，**不**做云同步；④ **收藏改文件优先存储**（ULID 文件名 + `--` front-matter，
  退役 `favorite_queries` 表，目录树即同步单元，新增 `AppSettings.favoritesRoot`）；
  ⑤ **不做文件系统监听**，只保留三个手动刷新触发点（面板打开 / 同步或拉取后 / 手动按钮）。
- **Wave 1**（P0 地基，5 轨并行）：按**文件冲突面**而非功能相邻度拆轨。
  探针 G1 实证纠正了一处误判：Pro 侧 `isBareExternal` 的宽正则与宿主侧 `HOST_SHARED_MODULES` 的
  窄白名单之间的不对称是**刻意保留的探针**，不得「顺手统一」——统一会让新增 CodeMirror 包
  从「构建期硬报错」退化为「静默打进产物」。`ep-runtime-globals` / `ep-hooks-settings` / `pane-layout`
  三轨先行；`multi-cursor` 按用户裁决并入 Wave 1；`code-folding` 因与 `ep-hooks-settings`
  争用 `editorExtensions.ts` 的 compartment 闭集而排在其后建轨。
- **Track A 合流**（`46be145af`，Tester 判定 **FAILED**）：8 条验收标准**全部实测通过**，
  代码交付物正确可合入；4 次变异测试（删白名单项 / 删宿主表项 / 删 Pro 宽正则 / 白名单塞正则）
  证明两侧列表漂移方向的守卫是真闸门，其中「删 Pro 宽正则」在补测前是**漏的**。
  判定 FAILED 的唯一原因是发现两个**既有**结构性缺口（BUG-002 / BUG-003），均非本轨引入。
  合流时另发现两处基础设施缺口并已修复：Pro 侧**根本没有集成分支**（宿主集成态无法与 Pro 对齐），
  以及跨仓断言的 skip 条件把「目录存在」误当「检出在匹配 commit」——陈旧检出会给出
  看似代码缺陷的红灯，现已改为失败时自证出处（`d53b8f0bb`）。
- **基座追平（回合 3）**：合流前发现集成分支落后 `main` **7 个提交**，其中 `d14037e8b`
  删除了 `tsconfig.json` 的 `exclude`。**Wave 1 四条轨道与所有 Tester 的 `tsc` 结论都建立在
  一份已作废的 tsconfig 上**。已 `git merge main`（零冲突），并把 `main` 同步进
  `ep-hooks-settings` / `pane-layout` / `multi-cursor` 三条轨道分支（均零冲突），
  从根上消除「Tester 在错基座上重蹈覆辙」的盲区。**协调者此前基于旧配置测得的
  「1980 条测试文件类型债」是伪结论**——main 的 `d14037e8b` 已清掉，实测真门禁下
  合流态 `tsc` **0 错**。此前登记的 BUG-003 随之**关闭**。
- **真门禁的第一次兑现**：Track C 的两个新测试文件有 **7 处**类型错（夹具缺
  `QueryPanel.database/schema`、`TablePanel.database/tableSchema`、两处未使用导入、
  一处 `Partial<PanelState>` 转换）——**恰是 AGENTS.md 新门禁要防的「mock 与真实类型长期漂移」**。
  生产代码 0 错、1199 运行期用例全绿，纯夹具问题，已回退 Coder 修正。
  Track B 在真门禁下 **0 新增错误**（其 Coder 用临时 tsconfig 自验「本轨 0 错」属实）。
- **BUG-002 已修复并合流**（`ff103741b`）：根因是**闸门位置**而非白名单内容——Pro `renderChunk`
  （`enforce:'post'`，宽正则 `/^@codemirror\//`）先把具名/默认/命名空间导入改写成
  `__DATAZEN_HOST__['…']` 且**不查白名单**，窄闸门运行时输入已空。修法是在 `pack-ep.mjs` 增加
  **产物级**不变量：扫描**将要签名的字节**而非输入，挂在 `stagePackageTree`（**在
  `signEpPackage` 之前**）与 `createDzxArchive`（纵深防御），违规即 throw → exit 1，
  **无静默降级**。测试 35→55（+20）。合流后实测 `tsc` 整仓 0 错。
  **协调者端到端复验**（清暂存目录强制真正构建后）：
  干净基线 exit 0 / 7 键；注入 `@codemirror/search` **exit 1、无签名**；还原 exit 0。
  **复验方法本身踩了两个坑，须写进判据**：① 注入若只写 `import` 不引用会被 tree-shaking 吃掉，
  产物里根本没这个键，闸门自然放行——**必须注入即引用**；
  ② `resolve-pro` 在 EP **已暂存**时会跳过构建，此时测的是旧产物——**复验前必须清暂存目录**。
- **⚠️【方法论·已三次】探针键绝不能与被测修复共用同一份被修改的数据**。本项目在 BUG-002
  复验中连续栽了**三个方向**的错，根因同一：
  ① **假绿**：注入只写 `import` 不引用 ⇒ 被 tree-shaking 吃掉，产物里根本没这个键，闸门自然放行；
  ② **假绿**：`resolve-pro` 在 EP「已暂存」时**跳过构建**，测的是旧产物（须先
  `rm -rf src-tauri/resources/builtin-ep/sql-editor-pro`）；
  ③ **假阴性**（Track B Tester 独立发现，我原报判据作废）：复验探针用了 `@codemirror/commands`，
  而该键**已被 commit `5631f2bc8` 提升进白名单** ⇒ 照抄我的命令会看到「不抛错」，
  从而**错误判定修复无效**。改用修复前后**都非法**的键（`@codemirror/search` / `@codemirror/merge`）后
  9 种形态全拦、且对照组仍能签名。
  ⇒ **判据：探针必须选在修复前后都非法的键；且必须有「修复前红、修复后绿」双向证据。**
  第三例由 Track B Tester 以变异测试交叉确认：A 恰好 5 红（`createDzxArchive` 那条仍绿 ⇒ 两个调用点
  **独立**承重）、B 恰好 1 红、C 恰好 2 红**且含真实产物端到端那条**。
- **⚠️【中·闸门的对称盲区】共享模块「双副本」校验缺失**。产物级不变量只校验「产物里出现的每个
  `__DATAZEN_HOST__` 键都被允许」，**不**校验「某共享模块是否被**一致地**外部化**。若产物同时含
  `__DATAZEN_HOST__['@codemirror/language']`（宿主单例）与一份**自带副本**，闸门是**绿的**，
  但 CM6 的 `StateField`/`ViewPlugin`/`Facet`/`RangeSet` 均为 **class 身份** ⇒ 跨 realm
  `instanceof` 失败、`instance.of()` 误判、`Facet` provider 不被识别 ⇒ **静默行为异常，不抛错**。
  现状无实际风险（Pro 对该两包 0 导入），但 **Track E 一导入即变活风险**，已就此警告在途 Coder。
  缺的正是**产物级双副本断言**；现有 `sql-editor-pro peerDependencies stay inside the host shared set`
  校验的是**声明**（`package.json` peerDeps）**而非产物**，不能充当该证据。已排独立小轨。
- **【出处澄清】宿主表 9→11 来自 `5631f2bc8`，不是 BUG-002 修复**。`85594adb4` 只动 3 个文件
  （`pack-ep.mjs`、`pack-ep.test.ts`、规格文档），**未碰 `src/main.tsx`**。`5631f2bc8`
  `feat(ep): 补齐 @codemirror/language 与 @codemirror/commands 共享模块` 才是出处
  （`src/main.tsx` +12），**有意预授权**给 Track E 折叠（`@codemirror/language`）与 Track D 多光标
  （`@codemirror/commands`）。**Pro 侧并非「无消费者」**：Pro `package.json` 的 `dependencies` 为空、
  6 个 `@codemirror/*` 全在 `peerDependencies` ⇒ **已声明、待导入**。
  ⚠️ 我此前报「宿主表 11 键恒等」时**未点名该 commit**，导致 Track B Tester 合理地倒推为
  「安全修复顺带扩了表」——**表述缺出处是我的责任**，已订正。
- **✅【高】打包白名单「预改写」绕过 —— 三个独立来源收敛到同一处，已修复并合流**。
  **本轮最重要的结果：三名互不相关的 Tester/编码者各自独立发现了同一个缺陷。**
  ① Track B Tester 的 `ep-hooks-settings-BUG-001`（高）：Pro vite 的 `hostGlobalsPlugin` 在
  `enforce:'post'` 的 `renderChunk` 把裸 import 改写成 `globalThis.__DATAZEN_HOST__['x']`
  （判据 `BARE_SPECIFIERS.has(s) || /^@codemirror\//`，**不查任何白名单**）；随后 `pack-ep` 的
  `rewriteEpImportsToHostGlobals` **只扫「仍是裸形式」的 specifier** ⇒ 对已改写 key **零可见性**，
  第 1 步与第 2 步互不校验。② BUG-002 轨的 Coder 独立定位到同一根因。③ 协调者端到端复验。
  **修法与 Track B Tester 要求的「让宿主侧成为权威」完全一致**：`pack-ep.mjs` 增加**产物级**
  宿主键不变量，扫描**将要签名的字节**（`stagePackageTree` 内、`signEpPackage` 之前）+
  `createDzxArchive` 纵深防御，违规即 throw → exit 1、**不签发**。**未收窄任一侧的放行宽度**——
  保持 §五.8 声明的「Pro 宽放行 / 宿主窄白名单」之差。
  ⚠️ **两条独立的键数测量都对，但都对的是自己那条分支**：Track B Tester 报「宿主表 9 键」
  （其分支早于 Track A 合流）；集成分支实测为 **11 键**，与 `HOST_SHARED_MODULES` **完全恒等**，
  差集为空。⇒ **引用键数时必须声明分支**。
  ⚠️ 另注：BUG-002 复现用的注入 `import { foldGutter } from '@codemirror/search'` 在**语义上虚构**
  ——该导出并不存在于 `@codemirror/search`；但产物级不变量卡的是**键**（模块说明符）而非导出，
  故闸门有效性不受影响。今后注入验证请用**白名单外且导出真实存在**的模块。
- **【低】编辑器挂载时多发一次 8 槽位重配事务**（Track B `ep-hooks-settings-BUG-002`）。
  `SqlEditor.tsx:433-521` 的挂载 effect 调 `mountProCompartments` 装好 payload 却**从不写**
  `appliedPayloadRef`（`:529`，初值 `null`）；React 按声明顺序执行 effect，紧随其后的重配 effect
  （`:530`）守卫失效，**多发一次完整 8 槽位批**——**恰是 `:532-533` 注释断言不会发生的事**。
  实测各舱位工厂**各只调 1 次**，故影响面收窄为「多做一次 CM 配置重算」，不影响正确性、
  不在 <5ms 击键路径。已派 `feature/compartment-cleanup` 一并修。
- **【低】`proCompartments.ts:171` 的 `continue` 静态不可达**（Track B `ep-hooks-settings-BUG-003`）。
  进循环前提是 `extra` 已挂载，而已挂载的 `extra` 必然进 `directIds`、永不进 `overflow`
  （`extra` 属 `BASE_PRO_COMPARTMENT_IDS`，模块加载时已 `ensureProCompartment`）。
  这是 `proCompartments.ts` **分支覆盖率停在 93.33%**（行已 100%）的**唯一**原因。
- **🔴【高·潜伏】`focusedPaneId` 是全局单值而非按 tab 作用域，焦点跨 tab 泄漏**（Track C Tester 裁定
  TEST_FAILED，`pane-layout-BUG-001`）。`panelStore.ts:83` 的 `focusedPaneId: string | null` 是**单一
  全局字段**，而 pane 属于 panel；`ContentView.tsx:88` 把这一个值下发给当前 active 的**任意** panel；
  `panelStore.ts:378` 的 `closePane` **只比较 `paneId`、从不比较所属 `panelId`**。三条后果已用生产代码
  路径自动化复现（`paneFocusScope.tester.test.ts`，3 例全红）：①切 tab 路由到 `addPanel` 从未播种的
  幻影 key `panel-q-2::p2`，B 的 SQL 与结果无人读取，界面空白；②`updateSql` 走到该 key，而 `patchExec`
  对未知 key 会 `emptyQueryExecState()` **播种**（`queryExecActions.ts:86-90`），凭空生成**任何 pane 列表
  都未声明**的孤儿 entry，Execute 结果流进用户永远看不到的地方；③关一个 tab 的 pane 会抢走另一个 tab
  的焦点。**本波无分屏 UI，`focusedPaneId` 恒为 `null`，单 pane 行为确为零变化，故不判验收项 2 不通过；
  但 P2 一接 UI，①②立即变成用户可见的静默数据丢失。** 修复方向（per-panel 焦点 map vs `ContentView`
  按 active panel 过滤）已交回原 Coder 决定。
- **【中】`proCompartments.ts` 只存在于集成分支**（已逐分支核实：集成分支 291 行有；`main`、
  `feature/pane-layout`、`feature/multi-cursor` **均无**，该文件是 Track B 拆分时才创建）。
  ⇒ **跨轨协同时必须先确认对方分支是否含 Track B 拆分**。Track C Tester 曾据其分支如实报告
  「`proCompartments.ts` 不存在、`reconfigureProCompartments` 在 `editorExtensions.ts:121/827`」，
  那**不是事实错误，是分支差异**；协调者给 Track E 的指示则对其基座正确。两者都不矛盾。
- **【已决】Track E 不 bump `EXTENSION_POINTS_VERSION`（保持 1.1.0）**。Coder 报请裁决：为把折叠扩展
  定向送进宿主 `fold` 槽位需在 `SqlEditorEnhancedFeatures` 加**可选**方法 `createFoldExtensions`，
  是否需 1.1.0→1.2.0？**裁决：不 bump**。因 `security.ts:136-151` 是**精确字符串相等**（无 semver 区间、
  无协商窗口），bump 会让所有 manifest 仍写 1.1.0 的 EP 被**整体拒签**，属跨轨兼容性变更。
  「可选方法 + 不 bump」双向安全：旧 EP 缺方法 ⇒ 宿主 `?? []`；旧宿主不认该槽位 ⇒
  `proCompartments.ts:172-178` 并入 `EXTRA_COMPARTMENT_ID` **溢出槽**——该槽本就是为「EP 声明了
  view 构建后才出现的槽位」设计的（见 `:147-152` 注释），故最坏情况是退化到 `extra` 继续工作，
  **不会静默消失**。⇒ **Track A 无需为本轨改 `src/main.tsx`，Pro 侧 manifest 也不用动**。
  另核实：折叠所需 API（`foldGutter`/`foldService`/`codeFolding`/`foldState`/`foldEffect`/
  `unfoldEffect`/`foldable`/`foldNodeProp`/`foldKeymap`/`unfoldAll`）**全在 `@codemirror/language`**，
  该包已在双侧白名单；`@codemirror/search` **一个 fold 相关的都没有**。⇒ 本轨不触发 BUG-002 隐患。
  （附带更正：BUG-002 复现用的注入 `import { foldGutter } from '@codemirror/search'` 在**语义上是
  虚构的**——该导出不存在；但产物级不变量卡的是**键**（模块说明符）不是导出，故闸门有效性不受影响。）
- **【中】`multipleSelections.ts` 的 `eventFilter` 含静态死臂（既有代码，Track D Tester 8 组合穷举证死）**：
  三个析取项**恒等于 `e.altKey`**——第 2、3 项都要求 `altKey` 为真，却只在 `altKey` 为假时才被求值，
  故**恒假**。这既解释了该文件 branch 覆盖率长期停在 26.31%，也会让人误以为
  「Cmd+Option 拖拽有额外支持」。建议单开清理项。
- **【中】`new-feature-worktree.sh` 应内置「补齐 gitignored codegen」（Track D Tester 建议）**：
  本轮先后踩了 `src/extensions/generated*.ts`、**`src/locales/builtinLocales.ts`**、
  `src-tauri/capabilities/default.json` 三层缺件，最后一个 worktree 需手工补齐才能跑出真实基线。
- **Track D 交付**（`c37bc0848`，3 文件 +612/−17，未合流）：红→绿证据扎实——源码回退 HEAD 后
  `9 failed | 11 passed`，Down 那条 `from: 13` 正是 `copyLineDown` 吃掉按键的指纹。
  copy-line 未被放弃：Win/Linux 走 `Mod-Shift-Arrow*`（不提权），macOS **主动让位**给原生
  `Cmd+Shift+↑/↓`（selectDocStart/End），另给四修饰键 `Alt-Shift-Mod-Arrow*`。
  **Coder 实测推翻了协调者先前的 Mod-d 裁定**：真正恒不命中的是 `Shift-Mod-d` / `Shift-Mod-D`，
  而 `Mod-d` / `Mod-D` 都活着——因字符键在 `runHandlers` 主查表**排除 Shift**，带 Shift 前缀的
  键名根本没机会被查。处置：四条全留、零行为改动。**另修正 spec §1**：`Shift-Alt-ArrowUp` 无
  mac 变体，冲突在**所有平台**存在，不只 macOS。
- **codegen 缺失的跨 worktree 陷阱（两轮才定位准）**：Track D 的 worktree 报 174 个文件级失败
  + 28 条 tsc 错。协调者第一轮判断根因是缺 `src/extensions/generated.ts`，补入后**仍有 104 文件 /
  160 用例红**，且大量条目显示 `(0 test)`（收集阶段失败，非断言失败）。**真凶是
  `src/locales/builtinLocales.ts` 缺失** —— `Failed to resolve import "./builtinLocales" from
  "src/locales/index.ts"`。逐 worktree 实测：**`datazen-multi-cursor` 是全仓唯一缺失者**，
  因为它建得较早，当时 `new-feature-worktree.sh` 还没有「内置 locale codegen」这一步。补齐后
  该文件由 `(0 test)` 恢复 13 passed。
  **教训：`(0 test)` / 收集阶段失败 ≠ 断言失败，必须先跑一个失败文件拿真实错误再下结论；
  新建 worktree 必须同时核 `src/extensions/generated*.ts` 与 `src/locales/builtinLocales.ts`。
  参照基线：同基座的 `datazen-pane-layout` 为 463 文件 / 4589 用例全绿。**
- **Track B 合流**（`1837096f0`）：宿主 12 文件 + Pro 4 文件；Pro 侧 `63b212a`
  已合入 Pro 集成分支 `productivity/editor-productivity`（现 `967fdbd`，含 A+B 两侧）。
  双侧 `extensionPointsVersion` 均 `1.1.0`（已实测核验），合流后 `resolve-pro --edition=pro` 打包正常。
  已派发独立 Tester。
- **协调者自有基建修复：hub 聚合器三个同源解析缺陷**（`状态` 因 Markdown 强调标记恒不匹配、
  `Pro 分支` 子串覆盖宿主分支、开放 Bug 正则把 `(?:`\*\*`)` 放在冒号之后导致按规程登记的 Bug 一条都数不到），
  修复于 `9a9027531` 并补 5 例回归测试；pre-commit 钩子此后自动执行该测试。


## 跨轨风险


- **根 `tsc` 对驱动 UI 全盲** — ✅ **已关闭**（`driver-ui-type-gate` 轨 TEST_DONE，合流 `5524f8dce`）：`tsconfig.json:26` include 追加 `packages/drivers/*/ui`，`--listFiles` 实测驱动 UI 生产文件 109 个入程序、`__tests__` 混入 0；清掉 11 条生产 `error TS`（全在 `SearchableInfoPanel.tsx`：TS2345×7/TS6133×2/TS2322×1/TS2488×1；`consoleResultRenderer.tsx` 实测 0 条，非 1 条）。清理中挖出并修掉 2 个**真实行为 bug**（非纯类型）：`variant="outline"` 非法枚举值致按钮无样式、`reconstructInfo` 元组/对象解构错配致结构化回复被静默吞并二次 IPC。合流后 integrate 树 `npx tsc --noEmit` 0 错。
  - **残余**：驱动 UI `__tests__` 仍有 **42 条 error TS / 19 文件**未清，经由根 tsconfig 既有的 `packages/**/__tests__/**`、`*.test.*` exclude 豁免（与宿主测试同规则）⇒ 测试侧类型错误仍在门禁外，留作独立轨。文件行数自动门禁仍缺（仓内无）。
- **`info_filtered` 的 wire shape 曾是"假契约"**（跨轨实证，裁决 A，合流 `5524f8dce`）：后端 `InfoSectionFiltered.entries` 原为 `Vec<(String, String)>`（serde ⇒ `[["k","v"]]` 元组数组），但前端**两个**生产消费端（`observe/SearchableInfoPanel.tsx` 的 `reconstructInfo`、kv-bar `keyObjectInfo.ts` 读 `maxmemory_policy`）与全部 fixture 都按**对象** `{key,value}` 写——线上零转换（`json_ok`→宿主透传→`unwrapData`→`as` 断言）。后果：kv-bar 淘汰策略行在真连下**永远不渲染**（`entry.key` 恒 undefined ⇒ find 不中 ⇒ 按 §3.4 静默降级），且 type-gate 轨 round-1 的"真实 bug 修复"一度把前端改向对象、被 round-2 Tester 以「mock ≠ 真实 IPC」判 FAIL。
  - **协调者裁决 A**：后端改为对象（新增 `InfoEntry { key, value }` struct、`entries: Vec<InfoEntry>`、`en.ts` 不动）+ serde pin 测试 `test_info_filtered_entries_serialize_as_objects` 钉死对象形状；前端**零改动**（本就按目标契约写）。理由：仓内元组消费者为零，kv-bar 已合流且按对象写，对象更自描述。
  - **教训（Wave 4/后续轨通用）**：fixture 里"对方说这是真实 wire shape"的**注释不是证据**——凡是跨 IPC 的形状，必须有一侧（首选后端 serde 单测）钉死契约，否则前后端各按自己的假想写、测试全绿而真连静默降级。Wave 4 消费 W3-B 冻结契约时逐字引用 `progress.md` 的契约段，不要从 fixture 反推。
- **预算口径**：BUG-003 修复后 `count_matching` 降级路径的 `consumed` 会从 0 变一轮真 SCAN——Wave 4 判"DBSIZE 快答"须用 `dbsize > 0 && consumed == 0`，不能只看 `consumed == 0`。
- **Wave 2 契约已冻结**：`type_distribution` / `key_object_info` 的声明面（字段与类型）与 `b1e1f4010` 逐字节相同，UI 侧照 W1-A progress.md 的契约段消费，不得反向要求后端改形状。
- **Cluster 往返预算不是"一次 pipeline"**：standalone/sentinel `key_object_info` = 2 次往返，Cluster = 7 次；`type_distribution` 在 Cluster 采样窗硬限 200。UI 必须渲染 `truncated` 的"采样 N/M"标注，否则会把采样读成精确分布。
- **Cluster 键树仍不可用**（基线缺陷 #56）：既有 `list_children` 在 Cluster 下同形 CrossSlot，Wave 2 不要在键树里假设 Cluster 可用，需在 UI 上给出降级提示。
- **驱动不得 import `src/**`**：`KV_SLOT_NAMES` 之类宿主常量在驱动侧不可见，用 driver-sdk 的 `KvSlotName` 或由宿主把判定结果作 props 传入（W1-B 已按此形状生成槽位）。
- **文案改动无护栏兜底**：护栏已删，"新测试零可见英文字面量"退化为纯人工评审口径（原则六）；派单时把该口径写进 Coder/Tester 验收标准，不要再提议脚本。
- **并行轨往同一个对象字面量加"同名键"是最坏的合并面**：git 会静默自动合并（不同 hunk），JS 只保留最后一个键 ⇒ 另一轨的贡献整块消失且不报错。派单前必须在 `progress.md` 写明"本轨往哪个对象的哪个键里写"，合流时逐个人工比对。已知三处：`ui/shared/meta.ts` 的 `kvWorkspace`、`scripts/resolve-drivers.mjs` 的 `kvSlots`、`packages/drivers/redis/locales/en.ts` 的扁平 key 表（key 表因 key 名互斥才安全）。`#69 contextBar` 全量版会同时碰这三处，合并顺序排在 `#70` 之后。
- **同一文件不同抽象层的语义冲突**（W3 合流实证，`BatchBar.tsx`）：一轨拆模块、另一轨在同文件升契约时，git 只报少量文本冲突，**机械取任一整侧都会静默丢语义**。裁决依据必须是「哪侧形状被冻结/被谁消费/有无守卫测试」，保留结构方 + **移植**语义方，并把守卫测试按新结构重写（断言一条不减）。合流前用 `git log <merge-base>..<other> --name-only` 取交集逐文件判「文本 or 语义」。详见 `docs/development/subagent/coordinator.md` §6.1.1。
- **验收句禁用析取式**（W3-E 实证，`redis-detail-ui` BUG-007）：写「消解**或**有界」等于给「只做一半」发通行证 —— 该 bug 只做了有界就过闸，残留态下点保存会**写到陈旧键名**（`SET … "user:1"` 而屏幕显示 `user:renamed`，静默写错键 + 复活已 RENAME 的旧键），到第 3 轮才被探针实测揪出（详见 `coordinator.md` §3.3 第 5、6 条）。**派单硬口径**：验收句只写唯一期望终态；确实接受两形态时，分别写清各自的验收锚点。同轮 Tester 的变异 (iii)「答 keep 也放行」在析取断言下**全绿**（假阴性），须自建探针才照出 —— 凡「注入后仍绿」一律按测试强度缺陷立案。
- **工具相对路径陷阱**（W3 实证，`redis-src-split` 主动上报）：`read`/`grep`/`glob` 传**相对路径**时解析到**主检出**（`main`），不是子代理的 worktree。实测：同一 `packages/drivers/redis/src/ops.rs` 在主检出 **1172 行**（含 `set_string_with_options`）、在基线 worktree **1124 行**（无该函数）；`main` 与 `d049ceb4e` 分叉 **18 / 219** 提交。⇒ 派单简报必须写明「一律绝对路径」；协调者复核同样遵守。详见 `coordinator.md` §2.0。
- **`Cargo.lock` 的 ` M` 漂移不是 codegen 残留，是真实 lockfile 失同步**（W3 实证，此前被误判并反复 revert）：`cdcfdc833` 把 `flate2` 加进 `packages/drivers/redis/Cargo.toml`（`decode/compress.rs` 真的用它），但**已提交的 `Cargo.lock` 里 `datazen-driver-redis` 依赖列表没有 `flate2`** ⇒ 每次跑 cargo 都会重写那一行 ⇒ 每个 worktree 测完都显示 ` M Cargo.lock`。**正确处置**：把该行提交（已由协调者在集成分支修正），而不是 revert。判据：`git diff Cargo.lock` 只含依赖名增删（如 `+ "flate2",`）时是同步，含版本漂移时另议。
- **merge 态下索引即提交内容**：merge 未完成时 `git commit` 会把**整个索引**写进 merge commit，任何游离的 staged 改动都会被静默卷走（本项目已两次踩中：`Cargo.lock` 被 W3-B 合流卷走、`coordinator.md` 险些被 E 轨合流卷走）。**规则**：merge 进行中，协调者不得在该 worktree 里暂存任何无关改动；提交方必须只 `git add` 冲突文件，并在提交后用 `git show --stat HEAD` 自查变更列表。

- **`local-link` 分支跳过 EP 契约版本闸门**（协调者实证，非缺陷，按用户裁决维持现状）：
  `packages/extension-points/src/security.ts:237-239` 在 `checkEngineCompatibility`（`:241`）之前
  early-return，故**无签名**的 Pro 包不受版本闸门约束。实测同一份 `extensionPointsVersion: 99.99.99`
  的清单，`dzx` → `ok:false / engine-incompatible`，`local-link` → `ok:true`。
  判据只有「是否带签名」一项（`sourceKind: pkg.signatureContent ? 'dzx' : 'local-link'`）。
  正常 pro 流程产物带签名（`signature.sig` 存在）故闸门生效。已按实测修正
  `scripts/resolve-pro.mjs` 的生成注释（`0e64b9af9`）；`security.ts` 顶部的信任优先级措辞
  待 `ep-hooks-settings` 交回后一并修正（该文件在跑轨道持有）。
- **EP 契约版本 bump 必须与契约改动同批次**：`EXTENSION_POINTS_VERSION` 现为 `1.0.0`，
  `checkEngineCompatibility` 用**精确字符串相等**（无 semver range、无协商窗口），失配即静默降级
  community（仅 `console.error`，用户只看到功能凭空消失）。`ep-hooks-settings` 交付后，
  合流时必须同步在集成分支的 Pro 侧 bump 并重签。
  已排查：仓内两处硬编码 `'1.0.0'`（`epHotplugJourney.test.ts:263`、`pack-ep.test.ts:44`）
  均为打包/签名测试的 fixture，不走版本闸门，不会被 bump 误伤。
- **多光标死键的真实机制是挂载顺序，不是代码结构**（Track D 实证）：
  `pasteExts` 在 `SqlEditor.tsx` 扩展数组中排在 `createBaseEditorExtensions`（内含 `defaultKeymap`）
  **之后**，CodeMirror 6 同优先级下先注册者胜，故 `Shift-Alt-ArrowUp/Down → addCursorAbove/Below`
  在 macOS 上被 `defaultKeymap` 的 `copyLineUp/Down` 吃掉。既有测试零覆盖
  （只直接调 `selectNextOccurrence(view)`，绕过 keymap 分发），故死键从未被测出。
  修复限定在 `multipleSelections.ts` 内用 `Prec` 提权，**禁止**改 `editorExtensions.ts` / `SqlEditor.tsx`。
- **`compartments` 是模块级共享单例的固定闭集**（`statement, completion, intention, hover, paste, linter`），
  新增槽位（如 code-folding 的 `fold`）会改动所有轨共用的 `editorExtensions.ts`。
  这是 `code-folding` 必须排在 `ep-hooks-settings` 之后的唯一原因；单实例测试不足，
  需覆盖多实例共享该单例的场景。
- **【流程】Coder 死亡计数经用户指令于回合 3 全部重置为 0**（2026-09-24）。此前 A/B/C/D 四名 Coder
  在回合 2 各因**上下文耗尽**（非服务错误）失败一次，D 在回合 3 又失败一次。本 initiative 自身的
  死亡计数从此基线起算，不追溯；重置后一律走「死亡 ≤3 次 → 原实例发『继续』」路径，
  不触发 Rescuer。**根因是死亡免疫协议被违反**：Track D 的 Coder 一次性产出约 8000 字分析、
  在长思考区间无落盘，回合 3 死在「跑全量套件」这一步。已据此收紧派发简报：
  收口类步骤（提交 / 跑门禁 / 写台账 / 回报）单独成一条简报，不与分析混在同一回合。
- **【高】窄白名单闸门被 Pro 侧 `renderChunk` 旁路（Track A Tester 实证，BUG-002）**：
  spec §二 声称的「unmapped 包构建期硬失败」在真实流水线里**对具名/默认/命名空间导入不成立**。
  Pro `vite.config.ts` 的 `renderChunk` **先**把任何 `/^@codemirror/*` 改写成
  `__DATAZEN_HOST__['…']` 而**不查白名单**；宿主窄闸门**后**跑时输入已被清空
  （日志「rewrote bare imports:」**恒为空**）。实测注入
  `import { foldGutter } from '@codemirror/search'` 后 `resolve-pro --edition=pro`
  **exit 0**，产物含宿主表没有的键且**签名照签**，运行期解构得 `undefined` → EP 加载即 TypeError。
  35 个测试全绿，无一发现。对照组（副作用导入）正常 exit 1 ⇒ 闸门没坏，只是被旁路。
  **直接后果：Track E（代码折叠）开工前必须先落 BUG-002** —— 它要写的
  `import { foldService } from '@codemirror/language'` 正是具名导入，恰好落进旁路区。
  Tester 给出的三个方向里，**方向 2（在 pack-ep 加产物级「键集合 ⊆ 白名单」不变量）最省**。
- ~~**【高】白名单与宿主表不等（曾登记为 BUG-004）—— 已撤销，不成立**~~：协调者一度测得
  `HOST_SHARED_MODULES` 11 键、`src/main.tsx` 宿主表 10 键，差集恰为 `react`，据此登记为
  「走白名单自身的第二处活旁路」。**该测量有缺陷，结论撤销**：所用正则
  `'([^']+)'\s*:` **只匹配带引号的键**，而 `src/main.tsx:58` 的 `react: reactAll` 是全表
  **唯一不带引号的键**，正好被漏掉。改用同时接受两种形态的解析后实测：宿主表 **11 键**，
  与 `HOST_SHARED_MODULES` **完全恒等**，两侧差集均为空。Coder 独立测得同一结论，
  并拒绝「为了把不变式凑红而修改任一侧清单」——处置正确。
  **同一正则缺陷也污染了另一项测量**：协调者报「产物 6 键」，真实为 **7 键**，漏掉的
  恰是 `react`，因为它在已发布产物里是**点号式** `__DATAZEN_HOST__.react`。
  ⇒ **教训：统计 JS 对象键或产物键时，必须同时接受带引号与不带引号的两种形态**，
  且计数不符时应先怀疑自己的解析器，而不是急着下高危结论。
  保留价值：BUG-002 轨的产物级闸门**同时读取两份列表**并对「声明了却从未发布」单列报错，
  该架构意图成立，未来若两份列表真的分叉会被立即抓住。
- **【中】测试文件事实上不在类型门禁内（BUG-003）**：`tsconfig.json:27-34` 的 `exclude`
  仍在排除 `src/**/__tests__/**` 与 `*.test.ts(x)`，但 `AGENTS.md` 明写「测试文件参与类型检查」
  —— **文档声称的改动从未落到配置**。协调者实测：放开 exclude 后全仓 **2281 条**错误，
  其中 **1980 条在测试文件**（主因 TS2339 属性不存在 1638 条，即 AGENTS.md 举例的
  「mock 与真实类型长期漂移」）。当前基线 `tsc --noEmit` 是 **0 错**，
  改 exclude 会一次性砸进 4 条在跑轨道的 Tester 信号里，故本轮不动，已升级为待裁决项。
- **B × D 相邻但未交叠**（协调者交叉校验）：`ep-hooks-settings` 改了
  `src/components/sql-editor/paste/createPasteExtensions.ts`（为 G3 通用路径新增 `proSettings`
  选项并透传给 EP），`multi-cursor` 改的是同目录的 `multipleSelections.ts`。两文件不重叠，
  且 B 的改动是纯增量、未改 `[...multiCursor, ...enhancedPaste]` 的顺序。但二者**同处多光标的
  挂载链路**上：若 B 的 EP 路径后续也贡献 keymap，优先级关系会变。故两轨 Tester 判定时都须确认：
  EP 侧不会引入与多光标同键位的新绑定。


## R 阶段清单


- [ ] 全量回归：`npx tsc --noEmit` + 宿主 vitest + `pnpm test:unit:drivers` + `cargo test -p datazen --lib`（W2 合流时已跑过一遍：tsc 0 错、宿主 451 文件 / 4658 例、驱动 47 文件 / 456 例 ×3、Rust 1454 通过 / 3 ignored + `datazen-driver-redis` 239 / 4；R 阶段仍需在主检出复跑一次）。
- [ ] `node scripts/check-driver-import-boundaries.mjs --root` 在**主检出**复跑（worktree 缺 gitignored 的 git 驱动与 pro-extensions，结果不完整）。
- [ ] **真连 Cluster 侧证 9a**：redis-cmds-p0 BUG-007 只有进程内复测，`route_command` 那一行不可证伪 ⇒ 需真集群 MONITOR 核对每条命令的落点，通过前该条不自关闭。
- [ ] **真连 Cluster 9e**：`list_children` CrossSlot 基线缺陷（#56）复现并裁定归属。
- [ ] SELECT 哨兵项：`select_db` 按 `current_db` 短路（#55，P1 候选）在真连下确认少 1 次往返。
- [ ] Wave 2 全部 GUI 走查（上下文条 / 键属性侧栏 / 屏 A 让位）留待人工，单测不替代。
- [ ] `RedisWorkbench.tsx`（680 行）拆分与 `cluster_topology.rs`（1164 行）、`ops_workbench.rs` 测试文件拆分（800 行红线）；**+ W3-B 的 `ops_tree_scan.rs`（修复轮后 988 行，建议切 `ops_tree_scan/{batch,page}.rs`）与其 `tests.rs`（1072+ 行）**。
  - ✅ **Rust 侧已完成**（`redis-src-split` 轨）：8 个超限文件全部目录化（`ops_tree_scan/tests.rs` 2394、`ops_workbench/tests.rs` 1602、`ops.rs` 1124、`connect.rs` 1091、`cluster_topology.rs` 1164、`ops_tree_scan.rs` 988、`ops_workbench.rs` 1070、`ops_stream.rs` 975），`packages/drivers/redis/src/` 已无 >800 行文件（最大 787 `commands.rs`）。**未做**：`ui/console/consoleCompletion/commandMeta.ts`（873 行，TS 侧静态命令元数据表，按 group 切时用「导出聚合对象逐键不变」做等价校验）。
- [ ] **I-10 响应式三级断点（740/340/240px）未实现 —— 属键树列头（D 轨）缺口，非上下文条**：PRD §4 I-10 原文是「**列头动作**容器查询断点 740/340/240px：文字标签 → 纯图标 → 溢出菜单」。实测 `KeyTreeHeader.tsx`（176 行）零响应式标记（`ResizeObserver`/`@container`/`matchMedia`/断点 全 0 命中），动作区恒为图标+文字。`redis-kv-context-bar` 轨已按契约能力（宿主只给一个 `boolean compact`）实现**有序两级**降级，不属该缺口。补三级需在列头侧用容器查询或扩 `KvContextBarProps`（后者需协调者裁定，因契约属 W3-A 冻结面）。
- [ ] **契约加宽的测试桩护栏**（`redis-kv-context-bar` 轨实证）：W3-A 把 `KvSlotState` 从 5 成员加宽到 10 getter 后，**6 个既有测试文件的本地 `makeRelay()` 桩从未同步**，而 `tsconfig.json:27-33` 把 `packages/**/__tests__/**` 排除 ⇒ `tsc` 结构性看不见；直到该轨 statusBar 读 `getLoadedCount()` 时以 `getSnapshot is not a function` **爆 30 例红**才暴露。**建议**：加一条用 `satisfies KvSlotState` 构造一次中继桩的编译期护栏（放非 exclude 的测试辅助文件），让下次契约加宽在**构建期**而非随机某轨的运行时爆出。
- [x] ~~驱动 UI 纳入类型门禁~~ — ✅ **已达成**（`driver-ui-type-gate`，合流 `5524f8dce`）：11 条存量生产 `error TS` 已清、`packages/drivers/*/ui` 已进根 `tsconfig.json` include、合流后 integrate 树 tsc 0 错。**剩余**：驱动 UI `__tests__` 的 42 条 error TS / 19 文件仍被既有 exclude 豁免（另立轨）；自动单文件行数门禁仍未建。
- [x] ~~`RedisWorkbench.tsx` 行数~~ — 已由三轨共同消化：E 轨后 787 行、D 轨侧 369 行（E/D 合流后以实际为准，≤800 维持）。**未完成**：`cluster_topology.rs`（1164 行）、`ops_workbench.rs` 测试文件（1070+ 行）、`ops_tree_scan.rs`（988 行）与其 `tests.rs`（1072+ 行）的拆分留 R 阶段。
- [x] ~~轨道 worktree / feature 分支清理~~（三条已合入的可在 R 阶段末删除）：`redis-tree-backend`、`redis-kv-contract`、`redis-codec-write`、`redis-console-safety`、`redis-kvbar-ui`、`redis-overview`、`driver-ui-type-gate` 共 **7 条**已清理；剩 `redis-tree-ui`、`redis-detail-ui` 两条在飞，合流后清理。

- [ ] Editor Productivity Wave 1 五轨全部 `TEST_DONE` 后，在**主检出**复跑全量：
      `npx tsc --noEmit` + `npx vitest run`（宿主）+ `pnpm test:unit:drivers` + `cargo test -p datazen --lib`。
- [ ] `node scripts/check-driver-import-boundaries.mjs --root` 在**主检出**复跑（worktree 缺 gitignored 产物）。
- [ ] 合流后强制走一次完整 Pro 打包：`rm -rf src-tauri/resources/builtin-ep/sql-editor-pro &&
      node scripts/resolve-pro.mjs --edition=pro`，确认产物带 `signature.sig` 且
      `engines.extensionPointsVersion` 与宿主 `EXTENSION_POINTS_VERSION` **同步 bump 后**一致。
- [ ] **裁决 BUG-003**：`tsconfig.json` 的 exclude 与 `AGENTS.md` 声称的「测试参与类型检查」矛盾；
      放开后 1980 条历史错误待清。需用户裁决是修文档还是清债。
- [ ] **合流前须落 BUG-002**（Track E 的前置）：修复轨 `feature/pack-ep-key-invariant` 已开，Coder 8ff5a178 在跑。
- [x] ~~裁决 BUG-003~~ **已关闭**：main 的 `d14037e8b` 早已删除 exclude 并清掉 2014 错，实为集成分支基座过时所致。
- [ ] `src/components/sql-editor/**` 位于 `vitest.config.ts` 覆盖率门禁**之外**，
      故该目录「测试通过」是弱证据；每个涉及该目录的轨道，Tester 必须显式测量改动行覆盖率。

