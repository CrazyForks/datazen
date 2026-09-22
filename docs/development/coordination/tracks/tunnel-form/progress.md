# Track: tunnel-form — 隧道实体的选择与管理闭环（表单侧）

- 分支: `feature/tunnel-form`（worktree `.worktrees/datazen-tunnel-form`）
- 角色: Coder → Tester
- 计划书: `design-plans/saved-tunnel-management.md`（G1 / G4 / G5 / G6 / G9 / G10；P0-1、P0-2、P0-3、P0-4、P1-8、P1-9）

## 背景

隧道后端（`SavedTunnel` / `tunnels.json` / 4 个 IPC / 连接时按 `tunnel_id` 回填）已完整，但前端
`saveTunnel` / `getTunnel` / `deleteTunnel` 全仓零调用点 → `tunnels.json` 永远为空 →
`ConnectionAdvancedSettings.tsx` 的「已保存的隧道」下拉被 `form.savedTunnels.length > 0` 永久短路，
从不渲染。用户因此看不到「选择已有隧道」。本轨补齐表单侧闭环（创建入口、三态状态机、引用完整性）。

## 范围（本轨只做前端 A–F，后端 3 个新 IPC 由并行轨道实现）

1. **A** `src/stores/tunnelStore.ts`（新建）：全应用隧道摘要单一真相，替换只在挂载时拉一次的 `useEffect`。
2. **B** `src/components/connection/useTunnelFormState.ts`（新建）：抽出隧道切片，`useConnectionForm.ts` 降到 800 行内。
3. **C** 「隧道来源」三态状态机 `none / saved / inline`，`tunnelKind` 降级为子选择器 / 只读派生值。
4. **D** 表单 UI：去掉空集合短路、`SaveTunnelDialog`、另存为隧道、引用失效告警 + 阻止保存。
5. **E** 契约与类型：`savedTunnels: SavedTunnelSummary[]`、`src/types/tunnel.ts` 收紧弱类型、en i18n。
6. **F** 测试：三态连续旅程、store 单测、面板 saved/空集合断言。

## 冻结契约（与后端轨道严格一致，未改名）

```ts
// src/types/tunnel.ts
export interface SavedTunnelSummary { id: string; name: string; kind: Exclude<TunnelKind, 'none'> }
export interface TunnelUsage { connectionIds: string[]; connectionNames: string[] }

// src/commands/tunnel.ts
getTunnelSummaries: () => invoke<SavedTunnelSummary[]>('get_tunnel_summaries')
getTunnelUsage: (id: string) => invoke<TunnelUsage>('get_tunnel_usage', { id })
testTunnel: (id: string, targetHost: string, targetPort: number) => invoke<number>('test_tunnel', { id, targetHost, targetPort })
```

既有 `get_tunnels` / `get_tunnel` / `save_tunnel` / `delete_tunnel` 未改动。

## 状态

- [x] Coder 完成 → **READY_FOR_TEST**（`27ad8a88`）
- [x] Tester Round 1 复测（阶段 A/B/C/D 全部完成）→ **FAILED**（2 Bug，见 [bugs.md](./bugs.md)）
- [x] Coder 修复 Round 1（BUG-001 / BUG-002）→ **READY_FOR_TEST**（修复 commit 见「Coder 修复记录」）
- [x] Coder 追加提交：**协调者批准的范围扩展**（内联隧道必填校验提前，同族缺陷）→ **READY_FOR_TEST**
- [ ] Tester Round 2 复测（全新实例）→ 待复测

## Coder 修复记录（Round 1，2026-09-22）

修复 commit：`c9777246`（BUG-001 / BUG-002）；追加 commit：`fix(tunnel): validate inline tunnel fields on driver-validator forms`（协调者批准的范围扩展）——两个 commit 的 hash 均见交接回报。
修复范围：`tunnel-form-BUG-001` + `tunnel-form-BUG-002`，外加协调者**明确批准**的一条同族范围扩展；除此之外未做任何范围外改动。

### BUG-001（中）—— 悬空引用在驱动自定义校验表单上不阻止保存

**根因**：`useConnectionForm.validate()` 在 `getDriverValidator(formVariant)` 命中时**提前 return**，悬空引用拦截位于其后，只有非驱动校验表单可达 → Redis 表单（`DRIVER_VALIDATORS = { redis: redisValidate }`）看到告警仍能保存。

**修复**（`src/components/connection/useConnectionForm.ts:546-580`）：把 `errors` 对象提到最前，悬空引用校验**提到驱动分支之前**，两条分支共用同一个 `errors`：

```ts
const errors: Record<string, string> = {};
if (tunnel.tunnelRefMissing) errors.tunnelId = t('newConn.tunnelMissing');

const driverValidator = getDriverValidator(formVariant);
if (driverValidator) {
  Object.assign(errors, driverValidator({ host, port, database, username, password, schema, options }, t));
  setValidationErrors(errors);
  return Object.keys(errors).length === 0;
}
// …非驱动分支的既有基础校验 + 内联隧道必填校验（作用域未变）…
```

- **无复制**：悬空校验只写一次；驱动校验自身的错误集合经 `Object.assign` **合并**进同一对象，未被覆盖（驱动校验器只报自身连接字段，`tunnelId` 属隧道域，无键冲突）。
- **驱动校验语义未变**：非悬空引用时驱动分支的行为与修复前逐字节等价（`errors` 起始为空）。

**证明用例**：`src/components/connection/__tests__/tester_tunnelRefIntegrity.test.ts`
→ `blocks saving a dangling reference on a driver-validator form (redis) [tunnel-form-BUG-001]`
断言链：`formVariant === 'redis'`、`tunnelRefMissing === true` → `validate() === false` → **`validationErrors.tunnelId === 'newConn.tunnelMissing'`** → `onSave()` 后 `saveConnection` 未被调用。

### BUG-002（低）—— 悬空引用态下「解绑为内联」是死路，文案指向不可达动作

**修复（最小，不动「拒绝静默丢参」的有意设计）**：

1. **文案只提可达动作**（`src/locales/en/connection.ts`）：
   - `newConn.tunnelMissing`：`The referenced saved tunnel no longer exists. Set “Tunnel source” to “None (direct)” to drop the reference before saving.`（切「无（直连）」在**任何**情形都可达，不再宣称「解绑为内联」）
   - 新增 `newConn.tunnelMissingAlt`：`You can also select another saved tunnel.`，**仅当** `savedTunnels.length > 0`（确有可选实体）时由 `ConnectionAdvancedSettings.tsx` 追加渲染，避免在集合为空时又指向一个不可达动作。
2. **隐藏死路按钮**：`new-conn-tunnel-unbind` 改为仅在 `!form.tunnelRefMissing` 时渲染（`ConnectionAdvancedSettings.tsx`）。选择「隐藏」而非「禁用」的理由：该状态下实体已不可读、回填被**有意**拒绝，即「解绑为内联」在本状态**根本不成立**（不是暂时不可用），保留一个禁用按钮只会让用户面对一个没有解释的死控件；移除后唯一的出口就是告警里点名且下拉中可操作的动作。非悬空态按钮照常渲染，`disabled={form.tunnelBusy}` 语义不变。
3. `unbindTunnel()` 拒绝回填的逻辑**未改**（有意设计，避免静默丢参）。

**证明用例**：
- `src/components/connection/__tests__/ConnectionAdvancedSettings.test.tsx`
  → `warns when the referenced tunnel no longer exists`（告警含 `newConn.tunnelMissing` 与 `newConn.tunnelMissingAlt`、**不含** `newConn.tunnelUnbind`、且 `new-conn-tunnel-unbind` **不在文档中**）
  → `does not offer another tunnel when the collection is empty in the dangling state`（集合为空时不含 `newConn.tunnelMissingAlt`，同样无解绑按钮）
- `tester_tunnelRefIntegrity.test.ts` → `cannot unbind a dangling reference; switching the source to \`none\` is the working exit`（保留 hook 层「拒绝静默丢参 + 切 none 是真正出口」回归；陈旧注释已同步更新）

### Tester `it.fails` 证据用例处理（按要求）

| 文件 | 用例 | 处理 |
| --- | --- | --- |
| `tester_tunnelRefIntegrity.test.ts` | `blocks saving a dangling reference on a driver-validator form (redis) [tunnel-form-BUG-001]` | `it.fails(...)` → **普通 `it(...)`**；修复后该用例真实通过，若保留 `it.fails` 会因「预期失败却通过」翻红。同时**加强**断言（新增 `validationErrors.tunnelId` 校验），并注明「已由 BUG-001 修复转化为回归守卫」 |

BUG-002 在 Tester 侧本就是以普通 `it` 写的（断言「拒绝解绑」这一保留行为），**无 `it.fails` 需要转换**，仅同步了其陈旧注释。Tester 已提交的回归覆盖（`tester_tunnelRefIntegrity.test.ts` 9 例、`tester_SaveTunnelDialog.test.tsx` 6 例、向既有文件追加的用例）**全部保留、零删除**。

### 范围扩展（**协调者批准**）—— 内联隧道必填校验同样提前：同族缺陷，源于本次重构不一致

- **发现者**：Coder（本轮自查，记录于下方原「同族观察」）；**批准者**：协调者（明确批准修掉，认定它不是无关的既存问题，而是本次重构留下的不一致：同一个 `validate()` 里隧道域规则对 Redis 一半生效、一半不生效）。**未登记进 `bugs.md`**（不属于上一轮 Tester 登记的 2 个 Bug）。
- **改动**（`src/components/connection/useConnectionForm.ts`）：把三条**内联**隧道必填校验一并移入驱动分支之前的共享序言，与悬空引用校验并入同一 `errors`：
  - `!tunnelId && effectiveTunnelKind === 'httpProxy'` → `httpProxyHost` / `httpProxyPort` 必填
  - `!tunnelId && effectiveTunnelKind === 'websocket'` → `wsUrl` 必填
  - `!tunnelId && effectiveTunnelKind === 'ssh' && sshEnabled` → `sshHost` / `sshUsername` 必填
- **作用域守住**：三条均带 `!tunnelId` 守卫 → **只对 `inline` 来源生效**，`saved` 来源按 id 校验、不受影响；`meta?.connectionMode === 'file'` 与 `isDriverForm` 的通用 host/port/database 校验**保持原样**留在非驱动分支（Redis 自有驱动校验器负责它自己的字段）；驱动校验结果仍走 `Object.assign` 合并，隧道域键不会被覆盖。
- **证明用例**（`tester_tunnelRefIntegrity.test.ts`，新增 `describe('[tester] inline tunnel validation is form-variant independent')`）：
  1. `requires inline HTTP proxy fields on a driver-validator form (redis)` —— `formVariant==='redis'` + `tunnelSource==='inline'` + `effectiveTunnelKind==='httpProxy'` + 空的 host/port → `validate()===false` 且 `validationErrors.httpProxyHost/httpProxyPort === 'newConn.required'`；
  2. `keeps the same inline requirements on a non-driver form (postgresql control)` —— 同夹具下 `getDriverValidator(formVariant)` 为 `undefined`（确认走非驱动分支）且报出**同样两个键**，证明非驱动路径不回归；
  3. `does not mis-block a driver-validator form with no tunnel configured (redis)` —— 等价性守卫：`tunnelSource==='none'` 的普通 Redis 连接 `validate()===true`、`validationErrors` 为空（hoist 未误拦正常保存）；同一用例再验证填好内联 HTTP 代理后仍 `validate()===true`。

### 自验结果（修复轮，命令按协调者更正，禁用 `npx`）

- `pnpm typecheck`：**0 error**
- `pnpm test:unit src/components/connection src/stores`：**38 文件 / 596 用例全部通过，0 失败，0 expected-fail**（Round 1 修复后 593；本次范围扩展 +3 例）
- `pnpm test:unit` 全量：**456 文件 / 4758 passed / 1 failed**，唯一失败仍为跨轨 `src/commands/__tests__/pathIpcWiring.test.ts`（后端 3 条新 IPC 未注册，合流后自动转绿，**非本轨 Bug、本轮未试图在 Rust 侧修复**）
- 修复轮共触及 3 个生产/文案文件 + 2 个测试文件 + 2 份轨道文档；`useConnectionForm.ts` **759 行**（< 800）

### Follow-up 登记（Tester 非 Bug 改进建议，本轮**按指示全部不修**）

来源：Tester Round 1「改进建议（非 Bug）」1–7（详见下方 Tester 复测记录 §改进建议），本轮原样保留为后续工作项：

1. `useTunnelFormState.ts` 617 行按「来源状态机 / 内联字段」两职责拆分；
2. store 加载失败对用户不可见且本会话不重试（建议空集合引导区分 error 态 + 重试入口）；
3. 「管理已保存的隧道」指向尚未落地的设置页分区（P1-5 前文案过度承诺）；
4. 另存为隧道无重名 / 长度校验；
5. `unbindTunnel()` 无引用分支未恢复 `lastInlineKindRef`（当前 UI 不可达，防御性硬化）；
6. `ConnectionFormState` 新增必填成员对驱动 UI 的外溢面（驱动 UI 未纳入类型检查）；
7. 跨窗口列表同步与设置页管理面（`usage` / `testTunnel` 等待调用）。

**原「同族观察」的去向**：该观察（驱动校验分支上内联隧道必填校验从不执行）已由协调者批准，按上述「范围扩展」**本轮已修**，不再作为 follow-up。


## Coder 实施记录（2026-09-22）

编码 commit：**（本提交，hash 见交接回报）**

### 三态状态机（进入 / 状态内 / 退出跃迁）

| 状态 | 进入条件 | 状态内行为 | 退出跃迁 |
| --- | --- | --- | --- |
| `none` | 选「无（直连）」 | 隐藏隧道字段 | 选 saved → `saved`（集合非空时）；选 inline → `inline` |
| `saved` | 选中一条 `SavedTunnelSummary`（集合空时**拒绝进入**） | 只读展示 name + kind，内联字段折叠；提供「解绑为内联」 | 解绑 / 改子类型 → `inline`（先 `getTunnel(id)` 回填全部内联字段，失败则**保留引用**）；选无 → `none` |
| `inline` | 选「手动配置」 | 类型子下拉 + 对应内联字段 +「另存为隧道」 | 选无 → `none`；另存成功 → `saved` |

- `tunnelId` **只经显式跃迁清空**（`none` / 解绑成功），改类型不再隐式清空。
- `effectiveTunnelKind` 为派生值：`saved` 取实体 kind（压过过期的 `tunnelKind` 提示）；`inline` 下 SSH 未勾选视为 `none`（不再发出 `tunnelKind:'ssh'` 却无配置）。
- `saved` 态改子类型 = 显式解绑：`refillFromSaved()` 成功后才切换，失败保持 `saved` 并提示。

### 文件改动

| 文件 | 改动 |
| --- | --- |
| `src/types/tunnel.ts` | 新增 `SavedTunnelSummary` / `TunnelUsage` / `TunnelSource`；`SshAuthMethod` 定义迁入本文件（tunnel 域，`src/types/index.ts` 再导出）；`SavedTunnel.ssh` 由 `{...jump?: unknown}` 收紧为 `SavedTunnelSshConfig`（递归），`authMethod: string` → `SshAuthMethod` |
| `src/types/index.ts` | 再导出新增类型 + `SshAuthMethod` 改为从 `./tunnel` 再导出 |
| `src/commands/tunnel.ts` | 新增 3 个冻结契约命令（`getTunnelSummaries` / `getTunnelUsage` / `testTunnel`） |
| `src/stores/tunnelStore.ts` | **新建**：`summaries/loaded/loading/error` + `load(force)` / `create` / `update` / `remove` / `usage`；`newTunnelId()` 生成 `tun_*` |
| `src/components/connection/useTunnelFormState.ts` | **新建**：隧道切片（状态机 + 全部内联字段 + 派生值） |
| `src/components/connection/useConnectionForm.ts` | 776 → **742** 行；隧道 state/effect 全部移入切片，展开进返回值；`validate` 增加悬空引用拦截 |
| `packages/driver-sdk/src/types/connection-form.ts` | `savedTunnels: SavedTunnel[]` → `SavedTunnelSummary[]`；新增 16 个隧道状态机成员 |
| `src/components/connection/ConnectionAdvancedSettings.tsx` | 来源控件恒渲染；空集合引导 + 新建/管理入口；saved 只读态 + 解绑；inline 类型子下拉 + 另存为；悬空告警 |
| `src/components/connection/SaveTunnelDialog.tsx` | **新建**：复用 `Dialog` + `Input` + `Button`，名称校验后调 store `create()` |
| `src/locales/en/connection.ts` | 新增 `newConn.tunnelSource/tunnelEmptyHint/tunnelCreateEntry/tunnelManage/tunnelSavedHint/tunnelUnbind/tunnelMissing/tunnelSave*/tunnelName*` 与 `tunnelStore.loadFailed`（仅 en，遵 i18n 规则） |
| `src/components/connection/__tests__/ConnectionAdvancedSettings.test.tsx` | mock form 补齐**全部** `ConnectionFormState` 字段并去掉 `as unknown as ConnectionFormState`；新增空集合 / saved 态 / 悬空告警 / 另存为 / 改类型不清引用断言 |
| `src/components/connection/__tests__/useTunnelFormState.test.ts` | **新建**：连续旅程测试（三态全过程 + 残缺中间态） |
| `src/stores/__tests__/tunnelStore.test.ts` | **新建**：load 短路 / force / 失败降级 / create 刷新 / update / remove / usage |
| `src/components/connection/__tests__/useConnectionForm.tunnel.test.ts` | 新增 tunnelStore mock；新增 saved 引用（不内联配置）、悬空引用阻止保存、改类型不清引用 |
| `src/components/connection/__tests__/NewConnectionDialog.test.tsx` | 展开隧道面板后的断言由 `new-conn-tunnel-kind`（现仅 inline 态渲染）改为恒渲染的 `new-conn-tunnel-source` |

### 关键设计决定

1. **列表 IPC 改用 `get_tunnel_summaries`（G9）**：store 只保存无密摘要，`get_tunnels`（含明文密钥）仅留给编辑单条实体。
2. **`load()` 失败置空数组且不抛**，并把 `loaded` 置 true（一次尝试即算尝试，避免每次挂载重试风暴）。同时 `tunnelRefMissing` 额外要求 `error === null`——加载失败**不**触发「引用已不存在」告警、不误拦合法保存（三维影响度自查 #2）。
3. **`testTunnel` / `usage` / `getTunnels` 当前无调用点**：属冻结契约与计划书 P1-7/P1-8 管理面接口，本轨按契约提供封装，非死业务逻辑。
4. **`setSshEnabled(false)` 保留 `tunnelKind='ssh'`**：SSH 复选框不再因取消勾选而整块消失（旧实现在此有去无回的 UX 缺陷）；改由 `effectiveTunnelKind` 保证不发出空配置。
5. **空集合入口**：面板内「手动配置」（→ inline）+「管理已保存的隧道」（`openSettingsWindow('tunnels')`）。设置页隧道分区属计划书 P1-5，未在本轨；分区落地前该入口由 `parseSettingsSection` 回退到 general，不崩溃。

### 自验结果（命令按协调者更正，禁用 `npx`）

- `pnpm typecheck`（= `tsc --noEmit`）：**0 error**
- `pnpm test:unit src/components/connection src/stores`：**36 文件 / 559 用例全部通过，0 失败**
  - 新增 `useTunnelFormState.test.ts` 14 用例、`tunnelStore.test.ts` 8 用例、`ConnectionAdvancedSettings.test.tsx` 12 用例
- `pnpm test:unit`（全量 454 文件）：**4721 passed / 1 failed**，唯一失败为
  `src/commands/__tests__/pathIpcWiring.test.ts`「every statically-invoked IPC is registered in the host handler list」，
  报告 `get_tunnel_summaries` / `get_tunnel_usage` / `test_tunnel` 未出现在 `src-tauri/src/bootstrap/run.rs` 的 handler 列表。
  **该失败属并行后端轨道**（本轨只做前端，冻结契约要求后端实现并注册这三个命令）；后端注册后即转绿。
- `useConnectionForm.ts` = **742 行**（< 800 红线）；`useTunnelFormState.ts` 617 行、`ConnectionAdvancedSettings.tsx` 354 行、`SaveTunnelDialog.tsx` 99 行、`tunnelStore.ts` 82 行
- 新增/改动生产代码零 `any`；生产路径无裸 `unwrap()`、无未处理 promise rejection（所有 fire-and-forget 分支内部已 catch）

### 已知限制 / 留待后续

- **跨窗口列表同步（G5 后半）**：store 已让同窗口内所有消费者实时一致（create/update/remove 后 `load(true)`）；
  另一窗口的改动仍需 `datazen:tunnels-changed` 类跨窗口事件，本轨未接入（计划书 P0-1 仅要求 store 化）。
- **设置页隧道管理分区（P1-5/P1-7/P1-8）** 不在本轨；`tunnelStore.usage` / `tunnelCommands.testTunnel` 已就绪待其调用。

## 留待 Tester 复测重点

1. 三态跃迁的**退出**路径是否都有：`saved` → 改类型/解绑 → `inline` 且参数回填；`saved` → `none`；`inline` → `none`。
2. 悬空 `tunnelId`：面板告警可见 **且** `onSave` 被 `validate()` 拦下（不落盘）。
3. 空集合时隧道面板**不再整段消失**，引导与新建入口可用。
4. `get_tunnel_summaries`（无密）是否已替换列表渲染路径，`get_tunnels` 不再用于下拉。
5. 全量套件中 `pathIpcWiring.test.ts` 的红是否为后端未注册所致（跨轨依赖，非本轨缺陷）。
6. **Round 2 追加**：悬空引用在**驱动校验表单（redis）**上同样被拦（`formVariant==='redis'` → `validate()===false` + `validationErrors.tunnelId`）；内联隧道必填校验对 redis 同样生效；`tunnelSource==='none'` 的普通 redis 连接保存**不被误拦**（等价性）；悬空态下「解绑为内联」按钮不再渲染且告警文案不再宣称该动作。

---

## Tester 复测记录（Round 1，2026-09-22）

- 被验 commit：`27ad8a88d635b4fd4813e0fbe6542087627e8a9e`（16 文件 +2205/−312）
- 复测实例：全新 Tester 实例（与 Coder 不同实例）；仅写入本 worktree，未触碰 hub.md / 主检出 / 其他 worktree
- **结论：FAILED** — 2 个 Bug（`tunnel-form-BUG-001` 中、`tunnel-form-BUG-002` 低）

### 阶段 A：实现审查（逐文件 Read + `git show 27ad8a88`）

通过项：

- **三态状态机（C，G4/G6）**：`none / saved / inline` 三要素齐全，进入条件（`saved` 需集合非空，空集合拒绝进入）、状态内行为（`saved` 只读 + 折叠内联字段）、退出跃迁（`none` / 解绑 / 改类型 / 另存为）均实现。`tunnelId` 仅在显式跃迁清空；`setTunnelKind` 不再隐式清引用；`setTunnelSource('inline')` / `setTunnelKind` / `setTunnelId(null)` 在 `saved` 态一律先 `refillFromSaved()`（`getTunnel(id)` 回填全部内联字段，含 jump 递归），失败则**保留引用**。`effectiveTunnelKind` 派生正确（`saved` 取实体 kind 压过过期提示；inline SSH 未勾选降为 `none`）。
- **G1**：`ConnectionAdvancedSettings.tsx` 去掉 `savedTunnels.length > 0` 整段短路，来源控件恒渲染；空集合显示引导 + 「手动配置」入口 + 「管理已保存的隧道」入口。
- **G3**：`tunnelRefMissing` 定义正确（要求 `loaded && error === null && savedTunnel === null`，加载失败不误判）；**非驱动校验表单**上 `validate()` 正确拦截并写入 `validationErrors.tunnelId`，`onSave()` 被拦下。⚠️ **驱动校验表单上未拦截 → BUG-001**。
- **G9**：全仓 grep 确认 `getTunnels`（返回明文实体）**零生产调用点**，列表/选择器一律走 `tunnelStore` → `getTunnelSummaries`（无密摘要）；`getTunnel` 仅用于「解绑回填」这一确实需要凭据的路径。G9 闭合。
- **契约变更**：`packages/driver-sdk/src/types/connection-form.ts` 的 `savedTunnels` 已改为 `SavedTunnelSummary[]` 并新增 16 个状态机成员；`src/types/tunnel.ts` 的 `jump` 递归化（`SavedTunnelSshConfig`）与 `authMethod: SshAuthMethod` 自洽；`src/types/index.ts` 重导出一致（`SshAuthMethod` 迁入 tunnel 域后再导出，`SshTunnelConfig.authMethod` 仍引用同一类型）。
- **测试质量**：`ConnectionAdvancedSettings.test.tsx` 已**去掉** `as unknown as ConnectionFormState` 强转，补齐全部 `ConnectionFormState` 字段（含 `savedTunnels` / `tunnelId` / `setTunnelId` / 三态成员）与 saved 态、空集合、悬空告警、另存为断言。`useTunnelFormState.test.ts` 满足 AGENTS.md 连续旅程测试要求（`none → inline → 残缺中间态 → saved → 解绑回填 → none` 全程击键式模拟并逐步断言跃迁）。
- **代码卫生**：改动生产文件零 `any`、零 `@ts-ignore`；无裸 `unwrap`/`expect`；4 处 `void` 发后不理的 Promise 全部落在内部已 try/catch 且不可能 reject 的函数上（`loadTunnels` / `refillFromSaved` 及其 IIFE 包装），无未处理 rejection。
- **文件规模**：`useConnectionForm.ts` 742 行（< 800 红线）、`useTunnelFormState.ts` 617、`ConnectionAdvancedSettings.tsx` 354、`SaveTunnelDialog.tsx` 99、`tunnelStore.ts` 82。

改进建议（非 Bug，详见「改进建议」小节）：`useTunnelFormState.ts` 617 行建议按「来源状态机 + store 集成」与「三型内联字段 + 实体投影」两个职责拆分。

### 阶段 B：独立复验（零信任重跑，自报 vs 实测）

| 套件 | Coder 自报 | Tester 独立实测（仅 Coder 测试） | 判定 |
| --- | --- | --- | --- |
| `pnpm typecheck` | 0 error | **0 error** | 一致 |
| `pnpm test:unit src/components/connection src/stores` | 36 文件 / 559 用例全绿 | **36 文件 / 559 passed / 0 failed** | 一致 |
| `pnpm test:unit`（全量） | 454 文件 / 4721 passed / 1 failed | **454 文件 / 4721 passed / 1 failed** | 一致 |
| `wc -l src/components/connection/useConnectionForm.ts` | 742（< 800） | **742** | 一致 |
| `pnpm test:unit:drivers`（契约变更外溢面，Coder 未报） | — | **33 文件 / 241 passed / 0 failed** | 无回归 |

- 全量唯一失败 = `src/commands/__tests__/pathIpcWiring.test.ts`「every statically-invoked IPC is registered in the host handler list」，缺失项**恰好 3 条**（`get_tunnel_summaries` / `get_tunnel_usage` / `test_tunnel`，均来自 `commands/tunnel.ts`），无夹带其他 IPC 或别的错误 → **确认为跨轨集成时序，非本轨 Bug**（见下）。
- `node scripts/generate-builtin-locales.mjs` 已先执行；测试命令全程未用 `npx`、未执行 `pnpm install`。

### 跨轨集成时序说明（不计入 bugs.md）

并行轨道 `tunnel-backend` 的 worktree `/Users/flyxl/code/datazen/.worktrees/datazen-tunnel-backend` 中，`src-tauri/src/bootstrap/run.rs` **已注册**这三个命令（只读核对）：

```
262:            crate::commands::get_tunnel_summaries,
263:            crate::commands::get_tunnel_usage,
266:            crate::commands::test_tunnel,
```

本轨 worktree 的 `run.rs` 仅有既有 4 条（260-263: `delete_tunnel` / `get_tunnel` / `get_tunnels` / `save_tunnel`）。两轨合流到集成分支后该断言应自动转绿，**不登记为 Bug**。

### 阶段 C：覆盖率驱动的测试补齐

新增测试文件（均标注 `[tester]`）：

| 文件 | 用例数 | 覆盖路径 |
| --- | --- | --- |
| `src/components/connection/__tests__/tester_tunnelRefIntegrity.test.ts`（新） | 9（含 1 `it.fails`） | 编辑既有连接时 `summaries` 仍在飞行 → 不误告警/不误拦保存；集合落定后确为悬空 → 告警 + 拦保存；**删除被引用隧道**后表单转入悬空并拦保存；store `load()` 失败降级为空且不拦合法保存；悬空引用无法解绑（BUG-002 证据）；**Redis 驱动校验表单未拦悬空引用（BUG-001 证据，`it.fails`）**；内联 SSH（含 jump）从既有连接水合；内联 SSH 缺 host/username 校验；file 模式缺 database 校验 |
| `src/components/connection/__tests__/tester_SaveTunnelDialog.test.tsx`（新） | 6 | 空名 / 纯空白名禁用确认；提交前 trim；保存失败不关弹窗、错误可见、可重试（无半残引用）；busy 态双按钮禁用；重开清空输入；超长名（512 字符）无上限校验（记录为改进项） |
| `src/components/connection/__tests__/useTunnelFormState.test.ts`（追加 `[tester]` 块） | +8 | `setTunnelSource('inline')` 自 `saved` 回填（含 jump 全字段）；`setTunnelKind('none')` 退出；`setTunnelId(null)` 无引用为 no-op 且不调 `get_tunnel`；`unbindTunnel()` 无引用分支；`saveAsTunnel` 拒绝无效/空配置；WebSocket 另存为（完整 config 断言）；`saved` 重入保留当前选择而非跳回首项；`setSshEnabled(true)` 不脱离 `saved`；`getTunnel` 拒绝的字符串 / 非 Error / 无 message 三条错误归一化路径 |
| `src/components/connection/__tests__/ConnectionAdvancedSettings.test.tsx`（追加 `[tester]` 块） | +3 | 空集合时 `saved` 来源选项 `aria-disabled` 且点击无效；有摘要时可选；管理入口路由到设置窗口（并记录实际落到 general）；inline 态隧道错误可见 |
| `src/stores/__tests__/tunnelStore.test.ts`（追加 `[tester]` 块） | +3 | Error 实例 → 用其 message；无 message 对象 → 本地化兜底（非 `[object Object]`）；后续 `load(true)` 清空上次 error |

**改动文件覆盖率（`pnpm test:unit:coverage`，`--coverage.include` 精确限定到改动文件）**

| 改动文件 | 改动前（Coder 测试）行 | 改动后（+Tester 测试）行 | 改动后 语句/分支/函数 |
| --- | --- | --- | --- |
| `src/stores/tunnelStore.ts`（新） | 95.0% | **100%** | 100 / 100 / 100 |
| `src/components/connection/useTunnelFormState.ts`（新） | 95.51% | **100%** | 99.61 / 82.12 / 100 |
| `src/components/connection/SaveTunnelDialog.tsx`（新） | 100% | **100%** | 95.23 / 94.44 / 100 |
| `src/components/connection/ConnectionAdvancedSettings.tsx` | 77.41% | **83.87%** | 85.71 / 87.65 / 77.27 |
| `src/components/connection/useConnectionForm.ts` | 81.11% | **91.41%** | 86.79 / 68.77 / 84.61 |
| `src/commands/tunnel.ts`（薄 IPC 封装） | 37.5% | 37.5% | 37.5 / 100 / 28.57 |

- 5 个含逻辑的改动文件**行覆盖率全部 ≥ 83.87%**，达到「改动代码 ≥ 80%」目标；三个新文件（改动前不存在，等价 0%）均达 95%+。
- `src/commands/tunnel.ts` 为 `invoke` 薄封装，项目 `vitest.config.ts` 明确将其排除在覆盖率门禁之外（"Thin `src/commands/**` invoke wrappers ... stay out of the fail gate"），故不补测。
- `useConnectionForm.ts` 分支 68.77%：未覆盖分支集中在**本轨未改动**的既有路径（`captureSnapshot`/`restoreSnapshot` 快照矩阵、`applyTypeDefaults` 的 index/file 分支、测试结果滚动 `setTimeout`），非本轨新增逻辑；行/函数/语句均 ≥ 84%。
- 未覆盖到的本轨新增分支仅 4 处（`useTunnelFormState.ts` 235/340/349/443）：`349`（`refillFromSaved` 的 `!id` 防御分支，调用方均已用 `tunnelId` 守卫，不可达）、`235/340/443`（`jump`/`mode` 缺省值兜底与 `saved` 重入的等价分支），属防御性代码，非业务路径。

### 阶段 D：E2E 用例登记

| # | 用例 | 前置条件 | 标注 |
| --- | --- | --- | --- |
| 1 | 空集合引导：连接对话框 → 展开「隧道」面板 → 「隧道来源」可见（不再整段消失）→ 显示 `newConn.tunnelEmptyHint` 引导 → 「手动配置」入口可用 → 「管理已保存的隧道」入口可点击（当前落到设置页 general，属已知限制） | 完整构建（`pnpm tauri:build:webdriver`）+ `tunnels.json` 为空 | 【本机可执行】 |
| 2 | 另存为隧道：来源选「手动配置」→ 选 HTTP 代理（或 WebSocket）→ 填入合法 host/port → 「另存为隧道…」按钮由禁用转可用 → 弹窗输入名称 → 确认 → 面板切换为 `saved` 只读态（显示名称 + kind 徽标），内联字段折叠 | 承接用例 1；完整构建 | 【本机可执行】 |
| 3 | 复用（saved 态）：关闭对话框 → 重新打开新建连接 → 展开隧道面板 → 来源选「已保存的隧道」（非空集合下可选）→ 下拉列出用例 2 的隧道 → 选中后仅提交 `tunnelId`（无内联 `sshTunnel`/`httpProxyTunnel`/`websocketTunnel`）→ 保存后重开该连接，saved 态与名称回显 | 承接用例 2；需可观测 IPC payload（devtools 或 e2e 钩子） | 【本机可执行】 |
| 4 | 解绑为内联：saved 态点「解绑为内联」→ 来源变 `inline`、`tunnelId` 清空 → **内联字段已按该隧道参数回填**（host/port/用户名/认证方式，SSH 含 jump 全字段）→ 可直接保存为一条独立的直连配置 | 承接用例 3 | 【本机可执行】 |
| 5 | 删除并解绑：删除用例 2 的隧道（管理面或清空 `tunnels.json`）→ 重新打开引用它的连接 → 面板顶部出现「引用的隧道已不存在」告警 → **保存被拦下**（不落盘）→ 「解绑为内联」被拒（BUG-002 现象）→ 将来源切到「无（直连）」后可正常保存 | 承接用例 3；需可写 `tunnels.json` 的 dev 环境 | 【本机可执行】（BUG-002 现象一并观察） |
| 6 | 驱动校验表单的悬空引用拦截（BUG-001 回归）：重复用例 5，但连接类型改为 **Redis** → 告警出现后点保存 → **期望被拦下且不落盘**（当前实测会保存成功 → 修复后此用例应转绿） | 承接用例 5；`DATAZEN_DRIVERS` 含 redis（basic 即含） | 【留待 R 回归】 |
| 7 | 真实隧道连通（可选）：saved 态引用一条真实 SSH / HTTP 代理隧道 → 「测试连接」经 `resolve_tunnel_ref` 走真实隧道成功 | `e2e/.env` 配置 `E2E_SSH_HOST` / `E2E_HTTP_PROXY_HOST` / `E2E_WS_TUNNEL_URL` 与可达目标库 | 【留待 R 回归】 |

> 现有 `e2e/specs/journeys/tunnel-connection-journey.ts` 仅走 `selectTunnelKind`（内联三型），**未覆盖**已保存隧道闭环；上述 1–5 建议并入该 journey（新增 `expandTunnelSection` 后的 `new-conn-tunnel-source` 交互步骤，选择器均已具备稳定 `data-testid`）。本轨未修改 E2E 代码（避免与并行轨道冲突），仅登记用例。

### 改进建议（非 Bug）

1. **`useTunnelFormState.ts` 617 行职责偏混**：建议拆为 `useTunnelSourceMachine`（来源/引用/派生值/跃迁/busy/error，约 250 行）与 `useInlineTunnelFields`（三型内联字段 + `buildInlineTunnel` / `applyTunnelToInline`，约 350 行），降低单文件认知负荷。
2. **store 加载失败对用户不可见且无重试**：`load()` 失败置空数组并置 `loaded=true`（降级本身符合要求），但 `tunnelStore.error` 从未被任何 UI 渲染，面板会把「加载失败」呈现为「还没有已保存的隧道」；且 `load()` 短路导致**本会话内不再重试**（仅 create/update/remove 会触发 `load(true)`）。建议空集合引导处区分 error 态并给「重试」。
3. **「管理已保存的隧道」入口指向不存在的分区**：`openSettingsWindow('tunnels')` 经 `parseSettingsSection` 回退到 `general`（设置页隧道分区属计划书 P1-5，本轨未做）。按钮文案过度承诺，建议 P1-5 落地前改为弱化文案或临时禁用。
4. **另存为隧道无重名 / 长度校验**：`tunnelStore.create` 恒生成新 `tun_*` id，重名允许；名称无最大长度约束（512 字符实测可提交）。建议加长度上限与重名提示。
5. **`unbindTunnel()` 无引用分支不自洽**：`tunnelId` 为空时只把 `tunnelSource` 置 `inline`，未恢复 `lastInlineKindRef`，得到 `source='inline'` 但 `kind='none'`（该值不在内联子下拉选项中）。当前 UI 不可达（解绑按钮仅在 `saved` 态渲染，而 `saved ⇒ tunnelId ≠ null`），属防御性硬化建议。
6. **契约变更的外溢面**：`ConnectionFormState` 新增 16 个**必填**成员，但 `tsconfig.json` 的 `include` 不含 `packages/drivers/*/ui`，驱动 UI（`redis/ui/connection/ConnectionWizard.tsx`、`sqlserver/ui/ConnectionFields.tsx`）与 `pnpm test:unit:drivers` 均不做类型检查。当前实测 `savedTunnels` 在驱动 UI 零消费、驱动套件 241/241 绿，**无实际破坏**；但后续契约再增删成员时，越界驱动可能静默失效，建议把驱动 UI 纳入类型检查或改用 `satisfies` 夹具。
7. **冻结契约暂未接线**：`tunnelCommands.getTunnels` / `getTunnelUsage` / `testTunnel` 与 `tunnelStore.usage` 当前零生产调用点，属计划书 P1-5/P1-7/P1-8 管理面接口，待其落地（非死代码，本轨按冻结契约提供封装）。

### Tester 交付物

- 新增：`src/components/connection/__tests__/tester_tunnelRefIntegrity.test.ts`、`src/components/connection/__tests__/tester_SaveTunnelDialog.test.tsx`
- 追加 `[tester]` 描述块：`src/components/connection/__tests__/useTunnelFormState.test.ts`、`src/components/connection/__tests__/ConnectionAdvancedSettings.test.tsx`、`src/stores/__tests__/tunnelStore.test.ts`
- 协调文件：本 `progress.md` + `bugs.md`
- 测试后全量实测：`456 文件 / 4753 passed / 1 failed（跨轨 pathIpcWiring）/ 1 expected fail`；`pnpm typecheck` 0 error；`pnpm test:unit:drivers` 33 文件 / 241 passed
