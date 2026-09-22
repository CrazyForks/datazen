- 任务: 后端 codec 补齐到 §3.3 矩阵 + string 写路径 KEEPTTL 默认化与 PTTL/PX 回退（PRD §3.3 / §6）
- 状态: READY_FOR_TEST
- 编码 commit: ebbdfd7dd
- 测试 commit: —
- 合并 commit: —
- 代理: w3c-codec-write-coder（待登记 agentId）
- Worktree: .worktrees/datazen-redis-codec-write
- 分支: feature/redis-codec-write
- 心跳: 2026-09-22 18:05

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
| clippy | `cargo clippy -p datazen-driver-redis --all-targets` | 既有 17-18 warning + 2 `approx_constant` error（`decode/pickle.rs`、`redis_value_preview.rs` 等，非本轨文件） | 本轨文件 **0 新增** warning/error | 绿（不越界修他人文件） |

### 3. 越界自查与遗留

* **未碰**：`ui/**`（含 `keepTtl` 复选删除、`codecs.ts` 里 `BACKEND_CODECS` 仍是 4 项的收编，均为 W3-E）、`locales/**`、`hub.md`、他轨文档、根 `Cargo.toml` workspace 口径、`ops_workbench.rs` 与其 `tests.rs`（0 行新增，反而 `ops.rs` 净减 24 行）。
* **未碰 W3-B 的行**：`scan_keys` / `list_children` / `count_matching` / `key_probe` / `ops_tree*` 一字未改；`commands_exec_dispatch.rs` 只替换了我名下的 `decode_value` / `set_string` / `set_string_raw` 三条臂。
* **注意（留给协调者合流）**：`src/commands_exec_all_arms.rs` / `commands_exec_mutate.rs` / `commands_exec_ops.rs` 三个文件在本 crate 内**没有任何 `include!` 或 `mod` 引用**（`commands_exec.rs:117` 只 include `commands_exec_dispatch.rs`），是历史死片段。它们仍含旧的 `keepTtl.unwrap_or(false)` 臂，我按「只加/改自己行」原则**未动**；如合流期有人误当活代码读，请整段删除或确认后再删。
* **有意跳过（附理由）**：
  1. `protobuf` 解码 —— PRD §3.3 标 P2、§6 标 P3 且需 .proto schema；本轨只把它做成**可见的** `codec-not-implemented` + `suggestedCodec: "base64"`，不再伪装成未知 codec（挂账：Wave 4/P2 决定是否接 schema 上传）。
  2. `stages`/链式数组入参 —— 已由 C-2 的 `data` 二次调用覆盖，加第 10 个概念不值。
  3. 后端不做压缩（只解压）—— 写回路径 PRD 未要求，且 KEEPTTL 保存的是原字节。
  4. 前端 `BROWSER_CODECS` 收编为「全部走后端」—— 属 W3-E 的面（浏览器 `DecompressionStream` 已可用，本轨只需后端同集合）。
