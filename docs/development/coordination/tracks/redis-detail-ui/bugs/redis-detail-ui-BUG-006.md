# redis-detail-ui-BUG-006 · 大 value 只读原因文案在「超哨兵但载荷完整」分支上说的是假事实

- **严重度**：低（不阻断行为：只读本身是 PRD §3.3 要求的正确结果；向用户陈述的原因在该分支为假，且 8-4 的口径正是"文案要能承载语义"）
- **状态**：`修复中`
- **发现**：W3-E 第 1 轮 Tester 复验（jsdom 实测）
- **涉及文件**：
  - `packages/drivers/redis/locales/en.ts:490`（`redis.detail.readonly.bigValue` = "Large value: the payload is **incomplete**, so editing is read-only to stop a **truncated** write overwriting it."）
  - `packages/drivers/redis/ui/value-editors/redisBigValue.ts:57-65`（`big = truncated || overSentinel` 两分支折叠成同一个 `reason`）
  - `packages/drivers/redis/ui/value-editors/keyReadOnlyPolicy.ts:59-61`（只按 `bigValue.big` 给单一文案）

## 描述（含量级）

I-5 只读态②有两个成因，但共用一枚文案：

| 成因 | 载荷 | 文案是否成立 |
| ---- | ---- | ------------ |
| 后端截断（`frame.truncated`，>5 MiB，`rawB64 === null`） | 不完整 | ✅ 完全成立 |
| 前端哨兵（string `logicalLen > 65_536` 且 `truncated === false`） | **完整**（`rawB64` 有值，编辑框里就是全量文本） | ❌ "载荷不完整 / 截断写覆盖" 是错的 |

后端阈值是 **5 MiB**（`redis_driver_on.rs:300-301` `RAW_VALUE_MAX_BYTES`），前端哨兵是 **64 KiB** ⇒ 64 KiB ~ 5 MiB 之间是**常态区间**（任何 100 KB 的缓存串都落在这里），该区间内提示条对用户说"你的值不完整"，用户据此可能去重扫/换库排查一件没发生的事。

## 重现步骤（本机 jsdom，无需真连）

渲染 `KeyDetailEditor`，`get_key_raw` 返回 `logicalLen = 100_000`、`truncated: false`、`rawB64` 为完整 100 KB 载荷 ⇒ 观察 `redis-string-readonly-reason`。

## 实测日志

```text
[SENT] reason=big-value key=redis.detail.readonly.bigValue truncatedBadge=false rawB64Present=true
```

⇒ 只读态正确命中，徽标行也正确地没亮 `truncated` 徽标，但原因条用的仍是"载荷不完整"那枚 key（与 `truncatedBadge=false` 自相矛盾）。

## 建议修法

`keyReadOnlyPolicy.ts` 按 `bigValue.truncated` / `overSentinel` 分别给 key：新增 `redis.detail.readonly.bigValueComplete`（语义 = "值较大，编辑区不装载全量以免误写覆盖"或如实说明为何禁编辑），保留原 key 给真截断。文案改动只动 `en.ts` 的 `redis.detail.*` 命名空间（符合 §3 冲突面）。既有 `stringValueReadOnlyJourney.test.tsx:252-266` 断的是 `data-i18n-key` ⇒ 补一条 `overSentinel` 走新 key、`truncated` 走旧 key 的断言即可，不牵动译文。

## 影响范围

纯文案真实性 + 一条判定分支的语义可辨识性。`## 留待 R 回归` 第 4 条（大 value 哨兵真连）应连带复验两分支各自文案。
