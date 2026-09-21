---
title: "Cross-Service Database Queries: Trace Your Entire Business Flow with One Workflow"
description: "In a microservice architecture, tracking a single order means querying 5 different databases. DataZen Workflow supports cross-database operations, using YAML to chain multi-database queries and trace your entire business flow in one shot."
date: 2026-10-14
slug: workflow
keywords:
  - cross-service database queries
  - database automation
  - YAML workflow
  - cross-database data tracing
  - database orchestration
---

# Cross-Service Database Queries: Trace Your Entire Business Flow with One Workflow

Ever had this happen? A user complains — "My order status is wrong" — and you need to investigate.

You open the order service database and find the record: status is "Paid." But the customer says they never received the goods. So you check the inventory service for stock deduction records, then the logistics service for shipping status, then the payment service to confirm whether the payment callback succeeded, and finally the notification service to see if a shipping notification was sent.

**5 microservices, 5 databases, 5 logins, 5 manual SQL executions.**

Just switching between databases eats up half an hour. Worse, you have to mentally stitch together results from each — orders in PostgreSQL, inventory in MySQL, logistics in MongoDB, payments in another PostgreSQL instance.

This isn't an isolated case. In a microservice architecture, **business data is spread across multiple independent databases**, and tracing a complete business flow is one of the most painful daily tasks.

## Workflow: Turn Cross-Database Queries into a Single File

DataZen's YAML Workflow is built to solve exactly this problem. You define cross-database query steps in a single YAML file, DataZen executes them sequentially, and the results are presented in a unified view.

A typical microservice trace workflow looks like this:

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

![Cross-Database Operation Diagram](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/11-workflow-cross-db.png)

One command, all five databases queried. No logging into five different clients, no mentally stitching results — the Workflow engine handles connection management, execution scheduling, and result aggregation for you.

## Core Capability: Cross-Database Operations

The core of Workflow is the `connection` field — each step can target a different database connection.

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

DataZen's Workflow engine manages all connection lifecycles behind the scenes — connection pools, timeouts, reconnections, teardowns — you don't need to worry about any of it. SQL dialect differences across databases are also handled by the engine; you just write correct SQL.

**A single Workflow can operate on any number of database connections**, with no limit on count or type. PostgreSQL, MySQL, SQLite, Redis, ClickHouse — if DataZen can connect to it, Workflow can operate on it.

## Variables and Parameterization: Reusable Workflows

Hard-coded workflows have limited utility. DataZen supports variables in SQL, turning workflows into reusable templates:

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

When executed, DataZen presents a parameter input dialog — enter the order number and the cross-database validation runs in one click. The same workflow can be reused repeatedly; just change the parameter when investigating a different order.

## Real-World Scenarios

### Scenario 1: Microservice Data Consistency Check

Periodically verify that data across services is consistent:

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

### Scenario 2: Cross-Database Data Migration

After a microservice split, migrate data from a monolithic database to each service's independent database:

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

### Scenario 3: Alert Data Aggregation

Aggregate alert information from multiple monitoring databases:

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

## Conditional Execution: Give Your Workflow "Decision-Making"

Not every step should run unconditionally. DataZen supports conditional execution — decide whether to run the next step based on the previous step's result:

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

The `when` condition supports comparison and logical operators, allowing you to build complex decision logic.

## GUI Editor: Build Workflows Visually

Don't like writing YAML? DataZen provides a visual Workflow editor so you can build workflows with drag-and-drop.

![Workflow Editor](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/11-workflow-editor.png)

In the editor:

- Drag steps from the left panel onto the canvas.
- Click a step to fill in SQL and configure parameters.
- Use connectors to define execution order between steps.
- Set up conditional branches and error handling strategies.

The editor auto-generates the corresponding YAML file. You can switch between YAML and the visual editor — choose whichever feels most comfortable.

![Workflow Execution Interface](https://raw.githubusercontent.com/flyxl/datazen/main/site/assets/blog/11-workflow-execution.png)

When executing a workflow, the GUI shows real-time execution status, duration, and results for each step. Which step errored, which step took unusually long — it's all at a glance.

## Wrapping Up

Microservice architectures bring better scalability and maintainability, but also an unintended side effect: **business data is scattered across multiple databases**. Tracing a complete business flow means switching back and forth between databases.

DataZen's Workflow turns that process into a YAML file — define it once, run it repeatedly. Cross-database queries, parameterized templates, conditional branches, error handling — all in one place.

No scripts to write, no multiple clients to log into, no mental stitching of results.

Try it now — completely free, no registration required.

---

**[Download DataZen Now](https://flyxl.github.io/datazen/download.html)** · [GitHub Source](https://github.com/flyxl/datazen)
