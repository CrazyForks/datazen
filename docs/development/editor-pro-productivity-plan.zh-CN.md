# Editor Pro 生产力套件：TablePlus 对标分析与优化方案

> 范围：Code Folding / Multi-cursor / Split Pane / Query History / Favorite
> 交付：分析与方案，**不含实现**
> 载体：`feature/editor-productivity`（宿主 worktree `.worktrees/datazen-editor-productivity`）
> 　　　`feature/productivity-suite`（Pro worktree，嵌套于上者 `packages/pro-extensions/sql-editor-pro`）
> 状态：2026-08-18 审计快照，基线 commit 宿主 `2e93dceb1` / Pro `86c6577` (v0.2.2)

---

## 0. 结论速览

一句话：**四项里有三项是"补齐基线"，只有 Split Pane 是真正的结构性重建；而四项全部被同一组扩展点地基问题卡住，必须先解地基。**

| 维度 | 现状判定 | 相对 TablePlus | 主要工作量落点 |
| --- | --- | --- | --- |
| Code Folding | **完全没有**，但语法树已自带折叠数据 | ≈ 打平 / 可超越 | Pro（宿主给槽位） |
| Multi-cursor | **默认快捷键已可用**，但有一处死代码缺陷 | ≈ 打平，跨平台胜出 | 宿主（修 bug） |
| Split Pane | **完全没有**，且被 1:1 状态模型阻断 | 落后最大 | 宿主（重建布局） |
| Query History | **已完整存在**，含搜索/分组/scope | 部分超越 | 宿主（补动作面） |
| Favorite | **存在但极简**，无重命名/无文件夹/无关键字 | 落后明显 | 宿主（**改文件存储**）+ Pro（关键字） |

五个必须先做的地基动作（详见 §4）：

1. `globalThis.__DATAZEN_HOST__` 补 `@codemirror/language` / `@codemirror/commands` —— 否则 Pro 侧折叠与多光标根本无法编译。
2. EP 契约新增**通用** `createExtraExtensions` / `createExtraKeymap` / `createEditorPanelSlot` 三个钩子 —— 现有 6 个 Compartment 是闭集，Pro 无法新增能力。
3. 把 Pro 设置键接进 `SqlEditor.tsx` 的 `useMemo` 依赖数组 —— **目前编辑器只读 5 个硬编码键，其余设置"能存能渲染但零效果"**。
4. `useResizable` 升级为递归/比例化模型 + per-tab 命名空间。
5. `panelStore` 引入 `paneId` 层级，打破 `Map<panelId, QueryExecState>` 的 1:1 假设。

**⚠ 同日修订**：裁决 4 由「历史 + 收藏均保持 SQLite」改为「**历史保持 SQLite（不上云）／收藏改文件优先存储**」——
因为真·多端同步要求同步单元**可读、可 diff、可合并**，SQLite 二进制 blob 三条全不满足。
连带收益：文件夹从「数据建模问题」降级为「文件系统原生能力」，原估的 schema v5 三列（`kind`/`parent_id`/`position`）+ 迁移回填 + 排序接口 + 层级不变量维护**全部作废**，拖拽直接是 `fs::rename`。
详见 **§2.6**。

---

## 1. TablePlus 能力基线（来源：docs.tableplus.com 官方文档）

> 采集方式：TablePlus GitBook 提供 `llms.txt` 索引，且 `https://docs.tableplus.com/<page>.md` 直接返回干净 Markdown（HTML 页为 JS 渲染，抓取只会得到导航骨架）。

| 能力 | TablePlus 官方记录 | 备注 |
| --- | --- | --- |
| **Multiple Carets** | `⌘+Click` 加光标；`⌃+⇧+↑/↓` 上/下加光标；`⌘+D` 选下一个；`⌘+⌃+G` 选全部同类；`Esc` 退出 | **仅 macOS** |
| **Split Panes** | 右键 `Split pane horizontally`，`⌘+⇧+D`；可拆成多个**彼此独立工作**的编辑器 | **仅水平**，无垂直 |
| **Query History** | 左侧栏 History 页签；双击插入；右键：Copy / Run（开新标签）/ Open in new tab / Insert to SQL Editor / Delete / Clear all history / Add to favorite / Show in Finder | **落盘为真实 `.sql` 文件** |
| **Query Favorite** | 文件夹分组（New > File / Folder）、拖拽入夹、重命名、删除、**per-favorite keyword 绑定**（编辑器内输入 keyword + Enter 插入）、Run / Copy / Open in new tab / Insert to SQL Editor、`⌘+S` 保存、**双击行为可配**（插入 vs 运行）、Auto-save 开关 | 左栏独立 Favorite 区 |
| **Split Results into Tabs** | 上限 100，默认开启，编辑器配置按钮可切换 | DataZen 已有等价物且语义更强（见 §2.4） |
| **Code Folding** | **官方文档中完全未记录** | 缺席 ≠ 不存在；但确实无公开承诺 |
| 其他 | 左栏模糊搜索、Recent 区、Pin to top；SQL Editor 偏好：编辑时自动保存、自动大写关键字 | DataZen 已有关键词自动大写（硬编码） |

**关键判读**：TablePlus 的差异化护城河是「**文件化 + 分组 + 关键字**」——历史与收藏都是磁盘上的真实 `.sql` 文件（所以有 Show in Finder、可被 Finder/编辑器打开）。它**没有**在折叠上发力，也**没有**垂直分屏和框选。DataZen 若在这两处做出能力，属于超越而非追赶。

---

## 2. 逐项差距分析

### 2.1 Code Folding

#### 现状（宿主）
- 全仓零折叠：`foldGutter` / `codeFolding` / `foldService` / `foldKeymap` **全部 0 命中**；`src/components/sql-editor/` 内所有 `fold` 字样都是标识符大小写折叠（`foldUnquotedIdentifier` 等）。
- 唯一 gutter 是 `lineNumbers()`（`editorExtensions.ts:258`），无任何折叠视觉可供性。
- 连 `bracketMatching()` / `indentOnInput()` 都没装。

#### 已被浪费的资源
- `@codemirror/lang-sql` **已注册 `foldNodeProp`**，宿主又已经装了 `sql()`（`editorExtensions.ts:313-319`），所以语法树里**已经躺着折叠区间**：
  - `Statement` → `{from: min(tree.from+100, 首行行尾), to: tree.to}`
  - `BlockComment` → `{from: tree.from+2, to: tree.to-2}`
  装上 `codeFolding()` + `foldGutter()` 即可白得语句级折叠。
- 宿主自有扫描器 `semantic/scanner.ts` 已在每个 token 上算 `parenDepth`，`SqlScope`（`subquery` / `cte` 范围）每次光标变动都重建（`editorExtensions.ts:775-807`），`scopeModel` 甚至会把括号不配平报成 diagnostic（`scopeModel.ts:72-78`）。**子查询折叠的数据已经算好了，只是没人用。**

#### 差距与机会
| 项 | TablePlus | DataZen 现状 | 方案 |
| --- | --- | --- | --- |
| 语句级折叠 | 无文档 | 无 | P1 装基础能力（`Statement` + 块注释） |
| 子查询 / CTE 折叠 | 无文档 | 无，但 `SqlScope` 已有 range | P1 SQL 语义 `foldService`，**超越点** |
| `BEGIN…END` / `CASE…END` | 无文档 | 无 | P1 基于 token 流与缩进层级推导 |
| 折叠 gutter 与视觉 | — | 主题里无 `.cm-foldGutter` / `.cm-foldPlaceholder` 样式 | P1 宿主补主题 token（Pro 无法改 `themeCompartment`） |
| 折叠快捷键 | — | 无 | P1 `foldKeymap`（`Mod-Alt-[` / `Mod-Alt-]` / `Mod-Alt-0`） |
| 折叠状态持久化 | — | 无 | P1 按 docIdentity 记忆展开集合 |

#### 硬阻断
Pro 侧要做折叠，必须 import `@codemirror/language`（`codeFolding` / `foldGutter` / `foldService` / `foldNodeProp` 全在此包）。当前：
- 宿主 `__DATAZEN_HOST__`（`src/main.tsx:45-56`）**未暴露** `@codemirror/language`；
- Pro `package.json` peerDeps 也**没有** `@codemirror/language`。

由于 Pro bundle 的裸导入会被重写成 `globalThis.__DATAZEN_HOST__[...]`（`vite.config.ts:20-88` + `pack-ep.mjs`），缺失即构建期或运行期失败。**这是 P0。**

#### 隐藏风险：跨 realm 模块身份
若重写规则漏掉某个 specifier，Pro 会拿到**自己的** `Compartment` / `StateField` 身份空间和**自己的** React 副本（→ "invalid hook call"）乃至**自己的** registry（→ `register()` 写进宿主读不到的注册表，EP 静默停留在 community fallback，**不报错**）。`@codemirror/language` 是新增共享模块，这条风险第一次真正被触发，必须配一条"共享身份"自检测试。

---

### 2.2 Multi-cursor

#### 现状（宿主）——比预期好得多
| 能力 | 状态 | 证据 |
| --- | --- | --- |
| `allowMultipleSelections` | ✅ 显式开启 | `paste/multipleSelections.ts:26` |
| `Mod-d` 选下一个 | ✅ | 原始 DOM keydown `multipleSelections.ts:37-54` |
| `Mod-Shift-l` 选全部同类 | ✅ | 继承 `searchKeymap`（`editorExtensions.ts:289`） |
| `Mod-Alt-↑/↓` 上/下加光标 | ✅ | 继承 `defaultKeymap` |
| `Esc` 归一 | ✅ | `Escape → simplifySelection` |
| Alt+Click 加光标 | ✅ | `clickAddsSelectionRange`（`:36`） |
| **Alt+拖拽框选** | ✅ | `rectangularSelection`（`:27-35`）——**TablePlus 未记录，超越点** |
| `Shift-Alt-↑/↓` 加光标 | ❌ **死代码** | 被 `defaultKeymap` 的 `copyLineUp/Down` 抢占 |
| 跨平台 | ✅ `Mod` 映射 | TablePlus 该能力**仅 macOS**，DataZen 三平台等价 |

**`Shift-Alt-ArrowUp/Down` 是真 bug**：`multipleSelections.ts:88-97` 声明了 `addCursorAbove/Below`，但 `createBaseEditorExtensions` 在 `:289` 先注册了 `defaultKeymap`（含 `Shift-Alt-ArrowUp → copyLineUp`），而 `runHandlers` 首个返回 `true` 的绑定即胜出，`copyLineUp` 恒为 `true` ⇒ 该绑定**永远执行复制行**。无任何测试覆盖（E2E 只测了 `Mod+D` / `Alt+Click` / `Alt+拖拽`），所以一直没暴露。

> 修复成本：把多光标扩展用 `Prec.highest` 包裹，或整体前移注册。约 1 行。

#### 真正影响体验的差距（比快捷键更值钱）
1. **执行目标不跟随多光标**。`Mod-Enter` 只看 `selection.main`（`editorExtensions.ts:267-270`），多光标全为空时执行整篇。`getSelection()` / `getCursorOffset()` / 格式化 / 右键取词全部 `.main` 单点语义。⇒ 多光标是"编辑特性"而非"执行特性"。
2. **statement frame 与 gutter 只认主光标**。Pro `statementFrame.ts:78,90` 直接读 `state.selection.main`。
3. **gutter 点击会塌缩多选**。
4. **无光标计数 UI**——用户不知道自己有几个光标。
5. **7 处会塌缩多选的 dispatch**：`insertAt` / `rawInsert` / `toggleLineComment` / `insertSnippet` / `formatEditorDocument` / 外部 `value` 同步（`SqlEditor.tsx:555-558` 全量替换 → 所有光标被映射到边界）。从 schema 树拖列、点菜单格式化会静默打掉多选。
6. **营销与实现不符**：`docs/blogs/editor-pro-features.md` 声称"44 项功能"，其中第 9 项「多光标编辑：支持 Ctrl+D 选中下一个相同文本，Alt+Click 添加多个光标」**没有专属实现**，完全靠默认 keymap 兜底。这条要么补实现、要么改文案。

#### 定位
Multi-cursor **不应做成 Pro 特性**。它是编辑器基础能力，散在宿主的六个 Compartment 里且优先级垫底，Pro 只能在 `paste` 舱位"加东西"而无法"移除/重排"宿主绑定。留在宿主修。

---

### 2.3 Split Pane

#### 现状（宿主）
- 布局树（`QueryPanel.tsx:610-788`）是**硬编码 JSX**：`[编辑器列(纵向 flex) | 右侧 w-64 固定 dock]`，编辑器列内部是 `[编辑器 | 拖拽条 | 结果面板]`。
- 编辑器↔结果只有**两档**：`queryResultPaneSizing()`（`queryResultPaneHeight.ts:100-109`）在"自动按内容"（`maxHeight:'50%'`）与"手动钉住 px"之间二选一，**不是 N Pane**。
- `useResizable`（`src/hooks/useResizable.ts`，124 行）是**通用且健壮**的分隔条原语，已被 6 处复用：pointer capture、拖拽起始读实测尺寸（`getStartSize`，正是为了对抗自动尺寸的陈旧值，`:166-168` 注释）、pointerup 持久化到 `localStorage['resize:'+key]`。**质量很好，缺的是"递归 + 比例 + 命名空间"。**
- 右侧 History/Favorites dock 硬编码 `w-64 shrink-0`，**没有分隔条**。

#### 五个阻断（按严重度）
1. **`Map<panelId, QueryExecState>` 严格 1:1**（`panelStore.ts:76`）。两个编辑器在同 tab 内**每次击键互相覆盖文本**。这是最硬的一条。
2. **`useBindParameters(exec.sql)` 每个 QueryPanel 只调一次**（`QueryPanel.tsx:109`），返回一整套 param 状态。Pro 侧 Pro 扩展会因此拿到"多实例同 store"。
3. **`metadataCache` 是进程级单例**，按 `dbSessionId` 而非按编辑器分片（`metadataCache.ts:436`，注释自陈）。同 tab 两个 pane 共用一个 session ⇒ 缓存 owner 冲突。
4. **无 `focusedPaneId` 路由**。每个 `SqlEditor` 都装全套 keymap（`SqlEditor.tsx:353`），单编辑器时 `onExecute` 语义无歧义，多编辑器时必须有焦点 pane 才能决定执行目标。
5. **无分屏数据模型与持久化**。`panelStore` **完全没有 `persist`**——关 tab 即销毁 SQL 与结果集，无脏标记、无会话恢复（`cancelAndCleanupExec` 直接 `nextExec.delete(panel.id)`）。

> 第 5 条是**跨功能的地雷**：Split Pane 会放大"关 tab 就丢 SQL"的损失，Favorite 也因为标签页不持久而只能是"连接级持久对象"。

#### 机会
- TablePlus **只做水平分屏**且**不做框选**，DataZen 可做 水平+垂直+N-Pane ⇒ 超越点。
- `SqlEditor` 本身是 `forwardRef` 受控组件、根节点 `h-full w-full overflow-hidden`、`EditorView` 建于 mount effect 且**所有 ref 都是 per-instance**（含最可疑的 `modelRef`）⇒ **多实例本身是安全的**，真正的风险全在 store 侧的 1:1 假设和单例缓存。
- `executionStateField` / `documentVersionField` 是 `StateField.define` 规格（单规格、多 state 值）⇒ 跨 N 个 `EditorState` 安全。
- `useResizable` 已有 6 处复用与 pointer capture 经验，不必重写。

#### EP 侧的硬墙
`SqlEditorEnhancedEP` **没有任何布局/面板贡献契约**。现有的 `queryBuilder` 是一次性的、硬编码的、8 方法生命周期的**整列替换**，不是可组合槽位系统。`reconfigureProCompartments` 的 payload 也是**固定的六键字面量**且**零生产调用点**。⇒ **Split Pane 必须落在宿主。**

---

### 2.4 Query History

#### 现状（宿主）——**不是绿地建设**
- Rust：`store/history_db.rs` 拥有**明文** SQLite `{appData}/history.sqlite`（`MAX_QUERY_HISTORY = 1000`），两张表 `query_history` / `favorite_queries`，schema 版本 v4，插入即 trim，**同 `(connection_id, database, schema)` 的相同 SQL 会原地 UPDATE 顶到顶部**（去重做得很扎实）。
- IPC：5 个 history + 4 个 favorite Tauri 命令，全部注册于 `bootstrap/run.rs:314-324`。
- UI：右侧 dock `QuerySidebarSection.tsx`（480 行），**已经具备**搜索框、`current/all` scope 双态按钮、按 database 分组（sticky 标题 `db (n)`）、每条的 成功/失败 状态点、耗时、行数、时间。
- 全局对话框 `GlobalQueryHistoryDialog.tsx` 具备 文本搜索 + 连接筛选 + 状态筛选 + 复制 + 在连接中打开 + 两段式清空确认。

⇒ **数据模型与基础 UI 已达到甚至超过 TablePlus**（TablePlus 的历史是线性列表，没有按库分组、没有状态/耗时/行数）。

#### 差距
| TablePlus 有 | DataZen 现状 | 差距性质 |
| --- | --- | --- |
| 双击插入 | 单击 `updateSql` 到当前 tab | 交互偏好，可加双击 |
| Delete（单条） | ❌ 无（`querySidebarContextMenu.ts:84` 注释自陈"不支持"） | **缺** |
| Run（新标签） | ❌ 无 | **缺** |
| Open in new tab | ❌ 无（收藏有、历史上没有 ⇒ 不对称） | **缺**，低垂果实 |
| Add to favorite | ❌ 无（须重新输入 SQL） | **缺** |
| Clear all history | ✅ 有，但**是全局清空**却显示在单连接面板里 | ⚠ **数据丢失风险** |
| Show in Finder | ❌ 无（历史不落盘为文件） | 架构差异，见下 |
| — | 大结果集上限（TablePlus 结果标签上限 100） | ❌ 无 |
| — | 执行来源（editor/workflow/dashboard） | ❌ 无（但 `schema` 列写死 `None`，是死列） |

#### "落盘为文件"要不要跟？
TablePlus 把历史/收藏存成真实 `.sql` 文件（所以有 Show in Finder）。DataZen 存 SQLite。
- **跟**：可获得"外部可访问、可被其他工具消费"的高级感；代价是引入文件锁/清理/加密问题（当前 `history.sqlite` 是**明文**，SQL 与错误信息裸存——任何导出/同步功能都必须先处理这个已记录在案的风险）。
- **不跟（✅ 已裁决，见 §6 裁决 4）**：**保持 SQLite 作为唯一存储形态**，只加一个"导出为 `.sql` / 在文件管理器中显示目录"的壳，成本极低且不引入文件系统耦合（文件锁、清理、与 `panelStore` 无持久化叠加的丢失面）。落地见 P3-4。

---

### 2.5 Favorite

#### 现状（宿主）——存在但极简
- `FavoriteQuery { id, connectionId, title, sql, createdAt }`。**没有** `updatedAt`、`database`/`schema`、keyword、folder、description、使用次数。
- 后端 CRUD 齐全但**只有增删查，没有改**：`add_favorite_query` 是裸 `INSERT`，无 upsert、无 `ON CONFLICT` ⇒ **重复保存同一 SQL 会产生重复行**。
- UI：右侧 dock 一个扁平列表，行内 `title` + `sql` 预览，hover 出现删除；单击 = 开新标签。**无搜索框、无筛选、无重命名、无拖拽、无文件夹。**
- 面板永远只显示当前连接的收藏（`loadFavorites(connectionId)` 恒传具体 id），尽管后端支持 `getFavoriteQueries(undefined)`。
- 收藏与历史**无关联**（两张表不相交，没有 `history_id`），所以"给历史条目加星"必须重新输入 SQL。

#### 与 TablePlus 的差距（Favorite 是四项里差距最可感知的）
| TablePlus 能力 | DataZen | 成本 |
| --- | --- | --- |
| **文件夹分组 + 拖拽** | ❌ | 中（需 schema v5 + 树形 UI + 拖拽） |
| **per-favorite keyword 绑定**（输入 keyword + Enter 插入） | ❌ | **低**（见下） |
| 重命名 / 编辑 | ❌ 无 UPDATE API | 低（一条命令） |
| 全连接收藏视图 | ❌ UI 层没暴露 | 极低 |
| 搜索框 | ❌ | 极低 |
| `⌘+S` 保存 / Auto-save | ❌ 无快捷键 / 无自动保存 | 低 |
| 双击行为可配（插入 vs 运行） | ❌ | 低 |
| 去重（收藏同一 SQL 不产生重复） | ❌ | 低（唯一索引） |

#### keyword 绑定的落点已经现成
宿主已有 `createSnippetCompletionSource({ snippets })`（`snippets/snippetCompletionSource.ts:49`），**已支持外部传入自定义 snippet 库**，且遵循"软排序优先于硬过滤"（`BOOST_STATEMENT_CONTEXT=5` / `BOOST_IDENTIFIER_CONTEXT=-6`），唯一硬排除是 `alias.` 点号位置。
⇒ 收藏→keyword 映射可以直接喂进这个源。**这是 TablePlus 最有辨识度的能力，而我们的落点成本极低。**

> 注意概念区分：内置 snippet（`BUILTIN_SQL_SNIPPETS`，7 条 `Object.freeze` 模板）≠ 用户 SQL 收藏 ≠ 执行历史。三者不要混模。
> 但 `settings.sqlSnippets`（用户自建模板，落 `AppSettings.driverSettings` 加密通道）已证明"用户自撰 SQL 制品存 settings"是条可行先例。

#### 文件夹 + 拖拽：功能详解与设计裁决
> 2026-08-18 裁决：**做**，锁死一层，与 keyword 绑定同批交付。
> **数据层已于同日修订**：收藏改文件优先存储，本节的数据模型随之改为"目录即文件夹"（原 SQLite 自引用邻接表方案作废，见 §2.6）。

**它是什么。** 把收藏从一维列表升级成文件管理器式的两层组织：
- 顶层是收藏文件（一条 SQL）
- 可建**文件夹**把收藏归类
- **拖拽**把文件拖进 / 拖出 / 跨文件夹移动
- 右键 `New > File / Folder`（TablePlus 另有 `Add Folder to Favorites`）

**为什么有辨识度。** TablePlus 的收藏体系建立在"收藏 = 磁盘上真实的 `.sql` 文件"之上，所以文件夹、拖拽、Show in Finder 是同一套心智模型的自然延伸，而非额外装饰。
我们采纳同一心智模型（见 §2.6），因此这里的"文件夹"**就是真实目录**，"拖拽"**就是 `fs::rename`**。

**锁死一层的理由。** TablePlus 实际也只做一层（Folder 里只有 File，无子文件夹）。若支持无限层，拖拽需处理缩进、展开态、拖入子树、循环引用（拖到自身/拖到子孙），交互复杂度远超收益。**先用 20% 复杂度拿 80% 价值。**

**这是文件方案相对 SQLite 方案最大的单点收益** —— 原本需要建模与维护的东西直接消失：

| 能力 | SQLite 方案（已作废） | 文件方案 |
| --- | --- | --- |
| 表达文件夹 | `kind` / `parent_id` / `position` 三列 + 首次迁移回填 | **目录即文件夹，零建模** |
| 拖拽移动 | `UPDATE parent_id` + 重排 `position` | **`fs::rename`** —— 原子、无中间态、跨设备安全 |
| 删文件夹 | 应用层遍历子树 + 事务 | `remove_dir_all`（先入 `.trash/` 兜底） |
| 层级不变量 | 应用层要防环、防越权、防孤儿 | **文件系统天然保证** |
| 同级排序 | 批量重排接口 | 目录内排序，或可选 `.order` 文件 |

**Rust 侧命令增量**（改为面向文件系统，无 schema 迁移）：
- `add_favorite_folder(parentSlug, title) -> slug`
- `rename_favorite(id, { title?, slug? })` ← 覆盖重命名
- `move_favorite(id, targetDir, position)` ← 拖拽 = 底层 rename
- `delete_favorite(id)` → **移入 `.trash/` 而非真删**（回收站）
- 列表：`list_favorites()` 递归扫目录 + 解析 front-matter

**前端落地。**
- `QuerySidebarSection.tsx:319-355` 收藏面板由扁平 `map` 改两段式：先渲顶层（`parent_id IS NULL`），文件夹渲染为可展开分组。展开集用组件内 `useState`，**第一版不落盘**。
- **拖拽有现成先例可抄**：`schema-tree/schemaTreeDrag.ts`（102 行，**版本化拖拽载荷 + 自定义 MIME + 显式前向兼容约定**）、`NavigatorTreeRow.tsx`（733 行，树行交互）。约定：载荷走 `dataTransfer` 自定义 MIME（如 `application/datazen-favorite-item`），**绝不劫持 `text/plain`**（否则往编辑器里拖会乱插文本）；一切可点击/可拖目标带 `data-*`（AGENTS.md 硬性要求，E2E 不依赖几何坐标）。
- 落点判定三区：行**上 25%** = 插到前面 / 行**中 50%** = 放入（仅当目标为文件夹）/ 行**下 25%** = 插到后面。阈值必须提为常量并有单测。
- 右键菜单 `buildFavoriteSidebarContextMenuItems`（`querySidebarContextMenu.ts:70-80`，现为 4 项扁平数组）按节点类型（文件 / 文件夹）分支出不同项集；面板头部加 `+` 入口（New > File / Folder）。

**交互上必须提前定的 5 条规则**（这些是真正的成本所在，不能边写边定）：
1. **删文件夹时里面的文件去哪？** 文件方案天然支持两种：真删（`remove_dir_all`）或整个移入 `.trash/`。**建议移入 `.trash/`**（回收站）—— 因为 `panelStore` 无持久化、关 tab 即丢 SQL，**收藏往往是用户手上 SQL 的唯一副本**。UI 上仍要**显示受影响条数**（"该文件夹含 N 条收藏"）。
2. **拖出文件夹** = 移回收藏根目录，需要一块可见的"未分类"落区。
3. **同连接隔离**：`connectionId` 写在 front-matter 里，是所有权根。**文件夹跟随连接**（与收藏同域）；"全连接"视图下按连接分组显示，否则语义混乱。⚠ 这与"文件夹是真实目录"存在张力：目录是全局的、但视图按连接过滤 ⇒ **同一个目录可以同时容纳多个连接的收藏**，面板按 `connectionId` 过滤渲染即可，物理目录不做连接隔离。
4. **keyword 只挂在文件上**，不引入文件夹级 keyword（否则衍生出"输入某个词展开整个文件夹"另一套东西）。
5. **搜索必须跨层级展平**：命中任意深度（忽略展开态），否则用户搜不到折叠起来的收藏。

**成本与收益。** 收益上，这是 TablePlus 收藏区**唯一我们完全没有、且用户立刻能感知**的组织能力 —— 没有它，收藏就只是一个越来越长的列表。
成本上，文件方案让本项**比原 v5 估算更省**（无 schema 迁移、无排序接口、无层级不变量维护），真正的成本集中在上面的 5 条交互规则与拖拽落点判定的边界测试。
**排序：与 keyword 绑定同批交付** —— "怎么用"（keyword）与"怎么管"（文件夹）缺一个则价值减半，且两者共用同一套 front-matter 字段与同一个文件存储层。

---

## 2.6 收藏的文件优先存储与云同步

> 2026-08-18 裁决 4 修订。原始裁决（历史 + 收藏均保持 SQLite）是在"只要导出壳、不要真同步"的前提下做出的；一旦要求真·多端同步，**收藏必须改为文件优先存储**。

### 2.6.1 重新表述问题

准确的问题不是"文件 vs SQLite"，而是：**跨设备交换的单元必须同时满足三件事 —— 可读、可 diff、可合并。** SQLite 三条全不满足（二进制 blob，所有云服务只能整文件后写覆盖）。但 SQLite 作为**本地存储**完全合格。**错配在于把"本地存储文件"直接当成了"同步单元"。**

| | SQLite 当同步单元 | 目录树当同步单元 |
| --- | --- | --- |
| iCloud / Dropbox / Google Drive 桌面同步 | ❌ 整文件 LWW + WAL 附属文件冲突 → 库损坏 | ✅ 目录放进同步文件夹，**零代码** |
| Git | ❌ 二进制，每加一条收藏就全库一次提交，冲突 = 数据丢失 | ✅ 文本 diff，SQL 行导向，merge 语义基本可判 |
| WebDAV / 坚果云 / Nextcloud / NAS | ❌ 仍需自研 adapter，且 merge 依旧做不了 | ✅ 目录天然映射 |
| 在 GitHub 网页加一条收藏再同步回来 | ❌ 不可能 | ✅ 新建一个 `.sql` 文件即可 |
| 冲突可读性 | 无法回答"哪个版本对" | 文本 diff，人能判断 |
| 「Show in Finder」 | ❌ 只能是假动作 | ✅ 字面成立 |

### 2.6.2 存储布局

```
{favoritesRoot}/
  orders/
    01J8XK2M9Q7B4F.sql      <- ULID 文件名：短、时序可排序、改名不换 id
  adhoc/
    01J8XK4T7B2C9D.sql
  .trash/
    2026-08-18T10-00-00__01J8XK2M9Q7B4F.sql
```

每个文件**自描述**（front-matter 用 `--` 注释行，与 SQL 注释语法天然同构，不破坏文件可执行性）：
```sql
-- title: 每晚订单对账
-- keyword: recon
-- connectionId: 7f3a...
-- database: analytics
-- createdAt: 2026-08-18T10:00:00Z
-- updatedAt: 2026-08-18T10:00:00Z
SELECT ...
```

**文件名用 ULID 而非 slug**，两个理由：① 标题变更不应改文件名（`fs::rename` 在同步环境下并非绝对安全）；② slug 需要处理非法字符 / Windows 保留名（`CON`/`PRN`/`AUX`/`NUL`）/ 尾随点与空格 / 路径长度，而 ULID 完全绕开。**标题完全住在 front-matter，文件名只承担身份。**

**SQLite 侧只保留 `query_history`；`favorite_queries` 表退役。** 收藏面板打开时递归扫目录、解析 front-matter、内存缓存后按 `connectionId` 过滤。几百条 = 瞬时，**无需持久索引表** —— 也因此不存在"索引与文件不一致"这一整类 bug。
若未来量级到数千条仍不够，再引入索引表，且索引必须设计成**可丢弃、可从目录完全重建**，绝不能反向成为权威。

### 2.6.3 可配置根目录（依赖已验证就位）

`AppSettings` 当前**没有**任何可配置路径字段（`sqlSnippets` / `sqlFormatOptions` 都是内联配置），但所需依赖均已就位：

| 前置 | 状态 | 证据 |
| --- | --- | --- |
| Tauri 目录选择器 | ✅ **已注册**，零新增依赖 | `bootstrap/run.rs:88` `.plugin(tauri_plugin_dialog::init())`；`commands/dialog.rs:25` |
| 路径解析统一入口 | ✅ 已有 | `store/mod.rs:96` `Store::default_app_data_dir()`（对应 Tauri `app_data_dir()`） |
| 存储构造单点 | ✅ 已有 | `store/mod.rs:124` `HistoryDb::open(data_dir)` —— 新 FavoritesStore 在此并列挂载 |
| Rust 文件 I/O | ✅ 用 `std::fs` | 无 `tauri-plugin-fs`，也不需要（JS 侧不碰文件系统） |

新增 `AppSettings.favoritesRoot?: string`，默认 `default_app_data_dir()/favorites`。

⚠ **必须写进文档与 UI 提示的重大事实**：`app_data_dir()` 在 macOS 是 `~/Library/Application Support/<bundle-id>`，**不在** `~/Library/Mobile Documents`（iCloud Drive）内；Windows 是 `%APPDATA%`。
⇒ **默认路径不会自动同步。** 用户要么把目录移进同步文件夹，要么在设置里把 `favoritesRoot` 指向同步位置 —— 所以"可配置根目录"不是锦上添花，而是同步功能的**必要前提**。首启动应主动提示一次。

### 2.6.4 同步成本塌方

原设想中"`RemoteStore` trait + GitHub / WebDAV / Google Drive 三个 adapter"**基本可整体废掉**：

| 路径 | 需要我们写多少代码 |
| --- | --- |
| 桌面云盘（iCloud / Dropbox / Google Drive） | **零** —— 用户把目录放进同步文件夹即可 |
| GitHub | 薄封装（`init` / `add` / `commit` / `push` / `pull` 五个命令），或干脆交给用户自己跑 git |
| WebDAV（坚果云 / Nextcloud / NAS） | **一个** adapter，覆盖无桌面客户端的服务商 |
| 在 GitHub 网页编辑收藏 | **白送** —— 写文件 + pull 回来即同步 |

⇒ 上一轮估的"3 个云 adapter"降为"0~1 个"，这是文件方案相对 SQLite 方案**最直接的成本节省**。

### 2.6.5 同步语义（P3 不实现，留待 P4 细化）

- **Pull**：遍历远端目录 → 按 ULID 幂等 upsert。远端缺失 + 本地有 ⇒ **不静默删除，弹冲突让用户裁决**。
- **Push**：本地 `updatedAt` 变更 → 写文件 → 提交。
- **冲突**：同文件双端修改 → 按 `updatedAt` LWW，但**必须显示"本机 3 条 / 远端 2 条 / 冲突 1 条"并让用户选**，绝不能让用户"莫名其妙丢收藏"。
- **凭据**：PAT / OAuth token 走 `ai_config.enc` 同款 AES-256-GCM 通道（`store/ai_config.rs` 已有先例），**禁止明文**。

### 2.6.6 诚实的代价与已识别风险

| 项 | 说明 | 处置 |
| --- | --- | --- |
| **默认路径不同步** | 见 §2.6.3 | 可配置根目录 + 首启提示 |
| **外部改动不即时可见** | 不引入 fs watch 会漏掉外部编辑 | v1：每次打开收藏面板全量重扫 + 同步后重扫 + 手动刷新按钮。GitHub pull 由 App 主动发起故够用。**明确不引入 fs watch**（平台差异与生命周期陷阱多） |
| **路径清洗** | 仅文件夹名需要 | 文件名用 ULID 绕开；文件夹 slug 需处理非法字符、Windows 保留名、尾随点/空格、路径长度 |
| **非原子写** | 崩溃会留半截 `.sql` | temp 文件 + `fs::rename` |
| **加密 vs diff 取舍** | 逐文件加密会**彻底杀死 Git diff** | 默认明文（与 `history.sqlite` 现状一致，不倒退）+ 文档明示 + 建议放在加密磁盘/加密云盘。"加密 + 可 Git"无免费午餐，若用户强需求需单独立项 |
| **暴露面略升** | 收藏文件是可被外部工具消费的产物，用户可能误提交到公开仓库 | 首次同步/导出前显式确认；设置页常驻提示"收藏目录含明文 SQL，提交到仓库前请自查" |
| **首次迁移** | 现有 `favorite_queries` 行 → 写文件 | 一次性迁移 + **保留原库备份** + 失败可回滚 + 幂等标记 |
| **命名冲突** | `store/sync_tasks.rs` 的 "sync" 指的是 **Data Synchronization（同族表数据同步）**，是完全不同的概念 | 新模块禁止用裸 `sync` 命名，一律用 `favorites` / `remote-favorites` |

### 2.6.7 净效果

**总工作量比原 SQLite 方案更小**：砍掉 schema v5 的文件夹建模（3 列 + 迁移回填 + 排序接口 + 层级不变量维护）与 3 个云 adapter，换来更简单的一套存储层与更高的能力上限。
**唯一新增的成本项是"可配置根目录"**，而它是同步功能的必要前提，且依赖已就位、零新增依赖。

---

## 3. 宿主 vs Pro 边界裁决

| 能力 | 裁决 | 理由 |
| --- | --- | --- |
| `__DATAZEN_HOST__` 补 `language` / `commands` | **宿主 P0** | 打包期改写规则依赖它 |
| EP 契约新增通用钩子 | **宿主 P0** | 契约在 `packages/extension-points` |
| Pro 设置键接入 `useMemo` deps | **宿主 P0** | 否则任何开关型 Pro 功能都是死的 |
| Code Folding 本体 | **Pro** | 属"增强"，且 SQL 语义折叠需 Pro 侧 Lezer 能力 |
| 折叠 gutter 主题 token | **宿主** | `themeCompartment` 宿主独占，Pro 无法参与 |
| Multi-cursor 修 bug / 执行跟随多光标 | **宿主** | 能力散在宿主六舱且优先级垫底，Pro 无法重排 |
| Split Pane 全部 | **宿主** | 无任何布局贡献契约，`queryBuilder` 是一次性硬编码整列替换 |
| Split Pane 内的 Pro 增强（如每 pane 独立 linter 预算） | **Pro**（后续） | 需要新钩子落地后 |
| Query History 数据层（保持 SQLite，不上云） | **宿主 Rust** | IPC 与迁移都在宿主 |
| 收藏文件存储层（文件优先，`favorite_queries` 表退役） | **宿主 Rust** | Rust `std::fs`；构造点 `store/mod.rs:124` |
| 可配置收藏根目录 + 首启提示 | **宿主** | 目录选择器已注册（`bootstrap/run.rs:88`），零新增依赖 |
| 云同步 adapter（WebDAV / GitHub） | **宿主**（P4 可选） | 桌面云盘路径**零代码**，无需 adapter |
| History / Favorite 动作面 UI | **宿主** | 面板在宿主，EP 无 React 面板槽 |
| **Favorite → keyword 补全源** | **Pro** | 纯编辑器内行为，且已现成落点 |
| History / Favorite 的 Pro 专属视图 | **需新增面板槽后才可行** | 现在不可行 |

---

## 4. P0 地基（无此则后续全部返工）

### G1. 补齐 Pro 共享运行时模块
- `src/main.tsx:45-56`：`__DATAZEN_HOST__` 增加 `@codemirror/language`、`@codemirror/commands`。
- Pro `package.json` peerDeps 同步补 `@codemirror/language`（**不补会导致两实例的 `@codemirror/language` 身份分裂**）。
- 同步核对 `pack-ep.mjs` 与 Pro `vite.config.ts` 的 externalize 列表。
- **加一条"共享身份"自检**：Pro 激活时断言 `globalThis.__DATAZEN_HOST__['@codemirror/language']` 与其自身 import 同一对象，防止静默降级。

### G2. EP 契约新增三个通用钩子
在 `SqlEditorEnhancedFeatures`（`sqlEditorEnhancedEP.ts:59-104`）新增，遵循既有 fallback 纪律（`fallbackFeatures` 为 `Object.freeze`，每个钩子 null/空返回）：

| 钩子 | 用途 | 解阻的功能 |
| --- | --- | --- |
| `createExtraExtensions?: (opts) => Extension[]` | 进入宿主**新增** `folding` 舱位 | Code Folding |
| `createExtraKeymap?: (opts) => KeyBinding[]` | **高优先级**（`Prec.highest`）插入，不被 `defaultKeymap` 抢占 | Multi-cursor 扩展、折叠快捷键 |
| `createEditorPanelSlot?: (id, ctx) => { render, onDispose }` | 通用 React 面板槽，取代 `queryBuilder` 的一次性硬编码 | History/Favorite 的 Pro 视图（可选） |

同时把 `compartments` 扩为**可扩展映射**（`ProCompartmentPayload` 从六键字面量改为 `Record<string, Extension[]>` 并遍历），并把 `reconfigureProCompartments` 从"仅测试调用"接进生产路径——它已经是现成的**原子批量**重配 API，而生产目前是 6 次非原子 dispatch，中间帧会出现舱位错配。

### G3. 让 Pro 设置真正生效
编辑器目前**只读 5 个硬编码键**：`statementGutter` / `tableHover` / `insertValueHints` / `intentionActions`（`SqlEditor.tsx:125-128`）+ `bindParamPanel`（`QueryEditorSection.tsx:243`）。
`settingsContributions` 里其余任何键（`codeFolding.enabled`、`multiCursor.enabled`、`splitPane.enabled`…）都会**正常落盘、正常渲染、零效果**，因为六个工厂的 `useMemo` 依赖数组里没有它。
⇒ 宿主需提供一条通用路径（如把 Pro 设置 bag 整体作为依赖，或支持 EP 声明"影响哪些舱位"）。
**这是全案最便宜、杠杆最高的一处改动。**

### G4. 契约版本必须同步 bump
`checkEngineCompatibility`（`security.ts:135`）用**精确字符串相等**（`!==`），且 `engines.extensionPointsVersion` 是**必填**。EP 契约一改，必须**同批次**提升 `EXTENSION_POINTS_VERSION` 与宿主版本并重签 Pro 包，否则 Pro 会**静默降级为 community fallback**（只 `console.error`，用户看到"功能消失"而非"版本不兼容"）。**没有 semver range，没有协商窗口。**

### G5. 分屏前置（详见 §5 P2）
- `useResizable` → 支持**递归嵌套**（父子共享同一总量）与**比例存储**，storageKey 按 `connectionId/panelId` 命名空间化。
- `panelStore` 引入 `paneId` 层：`Map<panelId, PaneLayout>`，`QueryExecState` 改为按 pane 键。
- `metadataCache` / `useBindParameters` / `useContextMenuStore` 补 pane 维度。
- 新增 `focusedPaneId`，把 `onExecute` / `onExecuteSelection` / `onExecuteAll` / `formatDocument` / `onSaveQuery` 路由到焦点 pane。
- 顺带引入 `dirty` 标记与会话恢复（否则分屏越多，关 tab 丢得越多）。

---

## 5. 分期实施路线

### P1 — Code Folding + Multi-cursor 收尾（低风险、高感知）

**P1-a 地基**：G1 + G2（`createExtraExtensions` + `createExtraKeymap` + `folding` 舱位）+ G4。

**P1-b 折叠本体（Pro）**
1. `foldGutter()` + `codeFolding()`（走 `@codemirror/language` 默认 `foldService`）→ 立刻白得 `Statement` + `BlockComment` 折叠。
2. 自定义 SQL 语义 `foldService`（Pro 侧）：
   - 子查询 / CTE 折叠 → 直接消费宿主 `SqlScope.range`（`kind: 'subquery' | 'cte'` 已带范围）；
   - `BEGIN…END` / `CASE…END` → 基于 `scanner` 的 token 流与缩进层级；
   - 括号配平异常时降级（复用 `scopeModel` 的 unbalanced diagnostic）。
3. `foldKeymap` + 折叠状态按 `docIdentity` 记忆 + 一个 Pro 设置开关（依赖 G3 才有效）。
4. 宿主补 `.cm-foldGutter` / `.cm-foldPlaceholder` 主题 token。

**P1-c 多光标收尾（宿主）**
1. 修 `Shift-Alt-↑/↓` 被 `copyLineUp/Down` 抢占的死代码（`Prec.highest` 或前移注册）。
2. `Mod-Enter` 改为**按全部光标分组执行**；`.main` 单点读取点（`getSelection` / `getCursorOffset` / 格式化 / 右键取词）逐个复核。
3. 修 7 处会塌缩多选的 dispatch（尤其 `SqlEditor.tsx:555-558` 外部 `value` 同步）。
4. gutter 点击不塌缩多选 + 光标计数指示器。
5. Pro `statementFrame` 改用多光标感知。
6. 测试：补 `Shift-Alt-↑/↓` 单测（当前零覆盖，是 bug 长期存活的直接原因）；补"多选在 insertAt/格式化/外部同步后仍存活"的 journey 测试。

**出口判据**：`docs/blogs/editor-pro-features.md` 的"44 项"逐条对账，要么补实现要么改文案。

### P2 — Split Pane（最大工程量，全部在宿主）

阶段化，避免一次性大爆炸：
1. **P2-1 布局原语**：`useResizable` 递归 + 比例 + 命名空间；`QuerySidebarSection` 的 `w-64` 换成可拖拽。
2. **P2-2 状态分层**：`panelId → paneId`；`QueryExecState` 按 pane 键；`metadataCache` / `useBindParameters` / `useContextMenuStore` 补 pane 维度。**先做这一层再动 UI**，否则 UI 一上去就撞 1:1。
3. **P2-3 水平双 pane**：`⌘+⇧+D` / 右键菜单（对齐 TablePlus），`focusedPaneId` 路由执行与格式化。
4. **P2-4 垂直与 N-Pane**：**TablePlus 无垂直、无 N-Pane，此处是超越点**。
5. **P2-5 持久化**：pane 布局落 `localStorage`（命名空间化），并顺带补 tab 脏标记与会话恢复。

**测试**：`SqlEditor` 多实例挂载（N 个 `EditorView` 共存、主题事件广播、`compartments` 共享实例安全性）；pane 路由（焦点切换后执行目标正确）。

### P3 — Query History / Favorite（宿主：收藏改文件存储 + 文件夹/拖拽 + 动作面；Pro：keyword）

**P3-1 收藏改文件优先存储**（§2.6，本批最大的一块，且是后面两项的前置）
- Rust 新增 `FavoritesStore`：递归扫 `{favoritesRoot}`、解析 front-matter、内存缓存。
  构造点挂在 `store/mod.rs:124` 与 `HistoryDb::open` 并列；文件 I/O 走 `std::fs`（无 `tauri-plugin-fs`）。
- 文件名用 **ULID**；front-matter 承载 `title` / `keyword` / `connectionId` / `database` / `createdAt` / `updatedAt`。
- 写入一律 **temp 文件 + `fs::rename`** 保证原子；删除改为**移入 `.trash/`**（回收站）。
- `AppSettings` 新增 `favoritesRoot?`，默认 `default_app_data_dir()/favorites`；**首启动显式提示默认目录不在系统同步目录内**。
- 首次迁移：现有 `favorite_queries` 行 → 写文件，**保留原库备份**、幂等标记、失败可回滚。
  迁移完成后 `favorite_queries` 表退役（历史仍留 SQLite）。
- 测试：文件名/文件夹名路径清洗（含 Windows 保留名与尾随点空格）、原子写、迁移往返。

**P3-2 文件夹 + 拖拽**（§2.5 设计，**无 schema 迁移**）
- 目录即文件夹；拖拽移动 = `fs::rename`；删除走 `.trash/`。
- 25/50/25 落点判定提为常量并有单测；自定义 MIME 拖拽载荷（抄 `schemaTreeDrag.ts` 的版本化契约），**不劫持 `text/plain`**；目标元素带 `data-*`。
- 右键菜单按节点类型分支；面板头 `+` 入口（New > File / Folder）。
- 5 条交互规则（§2.5）逐条落地并有 journey 测试：递归删确认 + 条数、拖出到根目录、连接过滤、keyword 只挂文件、搜索跨层级展平。

**P3-3 宿主前端动作面**（可与 P3-2 并行）
- 历史侧：单条删除、加星、新标签打开、**把 favorites 已有的"开新标签"逻辑补齐到历史侧**（低垂果实）。
- ⚠ 修正"单连接面板里的清空按钮执行全局清空"这一数据丢失风险。
- 收藏侧：搜索框（跨层级展平）、重命名、全连接视图。
- 补 `GlobalQueryHistoryDialog.tsx` 里**硬编码中文绕过 `t()`** 的 i18n 违规（会卡 `scripts/i18n-sync-check.mjs`）。
- 统一"Save 按钮已表示『加入收藏』"的命名冲突。

**P3-4 Pro：Favorite → keyword 绑定**（与 P3-1/P3-2 **同批交付**）
- 新增 `createSavedQueryCompletionSource`，输出喂入宿主 `createSnippetCompletionSource({ snippets })`（`boost` 软排序，绝不硬过滤）。
- 编辑器内输入 keyword + Enter 插入；keyword 从 front-matter 读取；复用 `settingsContributions` 暴露配置（依赖 G3 才有效）。
- keyword 只挂文件，不引入文件夹级 keyword。

**P3-5 导出 / 回收站**（低成本配套）
- 「在文件管理器中显示收藏目录」—— 文件方案下这是**字面成立**的原生能力，不是模拟动作。
- 批量导出为单个 `.sql` 文件或 zip；`.trash/` 的恢复与清空 UI。

### P4 — 云同步（可选，独立立项）

见 §2.6.5。**不在 P3 实现**，因为远端目录结构由 P3-1 的布局与 P3-2 的文件夹模型共同决定，先做同步必然返工。

| 阶段 | 内容 | 代码量 |
| --- | --- | --- |
| P4-0 | **什么都不做**即已可用的路径：用户把 `favoritesRoot` 指向 iCloud / Dropbox / Google Drive 同步目录 | **0** |
| P4-1 | 内置 WebDAV 同步（坚果云 / Nextcloud / NAS），一个 adapter 覆盖 | 中 |
| P4-2 | GitHub push/pull 薄封装 + 在网页端编辑后 pull 回流的引导 | 小 |
| P4-3 | 冲突裁决 UI（"本机 N 条 / 远端 M 条 / 冲突 K 条"）—— P4-1/P4-2 开启双向前**必须先有** | 中 |

⚠ 命名：新模块禁止用裸 `sync`（`store/sync_tasks.rs` 已占据该词，含义是 Data Synchronization 同族表同步），一律用 `favorites` / `remote-favorites`。
⚠ 上线前必须先处置 `history.sqlite` 明文存储风险（`history_db.rs:1-11`）。

---

## 6. 风险与待裁决

### 风险
| 风险 | 触发条件 | 后果 | 缓解 |
| --- | --- | --- | --- |
| **EP 版本精确匹配** | 契约改动未同批 bump | Pro 静默降级 community | G4；打包流水线加断言 |
| **熔断一炸全灭** | 任一 Pro 工厂抛错 | 整个 `sqlEditorEnhancedEP` 被注销，六个舱位同时降级，用户看到"功能凭空消失" | 分特性熔断（宿主侧改 `SafeCompartmentWrapper` 语义）；`onCircuitBreak` 目前**未接线** |
| **跨 realm 模块身份分裂** | `__DATAZEN_HOST__` 重写漏 specifier | 静默降级 / "invalid hook call"，**无报错** | G1 自检测试 |
| **非原子重配** | 生产 6 次独立 dispatch（热插拔触发） | 中间帧舱位错配；`dispose()` 与重配竞争 | 把 `reconfigureProCompartments` 接进生产 |
| **Pro 设置键 i18n 一次性求值** | 切换语言 | Pro 设置卡不重新翻译 | 改为渲染期求值 |
| **明文历史库** | 任何导出/同步 | SQL 与错误信息泄露 | P3-1 之前必须先定方案 |
| **分屏放大"关 tab 丢 SQL"** | 无 dirty、无恢复 | 数据丢失面成倍增长 | P2-5 |
| **收藏目录默认不同步** | 用户以为"装了就同步" | 静默不同步 → 换机丢收藏 | 可配置 `favoritesRoot` + 首启显式提示（§2.6.3） |
| **收藏明文文件被误提交** | 用户把目录放进 Git 仓库 | 生产 SQL 外泄 | 设置页常驻提示 + 同步/导出前显式确认（§2.6.6） |

### 裁决记录（2026-08-18，已确认）
1. **Split Pane 范围**：采纳分阶段路线 —— P2-1 布局原语 → P2-2 状态分层（先解 1:1，再动 UI）→ P2-3 水平双 pane（对齐 TablePlus，可对比）→ P2-4 垂直与 N-Pane（TablePlus 无垂直，超越点）→ P2-5 持久化。**不一次性大爆炸。**
2. **宿主 vs Pro 分界**：认可 §3 表。Code Folding 本体归 Pro（折叠 gutter 主题 token 归宿主）、Split Pane 全归宿主、Multi-cursor 修 bug 归宿主、History/Favorite 数据层与动作面归宿主、Favorite → keyword 补全源归 Pro。
3. **Favorite 文件夹 + 拖拽**：**做**，锁死一层，与 keyword 绑定同批交付。详细设计见 §2.5「文件夹 + 拖拽」小节。
4. **存储形态（⚠ 已修订）**：
   - **历史：保持 SQLite**，不上云（低频诊断线索，冲突多且冲突本身无意义）。
   - **收藏：改为文件优先存储**（`{favoritesRoot}/**/*.sql` + front-matter），`favorite_queries` 表退役。目录树成为同步单元 ⇒ 桌面云盘路径零代码、Git 免费给版本历史、WebDAV 只需一个 adapter。详见 §2.6。
   - 修订原因：原裁决是在"只要导出壳、不要真同步"的前提下做出的；真·多端同步要求同步单元**可读、可 diff、可合并**，SQLite 二进制 blob 三条全不满足。
   - ⚠ 连带：`favoritesRoot` 需可配置（`AppSettings` 新增字段）—— 目录选择器已注册（`bootstrap/run.rs:88`），零新增依赖；但 macOS/Windows 的 `app_data_dir()` **本身不在同步目录内**，首启必须显式提示。
5. **营销口径**：`docs/blogs/editor-pro-features.md` 的"44 项功能"**实现完成后统一更新**，本轮不预先对账。

### 仍需在 P2 启动前确认
- P2-2 的 `paneId` 分层是全局改造 `panelStore`，会影响 QueryPanel / ContentView / ContentToolbar / PanelTabBar 四处渲染路径。启动 P2 时需单独排一次影响面评审。

---

## 附：证据索引

- TablePlus 能力基线：`docs.tableplus.com/llms.txt` 索引 + 各页 `.md` 原文
- 宿主编辑器基线：`editorExtensions.ts:258-345`（扩展与 keymap）、`:121-134`（Compartment 闭集）、`:818-839`（重配 API）、`SqlEditor.tsx:344-435`（视图创建）、`:125-128`（仅 5 个 Pro 设置键）
- 多光标：`paste/multipleSelections.ts:26-99`、`formatEditorDocument.ts:29`、`SqlEditor.tsx:152-240`
- 折叠可用性：`@codemirror/lang-sql` 已注册 `foldNodeProp`（`Statement` / `BlockComment`）；`semantic/scanner.ts` 的 `parenDepth`；`SqlScope` 的 `subquery` / `cte` range
- 布局：`useResizable.ts`（124 行，6 处复用）、`queryResultPaneHeight.ts:100-109`、`QueryPanel.tsx:610-788`、`panelStore.ts:74-85`
- 历史/收藏：`store/history_db.rs`（明文 SQLite，v4，去重 + trim）、`QuerySidebarSection.tsx`（480 行）、`querySidebarContextMenu.ts:66-95`（自陈缺 rename/delete）
- 文件优先存储前置（已逐项验证）：`bootstrap/run.rs:88`（dialog 插件已注册）、`store/mod.rs:96`（`default_app_data_dir`）、`store/mod.rs:124`（`HistoryDb::open` 构造点）、`commands/dialog.rs:25`、`store/ai_config.rs`（加密凭据先例）、无 `tauri-plugin-fs`（故走 `std::fs`）
- EP 契约：`sqlEditorEnhancedEP.ts:59-104`（13 个成员）、`extensionPoints.ts:47-179`、`security.ts:135`（精确版本匹配）、`safeCompartment.ts:23-39`（全灭式熔断）
- 打包链路：`src/main.tsx:45-56`、`resolve-pro.mjs:127-262`、`pack-ep.mjs:379-384`、Pro `vite.config.ts:20-88`
