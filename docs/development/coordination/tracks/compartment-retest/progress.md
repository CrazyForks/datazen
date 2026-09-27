# Track: compartment-retest · BUG-002 / BUG-003 复测

- **Phase**：TEST_DONE
- **被复测的修复**：`4c528fc0a`（`fix(sql-editor): 修 BUG-002 挂载冗余 8 槽位重配事务 / BUG-003 死分支`）
- **复测基线**：`b93b804b2`（集成分支 tip，含 `4c528fc0a`）
- **复测人**：全新 Tester（未阅读上一任 Tester 报告；不采信任何台账数字）
- **结论**：**0 产品缺陷**。BUG-002、BUG-003 均判定已修复。1 条协调流程观察（非产品缺陷）。

> 证据等级强制分档（沿用本轨判据，提交信息与台账声明**本身不是证据**）：
> **【变异】**＝删/改实现后测试转红 ｜ **【管线】**＝真实渲染/真实 CM6 事务实测 ｜ **【机制】**＝读代码推理，最弱，不与前两者同句并置。

---

## 验收 1 · 独立复现原始缺陷

Tester 自写探针 `src/components/__tests__/SqlEditorMountRepro.tester.test.tsx`（非 Coder 用例派生），
打桩 `EditorView.prototype.dispatch` 并记录每笔事务的 `effects.length` 与**发起它的 `SqlEditor.tsx` 栈帧**，
同一文件分别跑在 `4c528fc0a^` 与 `4c528fc0a`。

| 探针 | 修复前 `4c528fc0a^` | 修复后 `4c528fc0a` |
| --- | --- | --- |
| 挂载 `effects.length` 直方图 | `[8, null, null]` | `[null, null]` |
| 设置写入直方图 | `[8]` | `[8]` |
| 全新实例二次挂载直方图 | `[8, null, null]` | `[null, null]` |

- 【管线】修复前挂载确有一笔 **8 槽位**重配事务，发起点为 `SqlEditor.tsx:536`
  （即 `reconfigureProCompartments(view, proPayload)` 调用行）——BUG-002 独立复现成立。
- 【变异】把 Tester 探针跑在修复前：**3 / 3 全红**；跑在修复后：**3 / 3 全绿**。
- 【管线】二次挂载（新组件实例，`useRef` 重新从 `null` 起）修复前同样复现 8 批，
  说明该缺陷对**每个**挂载都成立，不只是首个实例。

**BUG-003 死分支独立确认**

- 【管线 · 覆盖率驱动，本判据等级最高的一档】把已删除的
  `if (id === EXTRA_COMPARTMENT_ID) continue;` **重新插回**，
  对 `proCompartments.ts` 跑 v8 覆盖率并用 `coverage-final.json` 精确定位分支计数：
  `id=7 type=if loc=184:8 counts=[0, 7]` —— **命中 0 次，未命中 7 次**。
  这不是"读代码推断不可达"，而是**真实执行中该行从未被触及**的机器证据。
- 【变异】守卫插回后 `proCompartments.test.ts` + `proCompartments.tester.test.ts` **22 例全绿**，
  即该行对可观测行为零影响。
- 【机制 · 仅作辅证，不与上面两档同句并置】分类谓词
  `compartment && compartment.get(view.state) !== undefined`（`:161`）
  与外层守卫 `extraCompartment && extraCompartment.get(view.state) !== undefined`（`:174`）**逐字相同**；
  两次读的是同一个 `view.state`（其间无任何 dispatch），故外层守卫为真时 `extra` 必已归入 `directIds`。

---

## 验收 2 · 两个核心探针

- 【管线】挂载时 `effects=8` 事务**已消失**（`[null,null]`）。
- 【管线】`theme` / `sqlCompartment` 两笔**单槽位**事务**仍在**——它们各自 `effects` 是单个 `StateEffect`
  而非数组，故对批计数贡献 0（`Array.isArray` 为假 → 记为 `null`）。
  修复前后均为 **2 笔**，发起行 `SqlEditor.tsx:578` / `:588`（修复前为 `:559` / `:569`，仅行号平移）。
  ⇒ **未过度修复**。
- 【管线】设置写入仍为 `effects=8` 且**恰好 1 次**。
- 既有验收用例 `SqlEditorProSettingsJourney.test.tsx > sends one settings write through as a single reconfiguration`
  （`expect(dispatches).toBe(1)`）**绿**（隔离复跑 `1 passed | 5 skipped`）。

---

## 验收 3 · `proCompartments.ts` 四项覆盖率

⚠️ 已复核 `vitest.config.ts:41-69` 的 `coverage.include` 确实**不含** `src/components/sql-editor/**`，
`npx vitest run` 全绿**不能**证明覆盖率。故显式跑全量：

```
npx vitest run --coverage --coverage.include='src/components/sql-editor/proCompartments.ts' \
  --coverage.thresholds.{lines,functions,branches,statements}=0 --coverage.reporter=text
```

```
File               | % Stmts | % Branch | % Funcs | % Lines
...ompartments.ts  |     100 |      100 |     100 |     100
```

**【管线】核的是 branch，不是 line。** 四项均实测 100%，且是**全量 478 文件 / 4780 用例**跑出来的
（不是只跑两个 proCompartments 文件——只跑那两个时尾部 263-296 未覆盖，是 85.71% branch）。

### 对 `'merges overflow into a mounted \`extra\` the payload never names'` 的独立裁定

**裁定：不是覆盖率填充，不登记为缺陷。** 理由分档：

- 【变异】删掉 `proCompartments.ts:182` 的 `?? []` 兜底后**该用例转红**，
  报错 `TypeError: payload[EXTRA_COMPARTMENT_ID] is not iterable`。
  它防住的是一个具体、可复现的失败模式（整批重配丢失），不是为点亮一行而存在的同义反复。
- 【管线】该断言校验的是**可观测语义**而非存在性：`extra` 已挂载但 payload 未提及它时，
  `extra` 被**整体替换**（断言 facet 由 `'mounted-base'` 变为恰好 `'ghost'`，而非并集），
  是一个会被读错的真行为决策。
- 【机制】**该 `?? []` 分支在仓内生产调用图上不可达**：`reconfigureProCompartments` 仓内唯一调用点
  是 `SqlEditor.tsx:555`，而 `proPayload`（`:409-430`）是含 `extra` 键的 8 键字面量，恒不为 `undefined`。
  该函数经 `editorExtensions.ts:126` 再导出为公开 API，其 JSDoc（`:139-151`）只以 *view* 立约、
  未要求调用方必须携带 `extra`——故兜底是导出契约的边界防御，测试是**边界契约测试**。
  与 BUG-003 那种「人为造一条生产走不到的中间态」有本质区别。

---

## 验收 4 · 变异测试

| 变异 | 结果 |
| --- | --- |
| M1：删 `SqlEditor.tsx:516` 挂载 effect 里的 `appliedPayloadRef.current = proPayload` | **3 红**（Tester 探针 ×2 + Coder `SqlEditorProMountTransaction` ×1），2 文件失败 |
| M2：`proCompartments.ts:182` 的 `?? []` 去掉兜底 | **1 红**（Coder `'merges overflow…'`），报 `is not iterable` |
| M-probe：把 BUG-003 死分支 `continue` 插回 | **0 红**（符合预期：它本就是死代码），覆盖率证明其命中 0 次 |

**两条防线均承重，无洞。** 唯一需留档的观察：M2 目前**仅由 1 条用例承重**（Coder 那条）——
上一任 Tester 的 `proCompartments.tester.test.ts` 四条 overflow 用例**每条都在 payload 里带了
`[EXTRA_COMPARTMENT_ID]`**，故无一能拦住 `?? []` 的删除。

---

## 验收 5 · 注释与代码一致性

逐条核对本次改动区域内的强断言型注释，**全部与实测行为一致**：

- 【管线】`SqlEditor.tsx:435` 「使重配 effect 跨挂载 commit 幂等」——挂载直方图 `[null,null]`，成立。
- 【管线】`SqlEditor.tsx:513-515` 「上面建好的 state 已携带该 payload，记录之使重配 effect 短路」——成立。
- 【管线】`SqlEditor.tsx:551-553` 「挂载 effect 已用同一个 `proPayload` 播种」——成立。
  （这正是修复前那句**说谎**的注释；修复后为真。）
- 【管线】`SqlEditor.tsx:543-548` 「一次 dispatch、一次事务，所有槽位同落」——写入直方图 `[8]` 单笔 8 effects，成立。
- 【管线】`proCompartments.ts:175-181` 新注释「`overflow` 不可能含 `extra`」——M-probe 覆盖率 `counts=[0,7]` 佐证。
- 【机制】交叉引用核对：`ep-hooks-settings-BUG-002`「编辑器挂载时多发一次 8 槽位重配事务」、
  `ep-hooks-settings-BUG-003`「`proCompartments.ts:171` 的 `continue` 分支不可达」——
  两个 bug 文件**确实存在且标题对得上**，注释未指向虚构编号。

---

## 门禁（本人实测）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc --noEmit` | **exit 0**（14.6s） |
| 全量单测（无 coverage） | `npx vitest run` | `477 passed \| 1 failed` / **4780 用例**，唯一失败为下述已知 flake |
| 全量单测（带 coverage） | 见验收 3 | `478 passed (478)` / **4780 全绿**，exit 0 |
| `proCompartments.ts` 覆盖率 | 见验收 3 | **100 / 100 / 100 / 100** |

**已知 flake 处置（不修、不加 `testTimeout`）**：
- `src/stores/__tests__/schemaStore.test.ts`「is multi only when capability and length > 1」
  `Error: Test timed out in 5000ms` → **隔离复跑 56 例全绿，4.09s**。判定为负载 flake，非产品缺陷。
- 本次**带 v8 coverage 的全量跑**中 `sqlSnippetsLifecycleJourney.test.tsx` **未复现**超时（全绿）。
- `DataTransferWindow.test.tsx` 本次两次全量跑**均未出现**失败。

**基线数字（本人实测，未套用 Coder 的 473/4742）**：
`npx vitest run` = **478 测试文件 / 4780 用例**；其中含 Tester 新增文件 1 个文件 3 例。
去掉 Tester 增量为 **477 文件 / 4777 用例**。与 Coder 声称的 473/4742 **对不上**（差 4 文件 / 35 用例）——
提交信息与台账声明按判据不算证据，故仅记录差异，不据此判定任何缺陷。

---

## Tester 新增测试

`src/components/__tests__/SqlEditorMountRepro.tester.test.tsx`（3 例，零业务代码改动）：

1. `mount issues no 8-slot Pro batch; one settings write issues exactly one`
   —— 挂载 0 批 / 写入恰好 1 批 8 槽位。
2. `keeps the single-slot theme / sqlCompartment dispatches (no over-fix)`
   —— 挂载仍恰有 2 笔单槽位事务且均发自 `SqlEditor.tsx`（防过度修复）。
3. `a second mount of a fresh instance is also batch-free, and writes still land`
   —— 全新实例二次挂载同样 0 批（M1 变异下转红，覆盖 per-instance `useRef` 回归面）。

---

## 留档观察（非产品缺陷，**需协调者裁决**）

1. **复测简报里的轨道号不存在**。简报要求在
   `docs/development/coordination/tracks/compartment-retest/bugs/` 下建
   `compartment-cleanup-BUG-00N.md` 并称「`compartment-cleanup-BUG-001/002/003` 已占」。
   实测：`docs/development/coordination/tracks/compartment-cleanup/` **在本 worktree 的 git 历史中从未存在**，
   `compartment-retest/` 目录为空且未被跟踪。BUG-002/003 的**真实台账在
   `tracks/ep-hooks-settings/bugs/ep-hooks-settings-BUG-002.md` 与 `-003.md`**。
   ⇒ 本次**未**按虚构编号建档；`compartment-retest/progress.md`（本文件）是本轨留档。

2. **两条 bug 台账状态行陈旧 —— ✅ 已按协调者授权代翻（round-1 收尾）**。
   `ep-hooks-settings-BUG-002.md` 与 `-003.md` 的 `- **状态**：` 原本在 `4c528fc0a` 修复落地后
   仍是 `待修复`、且无 `## 修复记录` 块。复测方初版**未越界改写他轨台账**，
   经协调者裁决授权后已：改判 `已修复（……状态由复测方代翻）` 并各追加
   `## 复测记录（round-1）`（只指向本文件，不重述证据）。两条 bug 的**修复记录块仍缺**，
   需原 Coder 按 §写面所有权自行补 `## 修复记录（round-1）`。

3. **【留档观察，不建 bug 文件】M2 兜底目前仅 1 条用例承重**。
   上一任 Tester 的 `proCompartments.tester.test.ts` 四条 overflow 用例**每条都在 payload 里带了
   `extra` 键**，故**全都拦不住** `?? []` 被删；M2 变异下只有 Coder 那条转红。
   协调者裁定：**登记为观察，不要求补测**——该分支的防御纵深来自
   「`proCompartments.ts` 四项 100%」这个显式实测，不来自用例条数；且实质加强的正确方向不是再加
   同类用例，而是让既有 overflow 用例中至少一条不带 `extra`，那属于修改他人测试意图，代价大于收益。
   **已在 `proCompartments.tester.test.ts` 的 overflow describe 块加一行注释**：
   *若将来有人重构 overflow 用例，注意勿让全部用例都携带 `extra`，否则该 `?? []` 兜底会失去覆盖。*
