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
| Favorite | **存在但极简**，无重命名/无文件夹/无关键字 | 落后明显 | 宿主（数据层）+ Pro（关键字） |

五个必须先做的地基动作（详见 §4）：

1. `globalThis.__DATAZEN_HOST__` 补 `@codemirror/language` / `@codemirror/commands` —— 否则 Pro 侧折叠与多光标根本无法编译。
2. EP 契约新增**通用** `createExtraExtensions` / `createExtraKeymap` / `createEditorPanelSlot` 三个钩子 —— 现有 6 个 Compartment 是闭集，Pro 无法新增能力。
3. 把 Pro 设置键接进 `SqlEditor.tsx` 的 `useMemo` 依赖数组 —— **目前编辑器只读 5 个硬编码键，其余设置"能存能渲染但零效果"**。
4. `useResizable` 升级为递归/比例化模型 + per-tab 命名空间。
5. `panelStore` 引入 `paneId` 层级，打破 `Map<panelId, QueryExecState>` 的 1:1 假设。

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
- **不跟**：加一个"导出为 `.sql` / 在文件管理器中显示目录"的壳即可，成本极低，且不引入文件系统耦合。**建议先做壳，暂不做存储形态迁移。**

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
| History / Favorite 数据层与 schema v5 | **宿主 Rust** | IPC 与迁移都在宿主 |
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

### P3 — Query History / Favorite（宿主 Rust 迁移 + 前端动作面 + Pro 关键字）

**P3-1 Rust schema v5**（`history_db.rs`，沿用既有"探针式、带数据保留"的迁移风格与 `migration_startpoint_tests` 回归骨架）：
- `favorite_queries` 增加 `updated_at`；`database` / `schema`（使收藏能像 `openHistoryQuery` 一样还原执行上下文）。
- 新增 `update_favorite_query(id, {title?, sql?})` 命令 ⇒ 顺带解决重命名与"重复保存产生重复行"。
- `(connection_id, normalized sql)` 唯一性（`CREATE UNIQUE INDEX` + `ON CONFLICT DO UPDATE`）⇒ 收藏/加星幂等。
- （可选）`query_history` 加 `favorite_id` / `is_favorite`，让"给历史加星"无需重输 SQL。
- （可选）超过 1000 行后的服务端搜索 ⇒ `fts5` 虚表（当前只有 `executed_at DESC` 排序，文本搜索是前端 `includes`）。
- ⚠ **`history.sqlite` 明文存储**这一已记录在案的风险必须在任何"导出/同步"之前处置。

**P3-2 宿主前端动作面**（可与 3-3 并行，互不阻塞）：
- 历史条目：单条删除、加星、新标签打开、**复制 favorites 已有的"开新标签"逻辑补齐到历史侧**（低垂果实）。
- ⚠ 修正"单连接面板里的清空按钮执行全局清空"这一数据丢失风险。
- 收藏面板：搜索框、全连接 scope（后端 `getFavoriteQueries(undefined)` 已支持，UI 未暴露）、重命名、拖拽入文件夹。
- 补 `GlobalQueryHistoryDialog.tsx` 里**硬编码中文绕过 `t()`** 的 i18n 违规（会卡 `scripts/i18n-sync-check.mjs`）。
- 统一"Save 按钮已表示『加入收藏』"的命名冲突。

**P3-3 Pro：Favorite → keyword 绑定**
- 新增 `createSavedQueryCompletionSource`，输出喂入宿主 `createSnippetCompletionSource({ snippets })`（`boost` 软排序，绝不硬过滤）。
- 编辑器内输入 keyword + Enter 插入；复用 `settingsContributions` 暴露 keyword 配置（依赖 G3 才有效）。
- 零 Rust 改动（若 P3-1 已完成则可读取 keyword 字段）。

**P3-4 超越点（可选）**：把历史/收藏导出为真实 `.sql` 文件以获得"Show in Finder"（见 §2.4 建议：先做壳，不迁存储形态）。

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

### 待用户裁决
1. **Split Pane 范围**：先做"对齐 TablePlus 的水平双 pane"（小、快、可对比），还是直接上"水平+垂直 N-Pane"（大、但一步到位且是超越点）？
2. **宿主 vs Pro 的分界是否认可**（见 §3），特别是 Code Folding 归 Pro、Split Pane 全归宿主。
3. **Favorite 是否要做文件夹 + 拖拽**（TablePlus 最有辨识度的组织方式，但需要 schema v5 + 树形 UI），还是先只做 keyword 绑定 + 重命名（低成本高感知）。
4. **历史/收藏是否要"落盘为真实 `.sql` 文件"**，还是保持 SQLite + 增加一个"导出/在文件管理器中显示"的外壳。
5. **营销口径**：`docs/blogs/editor-pro-features.md` 的"44 项功能"在实现前先对账，还是实现完再统一更新。

---

## 附：证据索引

- TablePlus 能力基线：`docs.tableplus.com/llms.txt` 索引 + 各页 `.md` 原文
- 宿主编辑器基线：`editorExtensions.ts:258-345`（扩展与 keymap）、`:121-134`（Compartment 闭集）、`:818-839`（重配 API）、`SqlEditor.tsx:344-435`（视图创建）、`:125-128`（仅 5 个 Pro 设置键）
- 多光标：`paste/multipleSelections.ts:26-99`、`formatEditorDocument.ts:29`、`SqlEditor.tsx:152-240`
- 折叠可用性：`@codemirror/lang-sql` 已注册 `foldNodeProp`（`Statement` / `BlockComment`）；`semantic/scanner.ts` 的 `parenDepth`；`SqlScope` 的 `subquery` / `cte` range
- 布局：`useResizable.ts`（124 行，6 处复用）、`queryResultPaneHeight.ts:100-109`、`QueryPanel.tsx:610-788`、`panelStore.ts:74-85`
- 历史/收藏：`store/history_db.rs`（明文 SQLite，v4，去重 + trim）、`QuerySidebarSection.tsx`（480 行）、`querySidebarContextMenu.ts:66-95`（自陈缺 rename/delete）
- EP 契约：`sqlEditorEnhancedEP.ts:59-104`（13 个成员）、`extensionPoints.ts:47-179`、`security.ts:135`（精确版本匹配）、`safeCompartment.ts:23-39`（全灭式熔断）
- 打包链路：`src/main.tsx:45-56`、`resolve-pro.mjs:127-262`、`pack-ep.mjs:379-384`、Pro `vite.config.ts:20-88`
