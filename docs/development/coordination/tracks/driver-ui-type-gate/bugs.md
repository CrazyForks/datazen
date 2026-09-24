# driver-ui-type-gate — Bug 清单（Coder 自报，第 1 轮登记）

> 登记人：`driver-ui-type-gate-coder`（编码代理自报）· 2026-09-23
> 被测范围：`1b77ce149..b0d486347`（3 commit：`c2d1c1c25` 零行为清理 → `e507cd74c` 真 bug 修复+特征测试 → `b0d486347` 门禁 include）· 分支 `feature/driver-ui-type-gate`
> 两条均为**类型门禁暴露的真 bug**（修复必然改变行为）：按简报要求先补最小特征测试、实跑红 → 修复 → 实跑绿。
> 修复均在 `e507cd74c`；特征测试 `packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx`（新增）。
> 最终三门禁：`npx tsc --noEmit` **0 错**｜驱动 vitest **52 files / 561 tests passed**｜import boundaries **0 blocking / 4 advisory（基线既有）**。

---

## driver-ui-type-gate-BUG-001 · 刷新按钮 `variant="outline"` 不是合法 Variant ⇒ 查表得 `undefined`，整段变体样式被静默丢弃

- **严重度**：中（真 bug：类型层 TS2322，运行时不抛错、不红——按钮以**零变体类**渲染：无边框、无透明底、无 hover/disabled 视觉态；用户看到一个和周围控件不一致的「裸」按钮）
- **状态**：`已修复`（特征测试先红后绿） · 修复 commit `e507cd74c`
- **涉及文件**：
  - `packages/drivers/redis/ui/observe/SearchableInfoPanel.tsx:127`（修复前行号；现 `variant="secondary"`）
  - `packages/ui/src/Button.tsx:4`（`Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'run'`——**无 `'outline'`**；`variants[variant]` 查表）
- **描述（含量级）**：`Button` 用 `variants[variant]` 取样式串，`'outline'` 不在 `Variant` 联合类型里 ⇒
  TS2322 报错，但运行时 `variants['outline'] === undefined`，`cn()` 把 `undefined` 直接丢弃 ⇒
  按钮只剩基础类 + `size="sm"` 尺寸类 + `className="shrink-0"`，**全部变体样式（边框/底色/hover/disabled:opacity）消失**。
  整仓 96 处 sibling 工具条按钮用 `secondary`/`ghost`，`outline` 出现且仅出现于此一处——作者意图是
  shadcn 语义的 outline（描边透明底），在本设计系统中对应 **`secondary`**（`border border-edge bg-transparent …`），
  且 observe 域邻控（MonitorPanel）同样用 `secondary`。
- **重现步骤**（特征测试，已提交）：
  1. `packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx` → `renders the refresh button with a defined Button variant`；
  2. 渲染 `SearchableInfoPanel`，取 `screen.getByText('redis.monitor.refresh')` 的 `className`；
  3. 修复前实跑 **红**；`secondary` 修复后 **绿**。
- **实测日志摘录**（修复前逐字）：
  ```
  FAIL  packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx > SearchableInfoPanel > renders the refresh button with a defined Button variant
  AssertionError: expected 'inline-flex items-center justify-cent…' to contain 'border-edge'
  Received: "inline-flex items-center justify-center gap-2 font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 px-2 h-7 text-xs rounded-[9px] shrink-0"
  ```
  —— 收到的类串里**只有基础类 + 尺寸类 + shrink-0**，无任何变体类，与静态推导一致。
- **行为变化（报告必列项）**：按钮渲染从「无变体样式（裸）」→「`secondary` 描边透明底样式」。
  这是**恢复作者本意的修复**，不是行为漂移；同域控件视觉归一。
- **影响范围**：`SearchableInfoPanel` 刷新按钮一处（该组件当前无生产消费方，全仓仅自身定义 + 本测试 ⇒ 爆炸半径 0，测试先行钉住待 Wave 4 挂载）。
- **零行为标记**：❌ 改行为（真 bug 修复，测试先行）。

---

## driver-ui-type-gate-BUG-002 · `reconstructInfo` 把对象条目当二元组解构 ⇒ 每次结构化 `info_filtered` 结果都被静默吞掉、白白多打一次 `info` 兜底

- **严重度**：中（真 bug：类型层 TS2488；运行时 `TypeError: object is not iterable` 被 `fetchInfo` 的 `catch` 吞掉 ⇒ 结构化快路径**从未生效**，每次刷新固定 2 次 IPC，服务端按 section/search 过滤的结果被丢弃、退回全量 `info`）
- **状态**：`已修复`（特征测试先红后绿） · 修复 commit `e507cd74c`
- **涉及文件**：
  - `packages/drivers/redis/ui/observe/SearchableInfoPanel.tsx:224`（修复前行号；现 `for (const { key: k, value: v } of sec.entries)`）
  - 形状源：`packages/drivers/redis/ui/observe/infoParse.ts`（`InfoSection.entries: Array<{ key, value }>` —— **对象数组，不是 tuple 对**）
  - 消费对照：`packages/drivers/redis/ui/kv-bar/keyObjectInfo.ts:144-155`（同命令同形状，用 `.find(e => e.key === …)` 对象访问，正确）
- **描述（含量级）**：`for (const [k, v] of sec.entries)` 对每个**元素对象**做数组解构，对象无 `Symbol.iterator`
  ⇒ 首个有条目的 section 即抛 `TypeError`。该调用位于 `fetchInfo` 的 `try` 内（结构化结果分支），
  于是：服务端返回 `{ sections, totalEntries, matchedEntries }` → `reconstructInfo` 抛 → `catch` →
  **静默改发第二次 `info`**（无过滤、走原始文本）→ 结构化结果整个作废。
  用户可见后果：INFO 过滤面板的 search/section 过滤在结构化路径上**恒不生效于服务端结果**，
  每次点击刷新固定多一发 IPC；且异常被吞，日志无痕。
- **重现步骤**（特征测试，已提交）：
  1. `packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx` → `renders structured info_filtered result without falling back to a second info call`；
  2. mock `redisCommandInvoke`：`info_filtered` 首发返回结构化对象，兜底值为原始文本；
  3. 渲染 → 点 `redis.monitor.refresh` → 断言 `toHaveBeenCalledTimes(1)` + section/条目渲染；
  4. 修复前实跑 **红**（计数 = 2，走了 `info` 兜底）；修复后 **绿**（计数 = 1，内容由结构化结果重建）。
- **实测日志摘录**（修复前逐字节选）：
  ```
  FAIL  packages/drivers/redis/ui/__tests__/SearchableInfoPanel.test.tsx > SearchableInfoPanel > renders structured info_filtered result without falling back to a second info call
     47|     expect(mockInvoke).toHaveBeenCalledTimes(1);
       |                        ^
  ```
  （断言处失败 ⇒ 实际调用 2 次，第二次为兜底 `info`；同轮该文件 `Test Files 1 failed (1) / Tests 2 failed (2)`。）
- **行为变化（报告必列项）**：结构化路径从「必抛 → 静默兜底二次 `info`」→「一次 `info_filtered` 重建原文并渲染」。
  IPC 次数 2→1；服务端过滤结果不再被丢弃。
- **影响范围**：`SearchableInfoPanel.fetchInfo` 快路径（该组件当前无生产消费方 ⇒ 爆炸半径 0，测试先行钉住）。
- **零行为标记**：❌ 改行为（真 bug 修复，测试先行）。

---

## 核对行（N-check）

1. 两条 bug 均来自类型门禁实证（TS2322 / TS2488），非猜测；类型错误码与运行时行为一一对应（§描述）。
2. 两条均**先提交特征测试并实跑红**（逐字日志见各条），修复后同一条命令实跑绿（最终门禁 52/561 含此 2 例）。
3. 断言纪律：只用 i18n key（`redis.monitor.refresh`）、fixture 数据（`Server` / `redis_version`）与调用计数，无英文文案字面量。
4. 两处修复均在授权文件 `SearchableInfoPanel.tsx` 内，单 commit `e507cd74c`，未越界触碰其他 `observe/` 文件。
5. 零行为修复（9 处）单独在 `c2d1c1c25`，与本清单的 2 条「改行为」严格分账，见 `progress.md` §3。
