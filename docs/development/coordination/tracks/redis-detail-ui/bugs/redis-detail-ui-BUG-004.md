# redis-detail-ui-BUG-004 · TTL pill 内联编辑器缺 Esc / 失焦 退出跃迁（E-4 验收项未达，且与同轨键头行改名不对称）

- **严重度**：中（不丢数据、不阻断门禁，但它是简报 E-4 点名的验收要素之一，也是 PRD §4 I-9 的键盘规则；同一轨的**另一个**内联编辑器（键头行改名）已经实现了 Escape 退出，TTL pill 没有 ⇒ 同一屏两个内联编辑面行为不一致）
- **状态**：`待复测（round-1 修复后）`
- **发现**：W3-E 第 1 轮 Tester 复验（HEAD `3919307ce`，jsdom 实测）
- **涉及文件**：`packages/drivers/redis/ui/value-editors/TtlControls.tsx:121-249`（展开态整体无 `onKeyDown` / `onBlur`；退出只挂了 `redis-ttl-close` 按钮 `:149-157`）
- **对照实现（正确的参照物就在本轨）**：`packages/drivers/redis/ui/value-editors/KeyHeaderRow.tsx:144-150` —— 内联改名输入框有
  `if (e.key === 'Enter') void commitRename(); if (e.key === 'Escape') { setDraftName(keyName); setRenaming(false); }`

## 描述（含量级）

简报 §1-4 的验收原文：「**pill 三态内联编辑**（永不过期 / 相对 / 绝对 EXPIREAT）状态机三要素完整（进入 / 态内 / **退出跃迁，含 Esc / 失焦 / 非法输入**）」；PRD §4 I-9 亦规定 `Esc` 清空 / 取消内联编辑。

TTL pill 的展开态**不响应 Esc、不响应失焦**：

| 要素 | 实测 |
| ---- | ---- |
| 进入 | ✅ 点折叠 pill ⇒ `data-ttl-open="true"`，且确定性从 `relative` 起步（`TtlControls.tsx:110-114`） |
| 态内 | ✅ 三枚模式互斥（`data-ttl-mode` / `data-selected`），各自 apply 走 `gateWrite` |
| 退出：关闭按钮 | ✅ `redis-ttl-close` |
| 退出：切键卸载 | ✅ 父级 `key={detail.key}` 重挂 |
| **退出：Esc** | ❌ 无任何 `onKeyDown` |
| **退出：失焦** | ❌ 无 `onBlur` |
| 退出：非法输入 | ⚠️ 部分：非法 TTL / 非法时间戳 ⇒ 渲染 `redis-ttl-error` 并保持展开（这条**可以**算有意为之，不是死锁；但展开态永远只能靠点 × 或改键来退出） |

不是单向死锁（有两条真出口），所以不构成 `AGENTS.md`「禁止只有进入无退出」的红线；缺的是简报点名的两条键盘/焦点退出与 I-9 的一致性。

## 重现步骤（本机 jsdom，无需真连）

```bash
# 探针（本轮实测，未提交）：渲染 KeyDetailEditor（ttl=300）⇒ 点开 TTL pill
#   ⇒ 对 pill 与 document.body 派发 Escape ⇒ 再对 redis-ttl-input 派发 blur
```

手工：任选一个有 TTL 的键 ⇒ 点徽标行的 TTL 胶囊（展开）⇒ 按 `Esc` ⇒ 无反应；点击输入框外部（失焦）⇒ 无反应；只能点右侧 `×`。

## 实测日志

```text
[P1 editable] wrap= false copy= false download= false
[P2 readonly-hex] wrap= true
[P3 ttl-pill after Escape] open= true closeBtn= true
[P4 ttl-pill after blur] open= true
```

⇒ `data-ttl-open` 在 Esc 与 blur 之后仍为 `true`（期望 `false`）。同一探针顺带确认：折叠 pill 展开后 close 按钮存在（`closeBtn=true`），即现状**只有**这一条 UI 出口。

## 建议修法（供原 Coder 判断，Tester 不代修）

照 `KeyHeaderRow` 的形状补齐即可，约 6 行：展开态容器 `onKeyDown` 拦 `Escape` ⇒ `setOpen(false)`；`onBlur` 用 `relatedTarget` 判定焦点离开整块再收（避免在模式按钮间跳焦点时误收）。补测请断 `data-ttl-open`，不要断文案（`ttlControlsJourney.test.tsx` 已有 Journey 9 可原位扩展）。

## 影响范围

E-4 验收项之一未达 ⇒ 本条目单列为 Bug，不连带推翻 E-4 其余交付（键头行动作组、徽标行合并、8-4 文案 key 均已实测通过，见 `progress.md` T-5）。属交互一致性 + 键盘可达性，优先级低于 BUG-001/002（数据丢失类）。

## 修复记录（round-1）

- **commit**：`a26aee76c`（`fix(redis-detail-ui): BUG-004 TTL 内联编辑补 Esc/失焦两条退出跃迁并补旅程用例`）。
- **修法**：`TtlControls.tsx` 展开态容器（原 `:121-122` 整块 div）补两条退出跃迁：① `onKeyDown` 拦 `Escape` ⇒ `setOpen(false)`（键帽从输入/模式按钮冒泡上来，参照 `KeyHeaderRow.tsx:144-150` 同形）；② `onBlur` 用 `e.currentTarget.contains(e.relatedTarget as Node | null)` 判定焦点**离开整块**才收——`relatedTarget` 仍在容器内（如模式按钮间跳焦点）不误收。两条都按关按钮（`redis-ttl-close` `disabled={busy}`）的口径在应用悬起（`busy`）时忽略，避免折叠掉在途结果。组件头注释的 exit 清单同步更新（状态机三要素补全）。
- **复验**：`ttlControlsJourney.test.tsx` 新增 3 条（Esc 退出 + 重进仍默认相对模式 / 容器内焦点不收、离容器才收 / `busy` 悬起时 Esc 不收），断 `data-ttl-open` 与 `redis-ttl-close` 存在性，不断文案。整文件 **12/12 绿**。
