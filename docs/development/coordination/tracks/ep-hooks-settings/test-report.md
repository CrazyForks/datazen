# ep-hooks-settings 测试报告（Tester，第 1 轮）

- **轨道**：Track B（`ep-hooks-settings`）
- **被测代码**：Host `feature/ep-hooks-settings` @ `4192affd8`（12 文件）+ Pro `productivity/ep-hooks-settings` @ `63b212a`（4 文件）
- **测试基线**：`6d3fedf97`（`Merge branch 'main' into feature/ep-hooks-settings`）
- **测试工作区**：`/Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-ep-hooks-settings`
- **结论**：**TEST_FAILED** — 1 个高危、2 个低危缺陷成立；6 项待裁决声明中 5 项成立、1 项部分成立。
- **重要**：Tester **未修改任何业务代码**，本轮新增 3 个 `[tester]` 测试文件仅补齐测试覆盖缺口。

---

## 一、复现环境与门禁结果

全部命令在 worktree 内以 `npx` 串行执行（不并发跑 tsc + vitest）。全程未执行 `pnpm install`，未设置 `CI=true` / `confirmModulesPurge=false`。

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npx tsc --noEmit` | **exit 0**（含本轮新增 3 个 tester 测试文件） |
| Host 全量单测 | `npx vitest run` | **464 文件 / 4598 测试全部通过**，99.51s |
| 轨道 4 个测试文件 | `npx vitest run <4 files>` | **5 文件 / 57 测试通过**（security 25、proCompartments 10、proKeymapPrecedence 14、IntentionJourney 2、ProSettingsJourney 6） |
| Pro 全量单测 | Pro 仓 `npx vitest run` | **63 文件 / 780 测试通过** |
| Pro 类型 | Pro 仓 `npx tsc -p tsconfig.json --noEmit` | **exit 0** |
| Pro 打包 + 签名 | `node scripts/resolve-pro.mjs --edition=pro --pro-path=<abs>` | **exit 0** |

### 1.1 关于 Coder 的 "tsc 0 errors" 结论

`npx tsc --noEmit --listFiles` 证明当前配置**确实**把测试文件纳入门禁：**521 个测试文件**在列，其中包含本轨道新增的
`src/components/sql-editor/__tests__/proCompartments.test.ts`、`proKeymapPrecedence.test.ts`、
`packages/extension-points/src/__tests__/security.test.ts`、`src/components/__tests__/SqlEditorProSettingsJourney.test.tsx`、
`SqlEditorIntentionSettingsJourney.test.tsx`。

背景：`d14037e8b`（从 main 合入）移除了 `tsconfig.json` 的 `exclude`，所以测试文件是**现在**才进入门禁的。
Coder 的 `tsc` **结论**成立，但其**推理前提**（测试文件不参与类型检查）已过期。本 Tester 复跑后结论一致。

### 1.2 打包命令的一个陷阱（供 Coder 参考，非缺陷）

`node scripts/resolve-pro.mjs --edition=pro` 在不带参数时命中短路分支，输出
`[resolve-pro] pro extension already staged in builtin-ep, writing codegen` 并**不重新打包**，
产物是陈旧的，不能作为验证证据。必须先
`rm -rf src-tauri/resources/builtin-ep/sql-editor-pro` 再带 `--pro-path` 重跑，才会真正走构建 + 签名路径。
本 Tester 第二次即命中真实路径（exit 0），关键日志行：

```
[pack-ep] rewrote bare imports to __DATAZEN_HOST__:
```

冒号后为**空列表** —— 即打包器没有改写任何一个 bare import（原因见 §六 BUG-001）。

---

## 二、改动代码覆盖率（显式测量，非门禁产物）

`vitest.config.ts:41-69` 的 coverage `include` 白名单**不包含** `src/components/sql-editor/**`，
因此本轨道的核心改动**完全不在覆盖率门禁内**，"测试全绿"本身是弱证据。Tester 用显式
`--coverage.include` + `--coverage.reporter=json` 重跑全量相关测试后测量。

### 2.1 文件级覆盖率

| 文件 | % Stmts | % Branch | % Funcs | % Lines |
| --- | --- | --- | --- | --- |
| `src/components/sql-editor/proCompartments.ts`（**新增**） | 98.30 | 93.33 | 100 | **100** |
| `src/components/sql-editor/paste/createPasteExtensions.ts` | 100 | 100 | 100 | 100 |
| `packages/extension-points/src/security.ts` | 100 | 90.24 | 100 | 100 |
| `src/components/sql-editor/SqlEditor.tsx` | 76.14 | 48.64 | 76.92 | 82.55 |
| `packages/extension-points/src/sqlEditorEnhancedEP.ts` | 68.42 | 100 | 50 | 68.42 |
| `src/components/sql-editor/editorExtensions.ts` | 51.21 | 43.22 | 75 | 55.78 |

### 2.2 改动可执行行覆盖率（真正的验收口径）

把 `git diff 4192affd8^ 4192affd8` 的新增行与 v8 的 statement/branch/function 位置**取交集**
（排除注释与空行，否则数字无意义）：

| 文件 | 命中/可执行改动行 |
| --- | --- |
| `proCompartments.ts` | 65/65 = **100%** |
| `SqlEditor.tsx` | 15/15 = **100%** |
| `security.ts` | 1/1 = **100%** |
| `editorExtensions.ts` | 0/0（改动全为类型声明与 re-export，无可执行语句） |
| `createPasteExtensions.ts` | 0/0（同上） |
| `sqlEditorEnhancedEP.ts` | 2/3 = 66.7%，**未覆盖：L164** |
| **合计** | **83/84 = 98.8%** |

**结论：改动代码覆盖率 98.8%，满足 tester.md 的 ≥80% 要求。**

`editorExtensions.ts` / `createPasteExtensions.ts` 的 0/0 不是漏测：两者的改动分别是
5 个 option 接口改为 `extends ProCompartmentOptionsBase`、以及新增 re-export，均无可执行语句。
`proCompartments.ts` 的 93.33% branch 缺口是 `proCompartments.ts:171` 的
`if (id === EXTRA_COMPARTMENT_ID) continue;` —— 该分支**不可达**（见 §五 BUG-003）。

### 2.3 唯一未覆盖的改动行 → 已由 Tester 补齐

`packages/extension-points/src/sqlEditorEnhancedEP.ts:164` 是全轨道唯一未覆盖的改动可执行行：

```ts
createEditorPanelSlot: () => null,
```

原因：`createEditorPanelSlot` 属于 P3 范围，本轨道宿主**没有任何调用点**，
所以全仓库没有任何测试调用过它。而验收标准 §四.1 明确要求"新钩子在 fallback 下返回 null / 空数组 / null"。
同一条验收项里的"fallbackFeatures 仍为 `Object.freeze`"也**从未被任何测试断言过**
（全仓 `Object.isFrozen` 命中项只有 `metadataCache.test.ts` / `schemaCache.test.ts`，与本轨道无关）。

Tester 已用 `packages/extension-points/src/__tests__/epHookFallback.tester.test.ts`（5 测试）补齐。

---

## 三、本轮新增的 Tester 测试（3 文件 / 26 测试，全部通过）

| 文件 | 测试数 | 补的是什么缺口 |
| --- | --- | --- |
| `packages/extension-points/src/__tests__/epHookFallback.tester.test.ts` | 5 | 验收 §四.1 中"fallback 冻结 + 3 个新钩子降级"整段无任何断言；覆盖 `sqlEditorEnhancedEP.ts:164` |
| `src/components/sql-editor/__tests__/proCompartments.tester.test.ts` | 11 | `readProSettingsBag` / `proSettingFlag` 的优先级与退化输入无直接断言；`reconfigureProCompartments` 迟到槽位合并分支未覆盖 |
| `src/components/sql-editor/__tests__/keymapPrecedenceRealHost.tester.test.ts` | 10 | 原 `proKeymapPrecedence.test.ts` 用**手搓**扩展列表代替 `createBaseEditorExtensions`，无法发现宿主 keymap 优先级被提高的回归 |

`tsc --noEmit` 在加入这 3 个文件后仍为 **exit 0**（测试文件参与类型检查）。

---

## 四、协调者六项声明的独立裁决

### 声明 1 — G3 "生效可证"：`pasteInstalled` sentinel 是否互斥？ → **成立（附一处具名弱点）**

**证据。** `src/components/__tests__/SqlEditorProSettingsJourney.test.tsx` 的 `pasteInstalled` facet 定义为
`opts?.proSettings?.pasteAsIn !== false`，因此它为 `false` 的**充要条件**是：某个舱位工厂收到了一个真实转发过来的
bag，且该 bag 的 `pasteAsIn === false`。

要证明"不存在另一条能翻转该 facet 的路径"，只需排除 `proSettings` 在 payload 之外被独立改写。已核对：

- `SqlEditor.tsx:409` 的 `proPayload` useMemo 依赖里，`proSettings` 来自 `readProSettingsBag(driverSettings)`；
- `readProSettingsBag` 是纯函数（`proCompartments.ts:217-223`），`EMPTY_PRO_SETTINGS` 是模块级冻结单例
  （`:207`），无其他写入点；
- 该测试第 1 例还额外对 `mock.calls.at(-1)?.[0]?.proSettings` 做了深相等断言。

⇒ 任何 `proPayload` 的身份变化都必须由 `proSettings` 变化引起，不可能由无关 payload 变化翻转该 facet。
**互斥性成立。**

**具名弱点（非阻塞）。** 宿主字段名 `proSettings` 与 Pro 侧读取点 `opts.proSettings.pasteAsIn` 之间的连接，
**仅由 `SqlEditorEnhancedOptions = Record<string, any>` 这一个宽松类型保证，没有任何类型闸门**。
跨仓改名（例如 Pro 侧改成读 `opts.settings`）会让两侧所有测试**同时保持全绿**，而线上功能整体失效。
两仓均已有跨仓读文件的先例（宿主 `security.test.ts` 直接读 Pro 的 `manifest.json`），
故在 Pro 侧补一条"读宿主边界文件、钉住 `proSettings` 字段名"的测试是符合本仓惯例的做法。

### 声明 2 — `proKeymapPrecedence.test.ts` 的 14 个控制是否是真控制、guard 例是否真抛错？ → **成立**

逐项核对后确认这 14 个测试**不是同义反复**：

1. **guard 会真抛错。** `claimedEventFor`（`:125-134`）在 `defaultKeymap` 对所有候选拼写都不响应时
   **`throw new Error(...)`**，而不是返回 `undefined` 后继续跑绿。另有 `:138-141` 的独立例
   断言 `candidates.some(...)` 为 `true`。若某个 chord 在本环境不被 `defaultKeymap` 拥有，整个文件会响亮失败。
2. **控制有鉴别力。** `:159-176` 的 "control" 例把**同一批 binding** 以默认优先级装进同一位置，
   并断言 `calls === []` **且** `hostAnswered === true` **且** 签名发生变化。
   若 chord 其实无人争夺，该例的 `hostAnswered` 会是 `false` 而失败 —— 所以它确实能杀死同义反复。
3. **区分了"优先级"与"注册顺序"。** `:259-277` 用 `Prec.default` 放置一个同级竞争者，
   断言 `calls === ['pro']`。
4. **证明 `Prec.highest` 不会让钩子变贪婪。** `:179-200` 钩子返回 `false` 时，
   断言三个 chord 全部到达钩子（`calls` 等于全部 label）且宿主命令仍然执行。
5. 其余用例分别覆盖"EP 未实现该钩子 → 等价于 fallback 空 keymap"、"钩子抛错 → 熔断回退"、
   "keymap 槽随整批一起重配"。

**残留缺口（本轨道未覆盖，Tester 已另行补测）。** 该文件在 `:243` 手搓
`keymap.of([...defaultKeymap, ...historyKeymap])` 来模拟宿主，而真实
`createBaseEditorExtensions`（`editorExtensions.ts:254-293`）还会注册 `:259` 与 `:333` 两个 keymap 以及 `searchKeymap`。
少装宿主 keymap 只会让"钩子赢"更难，因此**不会制造假绿**；但它无法发现反方向的回归 ——
若将来宿主把某个 keymap 提到 `Prec.high`（与 `Prec.highest` 同级）之上，生产环境会退化成
"扩展 keymap 静默永不触发"，而这份手搓夹具**依然全绿**。
Tester 已用 `keymapPrecedenceRealHost.tester.test.ts` 直接调用真实 `createBaseEditorExtensions` 补上这一方向，
10 个测试全绿：三个 contested chord 在真实宿主组合下（a）确实被宿主拥有、（b）被钩子赢下、
（c）以默认优先级安装时被宿主吞掉、（d）钩子 `return false` 时宿主命令照常执行。

### 声明 3 — EP 版本两侧都是 `1.1.0` → **成立**

| 位置 | 值 |
| --- | --- |
| 宿主 `packages/extension-points/src/security.ts:25` | `EXTENSION_POINTS_VERSION = '1.1.0'` |
| Pro `manifest.json` → `engines.extensionPointsVersion` | `"1.1.0"` |
| Pro `package.json` → `engines` | `null`（不存在） |

Pro 仓内已无任何残留 `1.0.0`。且 `packages/extension-points/src/__tests__/security.test.ts`
新增的 describe **直接读磁盘上真实的 Pro manifest** 并断言其为 `1.1.0`、且 `1.0.0` / `1.2.0` 会被拒绝，
两侧因此无法再悄悄漂移。

**同时确认协调者的判断**：progress.md §三写的"package.json"确为笔误，Pro 的版本声明只存在于 `manifest.json`。

### 声明 4 — Coder 两处越界测试改动是否削弱了断言？ → **成立（均未削弱）**

**(a) `src/components/__tests__/SqlEditorIntentionSettingsJourney.test.tsx`**
从"调用次数"改为"opts 内容"断言：把 `const initialIntentCalls = ...` 换成
`const initialIntentionOpts = createIntentionExtensions.mock.calls.at(-1)?.[0]`，
再断言 `insertValueHints` 在 `*` 键入**前**为 `false`、键入**后**为 `true`。

判定：**增强，不是削弱**。原"调用次数"断言只能证明工厂被调过，无法证明传下去的 opts 变了 ——
一个恒返回同一份 opts 的实现可以让计数断言通过而功能是坏的。新断言直接读 opts 的**具体字段**，
并把它绑定到"一次真实击键"这个旅程上。代价是失去了对调用次数的约束，
但该约束由 `SqlEditorProSettingsJourney.test.tsx` 的"6 个工厂全部重跑"一例覆盖，不构成净损失。
另外 mock 的类型标注从隐式 `any` 收紧为 `vi.fn((_opts: IntentionCompartmentOptions) => [])`，
符合 AGENTS.md "禁止用 any 绕过"的要求。

**(b) Pro `src/intentions/__tests__/linterCompartment.tester.test.ts`**
在"穷尽的有序 `[key, defaultValue]` 列表"末尾追加 `['pasteAsIn', true]`。

判定：**新增覆盖，不削弱**。该列表的作用是"任何一个 Pro 声明的设置项漏登记、漏实现或默认值写错都让测试失败"。
新增 Pro 设置项后不同步登记它，**正是**该列表要抓的缺陷。加一行是必须的维护动作，不是放宽。
全量 Pro 测试 780 项全绿佐证登记完整。

### 声明 5 — Coder 承认的两处既有缺陷是否被本轨道放大？ → **成立（结论：均未被放大，其中一处实际被收窄）**

**(a) `createPasteExtensions()` 不传 opts 会在 `proFeatures.ts:202` 抛 `TypeError`。**
现状：`proFeatures.ts:200` 新增了
`if (opts?.proSettings?.pasteAsIn === false) return [];`，位置在无保护的 `opts.onDrop`（`:202`）**之前**。
当 `pasteAsIn === false` 时，函数在触碰 `opts.onDrop` 之前就返回了。
且宿主 `SqlEditor.tsx:360` 永远传入一个对象；唯一传 `{}` 的是测试
（`editorHotplug.test.ts:51,87`、`epHotplugJourney.test.ts:84`、Pro `proFeatures.tester.test.ts:54`），
所以 `opts === undefined` 在生产路径上仍不可达。
⇒ **不但没有被放大，本轨道反而让它更难触发。**

**(b) `SafeCompartmentWrapper` 抛错会注销整个 EP，且 `onCircuitBreak` 未接线。**
现状：这是 `packages/extension-points/src/safeCompartment.ts` 的既有行为，**本轨道完全未改动该文件**。
本轨道新增的 `createExtraExtensions` / `createExtraKeymap` 走的是同一个 wrapper
（`proCompartments.ts:250-285`），行为与既有 13 个成员一致。
`SqlEditorProSettingsJourney.test.tsx` 的 "createExtraExtensions throw → circuit breaker" 一例
证明的是**降级行为可观测**（编辑器存活、槽位回退为空），而不是"降级策略合理"。
⇒ **未被放大**，但确实仍是既有设计债，且本轨道把它扩散到了 2 个新钩子上（覆盖面变大，性质不变）。

### 声明 6 — `editorExtensions.ts` 824 行 > AGENTS.md 建议的 800 行 → **部分成立（记为已知偏差，不单独立 bug 文件）**

实测：`editorExtensions.ts` = **824** 行（本轨道前为 **839** 行，即本轨道**净减 15 行**），
`proCompartments.ts` = 285 行（新增），`SqlEditor.tsx` = 628 行。

AGENTS.md 原文是"**推荐**单文件不超过 800 行，严禁出现**超大**单文件"。
824 行既不是"超大"，且本轨道已经把 `proCompartments` 抽了出来并在继续瘦身。
⇒ 不足以判为违规，但 AGENTS.md 用了"严格限制 / 推荐不超过"这类措辞，
**Tester 判定为"部分成立"：记为已知偏差，不单独立 bug 文件**（超出的 24 行不构成"超大单文件"，
且本轨道净减 15 行）。是否再拆一层交由协调者决定。

---

## 五、缺陷清单

| 编号 | 标题 | 严重度 | 状态 |
| --- | --- | --- | --- |
| BUG-001 | 宿主 EP 打包白名单可被预改写绕过（`.dzx` 签名产物可静默注入任意 `__DATAZEN_HOST__` key） | **高** | 待修复 |
| BUG-002 | 编辑器挂载时多发一次 8 槽位重配事务，与代码注释声明的意图相反 | 低 | 待修复 |
| BUG-003 | `proCompartments.ts:171` 的 `continue` 分支不可达（死代码） | 低 | 待修复 |

各缺陷的完整复现步骤、日志与期望行为见 `bugs/` 目录下的同名文件。

---

## 六、BUG-001 证据：EP 打包白名单绕过（高危）

### 6.1 机制

EP 以 blob URL 动态加载，所有 bare import 必须由 `globalThis.__DATAZEN_HOST__` 提供。
宿主在 `src/main.tsx:45-55` 建表（9 个 key）：

```
@datazen/extension-points, @datazen/ui, react, react-dom, react/jsx-runtime,
@codemirror/view, @codemirror/state, @codemirror/lint, @codemirror/autocomplete
```

打包侧有两道关，**互不校验**：

1. Pro `vite.config.ts` 的 `hostGlobalsPlugin` 在 `renderChunk`（`enforce: 'post'`）阶段
   **预先**把 bare import 改写成 `globalThis.__DATAZEN_HOST__[...]`。
   判定条件是 `isBareExternal = s => BARE_SPECIFIERS.has(s) || /^@codemirror\//.test(s)` ——
   **完全不看白名单**。
2. `scripts/pack-ep.mjs` 的 `rewriteEpImportsToHostGlobals` 在此之后运行，
   遇到**仍是** bare 形式的 import 才校验 `HOST_SHARED_MODULES` 并在未命中时抛错。

⇒ 第 1 步改写过的 specifier 对第 2 步而言根本"不存在"，白名单对它们**零可见性**。

### 6.2 逐 key 证据：当前已签名产物是安全的

对强制重建后的签名产物 `src-tauri/resources/builtin-ep/sql-editor-pro/` 逐 key 比对
`__DATAZEN_HOST__[...]` 出现过的 key 与宿主表 key：

| 产物中出现的 `__DATAZEN_HOST__` key | 宿主表有？ |
| --- | --- |
| `@codemirror/lint` | ✅ |
| `@codemirror/state` | ✅ |
| `@codemirror/view` | ✅ |
| `@datazen/extension-points` | ✅ |
| `@datazen/ui` | ✅ |
| `react` | ✅ |
| `react/jsx-runtime` | ✅ |

产物共 **7** 个 key，宿主表 **9** 个 key。**产物 key 集合 ⊆ 宿主表 key 集合：true。**
宿主表中未被产物使用的 2 个：`react-dom`、`@codemirror/autocomplete`。
`HOST_SHARED_MODULES` 中的 key 没有一个缺失于宿主表。
产物中 `__DATAZEN_HOST__` 共出现 8 次（6 处方括号取值 + 2 处 `.react` 点号取值）。
打包日志 `[pack-ep] rewrote bare imports to __DATAZEN_HOST__:` 冒号后为空 —— 与上表一致，pack-ep 的关确实一个都没拦到。

### 6.3 绕过是真实存在的（不修改仓库，直接调用导出函数）

用 `node --input-type=module` 直接 import `scripts/pack-ep.mjs` 的
`rewriteEpImportsToHostGlobals`，逐个用例实测：

| 用例 | 输入 | 结果 |
| --- | --- | --- |
| A（未预改写） | `import { indentWithTab } from "@codemirror/commands";` | **抛错**：`` [pack-ep] unmapped bare import from "@codemirror/commands" — add it to HOST_SHARED_MODULES and the host __DATAZEN_HOST__ table in src/main.tsx ``（失败即关闭，符合预期） |
| B（同一 spec 已被预改写） | `const { indentWithTab } = globalThis.__DATAZEN_HOST__["@codemirror/commands"];` | **不抛错**，代码原样返回，`rewritten: []`（**失败即放行，白名单完全看不见**） |
| C（非 `@codemirror` 裸依赖） | `import { invoke } from "@tauri-apps/api/core";` | **抛错**（Pro 插件只把 `BARE_SPECIFIERS` 与 `/^@codemirror\//` 改写，其余保持裸形式，所以仍能到达闸门） |

⇒ 绕过面精确等于 `/^@codemirror\//` 加 5 个 `BARE_SPECIFIERS`。
`@codemirror/commands` / `@codemirror/search` / `@codemirror/language` / `@codemirror/commands` 等
目前不在白名单、也不在宿主表里的常用包，一旦被 Pro 侧引用就会**静默**进入签名产物。

### 6.4 为什么它是"高危"而不是"当前故障"

- **当前是潜伏态**：本轨道 7 个 key 全部合法，现有签名产物可正常加载，**无实际故障**。
- **危害在于保证的缺失**：产物是**签名后**分发的。若将来任一 Pro 侧改动引入了新的 `@codemirror/*` 依赖，
  打包会**静默成功**，签名会**覆盖**它，运行时在 blob URL 里读到一个 `undefined` 而抛 `TypeError`。
  故障点在用户机器上、在签名校验之后 —— 恰好是签名的兜底范围之外。
- **零测试覆盖**：全仓无任何测试覆盖 `rewriteEpImportsToHostGlobals` 或 `HOST_SHARED_MODULES`。
  匹配 `__DATAZEN_HOST__` 的测试只有 `src/windows/connection/__tests__/epHotplugJourney.test.ts`
  与 Pro `src/locales/__tests__/locales.test.ts`，且**都不对打包产物做断言**。
  这正是 35 项（或本次 4598 项）全绿却完全看不见它的原因。

### 6.5 修复方向（约束：不得"顺手清理"任一侧）

Coder 在 progress.md §五.8 明确指出：Pro vite 的 `/^@codemirror\//` 宽放行与 pack-ep 的窄白名单之差
**是有意为之，合并时不得被"整理掉"**。因此修复方向是**让宿主侧成为权威**，而不是删掉任一侧：

- 让 `pack-ep.mjs` 在校验"剩余裸 import"之外，**额外扫描已改写产物中的每一个 `__DATAZEN_HOST__['…']`**，
  要求其 key 必须在 `HOST_SHARED_MODULES` 内，否则抛错；或
- 让 Pro 的 `hostGlobalsPlugin` 在 `renderChunk` 里**直接复用** `pack-ep` 的同一份白名单常量（单一事实源）；
- 两条都可行，**且都保持 `/^@codemirror\//` 的放行策略不变**。

---

## 七、其余观察（均非本轨道引入，不阻塞）

1. **`DataTransferWindow.test.tsx` 存在既有 flake。** 在带 v8 coverage 的全量跑中该文件 3 个用例失败
   （`prefills connection endpoints from URL params` 5000ms 超时后 DOM 未卸载，
   导致后续 `renders wizard shell` 报 `Found multiple elements by: [data-testid="data-transfer-window"]`）。
   **与本轨道无关**，证据：该文件与 pre-track 父提交 `2b0b7da09` **逐字节相同**
   （`git diff --stat 2b0b7da09 HEAD -- <file>` 为空），且最后改动它的提交是 pre-track 父提交的祖先；
   它的 import 图不触及本轨道任何文件。纯净不带 coverage 的全量跑（4598/4598）它是绿的 —— 属负载相关 flake。
2. **`statementRanges.test.ts` 的 20k fixture 性能冒烟用例**在带 coverage 插桩时耗时 114.8ms，
   超过其 50ms 断言阈值；不带 coverage 时通过。同样是插桩开销，不是回归。
   若希望这类冒烟用例稳定，建议给它显式 `testTimeout` 与更宽的阈值基线。
3. **跨仓字段名 `proSettings` 无类型闸门**（见声明 1）。建议在 Pro 侧加一条读宿主边界文件的契约测试。
4. `progress.md` §三 的 "package.json" 应为 `manifest.json`（见声明 3）。

---

## 八、最终结论

**TEST_FAILED**

- 验收标准 §四 10 项：**9 项通过**，1 项（§四.1 中"fallback 冻结 + 3 个新钩子降级"）**证据不足**，
  已由 Tester 用 `epHookFallback.tester.test.ts` 补齐证据，现已通过。
- 改动代码覆盖率 **98.8%**（≥80% 要求达标）。
- 类型门禁 exit 0；Host 4598 项、Pro 780 项全绿，无回归。
- 登记缺陷 3 项：**BUG-001（高）**、BUG-002（低）、BUG-003（低）。

**给协调者的行动建议（按紧急度）**：

1. **BUG-001 必须在合并前处置或显式接受**。它是潜伏态，不会让本轨道测试变红，
   但它意味着"签名产物里的宿主注入"没有任何把关，且当前零测试覆盖。
2. BUG-002 / BUG-003 均为低危，不阻塞合并，可与 BUG-001 同轮修复。
3. 声明 2 / 3 / 4 / 5 / 6 的结论均可供协调者直接采信；声明 1 的结论成立但附带一个建议项（跨仓字段名契约测试）。
