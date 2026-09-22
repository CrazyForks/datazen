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

- [x] Coder 完成 → **READY_FOR_TEST**
- [ ] Tester 复测 → TEST_DONE

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
