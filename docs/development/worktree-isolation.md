# Worktree 隔离边界

> 本文只回答一件事：**多个子代理各自在 worktree 里开发，为什么合并阶段仍会互相影响。**
> 本文只讲 git 与 worktree 的实测行为，不含任何轨道台账或进度约定。

## 1. 隔离的是工作树，不是仓库

`git worktree add` 为每个工作目录生成一个**私有 gitdir**，但它通过 `commondir` 指回根 `.git`：

```text
主检出 .git/
├── objects/            ← 共享：所有 commit / blob
├── refs/heads/         ← 共享：所有分支，只有一份
└── worktrees/
    └── datazen-ui-extract/
        ├── commondir   ← 私有，内容是 "../../"，指回根 .git
        ├── HEAD        ← 私有：ref: refs/heads/feature/ui-extract
        ├── index       ← 私有：暂存区
        └── logs        ← 私有：仅本 worktree 的 HEAD reflog
```

| 私有 | 共享 |
|------|------|
| 工作目录文件、暂存区、`HEAD`、HEAD reflog | 对象库、`refs/heads/*` 全部分支、**分支 reflog** |

因此「在不同 worktree 工作」只保证**文件互不可见**，不保证**引用互不影响**。同一个分支名在 14 个 worktree 里解析出的是同一个 sha——谁移动它，其余全部立刻看到。

自查一行：

```bash
cat "$(git rev-parse --git-dir)/commondir"   # 输出 ../.. 即确认共享
```

## 2. 由此产生的四类干扰

### 2.1 引用被间接移动

分支 reflog 是共享的，所以**任何人对该分支的移动都会留痕**。定位手法：

```bash
git reflog show feature/<track> | head        # 谁、何时、动了它
```

实例：`feature/ui-extract` 被重建到 `9c8a2808a` 后，又被一次 `reset` 移回旧值 `57bcf41cd`；reflog 留下 `reset: moving to 57bcf41cd`。若发现分支位置与预期不符，**先查 reflog 再下结论**，不要直接重建——重建会覆盖现场。

### 2.2 一个分支只能被一个 worktree 检出

这是 git 对「两个代理抢同一分支」的**唯一硬拦截**。移动一个正被检出的分支会失败：

```text
fatal: 无法强制更新检出于 '.../datazen-ui-extract' 的分支 'feature/ui-extract'
```

遇到这个报错，正确做法是**在持有该 worktree 内改**（`git -C <worktree> reset`），不要绕道 `--force` 或改写 `packed-refs`。

### 2.3 worktree 名册是全局的

`git worktree list` / `add` / `remove` 影响所有人。**为验证合并安全性而建的临时 worktree（如 `/tmp/*`）同样会出现在别人的名册里**；用完必须清理，否则留下指向主仓库的僵尸登记。Coder 红线已禁止删除 worktree，但**协调者自己建的临时 worktree 同样要收尾**。

### 2.4 rebase 基准会移动

并行合入时，集成分支尖端在 rebase 期间可能已被别人推进。因此：

- **合入前实测，不要靠算术**。两点差值会因基准移动而失真（见 §3）。
- 轨道从远端基底切出、落后很多时，`git diff A..B` 统计的是两个**尖端**的差，不是本轨自己的改动；应以 merge-base 为基准分别测量两侧。

## 3. 两点差值算不出删除

实例：某轨从旧基底切出并带着一条与本轨无关的文档清理。rebase 到集成分支后，`merge-base` **恰好等于集成分支尖端**（rebase 把它变成了自己的基底），两点差值只显示 231 文件，**不会告诉你其中是删除**。真实情况是净删 169 个文件，含 93 份开发文档、5 份架构 RFC、2 个 CI 脚本。

只有在一个一次性 worktree 里真跑一次 `git merge` 才量得出来：

```bash
git worktree add --detach /tmp/<name> <integration-tip>
git -C /tmp/<name> merge --no-commit --no-ff <track>
git -C /tmp/<name> diff --cached --name-status | grep -c '^D'   # 期望的删除数
git worktree remove --force /tmp/<name>
```

**这是本手册里唯一必须实跑而不能算的检查。**

## 4. 测试结果同样跨 worktree 不可比

同一提交在不同 worktree 里跑出的失败数可能不同，与代码无关：

- **`packages/pro-extensions/sql-editor-pro` 是独立 git 仓库且被 gitignore**，新 worktree 里没有它，约 10 个测试文件必然失败。**基线必须在同一 Pro 状态下取。** 跨 Pro 状态比较失败集合是范畴错误。
- 在 Pro 缺失的 worktree 里量基线，要 `git checkout --detach <集成尖端>` **在该 worktree 内部**跑，再切回；不要去另一个 worktree 取数字。
- `node_modules` 是逐 worktree 的实体目录。**用符号链接指向主检出的 worktree，其测试结果不可信**——模块解析会失败，而失败清单读起来像代码回归。

## 5. 红线补充

在下列红线之外：

- 禁止 `git branch -f`、`git update-ref`、`git worktree remove`、`git gc`——它们作用于共享状态。
- 禁止在 worktree 内 `git checkout` **他人分支**；需要别人的产物时读对方的 worktree 绝对路径。
- 临时 worktree 必须在同一会话内清理，并在报告中列出清理命令。
- 发现分支位置异常时，**先 `git reflog` 再动作**；reflog 是唯一现场，重建会毁掉它。
