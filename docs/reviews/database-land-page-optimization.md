# Database Landing Page 优化方案（未打开任何连接时）

> 参考稿：`docs/reviews/deepseek_land_page.html`
> 目标页面：`src/windows/connection/ConnectionWorkspaceHome.tsx` 的 **State 3**（`!connectionContext` 且无激活 Panel，即已保存连接但均未打开时的主区落地主页）。
> 左侧 Navigator 树（连接侧栏）不在本方案范围内，保持现状。

---

## 1. 现状诊断

当前 State 3 自上而下依次渲染：

| 区块 | 现状实现 | 问题 |
| --- | --- | --- |
| Hero | `selectConnectionTitle` + 固定 hint 文案 | 信息量为零，不随数据变化（参考稿是 "You have **2 connections** saved…" 的动态摘要） |
| 指标卡 ×3 | 连接总数 / Pinned 数 / DB 类型数（约 L307–363） | **纯 vanity metrics，不可点击、不可操作**，占据了首屏最好的位置 |
| Quick Start（左 2/3） | 排序后 **硬编码截断 4 条**（L166–177），整行点击隐式连接 | 连接多于 4 个时无法在主区触达；无搜索；不显示分组（group）；无显式 Connect 按钮 |
| Common Ops（右 1/3） | 新建连接 / 新建查询 / 备份 / 恢复 / 导入（L448–531） | 备份/恢复在**无任何连接会话**时是死胡同动作；5 个入口占掉 1/3 宽度，性价比低 |
| Recent Queries（左下） | 仅 3 条，显示 database + 耗时 + Copy | 缺少**相对时间**（"2 min ago"）、**来源连接名**（全局历史时无法分辨来源）、无 Rerun hover 动作 |
| MCP 卡（右下） | 整卡高度 + 标题 + 描述 + 命令 + Copy | 占位过重，参考稿将其压缩为一条横向 promo bar |
| 快捷键提示 | 无 | 参考稿底部有 `⌘K · ⌘T · ⌘B` 提示，可发现性更好 |

另外：单文件 887 行，超出「推荐 ≤800 行」规范，重构时顺势拆分。

---

## 2. 目标布局（主区 wireframe）

```text
┌────────────────────────────────────────────────────────────────┐
│  Ready to query                                                │
│  You have 12 connections saved · 3 groups · 4 database types   │
├────────────────────────────────────────────────────────────────┤
│  YOUR CONNECTIONS ──────────── [🔍 Filter…]  [+ New] [Import]  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ (pg) PostgreSQL-Local  [PostgreSQL]        ● Connected   │  │
│  │      127.0.0.1:5432 · Development           [▶ Connect]  │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ (my) MySQL-Local  [MySQL]                  ○ Offline     │  │
│  │      127.0.0.1:3306 · Development           [▶ Connect]  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  Showing 2 of 12 · [Show all]                                  │
├────────────────────────────────────────────────────────────────┤
│  RECENT QUERIES ───────────────────────────────── View all →   │
│  ▸ SELECT … FROM orders     sales-db · 2 min ago · 19 ms       │
│  ▸ DROP TABLE demo_sales    datazen_demo · 1 h ago · 19 ms     │
├────────────────────────────────────────────────────────────────┤
│  (plug) DataZen MCP Server — let Cursor/Claude query your DBs  │
│         datazen mcp ───────────────────────── [⧉ Copy config]  │
├────────────────────────────────────────────────────────────────┤
│  ⌘N New query · ⌘⇧H History · （keymap 动态渲染，非硬编码）      │
└────────────────────────────────────────────────────────────────┘
```

设计基调沿用参考稿：**任务导向、单列叙事、hover 才露出次级操作**；信息密度提升，滚动长度缩短约一半。

---

## 3. 分区设计

### 3.1 Hero（替换原标题 + 3 张指标卡）

- 主标题复用/改写 `connWin.home.selectConnectionTitle`；副标题改为**动态摘要**：
  `{count} connections saved · {groups} groups · {types} database types`（数字加粗，参考稿 `.hero p b` 样式）。
- 数据全部来自现有 store：`connections.length`、`connections[].group` 去重数、`databaseType` 去重数（`distinctDbTypes` 已存在，保留复用）。
- **删除 3 张指标卡**。DB 类型图标簇（ DbTypeBadge 叠放）可作为 hero 右侧装饰保留或一并删除（推荐保留，视觉锚点成本低）。

### 3.2 Your connections（核心区，承接 Quick Start + Common Ops）

结构：`section head`（标题 + 行内搜索框 + `+ New` + Import ghost 按钮）→ 卡片列表 → 尾注。

卡片行（对齐参考稿 `.ccard`）：
- 左：DbTypeBadge（32–38px，现有组件）。
- 中：名称（semibold）+ 类型 tag（现有样式）；第二行 `host:port · {group}`（等宽字体；group 来自 `ConnectionConfig.group`，无分组则省略；文件型数据库回退 `database`/label，沿用现有 `hostPort` 推导逻辑并追加 group）。
- 右：状态 pill（Connected 绿 / Connecting accent + ping / Offline 中性，**沿用现有三态逻辑**）+ 显式动作按钮：
  - Offline → 主色 `▶ Connect`（点击走 `handleConnect` → `onSelectConnection`，与侧栏行为一致）；
  - Connecting → 按钮内 spinner，禁用；
  - Connected → 次级样式 `Open`（`handleSelectConnection` 已实现"聚焦既有 tab"语义，无需新逻辑）。
- 整行保持可点击（连接/聚焦），按钮是可视 affordance 而非唯一入口。

列表行为：
- **行内过滤**（client-side，匹配 name/host/group/dbType label），搜索框带清空按钮；无匹配时显示空态"No connections match 'xx'" + Import 提示。
- 默认渲染前 6 条 + `Show all (N)` 展开/收起（替代硬编码 4 条截断）。排序沿用现有规则：pinned → lastConnectedAt → name，**排序代码原样保留**。
- `+ New connection`、`Import connections` 从 Common Ops 列迁入 section head，行为与 testid 不变（`new-connection-button` / `import-connections-button` 已在 State 1 使用，此处为同 action 的另一挂载点）。
- **Backup / Restore 从本页移除**：无会话时动作无意义；入口保留在连接态主页（State 4）与菜单。

### 3.3 Recent queries

对齐参考稿 `.hrow` 行式布局：
- 单行：左侧 SQL（mono、truncate，hover 变亮）；元信息行 `来源连接名 · 相对时间 · 耗时`（失败条目保留红点）。
- **来源连接名**：由 `entry.connectionId` 在 `savedConnections` 中查名，查不到回退 `entry.database`（解决全局历史无法分辨来源的问题）。
- **相对时间**：项目无 dayjs/date-fns，新增 `src/lib/relativeTime.ts`（`Intl.RelativeTimeFormat`，<60s → "just now"，分钟/小时/天，超出回退短日期），配套单测。
- hover 露出动作：`▶ Re-run`（= 现有 `onSelectHistoryQuery`，即 openHistoryQuery 旅程）与 `⧉ Copy`；行点击语义不变。
- 条数 3 → 5（参考稿密度），"View all" 打开 `GlobalQueryHistoryDialog` 不变。
- 空态保留现有 Clock 空态文案。

### 3.4 MCP promo bar

压缩为单行横向 bar（参考稿 `.mcp`）：图标 + 标题/一句话描述 + `code` 命令 + Copy 按钮。复用现有 `formatMcpCliCommand` / `useAppExecutablePath` / copied 态逻辑，仅降布局高度。

### 3.5 Shortcut footer

- 从 `src/lib/keymap.ts` 经 `getActionShortcut(action, keymapPreset, customKeymat)` 动态取键位（与 `ContentView` 现行做法一致，**禁止硬编码 ⌘ 符号**，需处理 Mod→⌘/Ctrl 平台差异），渲染 2–4 个高频动作：`newQuery`、`openQueryHistory`、`newConnection`（以 keymap 实际注册为准）。
- keymap 未注册的动作不渲染（软降级，不做死绑定）。

---

## 4. 状态矩阵（行为不变项显式声明）

| 条件 | 渲染 | 变化 |
| --- | --- | --- |
| `!hasConnections` | State 1 空态（居中 CTA） | **不动** |
| `!connectionContext && isConnecting` | State 2 连接中（DbTypeBadge + spinner） | **不动** |
| `!connectionContext` | State 3 本次重构的落地页 | 重排 |
| `connectionContext` | State 4 已连接主页 | **不动**（后续可复用本次拆分的子组件） |

---

## 5. 数据与依赖：零后端变更

全部数据已在 store/props 中：`connectionStore.connections/groups`、`activeConnectionStore`（状态）、`queryCommands.getQueryHistory`、`ConnectionConfig.group/lastConnectedAt/pinned`。**不新增 IPC、不改 Rust。**

---

## 6. 组件拆分（执行 800 行规范）

```text
src/windows/connection/home/
├── ConnectionWorkspaceHome.tsx   # 状态路由 + 组装（从原文件迁移，对外导出路径不变）
├── HomeHero.tsx                  # 动态摘要 hero
├── ConnectionCardList.tsx        # 搜索 + 卡片列表 + 空态 + Show all
├── RecentQueriesList.tsx         # 历史行（含 hover 动作）
├── McpPromoBar.tsx               # MCP promo bar
└── ShortcutFooter.tsx            # keymap 驱动的快捷键提示
src/lib/relativeTime.ts           # 相对时间工具（+ __tests__）
```

原 `src/windows/connection/ConnectionWorkspaceHome.tsx` 保留为 re-export 或直接迁移（同步更新 `ContentView.tsx` import 与 `__tests__/ConnectionWorkspaceHome.test.tsx` 的 import 路径）；State 1/2/4 分支随文件迁移，逻辑不改。

---

## 7. i18n（开发期仅改 `en/connection.ts` 与 `zh-CN/connection.ts`）

新增（命名空间沿用 `connWin.home.*`）：

```text
connWin.home.hero.subtitle          # "{count} connections saved · {groups} groups · {types} types"
connWin.home.connections.filter     # "Filter connections…"
connWin.home.connections.showAll    # "Show all ({count})"
connWin.home.connections.showLess
connWin.home.connections.noMatch    # "No connections match \"{query}\""
connWin.home.connections.connect    # "Connect"
connWin.home.connections.open       # "Open"
connWin.home.queries.justNow / minutesAgo / hoursAgo / daysAgo
connWin.home.queries.rerun          # "Re-run"
connWin.home.footer.newQuery / footer.history / footer.newConnection
```

废弃（从 en/zh-CN 删除，发布前跑 `node scripts/i18n-sync-check.mjs` 全量同步）：
`connWin.home.metrics.*`、`connWin.home.commonOps`、`connWin.home.selectConnectionTip`（tip 文案并入连接列表空态或 hero）；`quickStart` → 改名 `yourConnections`。

---

## 8. 测试与影响面

- **单元**（`npx vitest run`）：
  - 更新 `__tests__/ConnectionWorkspaceHome.test.tsx`：删除指标卡断言；新增 hero 动态摘要、过滤、Show all 展开、Connected→Open 按钮态、relativeTime。
  - 新增 `src/lib/relativeTime.test.ts`。
- **E2E**：`e2e/specs/connection-empty-state.ts`、`homepage-features.ts`、`journeys/welcome-query-journey.ts`、`connection-browse-journey.ts`、`unified-tab-bar.ts`、`e2e/contract/open-fixture.ts` 引用了 `connection-workspace-home` / `empty-new-query-button` / `view-all-history-button` 等 testid。策略：**保留全部现役 testid**（`connection-workspace-home`、`new-connection-button`、`import-connections-button`、`view-all-history-button`），仅删除随 Common Ops 移除的 `empty-backup-button` / `empty-restore-button` 并同步修改 `connection-empty-state.ts`；新增卡片级 `data-testid={`home-conn-card-${id}`}` 与 `home-conn-connect-${id}`。
- **手工**：`pnpm tauri:dev` 验证四态矩阵 + 明暗主题 + 过滤/展开交互；核对 hover-only 动作在纯键盘下可达（参考 AGENTS.md 交互三要素）。

## 9. 实施顺序

1. 拆文件（纯移动，测试先绿）→ 2. Hero + 删指标卡 → 3. ConnectionCardList（含搜索/Show all/显式按钮）→ 4. RecentQueriesList + relativeTime → 5. MCP bar + ShortcutFooter → 6. i18n 清理 + i18n-sync-check → 7. E2E 修正 + 手工验收。

## 10. 非目标

- 左侧 Navigator 树与参考稿 rail/panel 的对齐（后续独立方案）。
- State 4（已连接主页）复用新子组件的美化。
- `WelcomePage`（零连接首启页）改版——与本页语义不同，另行评审。
