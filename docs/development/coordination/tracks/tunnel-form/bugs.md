# Track: tunnel-form — Bug 清单

被验编码 commit：`27ad8a88d635b4fd4813e0fbe6542087627e8a9e`
Tester 复测轮次：Round 1（独立全新实例）
登记时间：2026-09-22

> 复测结论：**FAILED**（2 个 Bug）。编码代理自报的测试数字经独立重跑**全部逐项吻合**；
> 唯一跨轨失败（`pathIpcWiring.test.ts`）已确认为后端轨道未合流的集成时序问题，不计为 Bug（见 `progress.md`）。

---

## Round 2 复测结论（2026-09-22，全新 Tester 实例）

被验 HEAD：**`cfb63354`**（`c9777246` = BUG-001 + BUG-002 修复；`cfb63354` = 协调者批准的
同族范围扩展「内联隧道必填校验对驱动校验表单同样生效」）。

**两个 Bug 均判定「已修复」**，范围扩展经独立复验**成立且未误伤合法保存**。本轮**零新增 Bug**。

| Bug | 修复 commit | Round 2 判定 | 关键独立证据 |
| --- | --- | --- | --- |
| BUG-001 | `c9777246` | **已修复** | redis + 悬空引用 → `validate()===false`、`validationErrors.tunnelId==='newConn.tunnelMissing'`、`onSave()` 后 `saveConnection` 零调用；**负对照**：同一用例在 `aaad6ca2` 上失败 |
| BUG-002 | `c9777246` | **已修复** | 悬空态 `new-conn-tunnel-unbind` **不在文档中**；`tunnelMissingAlt` 仅在 `savedTunnels.length>0` 时出现；`unbindTunnel()` 仍拒绝回填；切「无（直连）」后 `validate()` 转真且 `tunnelId` 清空、**实际落盘**。**负对照**：同一断言在 `aaad6ca2` 组件上失败 |

范围扩展（`cfb63354`）：`redis` + `inline` 的 httpProxy/websocket/ssh 必填校验均生效；
**等价性矩阵**（`standard` / `file` / `redis` 三个变体 × 无隧道 / 填全 / `saved` 有效引用）全部通过，
`tunnelSource==='none'` 的普通 Redis 连接保存**未被误拦**。

### 记录偏差（非 Bug，仅存档）

上一轮记录的 `useConnectionForm.ts` 行覆盖率 **91.41%** 经本轮回放 `aaad6ca2`（源码 + 当轮测试）
**不可复现**：同一命令实测为 **90.99%**。其余 4 个文件的基线数字（100/100/100/83.87）逐项吻合。
本轮 HEAD 同口径实测仍为 **90.99%**，故覆盖率**未因本轮改动下降**，但上一轮 91.41% 应视为高报。

---

## tunnel-form-BUG-001 — 悬空 `tunnelId` 在「驱动自定义校验表单」上不阻止保存

- **量级**：中（静默持久化一个必然连接失败的引用；用户侧已看到告警却仍能保存）
- **状态**：`已修复`（Round 2 复测通过，修复 commit `c9777246`）
- **影响范围**：所有 `getDriverValidator(formVariant)` 命中的表单变体，当前构建即 **Redis**（`redisMeta.connectionForm = 'redis'` 且 `supportsSSH: true`，`DRIVER_VALIDATORS = { redis: redisValidate }`）。未来任何注册了驱动校验器的驱动（如 sqlserver 若接入）同样中招。后端 `resolve_tunnel_ref` 找不到 id 时抛 `ConnectionError::Internal("tunnel id '{tid}' not found")`，即保存成功但连接必失败。

### 描述

`useConnectionForm.validate()`（`src/components/connection/useConnectionForm.ts:546-555`）在存在驱动校验器时**提前 return**，跳过了第 564 行新增的悬空引用拦截：

```ts
const validate = useCallback((): boolean => {
  const driverValidator = getDriverValidator(formVariant);
  if (driverValidator) {
    const errors = driverValidator({...}, t);
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;   // ← 提前返回，下面的 tunnelRefMissing 永不执行
  }
  ...
  if (tunnel.tunnelRefMissing) errors.tunnelId = t('newConn.tunnelMissing');  // 仅非驱动校验表单可达
```

Redis 表单的隧道面板**照常渲染**（`ConnectionAdvancedSettings` 恒渲染来源控件，`tunnelSource==='saved'` 时 `new-conn-tunnel-missing` 告警可见），因此用户看到「引用的隧道已不存在…请在保存前解绑」后点击保存，**保存照常成功**，违反计划书 P1-8 与 G3 的「告警 **且** 阻止保存」。

### 重现步骤

1. 新建一条已保存隧道（任意类型）。
2. 新建一个 **Redis** 连接并引用该隧道（隧道来源 → 已保存的隧道），保存。
3. 在隧道管理面删除该隧道（或直接删除 `tunnels.json` 中的实体）。
4. 重新打开第 2 步的 Redis 连接表单。
5. 观察：面板顶部出现琥珀色告警「引用的隧道已不存在…」。
6. 点击保存。

### 实测错误日志

新增 `it.fails` 用例（`src/components/connection/__tests__/tester_tunnelRefIntegrity.test.ts`，标记 `[tunnel-form-BUG-001]`）实测：

```
formVariant = 'redis'
tunnelRefMissing = true
validate() = true
validationErrors = {}
```

对照（同一份夹具、`databaseType: 'postgresql'`，无驱动校验器）行为正确：

```
tunnelRefMissing = true
validate() = false
validationErrors.tunnelId = 'newConn.tunnelMissing'
saveConnection 未被调用
```

`pnpm test:unit src/components/connection/__tests__/tester_tunnelRefIntegrity.test.ts` 输出：
`Tests 1 failed (expected fail) | 8 passed (9)` —— 该用例以 `it.fails` 标记，套件保持绿色，修复后会自动翻红提示移除标记。

### 建议修复方向（不修改业务代码，仅供 Coder 参考）

把悬空引用校验提到 `driverValidator` 分支之前（两分支共用），或在驱动校验器返回后合并 `tunnelRefMissing` 错误。

---

## tunnel-form-BUG-002 — 悬空引用态下「解绑为内联」是死路，且引导文案指向该不可达动作

- **量级**：低（无数据丢失，存在可用替代出口；但恰好在本功能主场景下误导用户并形成无效循环）
- **状态**：`已修复`（Round 2 复测通过，修复 commit `c9777246`）
- **影响范围**：所有「引用的隧道已被删除」的表单（任意数据库类型），即 P1-8 专门设计的场景。

### 描述

悬空引用态（`tunnelRefMissing === true`）下：

1. 面板告警文案 `newConn.tunnelMissing` 指示：*「引用的隧道已不存在。请在保存前选择另一条隧道**或解绑为内联**。」*
2. 该状态下「解绑为内联」按钮**照常渲染且可点击**（`new-conn-tunnel-unbind`，见 `ConnectionAdvancedSettings.tsx:287-295`）。
3. 但 `unbindTunnel()` → `refillFromSaved()` → `tunnelCommands.getTunnel(id)` 对已删除实体返回 `null`，于是**拒绝解绑**并提示 `newConn.tunnelUnbindKept`「无法读取已保存的隧道，引用已保留」。

即：应用要求用户执行一个它自己必然拒绝的动作；用户按提示操作会陷入「点解绑 → 报错 → 引用仍在 → 仍无法保存」的无效循环。真正可用的出口（把「隧道来源」下拉切到「无（直连）」，或改选另一条隧道）**未被文案提及**。

`unbindTunnel` 拒绝回填本身是**有意设计**（Coder 记录：`refillFromSaved()` 失败则保留引用，避免静默丢参），此处不否定该设计；缺陷在于「告警文案 + 可点击的死路按钮」与实际可达路径不一致。

### 重现步骤

1. 新建已保存隧道 → 新建 PostgreSQL 连接引用它并保存。
2. 删除该隧道。
3. 重新打开该连接表单 → 顶部出现 `new-conn-tunnel-missing` 告警（文案要求「解绑为内联」）。
4. 点击「解绑为内联」。
5. 观察：出现红色提示「无法读取已保存的隧道，引用已保留」，状态仍为 `saved`，`tunnelId` 未被清空。
6. 点击保存 → 被 `validate()` 拦下（`validationErrors.tunnelId`）。**唯一出口**：把「隧道来源」切到「无（直连）」。

### 实测错误日志

`src/components/connection/__tests__/tester_tunnelRefIntegrity.test.ts`（`[tester]` 描述块内）实测断言：

```
await unbindTunnel()  →  tunnelSource = 'saved'（期望 'inline'）
                          tunnelId = 'tun_gone'（引用保留）
                          tunnelError = 'newConn.tunnelUnbindKept'
setTunnelSource('none') →  tunnelId = null, tunnelRefMissing = false, validate() = true  ← 真正的出口
```

### 建议修复方向（不修改业务代码，仅供 Coder 参考）

- 最小修复：`newConn.tunnelMissing` 文案改为只提可达动作（「请选择另一条隧道，或将隧道来源切换为『无（直连）』」），并在 `tunnelRefMissing` 为真时隐藏/禁用「解绑为内联」按钮。
- 或允许在实体缺失时「解绑为内联」退化为清空引用 + 空内联配置（用 `lastInlineKindRef` 恢复子类型），需产品确认是否可接受。

---

## Coder 修复说明（Round 1，修复 commit 见 `progress.md`「Coder 修复记录」）

> 本轮只修上述 2 个 Bug，零范围外改动。修复后 Phase 回到 `READY_FOR_TEST`，等待**全新 Tester** 复测；未自行标 `已修复`。

### BUG-001 → `待复测`

- **改动**：`src/components/connection/useConnectionForm.ts` `validate()` —— `errors` 对象提到最前，悬空引用校验移到 `driverValidator` 分支**之前**，两分支共用同一 `errors`；驱动校验器结果经 `Object.assign` **合并**（非覆盖）。非悬空引用时驱动分支行为与修复前完全等价。
- **证明用例**：`src/components/connection/__tests__/tester_tunnelRefIntegrity.test.ts` → `blocks saving a dangling reference on a driver-validator form (redis) [tunnel-form-BUG-001]`（原 `it.fails` 已转为普通 `it`，并加强断言 `validationErrors.tunnelId === 'newConn.tunnelMissing'`）。
- **自验**：`pnpm test:unit src/components/connection src/stores` = 38 文件 / 593 用例全绿，0 expected-fail。

### BUG-002 → `待复测`

- **改动**：`src/locales/en/connection.ts`（`newConn.tunnelMissing` 改为只提可达动作「把 Tunnel source 切到 None (direct)」；新增 `newConn.tunnelMissingAlt` 仅在确有其他可选隧道时追加）+ `src/components/connection/ConnectionAdvancedSettings.tsx`（`new-conn-tunnel-unbind` 在 `tunnelRefMissing` 为真时**不渲染**）。
- **未改**：`unbindTunnel()` 拒绝回填（避免静默丢参）的有意设计原样保留。
- **证明用例**：`ConnectionAdvancedSettings.test.tsx` → `warns when the referenced tunnel no longer exists`、`does not offer another tunnel when the collection is empty in the dangling state`；`tester_tunnelRefIntegrity.test.ts` → `cannot unbind a dangling reference; switching the source to \`none\` is the working exit`（保留，注释同步更新）。
