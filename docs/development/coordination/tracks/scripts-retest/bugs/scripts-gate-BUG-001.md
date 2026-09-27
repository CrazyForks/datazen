# scripts-gate-BUG-001 · `tsconfig.scripts.json` 的 `$comment` 谎称 e2e spec 属于 e2e program

- **状态**：待修复
- **严重度**：低（文档性失实，不影响门禁行为）
- **登记人**：Tester（scripts-retest 轨，独立复测）
- **登记时间**：2026-09-27
- **涉及文件**：`tsconfig.scripts.json`（`$comment` 段）；相关但正确的：`docs/development/coordination/tracks/scripts-gate/progress.md`

## 描述

`tsconfig.scripts.json` 的 `$comment` 里排除 `scripts/e2e-screenshots/` 的理由写成：

> "editor-blog-screenshots.ts is a WebdriverIO spec that imports @wdio/globals and
> e2e/helpers.ts, which belongs to the e2e/tsconfig.json program (it declares the
> @wdio types)."

这句话把**被排除的那个 spec** 说成"属于 e2e/tsconfig.json program"。**不成立。**

`e2e/tsconfig.json` 的 include 是 `["**/*.ts"]`，相对于 `e2e/` 目录解析，**结构上够不到
`scripts/e2e-screenshots/`**。spec 物理上住在 `scripts/` 下，不在任何 tsc program 内。

注意：同一段注释紧接着又写了一句正确的 "It is currently in no program at all"，
`progress.md` 也写对了（"It is currently in no program at all — registered as a
finding"）。所以 **progress.md 是对的，错的是留在配置文件里的那句**——而配置文件正是下一个
维护者会读的东西。

## 实测证据

**证据等级：真实管线实测（`tsc --listFilesOnly`，非推理）**

```bash
$ npx tsc -p e2e/tsconfig.json --noEmit --listFilesOnly | grep -c "e2e-screenshots/editor-blog-screenshots.ts"
0

$ npx tsc -p e2e/tsconfig.json --noEmit --listFilesOnly | grep -c "e2e/helpers.ts"
1                      # helpers.ts 确实在 e2e program 里
```

即 `e2e/helpers.ts` 在 e2e program，**spec 不在任何 program**。

排除方式的可见性是**合格的**（这部分不是缺陷）：

- `tsconfig.scripts.json` 与 `tsconfig.scripts-checkjs.json` 都显式写了
  `"exclude": ["scripts/e2e-screenshots"]`——不是靠 glob 碰巧不匹配。
- program 内 `scripts/` 文件数 = 47（23 `.ts` + 24 `.mjs`），
  `git ls-files 'scripts/*.ts' 'scripts/**/*.ts'` 中**唯一**不在 program 内的就是这一个 spec。

排除的**代价**独立复核（Coder 报 "195 errors from e2e/helpers.ts"）：

```
errors: 400
  204  e2e/helpers.ts
  114  scripts/e2e-screenshots/editor-blog-screenshots.ts
    7  e2e/lib/screenshotTrace.ts
```

即排除确有必要；但 `e2e/helpers.ts` 的错误数实测是 **204**，不是台账里的 195。

## 影响范围

不改变任何编译/门禁行为。影响的是**认知**：一个维护者读到配置注释，会以为"这个 spec 已经
被 e2e program 覆盖了，所以我不用管它"，而实际上它在零个 program 内——正是本轨要消灭的
那类"看起来被检查了、其实没有"。

## 建议修法（Tester 不改业务代码）

把 `$comment` 里那半句改成事实描述，例如"spec 目前不在任何 program 内（`e2e/tsconfig.json`
的 include 相对 `e2e/` 解析，够不到 `scripts/`）；诚实的修法是把它移到 `e2e/specs/` 并纳入
e2e program"。

## 复测记录

- （待修复后由复测 Tester 追加）
