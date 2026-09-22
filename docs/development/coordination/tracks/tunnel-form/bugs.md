# Track: tunnel-form — Bug 清单

被验编码 commit：`27ad8a88d635b4fd4813e0fbe6542087627e8a9e`
Tester 复测轮次：Round 1（独立全新实例）
登记时间：2026-09-22

> 复测结论：**FAILED**（2 个 Bug）。编码代理自报的测试数字经独立重跑**全部逐项吻合**；
> 唯一跨轨失败（`pathIpcWiring.test.ts`）已确认为后端轨道未合流的集成时序问题，不计为 Bug（见 `progress.md`）。

---

## tunnel-form-BUG-001 — 悬空 `tunnelId` 在「驱动自定义校验表单」上不阻止保存

- **量级**：中（静默持久化一个必然连接失败的引用；用户侧已看到告警却仍能保存）
- **状态**：`待修复`
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
- **状态**：`待修复`
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
