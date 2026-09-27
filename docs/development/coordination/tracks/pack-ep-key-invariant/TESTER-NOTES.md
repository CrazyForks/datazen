# TESTER 工作底稿 · pack-ep-key-invariant

> 独立 Tester（只测不修）。基线 `85594adb4`，分支 `feature/pack-ep-key-invariant`。
> 本文件是过程底稿，最终判定以 `progress.md` 与 `bugs/` 下文件为准。

## 环境

- worktree `.worktrees/datazen-pack-ep-key-invariant`，`git status` tracked 全净（仅本轨 track 目录 untracked）。
- Pro 检出 `packages/pro-extensions/sql-editor-pro` = `967fdbd`，clean（与协调者要求一致）。
- 缺 gitignored codegen `src/extensions/generated-locales.ts` → 从主检出拷贝（环境补齐，非缺陷）。
- 其余 codegen（`generated.ts` / `generated-pro.ts` / `builtinLocales.ts` / `capabilities/default.json`）已就位。

## 阶段 B · 独立重跑

| 套件 | Coder 自报 | 独立实测 | 结论 |
| --- | --- | --- | --- |
| `npx vitest run scripts/__tests__/pack-ep.test.ts` | 55/55 绿（35→55） | **55 passed / 55**，`vitest list` 权威计数 **55** | ✅ 一致 |

## 裁定 (1) · 是不是真闸门（独立复现变异）

工作副本 `scripts/pack-ep.mjs` → `/tmp/pack-ep.mjs.orig`（sha `e3cfe0f9…`），每次变异后还原并 `git diff --quiet` 确认干净。

| 变异 | 内容 | Coder 自报 | **独立实测** | 判定 |
| --- | --- | --- | --- | --- |
| M1 | 拆掉 `stagePackageTree` + `createDzxArchive` 两处闸门调用 | 恰好 6 条红 | **6 failed / 49 passed** | ✅ 复现，转红清单逐条吻合（`'` 形态 / `"` 形态 / `rewriteImports:false` / `packEp` 不产 .dzx 不产签名 / `createDzxArchive` / `stagePackageTree` 基例） |
| M2 | 删扫描器点号式分支 | 恰好 2 条红 | **2 failed / 53 passed** | ✅ 复现（点号单元用例 + 真实 Pro 构建集成用例） |

**我额外加的探针（Tester 自主，非 Coder 自报）：**

| 探针 | 内容 | 实测转红 | 用途 |
| --- | --- | --- | --- |
| M3 | 括号扫描器收窄为**只认双引号**（`["']`→`["]`） | **9 failed / 46 passed** | 证明单引号形态本身承重，不是恒真断言；且转红信息显示 fail-closed 兜底生效（键被归入 `non-literal` 而非静默放行） |
| M4b | 闸门**从不读** `src/main.tsx` 宿主表（`host = new Set()`） | **7 failed / 48 passed** | 见裁定 (3) |
| M4d | 闸门**从不读** `HOST_SHARED_MODULES`（`allowList = new Set()`） | **1 failed / 54 passed** | 见裁定 (3) |

**结论**：闸门是真闸门。不存在「删了实现测试仍绿」的路径；M1/M2 转红条数与 Coder 声称**逐条一致**。

## 裁定 (2) · 端到端复现（`resolve-pro --edition=pro` 真实流水线）

前置：`rm -rf src-tauri/resources/builtin-ep/sql-editor-pro`（`resolve-pro` 在「已暂存」时会短路跳过构建 —— 协调者踩坑 2 实测复现：我第一次跑注入时因为忘了清，**exit=0**，日志停在 `pro extension already staged in builtin-ep, writing codegen`，根本没构建）。

| 场景 | 注入写法 | exit | 签名 | 产物键 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 干净基线 | — | **0** | 有 | 7 | 复现协调者表格 |
| 副作用导入对照 | `import "@codemirror/search";` | **1** | 无 | — | **输入闸门**报错 `unmapped bare side-effect import` ⇒ 证明 §G1 失效表第 1 行准确 |
| `export … from` 变体 | `export { foldGutter } from "@codemirror/search";` | **1** | 无 | — | 同样走输入闸门（不在 Pro 四条改写规则内） |
| **旁路（BUG-002 核心）** | `import { foldGutter } from "@codemirror/search";` **+ 引用** `export const __probe = typeof foldGutter;` | **1** | **无** | — | **`rewrote bare imports:` 恒空**（旁路指纹），**产物闸门**报错 `unmapped host table key "@codemirror/search"` |
| 还原 | — | **0** | 有 | 7 | 往返闭合 |

失败路径实测残留：

- `src-tauri/resources/builtin-ep/sql-editor-pro/` → **不存在**（无 `signature.sig`）。
- `artifacts/*.dzx` → **无**。
- `artifacts/.pack-ep-staging-sql-editor-pro/` → 留有 `manifest.json` + `dist/index.esm.js`，**无 `signature.sig`**，其中确实含越界键 `__DATAZEN_HOST__["@codemirror/search"]`（现场证据）。这正是 Coder §4.5「有意保留」的行为。

**残留取舍裁定：可接受。** 依据：

1. `artifacts/` 在 `.gitignore:70`，不污染 git 工作区。
2. 残留点在 `artifacts/`，而 `resolve-pro` 的「已暂存」短路只认 `src-tauri/resources/builtin-ep/<ext>`，**两者不同路径**，残留**不会**被后续构建误认为已暂存产物。
3. 成功路径 `packEp` 结尾 `rmSync(workDir, …)` 清空；下次运行 `stagePackageTree` 开头也对 `targetDir` 先 `rmSync`。实测还原后 `artifacts/` 重新变空 ⇒ 失败残留只存活到下一次成功/失败运行为止。
4. 保留现场对排查「旁路来源」有实际价值，与 Coder 记录一致。

**⚠️ 附带观察（非本提交引入，`resolve-pro` 既有行为，本轨范围外，仅记录）**：失败的构建**不会**清掉上一次成功暂存的已签名树。实测：先成功构建（`builtin-ep/…/dist/index.esm.js` sha `579818bf…`）→ 再注入 → 若未清暂存目录，`resolve-pro --edition=pro` 直接走短路 **exit 0** 并沿用**旧签名**。这正是协调者踩坑 2 的机制。建议在台账里记一笔，但**不登记为本轨 Bug**（与 `85594adb4` 无关，且 `resolve-pro.mjs` 不在本提交改动面内）。

## 裁定 (3) · 「不变量读两份列表」的真实效果

**静态核对**（独立解析，非采信 Coder）：`HOST_SHARED_MODULES` n=11，`src/main.tsx` 宿主表 n=11，**两份集合恒等**（互差集均为空），两侧均无重复项，`allow ⊆ host` 成立，`react: reactAll` 确为全表唯一不带引号的条目 ⇒ **协调者撤销 BUG-004 是正确的**，Coder 拒绝为凑红而改任一侧清单的处置正确。

**变异性证明**（不靠读码）：闸门确实读**两份**而非一份。

| 探针 | 改法 | 转红 |
| --- | --- | --- |
| M4b | `host = new Set()`，**永不读** `src/main.tsx` 宿主表 | **7 failed / 48 passed** |
| M4d | `allowList = new Set()`，**永不读** `HOST_SHARED_MODULES` | **1 failed / 54 passed** |

⇒ 任一侧被抽掉都必然转红 ⇒ 两侧均为**承重**。

**真实流水线反事实**（临时把 `@codemirror/search` 只加进 `HOST_SHARED_MODULES`，配合旁路注入，**已还原**）：

```
EXIT=1
[pack-ep]   - host table key "@codemirror/search" is in HOST_SHARED_MODULES
              but the __DATAZEN_HOST__ table in src/main.tsx never publishes it
```

⇒ 两份列表分叉时闸门**确实会红**，且 `allowListedOnly` 分支的**独立报错文案**在真实管线里可达，不是死代码。
注意分叉后错误类别从 `unmapped host table key` 变为 `host table key … never publishes it`，两类错误可区分。

## 裁定 (4) · §G1 规格更正准确性

逐条核对 `docs/development/editor-pro-productivity-plan.zh-CN.md` §G1：

| 更正点 | 核对方式 | 结论 |
| --- | --- | --- |
| 保留 2026-08-18 原文并标注「对具名/默认/命名空间导入不成立」 | 读 diff | ✅ 原文逐字保留，仅加引用块与 ⚠️ 标注，**未改写历史** |
| 失效表按导入形态分列（副作用 / 具名 / 默认 / 命名空间） | **真实管线三行逐一实测** | ✅ 三行全对；副作用行走输入闸门，具名行走产物闸门 |
| 「产物级不变量才是真闸门」 | 旁路注入 E2E | ✅ `rewrote bare imports:` 空 ⇒ 输入闸门无物可拒；产物闸门 exit 1 |
| 括号式 `__DATAZEN_HOST__["@codemirror/view"]`（单双引号） | grep 已发布产物 | ✅ 实际为**双引号**（esbuild 压缩把 Pro `renderChunk` 写的单引号规范化为双引号）——与协调者观察一致 |
| 点号式 `__DATAZEN_HOST__.react` | grep 已发布产物 | ✅ 实际字节 `globalThis.__DATAZEN_HOST__.react.default`，**点号式真实存在** |
| 基线「各 9 项」→「各 11 项」 | 独立解析两份列表 | ✅ 11 = 11，键集恒等 |
| 「产物实际引用 7 键」 | 闸门日志 | ✅ `@codemirror/{lint,state,view}`、`@datazen/extension-points`、`@datazen/ui`、`react`、`react/jsx-runtime` |
| 「两份基准 + 精确匹配」的理由 | M4b/M4d + 前缀探针 | ✅ 成立（见下） |

**补充的机制性发现（可补入文档，非缺陷）**：Pro `renderChunk` 用单引号模板串写出 `['…']`，但 esbuild 压缩阶段会把字符串字面量统一规范化为双引号，**所以真实产物里越界键恒为双引号形态**；单引号形态只在关闭压缩或字面量含双引号时才出现。两种形态都覆盖是对的，但文档若能点明「实测产物是双引号、单引号来自 pack-ep 自身改写器」，会少一次读者困惑。

**精确匹配 vs 前缀**：现有用例 `matches keys exactly, never by prefix` 钉死 `react-anything` 不放行。语义正确。

## 审查发现（非 Bug，供台账留档）

1. **`scripts/` 不在 tsc program 内**：`tsconfig.json` `include` 只有 `src` 与 5 个 `packages/*`，`npx tsc --noEmit --listFilesOnly` 共 2175 个文件，**零个**在 `scripts/` 下 ⇒ 本轨两个代码文件（`pack-ep.mjs` / `pack-ep.test.ts`）的类型检查覆盖率为 **0**。台账上「tsc 整仓 0 错」对本轨**不构成任何证据**。这是仓库既有条件，非本提交引入，不登记为 Bug。
2. **整仓 tsc 在本 worktree 有 7 个错**，全部落在 `src/stores/__tests__/panelStore.panes.test.ts` 与 `src/windows/connection/__tests__/QueryPanel.paneRouting.test.tsx`（Track C `0042d8ef7 feat(panel)` 引入）。与本轨改动零重叠，属**基座带入**、非本轨缺陷。协调者「集成分支 0 错」的说法与其集成分支基座一致，不是矛盾。
3. **测试文件内复制了一份宿主表解析器**：`pack-ep.test.ts:73-91` 的 `parseHostGlobalTableKeys` 是 `readHostGlobalTableKeys` 的副本，G1 漂移守卫用**副本**。若生产解析器退化（例如重新只认带引号、丢掉 `react`），漂移守卫仍绿。所幸新用例 `reads the real host entry table and finds 11 published keys` 单独钉住了生产解析器（长度 11 + 含 `react`/`@codemirror/commands`），所以不是真实盲区，但**建议 Coder 后续把漂移守卫改为直接调用生产解析器**，避免两份实现漂移。
4. **两份列表的语义是「并集准入」**：`!allowList.has(key) && !host.has(key)` ⇒ 只要宿主表发布了，即使白名单没声明也会放行；而 `progress.md` §4.1 表格写的是「宿主表里存在**不等于**该被允许」。以运行期正确性论，并集是安全的那一侧（宿主发布了就不会 `undefined`），故**不是缺陷**；只是文档的论证措辞与实现的准入语义略有落差，建议对齐。
5. `assertHostGlobalKeysInTree` 在传入 `opts.hostTable` 显式数组时使用之，**默认参数才读盘**；`createDzxArchive` 用 `{ label, ...opts }` 展开，调用方可覆盖 `modules`/`hostTable` ⇒ 纵深防御路径默认可被调用方绕过。当前无调用方这样做，记录备查。
