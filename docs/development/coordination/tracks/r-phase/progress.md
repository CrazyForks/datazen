# Track: r-phase — Wave 4-B 全量回归与关账（本专项唯一 R 阶段）

- 分支: `feature/r-phase`（基准 = Wave 4-A `import-guard` 合并后的 `feat/driver-decoupling` HEAD）
- 角色: Tester（回归执行 + 关账记录）；发现缺陷只登记 `bugs.md`，不修代码
- 波次: Wave 4-B（本轨完成即整个「驱动↔宿主解耦」专项收口）

## 口径

Wave 1~4 中间各次合入只做「合并健全性校验」，完整回归统一在本轨跑一次。本轨输入 = 下方
【A 门禁】全量复跑 + 【B 各轨留待项】逐项闭环 + 【C 关账】文档与状态收口。

## A. 门禁基线（合并后主检出实测，2026-09-21 @ 8b66586e4）

| 命令 | 基线 |
| --- | --- |
| `node scripts/resolve-drivers.mjs --codegen-only --drivers=all` | exit 0（worktree 默认只 boot basic，任何驱动 UI 校验前必须先跑） |
| `npx tsc --noEmit -p tsconfig.json` | 0 error（`--drivers=all` 与 `--drivers=basic` 两档分别实测） |
| `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` | **27 files / 222 pass / 0 fail** |
| `npx vitest run --config vitest.drivers.config.ts` | **33 files / 241 pass / 0 fail** |
| `npx vitest run src packages/driver-sdk packages/ui` | **412 files / 4243 pass / 0 fail** |
| `npx vitest run scripts` | **22 files / 208 pass / 0 fail**（Wave 4-A 后会增加本轨新增护栏用例） |
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
| import-guard | 新护栏纳入全量回归清单 + 注入/还原自证复跑 | A 门禁 + 本轨独立复做一次「注入红 → 还原绿」 |
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

- [ ] 派发 Tester → 回归执行
- [ ] TEST_DONE / 关账汇报

## 执行记录

（待填写）

## 开放项（等用户，不阻塞本轨）

- **外部仓漂移移交项**（BUG-008 裁定为 advisory，不在本专项修复）：`packages/drivers/superset`（git driver，
  独立仓库）仍有 2 处宿主 `src/hooks/useI18n` 引用（`ui/SupersetConnectionFields.tsx:3`、
  `ui/SupersetSchemaTree.tsx:19`），需在其**自身仓库**换源 `@datazen/ui`；`sql-editor-pro` 的 6 处
  `setLocale` 是其单测合法用法，暂不动。R 阶段只核对这两项仍如实出现在 advisory 输出与契约文档里。
- editor-pro 子仓 commit `c60f7fc` 已本地提交但**未 push**。
- 既有翻译债（宿主缺 1216 / 冗余 1650；驱动 9 语言各缺 139）是否立独立翻译回合。
- 延后里程碑：① `WebContextMenuHost` 下沉 `@datazen/ui`；② `ConfirmDialogOptions`(driver-sdk)
  与 `ConfirmOptions`(宿主) 去重；③ 移除 `getTranslation` 的跨语言临时 `setLocale` 交换适配器；
  ④ `DocumentConnectionView` 的 20 处 `mongo.*` 归属宿主还是 mongodb 驱动。
