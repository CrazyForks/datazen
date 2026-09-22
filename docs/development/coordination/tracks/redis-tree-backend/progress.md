- 任务: 键树扫描后端预算模型（PRD §3.2 扫描预算 6 条 / §4 I-2、I-3）+ 精确键短路 + pipeline 化
- 状态: **TEST_FAILED**（第 1 轮 Tester 全新实例；门禁逐字复现、契约形状成立，但 3 条缺陷待修 ⇒ 交回原 Coder）
- 编码 commit: 2bd626867（实现：6 个交付单元）+ fb5f0ca5d（契约集成测试）+ 1c03f1595（契约冻结台账）
- 测试 commit: 15ce0c917（步骤 1-4：门禁复跑 + 契约逐字核对 + 3 条 Bug 登记 + `tests/tree_contract_tester.rs`）
  + f1910f08e（步骤 5-8：append-only/预算/cluster/红线/覆盖率/E2E + 22 条补测 + BUG-001 双 RED pin）
- 合并 commit: —
- 代理: w3b-tree-backend-rescuer（session-61319db9-6e5c-4f32-a35e-cad750b647dd，接管阵亡 coder 的未提交现场）
- 测试代理: w3b-tester-round1（全新实例，与 Coder/Rescuer 不同会话；前两轮 Tester 均死于并行重负载，
  本轮全程串行执行重型命令 + 每完成一步即 commit 落盘）
- Worktree: .worktrees/datazen-redis-tree-backend
- 分支: feature/redis-tree-backend
- 心跳: 2026-09-22 23:21
- 缺陷（全部「待修复」）: **BUG-001 高** `list_children` 叶子属性错位（本轨回归，release 静默错数据）
  · **BUG-002 高** `count_matching` 形状变更漏改驱动 UI 消费端（既有功能被打破）
  · **BUG-003 中** DBSIZE 失败 ⇒ 三条键树命令整条报错（冻结承诺的降级路径不可达 + 基线能力回退）
  详见本目录 `bugs.md`；审查发现 R-1/R-3/R-4/R-5（非缺陷）与撤销项 R-2 亦在该文件。


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

## 第 1 轮 Tester 复验记录

> Tester 全新实例（与 Coder/Rescuer 不同会话；前任 Tester 死于并行重负载 ⇒ 本轮全程串行，一次只跑一个重型命令）。
> 目录 `.worktrees/datazen-redis-tree-backend`，起点 HEAD `1c03f1595`，`CARGO_TARGET_DIR=/tmp/w3b2-cargo-target`。
> 零信任复跑 + **只测不修**；缺陷见 `bugs.md`。小节按验收步骤推进，边测边 commit。

### 步骤 1-3 · 门禁独立复跑（串行，实测）

| 门禁 | Rescuer 自报 | **Tester 实测** | 判定 |
|---|---|---|---|
| `cargo test -p datazen-driver-redis` lib | 271 / 0 / 1 | **271 passed / 0 failed / 1 ignored**（272 计数；ignored = `connect::tests::local_live_connect_prefer_plaintext_require_times_out`，需本地 redis） | ✅ 逐字复现 |
| 集成 `tree_scan_budget` | 4/4 | **4 passed / 0 failed** | ✅ |
| 集成 `workbench_commands`（既有防回归） | 4/4 | **4 passed / 0 failed** | ✅ |
| doctests | 0 | **0 / 0** | ✅ |
| 编译告警 | 0 | `grep -cE "^warning\|^error"` = **0** | ✅ |
| `cargo clippy --all-targets` | 21（基线 24） | **21 条**；本轨新文件命中 **0 条** | ✅ 0 新增 |
| `cargo fmt -p datazen-driver-redis -- --check` | 干净 | **exit 0**（`commands_exec_dispatch.rs` 系 `include!` 片段，fmt 不覆盖，另行读 diff：只动本轨自己的行） | ✅ |
| `npx tsc --noEmit` | 0 | **exit 0，零行输出** | ✅ |
| `npx vitest run --config vitest.drivers.config.ts` | 47/456 | **47 files / 456 tests passed**，exit 0 | ⚠️ 绿，但见 **BUG-002**（该路径零覆盖，掩盖了真实泄漏） |

clippy 21 条点名（证伪"本轨新增"）：`redis_driver.rs` 117/253/706、`redis_driver_on.rs:187`、
`redis_value_preview.rs:28`、`ops.rs:881`（`approx_constant` 既有债）、`ops_value_search.rs` ×3、
`ops_io.rs:285`、`decode/pickle.rs` ×3、`commands_exec_dispatch.rs` 473/480/487（冗余闭包，**非本轨行**）、
`datazen-driver-api` ×3。`ops_tree_scan.rs` / `ops_tree_budget.rs` / `ops_key_probe.rs` / `ops_tree.rs` /
`ops_tree_scan/tests.rs` / `tests/tree_scan_budget.rs` **零命中** ✓。

### 步骤 4 · 契约冻结逐字核对

| 冻结条目 | 源码出处 | 逐字核对 |
|---|---|---|
| `scan_keys` in 8 个字段 + 别名 `key_type`/`with_memory`/`no_ttl_only` | `commands.rs:86-99` 声明 + `commands_exec_dispatch.rs:2-35` 解析 | ✅ 名称/类型一致；三条别名 `.or_else` 双写均在 |
| `scan_keys` out `cursor/keys/dbSize/consumed/truncated/dbsize/exact` | `commands_exec_dispatch.rs:31-39` | ✅ 7 字段逐字一致，`dbSize` 旧拼写保留并与 `dbsize` 同值同源（一次 DBSIZE 读） |
| `keys[]` = `KeyEntry` camelCase `key/keyType/ttl/size/preview` | `driver-api/src/types.rs:428-436` `rename_all="camelCase"` | ✅ |
| `list_children` in（含 `sep`/`withMemory`/`budget`） | `commands.rs:110-123` + 分发臂 41-90 | ✅ |
| `list_children` out `children/cursor/consumed/truncated/dbsize` | 分发臂 76-82 | ✅ 5 字段，既有两名未动 |
| `ChildEntry` tagged enum：`kind=folder{prefix,count}` / `kind=key{key,keyType,ttl,logicalLen,memBytes}`、`memBytes` 未请求时为 `null` | `ops_tree.rs:31-48`（`tag="kind"` + `rename_all_fields="camelCase"`）+ 单测 `child_entry_serializes_camel_case_fields` | ✅ |
| `count_matching` in `{dbIndex,pattern,budget}` / out `{count,truncated,consumed,dbsize}` | `commands.rs:425-437` + `CountOutcome`（`ops_tree_scan.rs:877-890`，camelCase）| ✅ 4 字段逐字一致，序列化为 JSON 对象 |
| `pattern=="*"` ⇒ `count==dbsize`、`consumed==0`、不发 SCAN | `count_budgeted` 907-915 + 单测钉线形 | ✅ |
| 精确键 ⇒ 一次 `EXISTS`，不发 SCAN | 916-923 | ✅ |
| `key_probe` in `{dbIndex,key}`（`key` 必填）/ 权限 `redis:allow-info` / 归类同 `get_key` | `commands.rs:134-141` + 集成 `key_probe_is_registered_like_get_key` | ✅ 与 `get_key` 同 permission 串、同 Observe 类、`Read` 级 |
| `key_probe` out `{exists,type,ttlMs,memoryBytes}`（不存在时 4 字段俱在、`type`/`memoryBytes` 为 `null`、`ttlMs=-2`） | `KeyProbe`（`ops_key_probe.rs:79-91`）+ 单测 `probe_serializes_the_frozen_camel_case_shape` | ✅ |
| `ttlMs` 为 PTTL 毫秒（与 `scan_keys.ttl` 秒制不同） | `build_key_probe_pipeline` 用 `PTTL`，无换算 | ✅ |
| 预算公式：默认 50_000 / 硬上限 1_000_000 / `dbsize×2` 系数 / 命令层 `budget` 缺失或 0 ⇒ 走派生档 | `ops_tree_budget.rs:27-42,91-101` + 分发臂 `.filter(\|v\| *v > 0)` | ✅ 命令层与冻结句子一致（0 与缺失同路径）；⚠️ 但 op 函数自身对 `Some(0)` 返回 1（`ops_tree_budget.rs:94` 及其单测），与冻结句子的"0 ⇒ 派生档"表述分叉 —— 今天无调用方能走到，属**口径隐患**，记入审查发现而非缺陷 |
| Cluster 口径 5 条 | 见步骤 6 | 部分见步骤 6 与 BUG-003 |

**判定**：四条命令的 in/out JSON 原文与源码序列化**逐字段一致**（字段名、层级、camelCase、可空性均无偏差），
Wave 4 可逐字引用。两处**口径**问题不属形状偏差，但 Wave 4 会照文施工，故必须改文档/改实现二选一：

1. **`DBSIZE 不可得 ⇒ 回落默认档` 这句与代码不符 ⇒ 升级为缺陷 BUG-003**：
   预算公式段写"`dbsize == 0`（空库或 **DBSIZE 不可得**）回落默认档，永不产生 0 预算"，
   实际 `read_dbsize`（`ops_tree_scan.rs:436-445`）在服务端报错时直接 `Err` 上抛，
   三条命令整条失败（实测见 BUG-003）。冻结文字承诺了一条不可达的降级路径。
2. op 层 `tree_scan_budget(Some(0), …) == 1` 与命令层"`budget: 0` ⇒ 走派生档"语义相反
   （`ops_tree_budget.rs:94` + 单测 `:260`），今天靠分发臂 `.filter(|v| *v > 0)` 才没被外部走到 ⇒
   审查发现 **R-1**，不判缺陷但要求二选一收口。


### 步骤 5 · Append-only 审查（`git diff 8981d3078..HEAD -- packages/drivers/redis/src/`）

逐文件（14 个，+3505/−333）核对既有 out 字段的改名 / 删除 / 层级变动：

| 命令 | 基线 out | HEAD out | 判定 |
|---|---|---|---|
| `scan_keys` | `{cursor, keys, dbSize}` | `{cursor, keys, dbSize, consumed, truncated, dbsize, exact}` | ✅ 前三项名称/层级原样，后四项**尾部追加**；`keys[]` = `KeyEntry` 五字段零变动 |
| `list_children` | `{children, cursor}` | `{children, cursor, consumed, truncated, dbsize}` | ✅ 纯追加；`ChildEntry` enum（`ops_tree.rs:31-48`）与基线**逐字符相同**（`git show` 比对：变体名、五字段、`tag="kind"`、`rename_all_fields`）|
| `count_matching` | `json_ok(<u64>)` —— **裸标量** | `{count, truncated, consumed, dbsize}` | ⚠️ 形状变更由简报目标 6 明确要求（"返回 `{count,truncated}`"），故不判违约；但**消费端漏改** ⇒ **BUG-002（高）** |
| `key_probe` | —（新命令） | `{exists, type, ttlMs, memoryBytes}` | ✅ 新面，无历史约束 |

- 删除项清点：`ops::count_matching`（全 crate grep 零调用者 ⇒ 死码搬运，安全）、
  `redis_driver_on::{scan_keys_with_info_on, preview_on, value_len_on, type_of_key_on, memory_usage_on, extract_hscan_preview}`
  —— 后五者功能原样搬入 `ops_tree_scan`（`render_preview` / `parse_value_group` / `parse_meta_group` /
  `extract_hscan_preview` 逐段可读，PREVIEW_MAX 120 未变）⇒ **原样搬运，非改名**。
- 签名变更（Rust API，非 IPC 契约）：`RedisDriver::scan_keys_with_info` 返回 `(u64, Vec<KeyEntry>, u64)` →
  `ScanKeysPage`；`list_children` 返回 `(Vec<ChildEntry>, u64)` → `ChildrenPage`。
  全 crate 调用者仅 `redis_driver_kv.rs:19-31`（已同步投影，丢弃新位）；宿主 `src/`、`src-tauri/`
  grep 零引用 ⇒ 不外溢。`KeyValueDriver` trait 与 `packages/driver-sdk/src/types/kv.ts` 的
  `KeyScanResult{cursor,keys,dbSize}` **未改**（TS 侧靠 JSON 宽松兼容读旧字段）⇒ TS 消没泄漏确认为零，
  与 tsc 0 / vitest 47/456 一致。
- 简报 §4 冲突面：`commands.rs` / `commands_exec_dispatch.rs` 只**新增**自己的行（`key_probe` 归类臂、
  三条命令的 `budget`/`withMemory` 属性行、`key_probe` 分发臂），未重排他轨行 ✓。

### 步骤 6 · 预算模型 + Cluster 纪律（生死线）+ 红线 + key_probe 注册面

**预算模型**（`ops_tree_budget.rs`）：

- `DEFAULT_TREE_BUDGET = 50_000` / `HARD_MAX_TREE_BUDGET = 1_000_000` / `TREE_BUDGET_DBSIZE_FACTOR = 2` ✓；
  模块文档 `:10-23` 明写"与 `ops_value_search` 的 50k/**200k** 不同名不同值，勿互相对齐"，
  并由 `assert_ne!(HARD_MAX_TREE_BUDGET, HARD_MAX_KEYS)` 钉死（`tree_budget_hard_cap_is_the_key_tree_one_not_value_searchs`）✓
  —— 简报"永不对齐"注释要求**满足**。
- `tree_scan_budget(None, dbsize) = dbsize×2.clamp(50_000, 1_000_000)`（saturating 乘，`u64::MAX` 不溢出）✓；
  `Some(raw) = raw.clamp(1, 1_000_000)` 且**不缩放**✓。降级路径：`dbsize == 0` ⇒ 默认档 ✓ ——
  但"DBSIZE 不可得"实际**到不了**这里 ⇒ **BUG-003**。
- `truncated` 语义：`!(exhausted || page_filled)`（`ops_tree_scan.rs:418`）——
  预算/轮次/停滞守卫耗尽且游标未归零 ⇒ `true`；整页但游标未归零 ⇒ 分页，保持 `false` ✓，
  三条边界都有用例（`budget_exhaustion_stops_the_scan_and_reports_truncated` /
  `a_full_page_with_an_open_cursor_is_pagination_not_truncation` / 本轮新增两条守卫用例）。
- `Σ COUNT ≤ budget` 不变式：`next_count` 以 `remaining()` 为上限（唯一例外是末轮不低于
  `MIN_TREE_SCAN_COUNT=10` 的"最后一轮仍在推进"取舍，已在文档与单测
  `only_the_final_round_of_a_partial_budget_may_overshoot_by_one_min_round` 里公开写明）✓。
- schema 层无 `minimum`/`maximum` ⇒ 钳制在驱动内（Tester 新增
  `test_tester_budget_declares_no_bounds_and_zero_still_validates` 把这条从"注释"升成"断言"）✓。

**Cluster 纪律**（简报 §2）：

| 纪律 | 实现 | 反证 | 判定 |
|---|---|---|---|
| DBSIZE 单次、不路由 | `read_dbsize` 每命令调用 1 次，走 `query_async` | `page_reads_dbsize_once_and_answers_in_two_batches` 计数恰 1；cluster 用例 `singles == ["DBSIZE"]` | ✅ |
| SCAN 锚 slot | `scan_round` Cluster 臂 `command_at_slot(…, cluster_scan_anchor_slot())` | `cluster_pages_address_…` 断言唯一 SCAN 的 slot == 锚 | ✅ |
| 精确键 / probe 按 `get_slot(key)` 定址 | `key_exists` Cluster 臂、`fetch_key_group` | `count_cluster_addresses_the_existence_probe_to_the_keys_slot`、`key_probe_is_one_addressed_batch…` | ✅ |
| 一键一批、永不 CROSSSLOT | `fetch_page_groups` Cluster 臂逐 item `build(from_ref(item))`；批内命令全指同键 | 用例逐批断言"批内每条命令的键 == 该批主体键"；本轮补 `test_tester_list_children_on_cluster_addresses_every_batch_by_key`（6 批 = 3 叶 ×(meta+value)，零跨键批） | ✅ 逻辑与反证俱在 |
| 批失败/短答 ⇒ 逐命令 replay（fail-soft） | `fetch_key_group` 的 `Err` / 短 `Ok` 两臂 → `replay_per_command`；`fold_command_answer` 把服务端错误降成 `Nil`，连接级错误上抛 | **基线零覆盖**；本轮补 5 条（Rejected 重放、Short(2) 重放、单字段 answered-error、transport failure 上抛、分类表 + `fold_command_answer` 直测）| ✅ 补后全绿 |
| `{hash-tag}` 用例 + "去掉 tag 处理就红" | `get_slot` 全程 | `hash_tag_slotting_is_the_routing_contract_and_breaks_without_tag_handling`：同 tag 两键**等**、tag 内容与整键**等**、无 brace **等**、且用 `assert_ne!(slot("user1000"), slot("user2000"))` 反证"等式非空洞" | ✅ 存在且判红 |
| #56 只登记不修不加重 | `list_children` 新路径 | 见下 | ✅ 未加重（并见附注） |

- **红线核验**：`git diff --numstat 8981d3078..HEAD -- src/ops_workbench.rs src/ops_workbench/tests.rs` = **0 行**（两文件零增删）✓。
- **#56 附注（交协调者裁定，非缺陷）**：基线 `list_children_on` 的 CROSSSLOT 成因是**一条跨全部叶子的
  `pipe.query_async`**（`git show 8981d3078:…/ops_tree.rs:145-165`）；本轨新路径改为一键一寻址批 ⇒
  **该成因在进程内已不可构造**（本轮 cluster 用例即证：`batches.is_empty()` + 6 个单键批）。
  本轨未越权宣称修复，故 #56 仍按挂账处理，但 **R 项 9e 复现时若已不复现，须据此改判归属**。
- 顺带修掉的旧缺陷（简报未点名，属"原样搬运"路径之外的改进，记为收益）：`noTtlOnly` 在基线
  `list_children` 里只作用于**已富化的 children**，而基线 `scan_keys_with_info_on` 是逐键 `continue`；
  两条路径现在语义统一，但 `list_children` 由此暴露 BUG-001。

**key_probe 注册面**（四件套俱在）：
`commands.rs:26-31` 归类 `Observe`（与 `get_key` 同臂）✓ · `:134-141` 声明（`redis:allow-info`、`key` 必填）✓ ·
`commands_exec_dispatch.rs:86-95` 分发臂可达 ✓ · `redis_driver.rs:412` `plugin_on_db_topo!` 透传拓扑 ✓ ·
集成 `tests/tree_scan_budget.rs` 四条钉住（注册、只读、`ConnectionFailed` 而非 `Unsupported` 的可达性对照）✓；
Tester 另补 `test_tester_key_probe_is_a_get_key_peer`（与 `get_key` **同权限串、同类、同访问级**）。

### 步骤 7 · 覆盖率（`cargo llvm-cov -p datazen-driver-redis --lib`，实测）

| 文件 | 基线（仅交付用例） | **补测后** | 函数 | 判定 |
|---|---|---|---|---|
| `ops_tree_scan.rs`（950 行新文件） | 81.43% 行 / 77.16% region | **95.12% 行 / 92.59% region** | 94.74% | ✅ ≥80 |
| `ops_tree_budget.rs` | 98.08% 行 | **98.08%** | 100% | ✅ |
| `ops_key_probe.rs` | 94.27% 行 | **94.71%** | 85.71% | ✅ |
| `ops_tree.rs`（重写的 `list_children_page`） | 96.35% 行 | **96.35%** | 95.00% | ✅ |
| crate TOTAL | 53.31% | 54.10% | — | 参考值（含大量本轨未触碰的存量文件） |

- 度量口径：llvm-cov 0.8.7，`--lib`（**不含** `tests/` 集成用例，故 `redis_driver.rs` 等装配层记 0%，
  属既有口径限制，非本轨缺口）。
- Tester 本轮**新增 31 条用例**：`ops_tree_scan/tests.rs` +22（18 可跑 + 2 ignore RED pin + 2 单测，
  纯尾部追加，`git diff --numstat` 显示 0 删除行）+ `tests/tree_contract_tester.rs` 9（4 可跑 + 5 `#[ignore]`）。
  lib 271 → **291 passed / 3 ignored**（ignored = 基线 1 条 live-redis + 本 Tester 2 条 RED pin），
  clippy 仍 **21**（补测零新增诊断，含一次自查撤销的假警报），`cargo fmt --check` exit 0。
- **剩余缺口点名**（本轨文件，`--lcov` 逐行核实，行号=实测未执行）：
  - `ops_tree_scan.rs` 余 21 行：**全部**为 `tracing::warn!/debug!/info!` 的字段与文案行
    （128、183、185、193、267-269、402、405-406、854-855、863-865）+ 空批早退（172）
    + `push_preview_cmd` 的 `_ => {}`（597）+ `reply_array` 的 `Nil`/非数组臂（625-626）
    + `extract_hscan_preview` 收尾臂（647）+ `scan_keys_page` 的 `if exact` 收尾花括号（835）。
  - `ops_tree.rs` 余 7 行 = **`:214`（`list_children` 的 `noTtlOnly` 臂，见下"诚实声明"）**
    + 回填/守卫与日志行（244、250、252、255-256、261）。
  - `ops_key_probe.rs` 余 8 行 = `warn!` 文案（145-146）+ `#[cfg(test)]` helper 与断言消息行
    （214、234、261、269、273、327，属度量噪声）。
  - `ops_tree_budget.rs` 余 3 行 = 断言消息字符串（227、304、324）。
  - 装配层 `redis_driver.rs` / `redis_driver_db.rs` / `redis_driver_kv.rs` / `commands_exec*.rs`
    在 `--lib` 口径下记 **0%**（其测试全在 `tests/` 集成面）——既有口径限制，非本轨缺口；
    本轨对它们的改动（锁/拓扑透传/分发臂）由 `tests/tree_scan_budget.rs` 的可达性用例与
    Tester 新增的 4 条声明面用例覆盖。
  ⇒ **无"成块业务分支未覆盖"**：未覆盖行集中在日志字段、空集合早退与测试期断言文案。
- **诚实声明一处**：`ops_tree.rs:214`（`list_children` 的 `noTtlOnly` 分支）在**默认门禁下仍未执行** ——
  唯一走到它的两条用例是 BUG-001 的 `#[ignore]` RED pin（走即红，故必须 ignore）。
  即"补测后仍绿"不等于"该分支被测过"：该分支的覆盖**只在 `-- --ignored` 时出现**，
  而那时它是**失败**的（正是缺陷证据）。BUG-001 修复 + 摘 ignore 后此条自动闭环（R-10）。


### 步骤 8 · E2E 登记

**本机可执行**（已提交，属默认门禁，全绿）：`tests/tree_contract_tester.rs` 4 条声明面用例 +
`ops_tree_scan/tests.rs` 18 条替身用例 —— fail-soft/重放 6 条（含分类表与 `fold_command_answer` 直测）、
cluster 纪律 3 条（`scan_keys` 页 / `list_children` 页 / 锚定 SCAN 携带 MATCH+TYPE）、
`noTtlOnly` 2 条（`scan_keys` 一条绿、`list_children` 一条 ignore RED pin）、
扫描守卫 2 条（停滞游标 / 轮次上界）、`withMemory` 页 1 条、standalone/哨兵批形状 2 条、
预览与散列兜底 4 条、`key_probe` 单节点 1 条（+1 条 TYPE-only 缺席判定单测）。


**留待 R 回归**（本轨禁 live e2e ⇒ 全部写成 `#[ignore]` 可执行用例，R 侧带 env 变量跑即证）：

| # | 用例 | 前置 | 判定要点 |
|---|---|---|---|
| R-1 | `test_tester_scan_keys_payload_matches_the_freeze` | `DATAZEN_TEST_REDIS_URL` | 7 字段俱在 + `dbSize == dbsize` + `keys[]` 五字段 |
| R-2 | `test_tester_list_children_payload_matches_the_freeze` | 同上 | `children/cursor/consumed/truncated/dbsize`；`folder`/`key` 两类各自字段集；`memBytes` 为 `null` 而非缺席 |
| R-3 | `test_tester_count_and_probe_payloads_match_the_freeze` | 同上 | `count_matching` 四字段 + `*` ⇒ `count==dbsize`/`consumed==0`；`key_probe` 缺失键四字段俱在（`ttlMs=-2`） |
| R-4 | `test_tester_zero_budget_equals_absent_budget_over_the_wire` | 同上 | `budget:0` 与缺省同消耗；`budget:1` 原样生效（不缩放） |
| R-5 | `test_tester_cluster_page_never_crosses_slots` | `DATAZEN_TEST_REDIS_CLUSTER_URL` | **真集群 CROSSSLOT 侧证**：多分片页成功 + `key_probe` 落对分片 |
| R-6 | 大库缩放联调 | ≥10 万键真库 | `min(1M, max(50k, dbsize×2))` 实测、`n+` 展示（Wave 4 UI） |
| R-7 | 真集群 9a（继承） | 集群 | cursor 跨轮连续性、锚分片单侧覆盖的 UI 表述是否诚实 |
| R-8 | #56 复现（继承） | 集群 | 按本轮"附注"判定：若已不复现 ⇒ 改判归属 |
| R-9 | BUG-003 真连侧证 | 关 `DBSIZE` 的 ACL profile | 三条命令是否整条红（进程内已证，真连补一条即闭环） |
| R-10 | BUG-001 修复后 | — | 摘掉两条 `#[ignore]` RED pin，转常绿 |

### 步骤 9 · 判定

见本文件头部状态行。**结论：`TEST_FAILED`** —— 四道门禁逐字复现且零谎报，契约冻结形状逐字段成立，
但 BUG-001（高，本轨引入的回归，release 静默错数据）、BUG-002（高，既有功能被本轨形状变更打破）、
BUG-003（中，冻结承诺的降级路径不可达 + 基线能力回退）三条待原 Coder 修复后全新复测。


