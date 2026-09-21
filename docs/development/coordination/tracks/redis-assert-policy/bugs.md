# Track: redis-assert-policy — Bug 清单

> Tester 独立复测（HEAD `4cdc0c023`，基准 `ae65ae375`；本轨 3 commit / 16 文件）一次性登记。
> 核心判据**两条都成立**：改文案不再牵动测试（8 键独立探针 ⇒ Host 443/4609 + 驱动 29/233 + `src/locales` 19/19 **全绿**），
> 且测试仍对行为敏感（变异检验 M1~M6 逐条转红，见 progress.md「Tester 复测记录」§2）。
> 下列 5 条均为「只测不修」登记，**不阻断 Wave 2 落刀口**；BUG-001/002 与本轨自设口径直接冲突，建议优先处理。

---

## redis-assert-policy-BUG-001：`Dialog.test.tsx` 的 `Close` 归因错误——它其实由 i18n 渲染，是真·钉死词条断言，却被写进治理文档当豁免项

- **状态**: 待修复
- **严重度**: 中（不阻断运行时行为；阻断本轨目的本身——`common.close` 一旦改名，测试仍会红，且文档把错误理由固化，会被后续轮次反复引用）
- **位置**:
  - 误判出处：`docs/development/interaction-and-testing-principles.md:114`（原则六第 5 条示例）、`tracks/redis-assert-policy/progress.md:97`（D 段定性）、`:118`（留待 R 项 2「低优先，非缺陷」）
  - 真正的钉死断言：`src/components/ui/__tests__/Dialog.test.tsx:98`、`:102`（`getByRole('button', { name: 'Close' })`）
  - 被漏掉的 i18n 注入点：`src/components/ui/Dialog.tsx:8`
- **描述（含量级）**:

  本轨把探针态那 2 条红定性为「`@datazen/ui` `Dialog` 的**无 i18n 参与**默认属性 `closeLabel = 'Close'`，
  只是**恰好**与宿主词条 `common.close` 同串」。该归因不成立：

  ```
  src/components/ui/Dialog.tsx:8
    return <UiDialog {...props} closeLabel={props.closeLabel ?? t('common.close')} />;
  ```

  测试第 5 行 `import { Dialog } from '../Dialog'` 导入的是**宿主包装层**，不是 `@datazen/ui`。
  宿主层已经把 `t('common.close')` 灌进 `closeLabel`，`packages/ui/src/Dialog.tsx:133` 再把它渲染成
  `aria-label={closeLabel}` ⇒ 可访问名**确实由 i18n 渲染**，与探针"恰好同串"无关。
  按本任务书 §2 范围项 2（「范围仅限由 i18n `t()` 渲染出来的文案」）与 PRD §7-6，
  这条断言**在本轨清点范围内、应当改写而未改写**，并被反向定性为豁免。

  量级：本轨范围内漏网钉死词条断言 **2 条**（宿主 `src/**/__tests__/**` 全集中目前仅此 2 条，
  因为我按 BUG-005 的实测扩扫已确认其余 4 条属数据）。同时全仓**没有任何**一处测试真正依赖
  `@datazen/ui` 那个非 i18n 默认值（`packages/ui/src/__tests__/primitives.test.tsx:115-131` 的 Dialog 用例不查 `Close`），
  即原则六第 5 条**当前无合法实例**，只有一条被误用为豁免理由的规则。

  `packages/ui/src/Dialog.tsx:30` 的 `closeLabel = 'Close'` 本身仍是共享基础组件里真实的硬编码英文字面量
  （对直接使用 `UiDialog` 的驱动 UI / wapp / 扩展而言是一处 i18n 缺口）——**这条属上游发现，见下方"上游发现"段**，
  但它是独立议题，不能作为宿主测试的豁免依据。

- **重现步骤**（Tester 实测已执行并还原，`git status` 干净；只动一个 key）:

  ```bash
  # 基线：该类 7 例全绿
  npx vitest run src/components/ui/__tests__/Dialog.test.tsx          # 7 passed

  # 只改宿主词条 common.close（不碰 @datazen/ui 的默认值）
  perl -pi -e "s/'common.close': 'Close',/'common.close': 'Zqx Closeonly blorp',/" src/locales/en/core.ts
  npx vitest run src/components/ui/__tests__/Dialog.test.tsx
  # ← × focuses the dialog on open and restores the opener on close
  # ← × wraps Tab focus within the dialog
  #   TestingLibraryElementError: Unable to find an accessible element
  #   with the role "button" and name "Close"
  #   Tests  2 failed | 5 passed (7)
  git restore src/locales/en/core.ts
  ```

  若归因（"无 i18n 参与"）为真，改宿主词典不可能让渲染出的 `aria-label` 变化 ⇒ 必为全绿。实测为 2 红 ⇒ 归因被证伪。

- **根因推断**: 只读了 `packages/ui/src/Dialog.tsx`（库层默认值），没有读宿主同名包装 `src/components/ui/Dialog.tsx`；
  两层同名 `Dialog` 是 i18n-core 拆分层留下的命名撞车，扫描器默认 `SCAN_DIRS=['packages/drivers']` 也看不见该文件（本轨 D 段已自述），
  两条"看不见"叠加成一次错误定性。

- **建议修法**（任一项都不改生产码）:
  1. `src/components/ui/__tests__/Dialog.test.tsx:98,102` 改 `getByRole('button', { name: en['common.close'] })`
     （并配合 BUG-002 的 `enCopy()` 查表守卫），或给该 Dialog 传显式 `closeLabel="…"` 测试自造串（则彻底脱离 i18n，成为原则六第 2 类豁免）；
  2. 修正 `interaction-and-testing-principles.md:114` 第 5 条：把 `Dialog` 的 `closeLabel` 例子换成"直连 `UiDialog` 且不传 `closeLabel`"这一真实前提，
     并加一句"宿主 `src/components/ui/*` 包装层普遍注入 `t()`，同名组件不可按库层默认值豁免"；
  3. 同步改写 `progress.md:97` 与 R 项 2 的定性（当前"非缺陷"不成立）。

---

## redis-assert-policy-BUG-002：`ErrorBoundary.test.tsx` 的字典回读定位器在查表 miss 时静默通过（永真退化），违反本轨"不得退化成永真匹配"口径

- **状态**: 待修复
- **严重度**: 中（"改写而非删除"最典型失败模式的现形：断言看似在，实则查表失败也绿）
- **位置**: `src/components/__tests__/ErrorBoundary.test.tsx:29-33`；同类风险 `src/components/__tests__/MenuBar.test.tsx:20-22,32,44,61`
- **描述（含量级）**:

  改写后的三条定位是 `getByRole(<role>, { name: en['common.error'|'common.close'|'common.retry'] })`。
  若字典 key 改名/丢失（`en[...]` → `undefined`），testing-library 会把 `name: undefined` 当作**未提供该约束**，
  退化为 `getByRole('heading')`：

  - `ErrorBoundary` 恰好只渲染 1 个 heading ⇒ `{ name: en['common.errorZZZ'] }` **仍全绿**（永真）；
  - 该文件里"三份词条非空"的前置守卫遍历的是**另一份硬编码 key 列表**，与被改动的定位表达式不共享 key，
    所以 typo 不会被守卫拦下；
  - 只有当同一 role 存在多个元素时（`common.close` → 2 个 button）才因 `Found multiple elements` **偶然**变红。

  ⇒ 拦截力取决于"页面上同类元素有几个"，而不是契约本身。本轨把 base 的 `{name:'Error'}`（真约束）换成 `{name: <可 undefined 的查表>}`（可空约束），
  在"文案不敏感"上达标，但在"行为仍敏感"上对该文件有净损失。变异检验 M6 实测 3 条定位里 **1 条完全脱靶**、2 条偶然兜住。

- **重现步骤**（Tester 实测已执行并还原，`git status` 干净）:

  ```bash
  perl -pi -e "s/en\['common.error'\]/en['common.errorZZZ']/" src/components/__tests__/ErrorBoundary.test.tsx
  npx vitest run src/components/__tests__/ErrorBoundary.test.tsx
  # ← ✓ src/components/__tests__/ErrorBoundary.test.tsx (1 test)   Tests 1 passed（缺陷点：应红而绿）
  perl -pi -e "s/en\['common.close'\]/en['common.closeZZZ']/" src/components/__tests__/ErrorBoundary.test.tsx
  npx vitest run src/components/__tests__/ErrorBoundary.test.tsx
  # ← × … TestingLibraryElementError: Found multiple elements with the role "button"（仅因多元素偶然兜住）
  git restore src/components/__tests__/ErrorBoundary.test.tsx
  ```

  MenuBar 侧同样实测：`en['menu.fileZZZ']` ⇒ 3 例全红，但报错全部是 `Found multiple elements with the role "menuitem"`，
  即"命中"来自歧义而非 name 契约。

- **根因推断**: 把"值"从字典取出来后直接塞进 `name:`，缺一步"取不到就炸"的收敛；`en` 的类型是宽 `Record<string,string>`（`TranslationKey` 联合没被用上），typo 编译期也不报。
- **建议修法**: 在本文件（或 `src/locales` 的测试 helper）加一个查表即断言的取值器，替换全部裸 `en[...]` 定位：

  ```ts
  function enCopy(key: TranslationKey): string {
    const value = en[key];
    expect(value, `en dictionary miss: ${key}`).toBeTruthy();
    expect(value.trim().length, `en dictionary blank: ${key}`).toBeGreaterThan(0);
    return value;
  }
  // getByRole('heading', { name: enCopy('common.error') })
  ```

  这样 key 丢失 / 值为空 / 被删词条三种破坏都直接落到断言上，且仍然零英文字面值。
  可选加固：`tsconfig` 层给 `src/locales/en` 导出 `as const` 并以 `keyof` 收窄，使 `en['menu.fileZZZ']` 编译期即报（属 i18n-core 面，交协调者裁定）。

---

## redis-assert-policy-BUG-003：台账 D 段"扩扫 457 文件 / 0 条"与 R 项 3"4 条假阳性"互相矛盾，实跑为 4 条

- **状态**: 待修复
- **严重度**: 低（纯台账准确性；但它是 Wave 2 / R 阶段的交接依据）
- **位置**: `tracks/redis-assert-policy/progress.md:96`（D 表第 5 行"…457 个测试文件 / 0 条钉死词条断言"）↔ `:119`（R 项 3：实测扩扫 `src` 后 4 条）
- **描述（含量级）**: 同一条"扩扫"结论在两处给了相反的数字。实测 `dirs = ['src','packages','e2e']`：**scanned = 457（与声称完全一致）、hits = 4、code = 0**，
  即"0 条"是错的、R 项 3 是对的；正确表述是"钉死**真词条** 0 条，另有 4 条已定性为数据的假阳性"。
  读台账的人若只看 D 段，会以为扩扫完全干净，Wave 2 之后一旦护栏报出这 4 条会被当成新回归。
- **重现步骤**:

  ```bash
  node -e "import('$PWD/scripts/check-i18n-copy-assertions.mjs').then(m => {
    const r = m.checkI18nCopyAssertions({ dirs:['src','packages','e2e'], log(){}, warn(){} });
    console.log(r.scanned, r.hits.length, r.code); r.hits.forEach(h => console.log(h.file+':'+h.line, h.literal)); });"
  # 457 4 0
  #   src/components/query-builder/BuildStatement/__tests__/BuildStatement.test.tsx:198  LEFT JOIN
  #   src/components/query-builder/BuildStatement/__tests__/BuildStatement.test.tsx:220  LEFT JOIN
  #   src/windows/dashboard/__tests__/ChartWidgetTile.test.tsx:139                        Query failed
  #   src/windows/dashboard/__tests__/RunHistoryDrawer.test.tsx:161                       Query failed
  ```

  四条所在文件**本轨未改动**（不在 `git diff ae65ae375..HEAD` 名单内）⇒ 符合任务书 §5.5"不得被顺手修掉"，本条只纠数字。
- **根因推断**: D 段与 R 段由不同轮次的实跑粘贴，未在关账时对齐。
- **建议修法**: 把 D 表第 5 行改为"457 文件 / **4 条命中，全部为 R-3 已定性假阳性**，真钉死词条 0 条"。

---

## redis-assert-policy-BUG-004：护栏 `KEY_SHAPE_RE` 短路不可达（死分支），对应单测名称夸大了它实际证明的东西

- **状态**: 待修复
- **严重度**: 低（无行为影响；属"测试名不副实"，正是本轨要消灭的类别）
- **位置**: `scripts/check-i18n-copy-assertions.mjs:156-157`；`scripts/__tests__/check-i18n-copy-assertions.test.ts:122`（`'does not treat an untranslated i18n key as copy'`）
- **描述（含量级）**: 第 156 行已 `if (!COPY_SHAPE_RE.test(literal) || !literal.includes(' ')) continue;`，
  而 `KEY_SHAPE_RE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/` 结构上**不可能**匹配含空格的串 ⇒ 第 157 行的 `continue` 永不为真。
  v8 分支覆盖实测：补满其余分支后（见 progress.md §3）**该分支仍 0 命中**，即 39 条分支里唯一不可达的一条。
  相应地，名为"不把未翻译的 i18n key 当文案"的单测实际是靠"无空格"通过的（`'redis.noExpiry'` 没有空格），
  它并没有证明 `KEY_SHAPE_RE` 在起作用——把它删掉该测试仍绿。
- **重现步骤**: `npx vitest run scripts/__tests__/check-i18n-copy-assertions.test.ts --coverage --coverage.include='scripts/check-i18n-copy-assertions.mjs'` → `Uncovered: 157`（其余分支已由本轮补齐）。
- **根因推断**: 空格启发式是后加的（或在 key 规则之后加的），叠加后旧规则失效，无人回删。
- **建议修法**: 二选一 —— (a) 删掉 `KEY_SHAPE_RE` 与该 `continue`，并把单测注释改成"key 形态本身无空格，由空格门槛先拦下"；
  (b) 若想保留"带空格的类 key 串"防御，需把第 156 行的 `|| !literal.includes(' ')` 挪到 `KEY_SHAPE_RE` 之后，并补一条含空格的类 key 断言。取舍交协调者（本 Tester 不擅改生产逻辑与既有口径方向）。

---

## redis-assert-policy-BUG-005：护栏的能力边界未写进"为什么"——单词文案与 `e2e/specs/**` 结构性看不见，而 8-4 落刀口 4 个词里 3 个是单词

- **状态**: 待修复
- **严重度**: 低（当前无实际漏网：本 Tester 手工 grep 确认 redis ui 测试目录 0 条钉死词条；但护栏对本轮目标词的保护力低于台账给读者的印象）
- **位置**: `scripts/check-i18n-copy-assertions.mjs:39`（`SCAN_DIRS=['packages/drivers']`）、`:45`（`TEST_FILE_RE`）、`:156`（要求含空格）
- **描述（含量级）**:
  1. **单词不可见**：`literal.includes(' '` 是硬门槛 ⇒ `Console` / `Wrap` / `Size` / `Persist` / `Close` / `Discard` 这类单词文案被钉进断言时护栏**不报**。
     裁定 8-4 的四个落刀口 `永不过期`(No expiry，命中) / `自动换行`(Wrap) / `大小: N B`(Size) / `放弃`(Discard/Persist) 中 **3 个是单词**
     ⇒ 本轨宣传的"以后改文案不会牵动测试"这一能力，对 3/4 的目标词其实没有静态护栏，只有靠人工 grep（本轮已做一次，干净）。
  2. **`e2e/specs/**` 不在扫描面**：`e2e` 面实测只有 **3 个文件**通过 `TEST_FILE_RE`（`e2e/contract/__tests__/{fixtures,plan,scripts}.test.ts`，纯规划器单测）；
     WebdriverIO 真实交互规格 `e2e/specs/*.ts` 既不带 `.test.ts` 也不在 `__tests__/` 下 ⇒ **0 命中**。台账 D 段"扩扫 `src packages e2e`"给出的印象是 e2e 交互面被覆盖，实际恰好是没有交互断言的那 3 个文件。
     本轮实测 e2e 现状是**干净的**：`e2e/specs/export-import.ts:249,285` 已经用 `t('common.close')` 运行时回读，没有钉死串（属正例，无需登记缺陷，也进一步支持"无需补 E2E"的论证）。
- **重现步骤**（Tester 实测已执行并还原，`git status` 干净）:

  ```bash
  # 单词文案不报：临时把一个驱动测试文件追加两行真词条定位
  #   screen.getByRole('tab', { name: 'Console' })      // redis.console 的当前值
  #   screen.getByRole('button', { name: 'Persist' })   // redis.persist 的当前值
  node scripts/check-i18n-copy-assertions.mjs --strict
  # ← [check-i18n-copy-assertions] ok (33 driver test files scanned, 0 copy literals pinned)  strict-exit=0（缺陷点：两条真词条钉死却 0 命中）
  git restore packages/drivers/redis/ui/__tests__/settingsHelpers.test.ts

  # e2e 交互面命中文件数：
  node -e "import('$PWD/scripts/check-i18n-copy-assertions.mjs').then(m=>console.log(m.checkI18nCopyAssertions({dirs:['e2e'],log(){},warn(){}}).scanned))"
  # ← 3   （全为 e2e/contract/__tests__/*.test.ts；e2e/specs/** 贡献 0）
  ```

- **根因推断**: 空格 + 词典值双重降噪是为了压 false positive（D 段已实证其必要），但没有把"代价是单词文案失明"写进原则六第 7 条与 R 项 3。
- **建议修法**（不改默认口径）: 给护栏加一条可选 `--terms <逗号分隔 i18n key>` 观察名单——从字典回读这些 key 的**当前值**再匹配（含单词），
  Wave 2 跑 `--terms redis.noExpiry,redis.view.wrap,redis.size,redis.discard` 即可精确护住本轮落刀口；同时在原则六第 7 条与 R 项 3 补一行"单词文案与 `e2e/specs/**` 不在默认扫描面，需人工 grep 或 `--terms`"。

---

## 上游发现（交协调者裁定是否独立立项，非本轨缺陷）

`packages/ui/src/Dialog.tsx:30` 的 `closeLabel = 'Close'` 是**共享基础组件里的硬编码英文字面量**，
对**直接使用 `UiDialog`** 的消费方（驱动 UI、workspace app、扩展）构成真实 i18n 缺口：这些消费方拿不到宿主的 `t()`，
其对话框关闭按钮在中文界面上会显示英文 `Close`，且无法被翻译（`@datazen/ui` 自身带 `i18n.ts`/`useI18n`，
`Dialog` 却没有接）。宿主 `src/components/ui/Dialog.tsx:8` 已经用包装层补了这个口，说明缺口是**已知但只在宿主侧修**。

建议独立小立项（1 处组件 + 1 处默认值语义）：`closeLabel` 默认改为在组件内部走 `useI18n().t('ui.dialog.close')`
（或在 `@datazen/ui` 注册一份内置兜底词条），并保留显式传参覆盖；同时按原则六补一条不钉字面值的常驻用例。
**不要**顺手塞进 Wave 2 的 redis 文案轮——会与本轨 BUG-001 的修复相互踩脚，且面不止 redis。

---

## 环境性既有红

**无**。本轮所有实跑（`src/locales` 19/19、redis ui 27/222、redis+mongodb 29/233、Host 443/4609、
`npx tsc --noEmit` 0 错、护栏 exit 0）在 HEAD 上全部为真全绿，未观察到与本轨无关的既有红。
