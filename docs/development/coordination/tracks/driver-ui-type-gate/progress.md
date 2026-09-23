- 任务: 根 `tsc --noEmit` 打通驱动 UI 类型盲区（REDIS_WORKSPACE_UX P0 R 清单第 9 项）：tsconfig 纳入 `packages/drivers/*/ui` + 清零清点出的生产类型错误
- 状态: **READY_FOR_TEST**（三大门禁全绿、清单/修复/覆盖证据已录，等 Tester 复测）
- 编码 commit: `c2d1c1c25` → `e507cd74c` → `b0d486347` → 本台账 commit
- 测试 commit: —（Tester 由协调者另行指派）
- 合并 commit: —
- 代理: driver-ui-type-gate-coder（子代理，session 见协调者登记）
- 测试代理: —（全新实例，未复用编码代理）
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
