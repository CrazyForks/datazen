# qb-editor-pro-BUG-002 · Host lock pins an unpublished Pro commit

- **严重度**：P1
- **状态**：已修复，待 Tester Round 3 复测
- **涉及文件**：`pro-extension.lock.json`、`packages/pro-extensions/sql-editor-pro`（commit `2a45c90f28041e81c948e67b9416fade8ac5472f`）、`scripts/resolve-pro.mjs`
- **描述**：Host lock 将正式 Pro 构建固定到 Pro commit `2a45c90f28041e81c948e67b9416fade8ac5472f`，但配置的上游 `https://github.com/flyxl/datazen-extension-sql-editor-pro.git` 没有该对象。Pro `git ls-remote` 仅公布 `main` / `HEAD`=`c60f7fc8e1d552c6a37d3f70128d9c8e42555750`。干净的构建 checkout 会从 lock URL 克隆后执行 `git checkout --detach <ref>`；因此无法 checkout lock ref，Pro 发布构建被阻断。当前工作树 E2E 使用本机 Pro checkout，无法发现此远端可达性问题。
- **重现步骤**：
  1. 运行 `git ls-remote https://github.com/flyxl/datazen-extension-sql-editor-pro.git HEAD refs/heads/main refs/heads/master`，输出仅为 `c60f7fc8e1d552c6a37d3f70128d9c8e42555750` 的 `HEAD` 和 `refs/heads/main`。
  2. 在空临时目录运行 `git clone --quiet https://github.com/flyxl/datazen-extension-sql-editor-pro.git <tmp>/repo`。
  3. 运行 `git -C <tmp>/repo checkout --detach 2a45c90f28041e81c948e67b9416fade8ac5472f`。
- **实测错误日志与影响范围**：隔离 clone 成功，checkout 返回码 `128`：`fatal: reference is not a tree: 2a45c90f28041e81c948e67b9416fade8ac5472f`。`scripts/resolve-pro.mjs` 对干净 checkout 调用 `pinProCheckout`，该函数在 pin 不存在时直接抛错；因此依赖 lock 的标准 Pro 源码构建无法完成。修复需要先把该 Pro commit 发布到配置的上游（或将 lock 改为预期发布源上可达且内容一致的 revision），再从全新 clone 复验。

## 修复与自验

- 使用 Host lock 配置的远端 `https://github.com/flyxl/datazen-extension-sql-editor-pro.git`，非强制推送现有本地分支 `codex/qb-editor-pro` 到同名上游分支；未修改远端 `main`，未创建 release。
- `git ls-remote --heads <lock.git> refs/heads/codex/qb-editor-pro refs/heads/main` 返回 feature branch `2a45c90f28041e81c948e67b9416fade8ac5472f` 与原有 main `c60f7fc8e1d552c6a37d3f70128d9c8e42555750`。
- 从 lock 读取 git/ref 并调用 `scripts/resolve-pro.mjs` 的 `ensureProCheckout`，在新的隔离临时目录进行真实 clone + detached checkout；HEAD 与 lock 完全相同，clone status clean。
- 当前状态等待独立 Tester Round 3 再从上游验证发布 resolver。
