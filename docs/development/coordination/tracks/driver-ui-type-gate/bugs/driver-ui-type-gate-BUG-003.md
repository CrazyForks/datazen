# driver-ui-type-gate-BUG-003 · 新增特征测试未覆盖两处改动行：SearchableInfoPanel.tsx:135 / :155 的 `t()` 调用零执行

- **状态**：待复测（round-1 修复后）
- **严重度**：低（运行时行为无影响；验收口径阻断）
- **登记人**：Tester `session-61319db9-6e5c-4f32-a35e-cad750b647dd` · 2026-09-23
- **登记依据**：round-1 覆盖率复核（Tester 阶段 C，本轨无 80% 基线，从严口径「改动行必须全被测到」）
- **涉及文件**：
  - `packages/drivers/redis/ui/observe/SearchableInfoPanel.tsx`（改动行 :135、:155）
  - `packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx`（测试缺口所在）

## 描述（含量级）

`c2d1c1c25` 共修改 10 个存活行（7 处 `t()` 剥第二实参、`Button` import 行、以及 `e507cd74c` 的 :121 variant、:218 解构）。
逐行覆盖核验结果 **8/10 执行、2/10 零执行**：

1. **:135** — `? \`${filtered.matchedEntries} / ${filtered.totalEntries} ${t('redis.monitor.infoMatched')}\``：
   位于 stats 行三元的 **search-真臂**（三元起点 :134）。现有 2 个测试均不向搜索框输入任何文本 ⇒ 该臂
   执行次数 **0**，改动后的 `t('redis.monitor.infoMatched')` 从未运行。
2. **:155** — `{t('redis.monitor.infoNoMatch')}`：位于 `rawInfo && filtered.sections.length === 0 && (…)`
   渲染链**终臂**（:153-154）。测试 1 的 fixture 含 1 个 section（sections.length===0 恒 false）、
   测试 2 `rawInfo=''`（首项短路）⇒ 终臂执行次数 **0**，该改动行从未渲染。

量级：34 个改动点行位中 2 行（占本文件改动行的 20%、占全部 561 测试的 0 覆盖）在全套件下零执行；
其余 8 行均有正向计数（对照见下）。

## 重现步骤

1. 在 worktree 执行：
   `npx vitest run --config vitest.drivers.config.ts --coverage.enabled --coverage.reporter=json --coverage.reporter=json-summary --coverage.reporter=text`
2. 读取 `coverage/coverage-final.json`，取 key 以 `SearchableInfoPanel.tsx` 结尾的条目。
3. 在 `branchMap` 中查 `loc.start.line` = 134 的 cond-expr 与 = 153 的 binary-expr，看 `locations` 逐位计数：
   loc 指向 line 135 / line 154 的位置计数均为 0。
4. 交叉核对 text 报告该文件行：`75.51 | 68.08 | 86.66 | 76.08 | ...,71-82,107-113`。

## 实测错误日志与证据（逐字）

```
branch@127 cond-expr [0,4]
  loc#0 line 127 col 21 count 0     ← loading 真臂（未改动代码，不要求）
  loc#1 line 127 col 29 count 4     ← 改动 t() 已执行（正例）
branch@134 cond-expr [0,2]
  loc#0 line 135 col 14 count 0     ← BUG：改动行 :135 零执行
  loc#1 line 136 col 14 count 2     （对照：姊妹行 :136 已执行）
branch@153 binary-expr [4,2,0]
  loc#0 line 153 col 9 count 4
  loc#1 line 153 col 20 count 2
  loc#2 line 154 col 10 count 0     ← BUG：终臂未渲染，改动行 :155 零执行
```

文件级覆盖（同一跑）：

```
lines      35/46   = 76.08%
branches   32/47   = 68.08%
functions  13/15   = 86.66%
statements 37/49   = 75.51%
未覆盖语句行全集: 21-24, 71-82, 92, 107-113（均非本轨改动行；107/113 为 onChange/clear 未测）
```

## 影响范围

- **运行时**：无。`c2d1c1c25` 的剥参已由 i18n 源码证明零行为（`formatMessage` 只替换 `{token}`，7 条消息无 token）。
- **防回归**：stats 命中数行与空结果提示行没有任何用例钉住；后续对这两臂的重构可静默损坏而三门禁全绿。
- **验收**：阻断本轨 `TEST_DONE`——「改动行必须全被测到」为本轨明确硬口径（无 80% 数值基线，但从严执行）。
- **变异对照**：同一套件对 :121/:218 的修复变异能红（见 progress.md T6 矩阵），唯独这两行是覆盖盲区。

## 修复建议（供 Coder，Tester 不代改）

在 `SearchableInfoPanel.test.tsx` 补 2 个用例/交互：

1. 渲染后向搜索框 fire `input` 输入 fixture 内命中文本 → 断言 stats 行出现 matched/total 结构（用元素结构或
   `data-*` 定位，遵守零文案断言规则，勿钉英文常量）。
2. mock `redisCommandInvoke('redis','info_filtered',…)` 返回 `sections: []` → 断言 infoNoMatch 提示行渲染
   （按 i18n key / `data-*` 定位）。

修复后请重跑本文件「重现步骤」，确认 loc line 135 / line 154 计数均 > 0，并把结果追加为
`## 修复记录（round-1）` 块（只改上方 `- **状态**：` 行，勿改他人区段）。

## 修复记录（round-1）

### 修法

按「修复建议」在 `packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx` **追加 2 个用例**
（唯一代码改动面；生产文件 `SearchableInfoPanel.tsx` 零改动、i18n/en.ts 零改动、无新增 `data-*`、无新增 key）：

1. **`shows the matched/total stats arm once a search query is typed`**（驱动 line 135 / branch@134 loc#0）
   — mock 结构化 `info_filtered` 回复 → 点 refresh 拉取（`rawInfo` 真值）→ 向搜索框 fire input
   （`fireEvent.change`，值 `redis_version`，命中 fixture entry key）→ 断言 search-真臂 i18n key 渲染
   `expect(screen.getByText(/redis\.monitor\.infoMatched/)).toBeTruthy()` 且 search-假臂 key 缺席
   `expect(screen.queryByText(/redis\.monitor\.infoEntries/)).toBeNull()`。
2. **`renders the no-match notice when the query filters every section out`**（驱动 line 155 / branch@153 loc#2）
   — 同样拉取后输入零命中词 `no-such-token-anywhere` → `rawInfo` 仍真值、`filtered.sections.length === 0`
   命中终臂 → 断言
   `expect(screen.getByText('redis.monitor.infoNoMatch')).toBeTruthy()` 且
   `expect(screen.queryByText(/redis\.monitor\.infoSections/)).toBeNull()`（过滤后零 section）。

断言全部绑定 **i18n key**（mock `useI18n` 使 `t: (key) => key`），零英文文案字面量；
不采纳建议中「mock 返回 `sections: []`」的路线——`reconstructInfo([])` 返回 `''` ⇒ `rawInfo=''` ⇒
:153 首项短路，终臂仍不执行；改用「真值 `rawInfo` + 零命中过滤」命中该臂（机制等价于建议意图，实测 count>0）。

### commit

- `3f2a12b04` `test(driver-ui): cover matched-stats search arm in SearchableInfoPanel`（用例 1）
- `95779d8d8` `test(driver-ui): cover no-match terminal arm in SearchableInfoPanel`（用例 2）

一 commit 一单元：每用例先本文件局部绿 + 对应变异红（见下）→ 还原变异 → commit → 提交态串行三门禁复跑。

### 自跑门禁尾部（逐字，`95779d8d8` 提交态，串行 tsc → vitest → boundaries，2026-09-23 12:27）

门禁 1 `npx tsc --noEmit`：

```
[gate1 exit: 0]
```

（无任何错误输出。）

门禁 2 `npx vitest run --config vitest.drivers.config.ts`：

```
 ✓ packages/drivers/redis/ui/__tests__/settings.test.ts (2 tests) 2ms

 Test Files  52 passed (52)
      Tests  563 passed (563)
   Start at  12:27:18
   Duration  9.28s (transform 4.18s, setup 20.31s, import 3.23s, tests 5.93s, environment 25.82s)

[gate2 exit: 0]
```

门禁 3 `node scripts/check-driver-import-boundaries.mjs`：

```
[check-driver-import-boundaries] 2 allow-listed reference(s) skipped
[check-driver-import-boundaries] R3 (advisory) src/locales/locales.test.ts:107: reaches into driver internals (packages/drivers/redis/locales)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:25: reaches into driver internals (packages/drivers/redis/ui/shared/meta)
[check-driver-import-boundaries] R3 (advisory) src/test/driverUiSetup.ts:26: reaches into driver internals (packages/drivers/mongodb/ui/meta)
[check-driver-import-boundaries] R3 (advisory) src/windows/connection/DocumentConnectionView.tsx:25: reaches into driver internals (packages/drivers/mongodb/ui/mongodbFind)
[check-driver-import-boundaries] ok (1465 file(s) scanned · 0 blocking violation(s) · 4 advisory finding(s))
[gate3 exit: 0]
```

（4 条 R3 advisory 与基线逐字一致，0 新增；门禁数字：**tsc 0 · vitest 52/563 · boundaries 0 blocking / 4 advisory**。）

### 两条 count>0 实测证据（「重现步骤」原样重跑）

命令：`npx vitest run --config vitest.drivers.config.ts --coverage.enabled --coverage.reporter=json --coverage.reporter=json-summary --coverage.reporter=text`
→ `[exit 0]`（全套装 52 文件 / 563 测试全绿；Coverage enabled with v8）。
从 `coverage/coverage-final.json`（key 以 `observe/SearchableInfoPanel.tsx` 结尾）提取 branchMap：

```
branch@134 cond-expr [2,4]
  loc#0 line 135 count 2     ← 修复前 count 0，现 >0（BUG 消除）
  loc#1 line 136 count 4     （对照）
branch@153 binary-expr [10,6,1]
  loc#0 line 153 count 10
  loc#1 line 153 count 6
  loc#2 line 154 count 1     ← 修复前 count 0，现 >0（BUG 消除）
```

文件级覆盖（同一跑，`coverage-summary.json`）：

```
lines      36/46  = 78.26%   （修复前 35/46 = 76.08%）
branches   35/47  = 74.46%   （修复前 32/47 = 68.08%）
functions  14/15  = 93.33%   （修复前 13/15 = 86.66%）
statements 38/49  = 77.55%   （修复前 37/49 = 75.51%）
```

（v8 reporter 不输出 col，故仅列 line+count；审计口径「loc line 135 / line 154 计数均 > 0」已满足。
未覆盖语句行仍限 `21-24, 71-82, 92, 107-113` 非改动行区间。）

### 变异自检（对抗验证，均临时改生产文件后跑本测试文件，跑完 `git checkout` 还原、树净）

- **M-A（line 135）**：`t('redis.monitor.infoMatched')` → `t('redis.monitor.infoEntries')`
  ⇒ `1 failed | 2 passed`，红的正是用例 1（`× shows the matched/total stats arm once a search query is typed`）；
- **M-B（line 155）**：`t('redis.monitor.infoNoMatch')` → `t('redis.monitor.infoHint')`
  ⇒ `1 failed | 3 passed`，红的正是用例 2（`× renders the no-match notice when the query filters every section out`）；
- **M1（t() 第二实参）**：维持 Tester 既裁定「不可感知、防线=本轨 tsc 门禁」，不补测试、不扩范围。

### 状态流转

`待修复` → **`待复测（round-1 修复后）`**。等新 Tester 复核：(a) 改动行覆盖 10/10（line135/154 count>0）；
(b) 断言零英文文案字面量；(c) 三门禁数字 tsc 0 / 52·563 / 0 blocking+4 advisory。
