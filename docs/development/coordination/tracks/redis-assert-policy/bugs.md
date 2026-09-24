# Track: redis-assert-policy — Bug 清单

> 第 1 轮登记（Tester #2，HEAD `4cdc0c023`）：核心判据**两条都成立**（改文案不再牵动测试 + 测试仍对行为敏感），
> 下列 5 条均为「只测不修」登记。
> **第 1 轮修复后复测（Tester #3 全新实例，HEAD `47b9a4a9f`）：判定 **TEST_FAILED（回炉）**——
> BUG-001 / 002 / 003 / 004 四条**闭环**（逐条独立复证见 [progress.md](progress.md)「Tester 第 1 轮修复后复测记录」），
> BUG-005 **部分闭环**（开关可用，但"加面未加形态"派生新缺陷）。
> 同轮以「全量字典探针」（本仓**全部** 2470 个英文字面值一次性改写 → 4622 例宿主测试只红 **1** 例）
> 与「护栏形态反证」两种新手段，另登记 BUG-006 / 007 / 008 三条**新**缺陷（见本文件末尾）。**
> **接续复测（Tester #4，同 HEAD `47b9a4a9f`）**：前任 Tester #3 于 150 回合上限失联、其 `bugs.md` 改写与新增三条缺陷为**未提交现场**，本实例接手后**原样保留该现场**并对其每一条断言做**独立零信任复证**（本机重跑四条门禁真数字、三组反装饰变异、护栏两态与 `--dirs src,packages,e2e` 的 `scanned=561`，并逐字读取 BUG-006/007 引用的源码站点）。复证**全部与前任结论一致**，未推翻任何一条；判定维持 **TEST_FAILED（回炉）**。实跑证据见 [progress.md](progress.md)「Tester 第 1 轮修复后复测记录」。

---

## redis-assert-policy-BUG-001：`Dialog.test.tsx` 的 `Close` 归因错误——它其实由 i18n 渲染，是真·钉死词条断言，却被写进治理文档当豁免项

- **状态**: **已修复**（Tester #3 复测通过，HEAD `47b9a4a9f`；见本条末尾"T1/T2"与 progress.md 复测记录）——
  T1：只改宿主 `'common.close'` 值 ⇒ `Dialog(8) + ErrorBoundary(1)` **9 passed / 0 failed**（修复前该场景恰好 2 红）；
  T2（新增的反证）：把 `src/components/ui/Dialog.tsx:8` 的 `t('common.close')` 注入摘成字面量 `'Close'`
  ⇒ **恰好 1 红**（`× takes the close button label from i18n, not from the library default`，
  `Unable to find an accessible element with the role "button" and name "Zqx dialog close probe"`），其余 7 条仍绿
  ⇒ 那条"接线用例"确实有牙，不是装饰性绿；`it()` 7 → 8 与原则六第 5 类改写均已核实落盘。
  原建议修法 1+2+3 落地于 commit `075d2a10c` + `47b9a4a9f`（Rescuer 接管续做）
  - 修法 1：`Dialog.test.tsx` 两处 `getByRole('button', { name: 'Close' })` 与 `getAllByRole('button')[0]` 改 `enCopy('common.close')`；**另加 1 条接线用例**（`registerLocale('zz-assert-probe', …)` 注入测试自造串，证明名称确实由 `t()` 渲染而非库层默认值），该类 `it()` 数 7 → 8。
  - 修法 2：`interaction-and-testing-principles.md` 原则六第 5 类豁免改为"**直连** `UiDialog` 且不传 `closeLabel`"这一真实前提，并加"同名宿主包装层普遍注入 `t()`，不可按库层默认值豁免"警示；对照表补 1 组正反例。
  - 修法 3：`progress.md` D 段定性与 R 项 2 已改写（"非缺陷/恰好同串"结论撤销）。
  - 实跑证据：临时只改 `src/locales/en/core.ts` 的 `'common.close'` → `'Zqx Closeonly blorp'` 后 `Dialog + ErrorBoundary` **9 passed / 0 failed**（修复前该场景恰好 2 红）；`git restore` 后词典零 diff。
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

- **状态**: **已修复**（Tester #3 复测通过，HEAD `47b9a4a9f`）——
  T3：`enCopy('common.errorZZZ')` ⇒ **`Tests 1 failed (1)`** + `Error: en dictionary miss: "common.errorZZZ" …`
  （修复前同破坏为 `1 passed` 永真）；
  T4：MenuBar 模块级派生源 `enCopy('menu.fileZZZ')` ⇒ **`Test Files 1 failed (1)` / `Tests no tests`**
  （查表 miss 在 import 期即炸，响亮失败；原 M6a 的"靠 `Found multiple elements` 偶然兜住"已不再是拦截来源）；
  T5（同类残留排查）：驱动侧 `en['redis.batchDeleteZZZ']` 与 `t('redis.batchDeleteZZZ')` **双向** typo 各 ⇒ `1 failed`
  （`expected 'Delete selected' to be undefined` / `expected 'redis.batchDeleteZZZ' to be 'Delete selected'`），
  因 `t()` 未注册即回显 key，故 `packages/drivers/*/ui/__tests__/localePackRegistration.test.ts` 里保留的裸 `en[...]`
  **不会**退化成永真，本条不追加"同类漏网"；宿主三文件已无任何裸 `en[...]` 定位（Grep 全仓确认）。
  原修法落地于 commit `075d2a10c`；按建议修法新增查表即断言取值器 `src/test/enCopy.ts` 的 `enCopy(key)`（miss / 空白值直接抛错，仍零英文字面值），并把 **三个宿主测试文件的全部裸 `en[...]` 定位**换过去：`ErrorBoundary.test.tsx`（3 条）、`MenuBar.test.tsx`（`APP_NAME`/`FILE`/`IMPORT_CONNECTIONS` 三个派生源）、`Dialog.test.tsx`（3 条，随 BUG-001 一并改）。原"三份词条非空"前置守卫已由 `enCopy` 承担（不再另设硬编码 key 列表，消除守卫与定位不共享 key 的漏洞）。口径同步写进原则六第 3 类。
  - 实跑证据（M6b 反证）：`enCopy('common.errorZZZ')` ⇒ `Error: en dictionary miss: "common.errorZZZ" …` + `Tests 1 failed (1)`（原为 `1 passed` 永真）；`enCopy('common.closeZZZ')` ⇒ Dialog `3 failed`。两次变异后 `git restore`，`git status -- src/components` 空。
  - 建议修法里的"可选加固"（`tsconfig` 给 `src/locales/en` 导 `as const` + `keyof` 收窄）属 i18n-core 面，**本轨未做**，仍留给协调者裁定。
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

- **状态**: **已撤销**（2026-09-22 裁定撤护栏，本条载体随删除而失效）｜历史：**已修复**（Tester #3 复测通过，HEAD `47b9a4a9f`；D 表第 5 行已改写为"4 条命中，全部为 R-3 已定性假阳性，真钉死词条 0 条"，矛盾消除）
  - **但同一行的文件数在 HEAD 已失真**：D 段照抄的 `457` 实跑为 **`561`**（本 commit 后 `TEST_FILE_RE` 放宽了 `specs/` ⇒ 面变大），
    且"真钉死词条 0 条"这句在全量字典探针下被证伪（至少 1 条真耦合，见 **BUG-006**）。二者另立新条，见 **BUG-008**。
  - **Round-2 更新（HEAD `d6fac564c`）**：BUG-006 已修 ⇒ 全量字典探针（15 文件 / 2483 条改值）重跑为 Host **4623/4623 全绿** +
    驱动 **233/233 全绿**，"真钉死词条 0 条"这句**重新成立**（且现在可复算，不再是推断）；
    `457` 与 `561` 经口径对账确认**都是各自 HEAD 下的正确实跑**，当前口径为 **587**（见 BUG-008 第 1 点的三行对账表）。
  - 复现口径核对：`node -e "…checkI18nCopyAssertions({dirs:['src','packages','e2e'],…})"` → `scanned=561 hits=4 code=0`；
    四条命中位置与本条登记时**逐字相同**（`BuildStatement.test.tsx:198,220` / `ChartWidgetTile.test.tsx:139` / `RunHistoryDrawer.test.tsx:161`），
    四条所在文件仍不在 `git diff ae65ae375..HEAD` 的 20 文件名单内（未被"顺手修掉"，符合任务书 §5.5）。
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

- **状态**: **已撤销**（2026-09-22 裁定撤护栏，本条载体随删除而失效）｜历史：**已修复**（Tester #3 复测通过，HEAD `47b9a4a9f`；采建议修法 (a)）
  - Grep 确认 `KEY_SHAPE_RE` 与那条不可达 `continue` 已从 `scripts/check-i18n-copy-assertions.mjs` 全文消失（0 处引用），
    第 221-225 行注释亦改为诚实口径（真正排除类 key 串的是 `COPY_SHAPE_RE` 的首字母大写要求 + 空格门槛，key 形态本身不可能匹配）。
  - 覆盖率独立复跑：`npx vitest run scripts/__tests__/check-i18n-copy-assertions.test.ts --coverage --coverage.include='scripts/check-i18n-copy-assertions.mjs'`
    ⇒ **19 passed**，`Uncovered Line` 列为空（默认 reporter 显示 `All files 100%` 四列）。
  - 该用例 `'does not treat an untranslated i18n key as copy'` **未删除**，作为"门槛若被放宽，key 形态仍不得算文案"的回归守卫保留；
    原重跑证据保留：
  - 实跑覆盖率：`npx vitest run scripts/__tests__/check-i18n-copy-assertions.test.ts --coverage --coverage.include='scripts/check-i18n-copy-assertions.mjs'` → Stmts / Branch / Funcs / Lines **全部 100%**，`Uncovered` 行为空（修复前 Branch 98.07% = 38/39、唯一未覆盖即该死分支）；该文件用例 15 → **19 passed**。
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

- **状态**: **已撤销**（2026-09-22 裁定撤护栏，本条载体随删除而失效）｜历史：**部分闭环**（Tester #3 复测，HEAD `47b9a4a9f`）——**开关本身可用（判据 1 通过）**，
  但"加宽的面"没带上"加宽的形态"，`--dirs e2e` 对 WebdriverIO 实际钉文案写法 **0 命中** ⇒ 本条 D 段第 2 点
  原结论"e2e 现状干净"**不成立**，真实结论见 **BUG-007**；`--terms` 另有两处未写进能力边界的形态盲区，见 **BUG-008**。

  T8（`--terms` 独立复证，用**临时新建探针文件**跑完即 `rm`，词典零 diff）：
  - 驱动侧（单词文案，修复前 0 命中的那一类）：临时 `packages/drivers/redis/ui/__tests__/zzGuardProbe.test.ts`
    写 `screen.getByRole('tab', { name: 'Console' })` ⇒ `--terms redis.console --strict`
    → `1 copy-literal assertion(s) pinned` + `exit=1`；**同一探针文件存在时不带 `--terms` 仍**
    `ok (34 driver test files scanned, 0 copy literals pinned)` / `exit=0` ⇒ 开关确实穿透了双词门槛，而不是靠面变宽。
  - 宿主侧 + e2e 侧：同法各注入一条（`src/components/__tests__/zzGuardProbe.test.ts` 的
    `getByRole('button', { name: 'Persist' })` 与 `e2e/specs/zzGuardProbe.ts` 的 `$('button[aria-label="Persist"]')`）
    ⇒ `--dirs src,packages,e2e --terms redis.console,redis.persist --strict` 把**三处探针全部报出**（均带 `(watchlist: …)` 标注）。
  - 读回式不误报：`` aria-label="${t('common.close')}" `` 在 watchlist 命中路径下保持安静（单测已锁，实测亦核对）。
  - 默认口径核对（零 diff）：`node scripts/check-i18n-copy-assertions.mjs` 与加 `--strict` 均逐字
    `ok (33 driver test files scanned, 0 copy literals pinned)` / `exit=0` ⇒ "默认口径一字未改"声称属实。
  - T9（`--terms` 假阳性面，属 BUG-008）：watchlist 含 `redis.console` 时，`--dirs packages` 会命中
    `packages/ui/src/__tests__/i18n.test.tsx:151` 的 `'Console'` —— 那是**测试自造的 stub 字典值**（原则六第 4 类豁免），
    护栏无法区分"字典里的值"与"测试自己写的假字典里的值"。
  原建议修法 1+2+3 落地于 commit `075d2a10c`：按建议修法加了两条 opt-in，**默认口径一字未改**（默认仍 `SCAN_DIRS=['packages/drivers']` + 双词词典启发式，默认/`--strict` 无命中即 0）：
  1. `--terms <逗号分隔 i18n key>`：从字典回读这些 key 的**当前值**再匹配，绕开双词门槛 ⇒ 单词文案可见；观察名单以 key 表达，调用串本身零文案；解析不到的 key 显式 `warn` 并在 `--strict` 下计入非 0（"typo 的 term 保护不了任何东西"）。
  2. `--dirs <根清单>`：加宽扫描面；`TEST_FILE_RE` 增 `(^|/)specs/[^/]+\.tsx?$`，使 WebdriverIO 交互规格真正进面，并新增 `aria-label="…"` 选择器形态（读回式 `` aria-label="${t('…')}" `` 只截到 `${t(` ⇒ 不误报，已单测锁住）。
  3. 能力边界写进原则六第 7 条（新增"能力边界（绿灯不等于干净）"+"两个 opt-in 开关"两段）与本台账 R 项 3。
  - 实跑证据：`--dirs src,packages,e2e --terms redis.noExpiry,redis.view.wrap,redis.size,redis.discard --strict` → watchlist 回读行 `redis.noExpiry="No expiry", redis.view.wrap="Wrap", redis.size="Size"`、`redis.discard` 报"protects nothing"、4 条 R-3 假阳性、`exit=1`；默认 `node scripts/check-i18n-copy-assertions.mjs` 仍逐字 `ok (33 driver test files scanned, 0 copy literals pinned)` / `exit=0`。
  - **给 Tester 的更正**：本条建议的 `--terms redis.noExpiry,redis.view.wrap,redis.size,redis.discard` 里 **`redis.discard` 不是真实 key**（`packages/drivers/redis/locales/en.ts` 全文无 `discard`；8-4 的 `放弃` 现由 `redis.persist:135 = 'Persist'` 承载，宿主侧另有 `common.discard`）。护栏把这个 typo 如实报出来了 —— Wave 2 名单应写 `redis.persist`，或在真正落 `放弃` 文案时补上新 key。
- **严重度**: 低（当前无实际漏网：本 Tester 手工 grep 确认 redis ui 测试目录 0 条钉死词条；但护栏对本轮目标词的保护力低于台账给读者的印象）
- **位置**: `scripts/check-i18n-copy-assertions.mjs:39`（`SCAN_DIRS=['packages/drivers']`）、`:45`（`TEST_FILE_RE`）、`:156`（要求含空格）
- **描述（含量级）**:
  1. **单词不可见**：`literal.includes(' '` 是硬门槛 ⇒ `Console` / `Wrap` / `Size` / `Persist` / `Close` / `Discard` 这类单词文案被钉进断言时护栏**不报**。
     裁定 8-4 的四个落刀口 `永不过期`(No expiry，命中) / `自动换行`(Wrap) / `大小: N B`(Size) / `放弃`(Discard/Persist) 中 **3 个是单词**
     ⇒ 本轨宣传的"以后改文案不会牵动测试"这一能力，对 3/4 的目标词其实没有静态护栏，只有靠人工 grep（本轮已做一次，干净）。
  2. **`e2e/specs/**` 不在扫描面**：`e2e` 面实测只有 **3 个文件**通过 `TEST_FILE_RE`（`e2e/contract/__tests__/{fixtures,plan,scripts}.test.ts`，纯规划器单测）；
     WebdriverIO 真实交互规格 `e2e/specs/*.ts` 既不带 `.test.ts` 也不在 `__tests__/` 下 ⇒ **0 命中**。台账 D 段"扩扫 `src packages e2e`"给出的印象是 e2e 交互面被覆盖，实际恰好是没有交互断言的那 3 个文件。
     本轮实测 e2e 现状是**干净的**：`e2e/specs/export-import.ts:249,285` 已经用 `t('common.close')` 运行时回读，没有钉死串（属正例，无需登记缺陷，也进一步支持"无需补 E2E"的论证）。
     **【Tester #3 更正：该"干净"结论撤销】** —— 修好 `TEST_FILE_RE` 后 `e2e` 面实测从 3 个文件涨到 **106 个**，
     但护栏只认 `getByRole({name:'…'})` / `aria-label="…"` / `.toBe('…')` 三种形态，而 WDIO 规格里钉文案的真实写法是
     `.includes('English')` / `findAndClickButton(['执行记录','History'])` / `openDbContextMenu(…, 'Compare Data')` 这类
     helper 传参与子串断言 ⇒ **命中仍是 0 条，而真实钉死点实测 57 处 / 25 个文件**（判据：字面值与英文字典值逐字相等，已剔去
     `SELECT` / `INSERT` / `NOT NULL` 这类 SQL 数据串），量级与文件清单见 **BUG-007**。
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

## redis-assert-policy-BUG-006：残留 1 条"插值整串钉死"未被清点（全量字典探针在 4622 例中唯一暴露的真耦合），护栏对 `toHaveBeenCalledWith` 与插值形态全盲，台账"真钉死词条 0 条"结论被证伪

- **状态**: **已修复**（Round-2 Coder，HEAD `d6fac564c`；测试改写 = `0c3f20848`，护栏断言参数形态 = `d6fac564c`。
  自验全程见 [progress.md](progress.md)「Round-2 Coder 记录」§1）
  - **建议修法 1 落地**（同目录 `useQueryExecutionGate.test.tsx:44` 的 stub 正例改法）：
    `queryExecutionJourney.test.tsx` 以 `vi.mock('../../../hooks/useI18n')` 注入**测试自造字典**
    （`'query.editor.param.missingValue'` ⇒ `` `stub-missing-param token=${p?.token ?? ''}` ``，第 4 类豁免），
    两处断言改**断契约**：`expect(i18nCalls).toContainEqual({ key: 'query.editor.param.missingValue', params: { token: ':uid' } })`
    + 自造串 + `executeQuery`/`executeSelection` 未被调用 ⇒ token 这一**数据**仍然敏感，句子归字典。
    另加 1 条常驻用例 `'keeps the block message owned by the dictionary, so the stub above stays honest'`
    （`enCopy('query.editor.param.missingValue')` 必含 `{token}`），防止"整句被摘成字面量"回退。用例 5 → **6**（只增不减）。
  - **建议修法 2 落地**：`COPY_MATCHERS` 增第 6 条 `toHaveBeenCalledWith\(\s*(['"])([^'"]+)\1`，并**额外**把 `--terms`
    的比对从"逐字相等"升级为"逐字相等 ∪ 有界短语包含（含 `{占位符}` 词条取静态片段）"——否则加了匹配器仍钉不住插值串
    （本条原判断"含占位符的词条值连逐字相等这条路也走不通"由此收口）。常驻反证：`needles` 变异（摘掉短语）⇒ 恰 2 条红。
  - **建议修法 3 落地**：D 表第 5 行与 R 项 3 改写；原则六第 7 条"形态清单"补齐并新增对照表 2 组（含本条的断言参数正反例）。
  - **实跑证据**（本机，探针跑完即还原，收尾 `git status -- src/locales packages/drivers` **空**）：
    1. 单键探针 `query.editor.param.missingValue` → `'Zqx query-editor-param-missingvalue blorp {token}'`
       ⇒ `queryExecutionJourney.test.tsx` **6 passed / 0 failed**（修复前正是这一句让全宿主套件唯一转红）。
    2. **全量字典探针**（前任判据 5 的最强形态，本机重跑）：脚本 `/tmp/r2-fullprobe.mjs` 一次改写
       **15 个字典文件 / 2483 条英文字面值**（`Zqx <key-slug> blorp`，`{占位符}` 原样保留）⇒
       Host `npx vitest run` **444 文件 / 4623 例 / 0 failed**、驱动 `redis/ui + mongodb/ui` **29 文件 / 233 例 / 0 failed**；
       `git restore -- src/locales packages/drivers` 后词典零 diff。
       ⇒ 判据 1 从"4621/4622"提升为 **4623/4623 + 233/233**，"真钉死词条 0 条"这句在 HEAD 成立（无需再改结论）。
  - **红线核对**：本条修复**纯测试**——`git diff --name-only ae65ae375..HEAD` 中
    `src/locales/en/query.ts` 与 `src/windows/connection/query/useQueryExecutionGate.tsx` **均无 diff**
    （前任 Coder 现场里这两文件的改动是探针残留，已如实回滚，未留下半成品；生产码零改动）。
- **严重度**: 中（本轨判据 1"改文案不牵动测试"在宿主面**仍有 1 处不成立**；且它同时是本轨两条结论——
  「`src` 扩扫真钉死词条 0 条」与「护栏已能守住的形态清单」——的反例，属于"缺口 + 守卫盲区"叠加，不是纯台账问题）
- **位置**:
  - 钉死处：`src/windows/connection/__tests__/queryExecutionJourney.test.tsx:204`、`:216`
    （`expect(showMessageDialog).toHaveBeenCalledWith('Missing value for :uid', 'error')` / `('Missing value for :st', 'error')`）
  - 被钉的生产来源：`src/windows/connection/query/useQueryExecutionGate.tsx:175`、`:397`
    （`t('query.editor.param.missingValue', { token: … })`）
  - 词条本体：`src/locales/en/query.ts:153` `'query.editor.param.missingValue': 'Missing value for {token}'`
  - 同目录已有正例（修法模板）：`src/windows/connection/__tests__/useQueryExecutionGate.test.tsx:44`
    用**测试自造 stub 字典** `'query.editor.param.missingValue': \`Missing param: ${params?.token ?? ''}\``，
    再在 `:318` 断言自己那句 `Missing param: :id` ⇒ 与真字典彻底脱钩
  - 护栏盲区代码：`scripts/check-i18n-copy-assertions.mjs:72-98`（`COPY_MATCHERS` 五条：`getBy*Text/Label/Title/Placeholder`、
    `getByRole({name})`、`toHaveTextContent`、`aria-label="…"`、带翻译语境的 `.toBe('…')`；**无 `toHaveBeenCalledWith`**，
    且 `COPY_SHAPE_RE`（`:70`）的允许字符集不含 `{}` ⇒ 含占位符的词条值连"逐字相等"这条路也走不通）
- **描述（含量级）**:

  **量级：宿主面 1 条测试用例 / 2 个断言点**（`:204`、`:216` 同属 `Journey 2 > blocks execution when unassigned, guides remediation, and passes when complete`
  一条 `it()`，vitest 只报第一个失败点，故探针总数是 1 红而非 2 红）。**驱动面 0 条**（见下方探针仅及 `src/locales` + redis/mongo 两包）。

  这不是"没扫到"，而是**两层扫描口径都不覆盖这种形态**：

  1. **静态护栏全盲**（T10 实证）：临时新建 `src/windows/connection/__tests__/zzGuardProbe.test.tsx`，
     故意把三句都写成 `expect(spy).toHaveBeenCalledWith(…)`，其中两句的字面值 **逐字等于真字典值** 并已放进观察名单：
     ```ts
     expect(showMessageDialog).toHaveBeenCalledWith('Missing value for :uid', 'error'); // 插值整串
     expect(showMessageDialog).toHaveBeenCalledWith('Delete selected', 'error');        // = redis.batchDelete
     expect(showMessageDialog).toHaveBeenCalledWith('No expiry', 'error');              // = redis.noExpiry
     ```
     ⇒ `node scripts/check-i18n-copy-assertions.mjs --dirs src --terms redis.batchDelete,redis.noExpiry --strict`
     只报出**已知的 4 条 R-3 假阳性**，探针三句 **0 命中**（`exit=1` 完全来自那 4 条既有命中）。
     即：`toHaveBeenCalledWith` 家族（jest/vitest 里断"组件把文案交给谁"的主流写法）根本不在 `COPY_MATCHERS` 里；
     而插值整串 `'Missing value for :uid'` 更甚——它**不是任何字典值**，`dictionaryValues.has(literal)` 与
     `--terms` 回读比对都结构性不可能命中，只有"改字典跑测试"能发现。
  2. **台账结论被证伪**：`progress.md` D 表第 5 行现写"…4 条命中，全部为 R-3 已定性假阳性，**真钉死词条 0 条**"。
     本轮**全量字典探针**（判据 5 的最强形态）给出反例 ⇒ 正确表述是"真钉死词条 **1** 条（插值整串形态，静态护栏不可见）"。
     D 段与 R 项 3 若不改，Wave 2 一旦有人改名 `query.editor.param.missingValue` 就会撞到一条"台账说不存在"的红。

  **为什么它是判据 1 的真违例而不是豁免**：该断言钉的是 `t()` **渲染结果**（生产码经 `useQueryExecutionGate` 调 `t()` 得到整串后传给
  `showMessageDialog`），不是数据、不是 `data-*`、也不是测试自造串 ⇒ 原则六三类锚点一个都不占，第 4 类（测试自造 stub 字典）恰恰是
  同目录 `useQueryExecutionGate.test.tsx:44` 已经采用的正确写法。同一 hook 的两个调用点（`:175`/`:397`）都只被这一条 journey 用例钉住。

- **重现步骤**（Tester 实测已执行并还原；探针脚本在仓库外 `/tmp`，`git status` 已回到仅文档改动）:

  ```bash
  # A. 全量字典探针：一次性改写**全部**英文字典值（17 个文件 / 2470 条，保留 {占位符}）
  node /tmp/zen-i18n-fullprobe.mjs "$PWD"        # → { files: 17, changed: 2470 }
  npx vitest run                                  # 全宿主套件
  # ←  Test Files  1 failed | 443 passed (444)
  # ←       Tests  1 failed | 4621 passed (4622)
  # ←  FAIL src/windows/connection/__tests__/queryExecutionJourney.test.tsx > … > blocks execution when unassigned, …
  #    AssertionError: expected "vi.fn()" to be called with arguments: [ 'Missing value for :uid', 'error' ]
  #    -   "Missing value for :uid"
  #    +   "Zqx query-editor-param-missingvalue blorp :uid"
  #    ❯ src/windows/connection/__tests__/queryExecutionJourney.test.tsx:204:33
  git restore -- src/locales packages/drivers     # 词典零 diff（红线）

  # B. 护栏形态盲区（同 BUG-005 T8 的临时探针文件法）
  node scripts/check-i18n-copy-assertions.mjs --dirs src --terms redis.batchDelete,redis.noExpiry --strict
  # ← 4 条命中全为既有 R-3 假阳性；探针三句 0 命中
  ```

  **判据 1 在探针下的量化结论（值得写进台账）**：改写 **2470** 条英文文案，4622 例宿主测试里只红 **1** 例
  ⇒ 本轨"改文案不牵动测试"的达成度是 **4621/4622**，比"扫出来的命中数"更硬；但也正因为只剩这 1 条，
  它不该被"真钉死词条 0 条"这句话抹平。

- **根因推断**: 本轨清点口径以"定位器里的英文字面值"为主（`getBy*` / `name:` / `aria-label`），
  即"选择器钉文案"；而 `toHaveBeenCalledWith(<整串>)` 是"断言参数钉文案"，属另一族，既没进 `COPY_MATCHERS`，
  也没进 D 段的人工 grep 关键词表 ⇒ 双向漏网。它偏偏又是 mock 型 hook 测试最自然的写法。
- **建议修法**（任一项都不改生产码）:
  1. 按同目录正例改 `queryExecutionJourney.test.tsx`：在该文件的 i18n mock 里为
      `query.editor.param.missingValue` 注册**测试自造串**（如 `` `Missing param: ${p?.token ?? ''}` ``），
      两处断言改成自造串 ⇒ 与真字典彻底脱钩（原则六第 4 类豁免），保留 `:uid` / `:st` 两个 token 的**行为**敏感；
      或改断第二参 `'error'` + `expect.stringContaining(':uid')`（token 是数据，整串不是）。
  2. 给 `COPY_MATCHERS` 增一条 `toHaveBeenCalledWith\(\s*(['"])([^'"]+)\1`，并**同步放宽 `COPY_SHAPE_RE` 以允许 `{}` 占位符**、
      或改走"剥占位符后与字典值比对"（否则加了匹配器也钉不住插值串）；
      该形态误报风险低（`toHaveBeenCalledWith` 的首参是文案而非数据的场景，本就是本轨要抓的对象），
      但必须先重跑 `--dirs src,packages,e2e` 给出命中增量再定默认/`--strict` 归属。
  3. 台账：D 表第 5 行"真钉死词条 0 条"改为"真钉死 **1** 条（插值整串，见 BUG-006）"，
      并在原则六第 7 条能力边界补一句"静态护栏只认选择器形态，不认断言参数形态"。

---

## redis-assert-policy-BUG-007：`--dirs e2e` 只加"面"不加"形态" ⇒ WDIO 实际钉文案写法 0 命中，"e2e 现状干净"是一盏绿灯假象（若日后接入 `--strict` 发布门即为危险假信心）

- **状态**: **已撤销**（2026-09-22 裁定撤护栏，`d6fac564c` 一并撤销）｜历史：**已修复**（Round-2 Coder，HEAD `d6fac564c`；由 BUG-005 的修复**派生**，非既有修复被推翻。
  前任 Coder 于 07:16 服务中断时该条为**在途脏文件**，本轮**原样继承**其 `COPY_MATCHERS` / `TEST_FILE_RE` /
  去重 / 措辞改动（`2157f602c`，未推翻任何改法），再补其缺失的"常驻测试 + 口径 + 短语匹配"（`d6fac564c`））
  - **修法 1（纠口径，必做）已落地**：原则六第 7 条重写为"八种形态清单 + 能力边界 + 哨兵非普查 + `--dirs e2e` 绿灯含义"四段，
    并写死一条禁令：**严禁把 `--strict` 与 `--dirs e2e` / `--dirs src` 一起接线为发布门**（接线即把"须人读"的命中变成常红灯 = 用假信心替换真检查）。
    护栏**仍是 report-only**：`git diff --name-only ae65ae375..HEAD -- .github .githooks .husky scripts/ci-local.sh vitest.config.ts vitest.drivers.config.ts package.json`
    ⇒ 只有 round-1 那 2 条显式 `test:i18n-assertions*` 脚本，`pretest` / pre-commit / CI 均未接。
  - **修法 2（再加形态）已落地**：`COPY_MATCHERS` 5 → **8** 条（断言参数 / 子串 `.toContain|toContainEqual|includes|startsWith|endsWith` /
    文案型 helper 传参，helper 名以脚本内 `COPY_HELPER_NAMES = ['findAndClickButton','openDbContextMenu']` 作配置点，不膨胀正则）；
    `TEST_FILE_RE` 的 specs 分支由单层 `specs/[^/]+` 改递归 `specs/.+` ⇒ `e2e/specs/journeys/**` **26** 个文件进面（`e2e` 面 106 → **132**）。
  - **命中增量已量**（原要求"补完必须先量一次再决定报/拦"）：
    `--dirs src,packages,e2e` 报 **11** 条（修复前 4 条 = R-3；e2e 贡献 7 条，含 `'NOT NULL'` ×2 这类 SQL 数据同串 ⇒ 报而不拦的依据）；
    把钉死点用到的 **102** 个 i18n key 喂给 `--terms` 后，`--dirs e2e` 由**修复前 0 条 / exit=0** 变为 **62 条 / exit=1**（`/tmp/r2-e2e-pinscan.mjs` 产名单，本机实跑）。
  - **常驻测试**：护栏 `19 → 28` 例（+9：断言参数、子串族、helper 逐字面判定、嵌套 specs 进面、观察名单组合串/插值串、
    词边界与最短长度、同行去重、**默认面不放宽**）。三组变异精确转红：截断 `COPY_MATCHERS` ⇒ 7 红 /
    回退单层 specs ⇒ 恰 1 红 / 摘掉有界短语 ⇒ 恰 2 红（见 progress.md §3）。
  - **修法 3（收敛站点）按建议不进本轨 diff**：`e2e/specs/**` 的钉死点**一条未改**（只登记）。B 类单语钉死会否当场红，
    仍需能跑 WDIO 的一次实跑给名单；A/B 判读本轮仍为静态判读。数字对账（本条 57 vs 本轮自动重跑 143）见 **BUG-008** 第 4 点。
- **严重度**: 中（护栏是**建议性**的、且 `--dirs`/`--terms` 都需显式传参 ⇒ 今天不阻断任何东西；
  但它给读者的正是"e2e 扫过了、干净"，而真实情况是"扫了 106 个文件、0 命中、57 处真钉死"。
  台账把这条绿灯留到 Wave 2 / 发布门接线时，就会变成"有门禁而无保护"）
- **位置**:
  - `scripts/check-i18n-copy-assertions.mjs:66`（`TEST_FILE_RE` 已认 `specs/`，但第三条分支只认**单层** `specs/xxx.ts`
    ⇒ `e2e/specs/journeys/**` 26 个文件仍漏面）、`:72-98`（`COPY_MATCHERS` 只有 5 条选择器/`toBe` 形态）
  - 台账出处：`tracks/redis-assert-policy/progress.md` BUG-005 修复记录与 D 段"扩扫 `src packages e2e`"、
    `docs/development/interaction-and-testing-principles.md` 原则六第 7 条"能力边界"段（只写了"单词文案看不见"，没写"e2e 形态看不见"）
  - 典型未命中站点（全部为真实 `e2e/specs/**`，本轮逐条读过上下文）：
    - `e2e/specs/ai-ask-question.ts:281,371` `text.includes('提交回答') || text.includes('Submit Answers')` ← `chat.questions.submit`
    - `e2e/specs/connection-edge-cases.ts:122` `text.includes('测试连接') || text.includes('Test Connection')` ← `newConn.testConnection`
    - `e2e/specs/journeys/visualQueryBuilderHelpers.ts:173,184` `['放弃更改', 'Discard'].includes(...)` ← `common.discard`
    - `e2e/specs/schema-tree-completeness.ts:63,91,93,138` `body.includes('Tables')` / `'Data'` / `'Structure'` / `title.includes('Refresh')`
    - `e2e/specs/settings.ts:372,373`、`e2e/specs/hotkeys.ts:62`、`e2e/specs/data-dashboard-widget-ux.ts:127`、`e2e/specs/editor-pro-screenshots.ts:493` …
  - 唯一命中的 `aria-label="…"` 写法已经是**第 2 类锚点**（key 串，不是文案）：
    `e2e/specs/conn-ctx-menu-submenus.ts:183` `'[role="dialog"] button[aria-label="common.close"]'`
    ⇒ 新增的那条匹配器在真实代码里的命中数是 **0**，而那 0 命中里还包含一个本就该安静的正例。
- **描述（含量级）**:

  **量级：`e2e/specs/**` 共 129 个 `.ts`，护栏 `--dirs e2e` 实扫 106 个 = 103 个 `e2e/specs/*.ts` + 3 个
  `e2e/contract/__tests__/*.test.ts`；余下 **26 个 `e2e/specs/journeys/*.ts` 仍不在面内**
  （`TEST_FILE_RE` 第三条分支 `(^|/)specs\/[^/]+\.tsx?$` 只认**单层** `specs/`，嵌套一层即漏，本轮实测确认漏的正好是那 26 个 journeys）。
  进面的 103 个 spec 里，**25 个文件 / 57 个站点**的字面值与英文字典值逐字相等**（探针法见下方"重现步骤"，已剔除
  `SELECT`/`INSERT`/`NOT NULL`/`JSON` 这类 SQL 数据串，也剔掉了 `i18n-10-locales.ts:18` `en: 'English'` 这类测试自造语言表）；
  这些站点 **护栏 0 命中**（同一条 watchlist 喂给 `--terms` 后仍 `ok … 0 copy literals pinned` / `exit=0`）。
  其中 **4 处 / 3 文件**（`journeys/visualQueryBuilderHelpers.ts:173,184`、`journeys/query-row-limit-journey.ts:129`、
  `journeys/visual-query-builder-complex-journey.ts:317`）落在漏掉的 journeys 里 ⇒ 即使将来补齐形态，**面本身还得再修一次**。

  两种性质要分清：

  - **A 类（多数，约 4/5）**：双语或然断言 `x.includes('中文') || x.includes('English')`。e2e 跑中文界面时英文分支只是兜底 ⇒
    **改英文文案今天不会立刻红**，属"未来埋雷"而不是"当下回归"。这正是它该被记为**中**而非**高**的原因。
  - **B 类（少数）**：单语钉死（`e2e/specs/schema-tree-completeness.ts:93` 的 `body.includes('Structure')` 无中文分支、
    `e2e/specs/homepage-features.ts:92` / `i18n-menu.ts:64,79` 的 `expect(text).toContain('DataZen')`、
    `e2e/specs/wapps.spec.ts` / `window-operations.ts` / `ui-window-ops.ts` 的 helper 传参）。改文案**会**直接红。

  两个既有事实使本条不至于升级成"高危"：
  (1) `e2e/specs/**` 里 **75/129** 个文件已在用 `t()` 运行时回读（`e2e/specs/export-import.ts:47,53,64,99,103,152,158,159,169` 是整套里最密的正例），
  说明 WDIO 侧的正确写法在本仓是**既有惯例**，缺的是把余下 25 个文件迁过去；
  (2) `pnpm e2e` 需真机 webdriver、Tester 不得运行 ⇒ **本轮未实跑 e2e**，A/B 类之分是按 locale 与分支结构静态判读，
  未经 WDIO 执行验证。关账前须由能跑 e2e 的一次性实跑给出 B 类到底会不会红的确定名单。
- **重现步骤**（Tester 实测已执行并还原；`git status` 已回到仅文档改动）:

  ```bash
  # 1. 面确实变宽了（BUG-005 的 `TEST_FILE_RE` 修复生效）
  node scripts/check-i18n-copy-assertions.mjs --dirs e2e
  # ← ok (106 driver test files scanned, 0 copy literals pinned)   exit=0     （修复前是 3）

  # 2. 把"真实钉死点用到的全部 key"喂给观察名单，仍然 0 命中
  node /tmp/zen-e2e-pin-scan2.mjs "$PWD" e2e/specs        # 探针：字典值逐字相等扫描 → 57 sites / 25 files
  TERMS=$(node /tmp/zen-e2e-pin-scan2.mjs "$PWD" e2e/specs | grep -oE '<- [A-Za-z0-9_.]+' | sed 's/^<- //' | sort -u | paste -sd, -)
  node scripts/check-i18n-copy-assertions.mjs --dirs e2e --terms "$TERMS" --strict
  # ← watchlist: 33 keys（含 chat.questions.submit="Submit Answers"、common.discard="Discard"、newConn.testConnection="Test Connection" …）
  # ← ok (106 driver test files scanned, 0 copy literals pinned)   exit=0     （缺陷点：57 处真钉死，护栏全盲）

  # 3. 反证：同一条 33 键名单换到能认的形态上立刻有牙（证明不是 `--terms` 坏了，是形态没接）
  #    临时 e2e/specs/zzGuardProbe.ts 写 `$('button[aria-label="Persist"]')` ⇒ 立刻命中该 1 条 / exit=1；
  #    同文件里 `.includes('Delete selected')` / `findAndClickButton(['执行记录','History'])` / `openDbContextMenu(…, 'Compare Data')` 三句 0 命中
  rm e2e/specs/zzGuardProbe.ts
  ```
- **根因推断**: BUG-005 的修法把"看不见"拆成"面"和"形态"两个原因，但只修了**面**（`TEST_FILE_RE`）+ 补了**一种**形态
  （`aria-label="…"`，恰好是 WDIO 里唯一没人用的那种）。真正占满 e2e 面的形态族是
  "helper 传文案参数"与"`.includes()` / `.toContain()` 或然匹配"，两者都不是选择器字面值 ⇒ 静态正则天然不在一条路上。
- **建议修法**（不改业务码，按增量给选择）:
  1. **先纠口径**（零风险，必做）：把原则六第 7 条与 R 项 3 里"e2e 已进面"改成
      "`e2e/specs/**` 已进面，但护栏只认 5 种选择器/`toBe` 形态；WDIO 主流的 helper 传参与 `.includes()`/`.toContain()` 或然匹配**不在其列**，
      实测 57 处真钉死 0 命中 ⇒ `--dirs e2e` 的绿灯**不等于** e2e 干净"；
      并在台账明确 **`--strict` 不得与 `--dirs e2e` 一起接线为发布门**（接线只会产生假信心）。
  2. **再加形态**（需要设计，Wave 2 前）：`COPY_MATCHERS` 补两条——`expect\([^)]*\)\s*\.(?:toContain|includes)\(\s*(['"])([^'"]+)\1`
      与"已知文案型 helper 名单"（`findAndClickButton([...])` / `openDbContextMenu(_, '…')` 之类，名单本身放配置文件，避免正则无限膨胀）；
      补完必须先量一次 `--dirs e2e --strict` 的命中增量（预期 ≥57），再决定是"报而不拦"还是"分批豁免"。
  3. **再谈收敛**：A/B 类分开处理——B 类单语钉死先迁 `t()` 回读（`export-import.ts` 已有可抄的整套写法，含 `t('export.willExport', {rows, cols})` 的插值回读），
      A 类双语或然串留待英文文案真改名时按红名单逐个清；两条都不进本轨 diff（e2e 不在本轨范围内，只登记）。

---

## redis-assert-policy-BUG-008：台账数字随修复失真（`457` → 实跑 `561`）+ `--terms` 两处未写进能力边界的判读坑（测试自造 stub 字典假阳性、组合串/变量间接完全不报）

- **状态**: **已撤销**（2026-09-22 裁定撤护栏，`--terms` 与能力边界文档一并删除）｜历史：**已修复**（Round-2 Coder，HEAD `d6fac564c`；BUG-003 的"数字口径"同类问题在修复后**以新数字复发**，本轮把**口径**而不是数字本身定死）
  1. **`457` 与 `561` 都不是错数**（`/tmp/r2-face-audit.mjs` 用 `git ls-tree` 在三个 HEAD 上重算三种 `TEST_FILE_RE` 形态，可复算）：

     | `--dirs src,packages,e2e` 的 `scanned` | HEAD | 面定义（`TEST_FILE_RE` 形态） | 分解 |
     |---|---|---|---|
     | **457** | `4cdc0c023`（Tester #2 关账） | pre-BUG-005：**无** `specs/` 分支 | src 401 + packages 53 + e2e 3 |
     | **561** | `47b9a4a9f`（Tester #3/4 复测） | BUG-005：单层 `specs/[^/]+\.tsx?` | src 402 + packages 53 + e2e 106 |
     | **587** | `d6fac564c`（本轮） | BUG-007：递归 `specs/.+\.tsx?` | src 402 + packages 53 + e2e 132 |

     457 → 561 的差 = `src/test/__tests__/enCopy.test.ts` **+1** 文件（`47b9a4a9f` 新增）与 `e2e` 面 3 → 106（`075d2a10c` 加 `specs/` 分支）**+103**；
     561 → 587 的差 = `e2e/specs/journeys/**` **+26**（BUG-007 修的面）。⇒ 真正的缺陷是**台账只贴数字、没贴它的两个自变量**。
     **规则升级（已写进 progress.md 关账 checklist）**：引用实跑数字必须同行记
     ① HEAD、② `--dirs` 清单、③ `TEST_FILE_RE` 形态（或等价的"哪个 commit 起面变宽"）、④ 是否带 `--terms`。
     D 表第 5 行已按此改写为 **587（HEAD `d6fac564c`；src 402 / packages 53 / e2e 132，无 `--terms`，命中 11 条）**。
  2. **`--terms` 的 stub 字典假阳性**：已写进原则六第 7 条"`--terms` 仍是目标词哨兵，不是普查"段——命中判据不看字面值来自哪本字典，
     故**会**报测试自造假字典值（第 4 类豁免，如 `packages/ui/src/__tests__/i18n.test.tsx` 的假 `'Console'`）与"词条原样当数据"的 fixture，
     并明确"名单喂得越宽（上百键）噪声越多，命中一律人读"。本轮实测的量化：同一棵干净树上 `--dirs packages --terms redis.console` 仍 1 条（该行为不变，属判读前提而非实现缺陷）。
  3. **`--terms` 的两类不报**：**组合/插值串已收口**（有界短语 + `{占位符}` 静态片段 ⇒ `'Size: 42 B'`、`'Missing value for :uid'` 现在会报，
     常驻单测 2 条 + `needles` 变异恰 2 红为证）；**变量间接仍不报**，已作为"按行扫描"能力边界写进原则六第 7 条与脚本头注释。
  4. **顺带把"钉死点计数"的三个口径分清**（BUG-007 的 57 与本台账的 11 / 62 / 143 不是同一件事，混用即本条根因的第二次发作）：
     **143 处 / 45 文件**＝本轮自动重跑"字面值逐字等于任一英文字典值、不限形态"（同 Tester 的 57 判据，但**未**人工剔除 `'string'`/`'DDL'`/`'Host'`/`'NOT NULL'` 这类数据同串；Tester 记的 **57 / 25** 是剔除后的人工子集，二者是"自动面 vs 人工判读"之差，非互相推翻）；
     **11 条**＝护栏默认启发式（形态 ∧ 双词 ∧ 字典值）在 `--dirs src,packages,e2e` 的命中；**62 条**＝再加 102 键观察名单后 `--dirs e2e` 的命中。
  5. **输出措辞**：summary 行已改为中性的 `ok (N test files scanned, 0 copy literals pinned)`（`2157f602c`）。
     round-1 台账与 bugs.md 里引旧措辞的行**保留为历史事实不回改**（它们是当时那次实跑的逐字记录）。
- **严重度**: 低（纯台账/文档准确性与可读性；不影响运行时与测试红绿。但 BUG-003 的根因正是"不同轮次实跑数字没在关账时对齐"，
  这次是同一个坑的第二跌 ⇒ 值得顺手在关账模板里加一条"引用实跑数字必须带 HEAD"）
- **位置**:
  - 失真数字：`tracks/redis-assert-policy/progress.md` D 表第 5 行的 `457`（BUG-003 修复时**照抄**进台账并被写成本轨最终口径）
  - 未写进能力边界的判读坑：`docs/development/interaction-and-testing-principles.md` 原则六第 7 条"能力边界（绿灯不等于干净）"段
    只列了"单词文案"与"`e2e/specs/**`"两条，没有下面这两条
  - 顺带的输出措辞：`scripts/check-i18n-copy-assertions.mjs` 的 summary 行固定说 `"driver test files scanned"`，
    即便 `--dirs src,packages,e2e` 已扫到 561 个非驱动文件，措辞仍写 "driver"（本轮实测：`ok (106 driver test files scanned…)` 扫的是 e2e）
- **描述（含量级）**:
  1. **数字失真（可复算）**：HEAD `47b9a4a9f` 实跑 `--dirs src,packages,e2e` 的 `scanned` = **561**（`src` 402 + `packages` 53 + `e2e` 106），
     台账写的是 **457**。差异来自 BUG-005 修复本身（`TEST_FILE_RE` 新增 `(^|/)specs/[^/]+\.tsx?$` ⇒ `e2e` 面从 3 涨到 106），
     即**修复把数字改大了，台账没跟着改**。命中的 4 条 R-3 假阳性**逐字未变**（`BuildStatement.test.tsx:198,220`、
     `ChartWidgetTile.test.tsx:139`、`RunHistoryDrawer.test.tsx:161`）⇒ 本条只纠分母，不纠结论。
  2. **`--terms` 的假阳性面（测试自造 stub 字典）**：watchlist 命中走的是"字面值逐字相等"，护栏**不看这个字面值来自哪本字典**。
     实测：`--dirs packages --terms redis.console` 命中 `packages/ui/src/__tests__/i18n.test.tsx:151` 的 `'Console'`——
     那是该用例**自己写的假字典值**，按原则六第 4 类属豁免（本轮实测该行为 `1 copy-literal assertion(s) pinned … (warning only, not blocking)`
     / `exit=0`；一旦 `--strict` 接线成门禁，这条合法豁免就会把门撞红）
     ⇒ `--terms` 越宽，越会把合法测试当违规报，
     与 BUG-005 修复说明"绕开双词门槛 ⇒ 单词文案可见"配在一起，容易被当成"报出来的都要改"。
  3. **`--terms` 的两类不报（除 BUG-006 的 `toHaveBeenCalledWith` 之外）**：
     - **组合/前后缀串**：`getByText('Size: 42 B')`（`redis.size = 'Size'` 只是前缀）⇒ 字面值 ≠ 字典值 ⇒ 不报；
       `COPY_SHAPE_RE` 允许 `:` 与数字，所以形态像文案，但比对是逐字相等，插值/拼接一律漏过（与 BUG-006 的 `Missing value for :uid` 同根）。
     - **变量间接**：`const label = 'Console'; getByRole('tab', { name: label })` ⇒ 匹配器作用在单行字面值上，
       跨行/跨变量的字面值不进面（本轨现有实现按行扫描，`code: strict && hits.length + unresolvedTerms.length > 0` 一侧无感知）。
     这三条合起来意味着：**`--terms` 是"目标词哨兵"，不是"文案钉死普查"**。原则六第 7 条现在给的印象偏向后者。
- **重现步骤**（全部只读实跑，无需改动仓库）:

  ```bash
  node -e "import('$PWD/scripts/check-i18n-copy-assertions.mjs').then(m=>{
    for (const d of [['src'],['packages'],['e2e'],['src','packages','e2e']]) {
      const r = m.checkI18nCopyAssertions({dirs:d, log(){}, warn(){}});
      console.log(d.join('+'), '→ scanned=' + r.scanned, 'hits=' + r.hits.length, 'code=' + r.code);
    }});"
  # src → scanned=402 hits=4 code=0
  # packages → scanned=53 hits=0 code=0
  # e2e → scanned=106 hits=0 code=0
  # src+packages+e2e → scanned=561 hits=4 code=0      （台账 D 段写 457）

  # stub 字典假阳性：
  node scripts/check-i18n-copy-assertions.mjs --dirs packages --terms redis.console
  # ← packages/ui/src/__tests__/i18n.test.tsx:151: "Console" (watchlist: redis.console)   —— 该串是该用例自造假字典的值
  ```
- **根因推断**: 与 BUG-003 同一类——台账里的实跑数字是**贴**进去的，不是关账时重跑的；
  能力边界段写的是"本轮已知会瞎的两件事"，而不是"这套正则比对的判读前提"（逐字相等 / 单行字面值 / 不分真假字典）。
- **建议修法**:
  1. `progress.md` D 表第 5 行的 `457` 改为 **`561`（HEAD `47b9a4a9f` 实跑；其中 `src` 402 / `packages` 53 / `e2e` 106）**，
     并规定"台账引用实跑数字必须同记 HEAD"，关账 checklist 加一条"数字与 HEAD 同行"。
  2. 原则六第 7 条"能力边界"补三行：`--terms` **会**命中测试自造 stub 字典值（第 4 类豁免需人工判读）、
     **不报**组合/插值串（`'Size: 42 B'`、`'Missing value for :uid'`）、**不报**变量间接；
     并加一句定性"`--terms` 是目标词哨兵，不是普查"。
  3. 可选（1 行）：summary 文案里的 `driver test files scanned` 改成中性 `test files scanned`，
     避免 `--dirs` 加宽后措辞与事实不符（本轮实测该行为 `ok (106 driver test files scanned…)` 扫的其实是 e2e）。

---

## 上游发现（交协调者裁定是否独立立项，非本轨缺陷）

`packages/ui/src/Dialog.tsx:30` 的 `closeLabel = 'Close'` 是**共享基础组件里的硬编码英文字面量**，
对**直接使用 `UiDialog`** 的消费方（驱动 UI、workspace app、扩展）构成真实 i18n 缺口：这些消费方拿不到宿主的 `t()`，
其对话框关闭按钮在中文界面上会显示英文 `Close`，且无法被翻译（`@datazen/ui` 自身带 `i18n.ts`/`useI18n`，
`Dialog` 却没有接）。宿主 `src/components/ui/Dialog.tsx:8` 已经用包装层补了这个口，说明缺口是**已知但只在宿主侧修**。

建议独立小立项（1 处组件 + 1 处默认值语义）：`closeLabel` 默认改为在组件内部走 `useI18n().t('ui.dialog.close')`
（或在 `@datazen/ui` 注册一份内置兜底词条），并保留显式传参覆盖；同时按原则六补一条不钉字面值的常驻用例。
**不要**顺手塞进 Wave 2 的 redis 文案轮——会与本轨 BUG-001 的修复相互踩脚，且面不止 redis。

**Tester #3 补充：同类缺口在 `@datazen/ui` 里不止 `Dialog` 一处**（同一立项范围内，逐条实扫确认）：

- `packages/ui/src/TemporalValueInput.tsx:205` `aria-label="Open calendar"`
- `packages/ui/src/TemporalValueInput.tsx:295` `aria-label="Previous month"`
- `packages/ui/src/TemporalValueInput.tsx:305` `aria-label="Next month"`

三条都是**共享基础组件里硬编码的英文可访问名**，与 `closeLabel` 同性质（消费方拿不到宿主 `t()` ⇒ 中文界面上读屏/无障碍标签仍是英文）。
两点差异要记：(1) 它们落在**日期时间输入**上，比对话框关闭按钮更难被用户注意到，因此不会像 `Close` 那样被视觉文案轮捞出来；
(2) **当前全仓没有任何测试钉这三条串**（`grep -rn "Open calendar|Previous month|Next month" packages src e2e` 除组件自身外 0 命中，
`packages/ui/src/__tests__/primitives.test.tsx:64,88` 的 `aria-label="Font size"/"Rows"` 是消费方**自己传入的测试串**，属原则六第 2 类，不算缺陷），
⇒ 修它们**不会**触碰本轨任何测试，可独立排期，也不需要走本轨的"改写不是删除"流程。

---

## 环境性既有红

**无**。Tester #2 与 Tester #3 两轮实跑均未观察到与本轨无关的既有红。Tester #3 在 HEAD `47b9a4a9f`（工作树干净）的基线口径：
Host `npx vitest run` **444 files / 4622 passed（0 failed）**、redis 驱动 `27/222`、redis+mongodb `29/233`、
全部驱动配置 `33 files passed`、`e2e-contract 3 files passed`、`npx tsc --noEmit` **0 错**、
护栏默认与 `--strict` 均 `ok (33 driver test files scanned, 0 copy literals pinned)` / `exit=0`、
其余仓内护栏（boundaries / layers / ids / ci-docs / version）全部 `exit=0`。
（Tester #2 记的 `443/4609` 与本轮 `444/4622` 之差 = 本轨修复新增的 1 个测试文件与 13 条用例，属预期增量，非红。）

---

## 环境性既有红

**无**。本轮所有实跑（`src/locales` 19/19、redis ui 27/222、redis+mongodb 29/233、Host 443/4609、
`npx tsc --noEmit` 0 错、护栏 exit 0）在 HEAD 上全部为真全绿，未观察到与本轨无关的既有红。
