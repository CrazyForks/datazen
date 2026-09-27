# BUG-001：宿主 EP 打包白名单可被"预改写"绕过

- **状态**：待修复
- **严重度**：高
- **轨道**：ep-hooks-settings
- **发现者**：Tester（第 1 轮）
- **发现时基线**：`6d3fedf97`（Host `feature/ep-hooks-settings` @ `4192affd8`）
- **类别**：打包安全 / 保证缺失（当前潜伏，未造成实际故障）
- **是否本轨道引入**：**否**（本轨道未改动 `scripts/pack-ep.mjs`，也未改动 Pro 的 `vite.config.ts`）
  本轨道只是**暴露**了它：这是本轨道唯一一条"两侧都必须存在且必须一致"的跨仓契约，而它没有被任何测试覆盖。

---

## 一、一句话描述

EP 产物在**签名之前**就已经被 Pro 的 vite 插件把裸 import 改写成了
`globalThis.__DATAZEN_HOST__['<key>']`；打包器的白名单闸门只校验**剩余的**裸 import，
因此对已经改写好的 key **零可见性**。任何非白名单的 `@codemirror/*` 或 5 个
`BARE_SPECIFIERS` 之一，都能**静默**进入签名产物，运行时在 blob URL 里读到 `undefined` 并抛 `TypeError`。

---

## 二、机制（三行讲清）

```text
Pro 源码  ──vite renderChunk(后置)──▶  产物 JS（裸 import 已被改写为 __DATAZEN_HOST__[...]）
                                            │
                                            ▼
                              pack-ep.rewriteEpImportsToHostGlobals
                              （只扫"仍是裸形式"的 specifier，
                                命中 HOST_SHARED_MODULES，否则抛错）
```

- Pro `vite.config.ts`：`isBareExternal = s => BARE_SPECIFIERS.has(s) || /^@codemirror\//.test(s)`，
  `enforce: 'post'` 的 `renderChunk` 据此把 `import … from 'x'` 改写成
  `const {…} = globalThis.__DATAZEN_HOST__['x']` —— **不查任何白名单**。
- `scripts/pack-ep.mjs`：`rewriteEpImportsToHostGlobals` 在此之后运行，
  `HOST_SHARED_MODULES` 是 9 项窄白名单；遇到未映射的裸 import 抛 `unmappedError`。
  **已改写的 specifier 对它不存在。**
- 宿主 `src/main.tsx:45-55` 建 9 个 key 的 `__DATAZEN_HOST__` 表。

⇒ 第 1 步与第 2 步**互不校验**；第 2 步对第 1 步的输出没有约束力。

---

## 三、复现步骤（不修改仓库）

```bash
cd /Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-ep-hooks-settings
node --input-type=module -e "
import { rewriteEpImportsToHostGlobals } from './scripts/pack-ep.mjs';
const tryIt = (label, code) => {
  try { const r = rewriteEpImportsToHostGlobals(code); console.log(label, '=> NO THROW', JSON.stringify(r.rewritten)); }
  catch (e) { console.log(label, '=> THREW:', e.message); }
};
// A：未预改写（闸门应当拦下）
tryIt('A bare     ', 'import { indentWithTab } from \"@codemirror/commands\";');
// B：同一 specifier 已被 Pro 插件预改写（闸门应当仍然拦下 —— 这就是缺陷）
tryIt('B pre-rewrit', 'const { indentWithTab } = globalThis.__DATAZEN_HOST__[\"@codemirror/commands\"];');
// C：非 @codemirror 裸依赖（闸门应当拦下）
tryIt('C other    ', 'import { invoke } from \"@tauri-apps/api/core\";');
"
```

### 实测输出

```
A bare      => THREW: [pack-ep] unmapped bare import from "@codemirror/commands" — add it to HOST_SHARED_MODULES and the host __DATAZEN_HOST__ table in src/main.tsx
B pre-rewrit=> NO THROW []
C other     => THREW: [pack-ep] unmapped bare import from "@tauri-apps/api/core" — ...
```

**A 失败即关闭（正确）、C 失败即关闭（正确）、B 失败即放行（缺陷本体）。**

---

## 四、当前已签名产物是安全的（逐 key 证据）

```bash
rm -rf src-tauri/resources/builtin-ep/sql-editor-pro
node scripts/resolve-pro.mjs --edition=pro --pro-path=<Pro 仓绝对路径>
# 日志关键行： [pack-ep] rewrote bare imports to __DATAZEN_HOST__:      ← 冒号后为空
```

把产物里出现的每一个 `__DATAZEN_HOST__` key 与 `src/main.tsx` 的宿主表逐 key 比对：

| 产物中的 key | 宿主表 |
| --- | --- |
| `@codemirror/lint` | ✅ 有 |
| `@codemirror/state` | ✅ 有 |
| `@codemirror/view` | ✅ 有 |
| `@datazen/extension-points` | ✅ 有 |
| `@datazen/ui` | ✅ 有 |
| `react` | ✅ 有 |
| `react/jsx-runtime` | ✅ 有 |

- 产物 key 数 **7**，宿主表 key 数 **9**；**产物 ⊆ 宿主表：true**。
- 宿主表中未被产物使用：`react-dom`、`@codemirror/autocomplete`。
- `HOST_SHARED_MODULES` 中无任何 key 缺失于宿主表。
- 产物中 `__DATAZEN_HOST__` 出现 **8** 次（6 处方括号取值 + 2 处 `.react` 点号取值）。
- `pack-ep` 日志显示改写列表为空 ⇒ 闸门确实一个都没拦到，与"全部已被预改写"一致。

---

## 五、为什么定为"高危"

1. **当前潜伏，不造成故障**：本轨道 7 个 key 全部合法，现签名产物可正常加载。
2. **保证缺失才是危害**：产物签名后分发。任一 Pro 侧改动引入新的 `@codemirror/*`
   （例如 `@codemirror/commands`、`@codemirror/search`、`@codemirror/language`）
   都会**静默打包成功**、**签名通过**，故障出现在用户机器上、blob URL 内，
   恰好在签名校验的兜底范围之外 —— 运行时 `__DATAZEN_HOST__['@codemirror/commands']` 为 `undefined`，
   解构即抛 `TypeError`，整个 EP 加载失败。
3. **零测试覆盖**：全仓无任何测试覆盖 `rewriteEpImportsToHostGlobals` 或 `HOST_SHARED_MODULES`。
   仓库中匹配 `__DATAZEN_HOST__` 的测试仅
   `src/windows/connection/__tests__/epHotplugJourney.test.ts` 与 Pro `src/locales/__tests__/locales.test.ts`，
   且**都不对打包产物做断言**。这正是 4598 项宿主测试 + 780 项 Pro 测试全绿却完全看不见它的原因。

---

## 六、期望行为

打包器必须能对**最终产物**里出现的每一个 `__DATAZEN_HOST__` key 负责，
即"产物里任何被注入的宿主依赖，都必须同时在 `HOST_SHARED_MODULES` 内、且在宿主表内"。

---

## 七、修复方向（重要约束）

Coder 在 `progress.md` §五.8 已明确声明：Pro vite 的 `/^@codemirror\//` 宽放行与 pack-ep 的窄白名单之差
**是有意为之，合并时不得被"整理掉"**。因此**不要**通过删掉/收窄任一侧来"修复"。

可行的修复（择一或并行）：

- **让打包器做最终校验**：在 `rewriteEpImportsToHostGlobals` 中，除扫描剩余裸 import 外，
  额外遍历产物中所有 `__DATAZEN_HOST__['…']` 的 key，不在 `HOST_SHARED_MODULES` 内则抛错。
- **单一事实源**：把 `HOST_SHARED_MODULES` 提为一个两侧都能 import 的模块
  （例如 `packages/extension-points/src/hostSharedModules.mjs` 或 `scripts/hostSharedModules.mjs`），
  Pro 的 `hostGlobalsPlugin` 在 `renderChunk` 中直接使用它。

两条都**保持 `/^@codemirror\//` 的放行策略不变**，不触碰"宽 vs 窄"的有意差异。

---

## 八、建议补测（Tester 可代做，需协调者授权跨仓改动）

在 `scripts/__tests__/` 下新增一个打包器契约测试，至少覆盖：

1. 预改写形态的、**非**白名单 key ⇒ 必须抛错（当前 B 用例，失败即本缺陷）；
2. 预改写形态的、白名单内 key ⇒ 必须通过；
3. 未预改写形态的、非白名单 key ⇒ 必须抛错（A 用例，回归保护）；
4. 宿主表 key 集合 ⊇ `HOST_SHARED_MODULES` ⇒ 读 `src/main.tsx` 断言，防止两侧漂移
   （与本轨道 `security.test.ts` 读 Pro manifest 的跨仓读法同构）。
