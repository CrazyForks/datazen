---
title: "微服务跨库查询：用 Workflow 一键追踪业务全链路数据"
description: "微服务架构下追踪一笔订单需要查 5 个不同数据库？DataZen Workflow 支持跨库操作，用 YAML 串联多库查询，一键追踪业务全链路数据。"
date: 2026-10-14
slug: workflow
keywords:
  - 微服务跨库查询
  - 数据库自动化
  - YAML 工作流
  - 跨库数据追踪
  - 数据库编排
---

# 微服务跨库查询：用 Workflow 一键追踪业务全链路数据

你有没有遇到过这种情况：线上一个用户投诉"我的订单状态不对"，你需要排查这个问题。

打开订单服务的数据库，查到订单记录——状态是"已支付"。但用户说没收到货，你需要去库存服务查一下库存扣减记录，再去物流服务查一下发货状态，再去支付服务确认支付回调是否成功，最后去通知服务看有没有发出发货通知。

**5 个微服务，5 个数据库，5 次登录，5 次手动执行 SQL。**

一个问题排查下来，光是在不同数据库之间切换就花了半小时。更糟糕的是，你得在脑子里把这几个数据库的结果拼在一起——订单在 PostgreSQL 里，库存在 MySQL 里，物流在 MongoDB 里，支付在另一个 PostgreSQL 实例里。

这不是个例。微服务架构下，**业务数据被分散到多个独立数据库中**，追踪一笔业务的完整链路成了日常最痛苦的事情之一。

## Workflow：把跨库查询变成一个文件

DataZen 的 YAML Workflow 正是为解决这个问题而生的。你用一个 YAML 文件定义跨多个数据库的查询步骤，DataZen 按顺序执行，结果统一展示。

一个典型的微服务链路追踪 Workflow 长这样：

```yaml
name: 订单全链路追踪
description: 追踪订单从支付到发货的完整状态

parameters:
  - name: order_id
    type: string
    description: 订单号

steps:
  - name: 查询订单状态
    connection: order-service
    sql: "SELECT id, status, user_id, amount, created_at FROM orders WHERE id = '{{order_id}}'"

  - name: 查询支付记录
    connection: payment-service
    sql: "SELECT order_id, payment_status, paid_at, transaction_id FROM payments WHERE order_id = '{{order_id}}'"

  - name: 查询库存扣减
    connection: inventory-service
    sql: "SELECT order_id, product_id, quantity, deducted_at FROM inventory_deductions WHERE order_id = '{{order_id}}'"

  - name: 查询物流状态
    connection: logistics-service
    sql: "SELECT order_id, tracking_no, status AS logistics_status, shipped_at FROM shipments WHERE order_id = '{{order_id}}'"

  - name: 查询通知记录
    connection: notification-service
    sql: "SELECT order_id, channel, sent_at, status AS notify_status FROM notifications WHERE order_id = '{{order_id}}' AND type = 'shipping'"
```

![跨库操作示意](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/11-workflow-cross-db.png)

一个命令，五个数据库的结果全部拿到。你不需要登录五个不同的数据库客户端，不需要在脑子里拼凑结果——Workflow 引擎替你搞定连接管理、执行调度、结果汇总。

## 核心能力：跨库操作

Workflow 的核心是 `connection` 字段——每个 Step 可以指定不同的数据库连接。

```yaml
steps:
  - name: 从 PostgreSQL 查订单
    connection: order-db
    sql: "SELECT * FROM orders WHERE id = 123"

  - name: 从 MySQL 查库存
    connection: inventory-db
    sql: "SELECT * FROM stock WHERE product_id = 456"

  - name: 从 MongoDB 查日志
    connection: log-db
    sql: "SELECT * FROM access_logs WHERE order_id = 123"
```

DataZen 的 Workflow 引擎会在后台管理所有连接的生命周期——连接池、超时、重连、断开，你不需要操心。不同数据库的 SQL 方言差异也被引擎处理，你只需要写正确的 SQL。

**一个 Workflow 可以操作任意多个数据库连接**，不限数量、不限类型。PostgreSQL、MySQL、SQLite、Redis、ClickHouse——只要 DataZen 能连上的数据库，Workflow 都能操作。

## 变量与参数化：让 Workflow 可复用

硬编码的 Workflow 用处有限。DataZen 支持在 SQL 中使用变量，让 Workflow 变成可复用的模板：

```yaml
name: 跨库数据校验

parameters:
  - name: order_id
    type: string
    description: 要校验的订单号

steps:
  - name: 订单表：查询订单
    connection: order-service
    sql: "SELECT id, status, amount FROM orders WHERE id = '{{order_id}}'"

  - name: 支付表：查询支付状态
    connection: payment-service
    sql: "SELECT payment_status, amount AS paid_amount FROM payments WHERE order_id = '{{order_id}}'"

  - name: 校验金额一致性
    sql: |
      SELECT 
        '{{order_id}}' AS order_id,
        o.amount AS order_amount,
        p.paid_amount,
        CASE WHEN o.amount = p.paid_amount THEN '一致' ELSE '不一致' END AS check_result
      FROM (SELECT {{steps.0.result.amount}} AS amount) o
      CROSS JOIN (SELECT {{steps.1.result.paid_amount}} AS paid_amount) p
```

执行时，DataZen 弹出参数输入框，你输入订单号就能一键完成跨库校验。同一个 Workflow 可以反复使用，排查不同订单时只需要改一个参数。

## 实际场景

### 场景一：微服务数据一致性巡检

定期检查各服务之间的数据是否一致：

```yaml
name: 每日数据一致性巡检
description: 每天检查订单、支付、库存三方数据一致性

parameters:
  - name: check_date
    type: string
    default: "{{date}}"
    description: 巡检日期

steps:
  - name: 查询当日订单
    connection: order-service
    id: orders
    sql: |
      SELECT id, status, amount 
      FROM orders 
      WHERE DATE(created_at) = '{{check_date}}'

  - name: 查询当日支付
    connection: payment-service
    id: payments
    sql: |
      SELECT order_id, payment_status, amount
      FROM payments
      WHERE DATE(created_at) = '{{check_date}}'

  - name: 查询当日库存变动
    connection: inventory-service
    id: inventory
    sql: |
      SELECT order_id, product_id, quantity
      FROM inventory_deductions
      WHERE DATE(created_at) = '{{check_date}}'

  - name: 汇总巡检结果
    sql: |
      SELECT 
        (SELECT COUNT(*) FROM {{steps.0.result}}) AS total_orders,
        (SELECT COUNT(*) FROM {{steps.1.result}} WHERE payment_status = 'paid') AS paid_orders,
        (SELECT COUNT(*) FROM {{steps.2.result}}) AS deducted_count
```

### 场景二：跨库数据迁移

微服务拆分后，需要把数据从单体库迁移到各个微服务的独立库：

```yaml
name: 用户数据拆分迁移
description: 从单体用户库迁移到独立的用户服务库

steps:
  - name: 从单体库导出用户数据
    connection: monolith-db
    sql: "SELECT id, username, email, phone, created_at FROM users WHERE id > 0"

  - name: 清空用户服务库
    connection: user-service-db
    sql: "TRUNCATE TABLE users"

  - name: 插入到用户服务库
    connection: user-service-db
    sql: |
      INSERT INTO users (id, username, email, phone, created_at)
      SELECT id, username, email, phone, created_at
      FROM dblink('monolith connection', 'SELECT id, username, email, phone, created_at FROM users')
      AS t(id INT, username TEXT, email TEXT, phone TEXT, created_at TIMESTAMP)

  - name: 验证迁移结果
    connection: user-service-db
    sql: "SELECT COUNT(*) AS migrated_count FROM users"
```

### 场景三：告警数据聚合

从多个监控数据库中聚合告警信息：

```yaml
name: 告警聚合查询
description: 从多个监控系统聚合告警数据

parameters:
  - name: hours
    type: number
    default: 24
    description: 查询最近多少小时

steps:
  - name: 应用错误日志
    connection: app-monitor
    sql: |
      SELECT 'app-error' AS source, error_type, COUNT(*) AS count
      FROM error_logs
      WHERE created_at > NOW() - INTERVAL '{{hours}} hours'
      GROUP BY error_type

  - name: 数据库慢查询
    connection: db-monitor
    sql: |
      SELECT 'slow-query' AS source, query_type, COUNT(*) AS count
      FROM slow_query_logs
      WHERE created_at > NOW() - INTERVAL '{{hours}} hours'
      GROUP BY query_type

  - name: API 超时
    connection: api-monitor
    sql: |
      SELECT 'api-timeout' AS source, endpoint, COUNT(*) AS count
      FROM timeout_logs
      WHERE created_at > NOW() - INTERVAL '{{hours}} hours'
      GROUP BY endpoint

  - name: 汇总告警
    sql: |
      SELECT * FROM {{steps.0.result}}
      UNION ALL
      SELECT * FROM {{steps.1.result}}
      UNION ALL
      SELECT * FROM {{steps.2.result}}
```

## 条件执行：让 Workflow 有"判断力"

不是所有步骤都应该无条件执行。DataZen 支持条件执行——根据上一步的结果决定是否执行下一步：

```yaml
name: 智能数据清理

steps:
  - name: 检查待清理数据量
    id: check_count
    sql: "SELECT COUNT(*) AS cnt FROM expired_data"

  - name: 数据量超过阈值，执行清理
    when: "{{check_count.result.cnt}} > 10000"
    sql: "DELETE FROM expired_data WHERE created_at < NOW() - INTERVAL '90 days'"

  - name: 数据量不足，跳过清理
    when: "{{check_count.result.cnt}} <= 10000"
    sql: "SELECT '数据量不足，跳过清理' AS message"
```

`when` 条件支持比较运算和逻辑运算，可以组合出复杂的判断逻辑。

## GUI 编辑器：可视化构建 Workflow

不习惯写 YAML？DataZen 提供了可视化 Workflow 编辑器，让你用拖拽的方式构建工作流。

![Workflow 编辑器](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/11-workflow-editor.png)

在编辑器中：

- 从左侧面板拖拽 Step 到画布上。
- 点击 Step 填写 SQL 和配置参数。
- 用连线表示步骤之间的执行顺序。
- 配置条件分支和错误处理策略。

编辑器会自动生成对应的 YAML 文件，你也可以在 YAML 和可视化之间切换——选择你最舒服的方式。

![Workflow 执行界面](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/11-workflow-execution.png)

执行 Workflow 时，GUI 会实时展示每个步骤的执行状态、耗时和结果。哪一步出错了、哪一步耗时异常，一目了然。

## 写在最后

微服务架构带来了更好的可扩展性和可维护性，但也带来了一个副作用：**业务数据被分散到多个数据库中**。追踪一笔业务的完整链路，需要在多个数据库之间来回切换。

DataZen 的 Workflow 把这个过程变成了一个 YAML 文件——定义一次，反复执行。跨库查询、参数化模板、条件分支、错误处理，全在一个地方搞定。

不需要写脚本，不需要登录多个客户端，不需要在脑子里拼凑结果。

现在就试试吧——完全免费，无需注册。

---

**[立即下载 DataZen](https://flyxl.github.io/datazen/download.html)** · [GitHub 源码](https://github.com/flyxl/datazen)
