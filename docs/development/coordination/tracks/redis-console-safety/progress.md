- 任务: Console 危险命令分类改 fail-closed（PRD §4 I-7）
- 状态: READY_FOR_TEST
- 编码 commit: 2068d36a8（rescuer 接管补齐；前任零编码 commit，工作区遗留已验收提交）
- 测试 commit: 2068d36a8（与编码同 commit，含 3 个新测试文件）
- 合并 commit: —
- 代理: rescuer（接管 w3f-console-safety-coder；父 session-61319db9-6e5c-4f32-a35e-cad750b647dd）
- Worktree: .worktrees/datazen-redis-console-safety
- 分支: feature/redis-console-safety
- 心跳: 2026-09-22 20:40

# W3-F `redis-console-safety` 简报（协调者下发）

## 0. 必读（按序）
1. `AGENTS.md`、`docs/development/subagent/coder.md`、本文件
2. `docs/todo/redis-workbench-ux/PRD.md` §4 I-7（含它点名的参照实现口径 `redisCommandSafety.ts:5,277-287`）、§3.4 写门闸段
3. 现状：`packages/drivers/redis/ui/console/redisConsoleDanger.ts`（**关键缺陷：:117 附近默认
   `return 'safe'`** ⇒ 未知命令一律放行；`EVAL` 根本不在任何集合里；`KEYS` / `CONFIG` 只弹确认不阻断）、
   `ui/console/RedisConsole.tsx`（分类的消费端）、`ui/console/redisCommands.ts`、
   `ui/shared/useRedisGate.ts`（I-6 写门闸与 SafeMode，已实现，本轨只对接不改语义）
4. `ui/__tests__/redisConsole.test.ts`、`redisConsoleDanger.test.ts`

## 1. 目标：分类器 fail-closed
1. **未知命令 ⇒ 按 blocked 处理**（这是本轨的存在理由）。默认分支从 `'safe'` 翻成最严档，
   并让「未知」这一档在 UI 上有可区分的文案（不要和"已知危险命令"混成同一条消息）。
2. **默认阻断集合**（不可仅弹确认放行）：`KEYS`、`FLUSHALL`、`FLUSHDB`、`CONFIG`、`EVAL`、`EVALSHA`、
   `SCRIPT`、`DEBUG`、`SHUTDOWN`。以 PRD §4 I-7 点名的四类为核心，其余按同理由补齐，
   并把「为什么这一档是 blocked」写进注释（一句话，引用 PRD 条目号即可）。
3. **四级分类保持向下兼容**：现在已有 safe/confirm/blocked（若还有第四档以代码为准），
   改的是**默认值与集合归属**，不是重造枚举。既有 `confirm` 档语义不得悄悄升级成 `blocked`（那会打断
   用户已有的可用工作流），反之亦然 —— 每一条档位变更要在 `## 自验记录` 列成表：命令 / 旧档 / 新档 / 理由。
4. **SafeMode 联动**：SafeMode 打开时写路径硬阻断并弹 `redis.safeMode.blocked`（I-6 现状保留，本轨不得弱化）。
5. 分类必须是**纯函数 + 可表驱动测试**：命令名解析要处理大小写、前后空白、带引号参数、
   `EVAL` 的脚本体里出现 `KEYS` 这类**误判**（脚本内容不得参与分类）；连续输入旅程要覆盖
   「半条命令」「只有命令名」「命令名后带换行」的残缺中间态。

## 2. 明确不做
- 不改 `ui/key-browser/**`（W3-D）、`ui/value-editors/**`（W3-E）、宿主 `src/**` 与 `packages/driver-sdk/**`（W3-A）、
  `packages/drivers/redis/src/**`（W3-B/C）。**特别是**：Console 的服务端权限位在 Rust `commands.rs`，本轨不碰。
- 不做「命令白名单可配置」这类扩展（P2 之外，且会引入新的安全边界）。
- 不改 `ui/shared/meta.ts` / `scripts/resolve-drivers.mjs`。

## 3. 冲突面声明
`packages/drivers/redis/locales/en.ts` 与 W3-D / W3-E 同时加文案：只追加自己的命名空间
`redis.consoleSafety.*`，不改他人 key、不重排。其余面本轨独占（`ui/console/redisConsoleDanger.ts`
及其消费点 `RedisConsole.tsx` 的相关分支）。

## 4. 门禁与交付
1. `npx vitest run --config vitest.drivers.config.ts`（基线 47 files / 456 tests，只许增不许红）。
2. `npx tsc --noEmit` = 0；`npx vite build` 通过（禁裸 `pnpm build`）。
3. `node scripts/check-driver-import-boundaries.mjs` = 0 blocking。
4. **反证测试是验收线**：至少写一条「未知命令被判为放行 ⇒ 变红」的用例；并做一次变异自证
   （把默认分支改回 `'safe'`，确认套件确实变红且红的正是那条用例），把变异结果写进 `## 自验记录`。
5. 覆盖率：改动代码 ≥80%。
6. **禁止英文字面量断言**：档位按枚举断言，文案按 i18n key 断言（既有字面量断言改写而非删除）。
7. 本文件追加 `## 自验记录`（档位变更表 + 门禁数字 + 变异自证）。
8. 返回 `READY_FOR_TEST`。

## 5. 环境纪律（违反即返工）
- 工作目录固定 `.worktrees/datazen-redis-console-safety`；禁写其他检出。
- Grep 工具搜索（禁 bash `grep -r`）；禁 `pnpm install`。
- 禁 live `pnpm e2e` / `pnpm tauri:build:webdriver`；需真实 Redis 的语句登记进 `## 留待 R 回归`。
- 禁提交 gitignored codegen / `Cargo.lock` / 注入过的 `src-tauri/Cargo.toml`；禁改 `hub.md` 与他轨文档。
- i18n 开发期只改 `en.ts`；单文件 ≤800 行（`RedisConsole.tsx` 若已接近红线，先拆分类展示子组件）。
- 本轨是**安全相关**变更：不得为了测试方便放宽默认档；不得引入"调试模式下放行未知命令"的后门。

## 自验记录（rescuer 接管验收，2026-09-22）

> 现场盘点：HEAD = 基线 `8981d3078`，前任零编码 commit；工作区遗留 5 个修改 + 6 个未跟踪项（协调者预填漏了
> `consoleCommandBatch.ts`、`RedisConsoleDangerBadge.tsx`、`redisConsoleSafetyCounterproof.test.ts` 三个成型文件）。
> 逐文件 diff 审计结论：方向正确、成型度高，未推倒；仅补齐验收、门禁、台账后提交。

### §1 五条逐项验收
1. **未知命令 ⇒ blocked**：`assessCommand` 默认分支返回 `{ level: 'ultra-danger', unknown: true }`
   （`redisConsoleDanger.ts` fail-closed 注释处）；「未知」档 UI 可区分——独立 i18n key
   `redis.consoleSafety.blockedUnknown`（不与 `blockedDestructive` 混用）、独立徽标文案
   `redis.consoleSafety.badgeUnknown` + `data-danger-unknown="true"` + 独立徽标配色（ring）。
2. **默认阻断集合**：`KEYS`、`FLUSHALL`、`FLUSHDB`、`CONFIG`、`EVAL`、`EVALSHA`、`SCRIPT`、`DEBUG`、
   `SHUTDOWN` 全部在 `ULTRA_DANGER` 集合（每组注释引用 PRD I-7）；Console 消费端在 gate 之前直接
   refuse（`redis-console-error` + 不调 `redisCommandInvoke` + 不弹确认），不可仅弹确认放行；
   `FLUSHDB/FLUSHALL` 仅保留既有 allowFlush 连接级 opt-in 且升级为双重确认。
3. **四级分类向下兼容**：枚举 `safe|write|danger|ultra-danger` 未重造；`danger`（confirm 档）21 条
   集合与基线**逐字一致**（脚本比对 `DANGER identical: true`），confirm 语义零升降级——档位变更见下表。
4. **SafeMode 联动**：`useRedisGate.ts` 未改；旅程用例 `keeps Safe Mode in front of the write path`
   断言弹 `redis.safeMode.blocked` 且不调 invoke；blocked 命令在 gate 之前 refuse（比 SafeMode 更严，
   不构成弱化）；纯 write/danger 批次仍走 `gateWrite(batch.worst | 'danger')` 受 SafeMode 前置阻断。
5. **纯函数 + 表驱动**：`redisConsoleDanger.ts` / `consoleCommandBatch.ts` 零 React 零 IO 零 i18n 依赖
   （文案经注入 `t`）；大小写/前后空白/带引号参数/`;` 尾巴均有表驱动用例；`EVAL` 脚本体不参与分类
   （只取首个 token + 跨行引号合并为同一逻辑命令，`splitConsoleCommands` 用例覆盖）；连续输入旅程
   覆盖「半条命令（K/KE/KEY）」「只有命令名（KEYS）」「命令名后带换行（GET user:1\n）」残缺中间态
   及退出跃迁（换回 GET 清红）。

### 档位变更表（命令 / 旧档 / 新档 / 理由）
| 命令 | 旧档 | 新档 | 理由 |
|---|---|---|---|
| `EVAL`、`EVALSHA`、`SCRIPT` | safe（fail-open 默认放行） | **ultra-danger（硬阻断）** | PRD §4 I-7 点名 `EVAL` 默认阻断；EVALSHA/SCRIPT 同为服务端 Lua 任意代码入口，同理由补齐 |
| `KEYS`、`CONFIG`、`DEBUG`、`SHUTDOWN`、`ACL`、`MODULE`、`CLUSTER`、`REPLICAOF`、`SLAVEOF` | ultra-danger（枚举未变，但确认后即放行） | ultra-danger（**硬阻断，不可仅弹确认放行**） | PRD §4 I-7「默认阻断」；改的是消费端释放路径，档位枚举与集合归属未变 |
| `FLUSHDB`、`FLUSHALL` | ultra-danger（allowFlush 否=阻断 / 是=单次确认） | ultra-danger（allowFlush 否=阻断 / 是=**双重确认**） | 同上；allowFlush opt-in 保留不弱化，第二道闸为既有行为收紧，不属放宽 |
| `LPOP`、`RPOP`、`SPOP`、`SMOVE`、`ZPOPMIN`、`ZPOPMAX`、`ZREMRANGEBYLEX`、`BITFIELD`、`BITOP`、`HSETNX`、`XGROUP`、`XCLAIM`、`XAUTOCLAIM`、`TOUCH`、`GEORADIUS`、`GEORADIUSBYMEMBER`、`GEOADD`、`GEOSEARCHSTORE`（18 条） | safe（fail-open 默认漏网） | **write** | 数据集突变命令；归入既有 write 档——不归档就会落进「未知⇒blocked」误伤合法工作流，归 write 则仍可执行且受 SafeMode(I-6) 阻断 |
| 只读命令 87 条（`GET`/`PING`/`SCAN`/`HGETALL`/`LRANGE`…） | safe（隐式默认分支） | safe（显式 `SAFE` 集合） | **档位不变**，仅由隐式默认改为显式词表，fail-closed 后不被误判为未知 |
| `danger` 档 21 条（`DEL`/`EXPIRE`/`RENAME`/`CLIENT`/`SUBSCRIBE`…） | danger | danger | 与基线逐字一致，confirm 语义零升降级（脚本比对通过） |
| 词表外命令（`JSON.GET`/`FT.SEARCH`、拼写错误、新版 Redis 命令） | safe（放行） | **ultra-danger + `unknown:true`（硬阻断，独立文案）** | PRD §4 I-7 fail-closed——本轨存在理由 |

### 门禁实测数字（四件套 + 覆盖率）
1. `npx vitest run --config vitest.drivers.config.ts`：**50 files / 551 tests 全绿**（基线 47/456，只增不红：+3 文件 +95 用例）。
2. `npx tsc --noEmit`：**0 errors（exit 0）**；`npx vite build`：**通过（exit 0，5.05s）**。
3. `node scripts/check-driver-import-boundaries.mjs`：**0 blocking**（1458 文件扫描，4 条既有 advisory，非本轨引入）。
4. 覆盖率（`--coverage.include` 圈定本轨 5 个改动源文件）：**Stmts 88.38% / Branch 81.06% / Funcs 94.64% / Lines 88.6%（≥80%）**；
   分文件 Lines：`redisConsoleDanger.ts` 100%、`consoleCommandBatch.ts` 100%、`consoleResultRenderer.tsx` 97.14%、
   `RedisConsoleDangerBadge.tsx` 90%、`RedisConsole.tsx` 77.69%（未覆盖为历史渲染分支，非本轨改动路径）。

### 变异自证（验收线）
- 变异：把 `assessCommand` 默认分支改回 `{ level: 'safe', unknown: false }` 后全量跑。
- 结果：**Test Files 4 failed | 46 passed；Tests 25 failed | 526 passed**——红的正是反证用例：
  `redisConsoleSafetyCounterproof.test.ts` **9 red**、`redisConsoleDanger.test.ts` fail-closed 组 **9 red**、
  `redisConsoleCommandBatch.test.ts` **4 red**、`redisConsoleSafety.test.tsx` 旅程 unknown 徽标 **3 red**。
- 还原变异后复跑：**50 files / 551 tests 全绿**，源码无变异残留。
- 反证测试（简报 §4.4）：counterproof 套件用例断言「未知命令 level=ultra-danger 且 `isBlockedLevel`=true」，
  默认分支一旦放行即变红——已由上述变异实测证明。

### 残留范围说明
- 一并提交了前任已完成的 P0-3 结果渲染接线（`consoleResultRenderer.tsx` 仅删多余 React import、
  `RedisConsole.tsx` 接 `ConsoleResultView` + 失败计数条）：属 `ui/console` 本轨独占面、带 3 条专项用例、
  门禁全绿，按接管规程「不推倒成型工作」保留。
- 禁区复核：未触碰 `ui/key-browser/**`、`ui/value-editors/**`、`src/**`、`packages/driver-sdk/**`、
  `packages/drivers/redis/src/**`、`ui/shared/meta.ts`、`scripts/resolve-drivers.mjs`、`hub.md`；
  `locales/en.ts` 仅追加 `redis.consoleSafety.*` 4 key，未动他人 key、未重排；单文件 ≤800 行
  （最大 `RedisConsole.tsx` 468 行）。

## 留待 R 回归
- 真实 Redis 上的 Console 阻断路径 live 验证：`KEYS`/`EVAL` 拒绝不发包、allowFlush 下 `FLUSHDB`
  双重确认（拒绝第二闸不发包）、SafeMode 打开时 write/danger 批次弹 `redis.safeMode.blocked`。
  本环境禁 live `pnpm e2e`（需真 Redis），单测以 mock invoke 断言「未发包」，留待 R 连真库回归。
