# Track: scripts-retest

**Status**: TEST_DONE
**Branch**: `feature/scripts-retest`（worktree `.worktrees/datazen-scripts-retest`）
**Base**: `bf1833485`（`feature/scripts-gate` 合入 `feature/editor-productivity` 的 tip）
**复测对象**：`d226686ca`（任务 A）、`ce4e9e838`（任务 B）
**Tester 独立实例**：是。未采信 Coder 台账任何数字，全部重测。

**结论**：两处修复**均判定成立**，六条验收项全部取得独立证据。三个变异全部仍能打红。
登记 2 条发现（`scripts-gate-BUG-001` 低 / `scripts-gate-BUG-002` 中），**均为
文档/覆盖面陈述问题，无一影响门禁行为或运行时语义**。零业务代码改动。

---

## 环境

| 项 | 实测 |
| --- | --- |
| 分支 / HEAD | `feature/scripts-retest` @ `bf1833485`，起手 `git status` 干净 |
| Pro 检出 | `packages/pro-extensions/sql-editor-pro` @ `967fdbd` ✓ |
| `security.test.ts` ENOENT | **未出现**。隔离跑 25/25 绿 ✓（环境健康，不是产品缺陷） |
| codegen | `generated.ts` / `generated-locales.ts` / `generated-pro.ts` / `driver_init.rs` 均在位 |
| `builtin-ep/` 起手状态 | 空；无任何 `*.incomplete` 残留 |

---

## 门禁实测（自测基线，不采信台账）

| 门禁 | 实测 | 判定 |
| --- | --- | --- |
| `npx tsc --noEmit` | **exit 0, 0 错误**（55.7s） | ✓ |
| `npx tsc -p tsconfig.scripts.json --noEmit` | **exit 0, 0 错误**（6.5s） | ✓ |
| `npx tsc -p tsconfig.scripts-checkjs.json --noEmit` | **exit 2, 456 errors** | ✓ 数字对上 |
| `npx vitest run`（全量） | **478 文件：1 failed / 477 passed；4787 用例：1 failed / 4786 passed；207.34s** | ✓ |
| `npx vitest run scripts/__tests__` | **27 文件：339 passed / 0 failed；8.74s** | ✓ |

**456 错误明细**：`grep` 全部 456 条的扩展名 → **456 个 `.mjs`，0 个 `.ts`/`.tsx`**。
按文件 Top：`pack-ep.mjs` 78、`resolve-drivers.mjs` 57、`check-driver-import-boundaries.mjs` 32、
`__tests__/i18n-sync-check.test.mjs` 31、`resolve-pro.mjs` 26。按码：`TS7006` 277、`TS7005` 34、
`TS7053` 30、`TS2339` 28。**与台账完全一致。**

**全量的那 1 个失败是已知 flake**，不是本轨引入：
`src/stores/__tests__/schemaStore.test.ts > … > is multi only when capability and length > 1`
—— `Test timed out in 5000ms`。隔离重跑该文件 **56/56 全绿**。未改 `testTimeout`，未修。

### 与台账数字的差异（环境导致，非分歧）

| | Coder | 本轨实测 | 原因 |
| --- | --- | --- | --- |
| 全量文件数 | 475 | **478** | 本轨分支起于集成分支 tip，多带了 editor-productivity 的测试 |
| 全量用例 | 4770（4 failed / 3 skipped） | **4787（1 failed / 0 skipped）** | Pro 检出在位 ⇒ 3 个真 Pro 构建集成测试**实跑**而非 skip；4 个 ENOENT 消失 |
| scripts 套件 | 27 文件 336 passed / 3 skipped | **27 文件 339 passed / 0 skipped** | 同上，336 + 3 = 339，对得上 |

---

## 验收 1 · 独立复现原始缺陷 ✅

**没有**跑现成测试来代替复现。自写 `/tmp/repro-stale-tree.mjs`：好扩展 → `packEp(mode:'stage')`
落一棵完整签名树 → 用绕过 host-key 表的坏 bundle 触发**产物级门禁**失败 → 检查旧字节/旧签名
是否还在 → 无源、无 url 调 `resolvePro({edition:'pro'})` 看它复用不复用。同一脚本、同一
fixture，只换源码。

| | `96bdba7bc`（`d226686ca` 的父提交） | `bf1833485`（修复后） |
| --- | --- | --- |
| 失败 pack 抛错 | ✓ `artifact host-key invariant violated` | ✓ 同 |
| 旧树仍在盘上 | true | true |
| 旧**字节**未变 | true | true |
| 旧**签名**未变 | true | true |
| `resolvePro` 结果 | `{edition:'pro', active:true, path:<stale stageDir>, prebuilt:true}` | `path` = 真实 Pro 检出，无 `prebuilt` |
| **exit 0？** | **是** | 是（但走了重建） |
| 命中复用日志 | `[resolve-pro] pro extension already staged in builtin-ep, writing codegen` | 无 |
| 明确拒用 | 无 | `…was left incomplete by a failed build (…sql-editor-pro.incomplete); refusing to reuse it` |
| **判定** | **DEFECT REPRODUCED: exit 0 on the PREVIOUS run's signed bytes** | **NOT REPRODUCED: stale tree refused** |

**旧字节 + 旧签名确实被复用且 exit 0，修复后不复用。**

> 方法论留档：我第一版判定只认 `already staged, skipping download` 这一条日志串，结果在
> **父提交**上误报 "NOT REPRODUCED"。实际上该串属于 `--pro-prebuilt-url` 分支
> （`resolve-pro.mjs:591`），我的复现走的是另一条 `:607` 的 artifact 短路。改判依据换成
> `prebuilt===true && path===stageDir && 字节未变 && exit 0` 这些决定性事实后，父提交才正确
> 翻红。**教训：判缺陷别锚在一条日志串上。**

---

## 验收 2 · 三个变异仍能打红 ✅（逐个做，逐个还原并复验绿）

基线 27 文件 / 339 passed。每个变异只动一处、跑全量 scripts 套件、还原、`git diff` 确认、
复跑。

| 变异 | 实测 | 判定 |
| --- | --- | --- |
| 1. 成功路径**不** `clearStagingIncomplete` | **5 failed / 334 passed** | ✅ 打红 |
| 2. 下载前**不** `rmSync(target)` | **1 failed / 338 passed** | ✅ 打红 |
| 3. `checkProStagingReady` 去掉标记分支 | **1 failed / 338 passed** | ✅ 打红 |

**三个都没有留下"删掉仍全绿"的洞。** 三次还原后 `git status --porcelain` 均空、
复跑均 **27 passed / 339 passed**。

**变异 1 转红的 5 条**（全部落在 `pack-ep.staging-invalidation.test.ts`）：

```
× a successful pack leaves the staged tree complete and reusable
× CI semantics: a complete staged tree is still shared verbatim by every variant   ← CI 契约这条
× a complete staged tree is still reused when a prebuilt url is offered
× ci-tauri-build refuses to ship a tree a failed pack left behind
× dzx-only packs never touch the staged tree or its marker
```

**CI 契约那条确实在红名单里** —— 即 Coder 说的"这条最重要"，独立复核成立。
变异 2 精确只打红 `a downloaded tree never inherits a stale signature from the previous one`；
变异 3 精确只打红 `ci-tauri-build refuses to ship a tree a failed pack left behind`。
三个数字与台账**完全一致**。

---

## 验收 3 · `tsconfig.scripts.json` 真把 23 个 `.ts` 纳入 ✅

**不采信"配置写了 include 所以覆盖了"，直接塞错。**

往 `scripts/__tests__/upx-compress.test.ts` 尾部临时塞一处**确定的**类型错误
（`const __testerProbe: number = 'definitely-not-a-number';`）：

```
$ npx tsc -p tsconfig.scripts.json --noEmit
scripts/__tests__/upx-compress.test.ts(97,7): error TS2322:
  Type 'string' is not assignable to type 'number'.        → exit 2

$ npx tsc --noEmit                                      （同一份错误）
exit 0, 0 errors                                        ← 根门禁看不见
```

**转红、指名该文件与行号；同一时刻根门禁仍绿 —— 这就是"此前 0% 覆盖"的正面对照。**

还原：`md5` 与改前一致（`fe2b41b764cd5878bcd9832de31c7413`）、新门禁 **exit 0**、
`git status --porcelain` **空**。另在 BUG-002 轨的 `pack-ep.host-key-invariant.test.ts`
上做了同样的阳性对照，同样指名该文件（见 `scripts-gate-BUG-002.md`）。

**独立确认文件数**（`--listFilesOnly` 实测，非读配置推断）：

| 集合 | 实测 |
| --- | --- |
| `tsconfig.scripts.json` program 内 `scripts/` 文件 | **47** = **23 `.ts`** + **24 `.mjs`** |
| `git ls-files 'scripts/*.ts' 'scripts/**/*.ts' \| sort -u` | **24** |
| 其中在 program 外 | **1**（`scripts/e2e-screenshots/editor-blog-screenshots.ts`） |
| `git ls-files 'scripts/*.mjs' 'scripts/**/*.mjs' \| sort -u` | **46** = 41 顶层 + 5 `__tests__/` |
| `git ls-files 'scripts/*.js' 'scripts/**/*.js'` | **0** |

**pathspec 陷阱已被复现**（判据③，本次确实踩到边缘）：

```bash
$ git ls-files 'scripts/**/*.mjs' | wc -l
5                      ← 静默漏掉全部 41 个顶层 .mjs，不报任何错
$ git ls-files 'scripts/*.mjs' 'scripts/**/*.mjs' | sort -u | wc -l
46                     ← 正确
```

「23 `.ts` / 46 `.mjs` / 0 `.js`」与台账**一致**。

---

## 验收 4 · CI 短路语义真未被破坏 ✅

自写 `/tmp/acceptance4.mjs`，不走 Coder 的测试。**连续三次**
`resolvePro({edition:'pro'})`（不命名任何源、清掉 `DATAZEN_PRO_GIT`）：

| n | `prebuilt` | 复用了 stageDir | 字节未变 | 签名未变 | 写过标记 | 命中日志 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **true** | true | true | true | **false** | `pro extension already staged in builtin-ep, writing codegen` |
| 2 | **true** | true | true | true | **false** | 同上 |
| 3 | **true** | true | true | true | **false** | 同上 |

`stagedTreeComplete` / `stagedTreeUsable` 事后仍为 `true`。**Coder 的三条保障独立复核：**

1. **成功清标记** — 变异 1 已证明去掉它 CI 契约就红（验收 2）。✓
2. **artifact 只含树不含标记** — 读 `release.yml:104-107` / `:531-534`：
   `path: src-tauri/resources/builtin-ep/sql-editor-pro`（**树本身**，标记是同级兄弟
   `…/sql-editor-pro.incomplete`，在路径之外），上传/下载两侧对称。✓
3. **`--mode=dzx` 从不写不清标记** — 读 `packEp`：`stagesTree = mode === 'stage' || mode === 'both'`，
   写标记与清标记都被 `if (stagesTree)` 包住；测试 `dzx-only packs never touch the staged tree
   or its marker` 绿。✓

**两处 `stagedTreeUsable` 调用点**也独立确认：`resolve-pro.mjs:587` 只算一次
`hasPrebuiltFiles`，`:590`（`--pro-prebuilt-url` 分支）与 `:606`（artifact/git 短路）共用它。

### `.incomplete` 的运维盲区：核实结论

**盲区是真的，且比台账说的略重一点。** 实测（把标记放在真实位置后问 git）：

```bash
$ git status --porcelain
(EMPTY — 标记不可见)
$ git status --porcelain -uall
(EMPTY)
$ git status --porcelain --ignored=matching
!! src-tauri/resources/builtin-ep/          ← 折叠成整目录，标记本身列不出来
$ git check-ignore -v -- src-tauri/resources/builtin-ep/sql-editor-pro.incomplete
.gitignore:69:src-tauri/resources/builtin-ep/  src-tauri/resources/builtin-ep/sql-editor-pro.incomplete
```

注意最后一行：**命中的是 `.gitignore:69` 的 `builtin-ep/` 目录规则，不是新加的
`:74 *.incomplete`**。新规则在这个位置是冗余的（对 `--stageDir` 指定的树目录外场景仍有意义）。

**补偿措施是否真够 —— 判定：对本缺陷的范围够，但留一个窄口子。**

够的部分（**真实管线实测**）：

- 标记在位时 `stagedTreeComplete=false`、**`stagedTreeUsable=false`**（先测后动，避免自测污染）。
- `checkProStagingReady` → `missing: ["sql-editor-pro.incomplete"]`，并打
  `::error::` 带**树路径 + 原因 + 重跑命令**。
- `resolvePro` → 打
  `[resolve-pro] staged builtin-ep at <树路径> was left incomplete by a failed build (<标记路径>); refusing to reuse it`
  然后**重建**（`path !== stageDir`），成功后清标记、恢复 `stagedTreeUsable=true`。
- `git clean -xdn` 是 `将删除 src-tauri/resources/builtin-ep/` —— **整目录连树带标记一起删**，
  所以不存在"清掉标记却留下旧树"的反向风险。✓

判断"够"的理由：树本身也被 gitignore，`git status` **从来就没有**关于"我现在跑的是哪棵
Pro 树"的任何信号，所以标记并没有制造一类新的盲目；它拿掉的是一个严重得多的盲目
（静默复用）。**残留口子**只剩一个：从不跑 `resolvePro`、也不跑 `ci-tauri-build` 的人，
**手工翻看** `src-tauri/resources/builtin-ep/sql-editor-pro` 去核对键不变量 —— 他会看到一棵
完整、已签名、看起来很正常的树，毫无"这是旧的"提示。风险面已从"流水线会复用/会发货"
缩到"人工目视"，但不为零。

---

## 验收 5 · 5 处 JSDoc 是加信息还是放松 ✅ —— 逐处核实

**逐处与函数体对账**（不是读 diff 就算数）：

| # | 文件 / 函数 | 注释声明 | 函数体实况 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | `sign-ep.mjs` `signEpPackage` `@returns` | `{outPath, sigDoc:{version, algorithm, signedAt, files: Record<string,{sha256}>, signature}}` | `return { outPath, sigDoc }`；`files[rel] = { sha256: sha256File(abs) }` | **逐字段一致，纯增** |
| 2 | `ci-tauri-build.mjs` `buildTauriArgs` `@param` | 8 个可选键：`target?:string\|null, updater?:boolean, edition?:string, features?:string[], configPath?:string\|null, updaterConfigPath?:string\|null, beforeBuildCommand?:string\|null, extraArgs?:string[]` | 解构默认值 `target=null, updater=false, edition='community', features=[], configPath=null, updaterConfigPath=null, beforeBuildCommand=null, extraArgs=[]` | **默认值与类型一一对应，纯增** |
| 3 | `ci-tauri-build.mjs` `writeTauriConfigFile` `@param` | `updater?, isPro?, beforeBuildCommand?, dir?` | 解构 `updater=false, isPro=false, beforeBuildCommand=null, dir=join(tmpdir(),…)` | **一致，纯增** |
| 4 | `check-ci-docs-consistency.mjs` `checkCiMatrixDrivers` `@returns` | 加 `mentioned: string[]` | `return { ok, missing, mentioned, registryIds }` | **函数本来就返回，纯增** |
| 5 | `with-driver-inject.mjs` 两处 `@param` | `runWithDriverInject` 加 `runResolvePro`/`runRestorePro`；`planDriverInjectLifecycle` 加 `\| (() => boolean)` 联合 | `runResolvePro` 用于 `:193`、`runRestorePro` 用于 `:174`；`typeof opts === 'function'` 分支确实存在且被 honour | **两处都是把既成事实写进类型，纯增** |

**5 处全是增加，0 处放松。** 测试侧改动 `git show --numstat` 实测 **`scripts/__tests__/ci-tauri-build.test.ts  +1 / -1`**，
唯一一行：

```diff
-    const notices = [];
+    const notices: string[] = [];
```

**无 `any`、无删断言、无放松选项**（该提交所有新增行里出现的 "any" 全部在注释散文中，
逐行确认过）。

### 关于第一条 —— 是否意味着 BUG-002 轨的断言曾未被类型检查？

**是，而且比"可能"更硬。** 已单独登记为 **`scripts-gate-BUG-002.md`**，此处只留结论：

- **变异证据**：删掉 `signEpPackage` 的 `@returns`（其余不动），新门禁**恰好**转红两条
  TS7053 — `pack-ep.test.ts:99` 与 `:100`，即
  `sigDoc.files['manifest.json'].sha256` 与 `sigDoc.files['dist/index.esm.js'].sha256`。
  这两条断言在仓库历史上**从未被任何 tsc 检查过**。
- **但要害不在这两条**：`ce4e9e838` 之前 `scripts/__tests__/` 23 个 `.ts` **整个不在任何
  program 内**（根 program `--listFilesOnly` 命中 0）。所以**包括 BUG-002 轨的
  `pack-ep.host-key-invariant.test.ts` 在内，全部 23 个文件的类型层断言都是空转的**。
- **仍然敞着的那一半**：BUG-002 的产物级键不变量，其**实现**在 `scripts/pack-ep.mjs`
  （`:458 hostKeyError` / `:460`），而 `pack-ep.mjs` 是 `.mjs` + `checkJs: false` ⇒
  **函数体一行未检查**。`allowJs` 只让它"出现在 program 里供 import"，不检查它。
  被保护者进了门禁，**保护者的实现没有**。这是 `BUG-002` 的主体内容。

---

## 验收 6 · `e2e-screenshots` 排除是否静默丢弃 —— 部分 ✅ / 一处 ❌

**排除方式显式可见，不是 glob 碰巧：✅**
`tsconfig.scripts.json` 与 `tsconfig.scripts-checkjs.json` **都**显式写了
`"exclude": ["scripts/e2e-screenshots"]`，且两边的 `$comment` 都写明了理由。
独立确认它是 program 内**唯一**被排除的 `.ts`（47 个 program 文件，`git ls-files` 的 24 个
`.ts` 中只有它在外）。排除的**必要性**也复核过：强行纳入 ⇒ **400 errors**
（`e2e/helpers.ts` 204、spec 114、`e2e/lib/screenshotTrace.ts` 7）。

**"该文件属于 e2e program 而非 scripts"：❌ 不成立** → 登记 **`scripts-gate-BUG-001.md`**。

`e2e/tsconfig.json` 的 `include: ["**/*.ts"]` 相对 `e2e/` 解析，**结构上够不到 `scripts/`**：

```bash
$ npx tsc -p e2e/tsconfig.json --noEmit --listFilesOnly | grep -c "e2e-screenshots/editor-blog-screenshots.ts"
0
$ npx tsc -p e2e/tsconfig.json --noEmit --listFilesOnly | grep -c "e2e/helpers.ts"
1
```

`e2e/helpers.ts` 确实在 e2e program，**spec 不在任何 program**。`progress.md` 这点写对了，
错的是留在 `tsconfig.scripts.json` `$comment` 里的那句"belongs to the e2e/tsconfig.json program"。
附带数字订正：台账"195 errors from `e2e/helpers.ts`"，实测 **204**（总数 400）。

---

## 留档观察（非 Bug，不单独开单）

1. **`gitignore:74 *.incomplete` 在标记的实际位置是冗余的** —— `git check-ignore -v` 显示
   命中的是 `:69 src-tauri/resources/builtin-ep/`。对 `--stageDir` 指向 `builtin-ep/` 之外的
   树时该规则仍有意义，故**不算错**，只是别以为本轨是它生效。
2. **`checkProStagingReady` 的 `::notice::` 措辞略松**：标记是"存在且不该存在"，却被写进
   `missing` 列表并冠以 "missing staged files"。紧邻其上的 `::error::` 行表述正确，
   `main()` 也确实因 `missing` 非空而 exit 1 ⇒ 行为无误，仅措辞。
3. **两处复用日志串不同**（`:591` 带 url 分支 / `:607` artifact 分支）。任何以日志串为
   判据的测试都必须覆盖两条，否则会在其中一条上静默失去检测力 —— 我自己第一版就栽在这里
   （见验收 1 的方法论留档）。
4. `pnpm typecheck` = `tsc --noEmit && pnpm typecheck:scripts`，`ci.yml:56` 跑 `pnpm typecheck`
   ⇒ **新门禁确实被 CI 捡到，无需改 workflow**；`typecheck:scripts:checkjs` 在
   `.github/workflows/` 中**零引用** ⇒ 确系 opt-in。

---

## 登记的 Bug

| ID | 标题 | 严重度 | 状态 |
| --- | --- | --- | --- |
| `scripts-gate-BUG-001` | `tsconfig.scripts.json` 的 `$comment` 谎称 e2e spec 属于 e2e program | 低 | 待修复 |
| `scripts-gate-BUG-002` | BUG-002 产物级键不变量的「实现侧」至今 0% 类型检查 | 中 | 待修复 |

**无阻断项。** 两处修复（Task A / Task B）判定成立，可以进 PASSED 流程。
