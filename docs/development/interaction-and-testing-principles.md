# 交互与补全开发原则（防回归与测试设计规范）

> 本文档面向人类开发者与 AI Agent，旨在总结在复杂编辑器（CodeMirror）、交互表格（DataTable）、连接树与表单交互中常见的**状态机断层**、**过度过滤（打地鼠式修复）**与**测试通过率陷阱**，并确立核心开发与验证原则。

---

## 核心案例复盘

### 案例 1：表名补全误伤后续 `WHERE` 关键字
- **缺陷现象**：为了消除表名补全列表中的系统异常变量（如 `PG_EXCEPTION_HINT`），给 `kind === 'table'` 增加了强力过滤。但在用户输入完表名（如 `SELECT * FROM er_customers `）准备继续键入 `WHE` 时，由于算法只回溯最后一个关键字 `FROM`，导致状态无法退出，`WHERE` 关键字被当作“非表名候选”直接拦截。
- **根因分析**：
  1. **缺少状态生命周期的“退出跃迁条件”**：只定义了何时进入 `table` 上下文，没有定义表名输入完成后（空格、别名、逗号）何时退出该上下文；
  2. **硬过滤（Hard Filtering）替代了软排序（Soft Boosting）**：直接丢弃候选导致容错率为零，轻微的上下文判断延迟即引发致命功能断裂；
  3. **单元测试处于“静态切片测试”盲区**：测试用例只验证了“表名输入时关键字确实被拦截”，但从未模拟用户键盘“连续键入整句 SQL”的动态全过程。

### 案例 2：Gutter 语句运行按钮在真机失效
- **缺陷现象**：行号旁的执行按钮在 JSDOM 单元测试中通过 Mock 坐标测试通过，但在真实的 macOS WKWebView 中点击无响应。
- **根因分析**：
  1. **环境保真度偏差**：JSDOM 没有真实的几何排版引擎（Layout Engine），而真实 WebKit 视口在点击 Gutter 非文本编辑区时，`posAtCoords` 直接返回 `null`；
  2. **脆弱的物理坐标计算**：依赖屏幕物理坐标逆向反查 AST，而非采用确定性的 DOM 数据绑定（`data-*` 属性）。

---

## 六大核心开发原则

### 原则一：状态机思维（State Transition）优先于局部切片思维

1. **输入与交互是连续的状态流**：
   在编辑器、交互表单与步骤流中，用户的输入 90% 以上的时间处于**“语法不完整、操作进行中”的中间态（In-Flight State）**。
2. **任何上下文（Context）判定必须定义「全生命周期三要素」**：
   - **进入条件（Entry）**：何时确立该状态（如：检测到 `FROM `）；
   - **驻留行为（In-state）**：在该状态下的候选推荐或交互逻辑；
   - **退出/跃迁条件（Exit / Transition）**：何时结束该状态并交出控制权（如：表名后出现空白字符、别名、子句关键字或逗号）。
3. **禁止编写只有“进入”而没有“明确边界与退出”的单向判定逻辑**。

---

### 原则二：软排序（Soft Boosting）优先于硬过滤（Hard Filtering）

1. **容错性降级**：
   - 优先通过 **权重倾斜（Boost）** 解决排序问题：给核心期望结果加权（如 `boost: 10`），给低频干扰项降权（如 `boost: -5`），而非直接删除候选；
   - 即使边界上下文判定在击键瞬间发生轻微抖动，用户依然可以通过继续键入找到目标项，系统具备高弹性容错。
2. **仅在语义绝对互斥时使用硬拦截**：
   - 只有在语法绝对非法或冲突（例如点号 `alias.` 之后普通关键字 100% 不可能合法）时，才允许返回 `null` 或彻底清空。

---

### 原则三：打破“测试通过率陷阱”，建立「连续旅程测试（Journey Test）」

1. **交互型功能必须包含「连续旅程测试」**：
   凡涉及键盘输入、连续点击、拖拽操作的功能，**禁止只写单个静态字符串的断言**，必须编写模拟用户全流程操作的测试用例：
   ```text
   Step 1: 用户敲击初始字符 -> 断言状态 A 生效
   Step 2: 用户触发中间态 -> 断言状态平滑过渡
   Step 3: 用户完成当前操作敲击空格 -> 断言状态明确退出
   Step 4: 用户开始下一步操作 -> 断言新状态生效且上一状态不产生残留抑制
   ```
2. **测试用例必须覆盖“残缺中间态”**：
   测试输入不能全部是格式完备的标准语句（如 `SELECT * FROM users WHERE id = 1;`），必须针对用户实际书写过程中的非完整片段（如 `SELECT * FROM `、`SELECT * FROM users `、`SELECT * FROM users WHE`）进行验证。

---

### 原则四：警惕环境保真度偏差（JSDOM vs 真机 WebView）

1. **明确 JSDOM 的能力边界**：
   - **JSDOM 擅长**：数据结构映射、React 生命周期、事件分发调用逻辑；
   - **JSDOM 不擅长（不可信）**：
     - 几何排版与坐标计算（`getBoundingClientRect`, `posAtCoords`, `lineBlockAtHeight`）；
     - 原生手势与复杂事件流（Mac 妙控板拖拽、双击手势、修饰键组合）；
     - 操作系统级 API（系统剪贴板、文件拖拽、原生对话框）。
2. **数据属性解耦（Data Attribute Binding）**：
   - 涉及交互定位时，优先通过 DOM 属性（如 `dataset.lineFrom`, `dataset.statementIndex`）直接绑定实体标识，严禁在生产路径依赖视口物理坐标反查 AST。

---

### 原则五：修复代码时执行“三维影响度自查（3-Way Impact Check）”

每一次修改 Bug（尤其是看似只有两三行的局部条件），在提交前必须回答并验证以下 3 个问题：

| 评估维度 | 自查问题 | 反面教训 |
| :--- | :--- | :--- |
| **维度 1：目标达成度** | 这个改动是否真正彻底解决了当前缺陷？ | 以前修换行执行时，只截断了语句主体，漏掉了末尾分号。 |
| **维度 2：误伤排查（False Positives）** | 这个过滤/条件是否会把“看似相似但合法”的其它场景也拦截了？ | 修表名关键字干扰时，把用户接下来要敲的 `WHERE` 一并当作无关关键字过滤掉了。 |
| **维度 3：后置连续性（Next Step）** | 用户在完成这一步操作后，**紧接着按常理会做什么**？下个动作还能不能正常继续？ | 用户敲完表名后必然要写别名、JOIN 或 WHERE，没有验证后续输入。 |

---

### 原则六：断言与 i18n 文案解耦（Copy-Free Assertions）

1. **规则**：测试严禁把「由 i18n `t()` 渲染出来的可见文案字面量」当作断言目标或定位依据。允许的三类锚点，按优先级：
   1. **`data-*` 契约（首选）**：`getByTestId('redis-ttl-set')`、`slot.dataset.ttlState === 'no-expiry'` —— 状态用枚举属性表达，文案换了照样绿；
   2. **i18n key**：驱动 ui 测试统一 `useI18n: () => ({ t: (key) => key })`，随后 `getByText('redis.pubsubSubscribe')`；
   3. **字典回读**：仅当"可访问名称 / 解析结果本身"就是被测意图时（a11y 契约、locale 注册链、翻译链路），期望值从**同一份字典**取——`getByRole('menuitem', { name: enCopy('menu.file') })`、`expect(t('redis.console')).toBe(en['redis.console'])`——绝不硬编码英文字面量。宿主测试的回读**必须**走 `src/test/enCopy.ts` 的 `enCopy(key)`，不得裸写 `en[key]`：查表 miss 得到 `undefined`，而 testing-library 把 `getByRole('button', { name: undefined })` 理解成"不加 name 约束"，定位器当场退化成永真匹配，断言看着在、契约已经没了（它是否偶然变红只取决于页面上同类元素有几个，而不是被测行为 —— redis-assert-policy BUG-002）。`tsconfig.json` 把 `__tests__` 排除在 `npx tsc --noEmit` 之外、vitest 又不做类型检查，所以这道收敛只能放在运行期、且只能有这一处入口。
2. **改写，不是删除**：去掉字面量的同时必须以锚点形式保留**被测意图**。改写完必须仍能证明：元素存在、状态正确（`data-*` 取值）、参数确实被插值（`toContain(param)` + 无 `{` 残留）、不回显原始 key（`text !== key`）、跨语言不串味（zh 渲染里找不到 en 的解析值）。整条删掉等于丢覆盖率，Tester 会按 ≥80% 补回来。
3. **为什么这是真问题**：`locales/en.ts` 是唯一的翻译 source of truth，术语会因产品口径随时改写（Redis 工作台裁定 8-4 就是把 `No expiry` / `Wrap` / `Size: N B` / `Discard` 四处对齐参考图）。i18n **完整性**在开发期从来不是门禁（pre-commit 不跑、CI `i18n-sync-check` 带 `continue-on-error: true`、`release.yml` 不跑、运行时 `packages/ui/src/i18n.ts` 缺 key 回落 en），真正拦人的只有被钉进断言的英文字面量 —— 它把一次文案改动的成本从 1 个 locale 文件放大到 N 个测试文件，并且会诱导开发者"为了测试绿"去回退正确的产品口径。
4. **正例 / 反例对照**：

   | 反例（钉死文案） | 正例（同一意图，零文案） |
   | --- | --- |
   | `expect(screen.getByText('No expiry')).toBeTruthy()` | `expect(screen.getByTestId('redis-ttl-value').dataset.ttlState).toBe('no-expiry')` + 文本非空 |
   | `expect(screen.getByText('600 s')).toBeTruthy()` | `expect(getByTestId('redis-ttl-value').textContent).toContain('600')`（数字是数据，单位是文案） |
   | `getByRole('button', { name: 'Set TTL' })` | `getByTestId('redis-ttl-set')` |
   | `getByPlaceholderText('TTL (seconds)')` | `getByTestId('redis-ttl-input')` |
   | `expect(getAllTranslations('en')['redis.batchDelete']).toBe('Delete selected')` | `text.length > 0` + `text !== key`（词条归驱动包 `en.ts` 所有） |
   | `expect(t('redis.console')).toBe('Console')` | `expect(t('redis.console')).toBe(en['redis.console'])` + `not.toBe('redis.console')` |
   | `expect(getTranslation('en', 'query.snippets.add')).toBe('Add Snippet')` | 逐 key 断言"解析成功且不回显 key" |
   | `expect(getTranslation('en', 'panel.closeTab', { title: 'Query' })).toBe('Close Query')` | `toContain('Query')` + `not.toContain('{')` |
   | `expect(screen.getByText('just now')).toBeInTheDocument()` | `expect(screen.getByText(relativeLabel(locale, JUST_NOW))).toBeInTheDocument()` |
   | `expect(screen.getByText('Cancel')).click()` | `screen.getByTestId('confirm-dialog-cancel')` |
   | `getByRole('button', { name: 'Close' })`（宿主 `Dialog` 包装层已把 `t('common.close')` 灌进 `closeLabel`） | `getByRole('button', { name: enCopy('common.close') })` + 一条用测试自造 locale 证明"名称确实来自 `t()`"的接线用例 |
   | `getByRole('heading', { name: en['common.error'] })`（裸查表；miss 即 `name: undefined` ⇒ 永真退化） | `getByRole('heading', { name: enCopy('common.error') })`（miss / 空值当场抛错） |
   | `expect(showMessageDialog).toHaveBeenCalledWith('Missing value for :uid', 'error')`（把 `t(key, params)` 渲染出的**整句**钉进断言参数） | 断 **i18n key + params 对象**（`expect(i18nCalls).toContainEqual({ key: 'query.editor.param.missingValue', params: { token: ':uid' } })`）+ 测试自造 stub 串；token 是数据可留，句子归字典（redis-assert-policy BUG-006） |
   | `if (body.includes('Structure')) { … }`（WDIO 规格里的单语钉死，改文案当场红） | 用 `t()` 运行时回读再比较（`e2e/specs/export-import.ts` 是整套里最密的正例，含 `t('export.willExport', { rows, cols })` 插值回读）；双语或然串 `includes('中文') \|\| includes('English')` 只推迟爆炸，不消除耦合 |

5. **不在本原则范围内**（不要顺手改，改了反而丢信息）：
   - 断言**数据**：Redis 回包 `(nil)` / `OK` / `42`、SQL 原文与关键字（`SELECT`、`LEFT JOIN`、`AND`）、`INFO` 段名 `Server` / `Memory`、类型与拓扑枚举 `string` / `cluster`、日期与数字；
   - 断言**测试自己造的数据**：作为 props 传入的 `label="Refresh"`、`badge="Production"`、测试自行 `registerLocale` 的 `TestOK`、store 里的 `title: 'Daily'`；
   - **直连** `@datazen/ui` 组件、且**不传**覆盖参数时，库层那个没有 i18n 参与的默认值（`packages/ui/src/Dialog.tsx` 的 `closeLabel = 'Close'`）—— 豁免的前提确实是"该文案不由任何 `t()` 渲染"；
   - ⚠ **同名组件不可按库层默认值豁免**：宿主 `src/components/ui/*` 包装层普遍注入 `t()`（`src/components/ui/Dialog.tsx:8` 就是 `closeLabel={props.closeLabel ?? t('common.close')}`），经它渲染出的可访问名称**确实是 i18n 文案**，落在本原则范围内。本轨第一版把 `Dialog.test.tsx` 的 `getByRole('button', { name: 'Close' })` 定性成"库层默认值、无 i18n 参与"是**误判**：实测只改宿主 `common.close` 一个 key 就能让该文件恰好 2 条转红（redis-assert-policy BUG-001，已按字典回读 + `enCopy()` 改写）。判定办法：先确认测试 `import` 的是包装层还是库组件，再改一个 key 做单点探针，不要靠"值恰好同串"归因。
   - 测试自带的 `t()` stub 字典（它只是让 `t()` 有返回值）—— 前提是没有任何断言去读它的值。
6. **边界不变量 ≠ 文案**：例如"宿主快照里不得出现 `redis.*` 词条"（`getHostTranslations('en')['redis.batchDelete'] === undefined`）是包边界契约，必须原样保留；驱动 ui 测试"必须能解析出真串而不是回显 key"同理。
7. **执行方式：靠评审口径，不建静态护栏。** 本轨曾实现过一个 `scripts/check-i18n-copy-assertions.mjs` 字面量扫描器（含 `--dirs` / `--terms` 两个 opt-in 与 687 行自测），2026-09-22 由协调者裁定**整体删除**：判据是"首字母大写 + 含空格 + 恰等于字典值"的启发式对**单词文案**（`Console` / `Wrap` / `Size` / `Persist`）与**插值组合**（`'Size: 42 B'`）结构性失明，`e2e/specs/**` 主流的双语或然写法（`includes('中文') || includes('English')`）改文案也不会红，而 R-3 数据型假阳性与测试自造 stub 字典值（第 4 类豁免）又必须逐条人读——**维护成本高于它提供的保护**。规则由 Coder/Tester 简报的验收口径与本节正反例执行，新增测试出现下列形态时按人工评审拦下：`get|query|find[All]By{Text,LabelText,Title,PlaceholderText}('…')`、`getByRole(…, { name: '…' })`、`toHaveTextContent('…')`、`aria-label="…"` 选择器、带翻译语境的 `.toBe('…')` 字典回读、**断言参数** `toHaveBeenCalledWith('…')`（redis-assert-policy BUG-006）、**子串匹配** `.toContain/.toContainEqual/.includes/.startsWith/.endsWith('…')`、**文案型 helper 传参**（`findAndClickButton([...])` / `openDbContextMenu(_, '…')`）、以及**变量间接**（`const label = 'Console'; getByRole(…, { name: label })`）。

---

## 快速自检清单（Checklist）

所有提交前端交互、编辑器与补全代码的 PR / 变更必须满足：
- [ ] **1. 状态生命周期**：是否有明确的退出机制，不会永久锁定在某个模式中？
- [ ] **2. 软硬策略**：这是该“降权后置”还是该“强行吞没”？是否过度过滤？
- [ ] **3. 中间态测试**：是否为该功能的输入全生命周期补充了连续的 Journey Test（如 `sqlTypingJourney.test.ts`）？
- [ ] **4. DOM/环境解耦**：涉及点击与选择时，是否直接绑定了 Data 属性，而非依赖脆弱的坐标计算？
- [ ] **5. 三维自查**：该修改修了什么？有没有误伤同类？下一步正常操作是否顺畅？
- [ ] **6. 零文案断言**：新增/改动的测试是否只用 `data-*` / role / i18n key（必要时字典回读）表达意图，没有任何"由 `t()` 渲染出的英文字面量"被钉进断言或定位器？改写时是否保留了原被测意图（没有靠删用例蒙混过关）？
