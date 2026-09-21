# Track: r-phase — Wave 4-B 全量回归与关账（本专项唯一 R 阶段）

- 分支: `feature/r-phase`（基准 = Wave 4-A `import-guard` 合并后的 `feat/driver-decoupling` HEAD）
- 角色: Tester（回归执行 + 关账记录）；发现缺陷只登记 `bugs.md`，不修代码
- 波次: Wave 4-B（本轨完成即整个「驱动↔宿主解耦」专项收口）

## 口径

Wave 1~4 中间各次合入只做「合并健全性校验」，完整回归统一在本轨跑一次。本轨输入 = 下方
【A 门禁】全量复跑 + 【B 各轨留待项】逐项闭环 + 【C 关账】文档与状态收口。

## A. 门禁基线（合并后主检出实测，2026-09-21 @ `8b66586e4`；Wave 4-A 二次合流后代码基准 = `b22b41ac8`，文档基准 = 本文件所在 HEAD）

| 命令 | 基线 |
| --- | --- |
| `node scripts/resolve-drivers.mjs --codegen-only --drivers=all` | exit 0（worktree 默认只 boot basic，任何驱动 UI 校验前必须先跑） |
| `npx tsc --noEmit -p tsconfig.json` | 0 error（`--drivers=all` 与 `--drivers=basic` 两档分别实测） |
| `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` | **27 files / 222 pass / 0 fail** |
| `npx vitest run --config vitest.drivers.config.ts` | **33 files / 241 pass / 0 fail** |
| `npx vitest run src packages/driver-sdk packages/ui` | **412 files / 4243 pass / 0 fail** |
| `npx vitest run scripts` | **23 files / 244 pass / 0 fail**（Wave 4-A 已并入：护栏 36 例，其中 BUG-008 跟踪域分类 5 例；原基线 22/208 已过时） |
| `node scripts/check-driver-import-boundaries.mjs` | exit 0（**必须在主检出跑**：worktree 缺外部树会假绿）；2 条夹具豁免命中 + 12 条 advisory（R1×2 superset / R2×6 editor-pro 单测 / R3×4 宿主引驱动内部） |
| `node scripts/check-id-terminology.mjs` / `check-module-layers.mjs` / `check-ci-docs-consistency.mjs` | 全绿 |
| `node scripts/i18n-sync-check.mjs` | 结构与 Wave 3 实测一致（**既有翻译债，非本专项回归**：宿主缺 1216 / 冗余 1650；redis 9 语言各缺 139、1 语言缺 72；CI 该步 `continue-on-error: true`） |
| `cargo test -p datazen --lib`（独立 `CARGO_TARGET_DIR`） | **1453 pass / 0 fail** |
| `npx vite build`（禁止裸 `pnpm build`，会自触发 install） | exit 0；main chunk 参考值 **1,605.12 kB / gzip 467.15 kB**（O-1 裁定「全 10 语言注册」后量级，勿因体积回退） |

任何数字与基线不符都必须在报告里点名解释（新增用例数？回归？），不得默写。

**硬性口径（Wave 4-A 合流门禁刚踩过的坑）**：worktree 里**不存在** gitignored 的外部树
（`packages/drivers/{kiwi,olap,superset}` 这类 `source: git` 驱动、`packages/pro-extensions/*` 独立 git 仓），
CI 又用 `--drivers=basic` 且 Guard 先于 codegen，所以**任何全仓静态检查必须在主检出复跑一次**才算数，
worktree 绿不构成证据。只读脚本用 `--root=` 指主检出即可（`check-driver-import-boundaries.mjs` 已支持）。

## B. 各轨留待 R 回归项（逐项闭环，标注 PASSED / BLOCKED-需人工 / N/A）

| 来源轨 | 项 | 落点与判定 |
| --- | --- | --- |
| cn-to-ui | redis 工作区视觉回归 | `SearchModeTabs` 激活/非激活高亮、`KeyTreeList` 行 hover、`RedisConsole` `CompletionPopup` 弹层样式（`cn()` 换源后类名合并等价）→ GUI 项，见「C. E2E/GUI 处置」 |
| cap-bridge | redis 键树右键真实弹出 | 连接真实 Redis → key-browser 右键 → Web context menu 在光标处弹出（`showNativeContextMenu` → `bindContextMenuBridge` 新链路）；弹出后移动/按下指针可取消（懒挂载语义）；Esc / 点击外部关闭 → GUI 项 |
| cap-bridge | 危险操作确认对话框真实渲染 | Safe Mode 开 → 写命令触发 `useBoundConfirmDialog` → 宿主 `useConfirmDialog` 弹窗可见、确认/取消行为正确、gate 拦截与放行结果正确 → GUI 项 |
| i18n-core | 设置页切语言 → redis 驱动 UI 实时刷新 | 无需重启窗口，Keys 面板 / ConnectionWizard 文案随 zh-CN/en 切换 → GUI 项 |
| i18n-core | 设置页切语言 → SQL Editor Pro 文案实时刷新 | editor-pro 直连 `@datazen/ui` 单例；需 Pro webdriver 构建（stage pro EP）→ GUI 项 + 依赖 editor-pro 子仓（`c60f7fc` 尚未 push，见开放项） |
| i18n-drivers R-1 | zh-CN 下 redis 工作台/键浏览器/控制台为中文，切回 en 立即生效；mongodb 文档视图 `mongo.*` | GUI 项 |
| i18n-drivers R-2 | `--drivers=basic` 与 `--drivers=all` 两档构建无 raw-key 泄漏 | 可脚本化：两档分别 `npx tsc` + `npx vite build` + codegen 产物核对；raw-key 泄漏判定属 GUI |
| i18n-drivers R-3 | 三套 vitest 复跑一致 | 即本表 A 门禁，直接引用 |
| i18n-drivers R-4 | `i18n-sync-check` 输出与 Wave 3 实测逐项一致 | A 门禁覆盖；翻译回合后转 exit 0 属**另立回合**，不在本轨 |
| i18n-drivers R-5 | Pro/EP 与 wapp 自带词条时 `registerTranslations` 无前缀冲突 | 现状无自带词条 → 记 N/A，并在契约文档留观察项 |
| i18n-drivers R-6（O-2） | `basic` 档下 `DocumentConnectionView` 20 处 `t('mongo.*')` 是否 raw key | 既有耦合（非本专项引入），GUI 取证一次即可 |
| i18n-drivers R-7（O-3） | 驱动 UI 依赖宿主 key（`common.*` 32 / `newConn.*` 22 / `sqlserver.*` 4）在换源后仍命中；宿主字典在渲染前注册完毕 | 单测层已证明；GUI 走查新建连接表单（redis / sqlserver）与工作台菜单文案 |
| i18n-drivers R-8（O-1） | 保留 10 语言档：补「扩展经 `registerLocale()` 引入第 3 语言时驱动词条命中」的手工验证 | 可用 `packages/ui` 单测证明（`registerTranslations` + 第三 locale 快照），无需 GUI |
| decouple-docs | ②⑤⑥ 文档回扫：2.6 落实名、2.1.2/2.7 基线数字改「生产码 0 / 夹具 2」、3 条 Nit | **Wave 4-A 已并入其范围第 5 条**；本轨只做抽验（文档内路径/符号逐条 Read 核实，零失配） |
| import-guard | 新护栏纳入全量回归清单 + 注入/还原自证复跑 | A 门禁 + 本轨独立复做一次「注入红 → 还原绿」。〔Wave 4-A 关账时 `scripts/run-regression.sh` 已把护栏加为**步骤 1/7**（秒级失败即停，放在 10 分钟级 cargo 之前），契约 2.6「本地等价」行同步登记第 5 个接入点；R 阶段只需复跑该脚本确认编号与耗时口径，不必再接线〕 |
| fix-redis-tests / types-to-sdk | 无 E2E | N/A（仅门禁数字对齐） |

## C. E2E / GUI 项处置（协调者裁定）

专项期间**不在子代理内跑真实 `pnpm e2e` / `pnpm tauri:build:webdriver`**（构建代价大、且需真实 Redis
与 GUI 会话）。本轨职责：

1. 能单测化的留待项（R-8、护栏有效性、字典注册时序）全部单测化闭环。
2. 纯 GUI/手工项**逐条写成可照做的验收清单**（前置条件 + 点击路径 + 判定），汇总进本文件
   「人工验收清单」小节，交由用户在本地 GUI 逐项打勾。
3. 若用户明确要求补自动化，另立轨道（不在本专项关账范围）。

## 禁止事项

- 只测不修：缺陷一律登记 `tracks/r-phase/bugs.md`（状态 `待修复`），并停止关账等我裁定。
- 不触碰其它轨的 `progress.md` / `bugs.md`；不修改 `hub.md`（协调者专用）。
- 不提交 codegen 产物（`src/extensions/generated*.ts`、`src-tauri/src/driver_init.rs`、
  `src-tauri/capabilities/default.json`）、`Cargo.lock`；不动 `src-tauri/**`、`packages/pro-extensions/**`。
- 禁止 `pnpm install`、裸 `pnpm build`、真实 `pnpm e2e`；搜索用 Grep 工具；cargo 用独立 `CARGO_TARGET_DIR`。

## 验收标准

1. 【A 门禁】全部复跑，逐项给出真实命令与真实输出，与基线差异全部解释清楚。
2. 【B 表】每一行有明确终态（PASSED / N/A + 理由 / 转人工清单）。
3. 独立复做 Wave 4-A 的「注入 R1（`from` + `vi.mock`）与 R2 → 红并点名文件:行 → 还原 → 绿」，
   结束时 `git status` 干净。
4. 抽查解耦契约达成：`packages/drivers/*/ui/**` 内说明符字面量指向宿主 `src/` 的命中数
   = 豁免 2 条（且仅这 2 条）；`packages/**`（除 `packages/ui/src/i18n.ts`）内 `setLocale(` 调用数 = 0；
   宿主唯一调用点在 `src/lib/localeSync.ts`。
5. 文档抽验零失配（路径/符号/行号/数字，含 Wave 4-A 回扫后的 2.1.2 / 2.6 / 2.7）。
6. 输出「人工验收清单」小节（≥ 上表全部 GUI 项，含前置条件与判定），供用户本地打勾。
7. 全轨 Bug 闭环或明确移交；返回 `TEST_DONE(PASSED)` 或 `ESCALATED` + 未闭环清单。

## 状态

- [x] 派发 Tester → 回归执行（协调者已按任务书派出独立 Tester 实例，worktree `.worktrees/datazen-r-phase` @ `feature/r-phase`）
- [ ] TEST_DONE / 关账汇报

## 执行记录

### 0. 实例交接与证据口径（Wave 4-B 由两个 Tester 实例接力完成）

- **前任实例**（2026-09-21 10:22~10:55）：跑完 A 门禁主体，产物未提交；在收尾阶段网络中断静默死亡。
  遗留两份未提交成果——`packages/ui/src/__tests__/i18n.test.tsx`（R-8 单测，+128 行）与
  `tracks/r-phase/bugs.md`（BUG-001~004）。其真实运行日志保留在 `/tmp/rphase-logs/`。
- **收尾实例（本实例）**（2026-09-21 11:11 接手）：先 `pwd` 自检（worktree `.worktrees/datazen-r-phase`
  @ `feature/r-phase` HEAD `20393084e`）；独立复跑全部秒级/分钟级门禁项并逐条留原文；前任的 R-8 单测
  逐行复核后保留；长跑项（`run-regression.sh` 全量）引用前任日志，其余（A3/A4/A5/cargo/vite 两档）
  **本实例全量重跑**，不转抄。本实例日志：`/tmp/rphase-logs-mine/`。
- 本轨全程**只测不修**：未改任何业务代码与契约文档；仅新增（接续前任）R-8 单测、`bugs.md` 与本记录。
- 复跑结束时 `git status` 只剩两份待提交产物，按纪律分三步提交（`test/` 单测 + `bugs.md` → 本「执行记录」
  → 「状态」置位，见 `git log feature/r-phase` 顶部三条）；`Cargo.lock` 的注入残留已还原
  （`git diff --quiet Cargo.lock` 通过）；无探针残留（注入/还原自证见 A-14）。

### 1. A 门禁逐项实测（「自己跑」与「引用前任日志」严格分列）

| # | 门禁项 | 本实例独立复跑（真实输出） | 前任日志（引用出处） | 判定 |
| --- | --- | --- | --- | --- |
| A-1 | `node scripts/resolve-drivers.mjs --codegen-only --drivers=all` | 收尾态 exit 0：`.driver-features.json` = **15 驱动**，产出 `generated.ts` / `driver_init.rs` | `R2-codegen-basic.log` / `R2-codegen-all.log` 均 exit 0 | PASSED |
| A-2 | `npx tsc --noEmit -p tsconfig.json` | **all 档 exit 0**（11:15:27，无输出）；basic 档见前任（本实例未重跑 basic tsc） | `R2a-tsc-basic.log` / `R2b-tsc-all.log` 均 0 字节 = 0 error | PASSED |
| A-3 | `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` | **27 files / 222 pass / 0 fail**（11:17:01，exit 0） | `A3-vitest-redis-ui.log` 27/222 | PASSED |
| A-4 | `npx vitest run --config vitest.drivers.config.ts` | **33 files / 241 pass / 0 fail**（11:15:38，exit 0） | `A4-final.log` 33/241 | PASSED |
| A-5 | `npx vitest run src packages/driver-sdk packages/ui` | **412 files / 4247 pass / 0 fail**（11:13:10~11:14:2x，exit 0；全量重跑） | `A5-final.log` 412/4247 | PASSED |
| A-6 | `npx vitest run scripts` | **23 files / 244 pass / 0 fail**（11:15:34，exit 0） | `A6-vitest-scripts.log` 23/244 | PASSED |
| A-7 | `node scripts/check-driver-import-boundaries.mjs`（worktree） | exit 0 · **1403 files / 0 blocking / 4 advisory**（本轮共跑 5 次：3 次常态绿逐次一致 + 2 次注入红，见 A-14） | `A7-guard-worktree.log` 同 | PASSED |
| A-8 | `node scripts/check-driver-import-boundaries.mjs --root=<主检出>` | exit 0 · **1489 files / 0 blocking / 12 advisory**（12 条逐条点名见 §1.2） | `A7b-guard-maincheckout.log` 同 | PASSED |
| A-9 | `check-id-terminology` / `check-module-layers` / `check-ci-docs-consistency` | exit 0 / exit 0 / exit 0（11:14:11，1719 files / 3 rules / 11 ids） | `A8*.log` 同 | PASSED |
| A-10 | `cargo test -p datazen --lib`（`with-driver-inject --drivers=basic` + HOME 沙箱 + `CARGO_TARGET_DIR=/tmp/datazen-rphase-target`） | **1453 passed / 0 failed / 3 ignored**，exit 0，dur=**15s**（target 预热；无复跑触发） | `cargo-lib.log` / `cargo-runner.out`：exit 0 / 2m19s / 1453/0/3（前任首次冷编译） | PASSED |
| A-11 | `node scripts/i18n-sync-check.mjs` | **exit 1**；输出与前任日志**逐字节一致**（`diff` 从第 2 行起 IDENTICAL）：`Summary: 2400 missing key(s), 1650 stale translation(s) across 8 host locales; 0 driver pack issue(s) across 2 driver locale pack(s).` | `A9-i18n-sync-check.log` 同 | PASSED（既有翻译债，非本专项回归；CI 该步 `continue-on-error: true`） |
| A-12 | `npx vite build`（两档） | **basic：1,574.66 kB / gzip 460.61 kB**（`main-iWjiAdIb.js`）；**all：1,605.12 kB / gzip 467.15 kB**（`main-rSNK-HW9.js`）；均 exit 0，`built in 4.8s / 4.6s` | `R2a-vite-basic.log` / `R2b-vite-all.log`：同文件名 hash、同数字 | PASSED |
| A-13 | `bash scripts/run-regression.sh`（合并前全量，10 分钟级） | 本实例未重跑（口径：步骤 1/7 护栏已在最前，其余步骤与 A-2~A-12 重叠） | `regression2.log`：**7/7 全绿**（1 护栏 0m01s / 2 cargo 0m17s / 3 vitest 1m12s / 4 驱动 vitest 0m06s / 5 ID 0m01s / 6 tsc 0m07s / 7 vite 0m05s，`全量回归门禁通过 ✔`）；`regression.log` 首轮 exit=101 = BUG-003 | PASSED（编号与耗时口径按前任日志确认） |
| A-14 | 护栏有效性自证（注入红 → 还原绿） | **本实例独立复做**（`/tmp/rphase-logs-mine/R5-injection-redgreen.log`）：注入 R1 `from`（`settingsHelpers.ts:19`）+ R1 `vi.mock`（`settings.test.ts:20`）+ R2 `setLocale(`（`connectionWizardValidate.ts:78`）→ **exit 1，3 条违规逐条点名文件:行**；`cp` 还原后 `git diff --stat` 对 3 文件为空 → **exit 0 / 1403 files / 0 blocking / 4 advisory** | 前任 A7 系列只含常态绿测，无注入自证日志 | PASSED |
| A-15 | 解耦契约抽查（验收标准 4） | `packages/drivers/*/ui/**` 指向宿主 `src/` 的说明符 = **恰好 2 条**（`redisKeyWebContextMenu.test.tsx:5,9`，与 `ALLOWLIST` 两条三元组逐字一致）；`packages/**` 内 `setLocale(` 仅命中 `R2_FILE_CARVEOUTS` 两文件；宿主生产码调用点 = `src/lib/localeSync.ts:20,24` + `src/locales/index.ts:78,82`（§2.4.2 明文适配器）→ 口径差异已登记 BUG-006 | —（本实例首次执行） | PASSED（口径校正见 BUG-006） |

#### 1.1 与基线数字的差异解释（逐条）

1. **A-5：4243 → 4247（+4）** —— 前任新增的 R-8 单测块恰好 4 个 `it`（本实例跑该文件 = 10 tests，其中既有 6 + 新增 4），
   412 文件数不变。**非回归**。
2. **A-12：1,605.12 vs 1,574.66** —— 两者是**同一 worktree 的两个 codegen 档位**，与外部树无关：
   `--drivers=basic`（postgres/mysql/sqlite/redis 4 驱动）= 1,574.66/460.61（`main-iWjiAdIb.js`）；
   `--drivers=all`（15 驱动）= 1,605.12/467.15（`main-rSNK-HW9.js`）。本实例两档均重跑，产物**文件名 hash 与前任日志逐字相同**
   ⇒ 结果确定可复现；任务书基线 1,605.12 是 all 档（O-1 十语言装配的对照点），
   前任 `regression2.log` 步骤 7 的 1,574.66 是承接 cargo 注入后的 basic 档。**非回归**。
3. **A-6：脚本套件 23 files / 244**（任务书旧基线 22/208 已由 Wave 4-A 更新）—— 无差异。
4. **A-10：15s vs 2m19s** —— 本实例复用前任预热好的 `/tmp/datazen-rphase-target`（4.1G），非冷编译；用例数完全一致。
5. **A-11：exit 1** —— 既有翻译债（宿主 8 语言缺 2400 / 冗余 1650；redis 缺 139×9 语言 + 72×1），
   与 Wave 3 实测逐项一致（本实例 `diff` 逐字节比对通过）。**非回归**。

#### 1.2 主检出 12 条 advisory 逐条点名（本实例实测，exit 0）

```
R1  packages/drivers/superset/ui/SupersetConnectionFields.tsx:3   → host src/hooks/useI18n   （外部树漂移）
R1  packages/drivers/superset/ui/SupersetSchemaTree.tsx:19        → host src/hooks/useI18n   （外部树漂移）
R2  packages/pro-extensions/sql-editor-pro/src/intentions/__tests__/intentionCodeActions.test.ts:119
R2  packages/pro-extensions/sql-editor-pro/src/intentions/__tests__/intentionCodeActions.test.ts:141
R2  packages/pro-extensions/sql-editor-pro/src/locales/__tests__/locales.test.ts:28
R2  packages/pro-extensions/sql-editor-pro/src/locales/__tests__/locales.test.ts:32
R2  packages/pro-extensions/sql-editor-pro/src/locales/__tests__/locales.test.ts:36
R2  packages/pro-extensions/sql-editor-pro/src/locales/__tests__/locales.test.ts:39
R3  src/locales/locales.test.ts:107
R3  src/test/driverUiSetup.ts:25
R3  src/test/driverUiSetup.ts:26
R3  src/windows/connection/DocumentConnectionView.tsx:25
```

- R1×2 + R2×6 全部落在 gitignored 外部树（superset git 驱动、editor-pro 独立仓）⇒ 降级 advisory，由各自仓库整改；
- R3×4 为本仓跟踪代码，规则 `blocking: false`（协调者裁定前只报告）；与契约 §2.6 / §2.7 登记逐条一致。
- worktree 只有 4 条（R3×4），因为外部树不在此检出 —— 与「必须回主检出复跑才算数」的口径一致。

### 2. B 表逐行终态

| 来源轨 | 项 | 终态 |
| --- | --- | --- |
| cn-to-ui | redis 工作区视觉回归 | **转人工（GUI-1）**。等价性已由「单一实现」背书：`src/lib/cn.ts` 全文 = `export { cn } from '@datazen/ui'`，`packages/ui/src/cn.ts` = `twMerge(clsx(inputs))` ⇒ 宿主与驱动调的是同一函数，不需要新单测；剩余为纯视觉确认。 |
| cap-bridge | redis 键树右键真实弹出 | **转人工（GUI-2）** |
| cap-bridge | 危险操作确认对话框真实渲染 | **转人工（GUI-3）** |
| i18n-core | 设置页切语言 → redis 驱动 UI 实时刷新 | **转人工（GUI-4）** |
| i18n-core | 设置页切语言 → SQL Editor Pro 文案实时刷新 | **转人工（GUI-5）**（需 Pro 构建 + editor-pro 子仓 `c60f7fc` 本地存在，尚未 push） |
| i18n-drivers R-1 | zh-CN redis 中文 / mongodb `mongo.*` | **转人工（GUI-6）** |
| i18n-drivers R-2 | 两档构建无 raw-key 泄漏 | **脚本部分 PASSED**（tsc 0 error ×2 档 / vite exit 0 ×2 档 / codegen 15 与 4 驱动产物核对），**运行时 raw-key 判定转人工（GUI-7）** |
| i18n-drivers R-3 | 三套 vitest 复跑一致 | **PASSED**（27/222、33/241、412/4247，本实例独立复跑逐项一致） |
| i18n-drivers R-4 | `i18n-sync-check` 输出与 Wave 3 一致 | **PASSED**（逐字节 `diff` 一致；exit 1 属既有翻译债，不属本轨） |
| i18n-drivers R-5 | Pro/EP 与 wapp 自带词条前缀冲突 | **改判**：wapp 侧 N/A（`registerTranslations` 全仓 0 命中）；**Pro EP 侧实测已自带 26 key 且 5 个 `query.*` 与宿主同名（3 异值 / 2 同值 en，zh-CN 5 全异值）→ 观察项 + 待裁定（BUG-004，移交 editor-pro 仓）** |
| i18n-drivers R-6（O-2） | `DocumentConnectionView` 的 `mongo.*` | **转人工（GUI-6）** + 静态口径已固化：`t('mongo.*')` = **21 次出现 / 15 个不同 key**；同文件另有 `common.*`×5（loading×3/save/delete）、`query.*`×3、`connWin.*`×1（本实例逐行复现协调者口径） |
| i18n-drivers R-7（O-3） | 驱动 UI 依赖宿主 key 换源后命中 | **PASSED（静态）** + **转人工（GUI-8）**。口径 = `packages/drivers/*/ui/**`（path 驱动）：`common.*` **32/7**、`newConn.*` **22/10**、`sqlserver.*` **4/4**；若口径放宽到含 `e2e/**`，redis e2e helper 再加 `common.*`×1、`newConn.*`×4；主检出多出的 `common.*`+2 / `newConn.*`+5 全部来自 superset git 驱动 clone（`SupersetSchemaTree.tsx:141`×2、`SupersetConnectionFields.tsx:13,17,18,41,53`）⇒ **非回归** |
| i18n-drivers R-8（O-1） | 扩展引入第 3 语言时驱动词条命中 | **PASSED**：4 例新单测（独立复跑 `packages/ui/src/__tests__/i18n.test.tsx` = **10/10**，全量口径 A-5 随之 4247）。落点说明：必须并入 R2 豁免文件 `i18n.test.tsx`——护栏 R2 的豁免是**文件级精确清单**，新建 `packages/**` 测试文件调用 `setLocale()` 会直接红。 |
| decouple-docs | ②⑤⑥ 文档回扫抽验 | **PASSED（抽验执行）**：逐条复核 §2.1.1 / §2.1.2 / §2.4.2 / §2.4.3 / §2.4.4 / §2.6 / §2.7 的路径·符号·行号·数字（含 `:260`/`:141`/`:279`/`:295`、`index.ts:23-31`、`i18n.ts:69`、`localeSync.ts:20,24`、`locales/index.ts:78,82`、`builtinLocales.ts:9,26-29`、`i18n-sync-check.mjs:36`、`ALLOWLIST` 2 条三元组、`run-regression.sh` 步骤 1/7、`ci-local.sh:64` 3.3/11、`ci.yml:67`）——**发现并登记 2 处失配（BUG-001/002）**，故验收标准 5 的「零失配」字面**未达成**，需协调者派修文档（见 §4）。 |
| import-guard | 新护栏纳入全量回归 + 注入/还原自证 | **PASSED**：① 编号/耗时口径 = `regression2.log` 7/7（护栏为步骤 **1/7**，秒级失败即停，实测 0m01s）；② 本实例独立复做 3 探针红→还原绿（A-14）；③ 主检出 12 条 advisory 逐条点名（§1.2）。 |
| fix-redis-tests / types-to-sdk | 无 E2E | **N/A**（仅门禁数字对齐：A-3 27/222 与 A-4 33/241 独立复跑一致） |

### 3. 人工验收清单（GUI，交用户在本地逐项打勾）

> 通用前置：源码构建一律走 `pnpm tauri:dev`（默认 basic = postgres/mysql/sqlite/redis）。
> 需要 mongodb / sqlserver / superset 时用 `pnpm tauri:dev --drivers=all`（仍为 Community 版）。
> 语言下拉只含宿主已接线的 `en` / `zh-CN`（`BUILTIN_LOCALES`）；不重启窗口、不手动刷新。
> 每项判定中若出现 `xxx.yyy` 形态的 raw key、或切语言后文案不跟随，即为**不通过**。

| ID | 项（来源轨） | 前置条件 | 点击路径 | 判定标准 |
| --- | --- | --- | --- | --- |
| GUI-1 | redis 工作区视觉回归（cn-to-ui） | `pnpm tauri:dev` + 真实 Redis 连接（看 hover/激活态需有键） | 连接树 → redis 连接 → 工作台 → **Items** 标签（`data-testid="redis-tab-items"`）→ ① 顶部搜索模式 tab（`redis-search-mode-tabs` 的 key/value/all）切换；② 键树列表行 hover；③ 切 **Console** 标签（`redis-tab-console`）→ 输入 `GE` 触发补全弹层 | ① 激活 tab 高亮/字重与非激活可辨、非激活 hover 变亮；② 键树行 hover 背景正常（无塌陷/无重复类异常）；③ 补全弹层边框/阴影/选中项高亮正常；④ DevTools 无 React className 相关告警。等价性已由单一实现背书，本项只看视觉。 |
| GUI-2 | redis 键树右键真实弹出（cap-bridge） | `pnpm tauri:dev` + **真实 Redis**（键树需有键） | 工作台 → 键树 → 在某个键上**点右键** | ① Web 右键菜单在**光标处**弹出且不溢出窗口（`showNativeContextMenu` → `bindContextMenuBridge` 新链路）；② 弹出后**移动鼠标或按下指针**→ 菜单取消（懒挂载语义）；③ `Esc` 或点击菜单外部 → 关闭；④ 全程无 Tauri 原生系统菜单样式出现。 |
| GUI-3 | 危险操作确认对话框（cap-bridge） | `pnpm tauri:dev` + **真实 Redis** | ① Settings → **Behavior** → 打开 **Safe Mode**（`SettingsContent.tsx:621`）→ 回工作台 → 删除一个键；② 关闭 Safe Mode → 再删除一个键；③ 切 Console 执行 `SET k v` | ① Safe Mode 打开时写操作先被 gate 拦截，弹提示（`redis.safeMode.blocked`）；② 关闭后删除弹**宿主 ConfirmDialog**（`redis.danger.confirmTitle`/`…Message`）：**取消** → 不执行、键仍在；**确认** → 键被删除；③ Console 写命令同样弹出危险确认（Console-only 语义，见 `useRedisGate.ts`）。 |
| GUI-4 | 切语言 → redis 驱动 UI 实时刷新（i18n-core） | `pnpm tauri:dev` + 一个 redis 连接（文案可见即可） | Settings → **General** → **Language** 改 `简体中文` → 回 redis 工作台 / 连接向导 / 键浏览器；再切回 `English` | 不重启、不刷新即整体变中文/英文；四个 tab 标签、键浏览器、批量删除按钮均为译文而非 raw key；切回 en 立即复原。 |
| GUI-5 | 切语言 → SQL Editor Pro 文案实时刷新（i18n-core） | **Pro 构建**：`pnpm tauri:dev:pro` 或 `pnpm tauri:build:pro`；**且**本地存在 `packages/pro-extensions/sql-editor-pro` 子仓（commit `c60f7fc`，尚未 push，`--codegen-only` 时不会自动克隆） | SQL 编辑器 → Settings → General → Language 切 `中文`/`English` → 看 EP 文案：绑定参数面板（`query.params`）、参数历史项（`query.editor.param.*`）、补全/意图「快速操作」（`query.intention.*`） | EP 文案随语言即时刷新。**顺带观察 BUG-004**：`query.params` 等 5 个 key 宿主/EP 同名，Pro 版取 EP 文案（如 `参数`）而 Community 版取宿主文案（`绑定参数`）⇒ 两版本不一致即为覆盖生效证据（当前宿主 0 消费方，无用户可见后果）。 |
| GUI-6 | zh-CN 下 redis / mongodb 驱动 UI 中文（i18n-drivers R-1 / R-6） | `pnpm tauri:dev --drivers=all` + **真实 Redis + 真实 MongoDB** | Settings → Language = `简体中文` → ① redis 工作台四 tab（Items/Console/Monitor/Pub-Sub）+ 键浏览器 + 控制台；② mongodb 连接 → 库/集合树 → **Documents** 文档视图（`DocumentConnectionView.tsx`，其 `t('mongo.*')` 共 21 处/15 key） | ① redis 侧全中文无 raw key；② mongodb 文档视图 21 处 mongo.* 全为中文（`mongo.noIdHint`/`documents`/`collections`/`insert`/`queryHint` 等）；③ 切回 `English` 立即生效。 |
| GUI-7 | 两档构建 raw-key 泄漏走查（i18n-drivers R-2 运行时侧） | 分别以 `pnpm tauri:dev`（basic）与 `pnpm tauri:dev --drivers=all` 起 | 每档随机走查 ≥5 个界面：连接页 / 新建连接向导 / 工作台 / 控制台 / 设置，并在 zh-CN 与 en 间切换 | 界面不出现 `xxx.yyy` 形态 raw key；切语言后所有已渲染文案跟随。（脚本侧已验：tsc 0 error ×2 档、vite exit 0 ×2 档、codegen 产物 15/4 驱动一致。） |
| GUI-8 | 驱动 UI 复用宿主 key 的显示正确性（i18n-drivers R-7） | `pnpm tauri:dev --drivers=all` | ① 新建连接 → 选 **redis**：Host / Port / Username / Password / 数据库索引 标签（`newConn.*`）；② 新建连接 → 选 **SQL Server**：Host / Port / Database / 用户名 / 密码 / 加密下拉（`sqlserver.encryption`、`sslNone/sslPrefer/sslRequire`）；③ redis 键树右键菜单与批量删除确认里的 Cancel/Delete/Confirm（`common.*`） | 以上全部显示正常英/中文（不是 raw key）⇒ 宿主字典在驱动 UI 渲染前已完成注册；切 zh-CN 后同样为正常译文。 |
| GUI-9 | 新增连接表单整体语言一致性（GUI-8 的扩展观察） | 同 GUI-8 | 在 zh-CN 下依次切换数据库类型（redis → sqlserver → mongodb）看表单标签 | 切换类型后标签无残留英文/无 raw key（验证驱动词条按装载注册、宿主词条已接线）。 |

### 4. 缺陷处置（本轨只登记，不修）

| Bug | 严重度 | 是否需 Coder | 处置建议 |
| --- | --- | --- | --- |
| BUG-001 契约 §2.4.1/§2.1.1 少登记第 6 个 i18n API | 低 | 否（文档，1 处两句） | 派 Coder/docs 改契约「仅五个 → 仅六个」并补签名；否则评审按字面会把在用 API 判成越界 |
| BUG-002 契约 §2.4.3「0 命中」残留枚举不全 | 低 | 择一 | 措辞收敛为「生产码 0 命中」+ 登记护栏 `:94`；或删掉已不存在的 skip-list 条目（后者才是代码改动） |
| BUG-003 干净检出 cargo 编译失败（builtin-ep 资源目录缺失） | 中 | **是**（构建脚本/回归脚本） | 三选一（建议 1：`resolve-drivers` 无条件 `mkdir -p`）；注意 BUG-005 的单测顺带创建会掩蔽首跑失败 |
| BUG-004 Pro EP 自带词条与宿主共用 `query.*`（R-5 前提失实） | 低 | 否（观察项 + 外部仓） | 任务书 R-5 改判（本记录已改）；契约 §2.4.4 补 EP/wapp 前缀要求或明确豁免；移交 editor-pro 仓裁定前缀 |
| BUG-005 `resolve-pro.test.ts` 读写真实仓库路径（删 Pro staging、改写 `generated-pro.ts`） | 中 | **是**（测试隔离） | 把落点改到 `mkdtempSync`（`stageDir`/`proPath` 已具备覆写能力），否则本地 Pro staging 会被静默删除 |
| BUG-006 验收标准 4 静态口径与 §2.4.2 不一致 | 低 | 否（任务书口径） | 按本记录 §1 A-15 的精确口径改写（契约无错） |

### 5. 待协调者裁定

1. **BUG-001/002/006 均为「文档/口径」类**：是否派一个 docs 小回合统一修正（含任务书 R-5 改判与验收标准 4 改写）？
2. **BUG-003 与 BUG-005 是同一片区域的两面**（`builtin-ep` 资源目录）：建议一并派 Coder，先做「测试重定向到 tmp」再做「构建前置无条件补齐」，避免前者继续掩蔽后者。
3. **R-5 / BUG-004**：Pro EP 的 5 个 `query.*` 同名 key 是否要求 editor-pro 仓改 `pro.*` 前缀（属外部仓，需其自身 commit）。
4. **GUI-5 可复现性**：editor-pro 子仓 `c60f7fc` 未 push，Pro 侧 GUI 项只能在有该子仓的机器上验收。
5. 既有翻译债（A-11）是否另立翻译回合（转 exit 0）—— 不在本轨范围。

## 开放项（等用户，不阻塞本轨）

- **外部仓漂移移交项**（BUG-008 裁定为 advisory，不在本专项修复）：`packages/drivers/superset`（git driver，
  独立仓库）仍有 2 处宿主 `src/hooks/useI18n` 引用（`ui/SupersetConnectionFields.tsx:3`、
  `ui/SupersetSchemaTree.tsx:19`），需在其**自身仓库**换源 `@datazen/ui`；`sql-editor-pro` 的 6 处
  `setLocale` 是其单测合法用法，暂不动。R 阶段只核对这两项仍如实出现在 advisory 输出与契约文档里。
- editor-pro 子仓 commit `c60f7fc` 已本地提交但**未 push**。
- **Pro EP 词条命名空间移交项（BUG-004，Wave 4-B 新发现）**：`packages/pro-extensions/sql-editor-pro` 自带 26 个
  `query.*` key，其中 5 个与宿主同名（en 3 异值 / zh-CN 5 全异值；宿主当前 0 消费方）；按
  `registerTranslations` 后写覆盖语义，装 Pro 的构建取 EP 文案、Community 取宿主文案 ⇒ 需在 editor-pro
  自身仓库裁定是否改 `pro.*` 前缀（契约 §2.4.4 的「前缀互斥」目前只对驱动强制）。
- 既有翻译债（宿主 8 语言合计缺 2400 / 冗余 1650；redis 9 语言各缺 139、zh-CN 缺 72）是否立独立翻译回合。
- 延后里程碑：① `WebContextMenuHost` 下沉 `@datazen/ui`；② `ConfirmDialogOptions`(driver-sdk)
  与 `ConfirmOptions`(宿主) 去重；③ 移除 `getTranslation` 的跨语言临时 `setLocale` 交换适配器；
  ④ `DocumentConnectionView` 的 `mongo.*` 归属宿主还是 mongodb 驱动（实测口径 = **21 处出现 / 15 个不同 key**，
  非任务书初稿的「20 处」）。
