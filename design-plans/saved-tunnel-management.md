# 隧道实体的选择与管理闭环

Written against: a7ac714cd9b915d72a1b1cc258ec89500b359c47

## 现象

新建连接 → 展开「隧道」面板 → 只有「隧道类型」下拉（无 / SSH / HTTP 代理 / WebSocket）+ 对应内联字段。用户无法选择一条已保存的隧道，也无任何入口创建、重命名、编辑、删除、测试已保存的隧道。

## Evidence chain

### 已经打通的部分（后端 + 状态，全部可用）

- 实体：`SavedTunnel`（`packages/driver-api/src/tunnel_types.rs:80`），`kind` + `ssh` / `http_proxy` / `websocket` 三选一
- 引用：`ConnectionConfig.tunnel_id`（`packages/driver-api/src/types.rs`）
- 存储：`{app_data_dir}/tunnels.json`，敏感字段（SSH password/passphrase、HTTP proxy password、WS authToken）AES-256-GCM（`src-tauri/src/store/tunnels.rs:32,92`），启动加载（`src-tauri/src/store/mod.rs:12,205`）
- IPC：`get_tunnels` / `get_tunnel` / `save_tunnel` / `delete_tunnel`（`src-tauri/src/commands/tunnel.rs`），已在 `generate_handler!` 注册（`src-tauri/src/bootstrap/run.rs:260-263`），并有 IPC 面守卫测试（`src-tauri/src/commands/ipc_surface_tests.rs:38-39`）
- 运行时解析：`ConnectionManager::resolve_tunnel_ref` 按 `tunnel_id` 回填 `ssh_tunnel` / `http_proxy_tunnel` / `websocket_tunnel` 再走既有 tunnel runtime（`src-tauri/src/services/connection_manager/tunnels.rs:22-39`）
- 前端：类型 `src/types/tunnel.ts`、命令封装 `src/commands/tunnel.ts`、表单契约 `packages/driver-sdk/src/types/connection-form.ts:44-48`（`tunnelId` / `setTunnelId` / `savedTunnels`）、hook 挂载时拉取 `useConnectionForm.ts:227-240`、构建时「有 tunnelId 就不写内联配置」`src/lib/connectionFormModel.ts:117-137`
- UI：确实存在一个「已保存的隧道」下拉（`src/components/connection/ConnectionAdvancedSettings.tsx:208-223`）

### 缺口

**G1（根因）没有创建入口，`saveTunnel` 是死代码。**
`tunnelCommands.saveTunnel`（`src/commands/tunnel.ts:9`）在 `src/`、`packages/`、`e2e/` 中零调用点（全仓 grep 仅命中定义处与 Rust 侧注册）。因此 `tunnels.json` 永远为空 → `savedTunnels` 恒为 `[]` → 下拉被 `form.savedTunnels && form.savedTunnels.length > 0`（`ConnectionAdvancedSettings.tsx:208`）整段吞掉，**从不渲染**。这正是用户看到「没有选择已有隧道的功能」的直接原因：功能已写，但被空列表永久短路。

**G2 没有管理面。** `getTunnel`、`deleteTunnel` 同为死代码。设置页无隧道分区（`src/windows/settings/settingsSections.ts:4-28` 的 `SettingsSection` 联合与 `SETTINGS_SECTIONS` 均无 tunnel 项）。没有任何地方能列出/改名/编辑/删除/复制/测试一条已保存隧道。

**G3 引用完整性缺失：悬空 `tunnelId` 会硬失败。**
`resolve_tunnel_ref` 在找不到 id 时返回 `ConnectionError::Internal("tunnel id '{tid}' not found")`（`tunnels.rs:29-33`）；`delete_tunnel`（`src-tauri/src/store/tunnels.rs:181-193`）只做 `retain`，不检查引用、不清洗引用方。于是删除一条隧道会静默打断所有引用它的连接，且用户侧报错是一句内部字符串。表单侧也不校验：`validate`（`useConnectionForm.ts:523-574`）在 `tunnelId` 存在时直接跳过隧道相关校验。

**G4 没有「内联配置另存为隧道」与「解绑为内联」。**
编辑一条引用隧道的连接时，看不到底层隧道参数，也无法改它。隧道类型下拉的 `onChange` 直接 `form.setTunnelId(null)`（`ConnectionAdvancedSettings.tsx:201-204`），而 `setTunnelKind` 内部也清 `tunnelId`（`useConnectionForm.ts:89-93`）——一旦用户误改类型，引用被清空、内联字段为空，隧道参数静默丢失，无确认无提示。

**G5 列表一次性拉取，必然过期。**
`useEffect(..., [])`（`useConnectionForm.ts:227-240`）只在表单挂载时取一次。若在管理面新建/删除隧道，或另一窗口改动，已打开的表单列表是陈旧的。

**G6 两个控件共管同一状态，语义冲突。**
选中已保存隧道时 `setTunnelId` 会反向改写 `tunnelKind`（`useConnectionForm.ts:97-109`），但类型下拉仍可编辑并会清掉 `tunnelId`。「隧道类型」与「已保存隧道」谁优先没有单一真相，违反 AGENTS.md 的状态机三要素要求（有进入条件、无退出跃迁定义）。

**G7 导出/分享丢失隧道，导入无法产生隧道。**
`write_connections_export`（`src-tauri/src/commands/connection_import/ipc.rs:177-194`）只导出 `connections` + `groups`，**不导出 `tunnels.json`**；而连接对象带着 `tunnelId`（`src/lib/connectionConfig.ts:52-53`）。接收方导入后即得一条指向不存在隧道的连接，连接时触发 G3 的 `Internal` 错误。各导入器一律硬编码 `tunnel_id: None`（如 `src-tauri/src/commands/connection_import/map.rs:70`，dbeaver/navicat/datagrip/tableplus 同）。`ConnectionShareDialog.tsx` 全文无 `tunnel` 字样。

**G8 没有独立隧道连通性测试。** 只有 `test_connection` 顺带解析隧道（`tunnels.rs:41-57`），无法在管理面单独验证一条隧道是否可用。

**G9 列表 IPC 泄露明文密钥。**
`get_tunnels` 返回的是已解密实体（`src-tauri/src/store/tunnels.rs:143-146` 配合 `decrypt_tunnel_secrets`），即 `invoke('get_tunnels')` 会把 SSH 密码/口令、代理密码、WS authToken 明文送进 webview——而渲染一个下拉只需要 name + kind。

**G10 覆盖空洞。**
`ConnectionAdvancedSettings.test.tsx:11-86` 的 mock form 完全没有 `savedTunnels` / `tunnelId` / `setTunnelId`（靠末尾 `as unknown as ConnectionFormState` 强转绕过类型检查），且无任何 saved-tunnel 断言；E2E `e2e/specs/journeys/tunnel-connection-journey.ts:48-50` 只走 `selectTunnelKind`（内联三型），从不涉及已保存隧道。Rust 侧无「删除带引用隧道」的测试。

**附带**：`src/types/tunnel.ts:29-47` 的 `SavedTunnel.ssh.jump?: unknown` 与 `authMethod: string` 是弱类型占位（同文件已定义 `SavedTunnelSshConfig` 却未使用）。

## Design decision

把隧道从「表单内联字段的一种排列」提升为**独立可管理的实体**，围绕它建立三件事：单一真相的隧道集合、以「隧道来源」为唯一主控的表单状态机、删除时的引用完整性。UI 复用既有 `@datazen/ui` 图元（`Dialog` / `Select` / `Button` / `Label`），不新增设计图元。

关键取舍：**不把内联配置改造成隧道存储格式**，而是保留双轨（内联=一次性，SavedTunnel=可复用），通过「另存为隧道」在两者间单向提升；避免破坏 `connectionFormModel.ts:117-137` 已确立的「有 tunnelId 就不写内联」契约。

## 优化方案

### P0 —— 让功能真正可达（解 G1/G5/G9）

1. **前端隧道集合收敛为 Zustand store**（`src/stores/tunnelStore.ts`）：`tunnels` / `loaded` / `load()` / `create()` / `update()` / `remove()` / `summaries`。`useConnectionForm` 与设置页共读同一 store，替换 `useConnectionForm.ts:227-240` 的一次性 fetch，解决 G5。
2. **「另存为隧道」**：隧道面板底部在内联配置通过校验时显示按钮 → 弹 `Dialog` 输入名称 → `tunnelCommands.saveTunnel({id:newId(), name, kind, [kind]: 当前内联配置})` → 成功后 `setTunnelId(newId)`，内联字段折叠为摘要行。这是 G1 的最小闭环。
3. **取消 `length > 0` 短路**（`ConnectionAdvancedSettings.tsx:208`）：始终渲染「隧道来源」控件；空集合时显示引导文案 + 「新建隧道…」入口，而不是整段消失。
4. **列表 IPC 去密钥**：新增 `get_tunnel_summaries`，返回 `SavedTunnelSummary { id, name, kind }`（Rust 侧 `#[serde(skip)]` 或独立 DTO）；`get_tunnel` 保留全量、仅在编辑单条时调用。解 G9。

### P1 —— 管理面 + 引用完整性（解 G2/G3/G4/G6/G8）

5. **设置页新增 `tunnels` 分区**：`settingsSections.ts` 的联合与 `SETTINGS_SECTIONS` 加项，新增 `TunnelSettingsSection.tsx`。列表列 name / kind / 引用连接数 / 操作（编辑、复制、测试、删除）；编辑复用 `SshTunnelFields` / `HttpProxyTunnelFields` / `WebSocketTunnelFields`（它们只依赖 `ConnectionFormState`，可抽出为受控子组件复用）。
6. **删除走引用检查**：新增 `get_tunnel_usage(id) -> { connectionIds, names }`。删除弹窗展示受影响连接，三选一：取消 / 删除并解绑（清空引用方 `tunnelId`，连接退回直连）/ 删除。默认「删除并解绑」，禁止无提示静默删除。
7. **`test_tunnel(id)`**：复用 `start_tunnel` 建立隧道后立即拆除并回报，供管理面单独验证（解 G8）。
8. **表单侧引用校验**：`tunnelId` 非空但不在 `savedTunnels` 中时，面板顶部显示「引用的隧道已不存在」告警并阻止保存（解 G3 的用户侧可见性）。
9. **「隧道来源」单一状态机**，替换现有双控件互踩：

   | 状态 | 进入条件 | 状态内行为 | 退出跃迁 |
   |---|---|---|---|
   | `none` | 选「无」 | 隐藏隧道字段 | 选 saved → `saved`；选 inline → `inline` |
   | `saved` | 选中一条 `SavedTunnel` | 只读展示 kind + 名称，字段折叠；可「解绑为内联」 | 解绑 → `inline`（回填该隧道参数）；选无 → `none` |
   | `inline` | 选「手动配置」 | 显示 kind 下拉 + 对应字段 | 选无 → `none`；「另存为隧道」成功 → `saved` |

   `tunnelKind` 降级为 `inline` 态下的子选择器与 `saved` 态下的只读派生值；清空 `tunnelId` 必须经显式跃迁（解绑），不再由改类型隐式触发（解 G4/G6）。

### P2 —— 往返、类型与测试（解 G7/G10）

10. **导出带隧道**：`write_connections_export` 一并序列化被引用的隧道（或全量）；导入时按 id 冲突策略合并 `tunnels.json`，`map.rs` 等处不再一律 `tunnel_id: None`。若决定不做，则导出时显式剥离 `tunnelId` 并给出提示，二者必须选一，不能维持现状。
11. **收紧类型**：`src/types/tunnel.ts` 的 `jump?: unknown` → `SavedTunnelSshConfig`，`authMethod: string` → `SshAuthMethod`。
12. **测试**：host 单测覆盖 tunnelStore、来源状态机跃迁（含残缺中间态，遵 AGENTS.md 连续旅程测试）；`ConnectionAdvancedSettings.test.tsx` 补 `savedTunnels` 夹具与 saved 态断言（顺带去掉 `as unknown as` 强转）；Rust 覆盖 `get_tunnel_summaries` 不含密钥、删除带引用、`test_tunnel`；E2E 在 `tunnel-connection-journey.ts` 增补「另存为隧道 → 复用 → 删除解绑」旅程。
13. **收口 RFC**：`docs/architecture/rfc/saved-tunnel-entity.zh-CN.md:38-49` 的「剩余」列表已过时（第 1 项已完成、第 2 项部分完成），随本方案更新或标记关闭。

## Changes

| 文件 | 动作 |
|---|---|
| `src/stores/tunnelStore.ts` | 新增：隧道集合单一真相 |
| `src/windows/settings/TunnelSettingsSection.tsx` | 新增：隧道管理面 |
| `src/windows/settings/settingsSections.ts` | 改：加 `tunnels` 分区 |
| `src/components/connection/ConnectionAdvancedSettings.tsx` | 改：去 `length>0` 短路，来源状态机，另存为/解绑 |
| `src/components/connection/useConnectionForm.ts` | 改：接 tunnelStore，引用校验，显式跃迁 |
| `src/commands/tunnel.ts` | 改：加 `getTunnelSummaries` / `getTunnelUsage` / `testTunnel` |
| `src-tauri/src/commands/tunnel.rs` | 改：三个新命令 + 注册 |
| `src-tauri/src/store/tunnels.rs` | 改：`usage` 查询、摘要投影 |
| `src-tauri/src/commands/connection_import/ipc.rs` | 改：导出携带隧道（或显式剥离 + 提示） |
| `src/types/tunnel.ts` | 改：类型收紧 |
| `src/locales/en/connection.ts` | 改：新增 `newConn.*` 文案（仅 en，遵 i18n 规则） |

## Reuse

- `Dialog`（`src/components/ui/Dialog.tsx` → `packages/ui/src/Dialog.tsx`）：另存为/删除确认/编辑弹窗
- `Select` / `Button` / `Label`（`src/components/ui/`、`packages/ui/src/`）：来源选择与列表操作
- `SshTunnelFields` / `HttpProxyTunnelFields` / `WebSocketTunnelFields`（`src/components/connection/`）：管理面编辑复用同一字段组件
- `resolve_tunnel_ref`（`connection_manager/tunnels.rs:22-39`）与 `tunnelCommands`（`src/commands/tunnel.ts`）：既有解析与 IPC 封装，不重造

## Uncertainty

- 导出语义二选一（携带隧道 vs 剥离并提示）需产品定夺；若选「携带」，需定义导入时 id 冲突的合并策略。
- 删除时的「删除并内联」选项（把隧道参数写回各引用连接）未纳入默认方案：它需要把 `SavedTunnel` 反向投影为各连接的 `sshTunnel`/`httpProxyTunnel`/`websocketTunnel`，与 `connectionFormModel.ts:117-137` 的单向契约相冲突，建议先只提供「取消 / 删除并解绑」。
