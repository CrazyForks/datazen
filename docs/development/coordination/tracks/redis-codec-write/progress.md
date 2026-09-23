- 任务: 后端 codec 补齐到 §3.3 矩阵 + string 写路径 KEEPTTL 默认化与 PTTL/PX 回退（PRD §3.3 / §6）
- 状态: **TEST_DONE**（第 2 轮 Tester 682f2878 复测通过、5 条 bug 全部闭环，已随 W3-C 合流 feat/redis-workspace-ux；状态归一化由协调者补记）
- 编码 commit: ebbdfd7dd（交付头：`c0ad7078d`）
- 测试 commit: 本轮 `docs(coordination): record bugs for redis-codec-write`（新增 12 例测试 + 台账）
- 合并 commit: —
- 代理: w3c-codec-write-coder（待登记 agentId）
- 测试代理: w3c-codec-write-tester（全新实例，未复用编码代理）
- Worktree: .worktrees/datazen-redis-codec-write
- 分支: feature/redis-codec-write
- 心跳: 2026-09-22 20:48（修复轮完成，READY_FOR_TEST）

# W3-C `redis-codec-write` 简报（协调者下发）

## 0. 必读（按序）
1. `AGENTS.md`、`docs/development/subagent/coder.md`、本文件
2. `docs/todo/redis-workbench-ux/PRD.md` §3.3「Codec 行」「View 行」「底栏（dirty 驱动）」段、§6 后端缺口表
3. 现状：`packages/drivers/redis/src/decode/`（`mod.rs` 105 行，只有 msgpack/pickle/php/java = **4 种**）、
   `src/ops.rs`（string 写路径，`keepTtl` 处理在 :178-188 附近，**无 PTTL/PX 回退**）、`src/ops_write.rs`（24 行）、
   `src/redis_value*.rs`、前端选择器实际提供的 codec 集合在 `packages/drivers/redis/ui/value-editors/`（读它，别猜）

## 1. 目标 A：后端解码集合与前端选择器**同集合**（当前是最坏的一种不一致）
前端 UI 已提供 9 种 Codec 选项，后端只实现了 4 种 ⇒ 用户选了 `GZip`/`Zlib`/`Deflate` 时**静默不生效**。
1. 先做**清点**：把前端 codec 枚举、后端 `decode/mod.rs` 支持集、`View` 编码（UTF-8/Hex/Base64…）三者
   列成一张表贴进 `## 自验记录`，标注每项「后端有/无」「失败时用户看到什么」。
2. 补齐缺失的压缩类：**gzip / zlib / deflate**（zlib 与 gzip 的头部差异要各有用例，别用一个 "gzip 且允许 zlib" 混过去）。
   raw deflate 与 zlib stream 是两种不同 framing，必须分开。
3. **解码失败不得只回原文**：返回可判定结构（例如 `{ ok: false, reason, suggestedCodec }`），
   让 UI 能给出 PRD 要求的**「按 DEFLATE 重试」建议按钮**并回退展示原始字节。
   reason 用稳定枚举/错误码，禁止用人读句子做判定（前端要断言它）。
4. `protobuf` 属 P2，**本轨不做**；在 `## 留待 R 回归` 或后续挂账里写明缺口。
5. 新依赖（`flate2` 等）只加在 redis crate 的 `Cargo.toml`，并在 `## 自验记录` 登记一条依赖治理项
   （关联挂账 #57：redis crate 升级必查项）。**不得**改根 `Cargo.toml` 的 workspace 依赖口径。

## 2. 目标 B：`SET ... KEEPTTL` 变成默认行为 + 服务端拒绝时回退
PRD §3.3 末段：保存语义 `SET ... KEEPTTL`，服务端不支持时回退 `PTTL` + `PX`。
1. 写路径默认保留 TTL；**显式传 `keepTtl=false` 必须仍然清 TTL**（回归保护，写测试钉住）。
2. 回退路径：`SET ... KEEPTTL` 被服务端拒绝（旧版本 Redis / 代理）时，读 `PTTL` 后用 `PX` 重设，
   并把「走了回退」作为一个可断言的返回位（例如 `keepTtlFallback: bool`）。
3. TTL 已过期/为 `-1`/`-2` 的三态在回退路径上不得写错（`PTTL` 返回负值时**不要**设过期）。
4. 前端「去掉 `keepTtl` 复选」的改动属 W3-E 的面，**本轨不碰 `ui/**`**；本轨只需保证
   前端在**不传该参数**时得到「保留 TTL」的默认语义，并在 `## 契约冻结` 里写清默认值。

## 3. 冲突面声明
- 与 **W3-B**：同在 redis crate。双方都可能给 `commands*.rs` / `commands_exec_dispatch.rs` 加分发臂。
  规则：**只加自己的行，不改/不重排/不格式化他人的行**；协调者合流按并集解。
  你与 B 的分工：B = `ops_tree*` / `scan_keys` / `list_children` / `count_matching` / `key_probe`；
  你 = `decode/**` / `ops*.rs` 写路径 / 值相关命令。**越界即返工。**
- 与 W3-D/E/F（驱动 UI）、W3-A（宿主）无重叠。

## 4. 文件规模红线
`src/ops_workbench.rs`（1066）与其 `tests.rs`（1602）已越 800 行红线：**不得往这两个文件加行**。
codec 新模块按压缩算法分文件（`decode/gzip.rs` 等）或单一 `decode/compress.rs`，测试同理新开文件。

## 5. 门禁与交付
1. `CARGO_TARGET_DIR=/tmp/w3c-cargo-target cargo test -p datazen-driver-redis`（基线 239 lib + 4 集成）。
2. 若动了宿主可见类型：`CARGO_TARGET_DIR=/tmp/w3c-cargo-target cargo test -p datazen --lib`（基线 1454/3 ignored）。
3. `cargo fmt`（仅你碰过的文件）；无新增 clippy 警告。
4. `npx tsc --noEmit` = 0；`npx vitest run --config vitest.drivers.config.ts`（基线 47/456）——
   证明后端形状变更没有把 UI 打红。
5. 每个交付单元（清点 / gzip / zlib / deflate / 失败结构 / KEEPTTL 默认 / 回退）逐个 commit；
   接近轮次上限返回 `PARTIAL` + 剩余清单。
6. 本文件追加 `## 契约冻结`（codec 枚举最终名、失败返回结构、`keepTtl` 默认值与回退位）
   + `## 自验记录`（含 §1.1 的三列清点表）。`## 契约冻结` 是 W3-E 与 Wave 4 的输入。
7. 返回 `READY_FOR_TEST`。

## 6. 环境纪律（违反即返工）
- 工作目录固定 `.worktrees/datazen-redis-codec-write`；禁写其他检出。
- Grep 工具搜索；禁 `pnpm install`；Cargo 一律独立 `CARGO_TARGET_DIR=/tmp/w3c-cargo-target`。
- 禁 live `pnpm e2e` / `pnpm tauri:build:webdriver` / 裸 `pnpm build`（用 `npx vite build`）。
- 禁提交 gitignored codegen / `Cargo.lock` / 注入过的 `src-tauri/Cargo.toml`；禁改 `hub.md` 与他轨文档。
- 生产路径禁裸 `unwrap()/expect()`（`#[cfg(test)]` 除外）；单文件 ≤800 行。
- 测试禁断言英文字面量文案；i18n 开发期只改 `en.ts`（本轨原则上不加文案）。

## 自验记录

### 1. Codec / View 清点表（动手前，W3-C 唯一事实来源）

前端枚举源：`packages/drivers/redis/ui/value-editors/valueView/codecs.ts:11-28`（`CODECS` 9 项）
后端枚举源（改动前）：`packages/drivers/redis/src/decode/mod.rs:21-45`（`Codec` 4 项）
View 枚举源：`packages/drivers/redis/ui/value-editors/valueView/views.ts:9-19`（`VIEWS` 9 项）

| # | 前端 codec 选项 | 前端执行位置 | 后端 `decode_value` 支持（改动前） | 后端支持（本轨改动后） | 改动前失败/缺位时用户看到什么 |
|---|---|---|---|---|---|
| 1 | `none` | 浏览器（identity，`codecs.ts:104`） | 无此变体（传 `"none"` → `Err("unsupported codec")`） | `none`（identity） | 只有走 GUI 才有效；Workflow/MCP 调 `decode_value` 直接报 `unsupported codec` |
| 2 | `gzip` | 浏览器 `DecompressionStream('gzip')` | **无** | `gzip`（`flate2::GzDecoder`，含 header 校验） | GUI 内可用（浏览器解），**无头路径静默不可用**：`decode_value` 返回 `unsupported codec`，Workflow 里等于功能不存在 |
| 3 | `zlib` | 浏览器 `DecompressionStream('deflate')`（= zlib stream） | **无** | `zlib`（`flate2::ZlibDecoder`，CMF/FLG 头 + %31 校验） | 同上 |
| 4 | `deflate` | 浏览器 `DecompressionStream('deflate-raw')`（= raw DEFLATE） | **无** | `deflate`（`flate2::DeflateDecoder`，raw，无头） | 同上；且 zlib/raw 两种 framing 在浏览器里是两条不同分支，后端也必须分开 |
| 5 | `base64` | 浏览器（`base64ToBytes`） | **无**（`data` 字段本身要求 base64，语义完全不同） | `base64`（把 base64 **文本载荷**解成字节） | 同上 |
| 6 | `msgpack` | 后端 `invokeDecodeValue`（`redisInvoke.ts:220`） | 有（`decode/msgpack.rs`） | 保持 | 解错格式时命令 **throw**（`DriverError::InvalidConfig`），UI 只能弹通用错误，无「按 X 重试」建议 |
| 7 | `pickle` | 后端 | 有（`decode/pickle.rs`，拒 EXEC  opcode） | 保持 | 同上 |
| 8 | `php` | 后端 | 有（`decode/php.rs`） | 保持 | 同上 |
| 9 | `java` | 后端 | 有（`decode/java.rs`） | 保持 | 同上 |
| 10 | `protobuf`（PRD §3.3 标注 dbx 多一种，列 P2；`CODECS` 未含） | 无 | **无** | **仍不做**，但注册表内以 `codec-not-implemented` 稳定原因码可见（不再伪装成未知 codec），`suggestedCodec: "base64"` 对应 PRD §6「Base64 + 外部工具」降级 |

**结论（本轨要修的真实缺口）**：不是「后端少 5 个 codec 所以 GUI 里压缩不工作」这么简单 —— GUI 的 gzip/zlib/deflate/base64 走浏览器 `DecompressionStream` 确实能解；真正的缺口是
(a) `decode_value` 命令面与 UI 选项**不同集合** ⇒ Workflow / MCP 无头路径选了等于静默无效；
(b) 组合链（gzip → msgpack）在浏览器里无法完成：`codecs.ts` 一次只应用一个 codec，而 `applyBrowserCodec` 之后没有把字节再喂给 `decode_value` 的通路 ⇒ 只有后端具备 decompress→structured 能力（后端返回 `data` base64，UI 可二次调用，见 `## 契约冻结`）；
(c) 失败时后端只 throw 一句人读文本，前端无法给出 PRD §3.3 要求的「按 DEFLATE 重试」建议按钮。

**View 行清点（不改，仅登记，避免误判为后端欠账）**：`utf8 / ascii / binary / hex / base64 / json / unicodeJson / yaml / xml` 全部是 `views.ts` 里的纯字节→文本渲染器，输入是「已经过 codec 解码的 `Uint8Array`」，**不经后端**，因此 `decode_value` 不参与 View 语义；后端只需保证 `text`（严格 UTF-8，非法给 `null`）+ `data`（base64）两个位，让 View 行能继续纯前端渲染。

## 契约冻结

> W3-E（驱动 UI）与 Wave 4 的输入。改任何一条都要回到本轨重开。

### C-1 `decode_value` codec 枚举（最终名，后端与 `CODECS` 同集合）

| 规范名（请求 & 响应 `codec` 字段） | 接受的别名（大小写/空白无关） | `kind` | 成功返回 |
|---|---|---|---|
| `none` | `raw`, `identity` | `bytes` | `data` = 原字节 base64，`text`/`json` 视内容 |
| `base64` | `b64` | `bytes` | 解 base64 **文本载荷**（忽略换行/空白）后的字节 |
| `gzip` | `gunzip` | `bytes` | RFC 1952 容器解压 |
| `zlib` | `zlib-stream`, `deflate-zlib` | `bytes` | RFC 1950 zlib stream（`CM==8` + `(CMF<<8\|FLG)%31==0` 头校验） |
| `deflate` | `raw-deflate`, `deflate-raw` | `bytes` | RFC 1951 **raw** DEFLATE，无头无尾 |
| `msgpack` | `mpk` | `json` | 既有 parse-only 解码树 |
| `pickle` | `python` | `json` | 既有（拒 EXEC opcode） |
| `php` | `php_serialize`, `phpser` | `json` | 既有 |
| `java` | `java_serialized` | `json` | 既有 |
| `protobuf` | `proto3`, `pb` | — | **不实现**（P2/P3）：`reason: "codec-not-implemented"` + `suggestedCodec: "base64"` |

**⚠ framing 映射（最容易接错的一条）**：前端 `DecompressionStream` 里 `'zlib' → format 'deflate'`、`'deflate' → format 'deflate-raw'`。
后端保持跟 `CODECS` 字面量一致：`codec:"zlib"` = zlib stream，`codec:"deflate"` = raw DEFLATE，二者**绝不互相兜底**（选错必须失败，成功只有一种 framing）。`"deflate"` 单独出现时**只**表示 raw。

### C-2 统一成功结构（两种 kind 共用同一批键，缺值为 `null`）

```json
{ "ok": true, "codec": "gzip", "kind": "bytes",
  "inBytes": 34, "bytes": 1024,
  "data": "<base64 of 结果字节>", "text": "<严格 UTF-8，非 UTF-8 时 null>", "json": "<pretty JSON，不成立时 null>" }
{ "ok": true, "codec": "msgpack", "kind": "json",
  "inBytes": 12, "bytes": 12, "data": null, "text": null, "json": "<pretty JSON 树>" }
```
`inBytes` = 送进 codec 的字节数（= base64 解出来的存储字节），`bytes` = 结果字节数（`json` kind 时等于 `inBytes`）。
**链式解码就是 C-2 的用法**：`gzip` 的 `data` 直接作为第二次 `decode_value({codec:"msgpack", data})` 的入参，无需新命令、无需 `stages` 数组（已裁定不加，避免第 10 个概念）。

### C-3 失败结构（in-band，**不再 throw**）

```json
{ "ok": false, "codec": "gzip", "reason": "decode-failed",
  "suggestedCodec": "deflate", "retryable": true, "message": "<人读文本，不参与判定>" }
```

`reason` 稳定枚举（kebab-case，唯一判定依据）：
`unknown-codec` · `codec-not-implemented` · `missing-data` · `invalid-base64` · `empty-payload` · `payload-too-large` · `decode-failed` · `decompressed-too-large`

`suggestedCodec`（null = 不显示重试按钮）推导顺序，**已实现并被测试钉住**：
1. 魔数嗅到别的容器 → 那个容器（zlib 流选成 gzip ⇒ 建议 `zlib`；gzip 头选成 deflate ⇒ 建议 `gzip`）；
2. 嗅到的正是本次所选（gzip 头 + 流被截断）⇒ **null**（重试也是同样错误，不给假按钮）；
3. 结构化格式签名（Java `ac ed` / PHP `x:`|`N;` / pickle `\x80<2..6>\x95`）⇒ 建议该格式；
4. 无头 raw DEFLATE 用**真实 inflate 试探**成功 ⇒ 建议 `deflate` —— 即 PRD §3.3 的「按 DEFLATE 重试」；
5. 否则 null。`retryable === (suggestedCodec != null)`。
6. `codec-not-implemented`(protobuf) ⇒ `base64`。

只有 `ok:false` 才走这个结构；传输/权限类失败仍按通用 IPC 错误抛出（`execute_driver_command` 契约不变）。
**回退展示原始字节**由 UI 负责：后端不 echo 原始 base64（避免大包双份传输），调用方手里本来就有。

### C-4 string 写路径 TTL 语义（`set_string` / `set_string_raw`）

* `keepTtl` **缺省 = true**（不传 = 保留 TTL）；显式 `false` 仍清 TTL（回归测试 `explicit_false_still_clears_the_expiry`）；非布尔值按缺省处理（宁可不删过期）。
* 默认走 `SET … KEEPTTL`；被服务端拒绝 ⇒ `PTTL key` → `>0` 用 `SET … PX <ms>`，`<=0`（-1 永久 / -2 已消失 / 0）用**裸 SET**，绝不把负值变成过期。
* 返回：`{ "ok": true, "keepTtl": <bool>, "keepTtlFallback": <bool> }`；`keepTtlFallback` 即「走了回退」的可断言位。
* 两级都失败 ⇒ 抛错，消息同时保留原始 KEEPTTL 拒绝与回退失败原因；`PTTL` 本身不可用 ⇒ 只报原始拒绝（不谎报已写入）。
* W3-E 侧只需：删掉 `keepTtl` 复选与 `keyEditorsInvokes.ts` 里 `keepTtl = false` 的默认实参（改成不传），并按 `keepTtlFallback` 决定是否提示「本服务器不支持 KEEPTTL，已用 PTTL+PX 保活」。

### C-5 依赖治理（关联挂账 #57）

`packages/drivers/redis/Cargo.toml` 新增 `flate2 = "1.1.9"`（与宿主 `src-tauri/Cargo.toml:48` 同版本口径，走默认 rust_backend/miniz_oxide，已在 `Cargo.lock` 与本地 registry 缓存内 ⇒ 离线可构建）。
未改根 `Cargo.toml` workspace 依赖口径。**redis crate 升级必查**：flate2 的 `read::{GzDecoder,ZlibDecoder,DeflateDecoder}` 三件套是 framing 分离的实现前提，若新版合并行为（如 `MultiZlibDecoder` 化）必须回到 `decode/compress.rs` 重验「zlib ≠ raw deflate」两条用例。

### 2. 门禁实跑（W3-C，全部本机真实数字）

| 门禁 | 命令 | 基线 | 实跑 | 判定 |
|---|---|---|---|---|
| redis crate | `CARGO_TARGET_DIR=/tmp/w3c-cargo-target cargo test -p datazen-driver-redis` | 239 lib + 4 集成 | **267 passed / 0 failed / 1 ignored** lib + **4 passed** 集成 | 绿（+28：decode 16 + compress 7 + ops_write 11，含 gzip/zlib/deflate framing 分离、失败 reason/建议、KEEPTTL 默认与回退） |
| 宿主 lib | `CARGO_TARGET_DIR=/tmp/w3c-cargo-target cargo test -p datazen --lib` | 1454 / 3 ignored | **1454 passed / 0 failed / 3 ignored** | 绿（未动宿主可见类型，仍复跑确认 `plugin_set_string` 签名变更无宿主调用方） |
| 格式 | `cargo fmt -p datazen-driver-redis` | — | 无剩余 diff（仅本轨文件被格式化，未重排他人文件） | 绿 |
| 类型 | `npx tsc --noEmit` | 0 | **0** | 绿 |
| 驱动 UI | `npx vitest run --config vitest.drivers.config.ts` | 47 文件 / 456 测试 | **47 passed / 456 passed** | 绿（后端形状变更未把 UI 打红；`ValueViewer.test.tsx` 的 `{ok,json}` mock 与新形状兼容） |
| clippy | `cargo clippy -p datazen-driver-redis --all-targets` | 既有 17-18 warning + 2 `approx_constant` error（`ops.rs:881`、`ops_exec.rs:260`，均在 `#[cfg(test)]` 内、基线即存在的测试代码 —— 修复轮已按 BUG-005 核正归属；原行误记为 `decode/pickle.rs`、`redis_value_preview.rs`） | 本轨文件 **0 新增** warning/error | 绿（不越界修他人文件） |

### 3. 越界自查与遗留

* **未碰**：`ui/**`（含 `keepTtl` 复选删除、`codecs.ts` 里 `BACKEND_CODECS` 仍是 4 项的收编，均为 W3-E）、`locales/**`、`hub.md`、他轨文档、根 `Cargo.toml` workspace 口径、`ops_workbench.rs` 与其 `tests.rs`（0 行新增，反而 `ops.rs` 净减 24 行）。
* **未碰 W3-B 的行**：`scan_keys` / `list_children` / `count_matching` / `key_probe` / `ops_tree*` 一字未改；`commands_exec_dispatch.rs` 只替换了我名下的 `decode_value` / `set_string` / `set_string_raw` 三条臂。
* **注意（留给协调者合流）**：`src/commands_exec_all_arms.rs` / `commands_exec_mutate.rs` / `commands_exec_ops.rs` 三个文件在本 crate 内**没有任何 `include!` 或 `mod` 引用**（`commands_exec.rs:117` 只 include `commands_exec_dispatch.rs`），是历史死片段。它们仍含旧的 `keepTtl.unwrap_or(false)` 臂，我按「只加/改自己行」原则**未动**；如合流期有人误当活代码读，请整段删除或确认后再删。
* **有意跳过（附理由）**：
  1. `protobuf` 解码 —— PRD §3.3 标 P2、§6 标 P3 且需 .proto schema；本轨只把它做成**可见的** `codec-not-implemented` + `suggestedCodec: "base64"`，不再伪装成未知 codec（挂账：Wave 4/P2 决定是否接 schema 上传）。
  2. `stages`/链式数组入参 —— 已由 C-2 的 `data` 二次调用覆盖，加第 10 个概念不值。
  3. 后端不做压缩（只解压）—— 写回路径 PRD 未要求，且 KEEPTTL 保存的是原字节。
  4. 前端 `BROWSER_CODECS` 收编为「全部走后端」—— 属 W3-E 的面（浏览器 `DecompressionStream` 已可用，本轨只需后端同集合）。

---

# 第 1 轮 Tester 记录（`w3c-codec-write-tester` · 全新实例 · 2026-09-22 18:23）

## 判定：**TEST_FAILED** —— 5 条 `待修复`（`bugs.md` BUG-001~005）。四阶段 A/B/C/D 全部跑完，无中断上报。

> 门禁本身**全绿**：Bug 不来自红测，而来自逐档代码审查 + 独立补测（其中 4 条有已提交的 `#[ignore]` 复现体，1 条是台账事实错误）。

## T-1. `## 契约冻结` 可引用性核查（Wave 4 / W3-E 的输入是否精确可引）

| 条目 | 可引用性 | 核对方式 |
|---|---|---|
| C-1 codec 同集合 + framing 映射 | **可逐字引用**：9 规范名/别名/`kind`/成功返回齐备，`:120-121` 的 ⚠ 段把 `'zlib'→'deflate'`、`'deflate'→'deflate-raw'` 的浏览器映射写死，且明确「二者绝不互相兜底」 | 与 `ui/value-editors/valueView/codecs.ts` 的 `CODECS`（9 项）逐项对齐 ⇒ **同集合声明成立**；`BACKEND_CODECS` 仍 4 项（W3-E 的账，非本轨缺陷） |
| C-2 统一成功结构 | 可引用：键集 `ok,codec,kind,inBytes,bytes,data,text,json` + `inBytes`/`bytes` 定义 + 「链式 = 二次调用，不加 `stages`」 | 本 Tester 新增 `test_tester_json_kind_envelope_has_the_full_key_set` 钉住 `json` kind 的键集完整（缺值为 `null` 而非缺席） |
| C-3 in-band 失败结构 | 可引用：8 个 reason 拼写逐一核对为 kebab-case 且与 `Reason::code()` 一致；6 步建议顺序含「嗅到的正是本次所选 ⇒ null」与 `retryable === (suggested != null)` | 本 Tester 补 6 例覆盖 C-3 此前未测的分界（`unknown-codec` vs `missing-data`、byte codec 失败**不得**建议结构化 codec、deflate 失败无建议时 `null`） |
| C-4 TTL 语义 | 可引用：缺省=true / 显式 `false` 仍清（具名 `explicit_false_still_clears_the_expiry`）/ 非布尔按缺省 / 回退链 / 三态不得写错 / 返回位 / 两级都失败不谎报 | 全部由 Coder 的 11 例 + 本 Tester 的 1 例钉住；**但**「回退的触发前提」实现侧缺拒绝分类 ⇒ BUG-004 |
| C-5 依赖治理 | 可引用：`flate2 = "1.1.9"` 已核（`Cargo.toml` diff 唯一一行），升级必查两条用例名准确 | 本 Tester 额外要求：升版复验清单**追加** BUG-002/003 的两条新例 |

**唯一契约侧欠账（建议修复回合顺手补，属文档级）**：C-1 只承诺了「头校验」的**判据**，没写「校验不过的载荷今天会答 `ok:true, bytes:0`」（BUG-002）；C-4 只写了 `keepTtlFallback` 的含义，没写「今天任何 SET 错误都会置位」（BUG-004）。W3-E 若按字面实现会测不到这两条。

## T-2. 阶段 A：逐档代码审查结论

* **`decode/mod.rs`（428 行）**：`decode_value` 返回 `JsonValue` 而非 `Result` ⇒ **结构上不可能 panic 上抛**，半成功与异常入口一律收敛到信封；`sniff_structured` 仅在 `!codec.is_byte_codec()` 时参与建议（byte 载荷失败不推荐结构化 codec，已补测封口）；`MAX_INPUT_BYTES == MAX_DECOMPRESSED_BYTES == 50 MiB`；无裸 `unwrap/expect`。`protobuf` 在 `Codec::parse` 可达、在 `commands.rs` schema `enum` 不可达 —— 与 §1.4 一致（N-2），`codec-not-implemented` 只对无头调用方可达。
* **`decode/compress.rs`（257 行，新）**：`Framing` 三臂与 C-1 一一对应；`looks_like_zlib_header()` 公式与契约字面一致，**但只服务 `sniff_framing()`、未接入 `decode()` 入口** ⇒ BUG-002；zip-bomb 用 `take(cap+1)` 计数、不预分配（N-7 成立）；`GzDecoder` 单成员 ⇒ BUG-003。
* **`ops_write.rs`（151 行）+ `ops_write/tests.rs`（376 行）**：`keep_ttl_policy` 双拼写（`keepTtl` 优先）+ 非布尔 ⇒ `None`（宁可不删过期）；回退四臂齐（KEEPTTL 成功 / 拒绝+`PTTL>0`⇒`PX` / 拒绝+`PTTL<=0`⇒裸 `SET` / `PTTL` 不可用⇒原样抛且不谎报写入）；双重失败消息保留两段 ⇒ 满足 C-4；`SetStringOutcome` serde camelCase 与契约键名一致。**唯一缺口 = 拒绝分类缺失**（BUG-004）。
* **`commands.rs` / `commands_exec_dispatch.rs`**：`decode_value` 臂改为 `json_ok(decode_value(&input))`、去掉 `map_err(InvalidConfig)` ⇒ in-band 直通（正确方向，但正是 BUG-001 的后端侧变更点）；`set_string` / `set_string_raw` 两臂只动自己名下（§3 与 W3-B 的分工未被破坏）。
* **`redis_driver.rs:361-362`**：`plugin_set_string` / `plugin_set_string_bytes` 签名转 `Option<bool>` → `SetStringOutcome`；宿主 lib 1454 例复跑绿 ⇒ 无宿主调用方被打断。
* **`ops.rs`**：净 -24 行（删 `set_string_with_options`），未新增行；红线文件 `ops_workbench.rs`(1066) / 其 `tests.rs`(1602) **零 diff**。
* **可见性 / 冗余 import / 死代码**：本轨 9 个改动文件在 clippy 下 **0 诊断**；新增跨模块 API 只在 crate 内可见，未扩到 `packages/driver-api`。
* **三档容器不被合并**：C-1 ⚠ 段成立（`zlib_stream_is_not_raw_deflate_and_vice_versa` + `gzip_and_zlib_headers_are_distinguished_not_merged` 实测绿），**但**「选错必须失败」只在载荷足够长时成立 ⇒ 归 BUG-002。
* **cluster**：单键写路径 `SET`/`PTTL`/`SET` 同键同 slot ⇒ 无 cross-slot 动作（与基线缺陷 #56 不同源，N-5）。
* **死片段裁决（协调者委托项）**：`src/commands_exec_all_arms.rs` / `commands_exec_mutate.rs` / `commands_exec_ops.rs` —— **确认零引用，结论「建议整段删除」，本 Tester 未动一行**。证据：全 crate `include!` 仅 `commands_exec.rs:117` 一处（指向 `commands_exec_dispatch.rs`）；`lib.rs` 只 `mod commands_exec;`；repo 级 Grep 三文件名只命中 2 份 progress.md + `design-plans/redis-driver-depth-prd.md`；`commands_exec_all_arms.rs:29-43` 的旧 `set_string` 臂把 `unwrap_or(false)` 的 `bool` 喂给现为 `Option<bool>` 的 `plugin_set_string` 且无 `decode_value` 臂 ⇒ 误接线会**编译期即红**（不会静默跑旧语义，风险是误导读者）。若要保留，必须先按 C-3/C-4 同步三条臂。详见 `bugs.md` N-1。

## T-3. 阶段 B：门禁独立复跑（自报 vs 实测，一律 `CARGO_TARGET_DIR=/tmp/w3c-test-cargo-target`）

| 门禁 | Coder 自报 | Tester 实测 | 判定 |
|---|---|---|---|
| redis crate lib | 267 passed / 1 ignored（基线 239） | **267 passed / 1 ignored**（交付原样）→ 补测后 **276 passed / 4 ignored** | **一致**（+37 真实存在） |
| redis crate 集成 | 4 passed | **4 passed** | 一致 |
| 宿主 lib | 1454 passed / 3 ignored | **1454 passed / 3 ignored** | 一致 |
| `npx tsc --noEmit` | 0 | **0** | 一致 |
| 驱动 vitest | 47 files / 456 tests | **47 files / 456 tests** 全绿 | 一致（**但不构成 BUG-001 反证**：套件从未 mock 过 `{ok:false}`） |
| `cargo fmt -p datazen-driver-redis -- --check` | 干净 | **干净**（Coder 文件无需重排；本 Tester 新增 12 例经一次 `cargo fmt` 后干净，diff 仅 2 个测试文件） | 一致 |
| `cargo clippy --all-targets` | 17 lib warn / 18 lib-test warn / 2 `approx_constant` error，本轨文件 0 新增 | 数量**一致**；2 个 error 实为 `ops.rs:881` + `ops_exec.rs:260`（自报写作 `decode/pickle.rs` + `redis_value_preview.rs`，两处 `3.14` 命中数均为 0）⇒ **归属自报错误** | 结论成立，**台账失实 → BUG-005** |
| 边界护栏（额外自跑） | — | `check-driver-import-boundaries.mjs` → `ok (1453 file(s) scanned · 0 blocking · 4 advisory)` | 绿 |
| 覆盖率（llvm-cov，见 T-4） | 未自报 | 改动核心三文件 **≥94%** | 门禁满足 |

顺序合规：BOOTSTRAP 前置 → `node scripts/generate-builtin-locales.mjs` → Rust → tsc → vitest → 护栏；生成物（`src/extensions/generated*.ts`、`src-tauri/src/driver_init.rs`、`capabilities/default.json`、`.driver-features.json`）**零提交**；工作树既有 `Cargo.lock` 脏改动**未提交亦未 revert**（保持原样）。未跑 live e2e / 真连 journey（登记进 T-6）。

## T-4. 阶段 C：补测与覆盖率

`cargo llvm-cov -p datazen-driver-redis --lib --summary-only`（本次快照已含 T-4 全部 decode 侧新例）：

| 改动文件 | Region | Line | 门槛 |
|---|---|---|---|
| `decode/mod.rs` | **99.18%** | **99.19%** | ≥80% ✅ |
| `decode/compress.rs` | **94.12%** | **96.18%** | ≥80% ✅ |
| `ops_write.rs` | **100.00%** | **100.00%** | ≥80% ✅ |
| `commands.rs`（本轨 +12 行） | 100.00% | 100.00% | ✅ |
| `commands_exec_dispatch.rs`（本轨 +25 行） | 0.00%（`--lib` 内不可达：三臂均需真连接会话） | 同 | → T-6 第 1/5 项 |
| crate TOTAL（存量口径，非本轨门禁） | 52.85% | 50.64% | 登记备查 |

**本 Tester 新增 12 例**（`test_tester_*` + `[tester]` 注释块；只断键名/结构/枚举 code/sentinel，**零英文字面量断言**；既有字面量断言未被删除亦未被改写 —— 本轨生产 diff 内无此类断言）：

* `decode/tests.rs`（+189 行）：8 绿 —— base64 拒绝非 base64、base64 容忍换行空白、缺/非字符串 codec ⇒ `unknown-codec`、非字符串 `data` ⇒ `missing-data`、deflate 失败无建议 ⇒ `null`、byte codec 失败**绝不**建议结构化 codec、单字节载荷的信封形状、`json` kind 键集完整；2 `#[ignore]` 复现体 —— BUG-002 截断 zlib、BUG-003 多成员 gzip。
* `ops_write/tests.rs`（+48 行）：1 绿 —— `keepTtl` 与 `keep_ttl` 同时存在时 camelCase 优先；1 `#[ignore]` 复现体 —— BUG-004 非 KEEPTTL 拒绝。
* 三条 `#[ignore]` 的复跑（今日全红，即缺陷的可执行证据）：`cargo test -p datazen-driver-redis --lib -- --ignored test_tester_` → `0 passed; 3 failed`，日志摘录见 `bugs.md`。
* **未覆盖且未补的路径**：`payload-too-large` / `decompressed-too-large` 的 50 MiB 端到端（成本不成比例，seam 级已由双方用例钉住）、`plugin_*` 与三条 dispatch 臂（需真连接）⇒ 全部进 T-6。

## T-5. 阶段 D：Bug 登记与修复回合验收口径

`bugs.md`（同目录）5 条，一律 `待修复`：BUG-001（中·解码失败在 GUI 退化为 `(empty)`，本轨引入的回归）· BUG-002（中低·zlib/deflate 截断答成功）· BUG-003（低·多成员 gzip 少报 `bytes`）· BUG-004（低-中·回退分诊口径过宽）· BUG-005（低·clippy 台账归属失实）。

**修复回合验收（本 Tester 下一轮按此复测）**：
1. BUG-002/003/004 的三条 `#[ignore]` 复现体**去掉 `#[ignore]` 即必须绿**，不得改断言、不得改成「断言当前错误行为」；
2. BUG-001 至少落「失败可见」（`{ok:false}` 不得渲染成具名空态），「按 X 重试」按钮可交 W3-E；`redisInvoke.ts` 的「Throws on reject」注释与 `DecodeValueResult` 键集必须与 C-2/C-3 对齐；
3. BUG-005 改 `progress.md:178` 一行归属；
4. 基线口径变更须同步：本轨 lib 从 267 → **276 passed / 4 ignored（其中 3 为 Bug 复现体）**，下一轮 Coder 交付后本 Tester 期望「276 + 新增数 / 1 ignored（仅剩 `local_live_connect_…`）」。

## T-6. 留待 R 回归（含前置条件）

| # | 待验项 | 前置条件 |
|---|---|---|
| R-1 | 真连 Redis ≥6.0 与 <6.0（或剥 `KEEPTTL` 的代理）：`keepTtlFallback=true` 实际置位、TTL 误差 ≤ 一次往返 | live Redis 6.x + 一个 4.x/代理；沿用 `connect::tests::local_live_connect_*` 的 `#[ignore]` 约定（同一 target 前缀） |
| R-2 | `PTTL` 与 `SET` 之间第三方改过期的竞态（回退链的固有时间窗） | 双客户端注入（离线 stand-in 只能钉指令形状，已钉） |
| R-3 | Cluster 下 `READONLY` / failover 与 BUG-004 的交互；确认单键三命令无 cross-slot | 真 3 主 cluster（与基线缺陷 #56 同一环境，可与 #56 合并跑） |
| R-4 | 50 MiB 端到端 `payload-too-large` / `decompressed-too-large` | `--release` 或提高测试超时；**不得**放进默认 lib 套件 |
| R-5 | GUI「按 X 重试」按钮 + 原始字节回退展示（BUG-001 修复后） | W3-E 接线；jsdom 断言只允许 `data-*` / reason 码，禁英文字面量 |
| R-6 | `protobuf` 是否接 schema（§1.4 挂账） | Wave 4/P2 裁定；当前 `codec-not-implemented` + `suggestedCodec:"base64"` 为可见降级 |
| R-7 | flate2 升版复验（C-5） | 升版必跑：`zlib_stream_is_not_raw_deflate_and_vice_versa`、`gzip_and_zlib_headers_are_distinguished_not_merged` + BUG-002/003 的两条新例（解挂后） |
| R-8 | `BACKEND_CODECS` 由 4 项收编为 9 项（浏览器解压 → 后端统一路径） | W3-E 的面，本轨后端已就绪（`every_ui_codec_name_is_accepted_by_the_backend` 已钉住同集合） |

## 修复轮自验记录（W3-C bug-fix · 2026-09-22 20:48 · READY_FOR_TEST）

**逐条修复点与 commit**（均在分支 `feature/redis-codec-write`，工作树 `.worktrees/datazen-redis-codec-write`；`Cargo.lock` 保持未提交）：

| Bug | commit | 修复点 |
|---|---|---|
| BUG-001 | `dfc1e0523` | `ValueViewer.tsx` recompute 读 `res.ok`：`{ok:false}` ⇒ `errorText=reason` + `status='error'` + `setRendered(null)`（含 seq 过期保护），失败不再渲染具名空态；`redisInvoke.ts` 删除虚假的「Throws on reject」注释改为 C-3 口径，`DecodeValueResult` 键集对齐 C-2/C-3（`json: string \| null` 亦如实反映显式 null）。**未做**「按 X 重试」按钮（W3-E/Wave 4 归属不变），无新增 `ui/**` 测试文件，hunk 限于该两文件最小面 |
| BUG-002 | `ec087a52d` | `Framing::decode` 入口门：Zlib 先过既有 `looks_like_zlib_header()`（不过 ⇒ `Failed`），Deflate 补 `MIN_DEFLATE_BYTES=2` 门槛；弃用 `Read::take` 对 zlib/deflate 的「截断=EOF」口径，改为手动 `inflate_stream` 驱动到显式 `Status::StreamEnd`（32 KiB 有界窗口 ⇒ 越限 `TooLarge`；无进展 ⇒ `Failed`）；三腿统一后置「输入非空而输出 0 字节 ⇒ `Failed`」（bugs.md 建议修法原文落地；取舍：合法的空压缩值也会判失败）。零新依赖、零新文件 |
| BUG-003 | `ec087a52d` | gzip 臂换 `flate2::read::MultiGzDecoder`（= `GzDecoder::new(r).multi(true)` 的公开等价，C-5 版本口径内）：拼接成员全量解码，`bytes` 不再少报；尾随垃圾按 header-parse 失败传播（不依赖人读文本）。与 BUG-002 同文件同函数、无法按 hunk 拆分，故同 commit |
| BUG-004 | `8ce9285d8` | `ops_write.rs` 新增 `is_keepttl_keyword_rejection`（小写后含 `keepttl`，或 `unknown option` + `'set'` 形态，恰好是 bugs.md 指定的两种）；`Err` 臂加守卫：非 KEEPTTL 拒绝**原样 `Err` 抛出**、不探 PTTL、不发第二笔写、`keepTtlFallback:false` 保留 ⇒ 对齐 C-3 末段与 C-4。分类函数在 `ops_write.rs` 内部，零新依赖 |
| BUG-005 | 本 commit | `## 1. 门禁` clippy 行归属核正为 `ops.rs:881` + `ops_exec.rs:260`（均 `#[cfg(test)]`、基线即存在）；「本轨文件 0 新增 clippy 诊断」结论不变，本轮 clippy 复跑仍为 17/18 warning + 该 2 error，且逐文件清单中 `decode/compress.rs`、`ops_write*`、`decode/tests.rs` 零命中 |

**门禁实跑（修复轮，全部复跑）**：

| 门禁 | 实跑 | 判定 |
|---|---|---|
| redis crate `cargo test -p datazen-driver-redis` | **281 passed / 0 failed / 4 ignored** lib + **4 passed** 集成 | 绿（基线 276 + 本轮新增 5 例绿测：compress 3 + ops_write 2） |
| 三条 `#[ignore]` 复现体（任务书指定验收线，**未改动、保持 `#[ignore]`**） | `cargo test -p datazen-driver-redis --lib -- --ignored test_tester_` → **3 passed / 0 failed** | 绿（002/003/004 复现体断言原样通过） |
| 宿主 `cargo test -p datazen --lib` | **1454 passed / 0 failed / 3 ignored** | 绿（与基线一致） |
| `cargo fmt -p datazen-driver-redis -- --check` | 无 diff | 绿 |
| `npx tsc --noEmit` | **0** 错 | 绿 |
| `npx vitest run --config vitest.drivers.config.ts` | **47 files / 456 tests** 全绿 | 绿（BUG-001 hunk 未打红 `ValueViewer.test.tsx` 既有 mock） |
| clippy | 同基线 17/18 warning + 2 error（`ops.rs:881`/`ops_exec.rs:260`），本轨改动文件零诊断 | 绿 |

**新增 5 例绿测**（修复的回归钉，全部 `#[test]` 非 ignore）：`no_prefix_of_a_zlib_or_deflate_stream_decodes_as_a_success`、`headerless_tiny_payloads_fail_at_the_entry_gate`、`gzip_decodes_every_concatenated_member`（compress.rs）；`a_non_keyword_set_failure_is_thrown_without_rescue`、`an_unknown_option_shape_is_also_a_keyword_refusal`（ops_write/tests.rs）。

**给下一轮 Tester / 协调者的两点说明**：
1. T-5 第 4 项期望复现体解挂后「1 ignored」，但本轮任务书明确要求三条 `#[ignore]` 复现体**保持原样**（可执行证据形态）⇒ 本轮维持 4 ignored；解挂与否请协调者裁定。
2. `DecodeValueResult`/注释对齐已按 T-5 第 2 项完成；「按 X 重试」按钮与原始字节回退仍归 W3-E（R-5 不变）。
