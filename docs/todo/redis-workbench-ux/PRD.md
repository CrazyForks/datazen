# PRD: Redis 工作区信息密度与布局重构（Redis Workspace Density & Layout）

> Feature ID: `REDIS_WORKSPACE_UX` · Version: `1.1.0` · Status: **P0 Approved**（§8-1~8-6 六条全部裁定，进入实现；8-6 为第 1 轮修复回合追加）
> 原型：`docs/todo/redis-workbench-ux/prototype.html`（浏览器直接打开，零依赖/零 CDN，用 `src/styles/themes.css` 的真实 token）
> 原型含 **4 个可切换屏**：① 现状诊断（P-1/P-2/P-3 左右对照，含代码行号）② 屏 A 连接总览 ③ 屏 B 双栏工作区 ④ 扫描预算模型（6 个状态机取值 + 请求序列 + 不变量）。
> 屏 B 顶部提供可点状态开关：键属性侧栏 / 自动换行 / 模拟 dirty / 大 value 哨兵 / Hex 只读 / sticky 分组头 / 扫描中；页内已实现 dirty 拦截、TTL 内联三态、批量选择、扫描页脚三态、zset 内联行编辑、Stream Groups 下钻、明暗主题切换。
> 对标：`t8y2/dbx`（Vue3 + Tauri，Redis 实现见 `apps/desktop/src/components/redis/RedisKeyBrowser.vue`、`RedisValueViewer.vue`、`crates/dbx-drivers/src/db/redis_driver.rs`）
> 前置轮次：`docs/todo/redis/`（R1–R14，已交付：二进制通道 / 解码×视图矩阵 / JSON 三态 / list_children 层级 / 值搜索 / SafeMode 门闸 / Console 补全）
> 原型/规格轮已关账（不改代码）；本版起 **P0 进入实现**，走 `subagent-coordinator` 轨道编排（轨道拆分见 §8.3）。

---

## 1. 问题诊断（三条，均已定位到代码行）

### P-1 顶部 48px 空带（图一红框）

- 落点：`src/windows/connection/ContentToolbar.tsx:105`（`h-12 min-h-[48px]`）+ 调用点 `ContentView.tsx:397-416`。
- 根因：左侧 5 组动作的开关来自 `useConnectionWorkspaceMeta.ts:98-107`，`isKvPanel = activePanel?.type === 'redis-db' || meta.isKeyValue === true` ⇒ `showNewQuery / showNewTable / showErDiagramToolbar / showObjectsToolbar` 全 false、`batchExportSupported` 不适用。整条工具栏**只渲染右侧簇**，中间靠 `flex-1` 撑开 ⇒ 视觉上是一条纯空白带。
- 判定：不是渲染 bug，是「为 SQL 面板设计的槽位没有 KV 对应内容」。1440px 宽窗口下约浪费 7% 可视高度，且它压在键树上方，让本可给键列表的空间变窄。

### P-2 未选 db 时的默认页密度过低（图二）

- 落点：`ConnectionWorkspaceHome.tsx:272-385`（State 4: Connected Workspace Home）。
- 根因：`quickActions`（`:273-307`）由同样四个 SQL 开关拼成 ⇒ Redis 下长度为 0，整个区块不渲染；`recentPanels`（`:358`）新会话为空；`recentQueries`（`:388`）是 SQL 执行历史，Redis 无对应物。于是只剩 `:316-334` 一张横幅卡（图标 + 连接名 + Connected + 一行副标题）。
- 可用数据（后端已存在，无需新增 Rust 命令）：`db_sizes`（16 库键数，导航树已用）、`info`、`memory_sample`（大 key 采样，权限 `redis:allow-memory-sample`）、`memory_usage_key`、`slowlog_get`、`count_matching`、`modules_list`、`cluster_nodes`、`xinfo_groups`。见 `packages/drivers/redis/src/commands.rs:20-25`。

### P-3 右上角两枚按钮在 Redis 下的行为（图三红框）

| 按钮 | 组件与行号 | Redis 下真实行为 | 结论 |
|---|---|---|---|
| 💬 `MessageSquare` | `ContentToolbar.tsx:187-194` → `onToggleAiChat` → `ContentViewDrawers.tsx:145` | 能打开 `AiChatPanel`，但 AI 上下文只取 SQL schema（表/列），Redis 的键空间、当前 key、类型/TTL/值摘要**一律不注入** | 半残：需补 KV 上下文，否则应隐藏 |
| ▐ `PanelRight` | `ContentToolbar.tsx:196` `DetailPanelToggle`，开关见 `ContentView.tsx:143-146` | `detailPanelApplicable` 只排除 `table/view` 的 non-data 子页，KV 面板判定为 **true**；但抽屉内容 `detailColumnDefs`/`detailRow`（`ContentViewDrawers.tsx:81-111`）只从表格列/查询结果推导，KV 下为 `[]`/`null` | **死按钮**：点开是空白右侧抽屉 |
| 📖 `BookOpen` | `ContentToolbar.tsx:178-185` → `openDocsWindow('ai')` | 打开 AI 帮助文档窗口，与 Redis 无关但无害 | 保留 |

附带：`ContentStatusBar`（`ContentView.tsx:491-499`）传 `tableName / columnCount / totalRows`，Redis 下同样为空 ⇒ 底部也是一条空带。**上下两条空带 + 中间低密度首页 = 「Redis 连接看起来比 SQL 连接空一大截」的完整成因链。**

---

## 2. 设计目标与非目标

**目标**
1. Redis 路径下**每一像素水平条带都要承载信息或动作**：顶部条带改为「KV 上下文条」，底部状态栏改为「KV 状态条」。
2. 未选 db 时给出**可读的服务器概览**（内存 / keyspace / 大 key / 慢查询），而不是一个空横幅。
3. 键浏览与键详情按 dbx 已验证的信息密度重排，但**保留我们更强的能力**（服务端层级取数、值内容搜索、解码矩阵广度、SafeMode 门闸、Web 右键菜单、驱动解耦契约）。
4. 去掉 string 的「查看 / 编辑」切换，编辑器常驻；写路径统一 dirty → 放弃 / 保存。

**非目标**
- 不引入 Redis 专属宿主代码：所有新 UI 落在 `packages/drivers/redis/ui/**`，宿主只提供槽位（遵守 `docs/development/driver-api-dependency-boundary.md` 契约，边界护栏会拦）。
- 不做 Redis Cluster 拓扑可视化（另立轮次）。
- 不追求与 dbx 像素一致；抄的是**信息架构与交互预算模型**，不是配色。

---

## 3. 信息架构（本轮定稿）

```text
Redis 连接窗口（宿主薄壳）
├─ 左：宿主导航树（连接 → db0..db15 + 键数）        ← 选 db 的入口之一（跃迁规则见 §3.0）
└─ 右：连接工作区
   ├─ [KV 上下文条]  ← 取代 P-1 空带（48px，有内容；屏 A 为连接级、屏 B 为库级）
   ├─ 面板页签条（每 db 一个页签，keep-alive）
   └─ 内容区
      ├─ 无 db 面板 → [屏 A] Redis 连接总览（高密度）
      └─ 有 db 面板 → [屏 B] 双栏工作区
                    ├─ 左列 36%（min 360px，可拖 220–900）
                    │   ├─ R1 模式段控件 + 计数 + 动作图标
                    │   ├─ R2 搜索 combobox + 过滤 chips
                    │   ├─ R3 分组开关（树/列表 · 分隔符 · 规则分组）
                    │   ├─ 键树（sticky 分组头 + 虚拟滚动）
                    │   └─ 页脚：Load more / Fetch all / Stop
                    └─ 右列 64%：页签 [键详情 | 命令行 | 发布订阅 | 监控 | 慢日志]
                          └─ 键详情 = 键头 + 徽标行 + Codec 行 + View 行 + 常驻编辑器 + dirty 底栏
```

### 3.0 屏 A ↔ 屏 B 状态机（先定跃迁，再谈布局）

> 上一版这里写「左树 db 选择是唯一入口」又写「未选 db → 屏 A / 已选 db → 屏 B」，两句合起来是矛盾的：**db 已选就必须是键树**。本节把它改成三要素完备的状态机（AGENTS.md「状态机思维」）。

| 要素 | 屏 A · 连接总览 | 屏 B · 键树工作区 |
|---|---|---|
| **进入条件** | 连接已建立 **且** 该连接下无任何 db 面板（宿主 `!activePanel`；等价于「面板页签条为空」） | 任一 **选 db 动作**：左导航树点 db / KV 上下文条 db 选择器 / 屏 A 的 Key Space 格子 / 屏 A 快捷动作 / 大 key 行 / 最近浏览键 / 搜索 pattern |
| **状态内行为** | 只发 `info` + `db_sizes`（+ 可选 `memory_sample` / `slowlog_get`），**零 SCAN、零 key 级往返**；上下文条为**连接级**：`选择数据库 ▾ · redis 7.2.4 · 16 db / 非空 4 · used …` | 每 db 一个面板页签（keep-alive）；上下文条为**库级**：`db0 ▾ · 52 keys · 类型分布 · 扫描状态`；切 db 只换页签不重扫，复用分组游标（I-4） |
| **退出跃迁** | 选 db → 屏 B（同一动作内完成，不出现「树已高亮但内容还是总览」的中间态） | 关掉该连接**全部** db 面板页签 → 回屏 A；dirty 时先过 I-1 拦截 |

**硬约束**

- 屏 A 存在期间，**导航树不得高亮任何 db 行**，上下文条**不得显示某个 db 的键数** —— 否则等于同时宣称「未选」和「已选」。
- 「选 db」必须是**单一动作直达键树**，禁止做成「先高亮、再另点一次才进」的两段式（这是 dbx 与多数 Redis GUI 的通病）。
- 屏 A 是**默认落地屏**（8-5 已裁定「保留」）：Redis 连接建立后、无任何 db 面板时即渲染屏 A。放弃「连上直接打开 db0」方案，理由：屏 A 是唯一能承载内存 / 大 key / 慢查询这类**连接级**信息的位置，且其数据源零 SCAN 开销（§3.1）。
- KV 上下文条与状态条（§3.4）**与屏 A 无关，必须始终存在** —— 即使将来某天取消屏 A，这两条也不允许回退成空带（那是 P-1/P-3 的原病）。

### 3.1 屏 A：Redis 连接总览（解决 P-2）

| 区块 | 内容 | 数据来源 | 密度要点 |
|---|---|---|---|
| 头部横幅（保留但压缩到 56px） | 图标 + 连接名 + Connected + `redis_version` / `mode` / `used_memory` 三枚 pill | `info` | 把副标题从"一句话"换成三枚**可点击 pill**（点击 → 打开监控对应子页） |
| 卡 1：Server 概览 | version / mode / arch / uptime / connected_clients / blocked / instantaneous_ops / total_commands_processed / evicted_keys / expired_keys | `info` | 两列 label-value，10 行；异常值（evicted>0、碎片率>1.5）自动 warning 色 |
| 卡 2：内存 | used_memory / max_memory 进度条 + 碎片率 + `memory_sample` Top5 大 key（键名/类型/字节/TTL） | `info` + `memory_sample` | 大 key 行可点击 → 直接跳到屏 B 并选中该键；无 `redis:allow-memory-sample` 权限时显示"未授权，去驱动设置开启" |
| 卡 3：Key Space | 16 个 db 网格（db 名 + 键数 + 占比条），空 db 灰化；点击 = 打开该 db 页签 | `db_sizes` + `INFO keyspace` | 替代现在"只能去左树点"的唯一入口；有数据的 db 高亮 |
| 卡 4：慢查询 Top5 | 序号 / 耗时 µs / 命令摘要 / 客户端地址 | `slowlog_get` | 空态文案给出 `SLOWLOG GET` 语义说明，而非留白 |
| 快捷动作（KV 版） | 浏览 db0 / 打开命令行 / 发布订阅 / 导入导出 / 新建键 | 前端 | 取代 `quickActions` 为空的问题；动作集是 KV 语义而非 SQL 语义 |
| 最近浏览键 | 连接级历史（键名 + 类型 + 相对时间），点击直达 | 前端 localStorage（新增 `redisKeyBrowseHistory.ts`） | 对齐 dbx 的 search history 思路 |

**规格**：栅格 `grid-cols-1 lg:grid-cols-2`，卡内 `text-xs`，全部区块在 `RedisWorkbench` 之外新建 `packages/drivers/redis/ui/overview/RedisOverviewHome.tsx`；宿主侧只需把 `ConnectionWorkspaceHome` 的 KV 分支交给驱动的 `connectionView`（契约允许，见 §7）。

**关键前提（决定屏 A 敢做默认落地页）**：七个区块的数据源只有 `info` / `db_sizes` / `slowlog_get` / `memory_sample`，**全程零 `SCAN`**，且后两者各自带独立权限位与开关 ⇒ 进入屏 A 不会给 Redis 增加任何键空间遍历负载（对比：真正的键树必须先付一次扫描预算）。

### 3.2 屏 B 左列：键树（对标 `RedisKeyBrowser.vue:3183-3495`）

**R1 列头**：`键 | 值 | 全部` 段控件（我们已有 `SearchModeTabs`，现在被藏在 `hideSidebar` 时不可见的 db 侧栏里 —— `RedisWorkbench.tsx:398-421`，本轮迁到列头常驻）+ `已加载 N / 共 M 个 key`（扫描中显示 `N+`）+ 右侧图标组：全选 / 取消选择 / 批量 TTL / 批量删除(带计数) / 刷新 / `+`。

**R2 搜索行**：combobox 输入（下拉含**本连接本 db 的历史 pattern** + **可配置键模板** `app:cache:*`）+ chips：`* 模糊`、`🕐 仅无过期`、`类型 ▾`（我们已有 `KeyBrowserControls` 的类型 Select，必须保留 —— **dbx 没有类型过滤，这是我们的优势**）。

**R3 分组行**：`树 / 列表` 切换 + 分隔符设置（默认 `:`，可改 `.`/`/`，per-connection）+ `规则分组` 开关（glob `includes/excludes` ≤64 条把键归入命名分组，纯前端不碰 Redis）。

**行规格**（照抄 dbx 的密度，我们已接近）：固定 30px；缩进 `4 + depth×10`；folder = checkbox + chevron + 琥珀 folder + label + `(n)`；leaf = 键图标（hover 时**替换为** checkbox）+ label + 类型 Badge + TTL pill + hover 删除。sticky 多级分组头（滚动时常驻）。

**扫描预算模型（本轮最重要的借鉴）**：
- 一次用户动作给一个**累计 COUNT 预算**（默认 50k，按 `DBSIZE` 缩放，硬上限 1M），避免稀疏 MATCH 变成无界扫描（dbx `redisKeyPattern.ts:141-150`）。
- 精确键名（无 glob 字符）短路为 `EXISTS`+`TYPE`+`TTL`，不走 SCAN（`redis_driver.rs:2425-2459`）。
- 每页 TYPE/TTL **pipeline 批量**取，DBSIZE 全程只取一次（`redis_driver.rs:2479-2501`）。
- folder 展开 = 该子树独立 `SCAN prefix:*` + **记住每分组游标**，折叠/刷新可续（`RedisKeyBrowser.vue:1444-1537`）。我们已有 `list_children` 服务端层级，比它更省流量 —— 保留，只补"每分组游标记忆"和 `n+` 部分计数。
- 页脚三态：`Load more` / `Fetch all` → `进度 + Stop fetching`（可中断，我们已有 `scan_abort`）。
- Fetch-all 用 25k 分片 + rAF 让出主线程，并**保持视口锚点**（`redisKeyTree.ts:303-412`）。

### 3.3 屏 B 右列：键详情（对标 `RedisValueViewer.vue`，去掉 view/edit 切换）

**键头行**：key 名（等宽、可截断带 title）+ 动作图标组：刷新（**分裂按钮**：下拉选自动刷新间隔 1s/5s/10s/30s/关）· 复制键名 · 复制插入语句 · 重命名（内联） · 删除（危险色）。

**徽标行**：`STRING` | `大小: 2 B`（`ValueFrame.memBytes`，我们已有）| TTL pill。TTL pill **点击即变内联过期编辑器**：`永不过期 / 相对 TTL / 绝对时间(EXPIREAT)` 三态 + 输入（dbx `redisExpiry.ts:49-65`）。这替代现在的独立 `TtlControls` 行，省一行高度。<sup>8-4</sup>

**Codec 行**（`redisValuePresentation.ts` 的矩阵，我们已实现 10 种）：`无 / GZip / Zlib / Deflate / Base64 解码 / Msgpack / Pickle / PHP Serialize / Java Serialize`（dbx 多一种 `protobuf`，列 P2）。解码失败时给**"按 DEFLATE 重试"**建议按钮 + 回退原始字节并提示（dbx 行为）。

**View 行**：`UTF-8 / ASCII / Binary / JSON / Unicode JSON / YAML / XML / Hex / Base64` + 行尾 `自动换行` 开关；Hex 视图显示字节数。

**编辑区（常驻，无切换）**：
- 视图行下方占满剩余高度，**始终可编辑**；`查看/编辑` 两枚按钮（`KeyEditors.tsx:315-342` 的 `redis-string-mode-toggle` 与 `mode` state）**删除**。
- Codec/View 两行是**渲染/解码预检工具**，不参与"只读态"语义 —— 切到 Hex 视图时编辑器进入只读并给出原因（二进制不可原样回写），这是唯一保留的只读态。
- JSON 三态（raw / pretty / compact）继续走我们的 `JsonModeBar` + `json_get` raw 通道（比 dbx 的 raw/decoded 二态更强，保留）。
- 集合类（hash/list/set/zset）：虚拟表格 + `loaded/total` + **服务端字段/成员搜索** + 可排序列 + hash field TTL 列（Redis 7.4+ `HEXPIRE`，能力探测）+ zset 真·内联行编辑（score+member，Enter 保存 / Esc 取消）。
- Stream：子页 `Entries | Groups`，Groups 用面包屑 `stream › group › consumer` 下钻，groups/consumers/pending/lag 来自 `xinfo_groups`/`xinfo_consumers`/`xpending`/`stream_lag`（我们全有）。
- 大 value：**哨兵检测**（`GETRANGE 0 65537`，返回长度 > 65536 即判定截断，不必先传整包），命中则禁编辑 + 提示条 + "按需加载分片"。

**底栏（dirty 驱动）**：`放弃` / `保存` 仅在有未保存改动时出现并高亮；dirty 时刷新与自动刷新被拦截（dbx `hasUnsavedRedisDraft`，`RedisValueViewer.vue:629,2714`）；切键 / 切页签 / 关面板时 dirty → 确认弹层。保存语义：`SET ... KEEPTTL`，服务端拒绝时回退 `PTTL` + `PX`（`redis_driver.rs:3164-3210`）—— 我们已有 `keepTtl` 复选，本轮把它变成**默认行为**并去掉复选（少一个可错开关）。

### 3.4 KV 上下文条与状态条（解决 P-1 / P-3）

> **8-2 已裁定 = 全量**（非极简版）。连带后果：`type_distribution` 与 `key_object_info` 两条后端命令从 P2/P1 **提前进 P0**（§6、§8）。

顶部 48px 条带在 KV 面板下改为（左→右）：`db 选择器 ▾` · `52 keys` · `used 1.2 MB / max 0` · 类型分布 chips（`string 30 · hash 12 · list 6 …`）· 扫描状态（`扫描中 12k/50k 预算 ▉▉▉░`）· 右侧 `SafeMode` 徽标 + 刷新 + `+` + 导入导出 + ⋯ 溢出菜单（FLUSH、监控、驱动设置、扫描预算档位）。

**类型分布 chips 的硬约束**（因为是采样值）：
- 数据来自 §6 `type_distribution`，返回 `{string:30, hash:12, …, sampled:1000, dbsize:52}`。
- `sampled < dbsize` 时**必须**在 chips 组尾显示 `采样 1000/52…` 之类的显式标注，禁止渲染成看起来像精确分布的样子。
- `sampled >= dbsize`（小库全量）时才可不标；命令侧要返回这个判定位。
- 采样失败 / Redis 版本不支持 / 无权限 ⇒ 整组 chips 不渲染（不是渲染 0），并回落为只有键数。

按钮可用性按真实能力渲染（P-3 的修法，**8-3 已裁定 = M**）：
- `DetailPanelToggle`：改造成**键属性侧栏** —— `MEMORY USAGE` / `OBJECT ENCODING` / `IDLETIME` / `FREQ` / `maxmemory_policy`，一次 pipeline（走 §6 `key_object_info`）。`detailPanelApplicable` 从「KV 下为 true 但内容为空」改成「KV 下为 true 且内容 = 键属性侧栏」。**不采纳**「KV 下直接不渲染」的最小修法（那是把死槽位留着）。
- `MessageSquare`（AI）：保留，但补 KV 上下文注入（当前 key + 类型 + TTL + 值摘要 + Console 最近 N 条结果）；注入做不到就在 KV 面板下不渲染 —— 禁止保留"能点开但没上下文"的半残态。

底部状态条 KV 版：`db0 · 52 keys · loaded 52 · 扫描游标 0 · 选中 3 · 最后写操作 SET app:cache:session:1 (12ms)`。

---

## 4. 交互与状态规格（可直接实现）

| 编号 | 规则 | 判定 |
|---|---|---|
| I-1 | dirty 拦截 | 有未保存草稿时，刷新/自动刷新/切键/切页签/切 db 一律先弹「放弃更改 / 继续编辑」 |
| I-2 | 扫描预算 | 单次动作累计 COUNT 超预算即停，页脚显示 `Stop fetching`；预算值在 ⋯ 菜单可调（10k/50k/200k/1M） |
| I-3 | 精确键短路 | pattern 不含 `*?[\\` 时走 `EXISTS+TYPE+TTL`，计数显示 `1 / 1` 而非 `n+` |
| I-4 | 分组游标 | 每个展开 folder 记忆自己的游标；折叠不清空，刷新时保留已加载子集 |
| I-5 | 只读态 | 仅两种：Hex/Binary 视图（不可原样回写）、`frame.truncated` 或哨兵判定大 value；其余一律可编辑 |
| I-6 | 写门闸 | 所有写路径前置 `gateWrite('write-op')`（现状保留）；SafeMode 打开时硬阻断并弹 `redis.safeMode.blocked` |
| I-7 | 危险命令 | `redisConsoleDanger.ts` 四级分类改为 **fail-closed**：未知命令按 blocked 处理；`KEYS`/`FLUSHALL`/`CONFIG`/`EVAL` 默认阻断（dbx `redisCommandSafety.ts:5,277-287`） |
| I-8 | 批量失败 | 批量 TTL/删除部分失败时，**失败键保持选中**，摘要显示 `成功 12 / 失败 3` 并可展开原因 |
| I-9 | 键盘 | `↑/↓` 树内导航、`→/←` 展开折叠、`⌘/Ctrl+A` 全选已加载、`Enter` 应用搜索、`Esc` 清空/取消内联编辑、`⌘/Ctrl+R` 刷新 |
| I-10 | 响应式 | 列头动作容器查询断点 740/340/240px：文字标签 → 纯图标 → 溢出菜单（dbx `RedisKeyBrowser.vue:3866-3908`） |
| I-11 | 空态 | 每个区块都有具名空态文案（无键 / 无大 key / 无慢查询 / 未授权 memory_sample / 无 ReJSON 模块），禁止留白 |

---

## 5. 与 dbx 的正负对比（决定"抄什么、守什么"）

**我们已更强，必须保留**：服务端 `list_children` 层级取数（dbx 是纯客户端 split 分组）；值内容搜索 `scan_values` + 进度/取消（dbx 无）；解码矩阵广度相当且我们已接后端 `decode_value`；类型过滤 + 含内存采样（**dbx 完全没有类型过滤，也没有服务端 TTL 过滤**，它的 `noExpiryOnly` 只过滤已加载行）；Web 右键菜单全量动作（dbx 叶子右键只有"复制键名"）；SafeMode 全局开关；驱动↔宿主解耦契约与边界护栏。

**dbx 更强，本轮吸收**：扫描预算模型（I-2/I-3/I-4）、pipelined TYPE/TTL、`n+` 部分计数、sticky 分组头、glob 规则分组、TTL 内联三态编辑器、自动刷新间隔下拉、复制插入语句、大 value 哨兵、集合服务端搜索、zset 内联行编辑、dirty 拦截、KEEPTTL 默认、fail-closed 命令安全、MONITOR 独立连接 + ring 上限、容器查询折叠、搜索历史 + 键模板。

**dbx 的坑，我们不要跟**：`RedisKeyBrowser.vue` 3937 行 / `RedisValueViewer.vue` 3768 行两个巨石组件 —— 它真正值得抄的是**把逻辑抽进 `lib/redis/*.ts` 并配 co-located `*.spec.ts`** 的做法。我们的 AGENTS.md 有 800 行软上限，本轮必须按「组件薄 + 纯逻辑模块厚」拆：`redisScanBudget.ts`、`redisKeyTemplates.ts`、`redisBrowseHistory.ts`、`redisExpiryPolicy.ts`、`redisBigValue.ts`、`redisStickyGroups.ts`、`redisBatchOutcome.ts`。

---

## 6. 后端缺口（需新增/扩展命令，均落在 redis crate）

| 需求 | 现状 | 缺口与方案 | 优先级 |
|---|---|---|---|
| 键列表显示大小 / 大 key 排序 | `scan_keys` 返回 `size: 0`（上一轮因此把 size 列从树上删掉）；`memory_usage_key` 只支持单键 | 扩展 `list_children`/`scan_keys` 支持 `withMemory` 时**pipeline `MEMORY USAGE` 批量**，或新增 `memory_sample_db` | P1 |
| 顶部条类型分布 chips | `INFO keyspace` 只有 per-db 总数 | 新增 `type_distribution`（游标采样 N 个键的 TYPE 聚合，返回 `{string:30,…,sampled:1000,dbsize:52}`，**必须带 `sampled` 与 `dbsize` 两个位**，供前端决定是否显示"采样"标注，见 §3.4） | **P0**（8-2 裁定全量后从 P2 提前） |
| hash field TTL 列 | 无 | 能力探测 `HEXPIRE`（Redis 7.4+），不支持则不渲染该列 | P2 |
| protobuf 解码 | `decode_value` 无 protobuf | 需 schema，风险高 → 降级为"Base64 + 外部工具"提示 | P3 |
| 自动刷新间隔 | 手动刷新 | 纯前端定时器 + dirty 拦截，无后端改动 | P1 |
| 键属性侧栏（MEMORY/OBJECT/IDLETIME） | `get_key_raw` 已带 `memBytes` | 新增 `key_object_info`（`MEMORY USAGE` + `OBJECT ENCODING/IDLETIME/FREQ` 一次 pipeline，`maxmemory_policy` 从 `info` 缓存取）；键已过期/不存在时返回可区分的空态而非报错 | **P0**（8-3 裁定 M 后从 P1 提前） |

---

## 7. 契约与边界护栏约束（实现期硬约束）

1. 所有新组件/逻辑落 `packages/drivers/redis/ui/**`，**禁止** import 宿主 `src/**`（护栏 R1 blocking）。
2. 需要宿主能力（确认对话框、右键菜单、设置读写）只能走 `@datazen/driver-sdk` 的 `bind*` / `useBound*` 桥；缺能力就先扩展 driver-sdk 并保留宿主薄再导出，不得相对路径回宿主。
3. 文案只改 `packages/drivers/redis/locales/en.ts`，其余 9 语言由 i18n-sync 回合补。`i18n-sync-check` 在开发期**不构成门禁**（§8.2 已核实：pre-commit 不跑、CI `continue-on-error`、`release.yml` 不跑），所以"改英文会红"的从来不是完整性检查，而是**钉死英文值的测试断言**。
4. 屏 A 让位、上下文条/状态条/键属性侧栏三处槽位，一律走 **codegen 驱动贡献槽位**（`scripts/resolve-drivers.mjs` 的 `kvSlots` 声明 + `getDriverKvSlot` lookup + `DatabaseTypeMeta.kvWorkspace` 能力位），**不走 `@datazen/extension-points`**。分层理由：EP 是宿主**特权扩展点**（SQL Editor Pro 那类需要 CodeMirror Compartment 与 <5ms 键入延迟的扩展），驱动贡献 UI 属**驱动贡献通道**，把驱动槽位塞进 EP 是错误分层。**禁止**宿主硬编码 `databaseType === 'redis'` 分支（`ConnectionWorkspaceHome` 的 KV 判定已改为能力判定）。契约细节以 `docs/development/coordination/tracks/redis-host-slots/progress.md` §契约冻结 F-1/F-2/F-3 为准。
5. 单文件 800 行红线；`RedisWorkbench.tsx` 现 680 行，本轮必须**先拆再改**（拆出 `KeyTreeColumn.tsx`、`DetailColumn.tsx`）。
6. **禁止在测试中断言可见文案字符串**（本轮裁定新增）：组件测试一律按 `data-*` 标识 / `role` / i18n **key** 断言，不得写 `getByText('No expiry')` 这类字面量。理由：`en.ts` 是唯一的翻译 source，术语随时会因产品口径改写（本轮 8-4 就是），把英文串钉进断言等于把文案变更成本从 1 个 locale 文件放大到 N 个测试文件。
   - 本轮需清点的存量：`src/locales/locales.test.ts:108-109`（`redis.batchDelete === 'Delete selected'`、`redis.console === 'Console'`）、`packages/drivers/redis/ui/__tests__/ttlControlsJourney.test.tsx:21,79,378`（`getByText('No expiry')`）。**处理方式 = 改写为 key/属性断言后删掉字面量**，不是把断言整条删掉（删掉会丢覆盖，Tester 按覆盖率补回来）。
   - 本轨及后续新增测试若再引入可见英文字面量，视为缺陷登记。

---

## 8. 分期与验收

| 期 | 内容 | 门禁 |
|---|---|---|
| **P0（本轮开工）** | ① KV 上下文条**全量版** + 底部 KV 状态条（P-1）② 死按钮 → **键属性侧栏**（P-3，8-3=M）③ **屏 A 连接总览**七区块（P-2，8-5=保留）④ 后端 `type_distribution` + `key_object_info` ⑤ 断言口径清理：去掉钉死英文值的存量断言（§7-6）⑥ 宿主 KV 判定从硬编码 `databaseType==='redis'` 改为能力判定（§7-4） | redis UI 单测基线全绿 + 新增 ≥18 例；`cargo test -p datazen-driver-redis --lib` 全绿；`tsc` 0；护栏 `--root` 主检出 0 blocking；**新增测试零英文字面量断言** |
| P1 | 双栏重构（列头三行 / sticky 分组 / 扫描预算 / 分组游标 / 页脚三态）+ 键详情重排（键头动作 / 徽标行 / TTL 内联 / 常驻编辑 / dirty 底栏 / KEEPTTL 默认）+ `memory_sample` 批量 size | 同上 + 新增纯逻辑模块 spec（预算/过期/大值/批量结果）；`vite build` 体积增量报告 |
| P2 | 规则分组 + hash field TTL + 搜索历史/键模板 + 键盘导航全覆盖 | 同上 |
| GUI 人工清单 | 真连 Redis 走 6 种类型 + Safe Mode 拦截 + 大 value 只读 + 切语言 + 扫描预算中断 + dirty 拦截切键 + **屏 A 大 key 行跳转 + 类型分布采样标注** | 交用户本地打勾（子代理不跑 `pnpm e2e`） |

### 8.1 裁定记录（2026-09-21 首批 5/5；8-6 于 2026-09-22 追加，共 6/6）

| # | 议题 | 裁定 | 落点 |
|---|---|---|---|
| 8-1 | 右列页签数量 | **5 个**：键详情 / 命令行 / 发布订阅 / 监控 / 慢日志（慢日志升为一级页签） | §3.3、原型 `RTABS`(5) |
| 8-2 | KV 上下文条范围 | **全量**（含 `used/max`、类型分布 chips、扫描进度、导入导出、⋯ 溢出） | §3.4；连带 `type_distribution` 提前进 P0（§6） |
| 8-3 | 死按钮修正 | **M**：`DetailPanelToggle` → 键属性侧栏（`MEMORY USAGE` / `OBJECT ENCODING` / `IDLETIME` / `FREQ` / `maxmemory_policy`） | §3.4；`key_object_info` 提前进 P0（§6） |
| 8-4 | 文案口径 | **照抄**参考图：`永不过期` / `自动换行` / `大小: N B` / `放弃`；并**改掉钉死英文值的存量断言**，改为 key/属性断言 | `locales/en.ts` + §7-6 + §8.2 |
| 8-5 | 屏 A 定位 | **保留**为 Redis 连接的默认落地屏（未选任何 db 时） | §3.0、§3.1 |
| 8-6 | 屏 A 大 key 行「类型 / TTL」来源（第 1 轮 BUG-003） | **(A) 扩 `memory_sample` payload**：后端在同一次 `memory_sample` 调用内为每个采样键批读 `MEMORY USAGE` + `TYPE` + `PTTL`——单节点整样一次 pipeline（≤`256` 键/批，屏 A Top-5 即一次往返）；cluster 无法用普通 pipeline（两词命令被客户端路由表错键 + 混槽 `CROSSSLOT`），改为**每键一次同槽寻址批次**（`route_pipeline` 定向该键所属分片），往返数与原「每键一次 `MEMORY USAGE`」实现持平（= 键数 N），批次被折叠拒绝时该键回退为逐命令寻址以保住「单字段被拒只降级该字段」契约。前端 `MemoryCard` 补类型/TTL 两列并共用 `typeTone` 徽标链路，凑齐 §3.1 卡 2「键名/类型/字节/TTL」四列 | §3.1 卡 2；屏 A「四命令零 SCAN」不变量不动；`OverviewJumpTarget.key` 增可选 `keyType`（BUG-001 类型链路）；`TTL=-1` 永不过期 / `-2` 键消失为 Rust 测试钉住的可区分空态 |

### 8.2 i18n 断言的执行时机（已核实，用于 8-4）

结论：**开发期不存在阻塞 i18n 完整性的断言；补齐只发生在发布前**。核实证据：

| 执行点 | 是否跑 `i18n-sync-check` | 是否阻塞 |
|---|---|---|
| `.husky/pre-commit` | **不跑**（只有 rustfmt + prettier + driver-stash + 版本一致性） | — |
| `package.json` 的 `pretest` / `pretest:unit` | 不跑；只跑 `generate-builtin-locales.mjs`（**生成 bundle，不做一致性比对**） | — |
| `package.json` 的 `build` | 不跑（`tsc --noEmit && vite build`） | — |
| CI（`.github/workflows/ci.yml:70-72`） | 跑，但 `continue-on-error: true` | 否（warning only） |
| `scripts/ci-local.sh:68-73` | 跑 | 否（明确打印"not blocking CI"） |
| `release.yml` | 不跑 | — |
| 发布前（人工） | 由 AGENTS.md + `.agents/skills/i18n-sync/SKILL.md:5,56` 规定手动执行 | 是（发布口径） |

运行时安全性：`packages/ui/src/i18n.ts:87` 查找链为 `registry[locale] ?? registry['en'] ?? key`，非英语缺 key 时回落英文，不崩溃、不空白 —— 这正是"开发期只改 `en.ts` 安全"的前提。

**处理决定（8-4 后半）**：开发期唯一会因改英文而红的，是**把英文字面量钉进断言**的那几处。本轮按 §7-6 清理：

| 存量 | 现状 | 改法 |
|---|---|---|
| `src/locales/locales.test.ts:108-109` | `getAllTranslations('en')['redis.batchDelete'] === 'Delete selected'`、`getTranslation('en','redis.console') === 'Console'` | 改为断言"**解析成功且不回显 key**"（`.length > 0` + `.not.toBe(key)`），保留 `getHostTranslations(...) === undefined` 这条真正的边界不变量 |
| `packages/drivers/redis/ui/__tests__/ttlControlsJourney.test.tsx:21,79,378` | `getByText('No expiry')` × 2 + stub 字典 | 改为按 `data-testid` / `data-i18n-key` 定位并断言存在与状态；stub 字典保留（它只是让 `t()` 有返回值，不是断言） |

⇒ 之后 `en.ts` 术语改动不再牵动测试；`i18n-sync-check` 差异数增加属预期、可接受。**注意**：清理的是"字面量"，不是"断言本身" —— 整条删掉会丢覆盖率，Tester 会按 ≥80% 补回来。

### 8.3 P0 轨道拆分（按文件冲突面，非功能相邻度）

| Wave | 轨道 | 范围 | 独占文件面 | 依赖 |
|---|---|---|---|---|
| W1 | `redis-cmds-p0` | `type_distribution` + `key_object_info`（Rust，pipeline + 采样位 + 键不存在空态） | `packages/drivers/redis/src/**` | — |
| W1 | `redis-host-slots` | 宿主 KV **能力判定**改造（去 `databaseType==='redis'` 硬编码）+ 上下文条/状态条/键属性侧栏/屏 A **四个 codegen 驱动贡献槽位** + `detailPanelApplicable` 修正 + driver-sdk 槽位契约 | `src/windows/connection/ContentToolbar.tsx`、`ContentView.tsx`、`ContentViewDrawers.tsx`、`ConnectionWorkspaceHome.tsx`、`src/lib/databaseMeta.ts`、`packages/driver-sdk/**`、`scripts/resolve-drivers.mjs` | — |
| W1 | `redis-assert-policy` | §7-6 断言口径清理 + 约定落笔进文档 | `src/locales/locales.test.ts`、`packages/drivers/redis/ui/__tests__/ttlControlsJourney.test.tsx` | — |
| W2 | `redis-kvbar-ui` | 驱动侧 KV 上下文条（全量）+ 状态条内容 + 键属性侧栏 UI | `packages/drivers/redis/ui/kv-bar/**`（新目录） | W1 三轨 |
| W2 | `redis-overview` | 屏 A 七区块 + `redisBrowseHistory.ts` + KV 快捷动作 | `packages/drivers/redis/ui/overview/**`（新目录） | W1 `redis-host-slots` |
| W3 | `r-phase` | P0 全量回归 + 主检出终局门禁 + 关账 | — | W2 全部 |

W2 两轨只在 `packages/drivers/redis/ui/**` 注册块的**不同行**相交，合并期由协调者解冲突；两轨各自的新目录互不相干。
