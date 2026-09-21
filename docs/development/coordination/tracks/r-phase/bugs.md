# Track: r-phase — Bug 清单（Wave 4-B 独立 Tester 全量回归）

> 角色：只测不修。以下均为 Wave 4-B 全量回归实测发现，状态一律 `待修复`，等协调者裁定派发。
> 基准：worktree `.worktrees/datazen-r-phase` @ `feature/r-phase` HEAD `20393084ec`，codegen `--drivers=all`。
> 严重度口径：**阻断** = 门禁红；**中** = 影响门禁可复现性/他人判断；**低** = 文档失配（验收标准 5 要求零失配，故仍入账）。
>
> **收尾实例复核（2026-09-21 11:11~11:20，Wave 4-B 第二个 Tester 实例）**：BUG-001 ~ BUG-004 四条逐条重取证据，
> 全部**成立**（各条下方「收尾复核」为独立取证，非转抄前任）；本轮新发现 BUG-005 / BUG-006。
> 复核口径：worktree 只读 + 主检出只读（仅 `check-driver-import-boundaries.mjs --root=` 例外），未改任何业务代码/契约文档。
>
> **第 2 轮修复回合（Coder，2026-09-21，协调者裁定 ①②③④⑤ 见 `progress.md` §5）**：按序修 BUG-005 → BUG-003，
> 并做 BUG-001/002/006 文档口径 + BUG-004 契约侧观察项；BUG-004 的命名空间裁定移交外部仓、本仓不改行为。
> 各条「状态」行已更新，证据/自证命令/涉及文件见各条末尾新增的「修复回合」小节。**除 BUG-004 外本轮状态为「待复测」**
> （BUG-004 = `契约侧观察项已完成 + 外部仓移交`）：置位 ≠ PASSED，须由独立 Tester 实例复测后由协调者标记。
> 本回合修复 commit：`29a0698d1`（`fix(r-phase): BUG-005 测试落点重定向 + BUG-003 构建前置补齐，含契约/任务书口径修正`；
> 本行 hash 由紧随的 hash 回填 commit 记录，见 `git log feature/r-phase`）。

---

## r-phase-BUG-001 · 契约 2.4.1 / 2.1.1 少登记第 6 个公开 i18n API（`getRegisteredTranslations`）

- **状态**：`待复测`（文档失配已按裁定修正；置位 ≠ PASSED，待独立 Tester 复测）
- **严重度**：低（不影响运行时，但影响评审判断口径）
- **量级**：契约文档 2 处表述
  1. §2.4.1（`docs/development/driver-api-dependency-boundary.md:260`）：「公开 API **仅五个**」+ 其下 5 个签名（`:263-269`）
  2. §2.1.1 允许来源表（同文件 `:141`）`@datazen/ui` 行的 i18n 列举：`t` / `useI18n` / `registerTranslations` / `getLocale` / `setLocale`

### 实测证据

```
packages/ui/src/i18n.ts:69   export function getRegisteredTranslations(locale: string): Record<string, string> {
packages/ui/src/index.ts:23-31  →  从 './i18n' 导出 6 个函数：
                              setLocale, getLocale, registerTranslations,
                              getRegisteredTranslations,  ← index.ts:27
                              t, useI18n, type I18nParams
```

真实消费点（证明它是**在用**的公开面，不是死导出）：

```
src/locales/index.ts:11        （import）  getRegisteredTranslations,
src/locales/index.ts:108       return getRegisteredTranslations(isBuiltinLocale(locale) ? locale : 'en');
packages/drivers/redis/ui/__tests__/localePackRegistration.test.ts:26     import { getRegisteredTranslations, t } from '@datazen/ui';
packages/drivers/mongodb/ui/__tests__/localePackRegistration.test.ts:22   import { getRegisteredTranslations, t } from '@datazen/ui';
```

来源可追溯到 Wave 3：`docs/development/coordination/tracks/i18n-drivers/progress.md:89` 已把它登记为
「唯一运行时新增只读快照 …（浅拷贝、未知 locale → `{}`）；**既有 5 个 API 行为零改动**」，
即 Wave 3 有意新增第 6 个 API，但契约文档 §2.4.1 / §2.1.1 未同步（Wave 4 回扫时漏项）。

### 影响

- 评审者按 §2.4.1 会认为运行时只应有 5 个 API，可能把该快照 API 误判成「第二份实现 / 越界能力」；
  反向地，驱动作者按 §2.1.1（驱动可见面权威清单）会误以为该 API 不可用。
- 本轨 R-8 新单测正用到它（见执行记录），若按 §2.4.1 字面执行会被判违规。

### 建议修复方向（择一，不代为决定）

§2.4.1 改「仅六个」并补第 6 行签名；§2.1.1 的 i18n 列举同步补 `getRegisteredTranslations`
（标注只读快照、供工具/测试用）。

### 收尾复核（独立取证，成立）

- 文档侧行号逐条复核：`:260` 确为「公开 API **仅五个**」；`:141` 的 `@datazen/ui` 行 i18n 列举确为
  `t` / `useI18n` / `registerTranslations` / `getLocale` / `setLocale`（**无** `getRegisteredTranslations`）。
- 实现侧逐条复核：`packages/ui/src/i18n.ts:69` 导出 `getRegisteredTranslations`；
  `packages/ui/src/index.ts:23-31` 的 `./i18n` 导出块第 `:27` 行确为 `getRegisteredTranslations`。
- 消费方复核（证明这不是死导出）：`src/locales/index.ts:11`（import）与 `:108`（唯一调用）；
  驱动侧两个 `localePackRegistration.test.ts` 亦 import 该函数；本轨 R-8 新单测（`i18n.test.tsx`）同样在用。
- 结论：**低危文档失配成立**，且属 Wave 3 `i18n-drivers` 有意新增后契约未同步，非本轨引入。

### 修复回合（第 2 轮 Coder，2026-09-21；协调者裁定①）

- **改动文件**：`docs/development/driver-api-dependency-boundary.md`
  - `:260` 「公开 API 仅五个」→「仅六个」，代码块补第 6 行
    `getRegisteredTranslations(locale: string): Record<string, string>;`（行内注释：只读快照（浅拷贝）；未知 locale 返回 `{}`）；
  - 紧随其后新增一条说明 bullet：该 API 为 Wave 3 `i18n-drivers` 轨有意新增，浅拷贝只读快照、不订阅 locale 变化、
    非渲染路径；定义 `packages/ui/src/i18n.ts:69`、导出 `packages/ui/src/index.ts:27`、宿主消费方
    `src/locales/index.ts:11`（import）/`:108`（`getAllTranslations` 唯一调用）、驱动与包内用例
    `packages/drivers/{redis,mongodb}/ui/__tests__/localePackRegistration.test.ts`、`packages/ui/src/__tests__/i18n.test.tsx`；
  - §2.1.1 允许来源表 `@datazen/ui` 行 i18n 列举补 `getRegisteredTranslations`（标注「只读快照，供工具/测试用，见 2.4.1」）。
- **自证**：文档改动，逐条 `Read` 核实定义/导出/消费方行号（`i18n.ts:69`、`index.ts:27`、`locales/index.ts:11,108` 均实读确认）；
  护栏 `node scripts/check-driver-import-boundaries.mjs` 与 `npx vitest run scripts` 不受影响（本回合末次全绿，见 `progress.md` 修复回合节）。
- **提交 hash**：见本文件顶部「第 2 轮修复回合」节所载修复 commit。

---

## r-phase-BUG-002 · 契约 2.4.3「`generated-locales` 生产引用 0 命中」的残留枚举不完整

- **状态**：`待复测`（文档口径已收敛 + 第 4 处残留已登记；置位 ≠ PASSED，待独立 Tester 复测）
- **严重度**：低
- **位置**：`docs/development/driver-api-dependency-boundary.md:295`

### 断言原文

> 实测 `scripts/` / `src/` / `packages/` / `e2e/` 中 `DRIVER_LOCALES`、`generated-locales` 生产引用
> **0 命中**（仅 `AGENTS.md`、`CONTRIBUTING.md`、`.gitignore` 仍留文字残留…）

### 实测复现步骤

```bash
grep -rn 'DRIVER_LOCALES' scripts src packages e2e   # → 0 命中  ✅ 与文档一致
grep -rn 'generated-locales' scripts src packages e2e
#   scripts/check-driver-import-boundaries.mjs:94:  'src/extensions/generated-locales.ts',   ← 文档未枚举的第 4 处
```

即四个被点名的扫描目录里 `generated-locales` 仍有 **1 处命中**，落在护栏脚本自身的
`SKIPPED_CODEGEN_FILES` 常量里（`check-driver-import-boundaries.mjs:92-96`，R3 用来跳过 codegen 注册表）。
文档只枚举了 `AGENTS.md` / `CONTRIBUTING.md` / `.gitignore` 三处**散文**残留，漏了这一处**代码内**残留。

补充实测：
- `src/extensions/generated-locales.ts` **已不存在**（`ls src/extensions/` 只有 `generated.ts`、`generated-pro.ts`）；
- `scripts/resolve-drivers.mjs` 对该名 **0 引用**（codegen 确已移除）✅。

### 根因

该命中由 **Wave 4 `import-guard` 轨自身**新增（护栏脚本写在 `i18n-drivers` 轨测得 0 之后），
属基线过期，非解耦回归。护栏把已不存在的文件名列进 skip-list 是无害的防御性写法。

### 影响

「0 命中」是 §2.7 自查清单引用的基线数字，字面不成立会让下一次抽验得到矛盾结果。

### 建议修复方向

- 措辞收敛为「**生产码** 0 命中」——同批回扫的
  `docs/development/independent-driver-development.zh-CN.md:214` 用的正是「生产码已无该标识符」这一更准的口径；
  并把 `check-driver-import-boundaries.mjs:94` 登记为第 4 处已知残留；
- 或直接从 `SKIPPED_CODEGEN_FILES` 删掉已不存在的 `src/extensions/generated-locales.ts` 条目（属代码改动，需 Coder 承接）。

### 收尾复核（独立取证，成立）

| 复核项 | 命令/位置 | 结果 |
| --- | --- | --- |
| 文档断言原文 | `driver-api-dependency-boundary.md:295` | ✅「`DRIVER_LOCALES`、`generated-locales` 生产引用 **0 命中**」+ 仅枚举 AGENTS/CONTRIBUTING/.gitignore |
| 护栏脚本命中 | `scripts/check-driver-import-boundaries.mjs:92-96`（`:94`） | ✅ `SKIPPED_CODEGEN_FILES` 第 2 条即 `'src/extensions/generated-locales.ts'`（文档未枚举的第 4 处） |
| 产物是否真的不再生成 | `ls src/extensions/` | ✅ 只有 `generated.ts` / `generated-pro.ts` |
| codegen 是否真的 0 引用 | `grep -c generated-locales scripts/resolve-drivers.mjs` | ✅ `0` |

- 结论：**低危文档失配成立**；命中由 Wave 4 `import-guard` 轨自身（护栏脚本晚于 `i18n-drivers` 轨的 0 命中实测）
  引入，属基线过期，非解耦回归。护栏把已不存在的文件名留在 skip-list 是无害的防御性写法。

### 修复回合（第 2 轮 Coder，2026-09-21；协调者裁定①）

- **改动文件**：`docs/development/driver-api-dependency-boundary.md`（§2.4.3 配套终态第 1 个 bullet，原 `:295`）
  - 措辞按「建议修复方向」第 1 条收敛：`DRIVER_LOCALES`、`generated-locales` 后加限定词 →「的**生产码**引用 **0 命中**」，
    并显式引用同批回扫口径 `docs/development/independent-driver-development.zh-CN.md:214`「生产码已无该标识符」；
  - 残留枚举由 3 处扩为 **4 处**：3 处散文/忽略规则（`AGENTS.md`、`CONTRIBUTING.md`、`.gitignore`）+
    1 处代码内常量（`scripts/check-driver-import-boundaries.mjs:94` 的 `SKIPPED_CODEGEN_FILES` 第 2 条），
    并注明该条目由 Wave 4 `import-guard` 轨晚于基线所写、属无害防御性写法。
- **未做（按裁定）**：不改为「删掉 skip-list 条目」方案——**未修改护栏脚本本身**（改它会牵动其 36 例夹具用例的复验）；
  脚本 `:94` 仍保留该字符串 ⇒ 本轮结束后「`generated-locales` 在四个扫描目录内仍有 1 处命中（代码内常量）」，
  文档已如实登记，复测时应以「生产码 0 命中 + 4 处已知残留」为口径。
- **自证**：`grep -rn 'generated-locales' scripts` 仅命中护栏 `:94`（本回合实读 `check-driver-import-boundaries.mjs:92-96` 确认）；
  `npx vitest run scripts` 全绿（护栏 36 例夹具未受影响）。
- **提交 hash**：见本文件顶部「第 2 轮修复回合」节所载修复 commit。

---

## r-phase-BUG-003 · 干净检出上 `cargo test -p datazen --lib` / `run-regression.sh` 步骤 2 直接编译失败（`builtin-ep` 资源目录缺失）

- **状态**：`待复测`（构建前置已按裁定方案 1 修复；置位 ≠ PASSED，须由独立 Tester 以真实场景复测）
- **严重度**：中（不阻断本轨关账——已定位并绕过取证；但破坏 A 门禁第 10 行与合并门禁的**可复现性**，
  任何新 worktree / CI 干净首跑必红）
- **类别**：构建/环境门禁；**非本专项（驱动↔宿主解耦）引入的回归**

### 症状与真实日志

本轨首次执行 `bash scripts/run-regression.sh`（干净 worktree，`--drivers=all` codegen 就绪）：

```
▶ [1/7] node scripts/check-driver-import-boundaries.mjs
✔ node scripts/check-driver-import-boundaries.mjs 通过 (0m00s)
▶ [2/7] cargo test -p datazen --lib [注入+HOME包装+复跑]
error: failed to run custom build command for `datazen v0.2.1 (.../src-tauri)`
Caused by:
  process didn't exit successfully: `.../target/debug/build/datazen-990b9c7130ea4e8c/build-script-build` (exit status: 1)
  --- stdout
  cargo:rerun-if-changed=capabilities
  resource path `resources/builtin-ep` doesn't exist
第 1 轮失败且未解析到 FAILED 用例（可能是编译错误），不复跑。
✘ cargo test -p datazen --lib [注入+HOME包装+复跑] 失败 (exit=101, dur=1m16s)
```

### 根因链（逐条实测）

1. `src-tauri/tauri.conf.json:58` **无条件**声明 bundle 资源：`"resources/builtin-ep": "builtin-ep"`
   （另有 `:33` 的 CSP/FS 白名单项 `"$RESOURCE/builtin-ep/**/*"`）。
2. 该目录被 gitignore：`.gitignore:69  src-tauri/resources/builtin-ep/` ⇒ **干净检出上不存在**。
3. Community 构建路径上无任何脚本创建它：`scripts/resolve-pro.mjs` 只在 `--edition=pro`
   分支 `mkdirSync`（`:282`、`pack-ep.mjs:377`），`--codegen-only` 与 `with-driver-inject.mjs`
   都不建；`clearBuiltinEpStaging()`（`resolve-pro.mjs:264-270`）只删子目录。
4. tauri-build 构建脚本对声明的资源做存在性校验 ⇒ 编译期失败，与测试代码无关。

### 对照实验（证明因果）

| 条件 | 命令 | 结果 |
| --- | --- | --- |
| `src-tauri/resources/builtin-ep/` **不存在** | `bash scripts/run-regression.sh` | 步骤 2 `exit=101`，`resource path` 报错 |
| 该空目录**存在** | 同命令复跑 | **7/7 全绿**（步骤 2 通过 0m17s） |
| 该空目录存在 + 独立 target | `with-driver-inject(basic) … cargo test -p datazen --lib` | `test result: ok. 1453 passed; 0 failed; 3 ignored` |

### 判定：非本专项回归

- 该资源项由 `098f2e8b9 feat(pro): switch editor-pro packaging to track B (builtin-ep runtime bundle)`
  （2026-09-16）引入，是本分支的**祖先提交**；
- `git log d250e52de~1..HEAD -- src-tauri/tauri.conf.json` **无任何输出** ⇒ Wave 1~4-A 全部提交
  均未触碰 `tauri.conf.json`。

### 影响范围

- `scripts/run-regression.sh`（AGENTS.md 认可的合并前全量门禁）在**新 worktree 首跑**必红；
  其步骤 2 的复跑兜底只处理「有 FAILED 用例」的情况，编译错误直接放弃。
- 主检出 `/Users/wuxiaolong/code/rust-projects/datazen/src-tauri/resources/builtin-ep/` 实测已存在
  （空目录），所以主检出上不会复现——这正是「只在别人的干净检出上炸」的形态。

### 建议修复方向（择一，需 Coder 承接，本轨不动 `src-tauri/**`）

1. 在 `scripts/resolve-drivers.mjs`（或 `with-driver-inject.mjs`）**无条件** `mkdir -p src-tauri/resources/builtin-ep`，
   使 Community 构建自带该前置；或
2. 让 `resources/builtin-ep` 项仅在 `--edition=pro` 时由 `resolve-pro.mjs` 注入 `tauri.conf.json`
   （需同步 `tauri.conf.json.host` 之类的受跟踪源文件策略）；或
3. 最低成本：在 `run-regression.sh` 步骤 2 之前补一次空目录创建，并在脚注「已知副作用」登记该前置。

### 收尾复核（独立取证，成立；补一条关键掩蔽事实）

| 复核项 | 命令/位置 | 结果 |
| --- | --- | --- |
| 资源声明无条件 | `src-tauri/tauri.conf.json:58`（另 `:33` CSP/FS 白名单） | ✅ `"resources/builtin-ep": "builtin-ep"` 无 edition 条件 |
| 目录被 gitignore | `.gitignore:69` | ✅ `src-tauri/resources/builtin-ep/` |
| 社区路径无脚本创建 | `scripts/` 全量 `builtin-ep` 命中逐条核对 | ✅ 仅 `resolve-pro.mjs`（stage/prebuilt 路径）与 `pack-ep.mjs`（常量定义）、`ci-tauri-build.mjs`（Pro pre-flight 校验）会碰它；`resolve-drivers.mjs` 的 `mkdirSync` 只作用于驱动目录与 generated 文件目录 |
| 非本专项引入 | `git log -1 -- src-tauri/tauri.conf.json` | ✅ 最近改动 = `098f2e8b9`（2026-09-16，本分支祖先） |

- **掩蔽事实（新）**：`scripts/__tests__/resolve-pro.test.ts` 会 `mkdirSync(DEFAULT_BUILTIN_EP_ROOT)`（真实仓库路径），
  因此**任何先跑过 `npx vitest run scripts` / `npx vitest run` 的检出上该空目录已被顺带创建**，
  步骤 2 的编译失败被静默掩蔽；BUG-005 记录了同一批测试的另一面副作用。判定不受影响（BUG-003 的
  对照实验是在显式删除该目录后做的），但「新 worktree 首跑必红」的触发顺序应按此收窄为
  「**在该目录从未被创建过的检出上**必红」。（注：该掩蔽通道随 BUG-005 修复已关闭——第 2 轮修复回合后
  `npx vitest run scripts` 不再创建/改写任何真实仓库路径，见 BUG-005 修复回合。）

### 修复回合（第 2 轮 Coder，2026-09-21；协调者裁定②，按序在 BUG-005 之后执行）

- **改动文件**：`scripts/resolve-drivers.mjs` —— `main()` 首行新增**无条件、幂等**的
  `mkdirSync(resolve(ROOT, 'src-tauri', 'resources', 'builtin-ep'), { recursive: true })`
  （附 3 行 WHY 注释：`tauri.conf.json` 无条件声明 `resources/builtin-ep`、该目录被 `.gitignore` 排除、
  tauri-build 对声明资源做存在性校验 ⇒ 干净检出直接编译失败；而所有 cargo 前路径——CI、
  `run-regression.sh` 步骤 2（经 `with-driver-inject.mjs` 调用本脚本）、worktree bootstrap、postinstall codegen
  ——都先跑本脚本）。放在 `main()` 顶部（`--restore` 早退之前），故对全部 CLI 调用无条件生效。
- **硬性约束遵守**：未修改任何 `src-tauri/` 下的被跟踪文件（`tauri.conf.json` / capabilities / Cargo.toml / Cargo.lock 均未动，
  运行期只创建 gitignored 资源空目录）；未改 `clearBuiltinEpStaging` 删除语义（仍只删子目录，保持现状）；
  未放宽任何护栏。
- **先红（真实输出）**：
  ```
  $ rm -rf src-tauri/resources/builtin-ep && test -d src-tauri/resources/builtin-ep || echo DIR_REMOVED
  DIR_REMOVED
  $ CARGO_TARGET_DIR=/tmp/datazen-rphase-target node scripts/with-driver-inject.mjs --drivers=basic -- \
      env HOME="$PWD/.regression-home" CARGO_HOME="$HOME/.cargo" RUSTUP_HOME="$HOME/.rustup" \
      cargo test -p datazen --lib
  Compiling datazen v0.2.1 (.../src-tauri)
  error: failed to run custom build command for `datazen v0.2.1 (...)`
    --- stdout
    cargo:rerun-if-changed=capabilities
    resource path `resources/builtin-ep` doesn't exist
  EXIT=101
  ```
  （热 target 下**仍复现**：注入了驱动特性导致 Cargo.toml 变化，build.rs 被重跑 ⇒ 无需 cargo clean。
  注意 `HOME` 沙箱必须同时显式传 `CARGO_HOME` / `RUSTUP_HOME`，否则 rustup 找不到默认工具链、报的会是
  「rustup could not choose a version of cargo」而非真实缺陷——本回合首次尝试即踩到此点，已在命令中修正。）
- **后绿（真实输出）**：
  ```
  $ rm -rf src-tauri/resources/builtin-ep
  $ node scripts/resolve-drivers.mjs --codegen-only --drivers=all      # exit 0
  $ test -d src-tauri/resources/builtin-ep && echo DIR_OK
  DIR_OK
  $ <同一 cargo 命令>
  test result: ok. 1453 passed; 0 failed; 3 ignored; 0 measured; 0 filtered out; finished in 3.88s
  EXIT=0
  ```
- **追加自证（覆盖 `run-regression.sh` 步骤 2 的真实形态）**：再次 `rm -rf` 后**直接**跑
  `with-driver-inject --drivers=basic … cargo test -p datazen --lib`（不预跑 codegen）⇒ exit 0 /
  `1453 passed; 0 failed; 3 ignored`，且目录被脚本自动补齐（`DIR_OK_AFTER_INJECT_PATH`）。
- **单测化说明（非强制项，如实说明未做）**：未新增单测。原因：任何「断言该目录存在」的用例本身会在
  `npx vitest run scripts` 期间把该目录造出来，与 BUG-005 修复要求「跑完套件该目录零变化」直接冲突；
  且本缺陷的判定场景是「删目录 → codegen → cargo」，由复测 Tester 以真实场景独立验收更可靠。
- **提交 hash**：见本文件顶部「第 2 轮修复回合」节所载修复 commit。

---

## r-phase-BUG-004 · 任务书 B 表 R-5 前提失实：Pro EP **确有**自带词条，且与宿主共用 `query.*` 前缀（非 N/A）

- **状态**：`契约侧观察项已完成 + 外部仓移交`（契约 §2.4.4 观察项 + §2.4.3 交叉引用均已登记；命名空间是否收敛为 `pro.*` 移交 `sql-editor-pro` 外部仓裁定；本仓行为零改动）
- **严重度**：低（当前无用户可见后果），但直接导致 R-5 若按 N/A 关账会漏掉一个真实观察项

### 断言原文（`tracks/r-phase/progress.md:48`，B 表 R-5 行）

> Pro/EP 与 wapp 自带词条时 `registerTranslations` 无前缀冲突 | **现状无自带词条** → 记 N/A，并在契约文档留观察项

### 实测：前提不成立

在**主检出**（唯一存在 gitignored 外部树的地方）只读核实：

```bash
ls packages/pro-extensions/sql-editor-pro/src/locales/
#   __tests__   en.ts   index.ts   zh-CN.ts        ← EP 自带 2 语言词条
grep -c "^\s*'[^']+':" packages/pro-extensions/sql-editor-pro/src/locales/en.ts
#   26                                            ← 26 个自有 key
```

`packages/pro-extensions/sql-editor-pro/src/locales/index.ts:11` 确实在做自注册：

```ts
import { getLocale, registerTranslations, t, useI18n } from '@datazen/ui';   // :5
registerTranslations({ en, 'zh-CN': zhCN });                                  // :11
```

### 前缀冲突实测

EP 的 26 个 key 全部落在 `query.*` 命名空间；宿主 `src/locales/` 另有 **322** 个 `query.*` key。取交集：

```
query.params                            宿主 en = 'Parameters'                          EP en = 'Parameters'                        （同值）
query.paramValue                        宿主 en = 'Value'                               EP en = 'Value'                             （同值）
query.editor.param.historyLabel         宿主 en = 'Recent values'                       EP en = 'Recent values:'                    （**异值**）
query.editor.param.clearHistory         宿主 en = 'Clear history for this parameter'     EP en = 'Clear parameter history'           （**异值**）
query.editor.drop.crossConnection       宿主 en = 'Cannot drop objects from …'           EP en = 'Cannot drop table from …'          （**异值**）
```

（zh-CN 侧 5 个 key 全部异值，例：`query.params` 宿主 `'绑定参数'` vs EP `'参数'`。）

**为什么当前无用户可见后果**（这是判低严重度的依据，不是免罪依据）：

```bash
grep -rn "query\.params\|query\.paramValue\|query\.editor\.param\.\|query\.editor\.drop\.crossConnection" src --include='*.tsx' --include='*.ts' | grep -v src/locales
#   （0 命中）← 宿主组件不消费这 5 个 key，它们是宿主字典里的孤儿条目
grep -rn … packages/pro-extensions/sql-editor-pro/src | grep -v locales
#   sql-editor-pro/src/bind-params/BindParamPanel.tsx:67,201,257,263
#   sql-editor-pro/src/paste/dropCaret.ts:325      ← 真实消费方是 EP 自己
```

### 潜在风险（须留观察项的原因）

`registerTranslations` 是**后写覆盖 + 逐 key 合并**（契约 §2.4.1 明确语义），且 EP 在宿主 eager 注册**之后**
才经 `globalThis.__DATAZEN_HOST__` 单例注册。因此这 5 个 key 目前由 EP 静默覆盖宿主词条；
一旦宿主将来恢复/新增任一 `query.editor.param.*` 消费点，在装了 Pro 的构建里会拿到 EP 的文案，
Community 构建里拿到宿主文案 ⇒ 同一 UI 双版本不一致，且无任何静态检查会红。

契约 §2.4.4 的「前缀互斥」原则目前**只对驱动词条**强制（原文：「驱动词条 key 必须带驱动自有前缀」），
对 EP/wapp 未作同等要求，这正是 R-5 需要留档的规则缺口。

### wapp 一侧

`grep -rln 'registerTranslations' packages/wapps` → **0 命中**，wapp 确实尚无自带词条 ✅
（即 R-5 的后半句对 wapp 成立，对 Pro EP 不成立）。

### 建议处置

1. R-5 终态由 `N/A` 改为「Pro EP 侧：实测已存在自带词条 + 5 个 `query.*` 与宿主共用命名空间（宿主 0 消费方，
   暂无后果），移交 editor-pro 仓裁定是否改 `pro.*` 前缀；wapp 侧：N/A」；
2. 观察项登记落点（**本轨不改代码、不改契约文档**）：
   - **主落点 §2.4.4「key 命名与类型」**——把只对驱动强制的「前缀互斥」条款补一句 EP/wapp 的同等要求或明确豁免裁定；
   - **交叉引用 §2.4.3 表格「Pro 扩展词条」行**——该行现只写注册方式，未提命名空间归属；
   - 同步在 `tracks/r-phase/progress.md`「开放项」加一条外部仓漂移移交项（与 superset R1×2 / editor-pro R2×6 并列）。

### 收尾复核（独立取证，成立）

- EP 侧：主检出 `packages/pro-extensions/sql-editor-pro/src/locales/` = `en.ts` / `zh-CN.ts` / `index.ts` / `__tests__`；
  `en.ts` 自有 key **26**；`index.ts:5` import `@datazen/ui`、`:11` `registerTranslations({ en, 'zh-CN': zhCN })` ✅。
- 前缀交集复核（本轮重取）：EP 26 key 全部 `query.*`；宿主 `src/locales/**` 去重后 `query.*` = **322** 个；
  5 个同名 key 中 en 侧 2 同值 3 异值、zh-CN 侧 5 个全部异值（宿主 `src/locales/{en,zh-CN}/query.ts`：
  `'query.params'` = Parameters/绑定参数、`'query.editor.param.historyLabel'` = Recent values/最近使用的值、
  `'query.editor.param.clearHistory'` = Clear history for this parameter/清除此参数的历史记录、
  `'query.editor.drop.crossConnection'` = Cannot drop objects from a different connection/不能从其他连接拖入对象；
  EP 侧对应 `Parameters`/参数、`Recent values:`/最近使用：、`Clear parameter history`/清除参数历史、
  `Cannot drop table from a different connection`/无法从不同连接拖放表或列）✅。
- wapp 侧：主检出与 worktree 的 `packages/wapps/**` 内 `registerTranslations` / `@datazen/ui` 均 **0 命中** ✅
  （比前任证据更宽：主检出含全部 wapp 包）。
- 结论：**R-5 的 N/A 前提失实成立**，须按「建议处置」改判。

### 修复回合（第 2 轮 Coder，2026-09-21；协调者裁定③：契约侧观察项 + 外部仓移交）

- **涉及文件（均为文档，零行为改动）**：
  - `docs/development/driver-api-dependency-boundary.md` §2.4.4「key 命名与类型」：新增**观察项**条目（26 key = 24 `query.*` + 2 `settings.editor.intention*`；5 个同名 key 列名；en 3 异值/2 同值、zh-CN 5 全部异值；宿主侧 0 消费方；`registerTranslations` 后写覆盖语义下的 Pro/Community 分歧风险；处置=移交 editor-pro 仓裁定是否收敛 `pro.*`，本契约对 EP/wapp **不加**强制前缀要求；wapp 侧 0 命中）。
  - 同文件 §2.4.3 表格「Pro 扩展词条」行：追加交叉引用「与宿主 key 同名时的覆盖语义与处置见 2.4.4 观察项（BUG-004）」。
  - `tracks/r-phase/progress.md` §5 裁定⑤：R-5 终态由 `N/A` 改为「Pro EP 侧：实测已存在自带词条 + 5 个 `query.*` 与宿主共用命名空间（宿主 0 消费方，暂无后果），移交 editor-pro 仓裁定；wapp 侧：N/A」。
- **数字独立复取**（Grep 工具 + 主检出只读）：EP `en.ts` 自有 key 26（含 2 个非 `query.*`，同时修正原报告「26 个 key 全部落在 `query.*`」的措辞，结论不变）；宿主 `src/locales/**` 去重后 `query.*` = 322；5 个同名 key 在宿主 `src/**`（除 `src/locales`）消费 = 0 命中；`packages/wapps/**` 内 `registerTranslations` / `@datazen/ui` = 0 命中。
- **明确不做**：不改本仓任何运行时代码/词条；不代外部仓决定是否加 `pro.*` 前缀；不因该观察项给 EP/wapp 增加强制条款（在契约中已明文写「不构成强制条款」）。
- **提交 hash**：见本文件顶部「第 2 轮修复回合」节所载修复 commit。

---

## r-phase-BUG-005 · `scripts/__tests__/resolve-pro.test.ts` 直接读写**真实仓库路径**（`src-tauri/resources/builtin-ep/` 与 `src/extensions/generated-pro.ts`）

- **状态**：`待复测`（已按裁定方案 1 修复：测试全部落点重定向到 `mkdtempSync` 沙箱，跑套件对仓库零写入；置位 ≠ PASSED，待独立 Tester 复测）
- **严重度**：中（不阻断门禁，但会静默破坏他人工作区状态、并让 `run-regression.sh` 后续步骤跑在与干净检出不同的 edition 态上）
- **归属**：既有提交 `9a9da0bbb test(ep-packaging-ci): verify pack-ep and resolve-pro with coverage tests`（本分支祖先，非 Wave 1~4 任一轨）

### 机制（读源码即可确认）

```text
scripts/pack-ep.mjs:38      export const DEFAULT_BUILTIN_EP_ROOT = resolve(ROOT, 'src-tauri/resources/builtin-ep');
                            // ROOT = 仓库根（真实路径，非 tmp）
resolve-pro.test.ts:181-189  mkdirSync(join(DEFAULT_BUILTIN_EP_ROOT,'sql-editor-pro')) → resolvePro({edition:'community'}) 清空
resolve-pro.test.ts:214-219  mkdirSync + 写 marker.txt → clearBuiltinEpStaging()
resolve-pro.test.ts:252-254  rmSync(join(DEFAULT_BUILTIN_EP_ROOT,'sql-editor-pro'), {recursive,force})   ← 先删真实暂存树
resolve-pro.test.ts:276-289  writeFixtureExtension(真实路径) / 若主检出存在 EP 源则 resolvePro({edition:'pro'}) 真签名 staging 后 clearBuiltinEpStaging()
resolve-pro.test.ts:239-246  resolvePro({edition:'pro', codegenOnly:true}) → 覆写 GENERATED_PRO_TS = src/extensions/generated-pro.ts
```

### 收尾实例实测（本轨，2026-09-21 11:16）

```
$ npx vitest run scripts/__tests__/resolve-pro.test.ts        # 24 passed
跑前：src/extensions/generated-pro.ts mtime=11:15:37；builtin-ep/ mtime=11:15
跑后：src/extensions/generated-pro.ts mtime=11:16:53；builtin-ep/ mtime=11:16
vitest 输出： [resolve-pro] removed staged builtin-ep at
              /Users/.../datazen-r-phase/src-tauri/resources/builtin-ep/sql-editor-pro
git status： 无新增（两处产物均 gitignored）
```

### 后果

1. 这两个路径都是 **gitignored 产物/暂存目录**，所以 `git status` 永远干净、CI 不会红，问题不可见；
2. 本地若存在**真实 Pro staging**（`pnpm tauri:dev:pro` / `tauri:build:pro` 后），跑一次 `npx vitest run scripts`
   （或 `npx vitest run` / `run-regression.sh` 步骤 3）就会把它**删除**，并让 next build 重新 stage；
3. `src/extensions/generated-pro.ts` 被就地改写为当前用例走过的 edition（本轮结束态 `DATAZEN_EDITION = 'pro'`），
   使 `run-regression.sh` 步骤 7 `npx vite build` 的输入与干净检出不再一致（步骤 6 tsc、步骤 7 vite 都读它）；
4. 与 BUG-003 相互作用：步骤 3 先于步骤 2 不存在，但**任何手动先跑单测的检出**都会把 `builtin-ep/` 空目录造出来，
   把 BUG-003 的编译失败掩蔽掉（见 BUG-003 收尾复核）。

### 建议修复方向（择一，需 Coder 承接；本轨不改代码）

1. 测试内改用 `stageDir` / 环境变量把落点重定向到 `mkdtempSync` 临时目录（`resolvePro` / `clearBuiltinEpStaging` /
   `stageProExtension` 已具备 path 参数或 `stageDir` 覆写能力，改造面小）；
2. 若因「必须验证真实默认路径」而刻意保留，则在 `run-regression.sh` 脚注「已知副作用」登记该行为，
   并在 Pro 构建文档里提示「跑脚本单测前先备份 staging」；
3. 最低成本：把 `GENERATED_PRO_TS` 与 `DEFAULT_BUILTIN_EP_ROOT` 在测试内 stub 到 tmp（vitest `vi.mock` 已有先例）。

### 修复回合（第 2 轮 Coder，2026-09-21；协调者裁定④，本回合第一项）

- **涉及文件**：
  - `scripts/resolve-pro.mjs`：新增显式 path 覆写参数（省略时**逐字节等价历史默认值**，无全局可变状态、不放松任何生产校验）：
    - `clearBuiltinEpStaging(extension = 'sql-editor-pro', { stageDir } = {})` → 默认 `builtin-ep/<extension>`，删除语义不变（仍只删该子目录，`{recursive,force}`）；
    - `downloadPrebuiltEp({ ..., stageDir })` → 默认同上；
    - `stageProExtension({ ..., stageDir, outDir })` → 透传 pack-ep 既有的 `stageDir` / `outDir`（`scripts/pack-ep.mjs:314/:445` 原本就支持，故 `pack-ep.mjs` **无需改动**）；
    - `ensureProCheckout({ ..., proDest = DEFAULT_PRO_DEST, tmpFallbackDir = '/tmp/datazen-extension-sql-editor-pro' })` → 内部所有 `DEFAULT_PRO_DEST` 引用改走 `proDest`；
    - `resolvePro({ ..., codegenPath, stageDir, outDir })` → `codegenPath` 默认 `GENERATED_PRO_TS`（`resolve-pro.mjs` 内常量，即 `src/extensions/generated-pro.ts`），`stageDir` 默认 `null` ⇒ 回落 `builtin-ep/sql-editor-pro`；所有 `GENERATED_PRO_TS` / `DEFAULT_BUILTIN_EP_ROOT` 内部引用点均改走参数，默认分支行为与修复前完全一致（已逐行复核 diff）。
  - `scripts/__tests__/resolve-pro.test.ts`：
    - 模块级 `makeSandbox()`：`mkdtempSync(join(tmpdir(), 'resolve-pro-sandbox-'))`，派生 `stageDir`（`<tmp>/builtin-ep/sql-editor-pro`）、`codegenPath`（`<tmp>/generated-pro.ts`）、`outDir`（`<tmp>/artifacts`）与 `rm()`；
    - 「staging and edition flows」`describe` 下全部 9 个用例（community/restore/clear/stage/pro-codegenOnly/已暂存树/真实 fixture staging/preserve/ensureProCheckout×2）的读写删目标全部改为沙箱路径，`finally { sb.rm() }` 清理；
    - 新增 2 例（计数 24 → 26）：`test_tester_default_staging_and_codegen_paths_stay_repo_relative`（**纯值断言**：`GENERATED_PRO_TS` / `DEFAULT_BUILTIN_EP_ROOT` 为绝对路径且分别以 `src/extensions/generated-pro.ts`、`src-tauri/resources/builtin-ep` 结尾，不做任何写操作）与 `test_tester_ensureProCheckout_returns_null_in_codegen_only_without_checkout`（用 `proDest` / `tmpFallbackDir` 覆写构造确定性分支，替代原「依赖本机是否恰好存在主检出」的环境相关分支）。
- **修复前实测（red，2026-09-21）**：
  ```
  $ npx vitest run scripts/__tests__/resolve-pro.test.ts        # 24 passed
  # stdout 含： [resolve-pro] removed staged builtin-ep at
  #   /Users/.../datazen-r-phase/src-tauri/resources/builtin-ep/sql-editor-pro   ← 删除真实暂存树
  # src/extensions/generated-pro.ts mtime 11:15:37 → 11:16:53（被就地覆写为 pro）
  ```
- **修复后实测（green）**：快照对比（跑前/跑后分别对 `src/extensions/generated-pro.ts`（stat + md5）与 `src-tauri/resources/builtin-ep/` 全树（stat + 逐文件 md5）取样）⇒ `IDENTICAL_ZERO_CHANGE`（逐字段 diff 为空）；目录/文件跑前跑后均为**存在且逐字节不变**。
  ```
  $ npx vitest run scripts
  Test Files  23 passed (23)
       Tests  246 passed (246)      ← 与修复基线 244 相比 +2 为本回合新增的 2 例值断言/确定性分支用例
  ```
- **不放松保障的说明**：`ensureProCheckout` 的 `proDest` 覆写只在调用方显式传入时生效，`resolvePro` 的主流程（clone / prebuilt 下载 / staging / codegen 写入）在所有 CLI 与 CI 调用点均不传这些新参数，路径与修复前相同；`clearBuiltinEpStaging` 删除范围仍严格限定为 `stageDir/<extension>` 子目录。
- **提交 hash**：见本文件顶部「第 2 轮修复回合」节所载修复 commit。

---

## r-phase-BUG-006 · 任务书验收标准 4 的静态口径与契约 §2.4.2 的精确豁免/调用点不一致（口径校正，非契约缺陷）

- **状态**：`待复测`（任务书验收标准 4 已按契约 §2.4.2 精确口径改写；契约本身**无误**、未改；置位 ≠ PASSED，待独立 Tester 复测）
- **严重度**：低（照字面执行会得到 2 处「假阳性」，与 §2.4.2 明文冲突，影响评审判断）

### 断言原文（`tracks/r-phase/progress.md` 验收标准 4）

> `packages/**`（除 `packages/ui/src/i18n.ts`）内 `setLocale(` 调用数 = 0；宿主唯一调用点在 `src/lib/localeSync.ts`。

### 实测（收尾实例，codegen=all）

| 断言 | 实测 | 差异 |
| --- | --- | --- |
| `packages/**` 除 `i18n.ts` 外 `setLocale(` = 0 | `packages/ui/src/__tests__/i18n.test.tsx` 有调用（R2_FILE_CARVEOUTS 第 2 个文件；契约 §2.4.2 明文列为合法豁免） | 口径漏了第二个豁免文件（本轨 R-8 新增 4 例后又 +8 处调用，仍全在豁免文件内） |
| 宿主唯一调用点 = `src/lib/localeSync.ts` | 生产码实为 **2 个文件**：`src/lib/localeSync.ts:20,24`（唯一接线点）+ `src/locales/index.ts:78,82`（`getTranslation` 临时换 locale 适配器，契约 §2.4.2 `:279` 明文承认且允许，非渲染路径） | 口径漏了 §2.4.2 已文档化的第 2 处 |

- 另：`src/**` 内还有 3 个测试文件调用 `setLocale(`（`src/lib/__tests__/localeSync.tester.test.tsx`、
  `src/lib/__tests__/localeSync.test.tsx`、以及 `retest-round1-fixes.tester.test.tsx` 中的注释行），
  均属宿主测试、不在 R2 管辖范围内。
- 结论：**契约无需修改**；建议协调者把验收标准 4 改写成与 §2.4.2 一致的精确口径
  （「`packages/**` 内 `setLocale(` 仅命中 `R2_FILE_CARVEOUTS` 两个文件；宿主生产码调用点 =
  `src/lib/localeSync.ts`（唯一接线）+ `src/locales/index.ts` 的文档化临时适配器」）。

### 修复回合（第 2 轮 Coder，2026-09-21；协调者裁定⑤：与 BUG-004 同批）

- **涉及文件**：`docs/development/coordination/tracks/r-phase/progress.md`「验收标准 4」逐条改写为三句精确口径（对齐契约 §2.4.2 原文）：
  1. `packages/drivers/*/ui/**` 内 `@datazen/host` / `@/` 宿主源说明符命中 = 2 条（`ALLOWLIST` 两条三元组，保留），引用 `redisKeyWebContextMenu.test.tsx:5,9`；
  2. `packages/**` 内 `setLocale(` 命中仅限 `R2_FILE_CARVEOUTS` 两个文件（`packages/ui/src/i18n.ts:34` 与 `packages/ui/src/__tests__/i18n.test.tsx`）；
  3. 宿主**生产码**调用点 = `src/lib/localeSync.ts`（`:20`/`:24`，唯一接线）+ `src/locales/index.ts`（`:78`/`:82`，§2.4.2 文档化的临时换 locale 适配器，非渲染路径）。
- **明确不做**：不改契约文档（本缺陷契约无误）；不改 `src/locales/index.ts` 行为。
- **自证**：改写后的三条口径与 `scripts/check-driver-import-boundaries.mjs` 实测输出一一对应（R1 = 2 条 allowlist 命中；R2 非豁免命中 = 0），见 `progress.md`「第 2 轮修复回合」节所载命令与输出。
- **提交 hash**：见本文件顶部「第 2 轮修复回合」节所载修复 commit。
