# Task: 官网 SEO 博客系统建设

> **状态**：待启动  
> **优先级**：高  
> **目标**：为 DataZen 官网（GitHub Pages）构建完整的 SEO 博客体系，支持中英文双语系列，以高质量图文内容提升搜索引擎排名和产品转化率。

---

## 1. 背景与目标

### 1.1 现状

- 官网已部署在 `https://flyxl.github.io/datazen/`（GitHub Pages）
- 已有双语落地页结构：英文根目录 `site/`，中文 `site/zh/`
- 已有 3 篇博客页面：`blog-architecture.html`、`blog-sql-guard.html`、`blog-mcp-integration.html`
- 已有 16 篇架构系列 Markdown 文档（`docs/blogs/*.zh-CN.md`），但多数未转化为官网博客页面
- 已有丰富的截图资源：`site/assets/screenshots/`（40+ 张功能截图）和 `e2e/screenshots/`（E2E 测试截图）

### 1.2 目标

1. 建立完整的博客 SEO 基础设施（页面模板、sitemap、结构化数据、中英文 hreflang）
2. 创建面向 SEO 的中文博客系列（优先），覆盖产品功能、技术教程、竞品对比、行业话题
3. 中文系列完成后，逐篇翻译为英文版本
4. 每篇博文配有准确反映功能描述的高质量截图/示意图
5. 通过内容营销提升有机搜索流量和产品下载转化

---

## 2. 博客 SEO 基础设施

### 2.1 页面模板规范

每篇博客 HTML 页面必须包含以下 SEO 元素：

```html
<!-- 基础 SEO -->
<title>{文章标题} — DataZen</title>
<meta name="description" content="{150-160 字符的摘要，包含核心关键词}" />
<link rel="canonical" href="https://flyxl.github.io/datazen/blog-{slug}.html" />

<!-- hreflang 双语 -->
<link rel="alternate" hreflang="en" href="https://flyxl.github.io/datazen/blog-{slug}.html" />
<link rel="alternate" hreflang="zh-CN" href="https://flyxl.github.io/datazen/zh/blog-{slug}.html" />
<link rel="alternate" hreflang="x-default" href="https://flyxl.github.io/datazen/blog-{slug}.html" />

<!-- Open Graph -->
<meta property="og:type" content="article" />
<meta property="og:title" content="{文章标题}" />
<meta property="og:description" content="{摘要}" />
<meta property="og:url" content="{canonical URL}" />
<meta property="og:image" content="{文章专属封面图 URL}" />
<meta property="og:locale" content="en_US" />          <!-- 英文页 -->
<meta property="og:locale:alternate" content="zh_CN" /> <!-- 中文页 -->

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{文章标题}" />
<meta name="twitter:description" content="{摘要}" />
<meta name="twitter:image" content="{文章专属封面图 URL}" />

<!-- JSON-LD 结构化数据 -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{标题}",
  "description": "{描述}",
  "url": "{canonical URL}",
  "image": "{封面图 URL}",
  "publisher": { "@type": "Organization", "name": "DataZen", "url": "https://flyxl.github.io/datazen/" },
  "datePublished": "{发布日期 ISO 8601}",
  "dateModified": "{修改日期 ISO 8601}",
  "inLanguage": "en"
}
</script>
```

### 2.2 目录结构

```
site/
├── blog-{slug}.html              # 英文博客页面
├── zh/blog-{slug}.html           # 中文博客页面（对应翻译）
├── assets/
│   ├── screenshots/              # 已有功能截图
│   └── blog/                     # 新增：博客专属图片目录
│       ├── {slug}-cover.png      # 文章封面图（1200x630 OG 尺寸）
│       ├── {slug}-01.png         # 文章内插图
│       ├── {slug}-02.png
│       └── ...
├── sitemap.xml                   # 需更新：添加所有博客 URL
└── robots.txt                    # 已正确配置
```

### 2.3 Sitemap 更新

每新增一篇博客，需同步更新 `site/sitemap.xml`，添加中英文两个 URL 条目：

```xml
<url>
  <loc>https://flyxl.github.io/datazen/blog-{slug}.html</loc>
  <xhtml:link rel="alternate" hreflang="en" href="https://flyxl.github.io/datazen/blog-{slug}.html" />
  <xhtml:link rel="alternate" hreflang="zh-CN" href="https://flyxl.github.io/datazen/zh/blog-{slug}.html" />
  <xhtml:link rel="alternate" hreflang="x-default" href="https://flyxl.github.io/datazen/blog-{slug}.html" />
</url>
<url>
  <loc>https://flyxl.github.io/datazen/zh/blog-{slug}.html</loc>
  <xhtml:link rel="alternate" hreflang="en" href="https://flyxl.github.io/datazen/blog-{slug}.html" />
  <xhtml:link rel="alternate" hreflang="zh-CN" href="https://flyxl.github.io/datazen/zh/blog-{slug}.html" />
  <xhtml:link rel="alternate" hreflang="x-default" href="https://flyxl.github.io/datazen/blog-{slug}.html" />
</url>
```

### 2.4 博客列表页

在 `site/blog.html` 和 `site/zh/blog.html` 创建博客索引页，列出所有文章：

```html
<!-- 每篇文章卡片 -->
<article class="blog-card">
  <a href="blog-{slug}.html">
    <img src="assets/blog/{slug}-cover.png" alt="{文章标题描述}" loading="lazy" />
    <h2>{文章标题}</h2>
    <p>{摘要}</p>
    <time datetime="{ISO 8601}">{发布日期}</time>
  </a>
</article>
```

博客列表页同样需要完整的 SEO 元素（title、description、canonical、hreflang、OG tags）。

---

## 3. 中文博客系列内容规划

### 3.1 第一阶段：核心功能 SEO 博客（12 篇）

> 目标：覆盖产品核心功能的长尾关键词，建立主题集群。其中编辑器系列（#3–#8）每篇聚焦一个具体问题。

| # | 标题 | 核心关键词 | 配图要求 | 状态 |
|---|------|-----------|---------|------|
| 1 | DataZen 入门指南：5 分钟连接你的第一个数据库 | `数据库管理工具入门` `免费数据库客户端` | 新手引导截图、连接配置界面、成功连接结果 | 待启动 |
| 2 | DataZen vs Navicat vs DBeaver：2026 年数据库管理工具深度对比 | `Navicat 替代品` `DBeaver 免费替代` `数据库工具对比` | 三款工具的功能对比表格截图、DataZen 独有功能高亮 | 待启动 |
| 3 | 告别"全选再执行"：SQL 编辑器的语句级运行 | `SQL 编辑器` `语句运行` `SQL 执行效率` | Gutter 运行按钮截图、多语句高亮 | 待启动 |
| 4 | 不离开编辑器看 Schema：表结构悬浮卡片与快捷跳转 | `SQL 编辑器` `Schema 预览` `表结构查看` | 悬浮卡片截图、Cmd+Click 跳转 | 待启动 |
| 5 | 写 JOIN 不用查文档：外键感知的智能 SQL 补全 | `SQL 补全` `JOIN 自动补全` `外键关联` | JOIN 补全推荐列表、列名补全 | 待启动 |
| 6 | INSERT 语句秒写完：Alt+Enter 智能意图操作 | `SQL 智能编辑` `代码意图` `Alt+Enter` | 星号展开、INSERT 模板展开 | 待启动 |
| 7 | 实时 SQL 诊断：写错即刻提示，不用等执行报错 | `SQL 诊断` `实时检查` `波浪线` `SQL 语法检查` | Linter 波浪线截图 | 待启动 |
| 8 | 智能粘贴与拖拽：从 Schema 树到编辑器的无缝衔接 | `SQL 粘贴` `Paste-as-IN` `拖拽插入` | Paste-as-IN 菜单、Drop Caret | 待启动 |
| 9 | AI 驱动的 SQL 编辑器：DataZen NL2SQL 功能详解 | `AI SQL 生成` `自然语言查数据库` `NL2SQL` | AI 对话截图、SQL 生成过程、生成结果执行 | 待启动 |
| 10 | SQL 查询结果一键生成 Dashboard 数据看板 | `数据看板` `SQL 可视化` `Dashboard 生成` `实时数据看板` | Dashboard 界面、图表配置、实时数据展示 | 待启动 |
| 11 | YAML Workflow：用声明式编排自动化数据库操作 | `数据库自动化` `YAML 工作流` `SQL 自动化` | Workflow 编辑器、执行过程、跨库操作截图 | 待启动 |
| 12 | MCP Server：让 AI Agent 安全访问你的数据库 | `MCP Server` `AI Agent 数据库` `Model Context Protocol` | MCP 架构图、配置界面、AI 调用示例 | 待启动 |

> **编辑器系列（#3–#8）统一规则**：严禁提及 "Pro"、"Community"、"增强版"、"基础版"、"插件"、"扩展" 等版本区分词汇。所有功能统一描述为 DataZen 内置能力。

### 3.1.1 编辑器系列详细规划（#3–#8）

#### #3：告别"全选再执行"：SQL 编辑器的语句级运行

**痛点**：编辑器里写了 10 条 SQL，只想跑其中一条，传统做法是选中再 Ctrl+Enter，容易选错范围。

**内容要点**：
- 语句边界自动检测：编辑器理解分号分隔的语句结构
- Gutter 运行按钮：每条语句左侧独立的 ▶ 按钮，一键执行任意单条
- 当前语句高亮：光标所在语句自动高亮背景，视觉上清晰区分
- 多语句脚本场景：日常调试、数据迁移脚本、批量验证

**配图**：
- `03-statement-gutter.png` — 三条 SQL + Gutter 运行按钮
- `03-statement-highlight.png` — 光标在第二条语句上，高亮当前语句边界

---

#### #4：不离开编辑器看 Schema：表结构悬浮卡片与快捷跳转

**痛点**：写 SQL 时频繁切换到 Schema 树查看表结构、列名、外键关系，打断心流。

**内容要点**：
- 悬浮卡片：鼠标悬停表名或别名，弹出卡片显示所有列名、类型、是否可空、默认值、外键关系、表注释
- Cmd/Ctrl+Click 跳转：点击表名或列名，直接跳转到 Schema 树对应位置
- 多表 JOIN 场景：同时悬停多张表，快速对比列名和关联关系
- 与传统工具对比：Navicat/DBeaver 需要打开表属性面板，DataZen 悬停即看

**配图**：
- `04-hover-tooltip.png` — 悬停 `_blog_employee` 表名弹出列定义卡片（含外键）
- `04-hover-multi-table.png` — JOIN 场景悬停 `_blog_dept` 对比列名

---

#### #5：写 JOIN 不用查文档：外键感知的智能 SQL 补全

**痛点**：写 JOIN 时需要手动查外键关系，记不住哪张表关联哪张表；列名也要一个一个敲。

**内容要点**：
- 外键感知 JOIN 补全：输入 `JOIN` 后，编辑器基于 Schema 中的外键定义自动推荐关联表和连接条件
- 一键补全完整 JOIN ... ON 子句：推荐结果包含表名、别名、连接条件
- 智能列补全：输入 `表别名.` 后自动补全该表所有列；无前缀列名时自动推断 FROM 表并智能消歧
- 自动 FROM 补全：输入列名后编辑器自动推断需要的 FROM 子句
- 实际场景演示：从 `SELECT` 开始，一步步写完一个多表 JOIN 查询

**配图**：
- `05-fk-join-completion.png` — JOIN 后推荐关联表（基于外键）
- `05-column-completion.png` — `e.` 后列出所有列
- `05-multi-join-completion.png` — 第二个 JOIN 推荐 `_blog_project`

---

#### #6：INSERT 语句秒写完：Alt+Enter 智能意图操作

**痛点**：写 INSERT 语句时手动敲每一列名和值，繁琐且易错；`SELECT *` 想展开为列列表要手动改。

**内容要点**：
- Alt+Enter 触发意图菜单：光标停在任意位置，弹出上下文相关的操作建议
- 星号展开：`SELECT *` 上 Alt+Enter → 自动展开为所有列名
- INSERT 模板展开：`INSERT INTO table ()` 内 Alt+Enter → 自动展开为完整模板（列名 + 类型占位值）
- 限定符添加/移除：在列名上快速添加或移除表别名前缀
- 子查询包裹：在表达式上快速包裹为子查询

**配图**：
- `06-intention-star-expand.png` — `SELECT *` → 展开为列列表
- `06-intention-insert-template.png` — `()` 内 Alt+Enter → 完整模板
- `06-intention-insert-columns.png` — 表名后 Alt+Enter → 列名模板
- `06-signature-help.png` — `SUBSTRING(name, ...)` 签名提示

---

#### #7：实时 SQL 诊断：写错即刻提示，不用等执行报错

**痛点**：SQL 写错了，执行后才看到报错，来回调试浪费时间；尤其是大查询，执行一次要等很久。

**内容要点**：
- 实时分析：编辑器在你输入时自动分析 SQL 语义
- 波浪线标记：未知表名、未知列名、类型不匹配等立即标红
- 潜在问题预警：缺少 WHERE 的 UPDATE/DELETE、可能的性能问题
- 大文档降级：文档过大时自动降低检查频率，保证编辑器流畅
- 与执行报错的区别：诊断是实时的、预防性的；执行报错是事后的

**配图**：
- `07-linter-unknown-table-column.png` — 未知表/列波浪线
- `07-linter-type-mismatch.png` — 类型不匹配 + 语法错误
- `07-linter-dangerous-operation.png` — 无 WHERE 的 UPDATE/DELETE 预警

---

#### #8：智能粘贴与拖拽：从 Schema 树到编辑器的无缝衔接

**痛点**：想把多个列名粘贴为 `IN (...)` 子句，需要手动加引号和逗号；从 Schema 树复制列名到编辑器格式不对。

**内容要点**：
- Paste-as-IN：从 Schema 树或外部复制多个值，右键粘贴自动转换为 `IN ('val1', 'val2', ...)` 格式
- Drop Caret：从 Schema 树直接拖拽列名到编辑器，自动插入带引号的正确格式
- 参数绑定面板：自动提取 SQL 中的命名参数（`?`、`:name`、`$1` 等格式），编辑器下方弹出参数面板逐个填入值
- 实际场景：快速构建 WHERE IN 子句、批量插入值、跨查询复用列名、安全执行带参数的 SQL

**配图**：
- `08-paste-as-in.png` — 右键 Paste-as-IN 菜单
- `08-bind-params.png` — `$1 $2 $3` 参数绑定面板
- `08-bind-params-named.png` — `:emp_name` 命名参数面板
- `08-sql-guard-danger.png` — `DELETE WHERE 1=1` 安全拦截

#### 配图总览（由 `scripts/e2e-screenshots/editor-blog-screenshots.ts` 统一生成）

> 输出目录: `site/assets/blog/editor-experience/`  
> 测试数据: `_blog_dept` → `_blog_employee` → `_blog_project` → `_blog_emp_project` 四张表（含外键、JSONB、NUMERIC、DATE、BOOLEAN、TIMESTAMP）

| #3 语句级运行 | #4 悬浮卡片与跳转 | #5 外键感知补全 |
|---|---|---|
| `03-statement-gutter.png` — 三条 SQL + Gutter 运行按钮 | `04-hover-tooltip.png` — 悬停表名弹出列定义卡片（含外键） | `05-fk-join-completion.png` — JOIN 后推荐关联表（FK） |
| `03-statement-highlight.png` — 光标在第二条语句上，高亮当前语句边界 | `04-hover-multi-table.png` — JOIN 场景悬停 `_blog_dept` 对比列名 | `05-column-completion.png` — `e.` 后列出所有列 |
| | | `05-multi-join-completion.png` — 第二个 JOIN 推荐 `_blog_project` |

| #6 Alt+Enter 智能意图 | #7 实时 SQL 诊断 | #8 智能粘贴与拖拽 |
|---|---|---|
| `06-intention-star-expand.png` — `SELECT *` → 展开为列列表 | `07-linter-unknown-table-column.png` — 未知表/列波浪线 | `08-paste-as-in.png` — 右键 Paste-as-IN 菜单 |
| `06-intention-insert-template.png` — `()` 内 Alt+Enter → 完整模板 | `07-linter-type-mismatch.png` — 类型不匹配 + 语法错误 | `08-bind-params.png` — `$1 $2 $3` 参数绑定面板 |
| `06-intention-insert-columns.png` — 表名后 Alt+Enter → 列名模板 | `07-linter-dangerous-operation.png` — 无 WHERE 的 UPDATE/DELETE | `08-bind-params-named.png` — `:emp_name` 命名参数面板 |
| `06-signature-help.png` — `SUBSTRING(name, ...)` 签名提示 | | `08-sql-guard-danger.png` — DELETE WHERE 1=1 安全拦截 |

### 3.2 第二阶段：技术深度博客（6 篇）

> 目标：建立技术权威性，吸引开发者社区。

| # | 标题 | 核心关键词 | 配图要求 | 状态 |
|---|------|-----------|---------|------|
| 10 | 为什么选择 Tauri 而不是 Electron？DataZen 技术选型复盘 | `Tauri vs Electron` `桌面应用技术选型` `Tauri 开发` | 架构对比图、性能对比数据、包体积对比 | 待启动 |
| 11 | SQL 安全网：如何防止生产环境误操作 | `SQL 安全` `数据库权限控制` `SQL 审计` | SQL Guard 界面、安全模式截图、风险操作拦截 | 待启动 |
| 12 | 可插拔数据库驱动架构：DataZen 如何支持 10+ 种数据库 | `数据库驱动架构` `可插拔设计` `多数据库支持` | 驱动注册流程图、驱动列表截图 | 待启动 |
| 13 | 大数据量查询性能优化：虚拟滚动与流式传输 | `大数据量查询优化` `虚拟滚动` `数据库性能` | 大结果集渲染截图、性能对比数据 | 待启动 |
| 14 | 数据库 ER 图可视化：从 Schema 到图形化展示 | `ER 图工具` `数据库可视化` `表关系图` | ER 图完整界面、表关系展示、交互操作 | 待启动 |
| 15 | AI 诊断：让 AI 帮你分析 SQL 执行计划 | `EXPLAIN 分析` `AI 诊断` `SQL 优化建议` | AI 诊断面板、EXPLAIN 结果、优化建议截图 | 待启动 |

### 3.3 第三阶段：场景与案例博客（4 篇）

> 目标：覆盖使用场景，提升转化率。

| # | 标题 | 核心关键词 | 配图要求 | 状态 |
|---|------|-----------|---------|------|
| 16 | 开发者的一天：使用 DataZen + AI Chat 优化数据库查询 | `开发者工具` `AI 辅助开发` `数据库查询优化` | 日常使用场景截图序列 | 待启动 |
| 17 | 团队协作：DataZen 如何替代 Navicat 降低 80% 成本 | `团队数据库管理` `开源替代方案` `降低开发成本` | 团队使用场景、成本对比图表 | 待启动 |
| 18 | 运营看板：用 SQL 查询结果生成实时数据看板 | `数据看板` `SQL 可视化` `运营仪表盘` | Dashboard 界面、图表配置、实时数据展示 | 待启动 |
| 19 | 数据库备份与恢复：DataZen 的安全策略 | `数据库备份工具` `数据恢复` `数据库安全` | 备份界面、恢复流程、加密存储说明 | 待启动 |

---

## 4. 图片规范与要求

### 4.1 核心原则

> **图片必须准确反映文字描述的功能**，禁止使用通用素材图、AI 生成的无关图片或与实际界面不符的截图。

### 4.2 截图规范

| 类型 | 尺寸 | 用途 | 要求 |
|------|------|------|------|
| **封面图** | 1200×630 px | OG/Twitter Card、博客列表 | 必须是 DataZen 实际界面截图，带标题文字叠加 |
| **功能截图** | 原始分辨率（≥1200px 宽） | 文章正文 | 必须是 DataZen 实际运行界面，清晰可读 |
| **流程截图** | 原始分辨率 | 操作步骤说明 | 按操作顺序编号，关键区域用红框/箭头标注 |
| **架构图** | SVG 或高清 PNG | 技术文章 | 使用 Archify 生成，与代码实现一致 |
| **对比图** | 并排布局 | 竞品对比 | 截图来自真实运行环境，标注差异点 |

### 4.3 截图获取方式

1. **运行 DataZen 应用** → 手动操作到目标界面 → 系统截图
2. **使用已有 E2E 截图**（`e2e/screenshots/`）→ 裁剪/标注
3. **使用已有官网截图**（`site/assets/screenshots/`）→ 作为基础素材
4. **使用 Archify 生成架构图**（`docs/blogs/diagrams/`）

### 4.4 图片 Alt 文本规范

每张图片必须有描述性 Alt 文本，包含相关关键词：

```html
<!-- ✅ 正确 -->
<img src="assets/blog/ai-nl2sql-01.png" alt="DataZen AI Chat 面板中输入自然语言 '查询所有金额大于1000的订单' 后自动生成 SQL 语句" />

<!-- ❌ 错误 -->
<img src="ai-nl2sql-01.png" alt="截图" />
<img src="ai-nl2sql-01.png" alt="DataZen" />
```

### 4.5 图片文件命名规范

```
assets/blog/{文章slug}-{序号}-{简短描述}.png

示例：
assets/blog/ai-nl2sql-01-chat-panel.png
assets/blog/ai-nl2sql-02-generated-sql.png
assets/blog/ai-nl2sql-03-query-result.png
assets/blog/schema-diff-01-compare-endpoints.png
assets/blog/schema-diff-02-diff-result.png
```

---

## 5. 中英文翻译策略

### 5.1 工作流程

```
中文原文完成 → 中文页面发布 → 英文翻译 → 英文页面发布 → sitemap 更新
```

### 5.2 翻译规范

| 项目 | 规范 |
|------|------|
| **文件命名** | 英文页面：`site/blog-{slug}.html`；中文页面：`site/zh/blog-{slug}.html` |
| **hreflang** | 中文页 `hreflang="zh-CN"` 指向英文 canonical；英文页 `hreflang="en"` 指向中文对应页 |
| **OG locale** | 中文页 `og:locale="zh_CN"`；英文页 `og:locale="en_US"` |
| **JSON-LD** | 中文页 `"inLanguage": "zh-CN"`；英文页 `"inLanguage": "en"` |
| **截图** | 中英文版本使用相同截图（图片无语言差异） |
| **标题翻译** | 保持 SEO 关键词，而非逐字翻译 |
| **描述翻译** | 针对目标语言的搜索习惯重新撰写 |

### 5.3 标题翻译示例

| 中文标题 | 英文标题（非逐字翻译） |
|---------|---------------------|
| DataZen 入门指南：5 分钟连接你的第一个数据库 | Getting Started with DataZen: Connect Your First Database in 5 Minutes |
| DataZen vs Navicat vs DBeaver：2026 年数据库管理工具深度对比 | DataZen vs Navicat vs DBeaver: Which Database Tool Is Right for You in 2026? |
| AI 驱动的 SQL 编辑器：DataZen NL2SQL 功能详解 | AI-Powered SQL Editor: How DataZen Turns Natural Language into Queries |
| SQL 查询结果一键生成 Dashboard 数据看板 | From SQL Query to Dashboard: Generate Live Data Boards in One Click |

---

## 6. SEO 技术检查清单

每篇博客发布前，逐项检查：

### 6.1 On-Page SEO

- [ ] `<title>` 包含核心关键词，≤60 字符
- [ ] `<meta name="description">` 包含关键词 + CTA，150-160 字符
- [ ] `<h1>` 唯一，包含标题关键词
- [ ] `<h2>`-`<h3>` 层级清晰，包含语义关键词
- [ ] URL slug 简洁有意义（`blog-{关键词}.html`）
- [ ] 每张图片有描述性 `<img alt="...">`
- [ ] 内链：相关博文互相链接
- [ ] JSON-LD Article 结构化数据完整

### 6.2 双语 SEO

- [ ] `<link rel="canonical">` 指向正确
- [ ] `<link rel="alternate" hreflang="...">` 三组完整（en, zh-CN, x-default）
- [ ] `og:locale` 和 `og:locale:alternate` 正确
- [ ] 中英文页面内容对应（非机器直译）

### 6.3 性能与技术

- [ ] 图片使用 `loading="lazy"`（首屏除外）
- [ ] 图片压缩（WebP 格式可选，PNG 保持清晰）
- [ ] 页面加载 < 3 秒（Core Web Vitals）
- [ ] 移动端响应式正常
- [ ] `sitemap.xml` 已更新

---

## 7. 实施计划

### Phase 1：基础设施搭建（第 1 周）

- [x] 创建博客列表页 `site/blog.html` + `site/zh/blog.html`
- [x] 建立博客图片目录 `site/assets/blog/`
- [x] 编写博客 HTML 模板（`scripts/build-blog-pages.mjs`，从 MD 自动生成）
- [ ] 更新 `site/sitemap.xml` 模板
- [ ] 编写 `scripts/check-blog-seo.mjs`（自动化 SEO 检查脚本）
- [x] 编写 `scripts/e2e-screenshots/editor-blog-screenshots.ts`（编辑器体验文章专用截图脚本，含测试数据构造）

### Phase 2：中文系列第一批（第 2-4 周）

- [ ] 第 1 篇：DataZen 入门指南
- [ ] 第 2 篇：DataZen vs Navicat vs DBeaver 对比
- [ ] 第 3 篇：告别"全选再执行"：语句级运行
- [ ] 第 4 篇：不离开编辑器看 Schema：悬浮卡片与跳转
- [ ] 第 5 篇：写 JOIN 不用查文档：外键感知智能补全
- [ ] 运行 `pnpm e2e:skip-build -- --spec scripts/e2e-screenshots/editor-blog-screenshots.ts` 生成编辑器系列截图

### Phase 3：中文系列第二批（第 5-7 周）

- [ ] 第 6 篇：INSERT 语句秒写完：Alt+Enter 智能意图
- [ ] 第 7 篇：实时 SQL 诊断：写错即刻提示
- [ ] 第 8 篇：智能粘贴与拖拽：Schema 树到编辑器
- [ ] 第 9 篇：AI NL2SQL 功能详解
- [ ] 第 10 篇：Dashboard 数据看板

### Phase 4：英文翻译第一批（第 8-9 周）

- [ ] 翻译第 1-10 篇为英文（编辑器系列 #3-#8 优先）
- [ ] 发布英文页面
- [ ] 更新 sitemap 和 hreflang

### Phase 5：技术深度博客（第 10-12 周）

- [ ] 第 11-14 篇技术深度文章（Workflow、MCP 等）
- [ ] 翻译第 11-12 篇为英文

### Phase 6：场景博客与持续优化（第 13-16 周）

- [ ] 第 15-17 篇场景文章
- [ ] 翻译第 13-14 篇为英文
- [ ] Google Search Console 监控与内容优化

---

## 8. 已有资源盘点

### 8.1 可复用的截图（`site/assets/screenshots/`）

> **注意**：编辑器系列（#3–#8）的截图通过专门的 WDIO 脚本 `scripts/e2e-screenshots/editor-blog-screenshots.ts` 生成，输出到 `site/assets/blog/editor-experience/`，不复用现有 `pro-*.png` 截图。其他文章的截图也应在写作时重新确认与实际界面的一致性。

| 文件名 | 内容 | 适用文章 |
|--------|------|---------|
| `01-main-window.png` | 主窗口全景 | 入门指南、对比文章 |
| `02-query-chart.png` | 查询 + 图表 | 入门指南、图表文章 |
| `03-ai-nl2sql.png` | AI NL2SQL | AI 系列 |
| `04-workflow.png` | Workflow 编辑器 | Workflow 文章 |
| `05-ai-diagnosis.png` | AI 诊断 | AI 诊断文章 |
| `06-ai-explain.png` | AI EXPLAIN | AI 诊断文章 |
| `07-ai-chat.png` | AI Chat | AI 系列 |
| `15-redis.png` | Redis 界面 | Redis 相关 |
| `16-er.png` | ER 图 | ER 图文章 |
| `17-sql-editor.png` | SQL 编辑器 | 编辑器文章 |
| `21-dashboard.png` | 运营看板 | Dashboard 文章 |
| `30-sql-editor-danger-guard.png` | SQL 安全拦截 | 安全文章 |
| `32-sql-editor-snippets.png` | SQL 片段 | 编辑器文章 |

### 8.2 可复用的架构图（`docs/blogs/diagrams/`）

| 文件 | 内容 |
|------|------|
| `datazen-system-architecture.html` | 系统架构全景 |
| `datazen-driver-runtime-architecture.html` | 驱动运行时架构 |
| `datazen-driver-build-workflow.html` | 驱动编译流程 |

### 8.3 可复用的 Markdown 源文（`docs/blogs/`）

已有 16 篇中文架构系列文章，可作为博客内容素材：

| 文件 | 标题 | 可转化博客 |
|------|------|-----------|
| `00-datazen-overview.zh-CN.md` | 是什么？为什么做？ | 入门指南、产品介绍 |
| `01-datazen-architecture-overview.zh-CN.md` | 架构全景 | 技术选型、Tauri 文章 |
| `02-tauri-frontend-backend-boundary.zh-CN.md` | 前后端边界 | Tauri vs Electron |
| `04-pluggable-database-drivers.zh-CN.md` | 可插拔驱动 | 驱动架构文章 |
| `05-driver-command-api.zh-CN.md` | Driver Command API | 技术深度文章 |
| `10-workflow-engine.zh-CN.md` | Workflow 引擎 | Workflow 文章 |
| `11-ai-provider-nl2sql.zh-CN.md` | AI 与 NL2SQL | AI 系列 |
| `12-mcp-architecture.zh-CN.md` | MCP 架构 | MCP 文章 |
| `14-cache-persistence-security.zh-CN.md` | 缓存与安全 | 安全文章 |
| `15-testing-strategy.zh-CN.md` | 测试策略 | 工程质量文章 |
| `16-shared-core-web-evolution.zh-CN.md` | Web 平台演进 | 演进方向文章 |

> **注意**：编辑器系列（#3–#8）的截图通过 `scripts/e2e-screenshots/editor-blog-screenshots.ts` 生成，不复用现有截图。

---

## 9. 质量标准

### 9.1 文章质量

- 每篇 1500-3000 字（中文）
- 从真实问题或使用场景切入
- 包含具体操作步骤或代码示例
- 至少 3 张高质量功能截图
- 结尾有明确的 CTA（下载链接、相关文章）

### 9.2 图片质量

- 截图来自真实运行环境，非 mockup
- 关键区域清晰可读（字体 ≥ 12px）
- 流程截图按步骤编号
- 封面图包含文章标题文字和 DataZen 品牌元素

### 9.3 SEO 质量

- 核心关键词自然分布在标题、描述、H2、首段、Alt 文本中
- 关键词密度 1-2%（不堆砌）
- 相关文章互链形成主题集群
- 移动端体验良好

---

## 10. 成功指标

| 指标 | 3 个月目标 | 6 个月目标 | 12 个月目标 |
|------|-----------|-----------|------------|
| 博客文章数（中文） | 12 篇 | 14 篇 | 17 篇 |
| 博客文章数（英文） | 10 篇 | 12 篇 | 17 篇 |
| 有机搜索流量（月） | 500 PV | 2,000 PV | 5,000 PV |
| 关键词 Top 10 数量 | 5 个 | 15 个 | 30 个 |
| 博客 → 下载转化率 | 1% | 2% | 3% |

---

## 11. 依赖与风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 截图与实际界面不一致 | 用户信任度下降 | 每次发布前重新截图验证 |
| 英文翻译质量差 | 国际 SEO 效果差 | 优先保证中文质量，英文逐篇精翻 |
| Google 收录慢 | 短期无流量 | 主动提交 sitemap，社交渠道分发 |
| 关键词竞争激烈 | 排名难以上升 | 聚焦长尾词和细分场景 |
| 博客更新频率低 | SEO 权重积累慢 | 保持每周 1-2 篇的节奏 |
