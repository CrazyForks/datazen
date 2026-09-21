# Track: redis-assert-policy — 去掉钉死英文值的存量断言

- 分支: `feature/redis-assert-policy`（基准 `feat/redis-workspace-ux` @ ae65ae375）
- 角色: Coder → Tester
- 状态: **READY_FOR_TEST** — 编码 commit `1f7965677`（9 文件改写 + 护栏 + 文档）+ `56ae62cf2`（护栏词表/形态修复）+ 本台账 commit
- Worktree: `.worktrees/datazen-redis-assert-policy`
- 规格: `docs/todo/redis-workbench-ux/PRD.md` §7-6、§8.2（处理决定表）
- 接管记录: 首任 Coder 于 150 回合上限被强制中断，9 个文件改写完毕但**零提交**；Rescuer（全新实例）接管，复核其设计后原样落盘（未推翻任何改写），仅补齐门禁、脚本词表缺陷与文档台账。

## 背景

裁定 8-4 = 照抄参考图文案（`永不过期` / `自动换行` / `大小: N B` / `放弃`），意味着 `locales/en.ts` 的英文字面值要改。i18n 的**完整性**检查在开发期不构成门禁（已核实：pre-commit 不跑、CI `continue-on-error: true`、`release.yml` 不跑，运行时 `packages/ui/src/i18n.ts:87` 缺 key 回落 en）。**真正会拦人的是把英文字面量钉进断言**的那几处 —— 它们把一次文案改动的成本从 1 个 locale 文件放大到 N 个测试文件。

本轨先把存量清掉，并把口径写进文档，供 Wave 2 与后续轮次遵守。

## 范围

1. 改写（**不是删除**）已知存量：
   - `src/locales/locales.test.ts:103-113`：`redis.batchDelete === 'Delete selected'`、`redis.console === 'Console'` ⇒ 改为"解析成功且不回显原始 key"（`text.length > 0` + `text !== key`）。同文件 `:112` 的 `getHostTranslations('en')['redis.batchDelete']` 为 `undefined` 是**真正的边界不变量**（驱动包不并入宿主快照），必须保留。
   - `packages/drivers/redis/ui/__tests__/ttlControlsJourney.test.tsx:21,79,378`：`getByText('No expiry')` ×2 ⇒ 改为按 `data-*` / role 定位后断言存在与状态；`:21` 的 stub 字典（只是让 `t()` 有返回值）**保留**。若被测组件当前没有任何可定位属性，允许在**被测组件**上加 `data-testid`（属最小必要改动，需在自验记录里列出改了哪些组件）。
2. 全量清点：检索 `src/**/__tests__/**`、`packages/drivers/*/ui/__tests__/**` 中"断言可见英文字面量"的其余案例（`getByText('...')`、`.toBe('<英文句>')`、`toHaveTextContent('...')` 等），按同一口径改写。**范围仅限由 i18n `t()` 渲染出来的文案**；断言数据值、日期、数字、代码片段、SQL/Redis 命令原文的不动。
3. 口径落笔：在 `docs/development/interaction-and-testing-principles.md` 增加一节（现有该文件已被 AGENTS.md 引用），规则与理由照 PRD §7-6；同时在 `docs/development/subagent/coder.md`/`tester.md` 若存在"测试写法"小节则加一行指针（无则不新增文件）。
4. 可选（若成本低）：`scripts/check-driver-import-boundaries.mjs` 或新增一条 `test:*` 脚本，对**驱动 ui 测试目录**里 `getByText(/'[A-Z][a-z]+ /)` 这类形态报警。报而不拦（warning）即可；成本高于收益就跳过并说明。

## 已侦察落点（仅供参考，务必自行核实）

- `src/locales/locales.test.ts`（尤其 `:86-96` 那条**不是** parity 断言 —— 它只用 en 出题、要求不回显 key，英文回落恒满足；`:103-113` 才是本轨目标）
- `packages/drivers/redis/ui/__tests__/ttlControlsJourney.test.tsx`
- `packages/ui/src/__tests__/i18n.test.tsx`（共享 i18n 引擎的既有测试写法，作为改造参照）
- `packages/drivers/redis/locales/en.ts`（340 键；`redis.noExpiry:131`、`redis.noTtlOnly:48`、`redis.view.wrap:211`、`redis.size:227` 是 8-4 要改值的四个位）
- `docs/development/interaction-and-testing-principles.md`

## 禁止事项（防跨轨冲突）

- **不改任何 `locales/*.ts` 的实际文案值**（8-4 的字面改动属 Wave 2 的 redis UI 轨，本轨只负责让"改文案不再牵动测试"）。特别是**不要动 `en.ts` 的字符串值**，只改测试与文档。
- 不碰 `packages/drivers/redis/src/**`（redis-cmds-p0 轨）、不碰 `src/windows/connection/{ContentToolbar,ContentView,ContentViewDrawers,ConnectionWorkspaceHome,useConnectionWorkspaceMeta}.tsx/ts` 与 `scripts/resolve-drivers.mjs`（redis-host-slots 轨）。
  - 若为加 `data-testid` 必须碰 `packages/drivers/redis/ui/**` 的**组件**（非测试），允许，但只加属性、不改结构/逻辑，并在自验记录逐条列出。
- 不删测试用例、不降低覆盖率；改写后每条原断言的**被测意图必须保留**。
- 不提交 codegen（`src/extensions/generated*.ts`、`driver_init.rs`、`capabilities/default.json`）、`Cargo.lock`、被注入的 `src-tauri/Cargo.toml`。

## 验收标准

1. `npx vitest run src/locales` 全绿；`npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` 全绿且用例数不减少（改写不是删除）。
2. `npx tsc --noEmit -p tsconfig.json` 0 错误；`npx vitest run`（Host 全量）不引入新红。
3. 全仓 Grep：`getByText('<英文字面量>)` 形态在 redis ui 测试目录命中数为 0；`src/locales/locales.test.ts` 中不再有驱动/宿主词条的英文字面值 `toBe`。
4. 文档新章节落地（`interaction-and-testing-principles.md`），含"为什么"与正反例。
5. 口径自证：临时把某 `en.ts` 值改成一个无关英文串（本地验证，**不提交**）跑相关测试 ⇒ 应全绿（证明断言已不再依赖字面量）。验证完还原。

## 自验记录

### A. i18n 探针处置（验收标准 5 · 硬禁止事项复核）

- 接管时 `git status --short` 与 `git diff HEAD -- packages/drivers/redis/locales/` 均为**空**，全树检索 `Zap chosen widgets` / `Cmd Hub` **零命中** ⇒ 协调者通报的探针**已被首任 Coder 在中断前自行还原**，其"带探针实跑"的原始证据因此丢失。Rescuer 不采信口头数字，**重做了一次范围更大的探针往返**（下述）。
- 探针写法：脚本 `/tmp/zen-i18n-probe.mjs`（仓库外，未入库），按 key 精确改写 **27 个**英文字面值 → `Zqx <KeySlug> blorp`，保留 `{count}` / `{title}` 占位符：
  - `packages/drivers/redis/locales/en.ts` 12 键（`redis.batchDelete` `redis.console` `redis.noExpiry` `redis.seconds` `redis.ttl` `redis.setTtl` `redis.persist` `redis.ttlSeconds` `redis.setExpireAt` `redis.expireAtInvalid` `redis.view.wrap` `redis.size`）
  - `src/locales/en/core.ts` 7 键、`src/locales/en/query.ts` 4 键、`src/locales/en/connection.ts` 4 键（`common.error/close/retry/importConnections`、`menu.appName/file`、`panel.closeTab`、`query.snippets.*`、`connWin.home.queries.*`）
- **探针态实跑**：`src/locales` **19/19 绿**；`packages/drivers/redis/ui` + `mongodb/ui` **29 文件 / 233 例全绿**；本轨改写的 5 个 host 测试文件 **33 例全绿**；Host 全量 **4607 passed / 2 failed**（4609 例，两条失败均在 `src/components/ui/__tests__/Dialog.test.tsx`，见 D 段判定为探针假阳性，与本轨无关）。
- **还原与复跑**：`git restore` 四个 locale 文件后 `git diff --stat -- src/locales 'packages/drivers/*/locales'` **输出为空**（零 diff），复跑：gate1 **19/19 绿**、gate2 **233/233 绿**、5 个 host 改写文件 **33/33 绿**、Host 全量 **443 文件 / 4609 例全绿**。⇒ 绿不依赖探针，探针也不依赖断言（两侧数字一致）。
- 探针副作用记录（供后续写探针者避坑）：首版探针值 `Zqx  blorp`（无占位符时留双空格）与多 key 同值（`common.close` / `common.retry` 都是 `Close`/`Retry` → 同串）会让 `getByRole({name})` 因**可访问名称空白归一化**与**同名多命中**而假红；改为"每 key 唯一 + 单空格"后全绿。这不是断言缺陷，是探针造串缺陷。
- 其它 locale 文件（`zh-CN`、`de`、`es`、`fr`、`ja`、`ko`、`pt-BR`、`ru`、`zh-TW` 及各自 `en` 同级语言目录）全程未被改动，收尾提交时 `git status` 仅剩本轨脚本 + 台账。

### B. 断言改写清单（commit `1f7965677`；首任 Coder 完成，Rescuer 复核通过；改写≠删除，逐文件 `it()` 数与基准 ae65ae375 一致）

| 文件 | 原口径 | 新口径 | 用例数 base→head |
|---|---|---|---|
| `packages/drivers/redis/ui/__tests__/ttlControlsJourney.test.tsx` | `getByText('No expiry')` ×2、`getByText('600 s'/'120 s')`、`getByRole('button',{name:'Set TTL'/'Persist'/'Set expire at'})`、`getByPlaceholderText('TTL (seconds)')`、错误分支 `getByText('TTL (seconds)')` | `getByTestId('redis-ttl-value')` + `data-ttl-state === 'no-expiry' / 'seconds'`（+ 文本非空、数字 `toContain(600)` 属数据）；其余定位改 `redis-ttl-input/-set/-persist/-expire-at`；错误分支改 `redis-ttl-error` 存在且非空；stub 字典按规格保留 | 8 → 8 |
| `packages/drivers/redis/ui/value-editors/TtlControls.tsx` | — | **组件侧唯一改动**：新增 `data-testid="redis-ttl-value"` + `data-ttl-state={ttl<0?'no-expiry':'seconds'}`、新增 `data-testid="redis-ttl-error"`（3 处 data-*，零结构/逻辑变化；`redis-ttl-input/-set/-persist/-expire-at` 为基准已有，非本轨新增） | — |
| `packages/drivers/redis/ui/__tests__/localePackRegistration.test.ts` | `t('redis.batchDelete')==='Delete selected'`、`t('redis.console')==='Console'` | `toBe(en['redis.batchDelete'])` + `not.toBe(key)` 双锚（字典回读 + 不回显 key）；`definitelyNotAKey` 回显守卫与 key 集合守卫原样保留 | 4 → 4 |
| `packages/drivers/mongodb/ui/__tests__/localePackRegistration.test.ts` | `t('mongo.collections')==='Collections'` 等 2 条 | 同上（`en['mongo.*']` 回读 + `not.toBe(key)`） | 4 → 4 |
| `src/locales/locales.test.ts` | `getAllTranslations('en')['redis.batchDelete']==='Delete selected'`、`getTranslation('en','redis.console')==='Console'`；另有 `panel.closeTab`/`query.snippets.*` 4+1 条英文字面值 | 逐 key 改"解析成功（`length>0`）且不回显 key"；插值条改 `toContain(param)` + `not.toContain('{')`；**保留** `getHostTranslations('en')['redis.batchDelete'] === undefined` 边界不变量与 `getTranslation('test-lang','common.ok')==='TestOK'`（测试自造字典，非产品文案） | 19 → 19 |
| `src/windows/connection/home/__tests__/retest-round1-fixes.tester.test.tsx` | 钉死 `刚刚 / N 分钟前 / just now / N min ago` 与 zh/en 互不串味的字面串 | 期望值统一由 `relativeLabel(locale,key,count)` 从**同一份字典**回读；"不串味"改断"对侧解析值不可见"；插值额外断 `toContain('5')` + 无 `{` 残留 + zh≠en（真翻译而非丢 key） | 12 → 12 |
| `src/components/__tests__/MenuBar.test.tsx` | `getByRole('menubar',{name:'DataZen'})`、`{name:'File'}` ×4、`{name:'Import Connections'}` | 同名断言改为回读 `en['menu.appName']` / `en['menu.file']` / `en['common.importConnections']`；role / `aria-haspopup` / `aria-expanded` / 焦点序 / Escape 回跃等真实契约一字未减 | 3 → 3 |
| `src/components/__tests__/ErrorBoundary.test.tsx` | `heading {name:'Error'}`、`button {name:'Close'/'Retry'}` | 同上回读 `en['common.error'/'common.close'/'common.retry']`，并显式断三份词条非空 | 1 → 1 |
| `src/components/ui/__tests__/ConfirmDialog.test.tsx`、`src/hooks/__tests__/useConfirmDialog.test.tsx` | `getByText('Cancel')` 点击 | `getByTestId('confirm-dialog-cancel')`（该 testid 基准已存在于 `ConfirmDialog.tsx`，本轨**未**改组件） | 11 → 11 / 6 → 6 |

### C. 口径落笔与可选护栏（范围项 3、4）

- `docs/development/interaction-and-testing-principles.md`：新增**原则六「断言与 i18n 文案解耦」**（原"五大原则"→"六大"），含三类允许锚点优先级（`data-*` > i18n key > 字典回读）、"改写不是删除"、为什么（8-4 案例 + §8.2 门禁核实链）、**10 组正反例对照表**、6 类不在范围内（数据/自造 props/@datazen/ui 无 i18n 默认值/测试 stub 字典/边界不变量），并加了自检清单第 6 条。
- `docs/development/subagent/tester.md`：「测试写法」小节加一行"零文案断言"指针。`coder.md` **无**"测试写法"小节（只有工作区/搜索纪律/心跳/完成标准四节），按规格"无则不新增"处理，**未改该文件**。
- `scripts/check-i18n-copy-assertions.mjs` + `scripts/__tests__/check-i18n-copy-assertions.test.ts`（10 例）+ `package.json` 两条脚本 `test:i18n-assertions`（默认）/ `test:i18n-assertions:strict`。
  - **Rescuer 修复首任版本的真实盲区**：词表采集用 `file.endsWith('en.ts')` 过滤，而宿主英文源是 `src/locales/en/<domain>.ts` 领域包 ⇒ 宿主词条**完全进不了词表**，护栏对宿主文案全盲。改为 `locales/en.ts` ∪ `locales/en/*.ts`（`isEnglishDictionary`）。
  - 顺带补上 `getByRole(<role>, { name: '<copy>' })` 形态（正是本轨在 MenuBar/ErrorBoundary 清掉的反例形态，原 matcher 看不见）。
  - 两处能力各补 1 条单测（宿主领域包 + 可访问名），并同步函数头注释。

### D. 门禁实跑数字（改写前基线 → 本轨之后）

| # | 命令 | 探针态 | 还原后（最终） | 基线比对 |
|---|---|---|---|---|
| 1 | `npx vitest run src/locales` | 19 passed | **19 passed / 0 failed** | 基准同文件 19 例 ⇒ 不减 |
| 2 | `npx vitest run --config vitest.drivers.config.ts packages/drivers/redis/ui` | 222 passed（与 mongo 合跑 29 文件 233 例） | **27 文件 / 222 例 passed / 0 failed** | 任务书引用基线"213 passed / 5 failed"（`fix-redis-tests` 轨记录的同目录口径）；本次 222/222 且 redis UI 用例数与已知全绿基线 **27 文件 / 222 例** 完全一致 ⇒ 不减、不新增红 |
| 2b | 同上 + `packages/drivers/mongodb/ui` | 233 passed | **29 文件 / 233 例 passed** | = 首任 Coder 口头报的 233，已独立复核 |
| 3 | `npx tsc --noEmit -p tsconfig.json` | — | **0 错误（`tsc-exit=0`）** | — |
| 4 | `npx vitest run`（Host 全量） | 443 文件 4609 例：**2 failed** | **443 文件 / 4609 例 / 0 failed** | 比对方法：本轨首次提交后、脚本改动前的全量运行为 443/4608 全绿；最终 4609 = 4608 + 护栏新增 1 例；红色数 **2 → 0**（那 2 条见下方判定），故"不引入新红"成立 |
| 5 | Grep 自证 | — | redis ui 目录 `getByText('英文字面量')`/`getByRole({name:'…'})`/`getByPlaceholderText('…')` 命中：仅 `consoleResultRenderer.test.tsx:80 getByText('John')`（测试自造数据，非词条）⇒ **词典命中 0**；`src/locales/locales.test.ts` 剩余 `.toBe('<str>')` 仅 `not.toBe('redis.console')`（key）与 `'TestOK'`（测试自造字典）⇒ **英文字面值为 0** | 扩扫：把扫描器 `dirs` 指到 `src packages e2e` 共 **457 个测试文件 / 0 条钉死词条断言** |
| 6 | 还原后复跑 1、2 | — | 19/19 与 233/233，**与探针态逐项相同** ⇒ 绿与文案无关 | 见 A 段 |

**探针态那 2 条 Host 红的定性（非本轨缺陷、非存量待清）**：`src/components/ui/__tests__/Dialog.test.tsx:98,102` 断 `getByRole('button',{name:'Close'})`，该 `Close` 来自 `@datazen/ui` `Dialog` 的**无 i18n 参与默认属性** `closeLabel = 'Close'`（原则六第 5 条明确豁免），只是**恰好**与宿主词条 `common.close` 同串，被探针连带改坏；还原后复跑该类 **11 例全绿**。扫描器默认 `SCAN_DIRS=['packages/drivers']` 看不见该文件，故本轨 0 命中结论不受影响。

### E. 两项风险核查（协调者点名）

1. **新脚本"报而不拦"** —— `scripts/check-i18n-copy-assertions.mjs` 末尾 `process.exitCode = checkI18nCopyAssertions({ strict: argv.includes('--strict') }).code`，而 `code = strict && hits.length > 0 ? 1 : 0`：**默认路径恒 0**，仅显式 `--strict` 且有命中时 1。实跑原文：
   - `node scripts/check-i18n-copy-assertions.mjs; echo "exit=$?"` → `[check-i18n-copy-assertions] ok (33 driver test files scanned, 0 copy literals pinned)` / **`exit=0`**
   - `node scripts/check-i18n-copy-assertions.mjs --strict; echo "exit=$?"` → 同上 ok 行 / **`exit=0`**（当前 0 命中，故 strict 也 0）
   - strict 命中态的非 0 由单测锁住：`'warns but does not fail on a copy literal, and fails only under --strict'` 断 `advisory.code === 0` + `warnings` 含 `warning only, not blocking` + `strict.code === 1` + `hits.length === 1`。
2. **不进开发期门禁** —— `git diff ae65ae375 --stat -- .github .githooks .husky scripts/ci-local.sh vitest.config.ts vitest.drivers.config.ts package.json` 只有一处：`package.json | 2 ++`（即两条新脚本本身）。核实：
   - `.husky/pre-commit` = `cargo fmt` + prettier + `driver-stash-precommit.mjs` + `check-version-consistency.mjs`，**不含**本脚本；`.githooks/pre-commit` = 密钥扫描，**不含**本脚本；
   - `package.json` 的 `pretest` / `pretest:unit` 仅 `resolve-drivers --codegen-only` + `generate-builtin-locales`，`test` = `vitest run`，`prepare` 不含本脚本 ⇒ 没有任何隐式聚合把 `test:i18n-assertions` 拉进开发期；
   - `.github/workflows/ci.yml` 与 `scripts/ci-local.sh` 零改动，其中既有的 `i18n-sync-check` 仍带 `continue-on-error: true`（基准原样）。
   - 结论：首任 Coder **未**把该脚本接成阻断项，无需回退。立项理由（开发期不该有发布门禁）成立。

### F. 越界自查

`git status --short` 全量清点后入库文件共 16 个（15 + 本台账）；`locales/*.ts` 零 diff；未碰 `packages/drivers/redis/src/**`、`src/windows/connection/{ContentToolbar,ContentView,ContentViewDrawers,ConnectionWorkspaceHome,useConnectionWorkspaceMeta}.tsx?`、`scripts/resolve-drivers.mjs`、`src/lib/databaseMeta.ts`、`hub.md`、任何其它 worktree；`package.json` 仅本轨两条脚本；`artifacts/.pack-ep-staging-sql-editor-pro/`（前任构建残留，gitignored）与 `src-tauri/Cargo.lock`、codegen 文件均未入库。检索全程使用 Grep/Glob 工具，未执行 `pnpm install` / `pnpm e2e` / `pnpm tauri:build:webdriver` / 裸 `pnpm build`。

## 留待 R 回归

1. **Wave 2 落刀口**：8-4 真正改 `redis.noExpiry` / `redis.view.wrap` / `redis.size` / 及 `redis.ttl*` 文案时，本轨已证明**驱动侧 233 例 + host 4609 例无需连带修改**（27 键探针实跑为证）。若届时仍有测试变红，即为新引入的钉死断言，直接按原则六处理并回登记。
2. **`Dialog.test.tsx` 的 `closeLabel`（低优先，非缺陷）**：`@datazen/ui` `Dialog` 的默认 `'Close'` 与宿主 `common.close` 恰好同串。当前判定为豁免项（无 i18n 参与）。若哪天 `Dialog` 改为接 `t()`，需按原则六同步改该测试；R 阶段顺手确认即可。
3. **扫描器词表启发式的假阳性类（已文档化，勿"修断言"）**：把词条原样当**数据**注入的用例会命中 —— 实测扩扫 `src` 后 4 条：`BuildStatement.test.tsx:198,220`（`'LEFT JOIN'`，SQL 原文，词表里 `dashboard`/`query` 恰好也有该词）、`ChartWidgetTile.test.tsx:139` 与 `RunHistoryDrawer.test.tsx:161`（`error: 'Query failed'` 是 fixture 数据，与 `dashboard.runError` 同串）。这 4 条**都不该改**（改了反而丢信息），正是该护栏必须"报而不拦"、命中须人读不可自动化的理由；默认 `SCAN_DIRS` 不含 `src`，日常 0 命中。若将来要把 `--strict` 升为发布前门禁，需先给扫描器加"同串也出现在本文件数据位置"降噪或显式白名单。
4. **无头/E2E 面**：本轨纯单测与文档，未新增 E2E；`ttlControlsJourney` 的 8 段击键旅程保持完整（用例数 8→8），无需 R 阶段补旅程，只需在 GUI 清单里顺手确认 TTL 区四按钮可点、错误行可见。

