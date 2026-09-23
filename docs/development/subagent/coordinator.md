# 协调者 (Coordinator) 规程

> 角色定位：主会话代理。负责全局架构把控、功能拆分、波次编排、子代理派发、活性监控、合流仲裁与清理。  
> **核心硬线：主协调者不直接写业务代码，专注统筹协调；每个关键节点主动向用户汇报。**

## 1. 波次拆分原则（以文件冲突面为准）

- **分轨依据**：严格按照文件冲突面划分轨道，而不是功能逻辑相近度。
  - 触碰互斥文件（如 `mcp/**` vs `commands/driver_command.rs`）→ 可并行。
  - 触碰同一注册块但不同行（如 `lib.rs` 的 invoke_handler）→ 可并行。
  - 依赖公共核心接口改动或模式复用软依赖 → 必须分波次串行。
- **基线约定**：所有同波次轨道以主集成分支（如 `feat/post-review-hardening`）为基准拉出。

## 2. 轨道准备 (Bootstrap)

### 2.0 工具相对路径陷阱（W3 实证，**每条简报都必须写明**）

`read` / `grep` / `glob` 等工具收到**相对路径**时，解析基准是**主检出**（harness 的会话工作目录，通常是 `/path/to/datazen`），**不是**子代理的 worktree。子代理以为自己在读 `packages/drivers/redis/src/ops.rs`，实际读到的是**主检出 `main` 分支上的那一份**。

后果（实测，非理论）：
- 主检出 `main` 与集成分支**已分叉**（W3 实测：`main` 独有 18 提交 / 基线独有 219 提交，基线**不是** `main` 的祖先）。
- 同一路径 `packages/drivers/redis/src/ops.rs`：主检出 **1172 行**（含 `set_string_with_options`），子代理 worktree **1124 行**（无该函数）⇒ 子代理会看到**别的分支的代码**，并据此得出「函数已存在 / 已删除」的错误结论。
- 更隐蔽的是它会**污染差异分析**：任务书里写的「合流过的函数」可能只存在于主检出。

**规则**：派单简报必须写明「**一律用绝对路径**（`<worktree 绝对路径>/...`）」，或明示「源码检查走 `bash` 在工作目录内执行」。协调者自己复核时同样遵守。
**合流前的连带检查**：`git log --oneline <baseline>..main -- <改动面>` 看主检出自基线以来有无独立提交 —— 有则在 `hub.md` 的 R 清单登记「前向合并（main → 集成分支）」条目，别让它烂在分叉里。

主检出执行配套脚本创建隔离环境：
```bash
scripts/new-feature-worktree.sh <track-id> <base-branch>
```
脚本自动完成：
1. 在 `.worktrees/datazen-<track-id>` 创建独立 worktree 并切换至分支 `feature/<track-id>`。
2. 建立 `node_modules` 软链。
3. 执行驱动 codegen 与 locale codegen。
4. 复制主检出未跟踪的规格文档（保持 untracked）。
5. 准备 `docs/development/coordination/tracks/<track-id>/` 目录。

## 3. 简报准备与派发

从 `docs/development/subagent/templates/` 提取对应角色的简报模板，组装以下要素后使用 `Task` 工具派发全新实例：
1. **工作目录与分支**：明确绝对路径，申明仅在此工作。
2. **必读列表**：
   - `AGENTS.md`
   - `docs/development/subagent/coder.md`（或 `tester.md`）
   - `docs/development/coordination/tracks/<track-id>/progress.md`
3. **已侦察落点**：预先 grep 文件与行号，声明“落点需自行核实”。
4. **验收标准**：可量化核验的完成条件。
5. **执行纪律**：禁碰 `hub.md`、禁 `pnpm install`、Grep 工具搜索、CARGO_TARGET_DIR。

### 3.1 并发派发硬性规则

- **同一 Wave 的全部 Coder 必须在同一条消息中通过多个 `Task` 调用并行派发**，严禁串行逐个启动。
- **某个 Coder 返回 `READY_FOR_TEST` 后，协调者必须立即为该轨启动 Tester**，无需等待同 Wave 其他 Coder 完成。若多个 Coder 同时返回，对应 Tester 也必须在同一条消息中并行派发。
- Tester 与仍在运行的 Coder 可以共存——各自在独立 worktree 中工作，互不干扰。

### 3.2 Bug 修复循环

Tester 完成完整测试后交回判定；Bug 在证实当下即逐条落盘（一 Bug 一文件），终报汇总清单。协调者收到 `TEST_FAILED` 后启动修复循环：

```text
Tester 跑完 4 阶段 → 交回 Bug 清单 + TEST_FAILED（各条已在 bugs/ 目录逐文件落盘）
→ 协调者 resume 原 Coder agent 修复全部 Bug
→ Coder 修复并提交 → 协调者派发全新 Tester 完整复测
→ 通过 → 闭环 / 不通过 → 回到循环起点
```

**规则**：
1. **逐条落盘、统一交回**：Tester 每证实一条 Bug 立即单独 commit 其 `bugs/<bug-id>.md`（死亡免疫，判定不丢）；但 TEST_FAILED 状态机上报仍须等 4 阶段全部跑完，不逐个中断。
2. **复用原 Coder**：优先 `Task(resume=<coder-agent-id>)` 恢复原编码 Coder，利用已有上下文。仅不可恢复时用 Rescuer。
3. **修复后必须复测**：Coder 修复并返回 `READY_FOR_TEST` 后，协调者**必须**派发全新 Tester 完整复测。Coder 的自验不能替代 Tester，禁止跳过复测直接合入。
4. **全新 Tester**：每轮复测使用全新 Tester 实例。
4. **最大 5 轮**：同一轨道超过 5 轮仍有 Bug，标记 `ESCALATED` 上报用户。
5. **Bug 状态流转**：`待修复` → `修复中` → `待复测` → `已修复` 或回到 `待修复`。
6. **修复简报**：必须包含完整 Bug 清单（ID + 描述 + 重现步骤 + 日志）+ "仅修复这些 Bug" 纪律约束 + 本文件 §3.3 的四份模板件。

### 3.3 修复回合简报的强制要素（W3 实证教训）

派发任何修复/复测/续跑代理时，简报必须自带以下四件，缺一即可能让整个回合报废：

1. **交接手册**：新派实例（与死者不同会话）看不到死者的对话与推理。若修复方案依赖协调者的裁定/取证结论，把**具体落点（文件:行号）+ 已验证的修复方式 + 需审计确认的点**写进简报正文。反例：W3-B/D 两棒的交接结论只存在于已死代理的上下文里，新实例从零重新取证，两棒死亡期间零产出。
2. **写锁声明**：明写「你是该 worktree 唯一写者」，并列出禁写文件与授权文件（跨轨修复需**显式授权**越界文件，如"仅许动这 3 个 ui 文件 + 新测试"）。
3. **死亡免疫协议**：一步一 commit（禁止超过 15 分钟无 commit 区间）、重型命令严格串行一次一条、收口前在提交态复跑门禁。本环境的代理死亡多为服务错误/瞬时网络，且**常在长阅读/长思考区间无落盘时发生**——落盘频率就是损失上限。
4. **Bug 文件写面**：修复者只改 `- **状态**：` 行 + 追加 `## 修复记录（round-N）` 块；正文归登记 Tester。禁改他人区段（一 Bug 一文件后，这是唯一仍可能冲突的共享面）。
5. **验收句禁用析取式**（W3 实证教训）：写「消解**或**有界」「A **或** B」这类析取验收句，等于给「只做一半」发通行证 —— W3 `redis-detail-ui` BUG-007 的验收句是「消解或有界」，修复只做了有界就过闸；随后第 3 轮 Tester 用探针实测出残留态下点保存会**写到陈旧键名**（`SET … "user:1"`，而屏幕显示 `user:renamed`），即析取的后半支掩盖了一个高危数据错误。**规则**：验收句只写**唯一期望终态**；若两种实现都接受，必须分别写清「A 形态的验收锚点」与「B 形态的验收锚点」，而不是用「或」把它们并成一句。
6. **析取式断言会让变异假阴性**：同轮 Tester 的变异 (iii)「答 keep 也放行」在析取断言下**全绿**（悬起未答时前半支恒真），只有自建探针才照出盲区。**规则**：修复回合简报要求 Coder 对**每条**变异注入都能指出「红在哪条断言」；出现「注入后仍绿」必须当作**测试强度缺陷**立案，不得当作无害。


## 4. 活性监控与死亡恢复

### 4.1 活性判定依据（用墙钟时间，看真实证据）
- 编码类代理给予 20 分钟宽限期。
- 依赖 3 项客观证据判断活性：
  1. `git -C <worktree> status --short` 是否产生 M 状态文件。
  2. 系统进程是否有 cargo/rustc/vitest/node 在持续占用 CPU。
  3. 构建输出目录的 mtime 是否推进。

### 4.2 死亡恢复升级链
- **死亡次数 ≤ 3**：优先原会话发送“继续”，保留其上下文与历史编辑。
- **死亡超过 3 次**：派发全新**接管代理 (Rescuer)**，基于 `git status` 现场盘点补齐。

## 5. 方案 B 进度总览聚合

各子代理仅提交各自 `tracks/<track-id>/progress.md` 与 `bugs/` 目录（一 Bug 一文件）。
协调者在以下节点运行聚合脚本：
```bash
node scripts/aggregate-hub.mjs
```
- **执行时机**：每轨启动后、每轨完成合并后、或向用户同步进度前。
- **禁止行为**：禁止任何人或子代理手动编辑 `docs/development/coordination/hub.md`。

## 6. 合流验证与清理

### 6.1 逐轨合并
**合入前提条件**：只有 Tester 返回 `TEST_DONE`（PASSED）且 `tracks/<track-id>/bugs/` 无未关闭 Bug（历史单文件 `bugs.md` 同样计）时，才能合入。Coder 的 `READY_FOR_TEST` 不满足合入条件——必须经过 Tester 复测。

协调者在集成分支合入该轨：
```bash
git merge --no-ff feature/<track-id> -m "feat(coordination): merge track <track-id>"
```
合并后在集成分支运行快速健全性检查：
- `npx tsc --noEmit`
- 定向单元测试 `cargo test -p datazen --lib` / `npx vitest run`

### 6.1.1 冲突裁决：区分「文本冲突」与「语义冲突」（W3 实证教训）

机械冲突（两侧改同一批行）git 会报，人眼能看；**语义冲突 git 不报**，必须在合流前主动查：

- **同文件不同抽象层**：一轨拆模块（如把 465 行组件拆成 `batchInvokes.ts` + `useBatchActions.tsx`），另一轨在同一文件升契约（如把 `count_matching` 消费端从 `Promise<number>` 升到冻结对象 `CountMatchingResult`）。D 轨从更早 base 分出 ⇒ 只有少数几行真冲突，**机械取任一整侧都会静默丢失语义**：取拆分侧把契约退回旧形状（`[object Object]` bug 复活），取契约侧丢掉模块拆分。
- **裁决依据是契约/语义，不是分支新旧**：先问「哪一侧的形状被冻结、被谁消费、有没有守卫测试」，再决定保留谁的结构、把谁的语义**移植**进去。
- **合流清单**：`git log --oneline <merge-base>..<other> -- <file>` 检查两轨是否都碰过同一文件的**不同抽象层**；`--name-only` 取交集，逐个判「文本 or 语义」。
- **移植必须带上守卫测试**：把被移植方的回归测试按新结构重写（如把渲染整组件的用例改成「hook + 触发条 + `actions.dialogs`」三段式），**断言一条不减** —— 否则重构会让旧 bug 在测试绿灯下复活（W3 `redis-tree-ui` 合流实证：8 条断言全部保留，含 `[object Object]` 反断言与 `n+` 截断臂）。

### 6.2 Worktree 与分支清理
确认合入主线且无残留后执行规范清理：
```bash
# 1. 移除 worktree
git worktree remove .worktrees/datazen-<track-id>
# 2. 删除已合入分支
git branch -d feature/<track-id>
# 3. 重新聚合 hub
node scripts/aggregate-hub.mjs
```

## 7. 全量回归 (R 阶段)

**所有 Wave 的全部轨道合并完毕后，统一执行一次 R 阶段全量回归**。中间各 Wave 合入时仅做合并健全性校验（`npx tsc --noEmit` + `cargo test -p datazen --lib`），不做完整回归：
1. 完整的编译与类型检查：`pnpm build`、`cargo check`、`npx tsc --noEmit`。
2. 全量单元测试：`cargo test -p datazen --lib`、`npx vitest run`。
3. 逐项回归**所有 Wave 所有轨道**在 `progress.md` 中登记的【留待 R 回归】E2E 用例。
4. 确保所有 Bug 均已关闭。
