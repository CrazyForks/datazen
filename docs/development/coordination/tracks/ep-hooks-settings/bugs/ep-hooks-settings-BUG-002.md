# BUG-002：编辑器挂载时多发一次 8 槽位重配事务

- **状态**：待修复
- **严重度**：低
- **轨道**：ep-hooks-settings
- **发现者**：Tester（第 1 轮）
- **发现时基线**：`6d3fedf97`
- **类别**：性能 / 代码意图与行为不一致
- **是否本轨道引入**：**是**（`proCompartments.ts` 与重配 effect 均为本轨道新增）

---

## 一、一句话描述

`SqlEditor.tsx:529-537` 的重配 effect 依赖一个 `appliedPayloadRef` 去重，
但**挂载 effect 从不写入这个 ref**，而它初值为 `null`。
于是编辑器每次挂载时，挂载 effect 刚装好 8 个舱位，紧接着重配 effect 又判断
"`appliedPayloadRef.current !== proPayload`" 成立，**多发一次完整的 8 槽位重配事务** ——
正是该 effect 上一行注释声称不会发生的事。

---

## 二、代码位置

`src/components/sql-editor/SqlEditor.tsx:523-537`：

```ts
const appliedPayloadRef = useRef<ProCompartmentPayload | null>(null);
useEffect(() => {
  const view = viewRef.current;
  // The mount effect above already installed this exact payload; re-applying
  // it would only add a redundant transaction.          // ← 注释声明的事实与实际不符
  if (!view || appliedPayloadRef.current === proPayload) return;
  appliedPayloadRef.current = proPayload;
  reconfigureProCompartments(view, proPayload);
}, [proPayload]);
```

挂载 effect 在 `SqlEditor.tsx:433-521`，其中 `:467` 通过
`...mountProCompartments(proPayload)` 把 8 个舱位装进 state —— **它不 dispatch**，
也**不设置** `appliedPayloadRef`。

React 在同一次 commit 内按声明顺序执行副作用：挂载 effect（:433）先跑，重配 effect（:530）后跑。
后者的守卫读到 `appliedPayloadRef.current === null`，与 `proPayload` 不等 ⇒ 不短路 ⇒ 发出冗余事务。

---

## 三、复现步骤（实测日志）

在 worktree 中临时放一个探针测试（Tester 已删除，不入库），
对 `EditorView.prototype.dispatch` 打桩并记录每个事务的 effects 数量与其 JS 调用栈：

```bash
cd /Users/wuxiaolong/code/rust-projects/datazen/.worktrees/datazen-ep-hooks-settings
# 探针要点：render(<SqlEditor value="SELECT 1" onChange={noop} />)，然后打印
#   1) 每次 dispatch 的 effects 长度
#   2) new Error().stack 中第一个非 __tests__ 的 sql-editor/ 帧
```

### 实测输出

```
AT MOUNT:
effects=8 @ at reconfigureProCompartments (src/components/sql-editor/proCompartments.ts:185:8)
effects=0 @ at src/components/sql-editor/SqlEditor.tsx:559:10
effects=0 @ at src/components/sql-editor/SqlEditor.tsx:569:10
AT SETTINGS WRITE:
effects=8 @ at reconfigureProCompartments (src/components/sql-editor/proCompartments.ts:185:8)
```

- 挂载时那一次 `effects=8` 的事务来自 `reconfigureProCompartments`，**就是冗余的那一次**。
- 设置写入时那一次 `effects=8` 是**正确且期望**的（这正是验收标准 §四.5 要求的原子批）。

（`:559` / `:569` 的两个 `effects=0` 是主题预设与 focus 副作用，与本缺陷无关。）

### 补充实测：工厂没有被重复调用

对 7 个舱位工厂逐一计数，挂载期间每个工厂**只被调用 1 次**：

```
FACTORY_CALLS_AT_MOUNT = {"statement":1,"intention":1,"hover":1,"paste":1,"linter":1,"keymap":1,"extra":1}
```

⇒ 冗余事务**不会**让扩展工厂跑两遍（`proPayload` 里已是算好的扩展数组，
`reconfigureProCompartments` 只是把它们塞回舱位）。这把影响面从"重复调用扩展工厂"
收窄为"多做一次 CodeMirror 配置重算"。

---

## 四、影响面（为什么定为低危）

1. **不影响正确性**：重配用的是同一份已算好的 payload，CodeMirror 会重算出等价的配置。
2. **不影响验收标准 §四.5**：设置写入路径实测仍为**恰好 1 次 dispatch**（见上表第二段）。
3. **不影响击键延迟预算**：该事务只发生在编辑器挂载时，击键路径完全不触碰它，
   AGENTS.md 的 <5ms 键入延迟约束不受影响。
4. **确实的代价**：每次打开编辑器，白白重建 8 个舱位的配置并触发一次全量 view update。
   在大文档上这是可测量的无用开销。
5. **更值得修的是"注释在说谎"**：一个维护者读 `:532-533` 会以为挂载时不会重配，
   从而写出依赖该假设的测试或后续优化；实际行为与之相反。

---

## 五、期望行为

挂载时**只**安装一次 payload，不再发第二次事务；重配 effect 只在 `proPayload` **真正变化**后才动作。

---

## 六、修复方向

由挂载 effect 在装好 payload 后同步写入 ref，使重配 effect 的守卫在挂载那一帧自然短路：

```ts
// 挂载 effect 内，`...mountProCompartments(proPayload)` 之后
appliedPayloadRef.current = proPayload;
```

注意 `appliedPayloadRef` 当前声明在 `:529`（重配 effect 之前），
挂载 effect 在 `:433` —— 需要把 `useRef` 的声明上移到挂载 effect 之前，或改用单独的 ref。

另一种等价做法：把守卫从"ref 比较"改为"view 上已安装的 payload 标记"，
但前者改动最小。

---

## 七、建议补测

在 Tester 的 `keymapPrecedenceRealHost.tester.test.ts` 之外，另加一条针对 `SqlEditor` 组件的测试：

- 挂载后统计 `view.dispatch` 调用中**携带 ≥2 个舱位重配 effect** 的次数 ⇒ 应为 **0**；
- 写入一次设置后该次数 ⇒ 应为 **1**。

这正是本缺陷的最小可复现断言，也是防止回归的唯一护栏。
注意：按 `docs/development/subagent/tester.md`，Tester 不修改业务代码，
该测试在修复落地前会失败，建议由 Coder 在同一 commit 内补上。
