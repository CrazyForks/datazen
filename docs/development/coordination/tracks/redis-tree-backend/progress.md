- 任务: 键树扫描后端预算模型（PRD §3.2 扫描预算 6 条 / §4 I-2、I-3）+ 精确键短路 + pipeline 化
- 状态: READY_FOR_TEST
- 编码 commit: 2bd626867（实现：6 个交付单元）+ fb5f0ca5d（契约集成测试）
- 测试 commit: —（R 轨执行门禁回归）
- 合并 commit: —
- 代理: w3b-tree-backend-rescuer（session-61319db9-6e5c-4f32-a35e-cad750b647dd，接管阵亡 coder 的未提交现场）
- Worktree: .worktrees/datazen-redis-tree-backend
- 分支: feature/redis-tree-backend
- 心跳: 2026-09-22 21:12

# W3-B `redis-tree-backend` 简报（协调者下发）

## 0. 必读（按序）
1. `AGENTS.md`、`docs/development/subagent/coder.md`、本文件
2. `docs/todo/redis-workbench-ux/PRD.md` §3.2「扫描预算模型（本轮最重要的借鉴）」全段、§4 I-2/I-3/I-4、§6 后端缺口表
3. 现状代码：`packages/drivers/redis/src/ops_tree.rs`、`redis_driver_on.rs`（`scan_keys_with_info_on` 在 :80，
   DBSIZE 重发点在 :138 附近）、`redis_driver_kv.rs`、`ops_value_search.rs`（**预算常量的现有出处**：
   `DEFAULT_MAX_KEYS 50_000` / `HARD_MAX_KEYS 200_000`，:25-26）、`commands.rs` + `commands_exec_dispatch.rs`
   （`scan_keys` / `list_children` / `count_matching` 三处命令定义与分发臂）
4. 教训（务必先读，直接决定你的测试形状）：`docs/development/coordination/tracks/redis-cmds-p0/`（BUG-007
   cluster 路由口径 + BUG-008 预算数字钉死）与 `tracks/redis-kvbar-ui/progress.md` 的 cluster 段

## 1. 目标：把「一次用户动作 = 一个累计 COUNT 预算」做成后端可保证的事实
本轨只改 redis crate（Rust）。**UI 接线在 Wave 4**，所以本轨最重要的交付是「契约冻结」小节。

1. **预算参数**：`scan_keys` / `list_children` / `count_matching` 接受可选 `budget`（累计 COUNT 上限）。
   - 默认 50_000；硬上限 **1_000_000**（PRD 口径，不是值搜索那套 200_000；两处预算不同名不同值，
     在代码注释里写清是**键树预算**，别互相"对齐"掉）。
   - DBSIZE 可用时按 DBSIZE 缩放（`min(hard_cap, max(default, dbsize × 系数))`，系数与理由写进注释）。
2. **返回形状 append-only**：三条命令的 out 各追加
   `consumed: u64`（本次实际消耗的累计 COUNT）、`truncated: bool`（因预算/上限而未扫尽）、
   `dbsize: u64`（本轮取到一次的值）。
   **既有字段一个都不许改名、不许删、不许换嵌套层级** —— 驱动 UI 与 `kvSlotRegistration` 之外的多处测试在消费。
3. **DBSIZE 每次调用只取一次**（现状每页重发，`redis_driver_on.rs:138`）。
4. **每页 TYPE/TTL 改 pipeline 批量**（现状逐键 `await`，`scan_keys_with_info_on`）。
   `withMemory` 路径同理：`MEMORY USAGE` 也要进同一批。
5. **新增命令 `key_probe`**（I-3 精确键短路）：入 `{ key }`，一次 pipeline
   `EXISTS + TYPE + TTL + MEMORY USAGE`，出 `{ exists, type, ttlMs, memoryBytes }`，**绝不取值**。
   注册进 `commands.rs` 的只读集合与相应分发臂；`requires_permission`/`is_write` 归类照 `get_key` 的只读口径。
6. **`count_matching` 支持预算 ⇒ 产 `n+` 部分计数**：返回 `{ count, truncated }`，
   `truncated=true` 时 UI 显示 `n+`（Wave 4 消费）。

## 2. Cluster 纪律（本轨的生死线）
`ops_workbench::type_distribution_on` 的前车之鉴：单连接 pipeline 假设在 cluster 下必炸（同函数族已修过一轮）。
- 任何跨键 pipeline 必须**按 slot 分组**或提供 fail-soft 降级（逐命令），**不得**让一个 CROSSSLOT 把整条命令变成错误。
- `list_children` 的既有 CrossSlot 缺陷（挂账 #56）**不在本轨修**，但你的新代码不得加重它；若在实现中被你撞上，
  登记到 `tracks/redis-tree-backend/bugs.md` 并返回 PARTIAL 说明，不要顺手扩大范围。
- **每个 cluster 形状断言至少含一个 `{hash-tag}` 键**（W1 的假阴性教训：无 tag 的用例让 tag 盲的 `get_slot`
  调用点无法被任何测试抓到）。同时给出「若去掉 tag 处理就会变红」的那条用例。
- 无真实集群时，用现有测试替身/`#[cfg(test)]` 假 conn 覆盖；把「真集群 9a 待跑」留在 R 清单口径里写明。

## 3. 文件规模红线（硬约束）
`src/ops_workbench.rs`（1066 行）与其 `tests.rs`（1602 行）已越过 AGENTS.md 的 800 行红线。
**本轨不得往这两个文件加任何行**；新逻辑开新文件（建议 `src/ops_tree_scan.rs` / `src/ops_tree_budget.rs`），
`tests/` 侧同理新建 `tests/tree_scan_budget.rs`。既有文件只允许删除或原样搬运。

## 4. 冲突面声明
- 与 **W3-C `redis-codec-write`** 同 crate：可能同时给 `commands*.rs` / `commands_exec_dispatch.rs` 加分发臂。
  规则：**只加自己的命令/参数行，不改动、不重排、不格式化他人的行**；协调者合流时按并集解。
- 与 W3-D/E/F（驱动 UI）、W3-A（宿主）无文件重叠。本轨不改 `ui/**`、不改 `locales/en.ts`。

## 5. 门禁与交付
1. `CARGO_TARGET_DIR=/tmp/w3b-cargo-target cargo test -p datazen-driver-redis`（lib + 全部集成测试；
   基线 239 lib + 4 集成，只许增不许红）。
2. `CARGO_TARGET_DIR=/tmp/w3b-cargo-target cargo test -p datazen --lib` 若你动了宿主可见类型则必跑（基线 1454 passed / 3 ignored）。
3. `cargo fmt`（仅你碰过的文件）+ `clippy` 无新增警告。
4. `npx tsc --noEmit` 与 `npx vitest run --config vitest.drivers.config.ts`（47/456 基线）确认没把 Rust 形状变更
   以 TS 类型形式泄漏出去却漏改消费端。
5. 每个交付单元（1/2/3-4/5/6）立即 commit；接近轮次上限返回 `PARTIAL` + 剩余清单。
6. 本文件追加 `## 契约冻结`（三条命令最终 in/out 的 JSON 原文 + `key_probe` 完整形状 + 预算默认与缩放公式）
   与 `## 自验记录`。**Wave 4 的树 UI 预算轨会逐字引用 `## 契约冻结`，写不清=那条轨卡死。**
7. 返回 `READY_FOR_TEST`。

## 6. 环境纪律（违反即返工）
- 工作目录固定 `.worktrees/datazen-redis-tree-backend`；禁写其他检出。
- Grep 工具搜索（禁 bash `grep -r`）；禁 `pnpm install`。
- Cargo 一律独立 `CARGO_TARGET_DIR=/tmp/w3b-cargo-target`。
- 禁 live `pnpm e2e` / `pnpm tauri:build:webdriver`；Redis 驱动 E2E 需真实服务，**本轨禁止跑**，把用例登记进 `## 留待 R 回归`。
- 禁提交 gitignored codegen / `Cargo.lock` / 注入过的 `src-tauri/Cargo.toml`；禁改 `hub.md` 与他轨文档。
- 生产路径禁裸 `unwrap()/expect()`（`#[cfg(test)]` 除外；确需 panic 要注释说明）。
- 测试禁断言英文字面量文案（文案走 i18n key；Rust 侧错误用稳定 code 而非人读句子）。

## 契约冻结

Wave 4 树 UI 预算轨逐字引用本节。以下 JSON 为驱动 `execute_driver_command` 层的 in/out 原文
（in = `input` 对象；out = `json_ok(...)` 製造的 payload 对象）。

### `scan_keys`

入（全部可选；别名 `key_type`/`with_memory`/`no_ttl_only` 同时接受）：

```json
{
  "dbIndex": 0,
  "pattern": "app:*",
  "cursor": 0,
  "count": 100,
  "keyType": "string",
  "withMemory": false,
  "noTtlOnly": false,
  "budget": 50000
}
```

出（`dbSize` 为既有拼写原样保留；`dbsize` 为追加，与另两条命令同名同值）：

```json
{
  "cursor": 0,
  "keys": [
    { "key": "app:users:42", "keyType": "hash", "ttl": -1, "size": 3, "preview": "..." }
  ],
  "dbSize": 90000,
  "consumed": 1000,
  "truncated": false,
  "dbsize": 90000,
  "exact": false
}
```

- `keys[]` 即 `KeyEntry`（camelCase：`key` / `keyType` / `ttl`（秒，-1 无过期、-2 不存在）/ `size`
  （`withMemory` 时为 `MEMORY USAGE` 字节，否则逻辑长度）/ `preview`）。
- `exact: true` 表示 pattern 无 glob 字符、走 EXISTS 短路未经过 SCAN。
- `truncated: true` 仅由预算/上限截断触发；整页但游标未归零是分页，`truncated` 保持 `false`。

### `list_children`

入（`prefix` 必填，其余可选；别名同上）：

```json
{
  "dbIndex": 0,
  "prefix": "app:",
  "cursor": 0,
  "count": 100,
  "sep": ":",
  "noTtlOnly": false,
  "keyType": "string",
  "withMemory": false,
  "budget": 50000
}
```

出：

```json
{
  "children": [
    { "kind": "folder", "prefix": "app:users:", "count": 12 },
    { "kind": "key", "key": "app:top", "keyType": "string", "ttl": -1, "logicalLen": 3, "memBytes": 48 }
  ],
  "cursor": 0,
  "consumed": 1000,
  "truncated": false,
  "dbsize": 10
}
```

- `children[]` 为 `ChildEntry` tagged enum：`kind` = `folder` | `key`，字段 camelCase；
  `memBytes` 在未请求 `withMemory` 时为 `null`。
- 既有字段（`children`/`cursor`）未改名未移动，`consumed`/`truncated`/`dbsize` 纯追加。

### `count_matching`

入（`pattern` 必填）：

```json
{ "dbIndex": 0, "pattern": "app:*", "budget": 50000 }
```

出：

```json
{ "count": 777, "truncated": false, "consumed": 1000, "dbsize": 777 }
```

- `pattern == "*"`：直接答 `count == dbsize`，`consumed == 0`，不发 SCAN。
- 精确键（无 glob 字符）：一次 `EXISTS`，不发 SCAN。
- 否则：预算内 SCAN，`truncated: true` ⇒ `count` 为下界，UI 必须显示 `n+`。

### `key_probe`

入（`key` 必填，只读，权限/归类与 `get_key` 同口径 `redis:allow-info`）：

```json
{ "dbIndex": 0, "key": "app:users:42" }
```

出（命中）：

```json
{ "exists": true, "type": "hash", "ttlMs": -1, "memoryBytes": 64 }
```

出（不存在）：

```json
{ "exists": false, "type": null, "ttlMs": -2, "memoryBytes": null }
```

- `type` 为 Redis `TYPE` 原文（`string|list|set|zset|hash|stream|…`），缺失键为 `null`。
- `ttlMs` 为 **PTTL 毫秒**：`-1` 无过期、`-2` 不存在、`>0` 剩余毫秒——与 `scan_keys` 的
  `ttl`（秒）不同，下游不得再乘 1000。
- `memoryBytes` 为 `MEMORY USAGE` 字节，不支持/不可读为 `null`。
- 一条 pipeline `EXISTS + TYPE + PTTL + MEMORY USAGE` 完成，**绝不读取值**。

### 预算公式（键树预算，value 搜索另有其表）

- 常量：`DEFAULT_TREE_BUDGET = 50_000`，`HARD_MAX_TREE_BUDGET = 1_000_000`，
  `TREE_BUDGET_DBSIZE_FACTOR = 2`（`ops_tree_budget.rs`，字面量钉死测试）。
- `budget` 缺失或 `0` ⇒ `min(1_000_000, max(50_000, dbsize × 2))`；`dbsize == 0`（空库或
  DBSIZE 不可得）回落默认档，永不产生 0 预算。
- `budget` 给定且 >0 ⇒ `clamp(1, 1_000_000)`，**不缩放**（调用者选的 10k/50k/200k/1M 档位原样生效）。
- 与值搜索预算（`ops_value_search`：`DEFAULT_MAX_KEYS = 50_000` / `HARD_MAX_KEYS = 200_000`）
  不同名不同值不同上限，测试里 `assert_ne!(HARD_MAX_TREE_BUDGET, HARD_MAX_KEYS)` 钉死，禁止互相"对齐"。
- schema 层不设 `maximum`：超大 budget 在驱动内钳制，不报错。

### Cluster 口径

- `DBSIZE` 每次命令**只读一次**，不走 slot 路由（standalone 直发；cluster 下对 master 求和）。
- `SCAN` 锚定 `cluster_scan_anchor_slot()`，cursor 语义在单分片内成立。
- 精确键 EXISTS / `key_probe` 的整条 pipeline 按 `get_slot(key)` 定址。
- 每页 TYPE/TTL/MEMORY USAGE：standalone 按 256 键分块一条 pipeline；cluster 下**一键一批**
  按各自 `get_slot(key)` 定址，不存在跨键 pipeline ⇒ 不可能出现 CROSSSLOT；定址批失败/短答
  ⇒ 逐命令 replay 降级（fail-soft），单键失败不拖垮整页。
- `list_children` 既有 CrossSlot 缺陷挂账 #56：只登记、本轨不修、不加重。

## 自验记录

全部在 `.worktrees/datazen-redis-tree-backend`、`CARGO_TARGET_DIR=/tmp/w3b-cargo-target` 下执行，
时间 2026-09-22 21:0x：

1. `cargo test -p datazen-driver-redis`：
   - lib **271 passed / 0 failed / 1 ignored**（ignored 为既有 live-redis `local_live_connect…`；
     基线 239 lib + 4 集成，只增不红 ✓）
   - `workbench_commands` **4/4**、`tree_scan_budget`（新增集成）**4/4**、doctests 0
   - 0 warnings（`^warning|^error` grep 为空）
2. `rustfmt --edition 2021` 仅作用于本轨碰过的文件；`commands_exec_dispatch.rs` 是 `include!`
   片段（首行即 `match`，不可独立 rustfmt），只动过自己的行。碰过后复跑 1 全绿。
3. `cargo clippy -p datazen-driver-redis --all-targets`：与基线（stash 后实测 24 条）逐条 diff，
   **0 条新增**；现值 21 条（基线遗留的 redis_driver 系警告因重构消失 3 条）。基线即存在的
   `approx_constant`（PI）deny ×2（`ops.rs:881` / `ops_exec.rs:260`）为既有债，非本轨引入。
4. `npx tsc --noEmit`：exit 0。
5. `npx vitest run --config vitest.drivers.config.ts`：**47 files / 456 tests passed**（基线 47/456 ✓）。
6. 红线复核：`git diff --stat HEAD -- src/ops_workbench.rs src/ops_workbench/tests.rs` 为空 ✓
   （两文件本轨 0 增行）。

## 留待 R 回归

- 真实集群 9a：`scan_keys`/`count_matching`/`key_probe` 的定址与 cursor 连续性、
  CROSSSLOT 实测（本轨环境禁 live e2e，测试替身已覆盖形状断言 + 反事实 tag 用例）。
- 大库预算行为：真实 dbsize 下 `min(1M, max(50k, dbsize×2))` 缩放与 `n+` 展示联调（Wave 4 UI）。
- `list_children` CrossSlot 既有缺陷 #56：挂账，未修，未加重。
