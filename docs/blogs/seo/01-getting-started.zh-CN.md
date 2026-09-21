---
title: "DataZen 入门指南：5 分钟连接你的第一个数据库"
description: "DataZen 是免费开源的跨平台桌面数据库管理工具，支持 PostgreSQL、MySQL、SQLite、Redis 等主流数据库，内置 AI 辅助功能。本文手把手教你 5 分钟内完成下载、安装并连接第一个数据库。"
date: 2026-09-18
slug: getting-started
keywords:
  - 数据库管理工具入门
  - 免费数据库客户端
  - DataZen 下载
  - 数据库连接配置
---

# DataZen 入门指南：5 分钟连接你的第一个数据库

你是否厌倦了在终端和 GUI 之间反复切换来管理数据库？是否在寻找一款免费、跨平台、开箱即用的数据库管理工具？DataZen 就是为了解决这些问题而生的。

本文将带你从零开始，在 5 分钟内完成下载安装，并成功连接你的第一个数据库。

## 为什么选择 DataZen？

市面上的数据库管理工具不少，但 DataZen 有几个鲜明的特点：

- **完全免费开源** — 不需要付费许可证，不需要注册账号，下载即用。源码托管在 GitHub，你可以审计、参与贡献。
- **跨平台** — macOS（Intel 和 Apple Silicon）、Windows、Linux 全覆盖。切换系统不用重新学习工具。
- **内置 AI 辅助** — 写 SQL 不顺畅？AI Chat 可以帮你生成查询、优化语句、解释错误信息。支持 OpenAI、Anthropic、DeepSeek、Ollama 等多种 Provider。
- **支持主流数据库** — PostgreSQL、MySQL、MariaDB、SQLite、Redis、ClickHouse、MongoDB……开箱即连。
- **现代技术栈** — 基于 Tauri v2（Rust + React），启动快、占用低，不是 Electron 那种"吃内存大户"。

简单说，DataZen 把"好用"和"免费"这两件事同时做到了。

## 第一步：下载安装

访问 [DataZen 官网下载页](https://flyxl.github.io/datazen/download.html)，根据你的操作系统选择对应安装包：

| 操作系统 | 安装包格式 | 说明 |
|----------|-----------|------|
| macOS (Apple Silicon) | `.dmg` | 原生 ARM，性能最佳 |
| macOS (Intel) | `.dmg` | Intel Mac 专用 |
| Windows | `.msi` / `.exe` | 标准安装程序 |
| Linux | `.deb` / `.AppImage` | 支持 Ubuntu/Debian 系，AppImage 通用 |

### macOS 安装

打开 `.dmg` 文件，将 DataZen 图标拖入 Applications 文件夹。首次启动时，系统可能会提示"无法验证开发者"——前往 **系统设置 → 隐私与安全性**，点击 **仍要打开** 即可。

### Windows 安装

双击 `.msi` 安装包，按照向导一路 Next。安装完成后，从开始菜单或桌面快捷方式启动。

### Linux 安装

如果你用 Ubuntu/Debian，直接安装 `.deb` 包：

```bash
sudo dpkg -i datazen_*.deb
```

如果选择 `.AppImage`，添加执行权限后直接运行：

```bash
chmod +x datazen_*.AppImage
./datazen_*.AppImage
```

安装完毕后，你会看到 DataZen 的欢迎页面——简洁、现代、没有多余的广告。

## 第二步：连接你的第一个数据库

我们以 PostgreSQL 为例，演示如何创建并连接一个数据库。

### 打开连接管理器

点击左侧导航栏的 **+** 按钮，或者在欢迎页面选择 **新建连接**。

![新建连接入口](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/getting-started-02-new-connection.png)

### 选择数据库类型

在数据库类型下拉菜单中选择 **PostgreSQL**。DataZen 会自动显示该数据库特有的连接字段。

![选择数据库类型](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/getting-started-03-select-db-type.png)

### 填写连接信息

填入以下信息：

- **主机**：`localhost`（本地数据库）或远程 IP 地址
- **端口**：`5432`（PostgreSQL 默认端口）
- **用户名**：你的数据库用户名
- **密码**：你的数据库密码
- **数据库**：要连接的数据库名

你还可以点击左侧的标签页，配置 SSL、SSH 隧道等高级选项——不过入门阶段保持默认就好。

### 测试并保存

点击 **测试连接** 按钮，如果一切正常，会显示绿色的"连接成功"提示。确认无误后，点击 **保存**。

恭喜！你已经成功创建了第一个数据库连接。

## 第三步：基本操作

连接成功后，DataZen 的主工作区就呈现在你面前了。我们来做几个基本操作。

### 浏览 Schema

左侧的连接树展示了数据库的完整结构：表、视图、存储过程、触发器等。展开 `public` schema，你能看到所有表的列表，包括字段名、类型和主键标记。

### 执行 SQL 查询

点击顶部的 **查询** 标签页，打开 SQL 编辑器。输入一条简单的查询：

```sql
SELECT * FROM users LIMIT 10;
```

按 `Ctrl + Enter`（或 `Cmd + Enter`）执行。查询结果会以表格形式呈现在下方，支持排序、筛选、导出。

![SQL 查询执行结果](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/getting-started-06-query-result.png)

### 一些实用小功能

- **自动补全**：输入 `SELECT` 后按空格，表名和字段名会自动弹出。
- **格式化 SQL**：选中一段 SQL，按 `Shift + Alt + F`，自动美化排版。
- **安全模式**：默认开启，防止误操作。在只读模式下执行 `DELETE` 或 `UPDATE` 会被拦截，需要手动关闭只读开关后才能执行写操作。

## 下一步：探索更多功能

连接数据库只是开始。DataZen 还有一系列强大功能等你发掘：

- **AI Chat** — 用自然语言描述你的需求，AI 会帮你生成对应的 SQL 语句。也可以选中一段 SQL，让 AI 解释它在做什么。
- **数据导出** — 将查询结果导出为 CSV、JSON、SQL 等格式，方便与其他工具协作。
- **ER 图** — 可视化数据库的表关系，一眼看清外键和关联。
- **Schema Diff** — 对比两个数据库的结构差异，快速生成迁移 SQL。
- **图表可视化** — 对查询结果生成柱状图、折线图、饼图等，数据一目了然。
- **Workflow** — 用 YAML 定义自动化工作流，批量执行 SQL、定时备份、跨库同步等。
- **MCP Server** — 将 DataZen 作为 MCP 服务器运行，让 AI 助手直接访问你的数据库。

建议从 [功能页面](https://flyxl.github.io/datazen/features.html) 开始，逐步探索这些能力。

## 写在最后

数据库管理工具的选择很多，但 DataZen 用"免费开源 + 跨平台 + AI 辅助"这个组合，给出了一个很有吸引力的答案。无论你是开发者、DBA、还是数据分析师，5 分钟的上手时间，换来的是一整套高效的数据库工作流。

现在就试试吧——完全免费，无需注册。

---

**[立即下载 DataZen](https://flyxl.github.io/datazen/download.html)** · [GitHub 源码](https://github.com/flyxl/datazen)
