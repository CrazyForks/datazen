# scripts-gate-BUG-002 · BUG-002 产物级键不变量的「实现侧」至今 0% 类型检查

- **状态**：待修复
- **严重度**：中（门禁覆盖面陈述性缺陷，非运行时缺陷；本轨已修掉测试侧，实现侧仍在洞里）
- **登记人**：Tester（scripts-retest 轨，独立复测）
- **登记时间**：2026-09-27
- **涉及文件**：`scripts/pack-ep.mjs`（不变量的实现）、`tsconfig.scripts.json`（`checkJs:false`）、`scripts/__tests__/pack-ep.test.ts:99-100`（曾未被类型检查的断言）、`scripts/__tests__/pack-ep.host-key-invariant.test.ts`（BUG-002 轨的测试）

## 描述

本轨（`ce4e9e838`）把 `scripts/__tests__/` 拉进了一个真实 tsc program，**测试侧**的门禁确实
补上了。但 BUG-002 轨的产物级 host-key 不变量，其**实现**在 `scripts/pack-ep.mjs` 里，而
`pack-ep.mjs` 是 `.mjs` + `checkJs: false` ⇒ **它的函数体一行都没有被类型检查**。
它出现在 program 里，只是为了让测试能 `import` 它（`allowJs: true` 把它当成一个未检查的
模块）。**被保护者进了门禁，保护者的实现没有。**

同时，本轨的 Task B 描述里点名的第一条 JSDoc（`signEpPackage` 无 `@returns` ⇒ `sigDoc.files`
被推成 `{}`）确实是**真**的，而且后果比台账写的更具体：有两条具体断言此前完全未被类型检查。

## 实测证据

### 1. 此前 `scripts/` 在零个 program 内（真实管线实测）

```bash
$ npx tsc --noEmit --listFilesOnly | grep -c "datazen-scripts-retest/scripts/"
0
```

修复后：`tsconfig.scripts.json` 的 program 内 `scripts/` 文件 = 47（23 `.ts` + 24 `.mjs`）。

**阳性对照**（证明新门禁真的看得见这些文件，而不是"碰巧绿"）：往
`scripts/__tests__/pack-ep.host-key-invariant.test.ts` 尾部临时塞
`const __testerProbe2: number = 'nope';`，根门禁 exit 0（0 错误），
新门禁转红并指名该文件：

```
scripts/__tests__/pack-ep.host-key-invariant.test.ts(241,7): error TS2322:
  Type 'string' is not assignable to type 'number'.
```

还原后 `git status` 干净、新门禁 exit 0。

### 2. `signEpPackage` 返回 `{}` —— 变异证据

把 `signEpPackage` 的 `@returns` 整块删掉（其余不动），新门禁转红，**恰好两条**：

```
scripts/__tests__/pack-ep.test.ts(99,12): error TS7053: Element implicitly has an
  'any' type because expression of type '"manifest.json"' can't be used to index type '{}'.
scripts/__tests__/pack-ep.test.ts(100,12): error TS7053: ... type '"dist/index.esm.js"' ...
```

这两行就是
`expect(sigDoc.files['manifest.json'].sha256).toBe(...)` 与
`expect(sigDoc.files['dist/index.esm.js'].sha256).toBe(...)`。
**它们从未被任何 tsc 检查过**（`ce4e9e838` 之前连 program 都没有，之后 `{}` 又让索引本身报错）。
`tsconfig.scripts.json` 的 `@returns` 与函数体逐字段核对一致
（`return { outPath, sigDoc }`，`files[rel] = { sha256 }`），是纯增信息。

### 3. 关键的那一半：不变量的实现仍未被检查

不变量的实现位置（真实管线实测——我的复现脚本两次都打在这条错误上）：

```
scripts/pack-ep.mjs:458  function hostKeyError(violations, { globalName, label }) {
scripts/pack-ep.mjs:460    `[pack-ep] artifact host-key invariant violated in ${label}:`,
```

而 `pack-ep.mjs` 的门禁状态：

```bash
$ grep -oE '"(checkJs|allowJs)": (true|false)' tsconfig.scripts.json
"allowJs": true
"checkJs": false
```

`pack-ep.mjs` 在 opt-in 的 `tsconfig.scripts-checkjs.json` 下有 **78 个**未解决错误
（实测，全仓 456 个 `.mjs` 错误中最大的一项），本轨**明确选择不处理**。

## 影响范围

- BUG-002 轨"产物级键不变量"这条 CI 契约，其**强制点**（`hostKeyError` 一带）今天仍然
  0% 类型检查。`allowJs` 让门禁**看得见这个模块存在**，但不检查它——这正是本轨
  `progress.md` 自己批评 row 1 vs row 2 时说的"门禁绿着、什么都没查"的缩小版。
- 风险等级低于 Task A 那类运行时缺陷：`.mjs` 无 JSDoc 是既有技术债，类型系统在这里
  本来也提供不了多少保证。**但台账目前没有任何一处把这件事记为账**，未来读者会以为
  "BUG-002 的不变量已经被门禁罩住了"。

## 建议修法（Tester 不改业务代码）

二选一，都不需要在本轨做：

1. **记账优先（零成本）**：在 `tsconfig.scripts-checkjs.json` 的注释或某处明写
   "pack-ep.mjs 的函数体不在任何门禁内；BUG-002 键不变量的强制点在此"。
2. **排期 ratchet**：`456 → 378` 的下一次削减，从 `pack-ep.mjs` 的 78 个开始；
   先给 `hostKeyError` / 不变量收集函数补 `@param`/`@returns`，就能把最要紧的那一段
   纳入 `checkJs`。

## 复测记录

- （待修复后由复测 Tester 追加）
