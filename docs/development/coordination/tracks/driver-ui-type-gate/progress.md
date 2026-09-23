- 任务: 根 `tsc --noEmit` 打通驱动 UI 类型盲区（REDIS_WORKSPACE_UX P0 R 清单第 9 项）：tsconfig 纳入 `packages/drivers/*/ui` + 清零清点出的生产类型错误
- 状态: **READY_FOR_TEST（第 3 轮等待派发）**
- 编码 commit: `c2d1c1c25` → `e507cd74c` → `b0d486347` → 本台账 commit
- 测试 commit: `7b2731e42`（T1-T5 台账）→ `794dfac50`（BUG-003 登记）→ 本终局 commit（T6-T8 + 终判）
- 合并 commit: —（TEST_FAILED，等 Coder 修复 BUG-003 后派新 Tester 复测）
- 代理: driver-ui-type-gate-coder（子代理，session 见协调者登记）
- 测试代理: driver-ui-type-gate-tester（全新实例 session-61319db9-6e5c-4f32-a35e-cad750b647dd，未复用编码代理）
- Worktree: .worktrees/datazen-driver-ui-type-gate
- 分支: feature/driver-ui-type-gate（基线 `feat/redis-workspace-ux` @ `1b77ce149`）
- 心跳: 2026-09-23 11:47（全部目标完成，READY_FOR_TEST）

# `driver-ui-type-gate` 简报（自验记录 + 证据）

## 1. 方案选型：Plan A（采纳）/ Plan B（弃用）

**选 Plan A**：根 `tsconfig.json:26` `include` 追加 `"packages/drivers/*/ui"`，一行改动。
理由：
1. 根配置的 `compilerOptions` 与驱动 UI 需求**完全相容**——`jsx: react-jsx`、`strict`、`lib: DOM`、
   `moduleResolution: bundler`、`paths` 已映射 `@datazen/ui` → `packages/ui/src/index.ts`，
   驱动 UI 与宿主/`packages/ui` 同一套依赖与 JSX 运行时，无需任何编译选项分叉；
2. 唯一障碍是 include 缺口本身（清点出的 11 条生产错误，本轨已清零）；
3. Plan B（独立 `tsconfig.drivers-ui.json` + 新 npm script）会引入第二份需要人记得跑的配置——
   与本项「让**每个人的** `npx tsc --noEmit` 覆盖驱动 UI」的目标直接矛盾：独立配置不跑等于没门禁。
4. 现有 `exclude` 已按宿主同口径挡掉 `packages/**/__tests__/**` 与 `*.test.*`，Plan A 自动继承同一排除规则，无需新增排除项。

## 2. 清点表（动手前，include 临时挂上跑真实清单；生产 / 测试分开计数）

清点方法：临时 config（完整 include 列表 + `packages/drivers/*/ui`），逐错误码归并；临时文件已删，未入库。

### 2.1 生产文件（`packages/drivers/*/ui` 下非测试）：**11 错 / 1 文件**

| 文件 | 错误码 × 数量 | 合计 | 归类 |
|---|---|---|---|
| `packages/drivers/redis/ui/observe/SearchableInfoPanel.tsx` | TS6133 ×2、TS2345 ×7、TS2322 ×1、TS2488 ×1 | 11 | 见 §3 修复表 |
| `packages/drivers/redis/ui/console/consoleResultRenderer.tsx` | — | **0** | 简报称 ×1，实测 0（±1 容差内，以实测为准） |

### 2.2 测试文件（`__tests__` / `*.test.*`）：**42 错 / 19 文件** —— tsconfig 层排除，不修

代码分布：TS6133 ×7、TS7006 ×5、TS2580 ×6、TS2740 ×6、TS2339 ×5、TS2305 ×4、TS2322 ×4、TS2307 ×3、TS2739 ×1、TS7016 ×1 = 42。

**排除理由（写进台账，不是偷懒）**：
1. 根 `tsconfig.json` **既有** `exclude`（`packages/**/__tests__/**`、`packages/**/*.test.ts(x)`）
   与宿主测试**完全同口径**——宿主自己的测试本来就不进 `npx tsc --noEmit`，Plan A 只是让驱动测试
   享受同一豁免，不新造规则；
2. 42 错**非纯机械**：TS2580×6（`Buffer` 等 node 环境全局缺 ambient types，需装/调 types 配置）、
   TS7016×1、TS2307×3（node:*/虚拟模块缺声明）、TS2739/TS2740×7（mock 形状与**他轨在飞**测试文件漂移）、
   TS6133×7、TS7006×5——修它们要动 19 个测试文件，其中多数属其他轨道在飞的面（kvBarRound* 等），
   本轨改他轨测试 = 冲突面越界（简报冲突声明只授予 `SearchableInfoPanel.tsx` + tsconfig include + 新测试）；
3. 类型层面的测试文件健康度由 vitest 门禁（转译不查类型）之外的后续轨道负责，挂账见 §7-3。

## 3. 修复表（文件 × 方法 × 零行为标记）

| # | 文件:位置（修复前行号） | 方法 | 零行为? |
|---|---|---|---|
| 1 | `SearchableInfoPanel.tsx:3` | 删除 import 中未使用的 `cn`（TS6133） | ✅ 零行为 |
| 2 | `SearchableInfoPanel.tsx:40-44` | 删除零引用的 `formatBytes` 死函数（TS6133） | ✅ 零行为 |
| 3 | `SearchableInfoPanel.tsx:114,133,141,142,144,161,166` | 7 处 `t(key, 'literal')` 去掉非法第二实参（TS2345 ×7） | ✅ 零行为（证明：`packages/ui/src/i18n.ts:74-89`——`formatMessage` 只对 `{param}` token 做 `String.replace`；7 条消息全为无 token 文本（`en.ts:354-359` 注册 6 条 + 未注册的 `redis.monitor.refresh` 模板即 key 本身，也无 token）⇒ 带参 replace 与直接返回恒等；第二实参是 `string` 而非 `I18nParams`，运行时对无 token 模板从未产生过任何插值） |
| 4 | `SearchableInfoPanel.tsx:127` | `variant="outline"` → `variant="secondary"`（TS2322） | ❌ **改行为 = 真 bug**（见 `bugs.md` BUG-001；先补特征测试、红→绿） |
| 5 | `SearchableInfoPanel.tsx:224` | `for (const [k, v] of sec.entries)` → `for (const { key: k, value: v } of sec.entries)`（TS2488） | ❌ **改行为 = 真 bug**（见 `bugs.md` BUG-002；先补特征测试、红→绿） |

两处「改行为」均按简报要求：**先写最小特征测试（实跑红）→ 再修（实跑绿）**，测试文件
`packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx`（新增，落在授权的 `__tests__/` 目录）。

## 4. 门禁表（三大门禁严格串行；以下为最终轮**逐字原文输出**）

| 门禁 | 实测 | 判定 |
|---|---|---|
| `npx tsc --noEmit` | 0 错（输出仅 exit 行） | ✅ |
| `npx vitest run --config vitest.drivers.config.ts` | 52 files / 561 tests passed（基线 51/559 + 本轨新增 1 文件 2 测试） | ✅ |
| `node scripts/check-driver-import-boundaries.mjs` | 0 blocking / 4 advisory（4 条均为既有 R3，与基线一致） | ✅ |

### 4.1 三份门禁输出逐字尾部（2026-09-23 11:46-11:47 最终轮）

门禁 1（`npx tsc --noEmit`）——无错误输出，仅退出标记（本次以 `[exit N]` 包裹记录）：
```
[exit 0]
```

门禁 2（`npx vitest run --config vitest.drivers.config.ts`）尾部逐字：
```
 Test Files  52 passed (52)
      Tests  561 passed (561)
   Start at  11:46:58
   Duration  8.83s (transform 4.08s, setup 19.71s, import 3.39s, tests 5.73s, environment 23.98s)

[exit 0]
```

门禁 3（`node scripts/check-driver-import-boundaries.mjs`）全文逐字：
```
[check-driver-import-boundaries] 2 allow-listed reference(s) skipped
[check-driver-import-boundaries] R3 (advisory) src/locales/locales.test.ts:107: reaches into driver internals (packages/drivers/redis/locales)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:25: reaches into driver internals (packages/drivers/redis/ui/shared/meta)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:26: reaches into driver internals (packages/drivers/mongodb/ui/meta)
[check-driver-import-boundaries] R3 (advisory) src/windows/connection/DocumentConnectionView.tsx:25: reaches into driver internals (packages/drivers/mongodb/ui/mongodbFind)
[check-driver-import-boundaries] ok (1465 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
[exit 0]
```

## 5. 门禁覆盖证据（`npx tsc --noEmit --listFiles`）

```
/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-driver-ui-type-gate/packages/drivers/redis/ui/console/consoleResultRenderer.tsx
/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-driver-ui-type-gate/packages/drivers/redis/ui/observe/SearchableInfoPanel.tsx
```
两个目标文件均在 tsc 编译程序内 ⇒ 盲区关闭，`npx tsc --noEmit` 对驱动 UI 生产代码全量生效。

## 6. 提交清单（hash + 主题）

| # | hash | subject |
|---|---|---|
| 1 | `c2d1c1c25` | `fix(driver-ui): drop dead code and bogus i18n fallback args in SearchableInfoPanel` |
| 2 | `e507cd74c` | `fix(driver-ui): repair two real runtime bugs exposed by type gate in SearchableInfoPanel` |
| 3 | `b0d486347` | `chore(type-gate): include packages/drivers/*/ui in root tsconfig` |
| 4 | 本 commit | `docs(coordination): record driver-ui-type-gate ledger` |

## 7. 偏差与挂账

1. **`consoleResultRenderer.tsx` 实测 0 错**（简报写 ×1）：±1 容差内，以本轨实测为准；无需动作。
2. **`redis.monitor.refresh` 键全仓未注册**（grep 全 worktree 仅命中调用点）：刷新按钮运行时会显示原始 key。
   但 i18n 文件（`en.ts` 等）是本轨禁写面 ⇒ 只挂账不修，交协调者在 i18n 轨处理
   （`en.ts:354-359` 已注册其余 6 个 `info*` 键，缺的只有这一个）。
3. **驱动测试文件 42 错 / 19 文件**：按 §2.2 理由在 tsconfig 层排除（既有 exclude 同口径），存量挂账
   待后续「驱动测试类型清账」轨道。
4. **4 条 R3 boundary advisory 为基线既有**（locales.test.ts:107 / driverUiSetup.ts:25-26 / DocumentConnectionView.tsx:25），
   本轨 0 新增、0 触碰。
5. `SearchableInfoPanel` 当前**无生产消费方**（全仓仅自身定义 + 本轨新测试）⇒ 两处真 bug 修复的
   运行时爆炸半径为零，但已被特征测试钉住，待 Wave 4 挂载时不再踩雷。

## 自验记录

1. ✅ 动手前先清点：临时 include 配置实跑，生产 11 错 / 测试 42 错分列 §2，跑完即删临时文件。
2. ✅ 9 处零行为修复逐项给出证明（§3 行 1-3，i18n 恒等性引 `i18n.ts:74-89` 源码）。
3. ✅ 2 处真 bug 修复**测试先行**：新测试先实跑**红 2 例**（`toHaveBeenCalledTimes(1)` 失败 = 结构化结果
   被静默吞掉走了 `info` 兜底；`className` 不含 `variant` 类 = `outline` 查表 `undefined`），修复后**绿 2 例**。
4. ✅ 三门禁严格串行（tsc → vitest → boundaries），最终轮三份逐字输出见 §4.1；中途每个 commit 前均复跑。
5. ✅ Plan A 生效证据：`--listFiles` 逐字命中两目标文件（§5）；根 tsc 在 include 生效后 0 错。
6. ✅ 越界自查：`git status` 仅含 `tsconfig.json`、`SearchableInfoPanel.tsx`、新测试文件、本台账；
   未触碰禁写面（key-browser / RedisWorkbench / RedisConnectionView / i18n 文件 / 全部 Rust / scripts 现有文件 / hub.md）；
   未提交 `Cargo.lock` 与 gitignored codegen；错误总量 11，未触发 >30 阈值。
7. ✅ 测试断言纪律：新测试只用 i18n key（`redis.monitor.refresh`）、fixture 数据与调用计数断言，无英文文案字面量。
8. ✅ vitest 计数对齐：基线 51/559 → 52/561（+1 文件 +2 测试 = 本轨新增，无既有用例改动）。

---

# 测试记录（第 1 轮 · Tester `session-61319db9-6e5c-4f32-a35e-cad750b647dd` · 2026-09-23）

> 零信任复测：以下均为 Tester 独立实测，不采信 Coder 自报数字。BOOTSTRAP：worktree
> `.worktrees/datazen-driver-ui-type-gate` / 分支 `feature/driver-ui-type-gate` / 起测时 `git status` 干净。

## T1. 文件面审计 — **PASS**

- `git status --porcelain=v1` 起测时空输出（无未提交残留）。
- `git log --oneline 1b77ce149..HEAD` = 恰 4 个 commit，hash 与主题逐字对上 claim：
  `132be63fc` docs 台账 → `b0d486347` tsconfig include → `e507cd74c` 2 真 bug 修复 → `c2d1c1c25` 零行为修复。
- `git diff --stat 1b77ce149..HEAD` = 恰 5 个文件：`tsconfig.json`、`packages/drivers/redis/ui/observe/SearchableInfoPanel.tsx`、
  新测试 `packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx`、本轨 `progress.md`、本轨 `bugs.md`
  —— 全部在 Coder 声明写面内，**零越界**（hub.md / i18n / scripts / Rust / tsconfig 其余部分 / 其他轨台账均未触碰；
  `b0d486347` 的 tsconfig diff 仅 include 一行，exclude 未动）。
- 逐 commit 面：`c2d1c1c25` 仅动 SearchableInfoPanel.tsx；`e507cd74c` 仅动该文件+新测试；`b0d486347` 仅 tsconfig；`132be63fc` 仅本轨台账。

## T2. 独立门禁三连 — **PASS**（串行，逐字尾部）

门禁 1 `npx tsc --noEmit`：
```
[exit 0]
```

门禁 2 `npx vitest run --config vitest.drivers.config.ts` 尾部：
```
 Test Files  52 passed (52)
      Tests  561 passed (561)
   Start at  11:51:48
   Duration  8.86s (transform 4.25s, setup 19.40s, import 3.24s, tests 5.73s, environment 24.22s)

[exit 0]
```

门禁 3 `node scripts/check-driver-import-boundaries.mjs` 全文：
```
[check-driver-import-boundaries] 2 allow-listed reference(s) skipped
[check-driver-import-boundaries] R3 (advisory) src/locales/locales.test.ts:107: reaches into driver internals (packages/drivers/redis/locales)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:25: reaches into driver internals (packages/drivers/redis/ui/shared/meta)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:26: reaches into driver internals (packages/drivers/mongodb/ui/meta)
[check-driver-import-boundaries] R3 (advisory) src/windows/connection/DocumentConnectionView.tsx:25: reaches into driver internals (packages/drivers/mongodb/ui/mongodbFind)
[check-driver-import-boundaries] ok (1465 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
[exit 0]
```
三门禁数字与 Coder claim **逐项一致**（52/561；0 blocking / 4 advisory 且 4 条 R3 行号逐字同基线）。

## T3. 盲区证据复核 — **PASS**（含 1 条机制澄清）

- 带 include 的 `--listFiles`：`consoleResultRenderer.tsx` 与 `SearchableInfoPanel.tsx` **均在程序内**，
  驱动 UI 生产文件共 109 个入程序，`__tests__` 混入 0（exclude 生效）。
- 反向验证（include 行临时移除 → tsc → 已 `git checkout` 还原，status 干净）：
  - tsc **0 错**；
  - `SearchableInfoPanel.tsx` **不在列表** ✅；驱动 UI 文件 109→92，差集恰 **17 文件**（含该面板、各驱动 meta/dialect 等）
    ⇒ include 行真实生效，非摆设；
  - 澄清（非缺陷）：`consoleResultRenderer.tsx` 反向后仍在列表（`/tmp` 两份 listFiles line 217 对照）——
    链路 `src/extensions/generated.ts:12 → RedisConnectionView → RedisConsole.tsx:24 → consoleResultRenderer`，
    由宿主 codegen 传递引入、与 include 无关。这**佐证** claim #6「SearchableInfoPanel 无生产消费者、
    只有 include 能拉它入程序」与 claim #1「consoleResultRenderer 本就在门禁内、0 错属实」。

## T4. 盘点复核 — **PASS**（生产逐码全中、测试 42/19 逐码全中）

- **生产现态**：临时 config（extends 根 + drivers include + 既有 exclude，用完已删）→ `npx tsc --noEmit` **0 错**。
- **生产基线回放**（claim #1 精确核验）：把 `1b77ce149` 版 SearchableInfoPanel.tsx 临时换入同命令跑+还原：
  **恰 11 错、100% 在该文件**，码分布 `TS2345×7 / TS6133×2 / TS2322×1 / TS2488×1` —— 与 claim **逐码一致**；
  `consoleResultRenderer` 命中 **0**（claim ±1 容差落点 = 0，属实）。
- **测试侧 42/19**：按 Coder 清点口径（完整 include + drivers ui、仅排 src 测试，临时 config 已删）复现：
  驱动测试 **42 错 / 19 文件**，码分布 `TS6133×7、TS7006×5、TS2580×6、TS2740×6、TS2339×5、TS2305×4、TS2322×4、
  TS2307×3、TS2739×1、TS7016×1` —— 与 §2.2 **逐码一致**。
  - 过程差异已查明（非 claim 错误）：include 仅 drivers 的临时配置数出 46 错——因未 seed
    `packages/wapp-sdk/__tests__/vendor-node.d.ts` 的 `node:fs`/`node:path` ambient，`node:fs` 报 TS2307；
    按 Coder 口径补齐后 node:fs/path 归位 TS2305×4、余 `node:stream/web`+`node:zlib` 为 TS2307×3 ⇒ 42。
    19 文件数在两种口径下恒等。同口径另见 4 个非驱动 packages 测试 18 错（`packages/ui` / `extension-points` /
    `wapp-sdk`），不属本轨 `packages/drivers/*/ui` 清点面，根 exclude 同样豁免。
  - **抽查 3 文件错误属实**：`kvBarRound1Fixes.test.tsx:48` TS2740（mock 形状漂移）、
    `mongodb/ui/__tests__/localePackRegistration.test.ts:20` TS2305 `node:fs.readdirSync`、
    `redis/ui/__tests__/stringKeyValue.test.ts:176` TS2307 `node:zlib`；19 文件全部命中
    `packages/**/__tests__/**` 与 `*.test.*` 两模式 ⇒ 与宿主测试（`src/**/__tests__/**`、`src/**/*.test.*`）
    **同规则豁免**，且两模式为基线既有（`b0d486347` 未动 exclude）。§2.2 排除理由成立。

## T5. 零行为修复源码核对 — **PASS**（变异见 T6）

- `packages/ui/src/i18n.ts:74-80` `formatMessage`：仅 `template.replace(/\{(\w+)\}/g, …)`，无 token 必返原文；
  `t(key, params?: I18nParams)` 签名 ⇒ 传 `string` 实锤 TS2345。
- 7 条消息无 token：`packages/drivers/redis/locales/en.ts:354-359` 注册 6 条（zh-CN:264-269 同），
  第 7 条 `redis.monitor.refresh` 全仓未注册（grep 仅命中调用点与本台账）⇒ 第二实参从未插值，剥参前后恒等
  —— claim #3 成立，偏离项 #2（refresh 键缺注册）属实入账 §7-2。
- `cn` / `formatBytes` 删除与 7 处剥参在 `c2d1c1c25` diff 中逐字核对无误。
- 行号口径：claim 行号为**基线行号**（c2d1c1c25 净 -6 行：t() 114/133/141/142/144/161/166 → 现 108/127/135/136/138/155/160；
  variant 127 → 现 121；for-of 224 → 现 218），全部对上。

## T6. 变异验证矩阵 — **5 项全部闭环，无假绿**

| # | 变异体 | 注入态实测（逐字） | 还原后实测 |
|---|---|---|---|
| M1 | `:127` `t('redis.monitor.refresh')` → `t('redis.monitor.refresh', 'Refresh')`（改回第二实参形态） | vitest 全量 **52 文件/561 测试全绿** ⇒ **变异不可感知（运行时，如实记录）**；`npx tsc --noEmit` **红**：`packages/drivers/redis/ui/observe/SearchableInfoPanel.tsx(127,57): error TS2345: Argument of type 'string' is not assignable to parameter of type 'I18nParams'.` `[exit 2]` ⇒ 本轨交付的类型门禁精准感知 | `git checkout --` 还原 → `git status` 空、tsc `[exit 0]` 绿 |
| M2 | 同时还原两处修复（AB 态：`variant="outline"` + `[k, v]` 二元组解构） | 单跑新测试 **2 failed**，断言与 Coder 报告同类逐字吻合：`AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times`（`47| expect(mockInvoke).toHaveBeenCalledTimes(1);`）与 `AssertionError: expected 'inline-flex items-center justify-cent…' to contain 'border-edge'` | — |
| M3 | 仅 BUG-001 坏（outline，解构保持已修＝状态 A） | **1 failed**：仅 `border-edge` 断言；计数测试绿 ⇒ BUG-001 测试独立可红 | — |
| M4 | 仅 BUG-002 坏（secondary + 二元组解构＝状态 B） | **1 failed**：仅 `toHaveBeenCalledTimes … got 2`；variant 测试绿 ⇒ BUG-002 测试独立可红 | — |
| M5 | 两修复全还原 | **2 passed**；`git status --porcelain` 与 `git diff --stat` **双空**（字节级还原） | ✓ |

- M1 风险评估：测试按契约 mock `t` 恒等（`t: (key) => key`），剥参类回归**必然**不可被 vitest 感知——防线即本轨交付的 tsc 门禁（实测 TS2345 @127,57 命中），残余风险**低**；此为「变异不可感知」的诚实记录，不作为绿灯粉饰。
- 结论：BUG-001/BUG-002 的修复**真实有效且测试可感知**，Coder 报告的 2-failed 现场可复现。

## T7. 覆盖率 — **不达标：登记 `bugs/driver-ui-type-gate-BUG-003.md`**

命令（串行，Brief 口径）：`npx vitest run --config vitest.drivers.config.ts --coverage.enabled --coverage.reporter=json-summary --coverage.reporter=text`（补 `json` reporter 取行级明细）→ `[exit 0]`。

`SearchableInfoPanel.tsx`：**行 35/46 = 76.08% · 分支 32/47 = 68.08% · 函数 13/15 = 86.66% · 语句 37/49 = 75.51%**
（本轨无 80% 数值基线，不按总分判，按改动行从严判）。

改动行逐行核（10 行：3, 108, 121, 127, 135, 136, 138, 155, 160, 218）：

- ✅ **8/10 被执行**：:3 import、:108 placeholder、:121 variant（被 `border-edge` 断言钉住）、:127 `t()` 计数 4、
  :136/:138 stats 常规臂、:160 infoHint、:218 解构计数 1；
- ❌ **2/10 零执行（硬口径「改动行必须全被测到」被触犯）**：
  - `branch@134 cond-expr [0,2] → loc#0 line 135 col 14 count 0` — search 真臂，两个测试从不向搜索框输入；
  - `branch@153 binary-expr [4,2,0] → loc#2 line 154 col 10 count 0` — 空 section 提示终臂，测试 2 `rawInfo=''` 首项短路、
    测试 1 fixture 恒含 1 section。
- 未覆盖语句行全集 `21-24, 71-82, 92, 107-113`，**均非本轨改动行**（107/113 = onChange/clear 交互未测，既有缺口，不立案）。
- ⇒ **BUG-003**（`bugs/driver-ui-type-gate-BUG-003.md`，状态 `待修复`，severity 低，含逐字证据/复现步骤/修复建议）。

## T8. 台账与协议审阅

- 状态行：起测 `READY_FOR_TEST` ✓；本终判翻 **`TEST_FAILED（第 1 轮，1 个 bug）`**，头部测试 commit/测试代理字段已回填。
- 结构：T1-T8 + 逐字门禁尾 + 变异矩阵 + 覆盖数字 ✓；§2.1/§2.2/§3-§7/自验记录齐全 ✓。
- §2.2 排除理由：**成立**（T4 抽查属实；exclude 两模式为基线既有、与宿主测试同规则豁免）✓。
- §7 余项：#2 `redis.monitor.refresh` 键未注册、#3 42 个测试类型错误 —— 均已入账 ✓。
- `bugs.md` 格式裁定（**观察项，不立案**）：该文件系 Coder 本轮**新建**单文件台账（基线 `1b77ce149` 不存在，`git cat-file -e` 实证），
  2 条 bug 同文件，形式上与「一 Bug 一文件 / 不再新增单文件」相抵；**不判违规**理由：
  (a) 两条均 `已修复`、无未关闭项——合入门禁（coordinator.md:101 计数 bugs.md）满足；
  (b) 字段完整（严重度/状态/涉及文件/描述/重现/日志/N-check）；
  (c) Coder 自报且修复已入 commit，不存在一 Bug 一文件所防的 Tester/修复者/复测者并发写冲突；
  (d) 协议自身不自洽（tester.md:96 仍存「登记在 bugs.md」旧文）。
  建议协调者后续统一口径把历史两条归一到 `bugs/` 目录（非本轨阻断项）。
- 本轮 Tester 登记：`bugs/driver-ui-type-gate-BUG-003.md`（协议路径、一 Bug 一文件、独立 commit `794dfac50`）✓。

## 偏差裁定（Deviation rulings）

1. `redis.monitor.refresh` 键未注册（en.ts/zh-CN.ts 均缺）：**成立，报告不立案**——预存在（基线同缺、剥参不改行为）且 Coder 禁写 i18n；已入 §7-2 留协调者派轨。
2. 42 个测试类型错误经 exclude 豁免：**成立**（T4 逐码 42/19 复现；exclude 基线既有；track 清点面限生产）。
3. SearchableInfoPanel export-only、blast radius 0：**成立**（T3 机制佐证：仅 include 拉入程序，宿主无导入链）。
4. consoleResultRenderer 实测 0（brief 预期 ×1、±1 容差）：**成立**，claim 本就报 0。
5. 反向验证中 consoleResultRenderer 移除 include 后仍在程序：**非缺陷**——`src/extensions/generated.ts:12` 传递引入，
   反证 claim #6，机制澄清入账 T3。

## 终判（第 1 轮）

**TEST_FAILED（第 1 轮，1 个 bug）** — `driver-ui-type-gate-BUG-003`（改动行 :135/:155 的 `t()` 调用在全部 561 测试下零执行，
触犯本轨硬口径「改动行必须全被测到」）。

其余验收项**全部通过**：文件面审计 ✓ · 三门禁逐字一致（tsc exit 0 / 52+561 / 0 blocking+4 advisory R3）✓ ·
盲区证据（含 1 条机制澄清）✓ · 盘点 11 错与 42/19 逐码全中 ✓ · 零行为修复源码核对 ✓ ·
变异矩阵 5 项闭环（M1 不可感知如实记录 + tsc 可感知）✓ · 台账结构与偏差入账 ✓。

Tester 提交清单：

1. `7b2731e42` `test(coordination): record round-1 tester audit, gates and inventory recheck for driver-ui-type-gate`
2. `794dfac50` `test(coordination): register driver-ui-type-gate-BUG-003 changed-lines coverage gap`
3. 本终局 commit `test(coordination): register bugs for driver-ui-type-gate`（T6-T8 + 偏差裁定 + 终判 + 状态行翻转）

# 修复轮记录（round-1 · Coder · 2026-09-23 12:24-12:29）

- **触发**：Tester 终判 `TEST_FAILED`，唯一 bug `driver-ui-type-gate-BUG-003`（改动行 :135/:155 零执行）。
- **写面**：仅 `SearchableInfoPanel.test.tsx` 追加 2 用例 + 本台账追加 + BUG-003 状态行/追加修复记录；
  生产文件、i18n、scripts、其他轨台账**零改动**；未碰任何禁止面。
- **修复单元**（一 commit 一单元；每单元先本文件局部绿 + 对应变异红 → 还原 → commit → 提交态串行三门禁复跑）：
  1. `3f2a12b04` `test(driver-ui): cover matched-stats search arm in SearchableInfoPanel`
     — 用例「结构化拉取后输入命中查询 → 断言 search 真臂 key `infoMatched` 渲染 + 假臂 key `infoEntries` 缺席」；
     变异 M-A（:135 key→`infoEntries`）红 `1 failed | 2 passed`，还原后绿。
  2. `95779d8d8` `test(driver-ui): cover no-match terminal arm in SearchableInfoPanel`
     — 用例「真值 rawInfo + 零命中查询 → 断言 `infoNoMatch` 渲染 + `infoSections` 缺席」；
     变异 M-B（:155 key→`infoHint`）红 `1 failed | 3 passed`，还原后绿。
- **偏离建议 1 处（有据）**：Tester 建议的「mock 返回 `sections: []`」路线无法命中终臂——`reconstructInfo([])`
  返回 `''` ⇒ `rawInfo=''` ⇒ :153 首项短路；改用「拉取成功后零命中过滤」达成同一终臂（实测 count>0，见下）。
- **覆盖复现（BUG-003 复现命令原样重跑）**：`branch@134 loc#0 line 135 count 2`（原 0）、
  `branch@153 loc#2 line 154 count 1`（原 0）——**两条 count>0，10/10 改动行全覆盖达成**；
  文件级 分支 32/47→**35/47**、行 35/46→36/46、函数 13/15→14/15、语句 37/49→38/49。
- **三门禁**（`95779d8d8` 提交态串行，逐字尾部见 BUG-003「自跑门禁尾部」节）：
  **tsc exit 0 · drivers vitest 52 文件 / 563 测试全绿 · boundaries 0 blocking / 4 advisory（与基线逐字一致，0 新增）**。
- **断言口径**：新增断言全部 i18n key（mock `t: key => key`），零英文文案字面量、零 `data-*` 需求、零新增 key；
  M1 维持 Tester 裁定不补。
- **状态**：`BUG-003` → `待复测（round-1 修复后）`；本轨待新 Tester 复测（覆盖 10/10 + 断言口径 + 三门禁数字）。
- **心跳**：2026-09-23 12:29。

# 复测记录（round-2 · Tester · 2026-09-23）

- **复测人**：全新实例 Tester `session-61319db9-6e5c-4f32-a35e-cad750b647dd`（未复用编码/修复轮任何会话）。
- **基线**：`795cf8fca`（修复轮终态），起手树净。
- **文件面审计** PASS：`git diff 4253e6cef..HEAD --stat` 恰 3 个允许文件（test +40 / BUG-003 +109 /
  progress +24），零生产/i18n/scripts/tsconfig/Cargo 差异；commit 序列与自报逐字一致。
- **BUG-003 覆盖核心** PASS：
  - `branch@134 loc#0 line 135 count 2`（原 0）、`branch@153 loc#2 line 154 count 1`（原 0），均 >0；
  - 文件级 **lines 36/46 · branches 35/47 · functions 14/15 · statements 38/49** —— 与自报逐字一致；
  - **10/10 改动行**（全量零计数扫描：12 个零 loc 无一落改动行，:127 col21 loading 臂非改动代码已豁免）；
  - 独立反向变异：**M-A** :135 → `1 failed | 3 passed` 红=用例 1（test:87）、**M-B** :155 →
    `1 failed | 3 passed` 红=用例 2（test:106），各恰 1 行 diff、还原后树净——双向闭环。
- **偏离裁定**（round-1 建议 `sections: []` vs Coder 改道）：**采纳 Coder 方案**——`reconstructInfo([])` ⇒
  `rawInfo=''` ⇒ :153 首项短路，建议路线不可达终臂；「拉取成功 + 零命中过滤」是唯一生产可达路径（源码级）。
- **断言纪律**：i18n key 绑定 100%、零英文文案字面量、零 `any`/`@ts-ignore`、invoke 参数形状一致 —— 通过；
  **但 mock 形状子项失败**：fixture `entries: [{key,value}]` 自称 wire shape，后端实为
  `ops_observe.rs:239 Vec<(String, String)>` ⇒ `[["redis_version","7.2.0"]]`，链路
  （`json_ok` → host `execute.rs` → `driverCommands` → `unwrapData` → `as` 断言）**零转换** ⇒
  立案 **`bugs/driver-ui-type-gate-BUG-004.md`**（含二选一修复方向，须协调者先裁决契约；跨轨
  `redis-kvbar-ui` 同型 fixture 仅提示不越权）。
- **三门禁**（提交态严格串行，逐字）：**tsc exit 0 · drivers vitest `52 passed (52)` / `563 passed (563)` ·
  boundaries `1465 file(s) scanned · 0 blocking · 4 advisory`**（4 条 advisory 行位与 round-1 逐字一致，0 新增）。
- **遗留快检**：tsconfig `__tests__` exclude 在（:28/:31）✓；`redis.monitor.refresh` 键仍未注册——报告制维持 ✓。
- **BUG-003 状态流**：`待复测（round-1 修复后）` → `待修复`（协议「任一验收项失败即退回」；核心本轮实测
  全绿，待 BUG-004 修复后随 round-3 重证覆盖）。复测循环计数 2/5。

## 终判（第 2 轮）

**READY_FOR_TEST（第 3 轮等待派发）** — `driver-ui-type-gate-BUG-004`（`info_filtered` 测试 mock 形状与
真实 IPC 不一致：对象数组 vs 后端二元组数组、链路零转换——验收序列第 4 项 mock 保真度子项失败）。

其余验收项全部通过：文件面审计 ✓ · BUG-003 覆盖核心 10/10 + line135/154 计数 2/1 ✓ · 独立双向变异闭环 ✓ ·
偏离裁定采纳 ✓ · 断言纪律 3/4 子项 ✓ · 三门禁逐字全绿 ✓ · 台账结构与 round-1 历史保留 ✓ · 遗留快检 status quo ✓。

Tester 提交：本终局 commit `test(coordination): record round-2 retest verdict for driver-ui-type-gate`
（BUG-004 立案 + BUG-003 复测记录与状态回退 + 本终判 + 状态行翻转）。


## 修复轮第 2 回合 (rescue · 2026-09-23)

**协调者裁决**: Option A — Backend → object entries.

**ops_observe.rs 改动**:
- Added `InfoEntry { key, value }` struct (~line 234)
- Changed `InfoSectionFiltered.entries` type from `Vec<(String, String)>` to `Vec<InfoEntry>`
- Updated construction: `filtered.push(InfoEntry { key: k.clone(), value: v.clone() })` (~line 283)
- Added serde test: `test_info_filtered_entries_serialize_as_objects` validates JSON serialization format

**门禁尾部（commit `f654751ad` 提交态，串行五门）**：

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
[check-driver-import-boundaries] R3 (advisory) src/locales/locales.test.ts:107: reaches into driver internals (packages/drivers/redis/locales)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:25: reaches into driver internals (packages/drivers/redis/ui/shared/meta)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:26: reaches into driver internals (packages/drivers/mongodb/ui/meta)
[check-driver-import-boundaries] R3 (advisory) src/windows/connection/DocumentConnectionView.tsx:25: reaches into driver internals (packages/drivers/mongodb/ui/mongodbFind)
[check-driver-import-boundaries] ok (1465 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
[boundaries exit: 0]
```

**Fixture comment correction**: SearchableInfoPanel.test.tsx comment updated to cite real contract (Rust InfoEntry struct).

**状态流转**:
BUG-003: `待复测（round-1 修复后）` → `待修复`（round-2 因 BUG-004 退回）→ **`待复测（round-2 覆盖核心已过，随 round-3 重证）`**
BUG-004: `待修复` → **`待复测（round-2 修复后，裁决 A 落地）`**


## 第 3 轮复测（门禁复跑 · Tester · 2026-09-23）

**执行**：严格串行四门，`CARGO_TARGET_DIR=/tmp/dz-tg-r3v3`。

门禁 1 `CARGO_TARGET_DIR=/tmp/dz-tg-r3v3 cargo test -p datazen-driver-redis --lib`:
```
test result: ok. 342 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

门禁 2 `npx tsc --noEmit`:
```
[tsc 无输出 · exit 0]
```

门禁 3 `npx vitest run --config vitest.drivers.config.ts`:
```
 Test Files  52 passed (52)
      Tests  563 passed (563)
```

门禁 4 `node scripts/check-driver-import-boundaries.mjs`:
```
[check-driver-import-boundaries] ok (1465 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
```

四门尾部与 round-2 期望逐字一致（门禁 1 为 +1 serde pin test 后的 342 基线）；无新增 advisory。
