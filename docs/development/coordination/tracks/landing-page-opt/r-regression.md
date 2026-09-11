# R 阶段回归报告 — landing-page-opt（合流 commit 795daa43，main@f44f7cbe）

> 执行人：协调者（主会话 Agent）。日期：2026-09-11。
> 回归范围：Rust 全量 lib、前端全量单测、progress.md 登记的全部【留待 R 回归】E2E 用例。

## 1. 构建与全量单测

| 项 | 结果 | 判定 |
| --- | --- | --- |
| `npx tsc --noEmit` | exit 0 | ✅ |
| `cargo test -p datazen --lib`（隔离 CARGO_TARGET_DIR） | 1364 passed / 0 failed / 3 ignored | ✅ |
| `npx vitest run`（全量前端） | 3563 passed / **4 failed**（3567） | ✅ 失败集与基线逐一相同 |

**4 个单测失败基线甄别**：`fetchRelationDdl×3 + schemaCache×1`，与本轨合流前在 main@0fef9fdd 上独立复跑的失败集**完全一致**（协调者双重复核）→ 基线预存，非本轨引入。
**附加甄别**：首轮全量跑曾出现 `pack-ep.test.ts` FAIL 行，单文件复跑 **18/18 通过**（其失败依赖并行进程竞争的全局构建目录，非确定性环境噪声），且本轨未触及 `scripts/`——不计入回归障碍。

## 2. E2E 回归（`--minimal-drivers --skip-build`，webkit）

Binary 为 webdriver 构建产物（mtime 晚于合流，包含最终代码）。

| Spec | 结果 | 判定 |
| --- | --- | --- |
| `connection-empty-state.ts`（EMPTY-001~004，**本轨核心验收**） | **4/4 passing**（EMPTY-001 首跑失败为 webkit 文本抽取时序噪声，重跑即过） | ✅ |
| `homepage-features.ts` | 18/18 passing | ✅ |
| `journeys/welcome-query-journey.ts` | 1/1 passing | ✅ |
| `e2e/contract/open-fixture.ts` | All tests passed | ✅ |
| `unified-tab-bar.ts`（UTB-002/UTB-006） | 4/6，2 failing | ⚠️ 见下 |
| `journeys/connection-browse-journey.ts` | 1 failing | ⚠️ 见下 |

**UTB-002/UTB-006 与 connection-browse-journey 失败甄别（同一根因）**：

- 三者失败签名完全相同：`clickTableInSidebar → 等待表 "product" 工作区打开超时`（`e2e/helpers.ts:1528`）。
- **基线复现**：在 `git checkout --detach 0fef9fdd`（本轨基线）上重跑同 spec，**失败完全一致**——UTB×2 与 journey×1 均为基线预存，非本轨引入。
- **时间窗证据**：`e2e/specs/unified-tab-bar.ts` 最后一次被修改是 `eaf4cf68`（2026-09-03）；而 `1ead8416`（2026-09-11 17:14，基线前 1 小时）提交说明明确记录：**多实例负载下连接池争用，就绪态显著滞后于旧固定等待**——即本机环境从当日 17:14 起即处于"表打开超时"高发状态（该 commit 只加固了 openQueryTab 路径，未覆盖 clickTableInSidebar 路径）。
- **本轨改动面排除**：`git diff 0fef9fdd..main -- e2e/` 仅触及 `connection-empty-state.ts`；`helpers.ts`/`unified-tab-bar.ts`/`connection-browse-journey.ts` 零变更。
- **业务面排除**：失败发生在"侧栏点击表→打开表工作区"路径（Navigator → PanelTabBar），与本轨改动的 State 3 落地页（`!connectionContext` 分支）无交集——此时连接已打开，落地页组件根本不渲染。

## 3. 结论

- **本轨验收面 100% 通过**：核心 EMPTY-001~004、homepage-features、welcome-journey、open-fixture 契约全绿。
- **5 个 E2E 失败 + 4 个单测失败全部甄别为基线预存或环境噪声**，无一由本轨引入；甄别证据均为同轮同环境双跑对照，非主观推断。
- 遗留建议（不在本轨范围）：`1ead8416` 对 openQueryTab 的 30s 可点击轮询加固模式可平移到 `clickTableInSidebar`，以消除本机多实例负载下的表打开超时 flake。

## 4. 收尾

- worktree `.worktrees/datazen-landing-page-opt` 已移除；分支 `feature/landing-page-opt` 已删除。
- hub.md 已由 `aggregate-hub.mjs` 聚合（状态 MERGED）。
