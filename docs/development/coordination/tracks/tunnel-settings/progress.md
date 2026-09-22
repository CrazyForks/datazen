# Track: tunnel-settings — 设置页隧道管理分区（设置侧）

- 分支: `feature/tunnel-settings`（worktree `.worktrees/datazen-tunnel-settings`）
- 基线: `6e4df9a3`
- 角色: Coder → Tester
- 计划书: `design-plans/saved-tunnel-management.md`（P1-5、P1-6、P1-7、P1-8；G2 / G3 / G8 / G9）

## 背景

后端隧道实体与 4 个 IPC 已就绪，表单侧（`tunnel-form` 轨）也已完成「选择 / 另存为 / 引用完整性」，
但**没有任何管理界面**：`ConnectionAdvancedSettings` 的「管理已保存的隧道」入口调用
`openSettingsWindow('tunnels')`，而 `settings` 窗口没有 `tunnels` 分区，`parseSettingsSection`
静默降级到 `general` —— 按钮文案过度承诺。本轨补齐设置侧管理闭环。

## 范围

1. 注册 `tunnels` 设置分区（`settingsSections` + `hostLucideMap` + `SettingsContent` 分支）。
2. `TunnelSettingsSection`：列表（名称 / 类型 / 引用连接数）+ 编辑 / 复制 / 测试 / 删除 + 空态引导。
3. 编辑复用连接表单的三个 `*TunnelFields` 组件（不复制第二套表单）。
4. 删除严格「先解绑、后删除」，且只提供两个选项（取消 / 删除并解绑）。
5. 测试探针必须显式输入目标 host / port，并诚实说明探针能证明什么。
6. 测试：分区注册、列表（含空态）、G9 守卫、编辑 / 复制 / 删除 / 测试、连续旅程。

**无 Rust 改动**（后端 IPC 由并行轨道提供）；i18n 仅改 `src/locales/en/settings.ts`。

## 冻结契约（未改名，与后端 / 表单轨一致）

```ts
getTunnelSummaries: () => invoke<SavedTunnelSummary[]>('get_tunnel_summaries')  // 列表唯一数据源（无密文）
getTunnel: (id: string) => invoke<SavedTunnel | null>('get_tunnel')             // 仅编辑单条时使用
getTunnelUsage: (id: string) => invoke<TunnelUsage>('get_tunnel_usage')
testTunnel: (id, targetHost: string, targetPort: number) => invoke<number>('test_tunnel')
```

## 交付物

| 文件 | 说明 |
| --- | --- |
| `src/windows/settings/settingsSections.ts` | 新增 `'tunnels'` 分区与 `SettingsSectionLabelKey` |
| `src/lib/hostLucideMap.ts`、`src/components/ThemedIcon.tsx` | `tunnels → Cable` 图标（两处都要登记） |
| `src/windows/settings/SettingsContent.tsx` | `activeSection === 'tunnels'` 分支 |
| `src/windows/settings/TunnelSettingsSection.tsx` | 列表 + 引用计数批量拉取 + 编辑/复制/删除/测试编排（290 行） |
| `src/windows/settings/TunnelEditDialog.tsx` | 新建 / 编辑表单（302 行） |
| `src/windows/settings/TunnelDeleteDialog.tsx` | 影响面确认 + 两选项（183 行） |
| `src/windows/settings/TunnelTestDialog.tsx` | 探针目标输入 + 范围说明（158 行） |
| `src/lib/tunnelDraft.ts` | 纯草稿 ↔ 实体转换、校验（312 行） |
| `src/lib/tunnelDeletion.ts` | 先解绑后删除的事务与回滚（105 行） |
| `src/components/connection/tunnelFieldContracts.ts` | 三个字段组件的窄结构契约 |
| `src/components/connection/{Ssh,HttpProxy,WebSocket}TunnelFields.tsx` | `form` 收窄为契约类型；SSH 新增 `showEnableToggle` |

## 状态

**Phase: `PASSED`**

- [x] Coder 完成 → **READY_FOR_TEST**（实现 commit `9ed6604d`）
- [x] Tester 独立复测 → **PASSED**（测试 commit 见文末）

## 自验证证据（被验 HEAD = `9ed6604d`）

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `npx vitest run src/windows/settings src/components/connection src/lib/__tests__/tunnelDraft.test.ts src/lib/__tests__/tunnelDeletion.test.ts` | **33 files / 268 tests 全绿** |
| `pnpm test:unit` | 464 files，**4835 passed / 1 failed**；唯一失败为下述跨轨集成时序 |
| `pnpm test:unit:drivers` | 33 files / **241 passed**（基线 241，无回归） |
| `wc -l` 新增生产文件 | 290 / 302 / 183 / 158 / 312 / 105 / 83，全部 < 800 |

改动文件行覆盖率（定向运行 + `--coverage.include` 覆盖改动文件；临时 config 已删除，未提交）：

```
tunnelDraft.ts                lines 100    tunnelDeletion.ts   lines 100
hostLucideMap.ts              lines 100    tunnelFieldContracts lines 100
SshTunnelFields.tsx           lines  94.73 HttpProxyTunnelFields lines 100
WebSocketTunnelFields.tsx     lines 100    settingsSections.ts lines 100
TunnelSettingsSection.tsx     lines  93.58 TunnelEditDialog.tsx lines 87.62
TunnelDeleteDialog.tsx        lines  85.10 TunnelTestDialog.tsx lines 92.10
```

新增测试文件：

- `src/windows/settings/__tests__/tunnelSectionRegistration.test.tsx`（5）：`parseSettingsSection('tunnels')`、
  `SETTINGS_SECTIONS` 条目、`SETTINGS_SECTION_LUCIDE_MAP.tunnels` 经 `buildHostLucideById()` 可解析出真图标
  （`ThemedIcon` 渲染 `<svg>` 而非静默 `?`）、`SettingsContent initialSection="tunnels"` 渲染新分区。
- `src/windows/settings/__tests__/TunnelSettingsSection.test.tsx`（18）：空态 / 列表（名称·类型·引用数）/
  **G9 守卫（`getTunnels` 零调用）** / 加载失败重试 / 编辑走 `getTunnel`+`update` / 新建走 `create`+新 id /
  实体缺失 / 校验门闸 / 复制新 id + 名称后缀 / 删除影响面 + **`invocationCallOrder` 断言先解绑后删除** /
  取消零写入 / 解绑失败不删除 / 探针成功·失败·并发去重·范围说明。
- `src/windows/settings/__tests__/TunnelEditDialogFields.test.tsx`（9）：字段组件复用（SSH 无第二个开关、
  jump 字段在、三种类型切换后保存对应块）、编辑 id 稳定、加载态、加载/保存错误路径、取消。
- `src/windows/settings/__tests__/tunnelManagementJourney.test.tsx`（1）：**连续旅程**
  新建 → 列表出现 → 编辑改名（id 不变）→ 出现引用连接 → 复制（新 id / 名称后缀 / 独立引用计数）→
  删除并解绑（影响面列出连接名、解绑先于删除、连接仅丢失 `tunnelId`/`tunnelKind`、副本不受影响）。

## 权衡与取舍（供 Tester 复核）

1. **图标**：选 `Cable`。`SETTINGS_SECTION_LUCIDE_MAP` **没有回退**，`ThemedIcon` 内部 `LUCIDE_MAP`
   缺名时静默渲染 `?`，因此两处都必须登记；注册测试守卫整条链路，避免「注册了但看不见」。
2. **引用计数 N+1**：以 `summaries` 身份为依赖，一次 `Promise.allSettled` 并发批量拉取 `getTunnelUsage`，
   每次创建 / 编辑 / 删除后随列表一起刷新；用 `allSettled` 保证单个探针失败不会吞掉其它计数（失败项显示「—」）。
3. **删除顺序与失败语义**：逐条 `connectionCommands.saveConnection`（清空 `tunnelId`+`tunnelKind`）**严格早于**
   `deleteTunnel`；解绑中任一条失败则按逆序回滚已解绑的连接并**中止删除**（`unbind-failed`）；
   删除步骤失败时实体已无引用，单独报 `delete-failed` 并提示可重试。
   刻意**不用** `connectionStore.saveConnection`——它会吞掉异常（只写 `error`），无法据此中止删除。
4. **字段复用**：用窄结构契约（`tunnelFieldContracts.ts`）而非复制组件或 `as unknown` 强转；
   SSH 组件新增 `showEnableToggle={false}`，避免设置页出现第二个语义重复的开关（默认值 `true`，
   表单轨行为零变化）。`useTunnelFormState.ts` 未改动，草稿转换落在新的纯模块 `src/lib/tunnelDraft.ts`。
5. **i18n**：新 key 只落在 `en/settings.ts`（开发期规则）。由于 `TranslationKey` 由 zh-CN 包推导，
   英文独有 key 不在联合类型内，故把 `SETTINGS_SECTIONS[].labelKey` 放宽为
   `TranslationKey | 'settings.tunnels.title'`（仍是字面量，拼错即报错），未触碰 zh-CN。
6. **「默认高亮此项」**：两选项确认框没有「选中态」，实现为 danger 变体的主按钮
   （`tunnel-delete-confirm`）+ 次要的 `tunnel-delete-cancel`。
7. **探针默认目标**：host 默认 `127.0.0.1`、port 留空（必填），强制用户对目标做出明确选择；
   范围说明按类型给出（SSH 只证明跳板机可达，`raw_binary` 只证明中继可达）。

## 跨轨集成时序（已知，本轨不修）

`src/commands/__tests__/pathIpcWiring.test.ts` 唯一失败，缺失项恰好 3 条且全部属于后端轨道：

```
get_tunnel_summaries (commands/tunnel.ts)
get_tunnel_usage     (commands/tunnel.ts)
test_tunnel          (commands/tunnel.ts)
```

`src/commands/tunnel.ts` 由表单 / 后端轨冻结，本轨未改动；待后端注册这三个 host handler 后自动转绿。

## 跨轨改动说明（需协调者知悉）

`src/components/connection/__tests__/ConnectionAdvancedSettings.test.tsx` 中一条既有断言被更新：
它原本断言 `parseSettingsSection('tunnels') === 'general'`，并在注释里明确这是**注册前的已知限制**
（计划书 P1-5）。本轨注册该分区后该断言不再成立，故改为断言落在 `'tunnels'`。
除此之外未改动表单轨任何测试或行为。

## 备注（发现的既有隐患，未修）

`Select`（`@datazen/ui`）不接受 `data-testid`：JSX 属性名含连字符时 TypeScript 跳过多余属性检查，
该 prop 在运行时被静默丢弃。复用组件里既有的 `new-conn-*-scheme/mode` 等 testid 因此是**无效**的，
本轨测试改为通过 `button[aria-haspopup="listbox"]` 定位。属既有代码，未在本次范围内改动。

Tester 已独立证实该隐患并评估其影响：见下节「既有隐患登记」。

---

## Tester 独立复测（全新实例，零信任）

被验 HEAD = `9d18aafd`（实现 `9ed6604d`）。所有数字均为 Tester 本机重跑，未采信自报值。

### 各套件实测（Coder 自报 vs 独立实测）

| 命令 | Coder 自报 | Tester 实测 | 结论 |
| --- | --- | --- | --- |
| `pnpm typecheck` | exit 0 | exit 0（含 7 个新增测试文件） | 一致 |
| 定向 `vitest run src/windows/settings src/components/connection src/lib/__tests__/tunnelDraft.test.ts src/lib/__tests__/tunnelDeletion.test.ts` | 33 files / 268 passed | **33 files / 268 passed** | 一致 |
| `pnpm test:unit`（全量） | 464 files，4835 passed / 1 failed | **464 files，4840 passed / 1 failed**（复测后含新增测试：**471 files，4871 passed / 1 failed**） | 唯一失败同为跨轨时序；passed 数差 5（自报数偏低，疑似统计时点差异，非回归） |
| `pnpm test:unit:drivers` | 33 files / 241 passed | **33 files / 241 passed** | 一致，无回归 |
| `pnpm test:unit src/components/connection` | — | **14 files / 145 passed** | 表单轨全绿 |
| `git diff 6e4df9a3 HEAD -- …ConnectionAdvancedSettings.test.tsx` | 4+/4− | **4+/4−，单一 hunk** | 一致 |

`pnpm test:unit` 唯一失败仍为 `src/commands/__tests__/pathIpcWiring.test.ts`，缺失项**恰好 3 条**
（`get_tunnel_summaries` / `get_tunnel_usage` / `test_tunnel`，均 `commands/tunnel.ts`），**无夹带**。
已只读核对 `/Users/flyxl/code/datazen/src-tauri/src/bootstrap/run.rs:262/263/266`：三条 handler 已在
并行后端轨注册 → 属**跨轨集成时序**，不写入 `bugs.md`。

### 改动文件行覆盖率（定向运行 + `--coverage.include`）

| 文件 | Coder 自报 lines | Tester 实测 lines |
| --- | --- | --- |
| `tunnelDraft.ts` | 100 | **100** |
| `tunnelDeletion.ts` | 100 | **100** |
| `hostLucideMap.ts` | 100 | **100** |
| `tunnelFieldContracts.ts` | 100 | **100** |
| `settingsSections.ts` | 100 | **100** |
| `SshTunnelFields.tsx` | 94.73 | **94.73** |
| `HttpProxyTunnelFields.tsx` | 100 | **100** |
| `WebSocketTunnelFields.tsx` | 100 | **100** |
| `TunnelSettingsSection.tsx` | 93.58 | **93.67** |
| `TunnelEditDialog.tsx` | 87.62 | **87.62** |
| `TunnelDeleteDialog.tsx` | 85.10 | **97.87**（补齐测试后） |
| `TunnelTestDialog.tsx` | 92.10 | **92.10** |

全部 ≥ 80%（目标值）。

### (a)~(h) 结论

- **(a) 分区注册与入口落点**：`parseSettingsSection('tunnels') === 'tunnels'`；`SETTINGS_SECTIONS` 含该项。
  图标链路已逐步验证：`SETTINGS_SECTION_LUCIDE_MAP.tunnels = 'Cable'` → `settingsSectionIconId` = `settings.tunnels`
  → `buildHostLucideById()['settings.tunnels'] = 'Cable'` → `ThemedIcon` 的 `LUCIDE_MAP` 含 `Cable`（`lucide-react` 确实导出）
  → 渲染 `<svg>` 而非 `?`。两处映射**一致且无遗漏**（脚本比对 `HOST_LUCIDE_MAP` + `SETTINGS_SECTION_LUCIDE_MAP`
  的全部 lucide 名：无一缺失）。入口落点全链路核对：`openSettingsWindow('tunnels')` → `menu:open-settings{section}`
  → `ConnectionPage.openSettingsInShell(section)` → `setSettingsSection` → `<SettingsContent initialSection>` →
  `activeSection='tunnels'` → `<TunnelSettingsSection/>`。
- **(b) G9**：`getTunnels()` 在 `src/`、`packages/`、`e2e/` 中**零生产调用点**；列表/空态/加载失败/重试/创建/复制/
  删除后刷新全部只走 `getTunnelSummaries`。`getTunnel(id)` 的两处调用均需全量实体：`TunnelEditDialog`（编辑）与
  `TunnelSettingsSection.handleCopy`（复制必须复制凭据）+ 表单轨既有 `useTunnelFormState.refillFromSaved`（解绑为内联）。
  后者使 Coder 的「仅编辑单条时使用」表述不准确 → 见「非阻断发现」。
- **(c) 删除语义**：弹窗仅两个可操作按钮（`tunnel-delete-cancel` / `tunnel-delete-confirm`），无「直接删除」/「删除并内联」。
  顺序断言已用**更强形式**复核：解绑写入 pending 期间 `deleteTunnel` 尚未被调用（不只是 `invocationCallOrder`）。
  解绑失败 ⇒ 逆序回滚 + **`deleteTunnel` 零调用**（UI 层与纯函数层各覆盖）；回滚本身失败时提示 `rollbackNote`；
  取消零写入；受影响连接名先展示；引用计数在创建/编辑/复制/删除后刷新。
- **(d) 跨轨断言修改**：`4 insertions / 4 deletions`、单一 hunk，仅把 `parseSettingsSection('tunnels')` 的期望由
  `'general'` 改为 `'tunnels'`（旧注释自述为「注册前的已知限制」）——属**修正**：旧断言固化的是入口落错分区的缺陷行为。
  未删除其它断言、未放宽匹配；表单轨其它测试/生产文件未被改动。
- **(e) 字段组件复用**：窄契约是 `ConnectionFormState` 的**结构子集**，已用类型级断言
  （`Satisfies<ConnectionFormState, XxxTunnelFieldsValue>`）锁定；逐字段比对 `form.*` 使用点与契约键：SSH 34/34、
  HTTP 12/12、WS 8/8，**无字段丢失**。`showEnableToggle` 默认 `true` 的等价性已用真实组件断言（开关渲染、`sshEnabled`
  门控、`setSshEnabled(true)`、`innerPanelClassName`）；`showEnableToggle={false}` 时无开关且面板恒显。
  契约与三个字段组件**零 `any` / 零 `@ts-ignore` / 零 `as unknown as`**。
- **(f) 探针 UI 诚实性**：host 默认 `127.0.0.1`、port 留空被拦（按钮禁用 + 必填提示）；成功显示耗时、失败显示错误、
  进行中禁止重复点击。范围文案诚实：SSH 只证明跳板机可达 + 认证成功、`raw_binary` 只证明中继可达，且有总括句
  「测试通过绝不保证能经该隧道连到数据库」——**无过度承诺**。
- **(g) 无限重渲染修法**：以「每次渲染新建 `t`」的 mock 复现原缺陷调用方，`getTunnel`/`getTunnelUsage` 各只被调用
  预期次数（编辑 1 次、删除 2 次=列表批量 + 弹窗），渲染计数收敛。语言切换后**存储为 key 的错误文案正确重译**
  （编辑加载/保存、删除三处），且重译不触发重新取数；无闭包过期（effect 依赖 `[open, tunnelId]`，回调用当次渲染的 `t`）。
- **(h) 常规**：新增/改动文件全部 < 800 行；零 `any`/`@ts-ignore`；TS 侧无 `unwrap`；本轨无 Rust 改动；
  存在跨步骤**连续旅程**用例（新建→列表→编辑改名→引用→复制→删除并解绑）。

### 新增测试（Tester，前缀 `tester_`）

| 文件 | 用例数 | 覆盖的对抗性场景 |
| --- | --- | --- |
| `src/components/connection/__tests__/tester_tunnelFieldContracts.test.tsx` | 8 | (e)1 契约完整性（类型级 `Satisfies`）、(e)2 `showEnableToggle` 默认值等价、零 `any`/`@ts-ignore` 守卫 |
| `src/lib/__tests__/tester_tunnelDeletionOrder.test.ts` | 4 | (c)3 三个引用时的**逆序回滚**、回滚中途失败继续回滚、精确 id 匹配无连坐、回滚在途时绝不删除 |
| `src/windows/settings/__tests__/tester_TunnelDeleteRollback.test.tsx` | 6 | (c)1 仅两个选项、(c)2 解绑 settle 前不启动删除、(c)3 UI 层回滚 + 中止删除 + rollbackNote、(c) 删除失败不留悬空引用 |
| `src/windows/settings/__tests__/tester_TunnelDialogStability.test.tsx` | 5 | (g)1 不稳定 `t` 身份不产生无限重渲染（3 条路径）、(g)2 语言切换重译 key 错误且不重新取数 |
| `src/windows/settings/__tests__/tester_TunnelSettingsPlaintextGuard.test.tsx` | 2 | (b)3 空态/创建/复制/删除刷新全程 `getTunnels` 零调用；加载失败重试不回退 |
| `src/components/connection/__tests__/tester_SelectTestIdHazard.test.tsx` | 4 | (h) `Select` 静默丢弃连字符 `data-testid`、`triggerDataAttrs` 可用、生产 testid 确为无效 |
| `src/lib/__tests__/tester_settingsIconChain.test.tsx` | 2 | (a)2 全部设置分区（含 tunnels）经完整链路渲染为 `<svg>`、两处映射一致 |

合计 **7 files / 31 tests**，全部通过；全量套件因此为 **471 files / 4872 tests（4871 passed / 1 failed，唯一失败为跨轨时序）**。

### 非阻断发现（未登记为 Bug）

1. **`getTunnel` 调用面表述不准确**：`TunnelSettingsSection.tsx:27-28` 的 docstring 与冻结契约注释称
   `getTunnel(id)`「仅编辑单条时使用」，但复制路径（`TunnelSettingsSection.tsx:93`）与表单轨
   `useTunnelFormState.ts:353`（解绑为内联）也调用它。二者都**需要**全量实体才能保真复制/回填凭据，
   且都不属于「列表渲染」路径，故 G9 不变量（列表不触达明文密钥）**成立**；仅是注释与代码不符。
   若后续要收紧，可考虑后端新增 `copy_tunnel`，当前冻结契约下无法避免。
2. **次要路径的错误文案未走「key 存储」**：`TunnelSettingsSection.actionError`、`TunnelTestDialog` 的
   message-less 失败、`tunnelDeletion.ts`/`tunnelStore.ts` 的模块级 `t()` 会在失败时刻解析为字符串，
   语言切换后不会重译（原始 IPC 消息本不可译，仅影响兜底文案）。核心对话框（编辑/删除）已正确。
3. **`settings.tunnels.loadFailed` 为死 key**：`TunnelSettingsSection` 显示的是 store 的
   `tunnelStore.loadFailed`（`en/connection.ts:130`，已存在），新加的 `settings.tunnels.loadFailed` 无人使用。

### 既有隐患登记（既有代码，未修）

`@datazen/ui` 的 `Select` **不 spread 未知 props**（`packages/ui/src/Select.tsx` 只解构显式 props +
`triggerDataAttrs`；无 `...rest`）。连字符 JSX 属性（`data-testid`）被 TypeScript 跳过多余属性检查
（实测：`<Select data-testid="x" />` 通过 `tsc --noEmit`），运行时被静默丢弃。

- 受影响的既有 testid：`new-conn-http-proxy-scheme`、`new-conn-ws-mode`（本轨复用的两个字段组件）、
  以及 `dashboard-target-select`（`AddToDashboardDialog.tsx:112`）。
- **依赖评估**：全仓 grep 确认上述三个 testid **没有任何单测或 E2E 引用**（`e2e/specs/connection-validation.ts:66`
  用的是包在 `<div>` 上的 `new-conn-ssl-mode`，有效），因此**不存在「断言在测别的东西」的静默失效**。
- 可用定位方式：`button[aria-haspopup="listbox"]`（本轨与新增测试采用），或 `<Select triggerDataAttrs={{...}}>`。
- 已由 `tester_SelectTestIdHazard.test.tsx` 固化为可见守卫；若上游让 `Select` 转发任意 props，
  该测试的负向断言需翻转为正向。
