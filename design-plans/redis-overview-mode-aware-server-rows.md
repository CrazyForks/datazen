# Redis Overview 屏 A — 按部署模式动态选择 Server 行集

Written against: current HEAD

## Evidence chain

- **Surface:** `packages/drivers/redis/ui/overview/overviewModel.ts` → `buildServerRows()` (line 172)
- **Problem:** 当前 `buildServerRows()` 无论 `mode` 字段是 `standalone`、`cluster` 还是 `sentinel`，都返回相同的 10 行（version / mode / arch / uptime / connectedClients / blockedClients / opsPerSec / totalCommands / evictedKeys / expiredKeys）。Cluster 模式缺少 `cluster_slots_ok` / `cluster_known_nodes` / `cluster_size` 等集群健康指标；Sentinel 模式缺少 `sentinel_masters` / `sentinel_slaves` / `sentinel_sentinels` 等高可用拓扑信息。`expired_keys` 在 Cluster/Sentinel 下意义不大却占一行。
- **Design evidence:** Redis `INFO` 命令在不同 `redis_mode` 下返回不同 section 字段（[redis.io/docs/commands/info](https://redis.io/docs/commands/info/)）。`overviewModel.ts` 注释声明"copy-free by construction"，行集应反映服务端实际报告的内容。
- **Owner:** `packages/drivers/redis/ui/overview/overviewModel.ts`
- **Scope and affected surfaces:** `overviewModel.ts`（buildServerRows、ServerRowId 类型、SERVER_ROW_LABEL）、`locales/en.ts`（新增 i18n key）、`__tests__/overviewModel.test.ts`（现有测试需更新 + 新增模式测试）
- **Uncertainty:** 无。Redis INFO 字段在三种模式下的存在性是确定的文档事实。

## Design decision

将 `buildServerRows()` 从固定 10 行改为**按 `mode` 字段动态选择行集**。三种模式各输出恰好 10 行（保持双列 2×5 网格不变），其中 7 行为共用基础行，3 行为模式特有行。

**行集分配：**

| 行 | Standalone | Cluster | Sentinel |
|----|:---:|:---:|:---:|
| version | ✅ | ✅ | ✅ |
| mode | ✅ | ✅ | ✅ |
| arch | ✅ | ✅ | ✅ |
| uptime | ✅ | ✅ | ✅ |
| connectedClients | ✅ | ✅ | ✅ |
| opsPerSec | ✅ | ✅ | ✅ |
| evictedKeys (warn) | ✅ | ✅ | ✅ |
| blockedClients | ✅ | — | — |
| totalCommands | ✅ | — | — |
| expiredKeys | ✅ | — | — |
| clusterSlotsOk | — | ✅ | — |
| clusterKnownNodes | — | ✅ | — |
| clusterSize | — | ✅ | — |
| sentinelMasters | — | — | ✅ |
| sentinelSlaves | — | — | ✅ |
| sentinelSentinels | — | — | ✅ |

**取舍理由：**
- `blocked_clients` 在 Cluster/Sentinel 下各节点值不同，概览页显示单节点值易误导，移除。
- `total_commands_processed` 在 Cluster 下是单节点累计，不反映集群整体，移除。
- `expired_keys` 运维价值低于模式特有字段，降级到详情页。
- 三种模式均为 10 行，双列网格完美适配，一屏内无滚动。

## Reuse

- `rawField()` / `numField()` — 已有的 INFO 字段提取工具（overviewModel.ts:89-101）
- `serverRow()` — 已有的行构造函数（overviewModel.ts:156-169）
- `modeValueKey()` — 已有的模式→i18n key 映射（overviewModel.ts:147-154）
- Exemplar: 当前 `buildServerRows()` 的 common 部分（overviewModel.ts:183-208）

## Changes

### 1. `packages/drivers/redis/ui/overview/overviewModel.ts`

**1a. 扩展 `ServerRowId` 联合类型**（line 107-117）

```typescript
export type ServerRowId =
  | 'version'
  | 'mode'
  | 'arch'
  | 'uptime'
  | 'connectedClients'
  | 'blockedClients'
  | 'opsPerSec'
  | 'totalCommands'
  | 'evictedKeys'
  | 'expiredKeys'
  // --- Cluster 模式特有 ---
  | 'clusterSlotsOk'
  | 'clusterKnownNodes'
  | 'clusterSize'
  // --- Sentinel 模式特有 ---
  | 'sentinelMasters'
  | 'sentinelSlaves'
  | 'sentinelSentinels';
```

**1b. 扩展 `SERVER_ROW_LABEL`**（line 133-144）

在现有映射末尾追加：

```typescript
const SERVER_ROW_LABEL: Record<ServerRowId, string> = {
  // ... 现有 10 个 key 不变 ...
  // Cluster
  clusterSlotsOk: 'redis.overview.server.clusterSlotsOk',
  clusterKnownNodes: 'redis.overview.server.clusterKnownNodes',
  clusterSize: 'redis.overview.server.clusterSize',
  // Sentinel
  sentinelMasters: 'redis.overview.server.sentinelMasters',
  sentinelSlaves: 'redis.overview.server.sentinelSlaves',
  sentinelSentinels: 'redis.overview.server.sentinelSentinels',
};
```

**1c. 改造 `buildServerRows()` 函数体**（line 172-209）

```typescript
/** 模式感知的 Server 行集：7 行共用 + 3 行模式特有 = 恰好 10 行。 */
export function buildServerRows(fields: Record<string, string>): ServerOverviewRow[] {
  const mode = (rawField(fields, 'mode') ?? 'standalone').toLowerCase();
  const modeKey = modeValueKey(rawField(fields, 'mode'));
  const arch = numField(fields, 'arch_bits');
  const uptime = numField(fields, 'uptime_in_days');
  const connected = numField(fields, 'connected_clients');
  const ops = numField(fields, 'instantaneous_ops_per_sec');
  const evicted = numField(fields, 'evicted_keys');

  // 7 行共用基础行
  const common: ServerOverviewRow[] = [
    serverRow('version', rawField(fields, 'redis_version')),
    serverRow('mode', modeKey ?? rawField(fields, 'mode'), { valueIsKey: !!modeKey }),
    serverRow('arch', arch === null ? null : String(arch), { unitKey: 'redis.overview.unit.bits' }),
    serverRow('uptime', uptime === null ? null : String(uptime), { unitKey: 'redis.overview.unit.days' }),
    serverRow('connectedClients', connected === null ? null : String(connected), {
      unitKey: 'redis.overview.unit.clients',
    }),
    serverRow('opsPerSec', ops === null ? null : String(ops), { unitKey: 'redis.overview.unit.opsPerSec' }),
    serverRow('evictedKeys', evicted === null ? null : String(evicted), {
      warn: (evicted ?? 0) > 0,
    }),
  ];

  // 3 行模式特有
  if (mode === 'cluster') {
    return [
      ...common,
      serverRow('clusterSlotsOk', rawField(fields, 'cluster_slots_ok')),
      serverRow('clusterKnownNodes', rawField(fields, 'cluster_known_nodes')),
      serverRow('clusterSize', rawField(fields, 'cluster_size')),
    ];
  }

  if (mode === 'sentinel') {
    return [
      ...common,
      serverRow('sentinelMasters', rawField(fields, 'sentinel_masters')),
      serverRow('sentinelSlaves', rawField(fields, 'sentinel_slaves')),
      serverRow('sentinelSentinels', rawField(fields, 'sentinel_sentinels')),
    ];
  }

  // Standalone（默认）
  const blocked = numField(fields, 'blocked_clients');
  const total = numField(fields, 'total_commands_processed');
  const expired = numField(fields, 'expired_keys');
  return [
    ...common,
    serverRow('blockedClients', blocked === null ? null : String(blocked), {
      unitKey: 'redis.overview.unit.clients',
    }),
    serverRow('totalCommands', total === null ? null : String(total)),
    serverRow('expiredKeys', expired === null ? null : String(expired)),
  ];
}
```

**保持不变：**
- `serverRow()` 函数签名和行为
- `ServerOverviewRow` 接口结构
- `modeValueKey()` 函数
- `rawField()` / `numField()` 工具函数
- `buildMemoryModel()` / `buildBigKeyRows()` / `buildSlowlogRows()` 等其他函数

### 2. `packages/drivers/redis/locales/en.ts`

在 `redis.overview.server.expiredKeys` 之后追加 6 个新 i18n key：

```typescript
// Cluster
'redis.overview.server.clusterSlotsOk': 'Cluster slots OK',
'redis.overview.server.clusterKnownNodes': 'Known nodes',
'redis.overview.server.clusterSize': 'Cluster size',
// Sentinel
'redis.overview.server.sentinelMasters': 'Monitored masters',
'redis.overview.server.sentinelSlaves': 'Replicas',
'redis.overview.server.sentinelSentinels': 'Fellow sentinels',
```

### 3. `packages/drivers/redis/ui/__tests__/overviewModel.test.ts`

**3a. 更新现有测试**（line 70-121）

现有断言 `emits exactly the ten rows in PRD order` 硬编码了 standalone 的 10 行 ID 列表。需要确认该测试仍通过（standalone 模式下 ID 列表不变），无需修改。

现有断言 `degrades to null values (never a crash) when INFO is empty` 期望 `rows` 长度为 10 — 空 INFO 下 `mode` 字段缺失，默认走 standalone 分支，仍输出 10 行，测试仍通过。

**3b. 新增模式测试**

```typescript
describe('buildServerRows — 模式感知行集', () => {
  it('standalone: 输出 10 行含 blockedClients / totalCommands / expiredKeys', () => {
    const rows = buildServerRows(fields('mode:standalone'));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('blockedClients');
    expect(ids).toContain('totalCommands');
    expect(ids).toContain('expiredKeys');
    expect(ids).not.toContain('clusterSlotsOk');
    expect(ids).not.toContain('sentinelMasters');
    expect(rows).toHaveLength(10);
  });

  it('cluster: 输出 10 行含 clusterSlotsOk / clusterKnownNodes / clusterSize', () => {
    const rows = buildServerRows(fields('mode:cluster'));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('clusterSlotsOk');
    expect(ids).toContain('clusterKnownNodes');
    expect(ids).toContain('clusterSize');
    expect(ids).not.toContain('blockedClients');
    expect(ids).not.toContain('expiredKeys');
    expect(rows).toHaveLength(10);
  });

  it('sentinel: 输出 10 行含 sentinelMasters / sentinelSlaves / sentinelSentinels', () => {
    const rows = buildServerRows(fields('mode:sentinel'));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('sentinelMasters');
    expect(ids).toContain('sentinelSlaves');
    expect(ids).toContain('sentinelSentinels');
    expect(ids).not.toContain('blockedClients');
    expect(ids).not.toContain('expiredKeys');
    expect(rows).toHaveLength(10);
  });

  it('cluster: 读取 cluster_slots_ok 等字段值', () => {
    const rows = buildServerRows(fields(
      'mode:cluster\ncluster_slots_ok:16384\ncluster_known_nodes:6\ncluster_size:3',
    ));
    expect(rows.find((r) => r.id === 'clusterSlotsOk')?.value).toBe('16384');
    expect(rows.find((r) => r.id === 'clusterKnownNodes')?.value).toBe('6');
    expect(rows.find((r) => r.id === 'clusterSize')?.value).toBe('3');
  });

  it('sentinel: 读取 sentinel_masters 等字段值', () => {
    const rows = buildServerRows(fields(
      'mode:sentinel\nsentinel_masters:2\nsentinel_slaves:4\nsentinel_sentinels:3',
    ));
    expect(rows.find((r) => r.id === 'sentinelMasters')?.value).toBe('2');
    expect(rows.find((r) => r.id === 'sentinelSlaves')?.value).toBe('4');
    expect(rows.find((r) => r.id === 'sentinelSentinels')?.value).toBe('3');
  });

  it('未知 mode 退化为 standalone 行集', () => {
    const rows = buildServerRows(fields('mode:unknown'));
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.id)).toContain('blockedClients');
  });
});
```

## Scope

- **Inherit:** `InstanceCard.tsx`（消费 `buildServerRows` 返回值，无需改动，因为它遍历行数组渲染）
- **Verify:** `InstanceCard` 在三种模式下均正确渲染 10 行，双列网格布局不变
- **Exclude:** `MemoryCard` / `PerformanceCard` / `NavigationCard` / `RedisOverviewBanner` / `RedisOverviewHome` — 不受影响

## Validation

- **Product:** 连接一个 Cluster 模式的 Redis 实例，屏 A Server 卡片应显示 cluster_slots_ok / cluster_known_nodes / cluster_size 三行，不显示 blocked_clients / total_commands / expired_keys。Sentinel 同理显示哨兵拓扑。Standalone 保持现有 10 行不变。
- **Interface:** 三种模式下 Server 卡片均为 10 行 × 2 列网格，无空行、无溢出、无滚动。
- **System:** `buildServerRows` 仍为纯函数，输入 `Record<string, string>` 输出 `ServerOverviewRow[]`，无副作用，无 React 依赖。`InstanceCard` 无需改动。
- **Repository:**
  - `pnpm test:unit:drivers` → overviewModel 相关测试全部通过
  - `cargo test -p datazen-driver-redis` → Rust 侧无影响

## Stop conditions

- Stop if Redis `INFO` 在某种模式下实际不返回预期字段（可通过 `redis-cli info` 验证）。
- Stop if `InstanceCard` 的 `grid-cols-2` 布局在10行时出现对齐问题（需要验证奇数行的最后一行是否跨列）。

## Design documentation

- 记录决策：`overviewModel.ts` 顶部注释更新为"10 行模式感知行集"（替换当前"ten PRD-mandated rows"）。
