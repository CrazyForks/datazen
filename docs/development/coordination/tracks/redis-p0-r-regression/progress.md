# Track: redis-p0-r-regression — Redis Workbench P0 集成回归

- 任务: Wave 3 `redis-src-split`、Wave 4 `redis-kv-context-bar` 合流并前向合入 main 后的集成回归
- 状态: **AUTOMATED_PASS / MANUAL_PENDING**（自动化回归已通过；真实 Redis 与桌面 GUI 旅程待人工验收）
- 测试 commit: `78e1ecbb2`（补齐 main 新增隧道字段的 Redis 测试 fixture，并清除合并造成的重复测试 mock 键）
- 合并 commit: `77e0ad2ae`（main `bbb92bc04` → `feat/redis-workspace-ux`）
- 分支: `feat/redis-workspace-ux`
- Worktree: `.worktrees/datazen-redis-p0-integrate`
- 心跳: 2026-09-23（自动化回归完毕，移交真 Redis / GUI 清单）

## 自动化回归

- `node scripts/resolve-drivers.mjs --codegen-only --drivers=all`: exit 0，生成 15 个 path 驱动。
- `npx --no-install tsc --noEmit -p tsconfig.json`: exit 0。
- `cargo test -p datazen --lib`: **1481 passed / 0 failed / 3 ignored**。
- `npx --no-install vitest run src packages/driver-sdk packages/ui`: **434 files / 4529 passed**。
- `npx --no-install vitest run --config vitest.drivers.config.ts`: **76 files / 984 passed**。
- `npx --no-install vitest run scripts`: **23 files / 254 passed**。
- `cargo test -p datazen-driver-api --lib`: **126 passed / 0 failed**。
- `cargo test -p datazen-driver-redis`: lib **348 passed / 0 failed / 4 ignored**；集成目标 **12 passed / 0 failed / 5 ignored**；doc tests 0。
- `cargo check --workspace`: exit 0（全 workspace，15 path 驱动）。
- `node scripts/with-driver-inject.mjs --drivers=all -- cargo check -p datazen --lib`: exit 0。
- `npx --no-install vite build`: exit 0；all-driver build 的 main chunk **1735.74 kB / gzip 504.85 kB**、MainPage **2313.01 kB / gzip 681.47 kB**，Vite 仍报告 dynamic-import 与 >500 kB chunk 警告。
- `node scripts/check-driver-import-boundaries.mjs`: **1556 files / 0 blocking / 4 advisory**。
- `node scripts/check-id-terminology.mjs`: exit 0（1947 files）；`node scripts/check-module-layers.mjs`: exit 0（3 rules）；`node scripts/check-ci-docs-consistency.mjs`: exit 0（11 driver ids、window boundaries、toolchain）。
- `npx --no-install vitest run src/windows/connection/__tests__/ConnectionNavigatorTree.test.tsx`: **1 file / 87 passed**（验证重复 mock 键修正）。

### 非阻断项

- `node scripts/i18n-sync-check.mjs` exit 1：**4125 missing / 1650 stale**；英文 source 新增键尚未进入发布前翻译回合，CI 对此门禁为 non-blocking。
- `pnpm test:unit:drivers` 被 pnpm 依赖状态检查拦截，尝试自动执行 `pnpm install` 后因无 TTY 中止；未改动依赖目录。对应底层命令 `npx --no-install vitest run --config vitest.drivers.config.ts` 已完整通过。
- 首次 Redis crate 测试编译发现 `tests/tree_contract_tester.rs` 的 `ConnectionConfig` fixture 缺 4 个隧道字段；已修复并重跑通过。TypeScript 首轮发现 `ContentViewDrawers.tsx` 重复常量声明，也已在 main 合流提交前修复并复测通过。

## 手工待验（没有用单测代替）

- 真 Redis Standalone / Sentinel / Cluster 连接：核验 Redis 工作区各数据类型、Safe Mode 拦截、超大 value 只读、切换语言、扫描预算中断、dirty 状态切键拦截。
- 屏 A 大 key 跳转与采样类型分布标注；contextBar、statusBar、键属性侧栏在真实窗口中的展示与交互。
- W4 `W4-KVBAR-01/02`：compact overflow 保留采样标记；`maxmemory=0` 明确展示无限制；同时复核已登记的 `W4-KVBAR-03..07`。
- Redis Cluster 9a：用 MONITOR 证明路由命令确实落在目标分片；Cluster 9e：复现并裁定 `list_children` 的 CrossSlot；真实连接下核验 `select_db` 的 current_db 短路。
- 运行 `packages/drivers/redis/e2e/redis.ts` Standalone 工作区旅程与 `redis-topology.ts` Cluster / Sentinel 旅程；需相应 Redis 服务、环境变量与可运行的 Tauri GUI。
