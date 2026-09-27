# Track: worktree-script — 修复 `scripts/new-feature-worktree.sh`，让新轨道开箱即用

- 分支: `feature/worktree-script`（基准 `feature/editor-productivity` @ 9d1e9062d）
- 角色: Coder
- 性质:**纯编排基础设施轨**，唯一改动文件为 `scripts/new-feature-worktree.sh`（449+/42-），零业务代码改动
- Phase: **READY_FOR_TEST**（本轨只交付脚本，须由独立 Tester 复测后才能 PASSED）

## 背景

连续四次（Track C / B / scripts-gate / folding）派代理，每个代理都在干净 worktree 里撞同一批缺件，
各自花时间确认「这批失败不是我造成的」。本轨把「铺」与「说」写进脚本本身。

## 环境事实（先复核再动手，全部为**真实管线实测**）

在本轨 worktree（`feature/editor-productivity` @ 9d1e9062d）内 `npx vitest run` 跑完整宿主套件：

```
Test Files  1 failed | 479 passed (480)
     Tests  4 failed | 4813 passed | 3 skipped (4820)
```

4 例失败**全部**是同一根因，且全在
`packages/extension-points/src/__tests__/security.test.ts > EXTENSION_POINTS_VERSION 1.1.0 contract`：

```
ENOENT: no such file or directory, open '<worktree>/packages/pro-extensions/sql-editor-pro/manifest.json'
```

### 缺件 1：Pro 检出缺失（4/4 例失败的唯一根因）

- Pro 是独立 git 仓，主仓 `.gitignore` 忽略 `packages/pro-extensions/`，**按设计在 worktree 中不存在**。
- 该失败是**环境缺件**而非缺陷：本次实测中，把 Pro 检出补上后同一测试文件即全绿（见「验收 1」）。
- 危险点：它长得像断言失败，极易被代理记成自己引入的缺陷。

### 缺件 2：`src/extensions/generated-locales.ts` —— **与登记的「大面积失败」不符，按实况纠正**

- **真实管线实测**：本次全套件只有上述 4 例失败，**没有任何一例由 `generated-locales.ts` 缺失引起**。
- **机制论证（较弱，仅作解释）**：`generate-builtin-locales.mjs` 实测产出的是
  `src/locales/builtinLocales.ts`（实测输出行：`[generate-builtin-locales] wrote .../src/locales/builtinLocales.ts`），
  与 `src/extensions/generated-locales.ts` 是两个文件——登记里「不是同一个文件」这点**属实**。
- 但该产物的 codegen 已被 `i18n-drivers` 轨删除（`docs/development/driver-api-dependency-boundary.md:297`
  记录生产引用 0 命中；`scripts/resolve-drivers.mjs` 内 `generated-locales` 实测 0 命中）。
  本轨独立 grep 复核（`grep -rIn "generated-locales"`，排除 node_modules/.worktrees/dist/.git）：
  生产码唯一命中是 `scripts/check-driver-import-boundaries.mjs:94` 的 `SKIPPED_CODEGEN_FILES` 常量。
- **处置**：仍拷贝（与开发机保持同一份文件状态），但报告里**显式标注「已退役产物、当前无生产引用」**，
  避免下一个代理在这上面建错误因果。

### 缺件 3：Pro 的 `productivity/*` 分支远端不存在

- **真实管线实测**：主检出的 Pro 仓 `git branch -r` 仅有 `origin/main`、`origin/codex/qb-editor-pro`；
  `productivity/{editor-productivity,ep-hooks-settings,ep-runtime-globals,code-folding}` 只在本地。
  按远端 URL clone 拿不到这些分支。
- **处置**：脚本以**主检出的 Pro 检出作为 local remote** 克隆。实测克隆件的
  `git branch -r` 出现了 `origin/productivity/*` 全部 4 条（见「验收 1」证据 D）。

### 缺件 4：脚本自身失败不留痕

见下文 C。

## 改动：scripts/new-feature-worktree.sh

### A. 自动铺（每项独立失败，互不影响）

| 层 | 动作 | 失败时 |
| --- | --- | --- |
| 1 | `resolve-drivers --codegen-only --drivers=basic` | 记入「未铺成」+ 手动命令 + 后果，脚本继续 |
| 2 | `generate-builtin-locales`（产出 `builtinLocales.ts`） | 同上 |
| 3 | `src/extensions/generated-locales.ts` 从主检出拷贝 | 同上，并标注「已退役产物」 |
| 4 | Pro 检出（local remote 克隆 + 分支映射） | 同上，**不拖垮整个脚本** |
| 5 | Pro `node_modules` 软链 / 未跟踪规格文档 / `e2e/.env` / `tracks/<track>/` | 同上 |

**Pro 分支映射规则**（写死在脚本注释里，不硬编码某一条）：

```
宿主 feature/<slug>  →  Pro productivity/<slug>  →  Pro feature/<slug>  →  Pro main
```

`DATAZEN_PRO_BRANCH` 可显式覆盖。**机制论证（较弱）**：规则正确性的依据是 4 组同名前缀的
独立对应（`feature/editor-productivity`↔`productivity/editor-productivity` 等）；脚本对每个候选
都用 `show-ref --verify` 探测**源 Pro 仓是否真的有该分支**，不存在就顺延，不臆造。

**契约版本交叉核对（新增，实测抓到真实陷阱）**：Pro 落在 `main` 上时 `manifest.json` 的
`engines.extensionPointsVersion=1.0.0`，而本分支宿主 `packages/extension-points/src/security.ts`
是 `1.1.0`。**真实管线实测**：此时同一测试文件由「4 例 ENOENT」变成「2 例断言失败」
（`expected '1.0.0' to be '1.1.0'`）——失败签名换了，更容易被误记成缺陷。脚本因此在铺完 Pro 后
比对两侧版本，不一致就进「未铺成」并指名会失败的用例。

### B. 铺不了就大声说

结尾固定输出 `环境铺装报告 / ENVIRONMENT PROVISIONING REPORT`，逐项给出
**已铺好 / 未铺成 + 原因 + 可复制的手动命令 + 不补的后果**。Pro 缺失时的后果文案里，
用例数由脚本 awk 实测该文件的 `describe` 块得出（不是写死 4），并明写
「该失败与你的改动无关，请勿记为缺陷」。

### C. 失败回滚，不删用户已有工作

- 前态快照：`PRE_BRANCH_EXISTS`（调用前分支是否已存在）、`CREATED_WT`。
- **致命步骤**（`worktree add` / `node_modules` 软链）失败 → `rollback()`：
  移除本次创建的 worktree（**内含未提交改动时不强删**，改为打印清理命令）、
  仅删除本次创建的分支（`PRE_BRANCH_EXISTS=0` 时）、未登记的裸目录一并清掉。
- EXIT trap 兜底：任何未预期失败同样触发回滚。
- `NEW_WT_ROLLBACK=0` 时改为**明确保留并打印「这是半成品，清理命令是 X」**。
- 入口守卫：worktree 路径必须落在 `${MAIN}/.worktrees/` 下，否则直接 `die`。
- 前置检查发现「目录已存在但未登记」时**拒绝删除**并给出人工命令（不猜是不是你的工作）。

### D. `MAIN` 解析稳健（嵌套创建的根因）

- 旧代码 `MAIN="$(git rev-parse --show-toplevel)"` —— 直接采信调用方 cwd。
- 新代码 `resolve_main_checkout()`：① 脚本自身位置 `<script>/..`；② 回退
  `git rev-parse --path-format=absolute --git-common-dir` 反推（从任意 linked worktree 调用都能回到主检出）；
  ③ 都不是主检出 → 直接报错退出。
- `is_main_checkout()` 判据：根下 `.git` 是**目录**，且 `git-dir == git-common-dir`
  （linked worktree 的 `.git` 是文件且 `git-dir` 指向 `.git/worktrees/<name>`）。
- 落地后自检：必须命中 `git worktree list` 且 HEAD 分支正确，否则回滚。

## 验收证据

### 验收 1：从已存在的干净 worktree 内调用，不嵌套 / 不落 main / 正确登记

**变异证据（修复前的旧脚本）**——在 `.worktrees/datazen-worktree-script/` 内调用旧脚本：

```
/Users/.../datazen/.worktrees/datazen-worktree-script/.worktrees/datazen-wtprobe  9d1e9062d [feature/wtprobe]
```

嵌套两层，且已登记进 `git worktree list`。

**真实管线实测（修复后，同一调用位置、同一 cwd）**：

```
▶ 当前 cwd 不是主检出（.../datazen-worktree-script）；已按脚本自身位置解析 MAIN=/Users/.../datazen，不会嵌套创建。
git worktree list → /Users/.../datazen/.worktrees/datazen-wtfix-a   9d1e9062d [feature/wtfix-a]
```

- 不嵌套：新 worktree 落在 `datazen/.worktrees/` 下，`datazen-worktree-script/.worktrees` 不存在。
- 不落 main：分支 `feature/wtfix-a`，`HEAD = 9d1e9062d = feature/editor-productivity`。
- 正确登记：`git worktree list` 命中，且脚本内置自检（登记 + HEAD 分支）通过。

**路径 1 独立验证**：把脚本放进一个假主检出，从 `cwd=/` 调用 →
`MAIN=/private/tmp/wt-script-fakemain2`，worktree 建在其 `.worktrees/` 下并登记成功（退出码 0，
4 项降级全部进报告）。

**证据 D（local remote 取到 `productivity/*`）**：脚本铺出的 Pro 克隆件里

```
git branch -r → origin/productivity/{code-folding,editor-productivity,ep-hooks-settings,ep-runtime-globals}
```

**端到端收益（真实管线实测）**：新 worktree 内 `npx vitest run packages/extension-points/src/__tests__/security.test.ts`

| Pro 分支 | 结果 |
| --- | --- |
| 无 Pro 检出（干净 worktree 基线） | 4 failed（ENOENT） |
| Pro @ `main`（映射回退，ep=1.0.0） | **2 failed（断言失败）** |
| Pro @ `productivity/editor-productivity`（映射命中，ep=1.1.0） | **25 passed / 0 failed** |

### 验收 2：输出真的含醒目段落

`3c`（`NEW_WT_FORCE_FAIL=pro`）实跑输出含 `环境铺装报告 / ENVIRONMENT PROVISIONING REPORT`、
`✅ 已铺好（9 项）`、`⚠ 未铺成（1 项）—— **开箱不再完全即用**`，以及该条的原因 / 手动补命令 /
不补后果（`packages/extension-points/src/__tests__/security.test.ts 中读取该 manifest 的 4 个用例会
ENOENT 失败……该失败与你的改动无关，请勿记为缺陷。`）。脚本退出码 0。

### 验收 3：模拟失败 → 清理生效，且未删既有工作

- `NEW_WT_FORCE_FAIL=node_modules`（致命步）→ 退出码 1，
  `✔ 已移除 worktree .../datazen-wtfix-rollback`、`✔ 已删除本次创建的分支 feature/wtfix-rollback`；
  worktree 列表条数回到调用前的 18，目录与分支均无残留。
- **既有工作未被删**：调用前先造 `feature/wtfix-keep` 并提交 `user commit that must survive rollback`，
  再以同一故障注入调用 → `ℹ 分支 feature/wtfix-keep 在本次调用前就已存在，**未删除**`，
  其提交 `abdc34cec` 完好。全部探针清理后 `git worktree list` = 17 条（原有 16 + 本轨 1）。

### 其他

- `shellcheck scripts/new-feature-worktree.sh` → 0 findings；`bash -n` 通过；488 行。
- 全程未执行 `pnpm install`（各 worktree 靠 `node_modules` 软链）。
- **本轨自曝的一处操作失误**：验收 3b 的准备命令误在**本轨分支**上留下一个空提交
  `dca57e3e9 "user work that must survive"`。实测两棵树对象均为 `0ef63fd5`（空提交、零内容变更），
  已用 `git update-ref` 把分支尖移回 `9d1e9062d` 修正（未用 reset/rebase/merge/cherry-pick）。

## 明确没做的事

- 未改任何业务代码 / 测试 / `hub.md` / `AGENTS.md` / `CONTRIBUTING.md` / `.gitignore`。
- 未动 Pro 仓内容（只读 `branch -vv` / `branch -r` / `show <branch>:manifest.json`）。
- 未 merge / rebase / cherry-pick / reset；未 `git add -A` / `.`；未 `pnpm install`。
- 未修 `check-driver-import-boundaries.mjs:94` 那条已失效的 `SKIPPED_CODEGEN_FILES` 条目
  （属护栏脚本改动，越出本轨范围，登记给协调者）。
- 未验证「worktree 内已有未提交改动时回滚不强删」这一分支路径（无法在不造脏 worktree 的前提下自然触发），
  该路径仅有代码审查保证。
