# Track: redis-host-slots — 宿主 KV 槽位与能力判定（去硬编码）

- 分支: `feature/redis-host-slots`（基准 `feat/redis-workspace-ux` @ ae65ae375）
- 角色: Coder → Tester（已复测）→ Coder（第 1 轮修复）→ Tester（待复测）
- 状态: **READY_FOR_TEST**（Tester 复测 PASSED 后，3 条非阻断 Bug 由第 1 轮 Coder 修复完成，见 §修复记录；
  等待全新 Tester 实例复测确认后方可合流。F-1/F-2/F-3 保留符号与 4 个 DOM 标记未改名，仍可按现状冻结）
- Worktree: `.worktrees/datazen-redis-host-slots`
- 规格: `docs/todo/redis-workbench-ux/PRD.md` §3.0、§3.4、§7-1/2/4、§8-1（P0 ⑥）

## 背景

Redis 面板下顶部 48px 工具栏只剩右侧簇、中间被 `flex-1` 撑成空带（P-1），底部状态栏同样空（`ContentView.tsx` 传 `tableName/columnCount/totalRows` 在 KV 下为空），右上角 `DetailPanelToggle` 在 KV 下判定为 applicable 但抽屉内容是空数组 ⇒ 死按钮（P-3）。根因是**这些槽位是为 SQL 面板设计的，没有 KV 对应内容**，而且判定掺了驱动专属字面量。

本轨只做一件事：**把宿主从"不知道有 KV 这回事"改成"按能力开槽位"**，并修掉死按钮判定。驱动的槽位内容（上下文条长什么样、屏 A 有哪些卡）属 Wave 2，**本轨不写**。

## 范围

1. **能力判定归一**：宿主 KV 判定改为读 `DatabaseTypeMeta` 能力位，不再靠 `activePanel?.type === 'redis-db'` 这类驱动专属字面量做主判定（现况 `useConnectionWorkspaceMeta.ts:98`）。若因面板生命周期必须先有 panel 才能拿 meta 而不得不保留字面量兜底，需就地注释说明为何不可省（AGENTS.md 状态机/三维影响度自查）。
2. **meta 新增能力位**（**唯一真源在 `src/lib/databaseMeta.ts`**，`packages/driver-sdk/src/index.ts:18` 是它的再导出，加字段只改一处）：
   - 建议形如 `kvWorkspace?: { contextBar?: boolean; statusBar?: boolean; keyPropsSidebar?: boolean; home?: boolean }`，全部可选、默认 `false` ⇒ 未声明的驱动行为与今天完全一致（**这是本轨的向后兼容判据**）。
   - 字段名可由你定，但必须满足：① 语义是"能力"而非"驱动 id"；② redis 之外零驱动受影响；③ 在 `redisMeta` 声明处（`packages/drivers/redis/ui/shared/meta.ts`，Wave 2 会补 true，本轨可先只加类型 + 在测试里用 fixture）留清晰 doc 注释。
3. **驱动贡献新槽位**（走既有 codegen 机制，**不得**在宿主 import 具体驱动组件）：
   - 现有机制：`scripts/resolve-drivers.mjs:184`（配置注释）、`:266-268`（redis 的 `connectionView` 声明）、`:391,463-468`（生成 import 与注册行）、`:653-660`（`DRIVER_CONNECTION_VIEWS` + `getDriverConnectionView`）。
   - 按同一形态扩展新槽位（`kvContextBar` / `kvStatusBar` / `keyPropsSidebar` / `connectionHome`），生成对应注册表 + lookup。**`src/extensions/generated.ts` 是 gitignored codegen，禁止提交**，只改生成器与模板。
4. **渲染接线**：
   - 上下文条槽位：KV 能力为真时，用驱动贡献的组件填满 `ContentToolbar.tsx:105` 那条 48px（左簇），右侧动作簇保留；未贡献 ⇒ 保持现状且不报错。
   - 状态条槽位：`ContentView.tsx` 的 `ContentStatusBar` 区（约 `:491-499`）同理。
   - **死按钮修正**：`detailPanelApplicable`（`ContentView.tsx` 约 `:143-146`、`ContentViewDrawers.tsx:21,41,131-134`、`ContentToolbar.tsx:48,196`）在 KV 能力为真时 ⇒ 抽屉内容切换为驱动贡献的**键属性侧栏**，而不是空表格；能力为假时行为不变。
   - 屏 A 让位：`ConnectionWorkspaceHome.tsx` 的 KV 分支（`quickActions` 在 `:273`、空区块门控在 `:337`）在驱动声明 `connectionHome` 能力时让位给驱动贡献组件；未声明 ⇒ 现有横幅页保持不动。
5. **测试**：宿主单测（`src/windows/connection/__tests__/**`、`src/lib/__tests__/**`）覆盖"能力真/假"两态 + "驱动未贡献槽位组件"的降级路径。**用测试 fixture 假组件，不引入真 redis UI。**

## 已侦察落点（仅供参考，务必自行核实）

- `src/windows/connection/useConnectionWorkspaceMeta.ts:24-29,94,98-107,155-160`
- `src/windows/connection/ContentToolbar.tsx:25-48,57-63,76-105,106,163,196`（`h-12 min-h-[48px]` 在 `:105`）
- `src/windows/connection/ContentView.tsx`（工具栏调用点、`detailPanelApplicable` 计算、`ContentStatusBar` 传参 —— 行号需自查，PRD 记为 `:143-146 / :397-416 / :491-499`）
- `src/windows/connection/ContentViewDrawers.tsx:21,41,81-111,131-134,145`
- `src/windows/connection/ConnectionWorkspaceHome.tsx:37,105,273-307,316-334,337-343,358,388`
- `src/lib/databaseMeta.ts:48-61`（`isKeyValue` / `connectionView`）、`:94`（`dbCountsCommand?: string` —— **能力位驱动的既有先例，照它的形态加新位**）
- `packages/driver-sdk/src/index.ts:18`（meta 类型的再导出）
- `scripts/resolve-drivers.mjs:184,266-268,391,463-468,653-660`
- `src/windows/connection/navigator/{buildFlatRows.ts:299, types.ts:69, NavigatorTreeRow.tsx:154, useKvDbCounts.ts:38}`（`dbCountsCommand` 全链路，作为"meta 声明 → 宿主查表执行"的参照实现）

## 禁止事项（防跨轨冲突）

- **不碰 `packages/drivers/redis/src/**`**（redis-cmds-p0 轨范围）。
- **不碰 `packages/drivers/redis/ui/**` 与 `locales/**`**（Wave 2 轨范围；本轨只加 meta 类型位与生成器配置，redis 侧的实际组件由 Wave 2 提供）。
  - 例外：若 codegen 要求 `ui/<path>` 必须存在才能生成，改为在**生成器里声明为可选贡献**，不要去 redis 包里造占位组件；确有阻碍时停下上报 BLOCKED。
- 不碰 `src/locales/locales.test.ts`、`packages/drivers/redis/ui/__tests__/ttlControlsJourney.test.tsx`（redis-assert-policy 轨范围）。
- 不提交 codegen：`src/extensions/generated.ts`、`src/extensions/generated-locales.ts`、`src-tauri/src/driver_init.rs`、`src-tauri/capabilities/default.json`、`Cargo.lock`、被注入的 `src-tauri/Cargo.toml`。
- 边界护栏：驱动侧不得 import 宿主 `src/**`（R1 blocking）；本轨若需要宿主能力（对话框/右键/设置读写）一律走 `@datazen/driver-sdk` 的 `bind*`/`useBound*` 桥，缺桥就先扩 driver-sdk。
- 单文件 800 行红线；`RedisWorkbench.tsx` 本轨不改。

## 验收标准

1. 能力位缺省（任何驱动未声明）⇒ 全站行为与本轨之前**逐像素一致**（现有宿主单测零红）。
2. 能力位为真 + fixture 贡献 ⇒ 上下文条/状态条/键属性侧栏/首页四处槽位分别渲染驱动组件，且 KV 下 `DetailPanelToggle` 不再是空白抽屉。
3. `npx tsc --noEmit -p tsconfig.json` 0 错误。
4. `npx vitest run src/windows/connection src/lib` 全绿（含本轨新增用例）；`npx vitest run` 整体不引入新红。
5. `node scripts/check-driver-import-boundaries.mjs`（`pnpm test:boundaries`）0 blocking；`pnpm test:ids`、`pnpm test:layers`、`pnpm test:ci-docs`、`pnpm test:version` 全绿。
6. `node scripts/resolve-drivers.mjs --codegen-only --drivers=basic` 后可用 `getDriverConnectionView` 同风格的 lookup 取到各槽位组件（本地验证生成结果，**不提交** generated 文件）。
7. 新增测试**零可见英文字面量断言**（PRD §7-6）：按 `data-*` / role / key 断言。

## 契约冻结（Wave 2 依赖，改动须回报协调者）

> 本节是 Wave 2 两个 UI 轨（redis-workbench-ui / redis-kv-slots-ui）的**开工前置**，逐字照抄即可。
> 类型真源：`src/lib/databaseMeta.ts`（meta）+ `packages/driver-sdk/src/types/kv-slots.ts`（props）。
> `packages/driver-sdk/src/index.ts` 只做再导出，**不存在第二份定义**；驱动侧一律 `from '@datazen/driver-sdk'` 取类型。

### F-1 meta 能力位（唯一真源 `src/lib/databaseMeta.ts`）

```ts
export interface KvWorkspaceCapabilities {
  contextBar?: boolean;        // 48px 内容工具栏左簇
  statusBar?: boolean;         // 底部状态栏中心簇
  keyPropsSidebar?: boolean;   // 详情抽屉 → 键属性侧栏
  home?: boolean;              // 屏 A：已连接无面板的落地页
}
// DatabaseTypeMeta 挂载点（全部可选，缺省 = false）
kvWorkspace?: KvWorkspaceCapabilities;
```

- **槽位名 ↔ 能力位映射只有一处不对称**：槽位 `connectionHome` ← 能力位 `home`（其余三个同名）。
  真源是 `src/lib/kvWorkspaceCapabilities.ts` 的 `capabilityKeyForSlot()`，宿主代码里**不存在**手写字面量分支。
- 判据：`hasKvSlotCapability(meta, slot)`；`meta` 为 `undefined`（未知驱动）
  与 `kvWorkspace` 缺省都返回 `false` ⇒ mysql / postgresql / sqlite / mongodb / clickhouse… 行为逐位不变。
  （BUG-001 修订：原聚合便捷位 `hasAnyKvSlotCapability(meta)` 因生产零调用者已删除，宿主能力判定一律
  按槽位逐个走 `hasKvSlotCapability(meta, slot)`；Wave 2 若要"任一 KV 面是否存在"的聚合判定，就地
  `KV_SLOT_NAMES.some(...)` 即可，宿主不再提供该函数。）
- **Wave 2 声明位置**：`packages/drivers/redis/ui/shared/meta.ts`（该文件已声明 `isKeyValue: true` /
  `dbCountsCommand` / `databaseFieldType: 'index'`），加 `kvWorkspace: { contextBar: true, statusBar: true, keyPropsSidebar: true, home: true }`。
  **禁止**在宿主 `src/lib/databaseMeta.ts` 的 redis 条目上写能力位。
- 宿主 KV 判定已去字面量：`useConnectionWorkspaceMeta.ts:102` 现在是
  `const isKvPanel = toolbarDbMeta?.isKeyValue === true;`（原 `activePanel?.type === 'redis-db' ||` 已删）。

### F-2 槽位 props 契约（`packages/driver-sdk/src/types/kv-slots.ts`）

**面板内三槽共享的基座**（宿主 `useKvWorkspaceSlots` 一次性冻结，`React.memo` 安全）：

```ts
export interface KvPanelSlotProps {
  connectionId: string;        // 持久化配置 id
  dbSessionId: string;         // 运行时会话 id
  connectionName: string;
  databaseType: DatabaseType;  // 注册表 key
  database: string | null;     // 面板绑定的逻辑库（如 'db5'）；未解析出 ⇒ null
  dbIndex?: number;            // 仅 databaseFieldType: 'index' 的驱动有值（Redis）
  state: KvSlotState;          // 宿主持有的 per-panel 中继，见下
}
```

| 槽位（`KvSlotName`） | props 类型 | = 基座 + 宿主独有字段 | 渲染落点 |
| --- | --- | --- | --- |
| `contextBar` | `KvContextBarProps` | `+ compact: boolean` | `ContentToolbar.tsx` 48px 左簇（`h-12 min-h-[48px]`） |
| `statusBar` | `KvStatusBarProps` | 基座原样（`= KvPanelSlotProps`） | `ContentStatusBar.tsx` 中心簇 |
| `keyPropsSidebar` | `KeyPropsSidebarProps` | `+ open: boolean` `+ onClose: () => void` | `ContentViewDrawers.tsx` 详情抽屉 |
| `connectionHome` | `ConnectionHomeSlotProps` | **不用基座**（屏 A 无面板） | `ConnectionWorkspaceHome.tsx` State 3b |

屏 A 独立形状（无面板 ⇒ 无 `database` / `dbIndex` / `state`）：

```ts
export interface ConnectionHomeSlotProps {
  connectionId: string;
  dbSessionId: string;
  connectionName: string;
  databaseType: DatabaseType;
  initialDatabase?: string;    // 连接配置里保存的 database
}
```

**选中 key / dirty 的传递方式（本轨最重要的裁定）**：当前选中 key 与未保存标志**不是 prop**，
而是宿主持有的 `KvSlotState` 中继（getter + `subscribe`，故意做成 `useSyncExternalStore` 形状）：

```ts
export interface KvSlotState {
  subscribe(listener: () => void): () => void;
  getSelectedKey(): string | null;
  selectKey(key: string | null): void;   // 驱动 workbench/键树发布
  getDirty(): boolean;
  setDirty(dirty: boolean): void;        // 驱动编辑器发布（PRD I-1 dirty 门闸）
}
```

- 为什么不塞进 props：workbench（知道选中哪个 key、有没有脏草稿）与工具栏 / 状态栏 / 侧栏
  渲染在**三棵不同 React 子树**，而宿主决定面板何时死 ⇒ 驱动侧模块级缓存会活过面板。
  宿主自身**不在渲染路径上订阅**（选中频率太高，不能整工作区重渲染），故 `getSelectedKey()` 只经
  `useSyncExternalStore(state.subscribe, state.getSelectedKey)` 消费。
- **同一个对象**同时交给面板内三槽**和**驱动的 connection view：
  `ConnectionViewProps.kvSlotState?: KvSlotState`（`packages/driver-sdk/src/types/connection-view.ts`）。
  Wave 2 的 `RedisConnectionView` 用它发布，槽位用它读取，两侧无需任何新桥。
- 原子生命周期（`src/lib/kvSlotState.ts`）：`getKvSlotState(panelId)` **按面板 id** 键控
  （同一连接的多个面板可能开在不同 db，选中态不得串台）；`pruneKvSlotStates(livePanelIds)` 是**唯一**
  回收路径，由 `ContentView` 在面板列表变化时以共享 `liveIds` 调用（退订路径已存在，无泄漏）；
  （BUG-001 修订：原单点 `disposeKvSlotState` 因生产零调用者、被 `pruneKvSlotStates` 批量回收取代，
  已删除）；`createKvSlotState`（供宿主与测试造原子）/ `resetKvSlotStatesForTests`（仅测试）可用。

**几何归属约定（Wave 2 必须遵守）**：宿主只拥有容器与 `data-slot` / `data-testid` 包装层；
驱动组件拥有自己的内部布局。`keyPropsSidebar` 自己负责宽度/边框/滚动（与 `DetailPanel` 同构），
且 **`open === false` 时必须渲染 `null`**（宿主不卸载它，只翻 `open`）。

> **对偶事实（BUG-003，Wave 2 E2E 硬约束）**：正因为宿主"不卸载、只翻 `open`"，抽屉收起时宿主
> 包裹层 `data-testid="conn-kv-key-props-sidebar"`（`data-slot="kv-key-props-sidebar"`，
> `ContentViewDrawers.tsx:152-153`）**仍常驻 DOM** —— 收起与否只体现在**内层驱动组件根节点返回
> `null`**。**Wave 2 的 E2E 严禁用该 wrapper 的存在性判断抽屉开合**：写
> `expect(page.getByTestId('conn-kv-key-props-sidebar')).toHaveCount(0)` 来断言"抽屉已关闭"必然红
> （wrapper 恒在）。正确断言落在驱动自身根节点（其可见性 / 内容），或"内层
> `[data-slot=kv-key-props-sidebar]` 无可视内容"。此常驻是有意设计（保住驱动内部列表滚动/展开态
> 在开合间不丢），属契约的一部分，非缺陷。

Wave 2 E2E 可直接依赖的宿主标记：

| 槽位 | `data-slot` | 包装层 `data-testid` |
| --- | --- | --- |
| contextBar | `kv-context-bar` | `conn-toolbar-kv-context-bar` |
| statusBar | `kv-status-bar` | `conn-status-kv-bar` |
| keyPropsSidebar | `kv-key-props-sidebar` | `conn-kv-key-props-sidebar` |
| connectionHome | `kv-connection-home` | `home-kv-connection-home` |

### F-3 lookup 函数名与生成表名

| 层 | 符号 | 位置 |
| --- | --- | --- |
| codegen 生成表 | `const DRIVER_KV_SLOTS: DriverKvSlotEntry[]` | `src/extensions/generated.ts`（gitignored） |
| codegen 条目类型 | `interface DriverKvSlotEntry { dbType; slot; component }` / `type DriverKvSlotName` | 同上 |
| **lookup** | **`getDriverKvSlot(dbType: string, slot: DriverKvSlotName): ComponentType<any> \| undefined`** | 同上，与 `getDriverConnectionView` 同风格 |
| 宿主双门闸封装 | `getKvSlotComponent<T>(databaseType, slot)` | `src/lib/kvWorkspaceSlots.ts` |
| 能力读取 | `hasKvSlotCapability(meta, slot)` / `KV_SLOT_NAMES` | `src/lib/kvWorkspaceCapabilities.ts` |
| 绑定 hook | `useKvWorkspaceSlots(args): KvWorkspaceSlots`（含 `resolveKvDatabaseIndex`） | `src/windows/connection/useKvWorkspaceSlots.ts` |

- 宿主**只调 `getKvSlotComponent`**：能力位与"本次构建确实注册了组件"两道闸都过才返回，
  任一道失败返回 `undefined` ⇒ 调用方按"渲染今天的默认 UI"处理，**永不抛错**。
- 生成器槽位名单 `export const KV_SLOT_NAMES`（`scripts/resolve-drivers.mjs`）已被单测
  **钉死等于** `kv-slots.ts` 里的 `KvSlotName` 联合（`scripts/__tests__/resolve-drivers.test.mjs`），两侧不可能漂移。

**Wave 2 在 codegen 里的声明形状**（`scripts/resolve-drivers.mjs` → `BASIC_PATH_FRONTEND.redis`）：

```js
kvSlots: {
  contextBar:      { component: 'RedisKvContextBar', path: '../../packages/drivers/redis/ui/kvSlots' },
  statusBar:       { component: 'RedisKvStatusBar',  path: '../../packages/drivers/redis/ui/kvSlots' },
  keyPropsSidebar: { component: 'RedisKeyPropsSidebar', path: '../../packages/drivers/redis/ui/kvSlots' },
  connectionHome:  { component: 'RedisConnectionHome',  path: '../../packages/drivers/redis/ui/kvSlots' },
},
```

- **每个槽位彼此独立且可选**：未声明的槽位既不生成 import 也不生成注册行 ⇒ 磁盘上**不需要**存在任何文件；
  因此本轨**没有**在 `packages/drivers/redis/ui/**` 造占位组件（禁止事项已守）。缺 `component` 或缺 `path`
  的半声明按"未声明"处理。
- 同一 `path` 的多个槽位会**合并成一条 import 语句**（已实测：3 槽 1 import）。
- 未贡献的槽位 ⇒ `getDriverKvSlot` 返回 `undefined`（已实测 `keyPropsSidebar` 与 `postgresql` 两种未注册路径）。

## 自验记录

接管后全部实跑（worktree `.worktrees/datazen-redis-host-slots`，非主检出）：

| # | 门禁 | 命令 | 结果 |
| --- | --- | --- | --- |
| 1 | 类型 | `npx tsc --noEmit -p tsconfig.json` | **0 错误**（exit 0） |
| 2 | 定向单测 | `npx vitest run src/windows/connection src/lib` | **204 files / 2068 tests 全绿**（BUG-002：原括注"新增 2 文件 7 用例"有误；本轨在此两目录实为新增 7 文件 + 改 1 文件，最终数字见 §修复记录） |
| 3 | Host 全量 | `npx vitest run` | **449 files / 4646 tests 全绿，exit 0** |
| 4a | 边界 | `node scripts/check-driver-import-boundaries.mjs` | **0 blocking**（1413 files，4 advisory，全部为本轨之前既有：`locales.test.ts` / `driverUiSetup.ts` ×2 / `DocumentConnectionView.tsx`） |
| 4b | ID 术语 | `node scripts/check-id-terminology.mjs` | ok（1730 files，5 allow-listed） |
| 4c | 模块分层 | `node scripts/check-module-layers.mjs` | ok（3 rules） |
| 4d | CI 文档 | `node scripts/check-ci-docs-consistency.mjs` | ok（11 driver ids / window boundaries / toolchain） |
| 4e | 版本 | `node scripts/check-version-consistency.mjs` | ok（all sources at 0.2.1） |
| 4f | 脚本单测 | `npx vitest run scripts/__tests__` | **23 files / 254 tests 全绿** |
| 5 | codegen | `node scripts/resolve-drivers.mjs --codegen-only --drivers=basic` | ok，生成表为空（无驱动声明 `kvSlots`）⇒ 与今日一致；**generated 未提交** |

**门禁 3 的红/绿比对方法（BUG-002 修订）**：判据是改后全量 `npx vitest run` 以 **exit 0、失败集合为空**
结束即蕴含"无新红"（零失败集合无需与基线求差集）。经 Tester 依 git 事实核对（`9b073ed46` 的父提交即
基准 `ae65ae375`；`git diff --name-status ae65ae375..` 显示 **7 个新增 + 2 个修改测试文件、+47 用例**），
真实基线应为 **442 files / 4599 tests 全绿**（= 本轨合入后 449/4646 减 7 文件 / 47 用例）。原自报的
"基线 447/4634、本轨新增 2 文件 / 12 用例"是救援过程中一次未落地完整测试文件的中途测量、且"2 文件"与
所举 3 个文件自相矛盾，均作废。本轨合入后全量 449/4646、Tester 复测补 1 文件 / 8 用例后 450/4654，
两者均 exit 0、失败集合为空。

**门禁 5 的 lookup 实取证明**（不留在提交里）：临时给 `redis` 配置注入 `kvSlots`
（contextBar / statusBar / connectionHome 三项，指向尚不存在的 `ui/kvSlots`）→ 重跑 codegen ⇒
`generated.ts` 生成 **1 条合并 import + 3 条注册行**；把生成的 `DRIVER_KV_SLOTS` /
`getDriverKvSlot` 段抽出来实跑 ⇒ `contextBar → CtxBar`、`statusBar → StatBar`、
`connectionHome → Home`、`keyPropsSidebar → undefined`（未声明）、`postgresql → undefined`（整块未声明）。
随后 `git checkout -- scripts/resolve-drivers.mjs` 并重新 codegen 复原，工作区干净。

提交（分支 `feature/redis-host-slots`，基准 `ae65ae375`）：

| hash | 内容 |
| --- | --- |
| `9b073ed46` | 接管前任未提交现场：能力位 + 契约类型 + codegen 分支 + 宿主四槽接线 + 6 个测试文件（22 files / +1644） |
| `9b878e609` | 补齐抽屉与屏 A 两个渲染位单测 + 生成器槽位名单对 `KvSlotName` 的钉死断言（3 files） |
| `e4f020b70` | 本文件：契约冻结 + 自验记录 + 留待 R 回归 |
| （末条收尾提交） | 屏 A 测试拆分到 `ConnectionWorkspaceHomeKvSlot.test.tsx`（避免把 687 行存量测试文件推到 775 行，给 Wave 2 留出独立 KV 用例落点）+ 门禁数字修正 + R 项 8~10 |

## 留待 R 回归

1. **未声明能力的其它驱动槽位不出现**（验收 1）：单测已覆盖"能力假"与"能力真但未贡献组件"两态，
   但 mysql / postgresql / sqlite / mongodb / clickhouse 的真实 meta 均未声明 `kvWorkspace` ⇒
   需 GUI 走一遍确认工具栏左簇、状态栏中心簇、详情抽屉、屏 A 四处与本轨之前逐像素一致。
2. **redis 面板在本轨之后仍是今日外观**（预期，非缺陷）：redis meta 尚无 `kvWorkspace: true`、
   codegen 尚无 `kvSlots` 声明 ⇒ P-1（48px 空带）与 P-3（死按钮空抽屉）**要到 Wave 2 才真正在 UI 上消失**。
   R 阶段验证这两处必须等 Wave 2 合入后做。
3. **能力真但组件未贡献时的死按钮**：`detailPanelApplicable` 未按 KV 能力额外门控（任务书裁定
   "能力为假时行为不变"）。原拟用于此门控的聚合位 `hasAnyKvSlotCapability` 因生产零调用者已随 BUG-001
   删除 ⇒ 若 Wave 2 出现"meta 写了 `keyPropsSidebar: true` 但漏了 codegen 声明"，KV 面板仍会退回空白抽屉。
   届时如需门控，按槽位用 `hasKvSlotCapability(meta, 'keyPropsSidebar')` 判定即可，**不要再引入聚合位**
   （避免两套并存）。建议列入 Wave 2 checklist。
4. **`isKvPanel` 去字面量的回归面**：现在完全依赖 `DB_REGISTRY[databaseType ?? sidebarConnCtx.databaseType].isKeyValue`。
   已核实 `packages/drivers/redis/ui/shared/meta.ts:22` 有 `isKeyValue: true`；Host 全量单测零红。
   仍需 GUI 确认：从连接树新建 redis 面板时 `panel.databaseType` 确已赋值（面板创建早于会话就绪的时序）。
5. **worktree 外部树盲区**：本 worktree 缺 gitignored 的 git 驱动（kiwi / superset / olap）与 pro 扩展 ⇒
   `test:boundaries` / `test:ids` / codegen 是 path-only 结果。合并时请在主检出或
   `--drivers=all` 下复跑一次（`resolve-drivers.mjs` 的 `kvSlots` 分支对 git 驱动同样生效，
   git 驱动若要在 `drivers-registry.json` 侧声明槽位需另行验证）。
6. **KV 面板状态原子的回收**：`pruneKvSlotStates(livePanelIds)` 挂在 `ContentView` 的面板同步 effect 上，
   与 store 面板剪枝共用 `liveIds` ⇒ 建议 GUI 验证"关掉 KV 面板再开 ⇒ 选中 key 不残留"。
7. 本轨未触碰 `RedisWorkbench.tsx`、`packages/drivers/redis/{src,ui}/**`、任何 `locales/**`、
   `src/locales/locales.test.ts`、`ttlControlsJourney.test.tsx`、`check-i18n-copy-assertions.mjs`、
   `package.json`（含 `test:i18n-assertions*`）⇒ 与 redis-cmds-p0 / redis-assert-policy / Wave 2 三轨零冲突。
8. **请协调者裁定一处规范措辞差**：PRD §7-4 写「屏 A 让位需走 `DatabaseTypeMeta.connectionView` /
   新 EP 契约，由 `@datazen/extension-points` 承载」，而本轨任务书 §范围-3 指定「走既有 codegen 机制」。
   实现按任务书执行：屏 A 走驱动槽位注册表（`resolve-drivers.mjs` → `getDriverKvSlot`），
   **与 `getDriverConnectionView` 同一机制、同一文件、同一风格**，宿主零 `databaseType === 'redis'` 分支、
   零具体驱动 import（边界 0 blocking）。若协调者认为 §7-4 字面上必须落 EP 承载，本轨的
   `connectionHome` 一个槽位可平移，其余三槽（面板内）与本条无关。
9. `scripts/resolve-drivers.mjs` 现 **1338 行**，基准 `ae65ae375` 已是 1239 行（本轨 +99）⇒
   该构建脚本在本轨之前就已越过 AGENTS.md 推荐的 800 行线，属存量债，**本轨未拆分**（拆分必然改动
   所有驱动配置段，与 redis-cmds-p0 / Wave 2 的 codegen 改动高冲突）。建议单独立项处理。
10. **屏 A 测试落点已拆分**：新增用例放在
    `src/windows/connection/__tests__/ConnectionWorkspaceHomeKvSlot.test.tsx`（112 行），
    存量 `ConnectionWorkspaceHome.test.tsx` 保持基准 687 行不变。Wave 2 若还要加屏 A 用例，
    请续写这个新文件，不要再往 687 行的存量文件里堆。
11. **（Tester 补）E2E 不得用 wrapper 存在性判抽屉开合**：`keyPropsSidebar` 的宿主包裹层
    `data-testid="conn-kv-key-props-sidebar"` 在 `open === false` 时**常驻 DOM**（本轨有意不卸载，
    保驱动内部状态），收起与否由驱动组件自身返回 `null` 体现。Wave 2 的 `toHaveCount(0)` 类断言
    必须落在驱动根节点上。详见 `bugs.md` BUG-003。
12. **（Tester 补）`ConnectionPage.tsx:388` 仍在写 `type: 'redis-db'` 字面量**：本轨范围禁止触碰该文件，
    R-4 的 `isKvPanel` 判定链已不依赖它，但 Wave 2 若再引入"按面板类型分支"就会重新长回字面量。
    建议 Wave 2 任务书显式禁用 `panel.type` 上的驱动字面量。

## Tester 复测记录（全新实例，测试提交 `cbcf49cf9`）

判定：**PASSED**。7 项验收标准全部独立复现，F-1 / F-2 / F-3 **可按现状冻结**（建议随冻结补两句文字，
见 BUG-001 / BUG-003）。非阻断登记 3 条 + 环境性既有红 6 条，全部记在 `bugs.md`。
本轮未修改任何生产码，只新增/补齐测试与本文档。

### 阶段 B：自报数字 vs 独立实测

| 门禁 | 命令 | Coder 自报 | Tester 实测 | 判定 |
| --- | --- | --- | --- | --- |
| 类型 | `npx tsc --noEmit -p tsconfig.json` | 0 错误 | 0 错误（exit 0） | 一致 |
| 定向单测 | `npx vitest run src/windows/connection src/lib` | 204 / 2068 | **205 / 2076** | 一致（+1 文件 +8 用例全为 Tester 新增） |
| Host 全量 | `npx vitest run` | 449 / 4646，exit 0 | 合入前 **449 / 4646 exit 0**（复现）；含 Tester 测试后 **450 / 4654 exit 0** | 一致，零红 |
| 边界 | `node scripts/check-driver-import-boundaries.mjs` | 0 blocking（1413 files / 4 advisory） | **0 blocking（1416 files / 4 advisory）**，exit 0 | 一致（文件数随新增测试文件漂移） |
| ID 术语 | `node scripts/check-id-terminology.mjs` | ok（1730 files，5 allow-listed） | ok（**1732 files**，5 allow-listed） | 一致 |
| 分层 / CI 文档 / 版本 | 三个 `check-*.mjs` | ok | ok（3 rules / window boundaries + toolchain / 0.2.1） | 一致 |
| 脚本单测 | `npx vitest run scripts/__tests__` | 23 / 254 | 23 / 254 | 一致 |
| codegen | `--codegen-only --drivers=basic` | 生成表为空 | 复现，`DRIVER_KV_SLOTS = []`，工作区干净 | 一致 |

**基线数字不可复现**：自报"基线 447 / 4634、本轨新增 2 文件 / 12 用例"与 git 事实不符
（`9b073ed46` 之父即 `ae65ae375`；`git diff --name-status` 显示 **7 新增 + 2 修改测试文件、+47 用例**
⇒ 真实基线 442 / 4599）。"无新红"的结论仍成立，但成立理由是**改后全量 exit 0、失败集合为空**，
不是与基线求差集。登记为 BUG-002（文档准确性，非阻断）。

**codegen 探针由 Tester 自行重做**（不沿用自报结论）：临时给 `redis` 注入 3 个 `kvSlots`
（contextBar / statusBar / connectionHome，指向**不存在**的 `packages/drivers/redis/ui/kvSlots`）
⇒ `--codegen-only --drivers=basic` 后 `src/extensions/generated.ts:15` 为**一条合并 import**
（3 个符号）+ 3 条注册行；再把生成的 `getDriverKvSlot` 段抽出来**实跑**：
`redis:contextBar→CtxBar`、`redis:statusBar→StatBar`、`redis:connectionHome→Home`、
`redis:keyPropsSidebar→undefined`（未声明槽位）、`postgresql:contextBar→undefined`、
`mysql:connectionHome→undefined`（未声明驱动的整条路径）、空 `dbType→undefined`。
随后 `git checkout -- scripts/resolve-drivers.mjs` + 重新 codegen 复原：`DRIVER_KV_SLOTS` 回到 `[]`、
`git status --short` 为空、生成文件由 `.gitignore:63` 忽略 ⇒ **codegen 未进提交**。

### 阶段 A：契约冻结级审阅结论

- **F-1（能力位唯一真源）成立**：`KvWorkspaceCapabilities` 仅在 `src/lib/databaseMeta.ts` 定义一处，
  `packages/driver-sdk/src/index.ts` 只做 type-only 再导出（无第二份形状）；
  `meta` 为 `undefined` / 无 `kvWorkspace` / 位不为 `true` 三态实测均判 false；
  `connectionHome`（槽位名）↔ `home`（能力位名）的不对称**只有一处转换**
  （`kvWorkspaceCapabilities.ts` 的 `capabilityKeyForSlot`），`'home'` 字面量在生产码中命中 1 次；
  新增源文本钉死断言（`kvWorkspaceCapabilities.test.ts`）⇒ 改一边必红。
- **F-2（状态中继，本轮最重要裁定）成立**：宿主渲染路径**无裸 `getSelectedKey()`**
  （仅 `useSyncExternalStore` 的 `getSnapshot`，测试夹具除外）；订阅/退订对称，无单向死锁；
  两侧收到**同一个对象** —— 新增 `PanelContentRendererKvSlotState.test.tsx` 直接以
  `createKvSlotState()` 实例穿过宿主转发链，驱动侧回显的 `data-selected-key` / `data-dirty`
  与原子状态一致，证明中继不是复制品；原子按 `panelId` 分键，`nextPanelId` 单调
  ⇒ 关闭重开不复用旧原子、两面板不共享；`pruneKvSlotStates` 挂在 `ContentView.tsx:206-213`
  的 `[allPanels]` effect、与 tableData store 共用 `liveIds` ⇒ 无泄漏；
  新增"同连接 db5/db7 双面板"反例证明切换面板不串味、回到 parked 面板复用同一原子。
- **F-3（生成表 + 双闸）成立**：per-slot 可选性（不 import、磁盘文件不必存在）由上述探针实测；
  同 `path` 多槽合并 1 条 import 实测；未注册槽位 / 未注册驱动均 `undefined` 实测；
  `DRIVER_KV_SLOTS` / `DriverKvSlotEntry` / `getDriverKvSlot` / `getKvSlotComponent` /
  `hasKvSlotCapability` / `KV_SLOT_NAMES` / `useKvWorkspaceSlots` 命名与本表一致；
  `ComponentType<any>` **只出现在生成模板**，5 个手写新文件 `any` 计数为 0
  （`getKvSlotComponent<T extends object>` 公开签名干净）⇒ 不立 Bug。
- **P-3 死按钮**：能力真 ⇒ fixture 侧栏渲染；能力假 ⇒ 与今日一致（不注入任何节点）；
  `open === false` ⇒ 驱动自身 `null`、宿主只翻 `open`（wrapper 常驻，见 BUG-003）。
- **三态降级**：`getKvSlotComponent` 的"能力 + 贡献"双闸三态均不抛错，全部有 fixture 用例。
- **4 个 DOM 标记真实出现在渲染输出**：`ContentToolbar.tsx:123/124`、`ContentStatusBar.tsx:50/51`、
  `ContentViewDrawers.tsx:152/153`、`ConnectionWorkspaceHome.tsx:292/293`，每处均有断言。
- **救援一致性**：无 TODO / FIXME / `console.log` 残留；无两套并存机制
  （能力真源一处、槽位解析只走 `getKvSlotComponent` 一条路径、原子"增 `getKvSlotState` / 减
  `pruneKvSlotStates`"成对）；唯一"写了没接线"= `hasAnyKvSlotCapability` / `disposeKvSlotState`
  零生产调用者 ⇒ BUG-001（低，非阻断，可与 R-3 一并裁定）。

### 阶段 C：补测清单与覆盖率

Tester 新增 **1 个测试文件 + 8 个用例**（全部标注 `[tester]`）：

| 文件 | 用例 | 补的是哪条未测路径 |
| --- | --- | --- |
| `src/windows/connection/__tests__/PanelContentRendererKvSlotState.test.tsx`（新建，2） | 中继原子身份跨宿主转发不变；`kvSlotState` 为 `undefined` 时的降级 | 宿主 → `PanelContentRenderer` → `KvView` 的透传此前无人验证 |
| `src/windows/connection/__tests__/useKvWorkspaceSlots.test.tsx`（+4 用例 + 1 断言） | 双面板切原子不串味并复用 parked 原子；面板缺 `databaseType` 时不开面板内绑定；无 `id` 面板不建原子；capable 未贡献时屏 A 保持宿主页；`resolveKvDatabaseIndex` 非安全整数 | 原 93.61% branch 未覆盖的 102-116 / 170 行 |
| `src/lib/__tests__/kvWorkspaceCapabilities.test.ts`（+1） | `KV_SLOT_NAMES` 与 SDK `KvSlotName` union 的源文本双向钉死 | F-1 名单漂移无人抓 |
| `src/windows/connection/__tests__/ConnectionWorkspaceHomeKvSlot.test.tsx`（+1） | 无 `connectionContext` 时不让位 | State 3b 的空上下文分支 |

**覆盖率（v8，全量 450 文件套件下实测，非子集）**：

| 新增文件 | Stmts | Branch | Funcs | Lines |
| --- | --- | --- | --- | --- |
| `src/lib/kvSlotState.ts` | 100 | **100** | 100 | 100 |
| `src/lib/kvWorkspaceCapabilities.ts` | 100 | **100** | 100 | 100 |
| `src/lib/kvWorkspaceSlots.ts` | 100 | **100** | 100 | 100 |
| `src/windows/connection/useKvWorkspaceSlots.ts` | 100 | **100**（补测前 93.61） | 100 | 100 |
| `packages/driver-sdk/src/types/kv-slots.ts` | 纯类型文件，运行期 0 语句 / 0 分支 | — | — | — |

估算方法：先逐条枚举 5 个新文件的公开行为分支（能力判定 4 态、槽位解析 3 态、
原子生命周期 5 态、双闸降级 3 态、index 解析 5 态，共 20 条），再以 v8 的 branch 计数为准对照用例；
补测后新增码分支覆盖 **100%**（≥80% 达标）。
宿主 delta 文件的低分（`ContentView` 56.56 / `ContentViewDrawers` 62.31 / `PanelContentRenderer` 36.52 /
`ConnectionWorkspaceHome` 71.64 / `ContentToolbar` 85.29 / `ContentStatusBar` 87.5）**全部来自本轨未触碰的
存量分支**：例如 `ContentStatusBar` 未覆盖行 62-63 是既有 fallback 文本拼接、`ContentToolbar` 未覆盖行 207
是既有 docs 按钮；本轨在 6 个宿主文件里新增的槽位分支两侧都有用例。

### 阶段 D：留待 R 项可执行性核对

- **①（对应 R-1）其它驱动四槽不出现**：本机可执行到"渲染输出无该节点 / 与今日一致"层
  （能力假三态 + 4 个宿主位 fixture 断言已覆盖）；逐像素判定留 R 的 GUI 走查 —— 可执行。
- **②（对应 R-2）Wave 2 后 P-1 填满、P-3 不再是空表**：本机**不可**验证，
  前置条件必须写进任务书：redis meta 声明 `kvWorkspace: true` + `drivers-registry.json` 加 `kvSlots`
  + 重新 codegen + 驱动侧真实组件落地，四者缺一则该条无从谈起。
- **③（对应 R-6/§3.0）一连接多面板不串 selected key**：本机**已由 Tester 新用例在单元层锁住**，
  R 阶段只需 GUI 复核 keep-alive tab 的实际切换手感 —— 已从"待验证"降级为"已验证 + GUI 复核"。
- R-3 / R-4 / R-7 / R-8 / R-10 文字与代码事实相符，可执行；R-5（外部树盲区）与 R-9（1338 行存量债）
  非本轨可闭环项。
- 新增 R-11（E2E 判据不得用 wrapper 存在性）、R-12（禁止再在 `panel.type` 上写驱动字面量），见上表。
- 本轨未跑 `pnpm e2e`（子代理不跑），未触碰 `RedisWorkbench.tsx` / `packages/drivers/**` /
  任何 `locales/**` / `package.json`；`git diff --name-only ae65ae375..HEAD` 命中禁止路径数为 0（Tester 复核）。

## 修复记录（第 1 轮 Coder 修复，READY_FOR_TEST）

针对 `bugs.md` 三条非阻断登记项逐条修复。全部改动落在允许面（宿主 `src/lib/**` + 本轨文档），
未触碰禁止路径。修复后重新实跑全部门禁（见下表），零新红。

### BUG-001（未接线导出）— 处置 = 删除（默认处置，已核实无判定丢失）

- 删除 `src/lib/kvWorkspaceCapabilities.ts` 的 `hasAnyKvSlotCapability` 与 `src/lib/kvSlotState.ts` 的
  `disposeKvSlotState`，并同步删除其单测（`kvSlotState.test.ts` 的"drops a disposed panel atom"整例、
  `kvWorkspaceCapabilities.test.ts` 内所有 `hasAnyKvSlotCapability` 断言与过时注释）。
- **删除依据（三维自查）**：
  1. 检索 `hasAnyKvSlotCapability|disposeKvSlotState` 在 `src/**`、`packages/**`、`scripts/**` 生产码
     **零命中**（仅测试与文档，删除后非文档命中数 0）。
  2. 二者**均非宿主唯一能力判定入口**：真实 KV 能力判定逐槽位走 `hasKvSlotCapability(meta, slot)`
     （唯一生产消费者 `kvWorkspaceSlots.ts:33` 的 `getKvSlotComponent` 双闸），删除聚合便捷位不丢任何判定；
     `detailPanelApplicable` 依协调者裁定本就未门控在能力位上（见 R-3），"any"聚合无既有判定依赖它。
  3. `disposeKvSlotState` 的回收语义由**已接线**的 `pruneKvSlotStates`（`ContentView.tsx:212`，与 store
     面板剪枝共用 `liveIds`）完整承担，其反例用例（prune 后返回全新干净原子）仍在，行为覆盖不降。
  - 结论：符合项目「单一实现、不留桥接与预留层」口径 ⇒ 选删除而非接线、不"留给 Wave 2"。
- 契约段（F-1 判据 / F-2 原子生命周期 / F-3 能力读取表 / R-3）已同步移除对这两个名字的引用，并就地
  注明"因生产零调用者随 BUG-001 删除"，Wave 2 逐字复制契约段时不会引用到已不存在的函数。
  **F-1/F-2/F-3 保留的字段名 / 类型名 / 函数名 / 4 个 DOM 标记均未改名。**

### BUG-002（自验记录数字与 git 事实不符）— 已按 Tester 口径改写

- §自验记录"定向单测"行括注、§门禁 3 红/绿比对方法段更正为：真实基线 **442 files / 4599 tests**、
  本轨相对 `ae65ae375` **新增 7 个测试文件 + 修改 2 个 / +47 用例**；原自报"447/4634、2 文件/12 用例"作废。
- 判据改为"**改后全量 `npx vitest run` exit 0、失败集合为空**（无需与基线求差集）"。

### BUG-003（F-2 缺对偶事实）— 已补写并显式警告 Wave 2

- F-2 几何条目后追加引用块：宿主 `conn-kv-key-props-sidebar` wrapper 在 `open === false` 时**常驻 DOM**
  （驱动组件自身返回 `null`），**Wave 2 E2E 不得用该 wrapper 存在性判抽屉开合**（`toHaveCount(0)` 必红），
  断言须落在驱动根节点可见性/内容。§留待 R 回归 R-11 已有同源提示。

### 修复后门禁实跑（worktree `.worktrees/datazen-redis-host-slots`，全部真实执行）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npx tsc --noEmit -p tsconfig.json` | **0 错误**（exit 0） |
| 定向单测 | `npx vitest run src/windows/connection src/lib` | **205 files / 2075 tests 全绿**，exit 0 |
| Host 全量 | `npx vitest run` | **450 files / 4653 tests 全绿**，exit 0（较合入 Tester 测试后的 4654 少 1，正是 BUG-001 删除的 `disposeKvSlotState` 整例；无新红、失败集合为空） |
| 边界 | `node scripts/check-driver-import-boundaries.mjs` | **0 blocking**（1416 files，4 advisory，全为本轨之前既有） |
| ID 术语 | `pnpm test:ids` | ok（1732 files，5 allow-listed） |
| 分层 | `pnpm test:layers` | ok（3 rules） |
| CI 文档 | `pnpm test:ci-docs` | ok（11 driver ids / window boundaries / toolchain） |
| 版本 | `pnpm test:version` | ok（all sources at 0.2.1） |
| 脚本单测 | `npx vitest run scripts/__tests__` | **23 files / 254 tests 全绿**（`KV_SLOT_NAMES` ↔ `KvSlotName` 钉死断言仍绿） |
| codegen | `node scripts/resolve-drivers.mjs --codegen-only --drivers=basic` | ok，`DRIVER_KV_SLOTS = []`（无驱动声明 `kvSlots`）⇒ 与今日一致；`generated.ts` / `driver_init.rs` 经 `git check-ignore` 确认未跟踪，**未提交** |

**零残留确认**：`rg hasAnyKvSlotCapability|disposeKvSlotState`（排除 `docs/**`）命中 0。
