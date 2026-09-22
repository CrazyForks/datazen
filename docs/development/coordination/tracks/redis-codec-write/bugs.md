# redis-codec-write — Bug 清单（第 1 轮登记）

> 登记人：`w3c-codec-write-tester`（全新 Tester 实例，未复用编码代理）· 2026-09-22
> 被测范围：`8981d3078..c0ad7078d`（5 commit：`a4b3630d7` 清点表 → `cdcfdc833` codec 集合 → `71cfe18b2` 失败结构 → `ebbdfd7dd` 写路径 → `c0ad7078d` 台账）· 分支 `feature/redis-codec-write`
> **第 1 轮判定**：**TEST_FAILED** —— 五项门禁**全部复跑为绿**（含自报数字逐条对齐），Bug 全部来自代码审查 + 独立补测，不是红测。
> 3 条解码/写路径缺陷（BUG-001~004 中的 001/002/003 有已提交的 `#[ignore]` 复现体，004 同）+ 1 条台账事实错误（BUG-005）。
>
> 四项门禁实测（详见 `progress.md`「第 1 轮 Tester 门禁实测」）：
> redis crate **276 lib passed / 4 ignored + 4 集成 passed**（Coder 交付原样 267/1 ignored，本 Tester 新增 12 例：9 passed + 3 ignored 复现体）｜宿主 **1454 passed / 3 ignored**｜`npx tsc --noEmit` **0 错**｜驱动 UI **47 files / 456 tests 全绿**｜`cargo fmt -p datazen-driver-redis -- --check` **干净**｜改动核心文件覆盖率 **99.18% / 94.12% / 100.00%**（行口径）。
>
> 复现体一律 `#[ignore]` 挂账（本项目口径：Bug 的可执行证据留在仓库里，门禁仍绿），复跑：
> `CARGO_TARGET_DIR=/tmp/w3c-test-cargo-target cargo test -p datazen-driver-redis --lib -- --ignored test_tester_`
>
> **修复轮（2026-09-22 20:48，bug-fix 代理）**：5 条全部转 `待验证（修复后）` —— BUG-001 `dfc1e0523`、BUG-002/003 `ec087a52d`、BUG-004 `8ce9285d8`、BUG-005 `fa6039116`。
> 三条复现体**未改动、保持 `#[ignore]`**，修复后同一条命令实跑 **3 passed**；四项门禁与 clippy 归属复跑见 `progress.md`「修复轮自验记录」。

---

## redis-codec-write-BUG-001 · 解码失败从「错误横幅」退化为「(empty)」：后端改 in-band，UI 唯一消费方不读 `ok`（本轨引入的可观察劣化）

- **严重度**：中（回归级：改前该路径**有**可见错误，改后**没有**；不崩、不红，但 PRD §3.3 的失败可见性与「按 X 重试」承诺在真机 GUI 上归零）
- **状态**：`待验证（修复后）` · 修复 commit `dfc1e0523`（`ValueViewer.tsx` recompute 读 `res.ok` ⇒ `{ok:false}` 进错误态并展示 `reason`，含 seq 过期保护；`redisInvoke.ts` 「Throws on reject」注释改为 C-3 口径、`DecodeValueResult` 键集对齐 C-2/C-3。复测要点：探针例 DOM 出现 `decode-failed`、无具名空态；「按 X 重试」按钮仍属 W3-E 未做；`ui/**` 仅该两文件、未新增测试文件）
- **涉及文件**：
  - `packages/drivers/redis/ui/value-editors/ValueViewer.tsx:55-57`（`decoded = new TextEncoder().encode(res.json ?? '')` —— **`res.ok` 从未被读**，`json` 为 `null` 时解出 0 字节）
  - `packages/drivers/redis/ui/shared/redisInvoke.ts:214-231`（`DecodeValueResult { ok; json? }`，doc 注释仍写「**Throws on reject**」，现已是假话）
  - 后端契约变更点：`src/decode/mod.rs:340-341`（「Any rejection … **never throws**」）+ `src/commands_exec_dispatch.rs` 的 `decode_value` 臂去掉了 `map_err(DriverError::InvalidConfig)`
- **描述（含量级）**：C-3 把解码失败从「抛 `DriverError`」改成 in-band `{ ok:false, reason, suggestedCodec, retryable, message }`，方向正确；但 `ValueViewer` 的 `try/catch` 只能接住**抛出**的失败。于是失败路径变成：命令成功返回 → `res.json === undefined` → `encode('')` → `renderView(0 字节, view)` → `setStatus('idle')` → 界面渲染具名空态 `(empty)`。用户看到的不是「解不开 + 可以按哪个重试」，而是「这个 key 的内容是空的」——**比修复前更误导**（改前是通用错误横幅）。
  同源的第二半：C-3 交付的 `reason` / `suggestedCodec` / `retryable` 三位，在 `packages/drivers/redis/ui/**` 里**零消费方**（Grep 三个 token 全 crate 只命中 Rust 生产 + Rust 测试文件），PRD §3.3 要求的「按 DEFLATE 重试」建议按钮目前没有任何挂载点。这半属 W3-E 的面（`## 契约冻结` C-3/C-4 已写给 W3-E 消费），**但「失败必须可见」这一半不能等 W3-E**：它是本轨把 throw 改成 in-band 时一并抹掉的既有行为。
- **重现步骤**（本 Tester 实测；探针为临时文件，未提交，以免与 W3-E 的 `ui/**` 冲突）：
  1. 在 `packages/drivers/redis/ui/__tests__/ValueViewer.test.tsx` 内临时加一例：`decodeValue.mockResolvedValue({ ok:false, codec:'msgpack', reason:'decode-failed', suggestedCodec:'gzip', retryable:true })`；
  2. 渲染 `ValueViewer` → 点 `data-testid` 为 `redis-codec-msgpack` 的选项（后端 codec 臂）；
  3. 断言输出区不含内容、且错误态存在（`status==='error'` 的具名标记或 reason token）。
  4. `NO_COLOR=1 npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui/__tests__/ValueViewer.test.tsx` → 该例**红**：输出区文本以具名空态结尾，DOM 内不出现 `decode-failed`。
  离线静态复现：`ValueViewer.tsx:55-57` 无 `ok` 判定即足以判定，无需真连。
- **实测日志摘录**：
  - 探针断言失败：`AssertionError: expected '…DecodeNoneGZip…WrapCopyDownload(empty)' to contain 'decode-failed'`（`…` 为工具条/codec 标签文本，末段即具名空态 `(empty)`，且无错误态节点）。
  - 后端侧形状（Rust，已提交为绿测）：`decode/tests.rs:371` `test_tester_single_byte_payloads_answer_a_well_formed_envelope` ⇒ 失败信封键集齐备（`ok/codec/reason/suggestedCodec/retryable/message`）。
  - 存量 456 例全绿**不构成反证**：`ValueViewer.test.tsx:66` 只 mock 过 `{ ok:true, json:'{"a":1}' }`，套件里从未出现 `{ok:false}`。
- **影响范围**：走 `decode_value` 的四条后端 codec（msgpack/pickle/php/java）失败路径的 GUI 可见性；`none/gzip/zlib/deflate/base64` 仍走浏览器 `DecompressionStream`，异常照常进 `catch`，不受影响。Workflow/MCP 无头调用方自带判定，不受影响。
- **建议修法（本 Tester 不改生产代码）**：
  - 最小闭环（W3-C 侧，`ui/**` 一行）：`if (!res.ok) { setErrorText(res.reason); setStatus('error'); setRendered(null); return; }`，恢复「失败可见」；
  - 完整闭环（W3-E）：读 `retryable`/`suggestedCodec` 渲染重试按钮并回退展示原始字节（C-3 末段已约定调用方手里就有原字节），同时删掉 `redisInvoke.ts:219` 的「Throws on reject」注释、把 `DecodeValueResult` 补全为 C-2/C-3 的键集。
  - 归属建议：本条由 **W3-C 修复回合**（授予 `ui/**` 单点权限）与 W3-E 各做一半，协调者按此顺序解冲突。

---

## redis-codec-write-BUG-002 · `zlib` / `deflate` 对截断与 1–2 字节载荷答「成功解出 0 字节」，C-1 的 header 校验与「选错必须失败」未被实现约束

- **严重度**：中低（错误答案以 `ok:true` 出现 = 静默错数据；gzip 那条腿会失败，三条腿严格性不一致 ⇒ 用户按 GUI 提示能分辨，但无头路径不能）
- **状态**：`待验证（修复后）` · 修复 commit `ec087a52d`（`Framing::decode` 入口门：Zlib 过 `looks_like_zlib_header`、Deflate 补最小长度；zlib/deflate 改手动 `inflate_stream` 驱动到显式 `StreamEnd`（无进展 ⇒ `Failed`，32 KiB 有界窗口 ⇒ `TooLarge`）；三腿统一「输入非空而输出 0 字节 ⇒ `Failed`」。复现体 `decode/tests.rs:398` **未改动、保持 `#[ignore]`**，`-- --ignored test_tester_` 实跑 **passed**；另有 2 例新绿测钉住前缀截断与入口门）
- **涉及文件**：
  - `packages/drivers/redis/src/decode/compress.rs`（`decode()` 用 `flate2::read::{ZlibDecoder,DeflateDecoder}` + `Read::take` 流式读；`looks_like_zlib_header()` 已实现但**只服务 `sniff_framing()`，不参与 decode 入口校验**）
  - 契约来源：`progress.md:112`（C-1 `zlib` = 「RFC 1950 zlib stream（`CM==8` + `(CMF<<8|FLG)%31==0` 头校验）」）、`progress.md:121`（C-1 附注「二者**绝不互相兜底**（选错必须失败，成功只有一种 framing）」）、`progress.md:24`（§1.2「zlib 与 gzip 的头部差异要各有用例，别用一个 'gzip 且允许 zlib' 混过去」）
- **描述（含量级）**：`flate2` 的流式解码器在读到「还没喂完」的输入时返回 `Ok(0)` 而非错误 —— zlib stream 缺 ADLER32 尾、raw DEFLATE 缺块尾都是「未结束」而非「损坏」。后果两类：
  1. **真·截断载荷被报成功**：Redis 里被 `SETRANGE` 截断、或写回时被 `SIGKILL` 打断的 zlib 值，在 GUI/Workflow 里显示成「内容为空」，reason 位根本不出现；
  2. **非 zlib 的单字节载荷被 zlib/deflate 接受**：`\x80`、`A` 这类输入既没有 `CM==8` 头，也没过 `(CMF*256+FLG)%31`（这正是 C-1 承诺的校验），仍答 `ok:true, bytes:0`。
  同一缺陷也意味着 C-1 的「选错 framing 必须失败」只在「载荷足够长」时成立：把 raw DEFLATE 选成 `zlib` 时，若首两字节恰好 `%31==0`（例如 `\x08\x1d` 这类常见 raw 块的起始）就会走进 zlib 臂，然后按本条的行为返回「成功的 0 字节」而不是 `decode-failed` + `suggestedCodec:"deflate"`。
  gzip 一条腿不受影响：`GzDecoder` 校验 CRC32/ISIZE 尾，所以 `truncated_container_is_an_error_not_a_short_success`（Coder 存量用例）只对 gzip 成立 —— 这条**用例名与实际覆盖面**的落差本身也是缺口：7 条 compress 用例里没有任何一条钉住 zlib/deflate 的截断行为。
- **重现步骤**（两种都可离线执行）：
  1. 已提交复现体：`CARGO_TARGET_DIR=/tmp/w3c-test-cargo-target cargo test -p datazen-driver-redis --lib -- --ignored test_tester_truncated_deflate_streams_must_not_succeed` → **FAILED**；
  2. 临时探针（本 Tester 实测过，事后 `git checkout -- packages/drivers/redis/src/decode/compress.rs` 还原）：在 `compress.rs` 的测试模块里直调 `decode(Framing::Zlib, &[0x80], MAX)` 与 `decode(Framing::Deflate, &[0x78,0x9c], MAX)`，打印 `Result` 的 `Debug`。
- **实测日志摘录**：
  - `zlib reported success for a 2-byte truncated stream: {"bytes":0,"codec":"zlib","data":"","inBytes":2,"json":null,"kind":"bytes","ok":true,"text":""}`（`decode/tests.rs:407`，即 `78 9c` 只有 zlib 头、无 body 无 ADLER32）
  - 探针：`one-0x80: Zlib len=1 -> Ok(0 bytes [])`｜`zlib-hdr-only(78 9c): Zlib/Deflate len=2 -> Ok(0 bytes [])`｜`ascii-A(41): Zlib len=1 -> Ok(0 bytes [])`
- **影响范围**：`zlib` / `deflate` 两个 codec 的失败判定（GUI 与 Workflow 同等受影响）；`suggestedCodec` 推导在第 4 步「真实 inflate 试探」时同样把 `Ok(0)` 当「能解」，会让建议链在截断载荷上给出错误方向。
- **建议修法**：`decode()` 入口对 `Framing::Zlib` 先跑**已有**的 `looks_like_zlib_header()`（不过 ⇒ `Failed`），对两种 framing 都补最小长度门槛；并把「输入非空而输出为 0 字节」「流未正常结束（`read_to_end` 未达 EOF）」映射为 `DecompressFailure::Failed`。零新依赖、零新文件。

---

## redis-codec-write-BUG-003 · 多成员 gzip 只解首个成员即算成功，尾部残留字节被静默丢弃 ⇒ `bytes` 少报

- **严重度**：低（真实存在的存储形态：`cat a.gz b.gz` / 分块归档写进同一个 key；表现为「内容比实际短」而非崩溃）
- **状态**：`待验证（修复后）` · 修复 commit `ec087a52d`（gzip 臂改用 `flate2::read::MultiGzDecoder`（= `GzDecoder::new(r).multi(true)` 公开等价，C-5 版本内），拼接成员全量解码、`bytes` 不再少报；尾随垃圾按 header-parse 失败传播，判定不依赖人读文本。复现体 `decode/tests.rs:424` **未改动、保持 `#[ignore]`**，`-- --ignored test_tester_` 实跑 **passed**；另有绿测 `gzip_decodes_every_concatenated_member`。与 BUG-002 同文件同函数无法按 hunk 拆分，故同 commit）
- **涉及文件**：`packages/drivers/redis/src/decode/compress.rs`（`GzDecoder` 默认单成员；未启用 `.multi(true)`，也未透出「残留未消费字节数」）
- **描述（含量级）**：`flate2` 的 `GzDecoder` 读完第一个成员就报 EOF，第二成员起的全部字节被丢掉，而 `decode_value` 仍返回 `ok:true` 并给出第一成员的 `bytes`。C-2 承诺 `bytes` 是「结果字节数」，用户据此判断解压是否完整 ⇒ 数值本身少了。同一实现口径还会吞掉 gzip 之后的**尾部垃圾**（例如被追加过内容的值），也答成功。
- **重现步骤**：
  1. `CARGO_TARGET_DIR=/tmp/w3c-test-cargo-target cargo test -p datazen-driver-redis --lib -- --ignored test_tester_multi_member_gzip` → **FAILED**；
  2. 用例内构造 `gzip("FIRST-MEMBER") ++ gzip("-SECOND-MEMBER")`（12 + 13 = 19 字节），期望 `bytes == 19`。
- **实测日志摘录**：
  - `assertion \`left == right\` failed: gunzip semantics: every member has to reach the viewer` / `left: Some(12)` / `right: Some(19)`（`decode/tests.rs:433`）
  - 探针：`MULTI_GZIP=ok(len=12,body="FIRST-MEMBER")`、`GZ_JUNK=ok(len=12,…)`（第一成员后追加乱码仍 `ok`）
- **影响范围**：仅 `gzip` codec 的输出完整性与 `bytes` 数值；`zlib`/`deflate` 无成员概念，不受影响。
- **建议修法**：`GzDecoder::multi(true)`（flate2 1.1.x 公开 API，版本口径已在 C-5 钉住），或显式统计未消费尾字节并在 `ok:true` 之外多给一个 `trailingBytes` 位。**不要**只在文案里提示 —— C-3 已规定判定不依赖人读文本。

---

## redis-codec-write-BUG-004 · `keepTtlFallback` 的分诊口径是「SET 报错了」而不是「SET 因 KEEPTTL 被拒」⇒ 非 KEEPTTL 失败也会二次写入并被误标为回退

- **严重度**：低-中（正常路径无影响；在 `WRONGTYPE` / `READONLY`（cluster 副本、failover）/ 连接类失败上会**重发一次写命令**并把「本服务器不支持 KEEPTTL」这个结论报给 UI）
- **状态**：`待验证（修复后）` · 修复 commit `8ce9285d8`（`ops_write.rs` 新增 `is_keepttl_keyword_rejection`：小写后含 `keepttl`，或 `unknown option` + `'set'` 形态——恰好是本条建议修法的两种；`Err` 臂加守卫，其余错误**原样 `Err` 抛出**、不探 PTTL、不发第二笔写、`keepTtlFallback:false` 保留，对齐 C-3 末段与 C-4。复现体 `ops_write/tests.rs:357` **未改动、保持 `#[ignore]`**，`-- --ignored test_tester_` 实跑 **passed**；另有 2 例新绿测）
- **涉及文件**：`packages/drivers/redis/src/ops_write.rs:63-91`（`match set_keeping_ttl(...) { Ok | Err(rejected) => … }`，`Err` 分支未做任何拒绝分类）
- **描述（含量级）**：C-4（`progress.md:159`）把回退的前提写成「**被服务端拒绝**（旧版本 Redis / 代理）」，`ops_write.rs:11-13` 的文档注释进一步写死「it is **only** true when the server rejected `SET … KEEPTTL`」；实际代码是「任何 `Err` 都当 KEEPTTL 拒绝」。后果：
  1. 一次多余的往返（`PTTL` + 再 `SET`）—— 对 `READONLY`/临时断连这类错误，客户端可能已经把第一笔写落下去了，重发即**重复写**（`SET` 幂等，值相同 ⇒ 影响有限，但 `PX` 会把 TTL 缩短到刚读到的 `PTTL` 值）；
  2. 更关键的是 `keepTtlFallback: true` 被当成事实报出，而 C-4 已约定 W3-E 用这一位决定是否提示「本服务器不支持 KEEPTTL，已用 PTTL+PX 保活」⇒ 在 Redis 7 上也会提示错话；
  3. 与 C-3 末段冲突：「传输/权限类失败仍按通用 IPC 错误抛出（`execute_driver_command` 契约不变）」，现在传输类失败被就地吞掉并转成回退。
  量级上这是**分类缺失**而非算法错误：真正的 KEEPTTL 拒绝（`ERR Unknown option or number of arguments for 'set' command`）路径完全正确，`rejected_keepttl_falls_back_to_pttl_plus_px` 已钉住。
- **重现步骤**：`CARGO_TARGET_DIR=/tmp/w3c-test-cargo-target cargo test -p datazen-driver-redis --lib -- --ignored test_tester_a_non_keepttl` → **FAILED**（脚本化替身：首个 `SET` 答 `ERR sentinel-wrongtype`，`PTTL` 答 `5000`，第二个 `SET` 答 `+OK`）。
- **实测日志摘录**：`a non-KEEPTTL rejection must be reported, not rescued: Ok(SetStringOutcome { ok: true, keep_ttl: true, keep_ttl_fallback: true })`（`ops_write/tests.rs:366`）
- **影响范围**：`set_string` / `set_string_raw` / `plugin_set_string` / `plugin_set_string_bytes` 四条入口的**失败**分支；成功分支与真·KEEPTTL 拒绝分支不变。
- **建议修法**：回退前先做最小拒绝分类 —— 仅当错误文本含 `KEEPTTL` 或属 `ERR unknown option … 'set'` 形态才走 `PTTL`+`PX`，其余原样 `Err` 抛出（保留 `keepTtlFallback:false`）。分类函数放 `ops_write.rs` 内部即可，别引新依赖。

---

## redis-codec-write-BUG-005 · 台账失实：clippy 门禁行的 2 个 `error` 归属文件写错（实为 `ops.rs:881` + `ops_exec.rs:260`，非 `decode/pickle.rs` / `redis_value_preview.rs`）

- **严重度**：低（无运行时影响；但 AGENTS.md 要求自报行必须真实可核，且「非本轨文件」这一句对 `ops.rs` 不成立 —— `ops.rs` 正是本轨改过的文件）
- **状态**：`待验证（修复后）` · 修复 commit `fa6039116`（`progress.md` clippy 行归属改为 `ops.rs:881` / `ops_exec.rs:260` 并注明均在 `#[cfg(test)]`、基线即存在；修复轮 clippy 复跑逐文件清单确认该 2 error 就在两处、`decode/compress.rs`/`ops_write*`/`decode/tests.rs` 零诊断，「本轨文件 0 新增」结论不变）
- **涉及文件**：`docs/development/coordination/tracks/redis-codec-write/progress.md:178`（clippy 行）
- **描述（含量级）**：原行写「既有 17-18 warning + 2 `approx_constant` error（`decode/pickle.rs`、`redis_value_preview.rs` 等，非本轨文件）」。复跑数量对得上，位置对不上：`decode/pickle.rs` 与 `redis_value_preview.rs` 里**零个** `approx_constant`（`git show 8981d3078:…` 两文件里 `3.14159` 命中数均为 0）。真正的两处都在**测试代码**里，且都不是本回合引入：`ops.rs:881`（W3-C 在 `ops.rs` 的唯一 hunk 是 `-U0` 后的一整块 24 行删除，不含 881；基线同一字面量在原 905 行）、`ops_exec.rs:260`（W3-C 零 diff）。结论「本轨文件 0 新增 clippy 诊断」仍成立，**依据**需要改正。
- **重现步骤**：
  1. `CARGO_TARGET_DIR=/tmp/w3c-test-cargo-target cargo clippy -p datazen-driver-redis --all-targets --message-format=short 2>&1 | grep "consts::PI"`；
  2. `git diff -U0 8981d3078..c0ad7078d -- packages/drivers/redis/src/ops.rs | grep '^@@'` 对照 881 行是否落在 hunk 内。
- **实测日志摘录**：
  - `packages/drivers/redis/src/ops.rs:881:38: error: approximate value of \`f{32, 64}::consts::PI\` found`
  - `packages/drivers/redis/src/ops_exec.rs:260:57: error: approximate value of \`f{32, 64}::consts::PI\` found`
  - 警告侧本轨文件命中数：`src/(decode|ops_write)` 短格式 6 行，全部 `decode/pickle.rs`（存量 `&mut Vec` 三条，非本轨 diff）
- **影响范围**：仅台账准确性；下一轮复测按修正后的两处指针复跑即可。
- **建议修法**：改 `progress.md:178` 的文件归属为 `ops.rs:881` / `ops_exec.rs:260`，并写明「二者均在 `#[cfg(test)]` 内、基线即存在」。

---

## 非缺陷澄清（审查已核实，避免下一轮重复调查）

| # | 项 | 核实结论 |
|---|---|---|
| N-1 | 死片段裁决：`src/commands_exec_all_arms.rs` / `commands_exec_mutate.rs` / `commands_exec_ops.rs` 是否真零引用、含旧 `keepTtl.unwrap_or(false)` 语义 | **确为零引用死片段，结论 = 整段删除（勿逐个同步语义）**。证据链：全 crate `include!` 仅 `commands_exec.rs:117` 一处且指向 `commands_exec_dispatch.rs`；`lib.rs` 只 `mod commands_exec;`（其余三文件既无 `mod` 亦无 `include!`）；repo 级 Grep 三个文件名只命中 2 份 progress.md 与 `design-plans/redis-driver-depth-prd.md`。旧臂在 `commands_exec_all_arms.rs:29-43`（`"set_string"` + `.unwrap_or(false)` 把 `bool` 喂给现为 `Option<bool>` 的 `plugin_set_string`，且该片段**没有** `decode_value` 臂）⇒ 一旦被误接线是**编译期即红**，不会静默半死不活，故风险是「误导读代码的人」而不是「跑出旧语义」。**本 Tester 未删**（删除属生产代码改动）。若协调者选择保留，必须先按 C-3/C-4 同步三条臂，否则等于留一枚「读到即错」的雷。 |
| N-2 | `commands.rs` 的 `decode_value` schema `enum` 只列 9 项（无 `protobuf`），而 `Codec::parse` 接受 `protobuf` | **符合 §1.4 + C-1，非缺陷**：`codec-not-implemented` 只对无头调用方（Workflow/MCP 直传）可达，GUI 选不到 protobuf 是有意为之。已由 `decode/tests.rs::protobuf_is_visible_as_deferred_not_as_garbage` 钉住。Wave 4 需知道这一点，别把它当 schema 漏项「补上」。 |
| N-3 | `PTTL<=0` 走裸 `SET` 时 `SetStringOutcome.keep_ttl` 仍报 `true` | **非缺陷**：该位语义是「按保留策略执行」（没有 TTL 可保留 ≠ 清掉了 TTL），与 `keepTtl:false`（显式清）可区分。建议 C-4 补一句口径说明，属文档级。 |
| N-4 | 前端仍显式传 `keepTtl:false`（`ui/value-editors/keyEditorsInvokes.ts:10`、`ui/shared/redisInvoke.ts:239`，配套 `__tests__/keyEditorsInvokes.test.ts:15` 断言「passes keepTtl=false by default」）| **非本轨缺陷，但是合流阻塞项**：`§2.4` 与 `C-4` 末段已把「删复选 + 去掉 `keepTtl = false` 默认实参」显式划给 **W3-E**；`KeyEditors.tsx:270` 的 `useState(detail.ttl >= 0)` 复选仍在。⇒ 目标 B 的**用户可见收益目前尚未生效**（真机 GUI 保存仍在清 TTL）。本轨后端默认语义已就绪并被 `an_absent_keep_ttl_flag_means_keep_the_ttl` 钉住。W3-E 回合若漏做，PRD §3.3「本轮把它变成默认行为并去掉复选」在验收时对不上 —— 建议在 W3-E 任务书里显式引用本条。 |
| N-5 | 集群 cross-slot 风险（KEEPTTL→`PTTL`+`SET PX` 是三条命令） | **单键写路径不构成 cross-slot**：`SET`/`PTTL`/`SET` 同键同 slot，redis-rs cluster 逐条寻址即可，且无 pipeline 跨槽断言被破坏（与基线缺陷 #56 `list_children` 同形问题不同源）。真连 cluster 的 `READONLY`/failover 表现与 BUG-004 同源，归入 `## 留待 R 回归`。 |
| N-6 | `payload-too-large` / `decompressed-too-large` 只做了 seam 级断言 | **可接受，非缺陷**：`MAX_INPUT_BYTES == MAX_DECOMPRESSED_BYTES == 50 MiB`（`decode/mod.rs`），端到端跑 50 MiB 会让 lib 套件退化成长测。两条 reason 各自有直接构造的信封用例（Coder 存量 `oversized_payload_reports_a_stable_code` + `zip_bomb_and_broken_stream_map_to_different_reasons`）。真实 50 MiB 行为归入 `## 留待 R 回归`。 |
| N-7 | `MAX_INPUT_BYTES` 与 `MAX_DECOMPRESSED_BYTES` 同值（50 MiB）会不会让 zip-bomb 上限失效 | **不会**：输入上限在 base64 解码后、解压前生效；解压侧用 `Read::take(cap+1)` 计数，读到第 `cap+1` 字节即判 `DecompressFailure::TooLarge` ⇒ 「刚好等于上限的输出」仍可解，越过上限必失败。`expansion_beyond_the_cap_reports_too_large_instead_of_allocating` 已钉住不预分配。 |
| N-8 | 本轨文件规模 | 合规：`decode/mod.rs` 428、`decode/compress.rs` 257、`decode/tests.rs` 464（本 Tester +189 行后仍 <800）、`ops_write.rs` 151、`ops_write/tests.rs` 328（本 Tester +50 行）。红线文件 `ops_workbench.rs`（1066）/ 其 `tests.rs`（1602）**零 diff**；`ops.rs` 净减 24 行（存量 1148 行仍越线，属既有规模挂账，不记在本轨头上）。 |
| N-9 | 生产路径裸 `unwrap()/expect()` | 本轨 9 个改动文件的生产代码零命中（`#[cfg(test)]` 内正常）；`decode_value` 返回 `JsonValue` 而非 `Result`，**结构上不可能 panic 上抛**，半成功/异常入口均收敛到 in-band 信封。 |
| N-10 | 是否越界 | `git diff --name-only 8981d3078..c0ad7078d`：11 个文件全在 redis crate + 本轨 progress.md，**零** `ui/**`、**零** `locales/**`、**零** 宿主 `src/**`、**零** 他轨文档、**零** 根 `Cargo.toml`；`Cargo.toml` 仅 redis crate 加 `flate2 = "1.1.9"`（与宿主同口径，C-5 成立）。W3-B 名下（`ops_tree*` / `scan_keys` / `list_children` / `count_matching` / `key_probe`）一字未改。 |
