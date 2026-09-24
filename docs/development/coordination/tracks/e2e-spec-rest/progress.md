# Track e2e-spec-rest — progress

- **Phase: READY_TO_MERGE**（Tester round-1 独立复验通过：tsc 门零新增 / 7 目标 spec 0 错误 / 全部 8 处根因自报独立复核成立；全量 E2E 复跑因本 worktree 无 webdriver binary 留待 R 回归 —— 见 §6 E2E 登记表。测试 commit 见 §7。）
- Rescue mode: TEST-CASE-side fixes only (no app code, no shared e2e files).
- Evidence log (read-only): `/var/folders/2y/5w1_2qg97r7b9bfv20b4nybh0000gn/T/dsh-subprocess-ZGoJj1/dsh-subprocess-35692-3-34e6b482ee2a-stdout.log` (quoted as `log:<line>`).
- Full E2E re-run NOT performed (no compiled webdriver binary in this worktree) → parent harness must run the suite.

## 1. Gate status: `npx tsc --noEmit -p e2e/tsconfig.json`

| scope | result |
| --- | --- |
| the 7 target spec files | **0 errors** |
| vs pristine baseline (stash round-trip, byte-compare of outputs) | **zero new errors; 2 pre-existing errors removed** (`workflow-window.ts:368/384` TS2365 fixed type-only, runtime-identical) |
| overall exit code | **still 2** — 99 pre-existing error lines in files outside this track's edit scope |

⚠️ **Acceptance criterion (1) is red for reasons that predate this track and cannot be
fixed under its rules** (shared/other-track files are read-only here):

- `e2e/helpers.ts` ×4 and `e2e/lib/screenshotTrace.ts` / `e2e/lib/testDataLifecycle.ts` ×2 — **shared files, explicitly out of edit scope**.
- `e2e/specs/navigator-context-menu.ts` (14), `ai-context-tables.ts` (6, AI track), `homepage-features.ts`, `mysql.ts`, `sqlite.ts`, `multi-database.ts`, `main-window.ts`, … — other tracks' specs.
- The gate is red everywhere, not just here: main checkout `main @ 73822e02` with its own (newer) tree fails the same command with 57 primary errors, including the same `workflow-window.ts:368/384` pair. The worktree base `6fb1571f` is an ancestor of `main` and carries *more* of this debt (worktree base's `e2e/helpers.ts` differs from main's — main already fixed some of it).
- Dominant error class: installed WebdriverIO types type `await $$()`/chainable `.length` as `Promise<number>` (TS2365/TS2367/TS2345/TS2724) — systemic type debt, not introduced by this track.

**Request to coordinator:** waive criterion (1) for this track (evidence: byte-identical
baseline + zero errors in the 7 target files), or open a separate shared-file cleanup
track for `e2e/helpers.ts` + `e2e/lib/**` + the remaining specs.

**Tester 独立实测（round 1，零信任复跑，@ dc2185620）：**

- 生成物已备（`node scripts/generate-builtin-locales.mjs` 正常），连续两次
  `npx tsc --noEmit -p e2e/tsconfig.json` 输出**逐字节一致**：exit 2，**99 行输出 =
  70 条主错误（`error TS` 行）+ 29 条类型详情续行**。自报「99 pre-existing error
  lines」按总行数计，与独立实测对账一致（口径差异仅为「主错误 vs 含续行总行数」）。
- 7 个目标 spec：**0 错误** ✓。
- 基线回环（7 spec 临时 checkout 至父提交 `dc2185620^` 重跑后立即恢复，工作区已
  clean）：**101 行 / 72 条主错误**；`diff` 基线 vs HEAD 输出的**唯一差异**恰为
  `e2e/specs/workflow-window.ts(368,9)` 与 `(384,11)` 两条 TS2365 →
  **零新增错误、净 −2**，与自报一致。
- 错误分布全部落在本轨改窗外：navigator-context-menu 14、ai-context-tables 6、
  homepage-features 4、helpers.ts 4、mysql/multi-database/main-window/drag-drop-
  groups/connection-window 各 3、sqlite/ops-process-server/i18n-10-locales/
  data-dashboard-sql-add/data-dashboard-refresh 各 2、其余 17 文件各 1（含
  `lib/screenshotTrace` / `lib/testDataLifecycle`）——与 §1 豁免说明一致。
- 未复核项：自报中「main checkout `73822e02` 57 primary errors」一句在主 checkout
  上验证（本轨规则不触碰主 checkout），仅作为背景陈述采信，不进入本轨验收依据。

## 2. Per-spec root causes and fixes (all 7)

### 2.1 `journeys/query-row-limit-journey.ts` — QLIMIT-003/004/005
- **Failure**: all three die inside `openQueryTab()` at `helpers.ts:1144`
  (`button[aria-label="执行"]` never displayed after 15 s) — `log:315-326`, `log:9970-9973`.
- **Root cause**: QLIMIT-002 calls `openSettingsInMainWindow()`, which navigates with
  `browser.url('tauri://localhost')` — a **full page reload that drops the frontend
  session**. Afterwards the app is back on the connections list: neither
  `conn-toolbar-new-query` (needs the connection workspace) nor `home-quick-new-query`
  (quick actions render only in State-4 connected home) exists, so `openQueryTab()`'s
  30 s poll finds no entry point and no editor mounts. `before()` succeeded only because
  it connects after the refresh; QLIMIT-001/002/006 don't need an editor.
- **Fix (spec-local)**: `openQueryTabWithConnection()` — fast path when either
  new-query button already exists, otherwise replay the before() connect path
  (`openConnectionsWorkspace → clickCardConnectButton → waitForConnectionToolbar → openQueryTab`).
  Used at the three failing call sites; assertions untouched. The seeded table is
  verified intact (`log:2774` `e2e_row_limit_test OK count=2`), so post-fix assertions hold.

### 2.2 `new-connection.ts` — CM-002 (`展开高级设置应显示 SSL、分组和 SSH 选项`)
- **Failure**: `new-conn-ssh-toggle` waitForDisplayed timeout (`log` suite section for CM-002).
- **Root cause**: **stale testid** — `new-conn-ssh-toggle` exists nowhere in `src/`.
  Grep-proven current UI (`src/components/connection/ConnectionAdvancedSettings.tsx`):
  advanced section → `new-conn-tunnel-toggle` (:199) → `new-conn-tunnel-source` (:232) →
  inline panel (`new-conn-inline-tunnel` :315) → `SshTunnelFields` renders when
  `tunnelSource==='inline' && tunnelKind==='ssh' && supportsSSH` (:326) with
  `new-conn-ssh-tunnel-checkbox` (`SshTunnelFields.tsx:39`). Switching the source to
  inline auto-restores kind `ssh` and turns `sshEnabled` on
  (`useTunnelFormState.ts:405-408`), so the SSH host field appears with it.
- **Fix (spec-local)**: click `new-conn-tunnel-toggle` (respecting `aria-expanded`) →
  reach inline via `new-conn-tunnel-create-entry` (empty-hint path, default state) or
  `selectDzOptionInWrap('new-conn-tunnel-source', t('newConn.savedTunnelNone'))` when
  saved tunnels exist → assert `new-conn-ssh-tunnel-checkbox` displayed **and**
  `input[placeholder="ssh.example.com"]` displayed (stronger than the original
  existence-only assertion; placeholder verified in `SshTunnelFields.tsx:60`).
  Flow cross-checked against the passing `journeys/tunnel-connection-journey.ts` and unit
  test `NewConnectionDialog.test.tsx:118-123`.

### 2.3 `query-history.ts` — QH-002
- **Failure**: `expect(headers.length).toBe(0)` → Expected 0, Received 1 —
  `history-group-label` present in the default "current database" scope.
- **Root cause**: `QuerySidebarSection.tsx:299` — `historyScopeFallback = historyScopeMode
  === 'current' && !currentDbGroup`: when no history group resolves for the selected
  database, the sidebar falls back to **grouped** rendering (labels + `history-scope-fallback-hint`
  :414-421). Evidence-backed trigger: a previous spec leaves a backend session for the
  shared `conn_e2e_pg` bound to its **dropped** worker DB; `openSeededPgConnectionWindow`
  reuses it, so MARKER_A/B records land under a database that never equals the UI's
  selected database → fallback renders permanently (markers still visible in body → the
  body assertions passed while the header count failed). Secondary contributor: the
  assertion raced the async current-database resolution.
- **Fix (spec-local)**: (a) `before()` kills any leaked session first via the exported
  `connectBackend('conn_e2e_pg')` + `disconnectBackend(...)` pair (same pattern as
  `export-import.ts:120-129`; helpers are called, not modified) so the UI connect
  creates a fresh session on this run's worker DB; (b) QH-002 waits
  `waitUntil(history-scope-fallback-hint absent)` with an explanatory `timeoutMsg`
  before counting labels. Assertions unchanged (`=== 0`, body-contains markers).

### 2.4 `sql-editor-productivity.ts` — SE-PROD-021
- **Failure**: `expect(selectionCount).toBeGreaterThanOrEqual(3)` → Expected ≥ 3, Received 1
  (`log:6622`).
- **Root cause**: race between `setEditorContent()`'s DOM write
  (`document.execCommand('insertText')`, `helpers.ts:939-949`) and CodeMirror's async
  state sync. The test dispatched its selection by reading `cmView.state.doc` after a
  fixed `pause(300)`. With a stale state doc `indexOf('foo') === -1` → **the dispatch is
  silently skipped** → selection remains a collapsed cursor at end-of-doc → Mod+D on a
  collapsed cursor with no later occurrence changes nothing → 1 range. SE-PROD-020
  passed only by timing luck (same defect latent there).
- **Fix (spec-local, assertion unchanged)**: (a) `waitUntil` the CM **state doc**
  contains `'foo bar foo bar foo bar'`; (b) `waitUntil` the dispatch actually landed
  (single range whose text is `foo`) with a descriptive `timeoutMsg`; (c) bounded retry
  loop (≤ 4 presses, one re-dispatch if the selection collapses mid-way) ending in the
  **same** `expect(≥ 3)` — a genuinely broken keybinding still fails this test.

### 2.5 `sql-query.ts` — SQ-001 (stop button) + SQ-012 (DML)
- **SQ-001 failure**: mocha `Timeout of 120000ms exceeded` for
  「执行查询期间应显示停止按钮 (SQ-001)」 (`log:7932-7933`).
- **SQ-001 root cause**: the test body actually ran to completion — `log:7929`
  (`09:56:46.165 execute_driver_command_stream sql_len=18` = `SELECT pg_sleep(5)`),
  `log:7930` (`09:56:46.688 cancel_query` = the stop click's handler firing 0.5 s after
  the execute, exactly matching `pause(500)`), `log:7931` (`Query cancelled`) — yet mocha
  fired its 120 s timer afterwards and the **next** test's SQL didn't run until
  `10:02:19.954` (`log:7934`, backend fully silent `09:57–10:02`). Pattern: the
  protocol-level WebDriver element click on the transient stop button wedged the driver
  session mid-flight (element re-rendered/detached between resolution and response);
  the mocha timeout and the 5.3-minute stall are symptoms of the wedged command queue.
- **SQ-001 fix (spec-local)**: assert the observable running state instead of a fixed
  pause (`waitForDisplayed` on `editor-stop-button`, 15 s, explicit `timeoutMsg`), then
  cancel via an **in-page `browser.execute` DOM click** (same React handler, no element
  resolution round-trip), then `waitUntil` the stop button disappears (query genuinely
  ended) — bounded, with `timeoutMsg`s. Final assertions (`toBeDisplayed`) unchanged.
  Stop-button existence/semantics verified in `src/components/query/QueryExecutionStatus.tsx:52-70`
  (renders only while `phase` is running/cancel_requested; enabled ⇒ `cancelState === 'available'`,
  consistent with the cancel having fired in the failing run).
- **SQ-012 failure**: `Timed out waiting for DML execution duration`; backend
  `log:7949` `CREATE TABLE IF NOT EXISTS _e2e_sql_test … error returned from database:
  no schema has been selected to create in`.
- **SQ-012 root cause**: **test data-setup gap, not an app bug.** The spec's disposable
  connection deliberately uses `database: ''` (multi-database selector path, comment
  :33-36), so its session resolves to a database that does not contain the per-worker
  schema `e2e_worker_0` (schemas are created by `e2e/setup-e2e-env.sh:78-82` in the E2E
  database; the qualified `SELECT … goecoride.pg_catalog.pg_tables` probe failing with
  `cross-database references are not implemented` (`log:09:56:44.969`) proves the session
  is **not** in `E2E_PG_DB`). Unqualified DDL therefore fails because no schema in
  `search_path` exists.
- **SQ-012 fix (spec-local)**: prelude `executeSQL('CREATE SCHEMA IF NOT EXISTS <E2E_WORKER_SCHEMA>')`
  before the DML content — `CREATE SCHEMA` does not depend on `search_path`, afterwards
  CREATE/INSERT/DROP resolve through the configured schema. Precedent:
  `navigator-context-menu.ts:457` does exactly this; `executeSQL` already bypasses
  Safe Mode for blocked DDL (`helpers.ts:954-958`).

### 2.6 `wapps.spec.ts` — 4× "sample wapp card not visible"
- **Root cause**: **stale testid** — `sampleCard()` selected `[data-testid="wapp-card"]`,
  which appears nowhere in `src/` (and `wapp-card` appears nowhere else in `e2e/` either).
  The management page renders `data-testid="extension-card"` with `data-wapp-id`
  (`src/windows/wapps/WappManagementPage.tsx:215-216`); `extension-toggle` (:275),
  `extension-open` (:296) and `extension-uninstall` (:307) are children of that card, so
  every downstream `card.$()` lookup works once the root selector is right.
- **Fix (spec-local)**: one-line selector swap in `sampleCard()`
  (`wapp-card` → `extension-card`) — covers all 4 failing cases (J1-001, J4-001, J4-002,
  J5-001) which all go through `waitForSampleCard()`.

### 2.7 `workflow-window.ts` — 「执行后默认显示第一个 step 结果」 assertion at (old) :424
- **Failure**: `expect(isStepAActive).toBe(true)` → Expected true, Received false
  (`log:9896-9911`).
- **Root cause**: **stale assertion against the app's deliberate default.**
  `workflowStepResultOrder` defaults to `'desc'` (`src/stores/settingsStore.ts:47`), and
  `WorkflowPage` shows steps last-step-first under `desc`
  (`firstShownIndex` :106-108 + reversed `stepIndices` :603-609): with steps
  `step_a, step_b`, the tab bar shows **step_b first and step_b active**, while `step_a`
  is second and legitimately inactive (`bg-accent/10 text-accent` active class only on
  the active tab, :998-1003). This default is explicitly blessed by the unit test
  `WorkflowPage.test.tsx` "shows step results last-step-first by default" (default order
  → last step shown first and selected). Not an app bug — the E2E assertion assumed
  ascending order.
- **Fix (spec-local, assertion strength preserved)**: wait until both step tabs render,
  then assert — order-agnostically — that the **first displayed** step tab (filter:
  buttons whose text contains `[` and `step_a|step_b`, mirroring the unit test's filter)
  carries the active `accent` styling. Body content check (`val/alpha/step_a`) unchanged.
- Also fixed two pre-existing in-file type errors (`historyItems.length > 0` at old
  :368/:384, TS2365) via `await Promise.resolve(….length)` — type-level only,
  runtime-identical.

## 3. NEEDS_APP_FIX

**None.** All seven failures are conclusively test-side (stale selectors, stale
assertion vs. blessed default, races, session-leak/data-setup gaps, one wedged-driver
protocol interaction). No app code was modified.

## 4. Shared-file suggestions (NOT applied — read-only by track rules)

1. **`e2e/helpers.ts` → `openQueryTab()`** (:1142): the aria-label fallback
   `button[aria-label="执行"]` is zh-only; QLIMIT-style specs save settings with
   `language: 'en'`, where the label is `Execute`. Prefer the testid only, or a
   locale-aware fallback list.
2. **`e2e/helpers.ts` → `openSettingsInMainWindow()`** (:2049): `browser.url(...)` is a
   full reload that silently destroys the workspace session; consider in-app navigation
   (or a documented "session restored" helper) so settings round-trips don't force every
   caller to reconnect.
3. **`e2e/wdio.conf.ts` / lifecycle**: add a per-spec guard that disconnects leaked
   backend sessions for `conn_e2e_pg` (pattern: `connectBackend` → `disconnectBackend`
   in the spec's `before()`, as applied here in `query-history.ts` and already used by
   `export-import.ts`) — cross-spec worker-DB drops leave sessions pointing at dead
   databases.
4. **tsc baseline debt** (criterion 1): fix `e2e/helpers.ts` ×4 + `e2e/lib/**` ×2 +
   remaining specs, or gate CI on the changed-files subset; see §1.
5. **`e2e/helpers.ts` → `expandNewConnectionSshSection()`** (:120): still selects the
   stale `[data-testid="new-conn-ssh-toggle"]`, which exists nowhere in `src/`; its only
   caller is `e2e/specs/client-parity.ts:268`. `client-parity.ts` was **not part of**
   this full-run suite (no RUNNING line in the evidence log), so it did not fail this
   round — latent same-root-cause breakage, matching CM-002's diagnosis. When shared
   files open up, switch it to the `new-conn-tunnel-toggle` flow.
6. **Split-brain leak is bigger than `query-history.ts`** (Tester finding, evidence
   from the read-only log): object-browser [0-16] (4 passing, 8.1s) left a leaked
   `conn_e2e_pg` session bound to its dropped worker DB `e2e_w22915_0_h9pi`; the backend
   then logged a dead-database error storm **09:36:50–09:39:03** (`log:3316–3610`) whose
   window overlaps this run's other failures — object-filter [0-17] (2 failing),
   ops-ddl-backup [0-18] (1 failing), ops-process-server [0-19], and QH-002 [0-22].
   Additionally navigator-context-menu's failure carries the same signature against a
   different dead worker DB (`e2e_w18868_0_4r71`, `log:3227-3229`, re-printed
   `log:10206-10207`). The `query-history.ts`-local cleanup (§2.3a) protects only that
   spec; item 3 above (global `before()` guard) is the real closure. Out of this
   track's edit scope — for coordinator dispatch.

## 5. Changed files (this track)

- `e2e/specs/journeys/query-row-limit-journey.ts`
- `e2e/specs/new-connection.ts`
- `e2e/specs/query-history.ts`
- `e2e/specs/sql-editor-productivity.ts`
- `e2e/specs/sql-query.ts`
- `e2e/specs/wapps.spec.ts`
- `e2e/specs/workflow-window.ts`
- `docs/development/coordination/tracks/e2e-spec-rest/progress.md` (this file)

No app code (`src/`, `src-tauri/`, `packages/`) and no shared e2e files
(`e2e/helpers.ts`, `e2e/wdio.conf.ts`, `e2e/lib/**`) were touched.

Tester round 1 additionally hardened `e2e/specs/sql-editor-productivity.ts`
SE-PROD-020 with the same doc-sync/selection-landed `waitUntil` guards as SE-PROD-021
(latent same-root-cause race; assertions unchanged, zero-text locators only) and added
`bugs/README.md`. Still no app code and no shared e2e files touched.

## 6. E2E 登记表（Tester 阶段 C）

前置条件（复跑任一本轨用例均需要）：`pnpm tauri:build:webdriver` 产出的 webdriver
binary + `node scripts/generate-builtin-locales.mjs` + 可用的 Postgres 测试库
（`E2E_PG_DB` / `E2E_WORKER_SCHEMA`，由 `e2e/setup-e2e-env.sh` 置备）。本 worktree
为 binary-free，故本机一律不执行。

| spec | 本轮失败用例（Rescuer 已修） | 受改动波及 / 连带用例 | 状态 |
| --- | --- | --- | --- |
| `journeys/query-row-limit-journey.ts` | QLIMIT-003、QLIMIT-004、QLIMIT-005（均死于 `openQueryTab` 入口） | QLIMIT-001、QLIMIT-002、QLIMIT-006（共享 `before()` 与顺序依赖） | 【留待 R 回归】 |
| `new-connection.ts` | CM-002「展开高级设置应显示 SSL、分组和 SSH 选项」 | 该 describe 内全部用例（走同一新建连接对话框） | 【留待 R 回归】 |
| `query-history.ts` | QH-002 | QH-001、QH-003～QH-005（`before()` 新增泄漏会话清理，影响整个 spec） | 【留待 R 回归】 |
| `sql-editor-productivity.ts` | SE-PROD-021 | SE-PROD-020（Tester 加固同根因遗留竞态，断言未改）及同 spec 其余 SE-PROD-* | 【留待 R 回归】 |
| `sql-query.ts` | SQ-001、SQ-012 | before()/after() 连接管理不变，仅两条用例体内改动 | 【留待 R 回归】 |
| `wapps.spec.ts` | J1-001、J4-001、J4-002、J5-001 | 全部经 `sampleCard()` / `waitForSampleCard()` 的用例 | 【留待 R 回归】 |
| `workflow-window.ts` | 「执行后默认显示第一个 step 结果」 | 同 spec 历史记录计数用例（`:368/:384` 类型修复，runtime-identical） | 【留待 R 回归】 |

复跑入口（R 回归一次覆盖本轨全部 7 spec）：

```bash
pnpm e2e:skip-build -- --spec journeys/query-row-limit-journey.ts,new-connection.ts,query-history.ts,sql-editor-productivity.ts,sql-query.ts,wapps.spec.ts,workflow-window.ts
```

## 7. Tester 验证记录（round 1）

- **阶段 A（审查）**：`git show dc2185620` 确认仅 8 个文件（7 spec + 本文件，+444/−61），
  未触碰 `src/`、`src-tauri/`、`packages/`、`e2e/helpers.ts`、`e2e/wdio.conf.ts`、
  `e2e/lib/**`。8 处根因自报（§2.1–2.7 + workflow-window）逐条对照失败日志与
  `src/` 现行实现**独立复核全部成立**：QLIMIT 会话被 `browser.url()` 全量刷新摧毁 ✓；
  CM-002 `new-conn-ssh-toggle` 为陈旧 testid、现行流为 tunnel-toggle→inline ✓
  （placeholder `ssh.example.com` 系源码字面量，非 i18n，零文案规则不适用）✓;
  QH-002 split-brain 会话绑定已销毁 worker DB（日志 `database "e2e_w22915_0_h9pi"
  does not exist`）✓；SE-PROD-021 陈旧 doc 静默跳过 dispatch（日志 `Expected: >= 3
  Received: 1`）✓；SQ-001 应用侧 cancel 链路正确（09:56:46.688 `cancel_query` →
  `Query cancelled`），卡死在 WebKit WebDriver 协议层，in-page click 绕过不掩盖应用
  回归 ✓；SQ-012 会话不在 `E2E_PG_DB`、`CREATE SCHEMA IF NOT EXISTS` 前置合理 ✓；
  wapps `wapp-card` 为陈旧 testid、现行为 `extension-card[data-wapp-id]`（4 失败用例
  J1-001/J4-001/J4-002/J5-001 均经同一 `waitForSampleCard`）✓；workflow-window 断言
  违背 `workflowStepResultOrder` 默认 `'desc'`（`settingsStore.ts:47` + 单测背书）✓。
- **阶段 B（独立复验）**：tsc 门实测见 §1「Tester 独立实测」——与自报零差异（口径已对账）。
  未跑 vitest：Rescuer 改动 0 个生产文件，`src/**` 与 `npx vitest run` 的被测面完全
  未变（HEAD 工作区生产代码与基线逐文件相同），覆盖率数字改动前后不变、不适用
  ≥80% 判据。
- **阶段 C（补齐）**：E2E 登记表见 §6；测试侧加固 SE-PROD-020（同根因遗留竞态，
  零文案断言，原断言 `≥2` 未改）；§4 新增 2 条共享文件/跨轨发现。
- **阶段 D（判定）**：无新增 Bug（`bugs/README.md` 记录「第 1 轮：无」）。
- **测试 commit**：见下方「测试 commit」行（本轮两次提交：主提交 + hash 回填）。
