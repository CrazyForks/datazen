# Track: decouple-docs — Bug 清单

> Tester 独立复测（被复测 commit `6199d9d95`，基准 `d172476fc`）。只测不修；以下缺陷全部由 Tester 自己实测证实，出处均为本 worktree 实际文件内容。

## 汇总

| Bug ID | 严重度 | 文档位置 | 一句话 | 状态 |
| --- | --- | --- | --- | --- |
| `decouple-docs-BUG-001` | 中 | `driver-api-dependency-boundary.md` 2.1.2 过渡期例外 | 声明「除两点外不存在任何豁免」，但 sqlserver 驱动存在同类宿主 import | 待修复 |
| `decouple-docs-BUG-002` | 低 | 同上 2.4.3 配套终态第 2 条 | 用 `BUILTIN_LOCALES` 佐证 `pt-BR` 连字符，但该常量不含 `pt-BR` | 待修复 |
| `decouple-docs-BUG-003` | 低 | 同上 2.2 决策表行 1 先例列 | `src/lib/driverSettings.ts` 作为「薄再导出先例」引用，实际文件已不存在 | 待修复 |
| `decouple-docs-BUG-004` | 低 | 本 track `progress.md` Coder 自验第 6 条 / B 表 | 自报 zh/en 各 24 个标题，实测各 21 个（结构对应本身通过） | 待修复 |

---

## decouple-docs-BUG-001（中）— 过渡期例外清单漏登记 sqlserver

- **文档写**：`docs/development/driver-api-dependency-boundary.md:178-180`「**过渡期例外（截至本文件基准）**：1. `packages/drivers/redis/ui/**` 仍有部分文件经宿主相对路径 import `useI18n`…；2. `packages/drivers/redis/ui/__tests__/redisKeyWebContextMenu.test.tsx`…**除上述两点外不存在任何豁免。**」
- **代码实为**：`packages/drivers/sqlserver/ui/ConnectionFields.tsx:2` 同样从宿主相对路径 import `useI18n`：

  ```ts
  import { useI18n } from '../../../../src/hooks/useI18n';
  ```

  该文件是 git 跟踪的普通驱动 UI 源码（`git ls-files` 命中），既不在 `packages/drivers/redis/ui/**` 之下，也不是被豁免的测试夹具，因此「不存在任何豁免」为假。
- **重现命令**：

  ```bash
  grep -rn "from '\.\./.*src/" packages/drivers/*/ui/ | grep -v "^packages/drivers/redis/"
  # packages/drivers/sqlserver/ui/ConnectionFields.tsx:2:import { useI18n } from '../../../../src/hooks/useI18n';
  ```

- **交叉证据（正确事实的代码/文档出处）**：并行轨 `i18n-drivers` 自己的任务书就已把它计入换源范围——`.worktrees/datazen-i18n-drivers/docs/development/coordination/tracks/i18n-drivers/progress.md:28`：「已盘点范围（基准 d172476fc）：redis ui 31 处 + `packages/drivers/sqlserver/ui/ConnectionFields.tsx` 1 处」。实测 redis 侧 `useI18n` 宿主相对 import 命中 **31 个文件**，与并行轨盘点完全一致，故仅本契约文档少写一条。
- **影响范围**：本文件是「依赖边界的唯一规范落点」。2.7 自查清单写作「驱动 UI 无任何 `.../src/` 形态宿主 import（2.1.2 登记的过渡期例外除外）」——Reviewer 依据该基线会把 sqlserver 判为「新增违规」而阻断无关 MR；Wave 4 import 护栏若照 2.1.2 清单实现豁免白名单，则会漏配该文件（要么护栏落地即红，要么白名单与规范不一致）。
- **建议修复方向（供 Coder 参考，非 Tester 实施）**：把例外 1 的适用范围从 `packages/drivers/redis/ui/**` 扩为「`packages/drivers/*/ui/**` 现存 32 处宿主 `useI18n` 相对 import（redis 31 + sqlserver 1）」，或显式并列两处，并与 `i18n-drivers` 轨盘点口径对齐。

---

## decouple-docs-BUG-002（低）— `pt-BR` 连字符规则的佐证出处对不上

- **文档写**：`driver-api-dependency-boundary.md:286`「语言 code 字面量与宿主保持一致（`zh-CN`、`pt-BR` 带连字符，对照 `src/locales/builtinLocales.ts` 的 `BUILTIN_LOCALES`）」。
- **代码实为**：`src/locales/builtinLocales.ts:9` 为 `export const BUILTIN_LOCALES = ['en', 'zh-CN'] as const;`，`BUILTIN_LOCALE_LABELS`（同文件 :26-29）只有 `'en'` / `'zh-CN'`；**整个文件不出现 `pt-BR`**。
- **重现命令**：

  ```bash
  sed -n '9p' src/locales/builtinLocales.ts        # ['en', 'zh-CN']
  grep -n "pt-BR" src/locales/builtinLocales.ts    # no matches
  ```

- **正确事实的代码出处**：`pt-BR` 的连字符约定实由以下两处支撑——`scripts/i18n-sync-check.mjs:23`（`const LOCALE_FILES = ['de','es','fr','ja','ko','pt-BR','ru','zh-TW']`）与各包文件名 `src/locales/` / `packages/drivers/redis/locales/pt-BR.ts`、`packages/drivers/mongodb/locales/pt-BR.ts`。
- **影响范围**：结论（用连字符）本身正确，但读者按文档去 `BUILTIN_LOCALES` 核对 `pt-BR` 会找不到，属引用错配。建议把 `pt-BR` 的出处改为 `i18n-sync-check.mjs` 的 `LOCALE_FILES` / 现有语言文件名，或把括号内的举例拆成「`zh-CN`（`BUILTIN_LOCALES`）与 `pt-BR`（`LOCALE_FILES`）」。

---

## decouple-docs-BUG-003（低）— 决策表先例引用了已不存在的宿主路径

- **文档写**：`driver-api-dependency-boundary.md:188`（2.2 决策表行 1）落点为「下沉 `@datazen/driver-sdk`（**移动实现，宿主原路径改薄再导出**）」，先例列「`src/commands/driver.ts` → …；**`src/lib/driverSettings.ts` → `packages/driver-sdk/src/driverSettings.ts`**；`src/lib/nativeContextMenu.ts` → …」。
- **代码实为**：SDK 侧 `packages/driver-sdk/src/driverSettings.ts` 存在✓，但宿主侧 `src/lib/driverSettings.ts` **已不存在**（`ls` 报 No such file；`find src -iname "*driverSettings*"` 只剩无关的 `src/windows/settings/DriverSettingsSection.tsx`；全仓无任何 import 该路径），该模块是在 `92a039383 refactor(driver-sdk): sink pure/IPC modules and add capability bridges` 中整体移走的。
- **重现命令**：

  ```bash
  ls src/lib/driverSettings.ts            # No such file or directory
  find src -iname "*driverSettings*"      # 仅 src/windows/settings/DriverSettingsSection.tsx
  git log --oneline -1 -- src/lib/driverSettings.ts   # 92a039383
  ```

- **影响范围**：作为「宿主路径改薄再导出」的先例举证失效（另两个先例 `src/commands/driver.ts`、`src/lib/nativeContextMenu.ts` 实测确为薄再导出，故表格主结论仍成立）。建议把该行先例改为实际留存薄再导出的 `src/lib/cn.ts`、`src/lib/nativeContextMenu.ts`、`src/commands/driver.ts`、`src/commands/file.ts`，并注明「无宿主消费方时可直接移走、不留薄再导出（driverSettings 即此例）」。

---

## decouple-docs-BUG-004（低）— Coder 自报标题计数与实测不符

- **文档写**：`docs/development/coordination/tracks/decouple-docs/progress.md` B 表末行「标题结构：zh/en 均 **24** 个 `#` 级标题、顺序一一对应」与自验第 6 条「zh/en 标题对照：各 **24** 个标题」。
- **实测**：两份文档 `^#` 级标题各 **21** 个（层级分布完全相同：`#`×1 + `##`×13 + `###`×7），序号与顺序 1:1 对应，**验收标准 4 本身通过**，仅自报数字失真。
- **重现命令**：

  ```bash
  grep -c "^#" docs/development/independent-driver-development.zh-CN.md   # 21
  grep -c "^#" docs/development/independent-driver-development.en.md      # 21
  ```

- **影响范围**：零生产影响，但 progress.md 是 Tester/Reviewer 的核对基线，失真数字会让后续复测误判「漏了 3 个标题」。建议随本轮修正文中数字（或改为「21 个，zh/en 一一对应」）。

---

## 未被判为 Bug 但记录在案观察项

1. `driver-api-dependency-boundary.md:273`（2.4.2）称 `src/lib/localeSync.ts` 是宿主「**唯一接线点**」。严格意义上 `src/locales/index.ts:64-79` 的 `getTranslation()` 也会临时 `setLocale(locale)` → 查表 → `setLocale(previous)`（同文件注释自陈"never in React render paths"）。该函数是工具/测试用的取词适配器而非语言接线，且 Coder 在 progress.md 自验第 7 条中已如实披露，故不登记 Bug；建议在 2.4.2 补一句括注以免读者 grep 出第二个调用方时困惑。
2. Part 1（Rust 段）实测逐字未改动（`git diff` 仅改了文件顶部 H1），其「`datazen-driver-api = "0.1"`」示例与当前 crate `version = "0.0.8"` 不吻合，属历史遗留文本，不在本轨勘误范围内。
