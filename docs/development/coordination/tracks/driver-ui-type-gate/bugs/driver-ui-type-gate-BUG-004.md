# driver-ui-type-gate-BUG-004 · 新增测试的 `info_filtered` mock 形状与真实 IPC 不一致：entries 对象数组 vs 后端二元组数组

- **状态**：**已修复**（第 3 轮复测通过；历史流转见文末「状态流转」）
- **严重度**：中（测试保真度失真 + 掩盖前后端线格式分歧；round-2 验收口径阻断；无运行时崩溃）
- **登记人**：Tester `session-61319db9-6e5c-4f32-a35e-cad750b647dd`（全新实例）· 2026-09-23
- **登记依据**：round-2 复测验收序列第 4 项「断言纪律 + **mock 形状与真实 IPC 一致**（对照 `redisInvoke` 侧的 `info_filtered` 结构）」——前 3 子项通过，末子项**失败**
- **涉及文件**：
  - `packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx`（fixture `structuredReply` :21-26，注释自证 "wire shape"）
  - `packages/drivers/redis/ui/observe/SearchableInfoPanel.tsx`（:218 对象解构消费方，只读引用）
  - `packages/drivers/redis/src/ops_observe.rs`（:236/:239 后端线格式定义，只读对照——非本轨 Tester 写面）
  - `src-tauri/src/commands/driver_command/execute.rs`、`packages/driver-sdk/src/ipc/driverCommands.ts`、`packages/drivers/redis/ui/shared/redisInvoke.ts`（链路证据，只读）

## 描述（含量级）

测试 fixture 声称自己是 `info_filtered` 的**真实线格式**：

```ts
// SearchableInfoPanel.test.tsx:21-26（round-2 逐字）
/** Structured wire shape of `info_filtered` (objects, not tuples — infoParse.ts). */
const structuredReply = {
  sections: [{ name: 'Server', entries: [{ key: 'redis_version', value: '7.2.0' }] }],
  totalEntries: 1, matchedEntries: 1,
};
```

但后端真实序列化是**二元组 → JSON 数组的数组**：

```rust
// packages/drivers/redis/src/ops_observe.rs:235-243（逐字）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]           // :236 —— 仅改字段名
pub struct InfoSectionFiltered {
    pub name: String,
    pub entries: Vec<(String, String)>,       // :239 —— serde 元组 ⇒ [["redis_version","7.2.0"]]
}
```

`rename_all` 只作用于字段名；serde 对 `(String, String)` 内建语义是 JSON 数组。全 redis `src/`
grep `serialize_with|impl Serialize` **零命中**——不存在自定义序列化。真实线上 `entries` 是
`[["redis_version","7.2.0"]]`，而 mock 是 `[{ key: 'redis_version', value: '7.2.0' }]`。

量级：1 个 fixture 形状错误，但它是本文件 4 个用例中 **3 个**（结构化往返 + round-2 两个新用例）的
唯一数据源，且 round-2 验收明确要求「mock 形状与真实 IPC 一致」——1 个验收子项直接判负。

## 证据链（源码逐环，链路零转换）

1. `ops_observe.rs`：`InfoSectionFiltered.entries: Vec<(String, String)>`（:239）；`plugin_info_filtered`
   直接返回 `InfoFilteredResult`，无映射层（`redis_driver.rs:545-589`）。
2. `commands_exec.rs:88`：`json_ok` = `serde_json::to_value(value).map(CommandResult::new)` —— 纯透传。
3. `commands_exec_dispatch.rs:430-459`：`"info_filtered" => json_ok(driver.plugin_info_filtered(...))` —— 无包装。
4. `src-tauri/src/commands/driver_command/execute.rs:26-125`：薄透传（入参会话钉扎校验，原样返回 driver 的 `CommandResult`）。
5. `packages/driver-sdk/src/ipc/driverCommands.ts`：`execute: (request) => invoke<CommandResult>('execute_driver_command', { request })` —— 裸 invoke。
6. `redisInvoke.ts:11-22` `unwrapData`：仅剥 `{ok: true}` 单键壳，其余**原样返回**；`redisCommandInvoke` 只剔 `dbSessionId` 参数，不改形。
7. `SearchableInfoPanel.tsx:57-87` `fetchInfo`：`'sections' in result` 后 `result as FilteredInfoResult`
   **纯类型断言**，零运行时转换。

⇒ 对象形状的 mock **不经过任何真实存在的转换**就能「通过」，正说明它站在一个真实链路上不存在的位置。

## 重现步骤

1. 读 fixture：`SearchableInfoPanel.test.tsx:21-26` —— entries 为对象数组，注释称 "wire shape … infoParse.ts"。
2. 读 `ops_observe.rs:234-243` —— entries 为 `Vec<(String, String)>`，仅 `rename_all = "camelCase"`。
3. 沿上述链路 2→7 逐环核对 `to_value` / dispatch / host / invoke / `unwrapData` / `as` 断言 —— 零形状转换。
4. 结论：真实线格式 = 数组的数组 ≠ mock 对象数组。
5. （交叉证伪 fixture 注释的依据）`infoParse.ts` 的 `InfoSection` 是 `parseInfoSections(rawInfo)` **从文本解析后**
   的结构（`k:v` 行 ⇒ 对象），它根本不出现在 IPC 线上——注释把「文本解析产物」当成「线格式」，自证循环。

## 实测证据（round-2 逐字）

- 链路源码引用如上（全部本轮实读，非转述）。
- 断言纪律子项对照：两条新用例断言 100% 绑 i18n key（`t: key => key` mock）、零英文文案字面量、
  零 `any`/`@ts-ignore`、invoke 参数形状 `{dbSessionId, section, search, nodeAddr}` 与真实 IPC 一致 —— 均通过；
  **唯独 reply 形状子项不通过**。
- 本轨禁 cargo/e2e，serde 序列化语义为源码级证据，未做运行时抓包——如实声明该限制。

## 影响范围

- **测试保真度**：4 个用例中 3 个在一个后端永远不会发出的形状上「证明」了行为；对 round-2 验收即为阻断。
- **潜在生产分歧（源码级推演，需下一裁决确认方向）**：真实线格式若为数组，`reconstructInfo` :218
  `const { key: k, value: v } of sec.entries` 对数组元素解构得 `k/v = undefined`（**不抛错**、catch/fallback
  不触发），输出退化为 `undefined:undefined` 行 ⇒ 搜索永不命中；而 round-1 BUG-002 修复前的元组解构
  `[k, v]` 在该线格式下**本是正确**的——其 TypeError 只在对象 mock 下出现（测试内证循环）。
  round-1 BUG-002 已裁定对象方向，本条不改判、只把矛盾摆给协调者：**两侧必有一侧错，二者不可同真**。
- **跨轨同类（不属本轨写面，仅提示）**：`redis-kvbar-ui` 轨 `kvBarRound2Tester.test.tsx:48-51` 同样把对象
  entries 自证为 "Wire reply of `info_filtered`"，`keyObjectInfo.ts:132-159` 生产端也按对象消费——同一
  分歧跨轨存在，建议协调者统一裁决后同步处理，本轨不代其他轨立案。
- **运行时**：三门禁全绿、无崩溃报告；本条单点不改三门禁数字。

## 修复建议（供 Coder，Tester 不代改；**先由协调者裁决契约方向，二选一**）

- **方向 A（与前端对象契约对齐，改动在 Rust）**：`ops_observe.rs` 把 `Vec<(String, String)>` 换成
  named struct `{ key, value }`（或为元组加 `serialize_with`），使线上形状 = 前端全树既有契约
  （`reconstructInfo` :218 / `keyObjectInfo.ts` / round-1 BUG-002 裁定）。改后现 fixture 即为真线格式，
  BUG-003 的覆盖证据不受影响；需同步核 `redis-kvbar-ui` 轨。
- **方向 B（与后端数组对齐，改动在前端 + 测试）**：fixture 改 `[["k","v"]]`、:218 改元组解构、
  `keyObjectInfo.ts` 同步——**此方向推翻 round-1 BUG-002 的裁定**，须协调者显式改判后才可执行。
- 无论 A/B：必须修正 fixture 注释 `objects, not tuples — infoParse.ts`（:21）——它把文本解析产物当
  线格式，是本次误判的根因；并复跑 BUG-003 复现命令确认 line135/154 计数仍 >0（fixture 变更可能
  动到用例交互，覆盖须重证）。

## N-check

- [x] 定位到单一根因（mock 形状 vs 真实线格式，链路零转换逐环实读）
- [x] 复现步骤可在无 cargo 条件下由纯读码完成（5 步）
- [x] 附逐字证据（Rust 234-243 + 链路 6 环 + fixture 21-26）
- [x] 非猜测：serde 元组语义确定 + 全树无自定义序列化（grep 零命中）
- [x] 修复方向二选一且标注先裁决、跨轨提示不越权

---


## 修复记录（round-2）

**裁决**：Option A — Backend → object entries.

**原因**：
- 后端真实 wire: `ops_observe.rs:239` `entries: Vec<(String, String)>` serde 序列化为 `[["k","v"]]`（元组数组）。
- 前端所有 fixture + production consumers (SearchableInfoPanel、kv-bar) 假设对象 `{key,value}`。
- kv-bar 已 merged 到 integrate 且生产代码用对象 — 保持 tuple 会 live bug（maxmemory_policy 行永远不 render）。
- Round-1 BUG-002 的裁定成立（object destructure correct）。

**Ops Observe.rs 改动点（commit `f654751ad`）**：

1. **New struct definition before `InfoSectionFiltered`** (~line 234):
```rust
/// Represents a single key-value entry in info_filtered output.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoEntry {
    pub key: String,
    pub value: String,
}
```

2. **Type change**: `InfoSectionFiltered.entries` from `Vec<(String, String)>` to `Vec<InfoEntry>`

3. **Construction update** (~line 283):
```rust
filtered.push(InfoEntry { key: k.clone(), value: v.clone() });
// was: filtered.push((k.clone(), v.clone()));
```

**Serde test added** (`test_info_filtered_entries_serialize_as_objects`):

Validates that `InfoFilteredResult` with `InfoEntry` serializes to objects:
```json
{
  "sections": [{"name": "Server", "entries": [{"key": "redis_version", "value": "7.2.0"}]}],
  "totalEntries": 1,
  "matchedEntries": 1
}
```

**Fixture comment correction** (`packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx`):
- Old: `/** Structured wire shape of \`info_filtered\` (objects, not tuples — infoParse.ts). */`
- New: `// Wire shape of \`info_filtered\` is defined by Rust \`InfoEntry\` struct (ops_observe.rs), serialized via serde. Objects are the contract.`

**门禁尾部（commit `f654751ad` 提交态，串行）**：

门禁 1 `cargo test -p datazen-driver-redis --lib`:
```
CARGO_TARGET_DIR=/tmp/dz-tg-rescue cargo test -p datazen-driver-redis --lib
[gate1 exit: 0]
结果：342 tests, 0 failures, 4 ignore （新增 1 测试）
```

门禁 2 `npx tsc --noEmit`:
```
[tsc exit: 0]
```

门禁 3 `npx vitest run --config vitest.drivers.config.ts`:
```
Test Files  52 passed (52)
     Tests  563 passed (563)
[vitest exit: 0]
```

门禁 4 `npx vite build`:
```
[vite exit: 0]
```

门禁 5 `node scripts/check-driver-import-boundaries.mjs`:
```
[check-driver-import-boundaries] 2 allow-listed reference(s) skipped
[check-driver-import-boundaries] R3 (advisory) ... 4 advisory findings
[check-driver-import-boundaries] ok (1465 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
[boundaries exit: 0]
```

**五门全部绿**：Cargo (+1 test → 342/0) + tsc (0) + Vitest (52/563) + Build (exit 0) + Boundaries (0 blocking / 4 advisory)。

**状态流转**：
`待修复` → **`待复测（round-2 修复后，裁决 A 落地）`**。awaiting round-3 retest.

## 复测记录（round-3）

- 复测人：Tester（全新实例）· 2026-09-23 · 基线 `c790efb93`
- **cargo 实测**：`CARGO_TARGET_DIR=/tmp/dz-tg-r3v3 cargo test -p datazen-driver-redis --lib` ⇒
  `test result: ok. 342 passed; 0 failed; 4 ignored`（含新增 serde pin test，较基线 341 +1）✓
- **fixture 注释已引用真契约**：`SearchableInfoPanel.test.tsx:21` 现为
  「Wire shape of `info_filtered` is defined by Rust `InfoEntry` struct (ops_observe.rs), serialized via serde. Objects are the contract.」，
  该文件 `infoParse` 零命中，不再以 `infoParse.ts` 自证 ✓
- **跨契约对齐证据**：Rust `ops_observe.rs:245` `InfoEntry { key: String, value: String }`；
  `:237-240` `InfoSectionFiltered { name, entries: Vec<InfoEntry> }`（已由 `Vec<(String,String)>` 切换）；
  TS `ui/observe/infoParse.ts:1-4` `InfoSection.entries: Array<{ key: string; value: string }>` —— 两侧逐字段同形，
  serde 线上对象数组，链路零转换 ⇒ **裁决 A（Backend → object entries）落地成功** ✓
- **其余三门禁**：tsc 无输出（exit 0）· vitest `52 files / 563 passed` ·
  boundaries `1465 file(s) scanned · 0 blocking · 4 advisory`（0 新增 advisory）✓
- 改动面：`git diff 4288cc820..HEAD --stat` 恰 5 个文件，`ops_observe.rs` +47 行等，与裁决 A 声明一致 ✓
- 状态流：`待复测（round-2 修复后，裁决 A 落地）` → **`已修复`**。
