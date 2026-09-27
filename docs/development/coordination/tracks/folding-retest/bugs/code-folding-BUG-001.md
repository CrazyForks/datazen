# BUG-001：打包体积上限（420 kB）既没有余量，也拦不住单模块内联

- **状态**：待修复（未修复；本轨 Tester 只测不修）
- **严重度**：中
- **轨道**：folding-retest
- **发现者**：Tester（独立复测）
- **发现时基线**：Pro `local-productivity/code-folding` @ `2dfba67`；Host `feature/folding-retest` @ `f7d13d81d`
- **类别**：测试保证不足（backstop 失效）
- **是否本轨道引入**：**是**（`src/__tests__/hostModuleExternalization.test.ts` 是本轨道随 Track E 一并新增的文件）
- **业务代码改动**：**零**。本条只改测试或注释。

---

## 一、一句话描述

`hostModuleExternalization.test.ts` 里那条 420 kB 的体积闸门，其注释声称在正确构建之上留有 **~50% 余量**；
实测当前正确构建是 **391,554 B = 382 kB**，余量只有 **9.8%**，而**单独内联** `@codemirror/state`
（= `Facet` / `StateField` / `RangeSet` / `EditorState` 的定义所在模块）只会让产物涨到
**428,079 B = 418 kB，稳稳地通过这道 420 kB 闸门**。

---

## 二、实测数据（真实 `vite build`，`sourcemap: false`，读 `index.esm.js`）

全部为**真实流水线测量**：每个变体都真的跑了一次 `vite.build()`，读产物字节数，不是估算。

| 变体 | 字节 | kB | < 420 kB ? | 宿主单例仍正确 ? |
|---|---:|---:|:---:|:---:|
| **V0 真实 `vite.config.ts`（未改）** | 391,554 | 382 | ✅ | ✅ |
| V1 仅移除 `renderChunk` 改写 | 391,508 | 382 | ✅ | ❌ |
| V2 `@codemirror/language` 内联 | 465,291 | 454 | ❌ | ❌ |
| V3 `@codemirror/commands` 内联 | 391,554 | 382 | ✅ | ✅（未变化） |
| **V4 `@codemirror/lint` 内联** | **412,499** | **403** | **✅ 通过闸门** | ✅ |
| V5 `@codemirror/autocomplete` 内联 | 391,554 | 382 | ✅ | ✅（未变化） |
| **V6 `@codemirror/state` 内联** | **428,079** | **418** | **✅ 通过闸门** | ❌ |

V0 用的是仓库里**未经改写**的 `vite.config.ts` 本身（与我在探针里复刻的配置字节数完全一致，
均为 391,554 B，可互相印证复刻无偏差）。

---

## 三、为什么这构成缺陷，而不是"注释写错了而已"

测试文件第 179–184 行自己写明了这条闸门的**职责边界**：

> "One inlined CodeMirror module is worth hundreds of kilobytes, because each drags its
> transitive tree along. A ceiling at 420 kB leaves ~50% headroom over the correct build
> while sitting far below the smallest observed failure. This is a backstop for code that
> reaches a shared module **without going through the specifier scan below** — a dynamic
> import, a new bundler path — not the primary check."

**两个前提都不成立**：

1. **"leaves ~50% headroom"** —— 实测 9.8%。V2（内联单个 `@codemirror/language`）涨 73,737 B，
   已经超过 420 kB 关口，闸门确实会响 —— 但它**只**在模块恰好足够重时才会响。
2. **"far below the smallest observed failure"** —— 最小可观测失败是 V4/V6，
   分别只有 +21 kB 和 +36.5 kB，闸门对这两个**完全沉默**。

尤其 V6：`@codemirror/state` 正是定义 `Facet`、`StateField`、`RangeSet`、`EditorState`
的那个模块。它一旦被内联，就是**第二份类身份副本** —— 正是本文件开头所描述的、
"nothing throws" 的静默失效。而体积闸门对此**没有任何反应**。

---

## 四、影响边界（不夸大）

必须同时说清楚，否则就是拿机制论证冒充实测：

- 对于**走 specifier 扫描**的常规内联（源码里有字面量 `from '@codemirror/state'`），
  `resolves every shared-module import in the source to the host singleton` 那条
  **仍然会红**。所以 V4/V6 这两条变体**不是**完全漏网，只是**体积闸门漏网**。
- 本条主张的、且仅主张的是：**对该文件自述的"backstop 职责"（动态 import / 新的打包路径
  这类扫描看不到的路径），体积闸门已经失效。** 上面没有为这条路做过端到端复现。

---

## 五、与台账数字的冲突（按证据分级）

台账 `progress.md` §8 的两个数字 —— externalized 278,754 B / inlined 728,005 B ——
**与我在 `2dfba67` 上的实测不符**（391,554 B / 465,291 B）。

- 本条中"实测值"一栏：**[真实流水线测量]**
- "台账数字是 stale 还是在别处测的"：**[机制论证，最弱]** —— 我没有拿到台账当时的
  commit，无法排除它测的是更早的状态。**不断言台账造假。**

---

## 六、建议（供 Coder 参考，Tester 不实施）

1. 要么把上限提到能让**最小的**单模块内联也越线（按 V6，需要 ≥ 440 kB 才留出真正的余量），
   要么**删掉这条闸门并在注释里写明"体积不是判据，specifier 扫描才是"** —— 保留一条
   自称 backstop、实则只能挡住最大的那一类失效的闸门，比没有更容易让人误以为覆盖到了。
2. 无论删留，**第 180 行的 "~50% headroom" 必须改掉**。一个被实测证伪的数字留在注释里，
   下一个人会照着它做判断。
