# Track: pack-ep-key-invariant

> **状态**：`TEST_DONE`
> **角色**：Coder → **Tester 已复核**（见 §11）
> **分支**：`feature/pack-ep-key-invariant`
> **worktree**：`.worktrees/datazen-pack-ep-key-invariant`
> **基座**：`276179407`（含 `11c2f222a`）
> **提交**：`85594adb4` — `fix(pack-ep): 产物级宿主键不变量，封死 unmapped 包的签名旁路`
> **缺陷**：[`bugs/README.md`](bugs/README.md) —— 本轮**无缺陷**
> **Tester 补测提交**：`scripts/__tests__/pack-ep.host-key-invariant.test.ts`（21 例，仅测试代码，未改业务代码）

---

## 1. 缺陷复述与机制

`scripts/pack-ep.mjs` 有一道**窄白名单**输入闸门（`rewriteEpImportsToHostGlobals`）：
裸导入不在 `HOST_SHARED_MODULES` 内就 `throw`。规格 §G1 据此声称「unmapped 包在构建期硬失败」。

**该结论漏掉了一个执行顺序前提。** 存在两个改写者：

| # | 改写者 | 规则 | 是否查白名单 | 何时跑 |
| --- | --- | --- | --- | --- |
| 1 | Pro `vite.config.ts` `renderChunk`（`enforce: 'post'`） | 宽正则 `/^@codemirror\//` + `BARE_SPECIFIERS` | **否** | **先** |
| 2 | `pack-ep.mjs` `rewriteEpImportsToHostGlobals` | 窄白名单 | 是 | 后 |

#1 先把具名/默认/命名空间导入改写成 `__DATAZEN_HOST__['…']`；#2 运行时输入已空，
**无物可拒**。旁路指纹：`rewrote bare imports:` 日志**恒为空字符串**。

副作用导入（`import '@codemirror/search'`）不在 #1 的四条改写规则内，所以窄闸门仍看得见 →
对照组正常 exit 1。**闸门本身没坏，只是被绕过。**

## 2. E2E 复现与验证（`resolve-pro --edition=pro`，真实流水线）

全部在 Pro 仓库 `967fdbd` 干净状态下测量，注入仅在本 worktree 内进行并已精确还原。

| 场景 | 闸门 | exit | 签名 | 产物中的越界键 |
| --- | --- | --- | --- | --- |
| 基线（无注入） | 开 | **0** | 有 | — |
| 注入 `import { foldGutter } from '@codemirror/search'` | 开 | **1** | **无** | — |
| 同上注入 | **关**（变异） | **0** | **有** | `__DATAZEN_HOST__["@codemirror/search"]` |
| 还原注入 | 开 | **0** | 有 | — |

变异那一行是本次修复的**核心证据**：同一份注入，闸门关掉就 exit 0 并签出带越界键的产物，
闸门开着就 exit 1 且不签名。**"实现后全绿"本身不算证明。**

失败信息：

```
Error: [pack-ep] artifact host-key invariant violated in staged bundle .../dist/index.esm.js:
[pack-ep] and at least one key is not a host singleton. Refusing to sign.
[pack-ep]   - unmapped host table key "@codemirror/search" (absent from HOST_SHARED_MODULES
             and from the __DATAZEN_HOST__ table in src/main.tsx)
```

## 3. 改法：产物级不变量（而不是加宽输入闸门）

加宽输入闸门不可行：旁路的根因是**闸门位置**，不是白名单内容。Pro 仓库属另一条轨道
（`vite.config.ts` 只读），且它的宽正则**故意**不能动（见 §6）。因此在 `pack-ep.mjs` 增加
**产物级**闸门：读**将要签名的字节**，而不是读**输入**。

- `assertHostGlobalKeysAllowed(code, opts)` —— 扫描字节里全部 `__DATAZEN_HOST__` 键并断言。
- `assertHostGlobalKeysInTree(packageDir, opts)` —— 对 `dist/index.esm.js` 落盘字节执行。
- 挂在两处：
  - `stagePackageTree` —— **在 `signEpPackage` 之前**（硬要求：失败必须发生在签发之前；
    不满足的 bundle 绝不能拿到签名，否则运行期崩溃在下游无法归因）。
  - `createDzxArchive` —— 纵深防御，覆盖「预构建产物直接交给归档器」的 CI 交接路径。

选产物级而非输入级的理由：无论 Pro 侧用什么正则、改写几次、按什么顺序，
**产物里出现宿主表没有的键，都会被抓住**。输入级闸门的位置永远可能被上游改写抢跑。

## 4. 设计取舍（按要求记录）

### 4.1 基准取两份，不是只取白名单

| 依据 | 回答的问题 | 单用它会漏掉 |
| --- | --- | --- |
| `HOST_SHARED_MODULES` | 声明的意图 | 声明了但宿主从不发布的键（运行期同样 `undefined`） |
| `src/main.tsx` 宿主表 | 运行期的真相 | 意图 —— 宿主表里存在不等于该被允许 |

两类错误分别报错：越界键 `unmapped host table key "X"`；只声明未发布
`host table key "X" is in HOST_SHARED_MODULES but the __DATAZEN_HOST__ table never publishes it`。

宿主表用**解析**而非正则全文件匹配取得：表项有两种写法（`'@codemirror/view': cmView` 与
`react: reactAll`），只认带引号的解析器会**静默漏掉 `react`**，恰好在它存在的场景里失效。
条目解析不了或表找不到 → **throw**，不做"读不懂就放行"的降级。

### 4.2 精确匹配，禁止前缀规则

前缀规则会让 `react-anything` 一并放行，而 `react/jsx-runtime` 作为独立枚举项仍能通过 ——
**闸门看起来在生效，实际已经形同虚设**。已有用例钉死这一点。

### 4.3 扫描器必须认得两种形态（本次的新发现）

只认括号的扫描器是**空转的闸门**。已发布 Pro 产物里同时存在：

```js
{ forwardRef: Wr, createElement: Dn, ... } = globalThis.__DATAZEN_HOST__.react;
```

**点号式**。因此点号访问也按「键声明」处理并核对宿主表（`react` 已发布，故通过）。
若不处理，未来的 `__DATAZEN_HOST__.search` 会带着签名出厂并在 EP 加载时崩溃 ——
和括号式旁路一模一样。变异实验 M2 证明这条覆盖是**承重**的：删掉点号分支，
恰好 2 条用例转红（点号单元用例 + 真实 Pro 构建集成用例）。

### 4.4 无静默降级

违规即构建失败（throw → CLI exit 1）。没有"警告后继续"。

### 4.5 已知副作用（有意保留）

失败时 `packEp` **不清理** `.pack-ep-staging-*` 临时目录 —— 因为最后的 `rmSync` 被跳过。
这是**有意**的：现场产物是排查旁路来源的唯一证据。

## 5. 对协调员意见的核对（一处不成立，已按其架构意图实现）

协调员称"`react` 在 `HOST_SHARED_MODULES` 里但不在 `src/main.tsx` 宿主表里，宿主表只有 10 键，
构成第二处活旁路"。**在本 worktree 不成立**：

- 用闸门自己的解析逻辑读 `src/main.tsx:55-67` → **11 键，含 `react: reactAll`**。
- 两份列表完全一致，与既有的绿色用例 `registers exactly 11 shared modules on both sides` 相符。
- 协调员给出的支撑测量（6 键、`@tazen/extension-points` 拼写、`react/jsx-runtime`、0 个单引号键）
  与本 worktree 的产物同样对不上；`src-tauri/resources/builtin-ep/sql-editor-pro/dist/index.esm.js`
  在此不存在（主检出也没有），无已暂存产物可测。

**但其架构判断本身成立，且已实现**：闸门同时对两份列表取值（§4.1），所以
"声明了但未发布"这一类缺口**一旦真的出现就会被抓住**。
已加不变式用例 `every allow-listed specifier is actually published by the host table`
断言 `HOST_SHARED_MODULES ⊆ 宿主表`。**今天它是绿的（11 ⊆ 11）** —— 协调员预期它会红。
按其第 4 点要求，我没有改任何一份清单去把它弄红，只如实上报。
若该缺口在别的 worktree 真实存在，这条不变式会立刻变红。

其余各点均已落实：两种引号形态各有独立变异用例；精确匹配（用例 `matches keys exactly, never by prefix`）；未触碰 `src/main.tsx` / Pro `vite.config.ts` / `hub.md`。

### 5.1 顺带发现：协调员的"6 键"测量本身是空转扫描器的产物

协调员报"产物实际引用 6 键"。**本 worktree 实测是 7 键** —— 差的正是点号式的 `react`。
也就是说，那次测量用的正是一个只认括号的扫描器：它当时就已经漏看了 React 绑定。
这从侧面印证了 §4.3：只认括号的扫描器在这个产物上不成立。

## 6. 未改动 / 刻意不动

- `packages/pro-extensions/sql-editor-pro/vite.config.ts` —— Pro 仓库（另一条轨道）。
  它的宽正则**故意**保留（§G1 的"宽 vs 窄"探针：宽正则保证新包逃不掉检查，
  窄白名单强制逐个显式确认）。把 `/^@codemirror\//` 塞进 `HOST_SHARED_MODULES` 等于拆探针，
  探针一拆，失败模式就退化成"第二份 CM 包被静默打进 bundle"的身份分裂。
- `src/main.tsx` 宿主表 —— 架构决策，不在本轨范围。
- `hub.md` —— 由 `scripts/aggregate-hub.mjs` 生成，禁止手改。
- 未重构 `pack-ep.mjs` 其余部分。

## 7. 验收证据

| # | 判据 | 实测 |
| --- | --- | --- |
| 1 | 注入 `@codemirror/search` → exit ≠ 0 且无签名 | **exit 1**，无 `signature.sig`（§2） |
| 2 | 还原注入 → exit 0 且有签名 | **exit 0**，`signature.sig` 存在 |
| 3 | 正常态产物键集 ⊆ 宿主表（逐键） | 见 §8，7 键全部命中 |
| 4 | 变异测试证明是真闸门 | M1 拆两处闸门 → **恰好 6 条**转红；M2 删点号分支 → **恰好 2 条**转红 |
| 5 | `npx tsc --noEmit` | **exit 2**，但**非本轨引入**：同 7 错 2 文件在纯净 HEAD 上逐字相同（§9） |
| 6 | `npx vitest run scripts/__tests__/pack-ep.test.ts` | **55/55 绿**；**新增 20 例**（35 → 55，`vitest list` 权威计数） |
| 7 | 全量 `npx vitest run` | **exit 0 —— 467 文件 / 4662 例全绿**（第二次跑；第一次 4 例超时，见 §9） |
| 8 | `docs/development/coordination/**` 不入库 | 已留在工作区，**未 commit**（`git status` 可见） |

## 8. 产物键 vs 宿主表（逐键实测，正常态）

已发布 Pro 产物 `dist/index.esm.js` 实际引用 **7 键**：

| # | 键 | 形态 | 在 `HOST_SHARED_MODULES` | 在 `src/main.tsx` 宿主表 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | `@codemirror/lint` | 括号 `["…"]` | ✅ | ✅ | 通过 |
| 2 | `@codemirror/state` | 括号 `["…"]` | ✅ | ✅ | 通过 |
| 3 | `@codemirror/view` | 括号 `["…"]` | ✅ | ✅ | 通过 |
| 4 | `@datazen/extension-points` | 括号 `["…"]` | ✅ | ✅ | 通过 |
| 5 | `@datazen/ui` | 括号 `["…"]` | ✅ | ✅ | 通过 |
| 6 | `react` | **点号 `.react`** | ✅ | ✅ | 通过（**只认括号的扫描器会漏掉此键**） |
| 7 | `react/jsx-runtime` | 括号 `["…"]` | ✅ | ✅ | 通过 |

宿主表 11 键，未被产物引用的 4 键：`react-dom`、`@codemirror/autocomplete`、
`@codemirror/language`、`@codemirror/commands`。**无越界键，7 ⊆ 11 成立。**

## 9. 需要 Tester 留意的两处基线噪声（非本轨引入，但如实上报）

### 9.1 `tsc --noEmit` exit 2 —— 7 个既存错误

`src/stores/__tests__/panelStore.panes.test.ts`（3）与
`src/windows/connection/__tests__/QueryPanel.paneRouting.test.tsx`（4）。
把本轨 3 个文件 stash 掉、在**纯净 HEAD `276179407`** 上重跑 `tsc`，
得到**完全相同的 7 错 2 文件**。与 `11c2f222a` 引入的 `Panel.database / schema` 字段有关。
**本轨改动新增 0 个类型错误。**

### 9.2 全量 vitest 第一次跑 4 例超时，第二次全绿

第一次全量：4 例 `Test timed out in 5000ms`，落在
`src/stores/__tests__/schemaStore.test.ts` 与
`src/windows/data-transfer/__tests__/DataTransferWindow.test.tsx` —— 均与本轨无关，
且**单独跑（带我的改动）68/68 全绿**。第二次全量：**exit 0，4662/4662 全绿**。
判定为 467 文件并行下的 5s 预算边际紧张（本轨测试文件新增 20 例、其中含真实 Vite 构建，
略微加重了争用），**不是逻辑回归**。本轨未去调 `testTimeout` 掩盖它。
若后续全量偶发这两处超时，是同一性质。

## 10. 新增用例清单（20 例）

单元（`[bug-002] artifact host-key invariant`）：
1. 收集两种引号形态的宿主键
2. 收集 pack-ep 改写器自己产出的键
3. 白名单内的键集被接受
4. **变异**：越界键（`'` 形态）被拒
5. **变异**：越界键（`"` 形态）被拒
6. 计算下标 → fail closed
7. 改名后的宿主全局量不被误判
8. **点号式**键的收集（并断言 `.default` 不是键）
9. **点号式**越界键被拒
10. 只声明未发布的键被拒
11. 精确匹配，`react-anything` 不放行
12. 真实宿主表读出 11 键
13. 宿主表不可读 → fail closed
14. `HOST_SHARED_MODULES ⊆ 宿主表`（§5，今天为绿）

集成 / 管线：
15. `stagePackageTree` 拒绝签发含越界键的产物，并断言无 `signature.sig`
16. **变异**：`stagePackageTree` 抓 `'` 形态越界键
17. **变异**：`stagePackageTree` 抓 `"` 形态越界键
18. `stagePackageTree` 对同一形态在键被列入白名单后放行
19. `stagePackageTree` 拒绝 `rewriteImports: false` 的预改写字节
20. `packEp` 越界键时既不产 `.dzx` 也不产签名；`createDzxArchive` 拒绝已暂存树
（另：副作用导入对照组保持绿；真实 Pro 集成用例加了逐键产物断言 + 防空转的 `shippedKeys.length > 0`）

---

## 11. Tester 独立复核结论（`TEST_DONE`）

> Tester 全程只测不修：`scripts/pack-ep.mjs` 与 `scripts/__tests__/pack-ep.test.ts`
> 在本轮结束时与 `85594adb4` **逐字节相同**（`git diff --quiet` 为真），
> Pro 仓库停在 `967fdbd` 且 `git status --short` 为空。所有变异均基于
> `/tmp` 备份做替换 + 前后一致性断言，每次变异后立即还原并复查。
> **本轮唯一的新增文件是测试文件与本轨道文档。**

### 11.1 四项裁定的独立结论

| # | 协调者要求裁定的命题 | Tester 独立结论 |
| --- | --- | --- |
| 1 | 闸门是不是真闸门 | **是。** M1（拆两处闸门）→ **恰好 6 红**；M2（删点号分支）→ **恰好 2 红**，与 Coder 声称**逐条一致**。另自加 M3（只认双引号）**9 红**、M4b（不读宿主表）**7 红**、M4d（不读白名单）**1 红**。不存在「删了实现测试仍绿」的路径 |
| 2 | 闸门是不是真在签名前 | **是。** 失败路径实测：`builtin-ep/` 为空、全仓**无 `signature.sig`**、**无 `.dzx`**。Coder **有意不清理** `.pack-ep-staging-*` 属**可接受取舍**（gitignored；`resolve-pro` 短路只认 `builtin-ep/` 不认 `artifacts/`；下次运行入口即 `rmSync`；成功运行后 `artifacts/` 恢复为空），且现场对排查旁路来源有实际价值 |
| 3 | 「读两份列表」的真实效果 | **确实读两份，且两侧都承重。** 独立解析两份清单 11 = 11 **恒等**（互差集为空）⇒ **协调者撤销 BUG-004 是对的，Coder 拒绝为凑红而改清单的处置也是对的**。变异 M4b / M4d 分别抽掉一侧均转红；真实管线反事实（只加白名单）**确实转红**，且报的是**另一条独立错误**（`host table key "X" is in HOST_SHARED_MODULES but … never publishes it`）⇒ 该分支真实可达，非死代码 |
| 4 | §G1 更正是否准确 | **准确，且未改写历史。** 原文逐字保留、只加 ⚠️ 标注；失效表三行经真实管线逐一实测；基线「各 9 项」→「**各 11 项**」与独立解析一致；「产物实际引用 7 键」与闸门日志一致 |

### 11.2 Tester 复现的关键实测值

- 干净基线 `resolve-pro --edition=pro` → **exit 0**、有签名、闸门日志
  `verified 7 __DATAZEN_HOST__ key(s)`。
- 旁路注入（**注入且引用**：`import { foldGutter } from '@codemirror/search';`
  **+** `export const __probe = typeof foldGutter;`）→ **`rewrote bare imports:` 恒空**
  （旁路指纹复现），**exit 1**，产物闸门报
  `unmapped host table key "@codemirror/search" (absent from HOST_SHARED_MODULES and from the __DATAZEN_HOST__ table in src/main.tsx)`。
- 副作用导入对照组 `import "@codemirror/search";` → **exit 1**，走**输入闸门**
  `unmapped bare side-effect import` ⇒ §G1 失效表第 1 行准确。

### 11.3 环境与噪音（按规程不记为缺陷）

- 新 worktree 缺 gitignored codegen `src/extensions/generated-locales.ts`，从主仓拷入即恢复。
  这是**环境准备**，非 bug。
- 全量 `npx vitest run` Tester 跑了两次：第一次 **467 文件 / 4662 例全绿（exit 0，122s）**；
  第二次 `4 例超时`（`schemaStore.test.ts` 1 + `DataTransferWindow.test.tsx` 3），
  两文件单独跑 **68/68 全绿**。与 Coder §9.2 记录的**同一现象、同一批文件**，
  判定为 467 文件并行下 5s 预算边际紧张，**非逻辑回归**（两文件与 pack-ep 无任何关系）。

### 11.4 覆盖率与补测（阶段 C）

改动模块 `scripts/pack-ep.mjs` 覆盖率：

| | 仅 Coder 的 55 例 | 加 Tester 的 21 例后 |
| --- | --- | --- |
| stmts | 87.95% | **88.96%** |
| branch | 80.47% | **81.90%** |
| funcs | 97.77% | **97.77%** |
| lines | 90.64% | **91.72%** |

≥80% 达标；**BUG-002 新增的全部生产代码（`pack-ep.mjs` 第 310–500 行）语句覆盖 100%**。

覆盖报告暴露 3 条**新代码中从未执行**的分支。提交信息正文声称
「宿主表不可读 / **条目不可解析**时 fail closed」——实测**「条目不可解析」这条从未被测过**。
Tester 已在 `scripts/__tests__/pack-ep.host-key-invariant.test.ts` 补齐 **21 例**
（`test_tester_` 前缀，含「条目不可解析抛错」「表字面量缺失抛错」「产物缺失抛错」
「异体转义不猜键」「悬空反斜杠按 unverifiable 拒绝」，
以及 6 种**无法验证的取法必须 fail closed** 的形态矩阵：
`globalThis["__DATAZEN_HOST__"][…]` 双/单引号、模板字面量键、计算下标、整表解构、整表展开）。

每条补测都经**变异验证其真的会转红**：

| 变异 | 改动 | Coder 的 55 例 | Tester 的 21 例 |
| --- | --- | --- | --- |
| **M5** | 条目不可解析时 `continue` 而非 `throw` | **仍全绿** | **2 红** |
| **M6** | 表字面量缺失时 `return []` | 1 红 | 1 红 |
| **M7** | `unverifiable > 0` 不再致命 | 1 红 | **8 红** |
| **M8** | 产物文件缺失时 `return []` | **仍全绿** | **1 红** |

M5 / M8 是本轮唯一的**新发现**，性质为**测试覆盖缺口**而非功能缺陷（实现行为本就正确），
Tester 已按职责补测，故不登记为 BUG。

### 11.5 给 Coder 的两条措辞建议（非缺陷，不阻塞）

1. §4.1 表格「宿主表里存在**不等于**该被允许」与实现的**并集**准入
   （`!allowList.has(key) && !host.has(key)`）有落差；并集是运行期安全的那一侧，不是缺陷。
2. `pack-ep.test.ts` 内的 `parseHostGlobalTableKeys` 是生产解析器的副本，
   G1 漂移守卫用的是副本；建议后续直接调用生产解析器。

### 11.6 终态

- **状态**：`TEST_DONE`
- **缺陷数**：**0**（明细与留档见 [`bugs/README.md`](bugs/README.md)）
- **绝未**写入 `PASSED`
