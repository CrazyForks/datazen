---
title: "SQL 查询结果一键生成 Dashboard 数据看板"
description: "DataZen 支持将 SQL 查询结果直接生成可视化 Dashboard 数据看板。支持折线图、柱状图、饼图、表格等多种图表类型，拖拽式布局，定时刷新，一个看板包含多个查询图表。"
date: 2026-10-12
slug: dashboard
keywords:
  - 数据看板
  - SQL 可视化
  - Dashboard 生成
  - 实时数据看板
---

# SQL 查询结果一键生成 Dashboard 数据看板

你有没有过这样的经历：运营同事跑来问你"能不能帮我看一下这周的日活数据"，你打开终端执行了一条 SQL，把结果贴到微信群里，然后对方说"能不能做成图表？"——于是你把数据复制到 Excel，调整格式，插入图表，导出截图，再发回群里。

这个流程可能要花 15 分钟，而且每次数据更新都要重来一遍。

DataZen 的 Dashboard 功能，把这个流程压缩到了几次点击。

## 从 SQL 到看板，只需三步

DataZen 的 Dashboard 不需要你离开应用，也不需要导出数据到其他工具。它直接基于你的 SQL 查询结果生成可视化图表。

**第一步**：在 SQL 编辑器中写好查询，执行后你会看到结果表格旁边有一个"添加到 Dashboard"的按钮。

**第二步**：点击按钮，选择图表类型——折线图、柱状图、饼图、面积图、表格，或者数字卡片。

**第三步**：图表立即呈现在 Dashboard 中。拖拽调整位置，拖动边框调整大小，一个专业的数据看板就这样诞生了。

![Dashboard 总览](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/10-dashboard-overview.png)

没有数据导出，没有格式转换，没有额外的 BI 工具。你的数据从数据库到可视化，全程留在 DataZen 里。

## 丰富的图表类型

DataZen 内置多种图表类型，覆盖常见的数据可视化需求：

- **折线图** — 适合展示时间序列数据：日活趋势、访问量变化、系统负载波动。
- **柱状图** — 适合对比：各渠道转化率、不同产品的销售额、部门间的人数对比。
- **饼图** — 适合占比：流量来源分布、数据库类型占比、用户地域分布。
- **面积图** — 适合堆叠展示：多指标的趋势叠加。
- **表格** — 适合需要查看明细数据的场景：待处理工单列表、最近的订单记录。
- **数字卡片** — 适合一目了然的关键指标：总用户数、今日订单量、服务器在线数。

每种图表都支持自定义标题、颜色方案和数据格式。你不需要学任何可视化库或 CSS，全靠鼠标点击配置。

![图表配置界面](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/10-dashboard-chart-config.png)

## 拖拽式布局，自由组合

Dashboard 的布局完全由你掌控。你可以：

- **拖拽调整位置**：把"今日订单数"卡片拖到看板最显眼的位置。
- **拖动边框调整大小**：让关键图表占据更大的面积。
- **自由排列组合**：没有固定的网格约束，你觉得怎么好看就怎么摆。

一个看板可以包含来自不同 SQL 查询的图表。比如，你可以同时展示：

- 来自 PostgreSQL 的用户增长数据（折线图）
- 来自 MySQL 的订单统计（柱状图）
- 来自 Redis 的在线用户数（数字卡片）

不同数据库、不同查询、不同类型的数据，统一呈现在同一个看板中。

## 定时刷新，数据实时更新

看板不是静态的截图。DataZen 支持为 Dashboard 中的图表设置定时刷新间隔——每 5 秒、30 秒、1 分钟、5 分钟，或者自定义间隔。

启用自动刷新后，DataZen 会按设定的间隔重新执行对应的 SQL 查询，并更新图表数据。这意味着你打开一个 Dashboard，看到的永远是最新的数据。

这个功能特别适合以下场景：

- **运维监控看板**：实时展示服务器 CPU 使用率、内存占用、连接数等关键指标。
- **运营数据看板**：定时刷新今日注册数、活跃用户数、订单量。
- **销售看板**：大屏展示当天的实时销售数据，放在办公室的大屏幕上一目了然。

## 实际场景：三种看板示例

### 运营数据看板

一个典型的运营看板包含：

| 图表 | 数据来源 | 刷新间隔 |
|------|---------|---------|
| 今日新增用户（数字卡片） | `SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE` | 30 秒 |
| 7 日日活趋势（折线图） | `SELECT DATE(login_at), COUNT(DISTINCT user_id) FROM logins ...` | 5 分钟 |
| 渠道来源分布（饼图） | `SELECT source, COUNT(*) FROM users GROUP BY source` | 1 小时 |
| 最近 10 笔订单（表格） | `SELECT * FROM orders ORDER BY created_at DESC LIMIT 10` | 1 分钟 |

### 销售看板

| 图表 | 数据来源 | 刷新间隔 |
|------|---------|---------|
| 本月销售额（数字卡片） | `SELECT SUM(amount) FROM orders WHERE ...` | 1 分钟 |
| 月度销售趋势（折线图） | `SELECT DATE_TRUNC('month', created_at), SUM(amount) ...` | 1 小时 |
| Top 10 产品（柱状图） | `SELECT product_name, SUM(amount) ... GROUP BY product_name` | 1 小时 |
| 区域分布（饼图） | `SELECT region, COUNT(*) ... GROUP BY region` | 1 天 |

### 技术监控看板

| 图表 | 数据来源 | 刷新间隔 |
|------|---------|---------|
| 在线连接数（数字卡片） | `SELECT COUNT(*) FROM pg_stat_activity` | 5 秒 |
| 慢查询数量（柱状图） | `SELECT COUNT(*) FROM pg_stat_statements WHERE mean_time > 1000` | 30 秒 |
| 数据库大小（折线图） | `SELECT pg_database_size(current_database())` | 5 分钟 |

## 轻量 vs 重量级：为什么选择 DataZen Dashboard

市面上有不少专业的 BI 工具——Metabase、Grafana、Superset、Tableau。它们功能强大，但也有明显的门槛：

| 对比维度 | DataZen Dashboard | 专业 BI 工具 |
|----------|------------------|-------------|
| 部署成本 | 内置功能，零部署 | 需要单独安装和配置 |
| 数据准备 | 直接用 SQL 查询结果 | 通常需要先导入数据源 |
| 学习曲线 | 几分钟上手 | 几小时到几天 |
| 适用场景 | 个人/小团队快速看数据 | 企业级数据分析平台 |
| 协作能力 | 导出截图分享 | 多人协作、权限管理 |
| 扩展性 | 满足 80% 的日常需求 | 无限扩展 |

DataZen Dashboard 的定位不是取代专业 BI 工具，而是解决一个更轻量的需求：**当你只想快速看看数据的时候，不需要启动一个完整的 BI 平台**。

它是你手边的"快速看板"——连接数据库，写几条 SQL，图表就出来了。

## 写在最后

数据可视化不应该是 BI 工程师的专属技能。DataZen 让每个人都能用 SQL 查询结果生成看板，用图表说话，而不是用截图和截图。

下次运营同事再问你"能不能帮我看一下数据"，你可以直接打开一个已经配好的 Dashboard——数据实时更新，图表一目了然。

现在就试试吧——完全免费，无需注册。

---

**[立即下载 DataZen](https://flyxl.github.io/datazen/download.html)** · [GitHub 源码](https://github.com/flyxl/datazen)
