# ep-hooks-settings 缺陷登记

Tester 在**测试轨道**中登记的缺陷。文件命名为 `ep-hooks-settings-BUG-nnn.md`。

**流转状态机**：`待修复` → `修复中` → `待复测` → `已修复`。

- 正文（症状 / 复现 / 证据 / 期望行为 / 修复方向）由登记该缺陷的 Tester 所有。
- 修复方**只**翻转 `- **状态**：` 这一行，并在文末追加 `## 修复记录（round-N）` 段。
- 复测方在文末追加 `## 复测记录（round-N）` 段。

---

## 第 1 轮（基线 `6d3fedf97`｜2026-07-21）

结论：**TEST_FAILED** — 3 个缺陷。完整测试报告见 `../test-report.md`。

| 编号 | 标题 | 严重度 | 状态 | 阻塞合并 |
| --- | --- | --- | --- | --- |
| [BUG-001](ep-hooks-settings-BUG-001.md) | 宿主 EP 打包白名单可被"预改写"绕过 | **高** | 待修复 | **是**（潜伏态，见文件内说明） |
| [BUG-002](ep-hooks-settings-BUG-002.md) | 编辑器挂载时多发一次 8 槽位重配事务 | 低 | 待修复 | 否 |
| [BUG-003](ep-hooks-settings-BUG-003.md) | `proCompartments.ts:171` 的 `continue` 分支不可达 | 低 | 待修复 | 否 |

**登记的修正动作**

- `packages/extension-points/src/__tests__/epHookFallback.tester.test.ts`（新增，5 测试）
- `src/components/sql-editor/__tests__/proCompartments.tester.test.ts`（新增，11 测试）
- `src/components/sql-editor/__tests__/keymapPrecedenceRealHost.tester.test.ts`（新增，10 测试）

均为**新增测试**，未修改任何业务代码。加入后 `npx tsc --noEmit` 仍为 exit 0。

**不单独立文件、仅记为已知偏差的项**

- `src/components/sql-editor/editorExtensions.ts` 824 行 > AGENTS.md "推荐不超过 800 行"。
  该文件本轨道前为 839 行，**净减 15 行**；超出的 24 行不构成"超大单文件"。
  是否再拆一层交由协调者决定。
