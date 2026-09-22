- 任务: KV 契约加宽（F-2.1 标量 getter/setter）+ 反向动作通道 + AI KV 上下文注入（PRD §3.4 / §4 I-1、I-6）
- 状态: READY_FOR_TEST
- 编码 commit: `499a90da1`（§1.1）+ `7bfb71f99`（§1.2）+ `9c5bd8208`（§1.3，接管轮补齐接线）
- 测试 commit: 随各编码 commit（`kvSlotState.test.ts` 46 例 / `useKvSlotActions.test.tsx` 15 例 / `kvAiContext.test.ts` 10 例 + `ContentToolbar.test.tsx` §1.3 4 例 + `ContentViewDrawers.test.tsx` §1.3 3 例 + `AiChatPanel.test.tsx` §1.3 3 例）
- 合并 commit: —
- 代理: w3a-kv-contract-coder（死于 150 轮上限，§1.3 半成品）→ **w3a-kv-contract-rescuer（接管收尾：补 §1.3 接线 + 契约冻结 + 四道门禁）**
- Worktree: .worktrees/datazen-redis-kv-contract
- 分支: feature/redis-kv-contract
- 心跳: 2026-09-22 18:15（接管轮返回 `READY_FOR_TEST`）

# W3-A `redis-kv-contract` 简报（协调者下发）

## 0. 必读（按序）
1. `AGENTS.md`
2. `docs/development/subagent/coder.md`
3. 本文件
4. `docs/todo/redis-workbench-ux/PRD.md` §3.4（上下文条/状态条全量）、§4 I-1/I-2/I-3、§6 后端缺口表
5. 现有契约与既有裁定：`packages/driver-sdk/src/types/kv-slots.ts`、`src/lib/kvSlotState.ts`、
   `src/windows/connection/useKvWorkspaceSlots.ts`、`src/windows/connection/PanelContentRenderer.tsx`、
   `docs/development/coordination/tracks/redis-kvbar-ui/progress.md`（F-2 中继接线 + BUG-005「状态归属」裁定，**不得推翻**）

## 1. 目标（三件事，全在宿主侧 + driver-sdk）
Redis 的 KV 槽位目前只能看到「选中键 + dirty」。本轨把宿主拥有的中继对象加宽到足以驱动
**状态条 6 项**与**上下文条扫描段**，并开出**反向动作通道**供 Wave-4 的 contextBar 组件消费。

### 1.1 `KvSlotState` 加宽 —— 形状冻结如下（Wave 4 两轨逐字引用，不得走样）
getter **必须返回标量或 null**：任何返回数组/新对象的 getter 都会破坏 `useSyncExternalStore`
的快照稳定性并造成无限重渲染（这是 F-2.1 的裁定理由，不是风格偏好）。

```ts
// 既有（保持不变，不得改名/删除）：subscribe / getSelectedKey / selectKey / getDirty / setDirty
// 新增 getter：
getLoadedCount(): number;        // 已加载键数
getScanCursor(): string;         // "0" 表示扫描已完成
isScanning(): boolean;
getScanBudgetUsed(): number;     // 本次用户动作累计 COUNT；0 = 未启用
getScanBudgetTotal(): number;    // 0 = 未知
getSelectionCount(): number;     // 只给计数；选中键列表仍留在驱动 workbench 内
getLastWriteCommand(): string | null;
getLastWriteDurationMs(): number | null;
// 新增 setter（由驱动侧树/编辑器调用）：
setLoadedCount(n: number): void;
setScanCursor(cursor: string): void;
setScanning(scanning: boolean): void;
setScanBudget(used: number, total: number): void;   // setter 允许多参，getter 不允许
setSelectionCount(n: number): void;
recordWrite(command: string, durationMs: number): void;  // 一次调用同时写 command + duration
```
实现要求：宿主 store 内部一个不可变快照对象 + `notify`；setter 写入与当前值相同时**不得**触发
订阅者（幂等），否则树滚动会级联重渲染。为每个新 getter 写「同值不通知」「标量快照稳定」两条测试。

### 1.2 反向动作通道 —— 只挂在 `KvContextBarProps`，**不进 store**
```ts
export type KvSlotAction =
  | { type: 'refresh' }
  | { type: 'newKey' }
  | { type: 'import' }
  | { type: 'export' }
  | { type: 'flushDb' }
  | { type: 'openMonitor' }
  | { type: 'openSettings' }
  | { type: 'setScanBudget'; value: number };

// KvContextBarProps 追加：
request(action: KvSlotAction): void;
```
- 宿主实现唯一 dispatcher（`src/windows/connection/` 内），槽位组件不得假设某个动作有人处理：
  未知/未接线动作 = **no-op + 一条 warn**，禁止抛错。
- `flushDb` 属危险动作：dispatcher 侧必须过既有的写门闸（I-6），本轨只负责把门闸调用点接上，
  不新造第二套确认逻辑。

### 1.3 AI 按钮的 KV 上下文（PRD §3.4 明令禁止「能点开但没上下文」的半残态）
现状：`src/windows/connection/ContentToolbar.tsx` 在 KV 面板下照常渲染 `MessageSquare`，而
`src/components/ai/AiChatPanel.tsx` 只送 `contextTables` ⇒ 点了没有任何 Redis 上下文。
- 注入宿主确实拥有的事实：`connectionName` / `dbSessionId` / 当前 db / `getSelectedKey()` /
  键属性侧栏已取到的 `type / memoryBytes / encoding / ttlMs`（`key_object_info` 结果，勿重复发命令）。
- **不注入**驱动 Console 缓冲区（宿主拿不到，也不得为此起新的缓存层）。
- 若上述可用事实为空（未选键且无键属性）⇒ **不渲染** `MessageSquare`。二选一，禁止保留空注入。

## 2. 落点（本轨独占这些文件面）
- `packages/driver-sdk/src/types/kv-slots.ts`
- `src/lib/kvSlotState.ts`
- `src/windows/connection/useKvWorkspaceSlots.ts`、`PanelContentRenderer.tsx`、`ContentToolbar.tsx`
  （+ `src/windows/connection/__tests__/**` 相应测试）
- `src/locales/en.ts`（仅 host 侧新文案，命名空间 `redis.kvSlot.*` / `redis.ai.context.*`）

## 3. 明确不做
- 不写任何驱动侧槽位组件（contextBar / statusBar 消费端在 Wave 4）。
- 不给 `KvSlotState` 加回调式逃生口（`onRefresh?: () => void` 之类一律禁止；通道只有 `request`）。
- 不加缓存层绕过中继（BUG-005 已裁定：状态归属跟随拥有它的那一段 UI）。
- 不碰 `packages/drivers/redis/**`（同波次另 5 轨正在里面工作）。

## 4. 冲突面声明
与 W3-E/F/D/B/C **无文件重叠**（那些轨全在 `packages/drivers/redis/**`）。宿主 `en.ts` 本轨独占。
`ContentToolbar.tsx` 只有本轨改（W3-F 的危险命令分类在驱动侧，不碰此文件）。

## 5. 门禁与交付
1. `npx tsc --noEmit` = 0 错。
2. Host：`npx vitest run`（基线 451 files / 4658 tests 起，只许增不许红）。
3. Drivers：`npx vitest run --config vitest.drivers.config.ts`（基线 47/456）——
   `ui/__tests__/kvSlotRegistration.test.ts`、`kvSlotRelay.test.tsx` 必须仍绿（中继接线不得回退）。
4. `node scripts/check-driver-import-boundaries.mjs` = 0 blocking。
5. 每个交付单元（1.1 / 1.2 / 1.3）**立即 commit 一次**；接近轮次上限时提交现场并返回 `PARTIAL` + 剩余清单。
6. 在本文件追加两节：`## 契约冻结`（把 §1.1/§1.2 的最终 TS 原文贴回来，Wave 4 逐字引用）与
   `## 自验记录`（命令 + 数字 + 关键判定）。
7. 返回 `READY_FOR_TEST`。

## 6. 环境纪律（违反即返工）
- 工作目录固定 `.worktrees/datazen-redis-kv-contract`；禁止写其他检出（主检出与
  `.worktrees/datazen-redis-p0-integrate` 对本轨只读）。
- 搜索用 Grep 工具，禁 bash `grep -r`；禁 `pnpm install`（node_modules 已软链）。
- 禁 live `pnpm e2e` / `pnpm tauri:build:webdriver` / 裸 `pnpm build`；需产线构建用 `npx vite build`。
- 禁提交 gitignored codegen（`src/extensions/generated*.ts`、`src-tauri/src/driver_init.rs`、
  `src-tauri/capabilities/default.json`、`.driver-features.json`）、`Cargo.lock`、注入过的 `src-tauri/Cargo.toml`。
- 禁改/提交 `docs/development/coordination/hub.md` 与他轨 `tracks/<other>/**`。
- i18n 开发期只改 `en.ts`；测试禁断言英文字面量文案（既有字面量断言**改写**而非删除）。
- 生产路径禁裸 `unwrap()/expect()`；单文件 ≤800 行。

---

## 契约冻结（W3-A 最终形态 · Wave 4 contextBar / statusBar 两轨逐字引用）

> **本节是本轨对 Wave 4 的唯一交付接口**：下面每段代码都是仓库当前源码的原文（落点文件路径写在段首）。
> 冻结后任何新增字段/改名必须回协调者裁定，消费轨**不得就地顺手补一个 getter 或偷偷读宿主 store**。
>
> 两条硬约束（F-2.1 裁定，不是风格偏好）：
>
> 1. `KvSlotState` 的 **getter 只返回标量或 `null`**。返回数组/新建对象会让 `useSyncExternalStore`
>    每次都看到新快照 ⇒ 无限重渲染。聚合信息只能以**计数或标签**跨这条中继
>    （`getLoadedCount()` / `getSelectionCount()`），富集合留在拥有它的驱动 workbench 里。
> 2. **写入与当前同值的 setter 不通知订阅者**。键树每个滚动/扫描 tick 都会上报，
>    话痨中继会让面板里每个槽位持续重渲染。宿主实现按字段 `Object.is` 逐条比对。
>
> `setScanBudget(used, total)` / `recordWrite(command, durationMs)` 这类成对写入是**一次调用一条通知**，
> setter 允许多参（getter 不允许）。

### F-1 `KvSlotState` 全形状 —— `packages/driver-sdk/src/types/kv-slots.ts`

```ts
export interface KvSlotState {
  /** Register a change listener; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Key currently selected in the driver's key tree, `null` when none. */
  getSelectedKey(): string | null;
  /** Publish the selected key (called by the driver's workbench/tree). */
  selectKey(key: string | null): void;
  /** Whether the panel holds unsaved edits (drives the dirty gate, PRD I-1). */
  getDirty(): boolean;
  /** Publish the dirty flag (called by the driver's editors). */
  setDirty(dirty: boolean): void;

  // ── W3-A §1.1 widening: status bar (6 items) + context-bar scan cluster ──

  /** Keys currently materialised in the tree (status bar `loaded n`). */
  getLoadedCount(): number;
  /** Publish {@link getLoadedCount}. */
  setLoadedCount(n: number): void;
  /**
   * Last SCAN cursor reported by the tree. `'0'` means the scan completed;
   * any other value means it stopped early (PRD I-2/I-4).
   */
  getScanCursor(): string;
  /** Publish {@link getScanCursor}. */
  setScanCursor(cursor: string): void;
  /** Whether a scan is in flight right now (drives the progress cluster). */
  isScanning(): boolean;
  /** Publish {@link isScanning}. */
  setScanning(scanning: boolean): void;
  /**
   * COUNT already consumed by the current user action. `0` = budget not in play.
   * Read together with {@link getScanBudgetTotal} for `扫描中 12k/50k`.
   */
  getScanBudgetUsed(): number;
  /** Budget ceiling for the current user action. `0` = unknown / unlimited. */
  getScanBudgetTotal(): number;
  /** Publish both budget halves in one call (one notification, not two). */
  setScanBudget(used: number, total: number): void;
  /**
   * Multi-selection size. Only the count crosses this relay — the selected keys
   * themselves stay in the driver workbench that mutates them (PRD I-8).
   */
  getSelectionCount(): number;
  /** Publish {@link getSelectionCount}. */
  setSelectionCount(n: number): void;
  /** Last write the server acknowledged, e.g. `SET app:cache:session:1`. */
  getLastWriteCommand(): string | null;
  /** Round-trip of {@link getLastWriteCommand} in ms, `null` when unknown. */
  getLastWriteDurationMs(): number | null;
  /** Record a completed write and its duration as one fact (one notification). */
  recordWrite(command: string, durationMs: number): void;
}
```

**消费写法（唯一正确姿势）**：一个组件只订阅它渲染的那一个字段，getter 直接传引用（宿主实现是闭包、不依赖 `this`）：

```ts
const loaded = useSyncExternalStore(state.subscribe, state.getLoadedCount);
```

**新面板初始值**（也是面板 id 被回收后重开的值，Wave 4 可依赖）：
`selectedKey: null` · `dirty: false` · `loadedCount: 0` · `scanCursor: '0'` · `scanning: false` ·
`scanBudgetUsed: 0` · `scanBudgetTotal: 0` · `selectionCount: 0` · `lastWriteCommand: null` ·
`lastWriteDurationMs: null`。注意 `scanCursor === '0'` 单独读**不代表扫描完成**，状态条必须与
`getLoadedCount()` 成对判断（见 `src/lib/kvSlotState.ts` 的 `EMPTY_SNAPSHOT` 注释）。

### F-2 宿主实现与生命周期 —— `src/lib/kvSlotState.ts`

```ts
export function createKvSlotState(): KvSlotState;
export function getKvSlotState(panelId: string): KvSlotState;
export function pruneKvSlotStates(livePanelIds: ReadonlySet<string>): void;
/** Test helper: forget every atom (production code must not call this). */
export function resetKvSlotStatesForTests(): void;
```

- 中继按 **panel id**（不是 `dbSessionId`）取，两个 KV 面板开在不同 db 上不得共享选中键。
- `pruneKvSlotStates` 是**唯一**回收路径：面板列表变化时由工作区调用；被复用的 panel id 回到全初始值。
- 驱动**不得** import 本文件（边界护栏 R1）：只从 `@datazen/driver-sdk` 拿 `KvSlotState` 类型，实例一律由槽位 props 的 `state` 传入。

### F-3 反向动作通道（§1.2）—— 只挂在 `KvContextBarProps`，**不进 store**

`packages/driver-sdk/src/types/kv-slots.ts`：

```ts
export type KvSlotAction =
  | { type: 'refresh' }
  | { type: 'newKey' }
  | { type: 'import' }
  | { type: 'export' }
  | { type: 'flushDb' }
  | { type: 'openMonitor' }
  | { type: 'openSettings' }
  | { type: 'setScanBudget'; value: number };
```

```ts
/** Content-toolbar 48px context bar (`kvWorkspace.contextBar`). */
export interface KvContextBarProps extends KvPanelSlotProps {
  compact: boolean;
  request(action: KvSlotAction): void;
}

/** Bottom status bar centre cluster (`kvWorkspace.statusBar`). */
export type KvStatusBarProps = KvPanelSlotProps;
```

`request` 的完整原文 JSDoc（含"为什么只有 context bar 有它"）见 `KvContextBarProps`；`KvPanelSlotProps.state: KvSlotState` 与 `connectionId` / `dbSessionId` / `connectionName` / `databaseType` / `database` / `dbIndex?` 保持 Wave 2 形状不变（**本轨零改名零删除**）。

宿主唯一 dispatcher —— `src/windows/connection/useKvSlotActions.ts`：

```ts
const WIRED_ACTIONS: readonly KvSlotAction['type'][] = ['refresh', 'openSettings'];

export interface UseKvSlotActionsArgs {
  onRefresh: () => void;
}

export interface KvSlotActionDispatcher {
  request: (action: KvSlotAction) => void;
  dialog: ReactNode;
}

export function useKvSlotActions({ onRefresh }: UseKvSlotActionsArgs): KvSlotActionDispatcher;
```

消费轨必须知道的三条裁定（原文注释在文件头）：

1. **未接线不是错误**：`newKey` / `import` / `export` / `openMonitor` / `setScanBudget` 目前是
   no-op + 一条 `console.warn`（`warnUnwired`），**禁止抛错**；槽位也不得因为"宿主可能不处理"而藏掉按钮。
2. **`flushDb` 先过写门闸再看有没有人执行**（PRD I-6）：Safe Mode 硬拦（`redis.kvSlot.flushBlocked`），
   否则共享 `useConfirmDialog` 确认；**同意也只走到 warn 为止** —— 真正跑 `flush_db` 的是驱动 workbench，
   宿主点名驱动命令是 PRD §7-4 禁止的硬编码。
3. `request` **身份稳定**（最新参数走 ref），因为它坐在被 memo 的槽位 props 包里；
   消费轨可以安全地把它放进 `useEffect`/`useCallback` 依赖而不用担心每帧变一次。
   接线点在 `useKvWorkspaceSlots`：`props: { ...panelSlotProps, request: onSlotAction }`，
   `onSlotAction` 由 `ContentView` 传入（`kvActions.request`）。

### F-4 AI 注入事实清单与空态规则（§1.3）

`src/lib/kvAiContext.ts`（宿主纯函数，无 React、无 IPC）：

```ts
export interface KvAiFacts {
  connectionName: string;
  dbSessionId: string;
  /** Database the active panel is bound to (`null` while none is resolved). */
  database: string | null;
  /** Key the panel's relay reports as selected (`null` ⇒ none). */
  selectedKey: string | null;
}

export interface KvAiContext {
  keyName: string;
  block: string;
}

export function hasKvAiFacts(facts: Pick<KvAiFacts, 'selectedKey'>): boolean;
export function buildKvAiContext(facts: KvAiFacts): KvAiContext | null;
export function composeKvAiMessage(content: string, context: KvAiContext | null): string;
```

`block` 的**逐字格式**（`selected_key` 为空时 `buildKvAiContext` 返回 `null`，永不产出空块）：

```text
[kv-context]
connection=<connectionName>
session=<dbSessionId>
database=<database 或空串>
selected_key=<keyName>
[/kv-context]
```

注入 / 不注入（Wave 4 与后续轨都不得越线）：

| 注入（宿主真的拥有） | 不注入（拿不到 ⇒ 也不许起缓存层） |
|---|---|
| `connectionName`、`dbSessionId`、面板绑定的 `database`、`getSelectedKey()` | 驱动 Console 缓冲区（§1.3 明令） |
| | `key_object_info` 的 `type` / `memoryBytes` / `encoding` / `ttlMs` —— 这些是**驱动键属性侧栏**在 `packages/drivers/redis/**` 内部取的事实，冻结形状里没有它们；要拿到只能重复发命令或在中继前面造缓存，两者分别被"勿重复发命令"与 BUG-005 裁定排除 |

**空态二元规则（本轨的可观测判据，只此一处实现）**：

```ts
// src/windows/connection/ContentToolbar.tsx
const kvSelectedKey = useKvSlotSelectedKey(kvPanelState);
const showAiChat = !kvPanelState || hasKvAiFacts({ selectedKey: kvSelectedKey });
```

即：KV 面板无选中键（含空白键）⇒ `MessageSquare` **不渲染**，不存在"点了没内容"的入口；
关系型面板（`kvPanelState === undefined`）行为与前置轨道完全一致，仍走 `contextTables`。
选中 ⇒ 出现，取消选中 ⇒ 再次消失（跃迁是双向的，不是单向死锁）。

读取中继的叶子 hook —— `src/hooks/useKvSlotSelectedKey.ts`：

```ts
export function useKvSlotSelectedKey(state: KvSlotState | undefined): string | null;
```

非 KV 面板回落到"永不触发"的订阅 + 常量 `null` 快照，因此该 hook **不构成**新的 getter，
`KvSlotState` 的标量约束没有被稀释。发送侧接线：

```ts
// src/windows/connection/ContentViewDrawers.tsx → <AiChatPanel kvContext={kvAiContext} />
// src/components/ai/AiChatPanel.tsx
kvContext?: KvAiContext | null;
// 发送：content: composeKvAiMessage(input.trim(), kvContext ?? null)
// 出现条件：kvContext 非空 ⇒ data-testid="ai-kv-context-chip" + data-key-name={kvContext.keyName}
```

上下文**随消息体发出**（宿主到模型仅此一条路径；为 KV 键发明线字段要新造后端命令），
因此它也会出现在转录里 —— 这正是"外发可见"的实现方式。`kvContext` 由 `useMemo` 钉住，
依赖只有 4 个标量（`connectionName` / `dbSessionId` / `currentDatabase` / 订阅到的 selectedKey），
**不是** `KvSlotState` 的 getter，不会被喂给 `useSyncExternalStore`。

### F-5 宿主接线点一览（消费轨不需要、也不得重复实现）

| 落点（文件:符号） | 作用 |
|---|---|
| `src/lib/kvSlotState.ts:createKvSlotState` | 不可变快照 + 字段级 `commit`（同值静默） |
| `src/windows/connection/useKvWorkspaceSlots.ts:KvWorkspaceSlots.panelState` | 把活动面板的中继交给工作区任意消费方（含 toolbar / drawer） |
| `src/windows/connection/useKvWorkspaceSlots.ts:contextBar` | `{ ...panelSlotProps, request: onSlotAction }` —— 反向通道唯一入口 |
| `src/windows/connection/ContentView.tsx` | 把 `kvSlots.panelState` 递给 `ContentToolbar` 与 `ContentViewDrawers`；`connectionName` 同源 |
| `src/windows/connection/ContentToolbar.tsx:showAiChat` | §1.3 空态二元规则的唯一实现点 |
| `src/windows/connection/ContentViewDrawers.tsx:kvAiContext` | 叶子订阅 + `buildKvAiContext` |
| `src/components/ai/AiChatPanel.tsx:kvContext` | 外发可见 chip + 随消息发送 |
| `src/locales/en/connection.ts` | `redis.kvSlot.flushTitle` / `flushMessage` / `flushBlocked` / `redis.ai.context.tooltip` / `redis.ai.context.attached` |

### F-6 Wave 4 两轨的取用约定（冻结的推论，写清以免再次裁定）

- **statusBar**（`KvStatusBarProps = KvPanelSlotProps`）：6 项全部来自 F-1 标量 getter，
  **没有** `request`（只读面）；需要动作请放到 contextBar。
- **contextBar**（`KvContextBarProps`）：扫描段读 `isScanning()` + `getScanBudgetUsed()` +
  `getScanBudgetTotal()` + `getScanCursor()`，预算调整发 `{ type: 'setScanBudget', value }`；
  该动作今天**故意**未接线（no-op + warn），槽位仍应照常渲染控件。
- 两轨都**不得**给 `KvSlotState` 加回调式逃生口（`onRefresh?: () => void` 之类一律禁止），
  也不得为缺事实起宿主缓存层（BUG-005）。缺什么就回协调者开新轨改契约。

## 自验记录

### 接管轮 · 四道门禁实跑（2026-09-22 18:08~18:12，worktree 根目录，本机无其他负载，串行单跑）

| # | 门禁 | 命令 | 基线（§5） | 实测 | 判定 |
|---|---|---|---|---|---|
| 1 | 类型 | `npx tsc --noEmit` | 0 错 | **0 错**（exit 0，输出 0 行） | ✅ |
| 2 | Host 单测 | `NO_COLOR=1 npx vitest run` | 451 files / 4658 tests | **453 files / 4730 tests，0 失败**（exit 0，105.77s） | ✅ 只增：+2 files / +72 tests |
| 3 | Drivers 单测 | `NO_COLOR=1 npx vitest run --config vitest.drivers.config.ts` | 47 files / 456 tests | **47 files / 456 tests，0 失败**（exit 0，9.32s） | ✅ 持平不红 |
| 4 | 边界护栏 | `node scripts/check-driver-import-boundaries.mjs` | 0 blocking | **1458 files scanned · 0 blocking · 4 advisory**（advisory 全部为既有 R3 跨包引用，非本轨引入） | ✅ |

门禁 3 的两条指名回归（§5.3 中继接线不得回退）：

- `packages/drivers/redis/ui/__tests__/kvSlotRegistration.test.ts` → **7 passed**
- `packages/drivers/redis/ui/__tests__/kvSlotRelay.test.tsx` → **15 passed**

### 接管轮的处置（先审计后最小补丁）

继承现场 = `M src/components/ai/AiChatPanel.tsx`、`M src/windows/connection/ContentToolbar.tsx`、
`M src/windows/connection/ContentViewDrawers.tsx`、`?? src/hooks/useKvSlotSelectedKey.ts`、
`?? src/lib/kvAiContext.ts`，方向正确、**未推倒重写**；缺的是接线，不是设计：

1. `ContentView.tsx` 未把 `kvSlots.panelState` / `connectionName` 递给 `ContentToolbar` 与
   `ContentViewDrawers` ⇒ `npx tsc --noEmit` 当时**实测 2 错**
   （`TS2741 connectionName is missing`、`TS6133 'kvAiContext' is declared but never read`）。
   前任留下的注释甚至写着"the drawer itself keeps rendering the same way either way"，但抽屉里的
   `kvAiContext` 算出来之后**从未传给 `AiChatPanel`** ⇒ §1.3 事实上没生效（按钮会隐藏，但消息仍无上下文）。
2. 补齐 `ContentViewDrawers → <AiChatPanel kvContext>`、`ContentView` 两处传参，并补
   `redis.ai.context.attached` 词条（`tooltip` 前任已在 en 侧落词）。
3. 补 §1.3 测试：`kvAiContext.test.ts` 10 例（纯函数：空态二元规则 / 逐字块格式 / 不含 console 事实 /
   同值同块）、`ContentToolbar.test.tsx` +4 例（含**双向跃迁**：选中出现、清空再次消失；空白键视为无键；
   关系型面板不误伤）、`ContentViewDrawers.test.tsx` +3 例（叶子订阅跟随选中、无需重挂载；无中继 ⇒ 空上下文）、
   `AiChatPanel.test.tsx` +3 例（块随 `content` 发出、chip 的 `data-key-name`、无上下文时逐字回退原载荷）。
   断言一律走 `data-testid` / `data-*` / i18n **key**，无英文字面量文案断言。

### 两条 F-2.1 硬约束的复核（任务书点名的风险点，实测未违反）

- **没有往 `KvSlotState` 塞数组/新对象**：§1.3 完全不经过中继取事实，`KvAiFacts` 的四个字段来自
  槽位 props（宿主已有）+ `getSelectedKey()` 标量订阅；`buildKvAiContext` 的返回对象由
  `useMemo`（4 个标量依赖）钉住，**不是** getter，也没有被喂进 `useSyncExternalStore`。
  唯一订阅点是 `useKvSlotSelectedKey`，其 `getSnapshot` 就是 `state.getSelectedKey`（标量）。
- **setter 同值不通知**：`commit()` 逐字段 `Object.is`，`kvSlotState.test.ts` 的
  `WIDENED_FIELDS` 表为 8 个新字段各带"同值不通知"与"标量快照稳定"两条（46 例全绿）。
- 未新增逃生口回调、未新建缓存层、未触碰 `packages/drivers/redis/**`（本轮 git 变更面见下）。

### 变更面与纪律自查

- 本轮 commit：`9c5bd8208`（§1.3 接线 + 测试，11 files）+ 本次台账 commit（仅 `docs/development/coordination/tracks/redis-kv-contract/**`）。
- 未提交任何 gitignored codegen / `Cargo.lock` / `src-tauri/Cargo.toml` / `hub.md` / 他轨 `tracks/**`；
  `git status --short` 收尾为 clean。
- 本轮**未跑任何 e2e / tauri build / cargo**（无 Rust 改动，任务书禁 live e2e）。
- 单文件规模：`ContentView.tsx` 574 / `AiChatPanel.tsx` 702 / `ContentToolbar.tsx` 245 /
  `ContentViewDrawers.tsx` 229 / `kvAiContext.ts` 89 / `useKvSlotSelectedKey.ts` 29，均 ≤800 行。
- i18n 只改 `en`（`src/locales/en/connection.ts`），其他语言留待发布前 i18n-sync 统一补
  （`src/locales/locales.test.ts` 与 `localeSync` 系列本轮全绿，未因缺词变红）。

### 前任记录（交回时登记，本实例未复现其运行）

- Host `4695 tests`、Drivers `457 tests`。本实例接管后实测 Host `4730`（含本轮新增 16 例与
  §1.3 半成品未计的部分）、Drivers `456`（= 基线）。**Drivers 457 → 456 无红色失败**：本轮与前任的
  提交面都没有新增/删除任何驱动侧 spec（`git show --stat 499a90da1 7bfb71f99` 可查），
  差异应为前任台账的口径笔误，留待 Tester 以本轮实测 47/456 为准。

### 未尽事项（不属本轨范围，登记以免重复推演）

1. `newKey` / `import` / `export` / `openMonitor` / `setScanBudget` 五条动作仍是 no-op + warn（契约如此）。
   `flushDb` 已过门闸但**没有执行器**：需要一条把驱动 `flush_db` 接进 dispatcher 的轨（由驱动侧
   暴露、宿主不点名命令），或裁定留在驱动 workbench 内。
2. `key_object_info` 的 `type/ttl/size/encoding` 进 AI 上下文：需要冻结形状里新增一个**标量/标签**通道
   或裁定让驱动侧自带上下文，本轨按 BUG-005 未擅自扩面。
3. Wave 4 的 contextBar / statusBar 消费端尚未渲染这些事实（本轨明确不做）。
4. 真连 Redis 的键树/状态条数字正确性属 R 回归项，单测与门禁证明不了。

---

## 测试轮记录（Tester · 2026-09-22 · 独立复核，只测不修）

### 四道门禁独立复跑（前置 `node scripts/generate-builtin-locales.mjs` 正常产出）

| # | 门禁 | 命令 | 基准 | 实测 | 判定 |
|---|---|---|---|---|---|
| 1 | 类型 | `npx tsc --noEmit` | 0 错 | **0 错**（exit 0，两轮复跑均 0 行输出） | ✅ |
| 2 | Host 单测 | `npx vitest run` | 基线 451/4658；coder 自报 453/4730 | **453 files / 4734 tests，0 失败**（exit 0；4734 = 4730 + Tester 新增 4） | ✅ 只增不红 |
| 3 | Drivers 单测 | `npx vitest run --config vitest.drivers.config.ts` | 47/456，`kvSlotRegistration`/`kvSlotRelay` 必须绿 | **47 files / 456 tests，0 失败**（exit 0，三轮复跑一致） | ✅ 持平 |
| 4 | 覆盖率 | `npx vitest run --coverage --coverage.include=<本轨变更文件>` | 核心文件 ≥80% | 核心五件 **100%**，整体阈值全过（exit 0），表见下 | ✅ |
| + | 边界护栏 | `node scripts/check-driver-import-boundaries.mjs` | 0 blocking | **1458 files · 0 blocking · 4 advisory**（既有 R3，与接管轮一致） | ✅ |

> 口径说明：覆盖率首轮与另外三条门禁并行执行，两个 SQL-editor 计时 smoke
> （`statementRanges.test.ts`，本轨未触碰）因负载超时 2 例 —— **孤立重跑 453/4734 全绿**，
> 判定为并行负载 flake，非回归；最终覆盖率数字取孤立重跑。

### 本轨变更文件覆盖率实测（v8，全量 Host 测试之下）

| 文件 | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `src/lib/kvSlotState.ts` | 100 | 100 | 100 | 100 |
| `src/lib/kvAiContext.ts` | 100 | 100 | 100 | 100 |
| `src/windows/connection/useKvSlotActions.ts`（dispatcher） | 100 | 100 | 100 | 100 |
| `src/windows/connection/useKvWorkspaceSlots.ts` | 100 | 100 | 100 | 100 |
| `src/hooks/useKvSlotSelectedKey.ts` | 100 | 100 | 100 | 100 |
| `src/windows/connection/ContentToolbar.tsx` | 90.9 | 87.5 | 66.66 | 94.11 |
| `src/windows/connection/ContentViewDrawers.tsx` | 73.46 | 68.11 | 66.66 | 75.55 |
| `src/components/ai/AiChatPanel.tsx` | 82.05 | 67.26 | 68.96 | 83.21 |
| **合计（本轨 include 集）** | **87.81** | **77.03** | **80.99** | **88.74** |

三个 UI 壳的未覆盖行均为**非本轨既有路径**（`ContentToolbar:225` = 文档按钮 onClick；
`ContentViewDrawers` ~154-162 = 行内单元格编辑、216-217 = 抽屉把手；`AiChatPanel`
= 聊天流 UI），§1.1–§1.3 的接线行（`showAiChat` / `useKvSlotSelectedKey` /
`useMemo` 块 / `kvContext` chip 与 compose）全部在覆盖内。

### Tester 新增测试（仅测试文件，`[tester]` 标注，4 例）

- `src/lib/__tests__/kvSlotState.test.ts` **+2**（46 → 48）：通知快照安全 ——
  ① 通知中途有监听者退订，不吞掉其余监听者，且退订对后续通知即刻生效；
  ② 通知中途新订阅的监听者本轮不收、下一轮起开始收。钉住 `[...listeners]`
  快照拷贝的存在理由（46 例契约矩阵未覆盖此边）。
- `src/windows/connection/__tests__/ContentToolbar.test.tsx` **+1**（7 → 8）：
  §1.3 状态机的**活体跃迁旅程**（rerender 不重挂载）：带键 KV 面板 → 无键 KV 面板
  （按钮消失）→ 关系型面板（按钮回默认态、KV tooltip 撤回、context bar 消失）。
  配套将 props 抽为 `toolbarProps()` 值以支持 rerender（纯测试重构）。
- `src/components/ai/__tests__/AiChatPanel.test.tsx` **+1**（18 → 19）：抽屉开着时
  切键的**连续发送旅程**：第一发块带 `selected_key=user:42`，rerender 切到
  `orders:99` 后 chip 的 `data-key-name` 与第二发的块同步换键。
- 三文件定向先行跑 75/75 绿；终跑全量 4734 绿。断言全部走
  `data-testid` / `data-*` / i18n **key**，无英文字面量 UI 文案。

### Stage A 审查判定（候选观察均**不构成缺陷**，依据如下）

1. **§1.1 冻结形状**与源码逐字一致；5 个既有成员零改名零删除；标量 / 同值静默 /
   成对单通知三条硬约束实测成立（表驱动 8 字段 × 4 断言 + recordWrite 同命令换时长仍通知）。
2. **§1.2** `request` 只在 `KvContextBarProps`（`KvPanelSlotProps` 无该通道，测试钉死
   statusBar/keyPropsSidebar 不带 `request`）；未知与未接线动作一律 warn 不抛；
   `flushDb` 门闸用宿主 `bindConfirmDialog(useConfirmDialog)` + `settingsStore.safeMode`
   —— 与驱动 `useRedisGate` 绑定的是**同一对 store**（`bindSettingsStore(useSettingsStore)`
   单点绑定、`bindConfirmDialog` 同理），不存在第二套确认逻辑，符合「复用 I-6 既有门闸」。
3. **§1.3** 注入面 = 连接名 / 会话 / 库 / 选中键 4 项；`key_object_info` 侧栏字段
   （type/memory/encoding/ttl）**按契约明文不注入**（未尽事项 #2 + BUG-005 + 冻结形状，
   要拿只能重复发命令或造缓存，双被禁止）—— 属已登记的裁定，非缺陷；console 缓冲区
   未注入；空白键经 trim 视为无键；空态二元规则双向跃迁（含活体切换）实测成立；
   块随 `content` 出仓，未新增任何 KV 线字段（无新后端命令）。
4. 新增测试未改任何生产代码；`git status --short` 收尾仅 3 个测试文件 + 2 个本轨台账文件。

### 留待 R 回归（需真 Redis / 真 GUI，本轨按任务书禁 live e2e / tauri build）

1. **§1.3 全旅程（GUI + 真 Redis）**：无键时 AI 按钮不可见 → 键树选键 → 按钮出现
   （`title` = `redis.ai.context.tooltip`）→ 开抽屉 `ai-kv-context-chip` 报键名 →
   发问，转录消息体含 `[kv-context]` 块且 `connection/session/database/selected_key`
   逐字正确 → 清空选键 → 按钮与 chip 再次消失（双向，非单向死锁）。
2. **flushDb 门闸（GUI）**：SafeMode 关 → 确认框（`redis.kvSlot.flushTitle/flushMessage`）
   → 拒绝零副作用、同意仅到 warn（无执行器，符合契约）；SafeMode 开 →
   `redis.kvSlot.flushBlocked` 硬拦、无确认路径可点穿。真执行 `flush_db` 留待执行器轨接通后补测。
3. **双面板隔离（GUI）**：同一连接开两个 KV 面板（不同 db）各自选键互不串；
   关闭其一再开，选键与 dirty 均为干净默认（`pruneKvSlotStates` 回收路径）。
4. **面板切换往返（GUI，keep-alive）**：带键 Redis 面板 ↔ SQL 面板 ↔ 另一 KV 面板
   往返，AI 按钮 / tooltip / context bar / 状态事实随 relay 正确切换，无残留。
5. **中继数值正确性（真 Redis）**：SCAN 期间 `loadedCount` / `scanCursor` /
   `scanBudget*` / `selectionCount` 与键树实际一致，`recordWrite` 时长量级合理
   （未尽事项 #4 的正主，单测证明不了）。

### 测试轮提交

- `test(kv-contract): verify redis-kv-contract with integration tests`：
  3 个测试文件（+4 例）+ `progress.md` 本节 + `bugs.md`（**无缺陷**）。
- 未碰任何生产代码、`hub.md`、他轨 `tracks/**`、gitignored codegen、`Cargo.lock`。
