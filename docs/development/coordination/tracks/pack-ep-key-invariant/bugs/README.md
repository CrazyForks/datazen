# Bugs — pack-ep-key-invariant

本轮（`85594adb4` 的独立测试）**未发现需要登记的缺陷**。

Tester 依据 `docs/development/subagent/tester.md` 的判据，对 BUG-002 修复提交做了：

| 阶段 | 内容 | 结论 |
| --- | --- | --- |
| A | 逐行审查 3 个改动文件（`+573 / −8`） | 机制描述与实现一致 |
| B | 独立重跑 + 真实流水线 E2E + 6 次变异 | 四项裁定全部通过 |
| C | 改动模块覆盖率度量 + 补齐缺口用例（21 例） | 见下 |
| D | 缺陷落盘 | **本文件**（无缺陷轮次说明） |

## 为什么「无缺陷」不等于「没测」

四项裁定都是**独立复现**，没有采信台账上的任何数字：

1. **闸门是不是真闸门** —— 自跑 6 次变异（M1/M2 复现 Coder 声称的 6 红 / 2 红；M3/M4b/M4d 为 Tester 自加，9 红 / 7 红 / 1 红）。每次变异后 `git diff --quiet` 均为真。
2. **闸门是不是真在签名前** —— 真实 `resolve-pro --edition=pro` 五个场景（基线 / 副作用导入 / `export … from` / 旁路注入 / 还原），失败路径确认**无签名、无 `.dzx`**。
3. **「不变量读两份列表」的实际效果** —— 独立解析两份清单确认 11 = 11 恒等；再用变异 M4b / M4d 证明**两侧各自承重**；最后用真实流水线反事实证明两份清单分叉时**确实会红**（已还原）。
4. **§G1 规格更正** —— 逐条核对，原文保留未改写历史，失效表三行均经真实管线实测。

## 阶段 C 补的 3 个真实覆盖缺口

覆盖率报告（`npx vitest run scripts/__tests__/pack-ep.test.ts --coverage`，v8 provider）显示
**改动代码中有 3 条分支从未被执行**，而提交信息 `85594adb4` 的正文声称
「宿主表不可读 / **条目不可解析**时 fail closed」。实测：**「条目不可解析」这条从未被测过**。

Tester 已在 `scripts/__tests__/pack-ep.host-key-invariant.test.ts` 补齐（21 例，全部
`test_tester_` 前缀），并用变异验证每条都**真的会转红**：

| 变异 | 改动 | Coder 的 55 例 | Tester 的 21 例 |
| --- | --- | --- | --- |
| **M5** | `readHostGlobalTableKeys` 遇到不可解析条目时 `continue` 而非 `throw` | **仍全绿** ❌ | **2 红** ✅ |
| **M6** | 宿主表字面量缺失时 `return []` 而非 `throw` | 1 红 | 1 红 ✅ |
| **M7** | `unverifiable > 0` 不再致命 | 1 红 | **8 红** ✅ |
| **M8** | `assertHostGlobalKeysInTree` 产物缺失时 `return []` 而非 `throw` | **仍全绿** ❌ | **1 红** ✅ |

> M5 / M8 两列的「仍全绿」是本轮唯一的**新发现**，但性质是**测试覆盖缺口**而非功能缺陷：
> 闸门本身的行为完全正确（就是 `throw`），只是没有用例钉住它。Tester 已按职责补测，
> 故不登记为 BUG。

## 未登记为 BUG 的观察项（留档，供后续决策）

以下四项经核实均为**本提交之外**或**不构成缺陷**，按 Tester 规程不写 BUG 文件，仅在此留档：

1. **`scripts/` 不在 tsc program 内。** `tsconfig.json` 的 `include` 只有 `src` 与 5 个
   `packages/*`；`npx tsc --noEmit --listFilesOnly` 共 2175 个文件，**零个**在 `scripts/` 下。
   ⇒ 台账上「`tsc` 整仓 0 错」对本轨两个文件的类型检查覆盖率为 **0**，不构成任何证据。
   （Tester 另用 `npx tsc --allowJs --checkJs` 单独过了一遍 `scripts/pack-ep.mjs`，**干净**。）
   仓库既有条件，非 `85594adb4` 引入。
2. **本 worktree 整仓 `tsc` 有 7 个错**，全部落在
   `src/stores/__tests__/panelStore.panes.test.ts` 与
   `src/windows/connection/__tests__/QueryPanel.paneRouting.test.tsx`（基座 Track C 引入），
   与本轨改动零重叠。
3. **`resolve-pro.mjs` 的「已暂存」短路不清理上次成功的已签名树。** 失败的构建之后，
   再跑 `resolve-pro --edition=pro` 会沿用**旧产物与旧签名**并 exit 0。
   这是 `resolve-pro` 的既有行为，`resolve-pro.mjs` 不在 `85594adb4` 的改动面内；
   CI 仍会因非零退出而中止，所以是**本地开发期**的隐患。**需协调者与其它轨确认后再决定是否单独立项。**
4. **产物字节里若在注释或字符串字面量中出现 `__DATAZEN_HOST__` 字样**，会被计入
   `unverifiable` 而导致构建失败。属 fail-closed 的保守行为（宁可误杀不放行），
   不是缺陷，但会给后来者一个困惑的报错，建议在 §G1 补一句说明。

## 建议 Coder 自行对齐的两处措辞（非缺陷）

1. `progress.md` §4.1 表格写「只认宿主表 …… 宿主表里存在**不等于**该被允许」，
   但实现是**并集**准入（`!allowList.has(key) && !host.has(key)` ⇒ 只要宿主表发布了就放行）。
   以运行期正确性论并集是安全的那一侧，**不是缺陷**，只是论证措辞与准入语义有落差。
2. 测试文件 `pack-ep.test.ts` 内的 `parseHostGlobalTableKeys` 是生产
   `readHostGlobalTableKeys` 的副本，G1 漂移守卫用的是**副本**。
   建议后续直接调用生产解析器，避免两份实现漂移。
   （已被 `真实宿主表读出 11 键` 一例单独钉住生产解析器，故不是真实盲区。）

## 结论

- **状态**：`TEST_DONE`（无缺陷轮次）
- **绝未**写入 `PASSED`
- 覆盖率：改动模块 `88.96% stmts / 81.90% branch / 97.77% funcs / 91.72% lines`，
  ≥80% 达标；**BUG-002 新增的全部生产代码（第 310–500 行）语句覆盖 100%**
